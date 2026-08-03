/**
 * ============================================================================
 *  DragEngineDriver —— 新旧拖拽体系的向后兼容适配器
 * ============================================================================
 *
 *  作用：
 *    本类继承自核心包既有的 EventDriver，对外表现为一个「普通的旧驱动器」，
 *    但内部把输入处理委托给全新的 DragEngine（策略模式 + 事件总线 + 虚拟预览）。
 *
 *    它负责把 DragEngine 事件总线上的强类型事件，翻译为旧 Event 体系中的
 *    DragStartEvent / DragMoveEvent / DragStopEvent，并通过 this.dispatch
 *    派发出去。这样既有的 useDragDropEffect、useCursorEffect 等 effect
 *    完全无需修改即可继续工作，实现「重构但不破坏」。
 *
 *  多容器单例（关键）：
 *    设计器画布运行在 iframe 中，引擎会为「顶层 document」与「iframe 的
 *    contentDocument」各实例化一个 DragEngineDriver。如果每个 driver 各自
 *    new 一个 DragEngine，就会出现：
 *      - 同一次拖拽被两个引擎各处理一遍；
 *      - drag:stop 派发多次，导致 MoveHelper 状态错乱、节点无法落位。
 *    因此这里把 DragEngine 缓存在 engine 实例上（ENGINE_SYMBOL），所有
 *    driver 共享同一个引擎。attach 时只把当前容器 mount 到共享引擎，
 *    detach 时只卸载当前容器；最后一个 driver 卸载时才销毁引擎。
 *
 *  与旧 DragDropDriver 的关系：
 *    - 旧 DragDropDriver 仍然保留并导出，供需要极致还原原生行为的场景使用；
 *    - 默认驱动列表（presets.DEFAULT_DRIVERS）切换为本 Driver；
 *    - 本 Driver 默认使用 PointerDragBackend，避免 HTML5 DnD 的预览不一致。
 * ============================================================================
 */

import { EventDriver } from '@designable/shared'
import { Engine } from '../models/Engine'
import { DragStartEvent, DragMoveEvent, DragStopEvent } from '../events'
import { DragEngine } from './DragEngine'
import { PointerDragBackend } from './backends/PointerDragBackend'
import { AttributeDragSourceResolver } from './resolvers/AttributeDragSourceResolver'
import { AttributeDragTargetResolver } from './resolvers/AttributeDragTargetResolver'
import type {
  IDragBackend,
  IDragSourceResolver,
  IDragTargetResolver,
  DragPointerData,
} from './types'

/** 在 Engine 实例上缓存共享 DragEngine 的符号键。 */
const SHARED_ENGINE = Symbol('DRAG_ENGINE_SHARED_INSTANCE')

/** 共享引擎的引用计数，用于判断何时真正销毁。 */
const SHARED_REF_COUNT = Symbol('DRAG_ENGINE_REF_COUNT')

/** 扩展 Engine 类型以承载缓存字段（不污染公共类型）。 */
type DragEngineHost = Engine & {
  [SHARED_ENGINE]?: DragEngine
  [SHARED_REF_COUNT]?: number
}

/** 把新指针数据转换为旧事件构造参数。 */
function toLegacyPointerData(pointer: DragPointerData) {
  return {
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    pageX: pointer.pageX,
    pageY: pointer.pageY,
    target: pointer.target as EventTarget,
    view: pointer.view,
  }
}

/**
 * 获取（必要时创建）与给定 engine 关联的共享 DragEngine。
 */
function getOrCreateSharedDragEngine(host: DragEngineHost): DragEngine {
  if (host[SHARED_ENGINE]) return host[SHARED_ENGINE]

  const engineProps = host.props
  const sourceResolver: IDragSourceResolver =
    new AttributeDragSourceResolver({
      nodeIdAttrName: engineProps.nodeIdAttrName,
      sourceIdAttrName: engineProps.sourceIdAttrName,
      outlineNodeIdAttrName: engineProps.outlineNodeIdAttrName,
      nodeSelectionIdAttrName: engineProps.nodeSelectionIdAttrName,
      nodeDragHandlerAttrName: engineProps.nodeDragHandlerAttrName,
    })

  const targetResolver: IDragTargetResolver =
    new AttributeDragTargetResolver({
      nodeIdAttrName: engineProps.nodeIdAttrName,
      outlineNodeIdAttrName: engineProps.outlineNodeIdAttrName,
    })

  // 默认使用 Pointer 后端；业务侧可通过 engine.props.dragBackend 覆盖。
  const backend: IDragBackend =
    engineProps.dragBackend ?? new PointerDragBackend()

  const dragEngine = new DragEngine({
    backend,
    sourceResolver,
    targetResolver,
    dragThreshold: 4,
  })

  host[SHARED_ENGINE] = dragEngine
  host[SHARED_REF_COUNT] = 0
  return dragEngine
}

export class DragEngineDriver extends EventDriver<Engine> {
  /** 指向共享的拖拽引擎（不在本 driver 内独占创建）。 */
  private dragEngine: DragEngine | null = null

  /** 当前 driver 是否已挂载。 */
  private attached = false

  attach(): void {
    const host = this.engine as DragEngineHost
    const dragEngine = getOrCreateSharedDragEngine(host)
    this.dragEngine = dragEngine
    host[SHARED_REF_COUNT] = (host[SHARED_REF_COUNT] ?? 0) + 1

    // 仅在首个 driver 挂载时建立一次「新事件 -> 旧事件」桥接订阅，
    // 避免多个 driver 重复 dispatch 同一事件。
    if (host[SHARED_REF_COUNT] === 1) {
      dragEngine.on('drag:engine:start', ({ pointer }) => {
        this.dispatch(new DragStartEvent(toLegacyPointerData(pointer)))
      })
      dragEngine.on('drag:engine:move', ({ pointer }) => {
        this.dispatch(new DragMoveEvent(toLegacyPointerData(pointer)))
      })
      dragEngine.on('drag:engine:stop', ({ pointer }) => {
        this.dispatch(new DragStopEvent(toLegacyPointerData(pointer)))
      })
    }

    // 把当前容器（顶层 document 或 iframe contentDocument）挂到共享后端。
    dragEngine.mount(this.container)
    this.attached = true
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false

    const host = this.engine as DragEngineHost
    const dragEngine = this.dragEngine ?? host[SHARED_ENGINE]
    if (dragEngine) {
      // 只卸载当前容器，保留其它 driver（如 iframe）的监听。
      dragEngine.unmountContainer(this.container)
    }

    const refCount = (host[SHARED_REF_COUNT] ?? 1) - 1
    host[SHARED_REF_COUNT] = refCount
    if (refCount <= 0 && host[SHARED_ENGINE]) {
      // 最后一个 driver 卸载时，彻底销毁共享引擎与预览 DOM。
      host[SHARED_ENGINE].unmount()
      host[SHARED_ENGINE] = undefined
      host[SHARED_REF_COUNT] = 0
    }
    this.dragEngine = null
  }
}
