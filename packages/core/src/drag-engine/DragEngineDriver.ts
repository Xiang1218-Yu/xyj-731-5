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
 *  与旧 DragDropDriver 的关系：
 *    - 旧 DragDropDriver 仍然保留并导出，供需要极致还原原生行为的场景使用；
 *    - 默认驱动列表（presets.DEFAULT_DRIVERS）切换为本 Driver；
 *    - 本 Driver 默认使用 PointerDragBackend，避免 HTML5 DnD 的预览不一致。
 *
 *  自定义方式：
 *    业务方可通过 props.dragBackend 传入自定义后端，或直接自行构造
 *    DragEngine 并以本 Driver 为参考编写适配器。
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

export class DragEngineDriver extends EventDriver<Engine> {
  /** 内部持有的新拖拽引擎实例。 */
  private dragEngine: DragEngine | null = null

  /** 取消「新事件 -> 旧事件」桥接订阅的函数集合。 */
  private unsubscribers: Array<() => void> = []

  attach(): void {
    const engineProps = this.engine.props

    // 根据引擎配置构造默认的源 / 目标解析器，保持 DOM 属性契约一致。
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

    this.dragEngine = new DragEngine({
      backend,
      sourceResolver,
      targetResolver,
      dragThreshold: 4,
    })

    // 桥接：新事件总线 -> 旧 Event 体系，保证既有 effect 无感升级。
    this.unsubscribers.push(
      this.dragEngine.on('drag:engine:start', ({ pointer }) => {
        this.dispatch(new DragStartEvent(toLegacyPointerData(pointer)))
      })
    )
    this.unsubscribers.push(
      this.dragEngine.on('drag:engine:move', ({ pointer }) => {
        this.dispatch(new DragMoveEvent(toLegacyPointerData(pointer)))
      })
    )
    this.unsubscribers.push(
      this.dragEngine.on('drag:engine:stop', ({ pointer }) => {
        this.dispatch(new DragStopEvent(toLegacyPointerData(pointer)))
      })
    )

    this.dragEngine.mount(this.container)
  }

  detach(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    this.dragEngine?.unmount()
    this.dragEngine = null
  }
}
