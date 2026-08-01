import { DragEventBus } from './DragEventBus'
import { DragPreviewModel } from './DragPreviewModel'
import {
  DragPhase,
  IDragBackend,
  IDragBackendHost,
  IDragCoordinate,
  IDragEventBus,
  IDragSignal,
  IDragSource,
  IRawCoordinate,
  IVirtualPreviewNode,
} from './types'

/**
 * ============================================================================
 * DragEngine —— 拖拽编排器（模块核心）
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：编排“后端策略 + 事件总线 + 预览模型 + 状态机”，把标准拖拽
 * 信号转化为领域事件与预览更新。它不直接监听 DOM，也不做业务落点计算。
 *
 * 重构思路（对应四项重构要求）：
 *   1) 拖拽逻辑抽象为独立模块：DragEngine 与组件渲染彻底分离，通过 backend 采集
 *      输入、通过 bus 广播信号，自定义拖拽行为只需替换 backend 或订阅 bus。
 *   2) 策略模式支持不同后端：通过 useBackend 在运行时注入/切换 IDragBackend，
 *      指针后端与原生 DnD 后端可无缝互换。
 *   3) 虚拟 DOM 预览：内置 DragPreviewModel，预览与真实组件解耦。
 *   4) 事件总线替代直接状态传递：所有阶段通过 IDragEventBus 广播，跨画布消费者
 *      被动接收同一份不可变负载，消除状态同步延迟。
 *   （向后兼容）：通过 IDragEngineAdapter.bridge* 回调把标准信号回放为既有的
 *      DragStart/DragMove/DragStop 事件，旧 effects 无需改动即可继续工作。
 * ============================================================================
 */

/**
 * DragEngine 与宿主（如设计器 Engine）之间的适配契约。
 * 把“如何解析 DOM 上的拖拽源”“如何换算坐标”“如何桥接旧事件”“如何生成预览
 * 节点”等宿主相关细节收敛到适配器，使 DragEngine 保持宿主无关、可独立测试。
 */
export interface IDragEngineAdapter {
  /** 监听容器（通常是 document / window） */
  getContainer(): EventTarget
  /** 将原始事件目标解析为标准拖拽源 */
  resolveSources(target: EventTarget | null): IDragSource[]
  /** 将原始坐标换算为顶层统一坐标系 */
  normalizeCoordinate(view: Window | null, raw: IRawCoordinate): IDragCoordinate
  /** 由拖拽源生成虚拟预览节点（预览层不解析业务，标题等由宿主注入） */
  createPreviewNodes(sources: IDragSource[]): IVirtualPreviewNode[]
  /** 向后兼容：把标准信号回放为宿主的既有拖拽事件 */
  bridgeStart?(signal: IDragSignal): void
  bridgeMove?(signal: IDragSignal): void
  bridgeDrop?(signal: IDragSignal): void
  bridgeCancel?(signal: IDragSignal): void
}

export class DragEngine implements IDragBackendHost {
  /** 类型化事件总线 */
  readonly bus: IDragEventBus = new DragEventBus()

  /** 虚拟预览模型 */
  readonly preview: DragPreviewModel = new DragPreviewModel()

  /** 宿主适配器 */
  private readonly adapter: IDragEngineAdapter

  /** 当前生效的后端策略 */
  private backend: IDragBackend | null = null

  /** 当前拖拽阶段（状态机） */
  private currentPhase: DragPhase = DragPhase.Idle

  /** 当前拖拽源缓存，供 move/drop 复用 */
  private activeSources: IDragSource[] = []

  /**
   * @param adapter 宿主适配器，提供容器、坐标换算、源解析、预览生成与旧事件桥接
   */
  constructor(adapter: IDragEngineAdapter) {
    this.adapter = adapter
  }

  /** 只读的当前阶段 */
  get phase(): DragPhase {
    return this.currentPhase
  }

  /** 当前是否处于拖拽中 */
  get dragging(): boolean {
    return (
      this.currentPhase === DragPhase.Start ||
      this.currentPhase === DragPhase.Move
    )
  }

  /**
   * 注入/切换后端策略（策略模式入口）。
   * 若已有后端在工作，会先安全解绑旧后端再绑定新后端，支持运行时热切换。
   */
  useBackend(backend: IDragBackend): void {
    const container = this.adapter.getContainer()
    if (this.backend) {
      this.backend.detach(container)
    }
    this.backend = backend
    this.backend.attach(container, this)
  }

  /** 挂载：要求已先 useBackend。无后端时静默返回，避免误用报错。 */
  mount(): void {
    if (!this.backend) return
    this.backend.attach(this.adapter.getContainer(), this)
  }

  /** 卸载：解绑后端、清空总线与预览、复位状态机 */
  unmount(): void {
    const container = this.adapter.getContainer()
    if (this.backend) {
      this.backend.detach(container)
    }
    this.bus.clear()
    this.preview.hide()
    this.setPhase(DragPhase.Idle)
    this.activeSources = []
  }

  /* --------------------------- IDragBackendHost --------------------------- */

  /** 委派宿主适配器解析拖拽源（IDragBackendHost 实现） */
  resolveSources(target: EventTarget | null): IDragSource[] {
    return this.adapter.resolveSources(target)
  }

  /** 委派宿主适配器换算顶层统一坐标（IDragBackendHost 实现） */
  normalizeCoordinate(
    view: Window | null,
    raw: IRawCoordinate
  ): IDragCoordinate {
    return this.adapter.normalizeCoordinate(view, raw)
  }

  /**
   * 后端上报“拖拽开始”：缓存拖拽源、进入 Start 阶段、生成虚拟预览，
   * 广播 drag:start 并桥接旧事件。无有效源则忽略。
   */
  dispatchStart(signal: IDragSignal): void {
    // 无有效拖拽源则忽略，避免空拖拽污染状态机
    if (!signal.sources.length) return
    this.activeSources = signal.sources
    this.setPhase(DragPhase.Start)
    // 生成虚拟预览快照，与真实组件解耦
    this.preview.show(
      this.adapter.createPreviewNodes(signal.sources),
      signal.coordinate
    )
    this.bus.emit('drag:start', signal)
    this.adapter.bridgeStart?.(signal)
  }

  /**
   * 后端上报“拖拽移动”：进入 Move 阶段、更新预览坐标，广播 drag:move 并桥接旧事件。
   * 移动信号中若无源则复用 start 缓存的源，保证跨画布移动时来源一致。
   */
  dispatchMove(signal: IDragSignal): void {
    if (!this.dragging) return
    // move 阶段复用 start 缓存的拖拽源，保证跨画布移动时来源一致
    const enriched: IDragSignal = {
      ...signal,
      sources: signal.sources.length ? signal.sources : this.activeSources,
    }
    this.setPhase(DragPhase.Move)
    this.preview.move(enriched.coordinate)
    this.bus.emit('drag:move', enriched)
    this.adapter.bridgeMove?.(enriched)
  }

  /**
   * 后端上报“拖拽落点”：进入 Drop 阶段，广播 drag:drop、桥接旧事件后收尾复位。
   */
  dispatchDrop(signal: IDragSignal): void {
    if (!this.dragging) return
    const enriched: IDragSignal = {
      ...signal,
      sources: this.activeSources,
    }
    this.setPhase(DragPhase.Drop)
    this.bus.emit('drag:drop', enriched)
    this.adapter.bridgeDrop?.(enriched)
    // 落点完成后收尾
    this.finish()
  }

  /**
   * 后端上报“拖拽取消”：进入 Cancel 阶段，广播 drag:cancel、桥接旧事件后收尾复位。
   */
  dispatchCancel(signal: IDragSignal): void {
    if (!this.dragging) return
    const enriched: IDragSignal = {
      ...signal,
      sources: this.activeSources,
    }
    this.setPhase(DragPhase.Cancel)
    this.bus.emit('drag:cancel', enriched)
    this.adapter.bridgeCancel?.(enriched)
    this.finish()
  }

  /* ------------------------------ internals ------------------------------ */

  /** 收尾：隐藏预览、清空源、复位到 Idle */
  private finish(): void {
    this.preview.hide()
    this.activeSources = []
    this.setPhase(DragPhase.Idle)
  }

  /** 变更阶段并广播阶段变更事件 */
  private setPhase(next: DragPhase): void {
    if (next === this.currentPhase) return
    const previous = this.currentPhase
    this.currentPhase = next
    this.bus.emit('drag:phaseChange', { previous, current: next })
  }
}
