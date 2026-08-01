import { IDragSignal } from '../../drag-engine'
import { DragStartEvent, DragMoveEvent, DragStopEvent } from '../../events'
import { globalThisPolyfill } from '@designable/shared'
import { Engine } from '../Engine'

/**
 * ============================================================================
 * LegacyEventBridge —— 旧拖拽事件桥接器
 * ----------------------------------------------------------------------------
 * 单一职责：仅负责把新的标准拖拽信号回放为设计器既有的
 * DragStart / DragMove / DragStop 事件，确保旧 effects（如 useDragDropEffect）
 * 零改动继续工作（向后兼容）。
 *
 * 拆分自原 DragEngineAdapter：向后兼容是一个可能被逐步移除的“过渡关注点”，
 * 独立成类后，未来彻底切换到事件总线时可直接删除本类而不影响其余逻辑。
 * ============================================================================
 */
export class LegacyEventBridge {
  /** 设计器引擎，用于派发既有拖拽事件 */
  private readonly engine: Engine

  /**
   * @param engine 用于派发旧事件的设计器引擎实例
   */
  constructor(engine: Engine) {
    this.engine = engine
  }

  /** 把标准信号还原为旧 Cursor 事件所需的数据结构 */
  private toLegacyEventData(signal: IDragSignal) {
    return {
      clientX: signal.coordinate.clientX,
      clientY: signal.coordinate.clientY,
      pageX: signal.coordinate.pageX,
      pageY: signal.coordinate.pageY,
      target: signal.target,
      view: signal.view ?? globalThisPolyfill,
    }
  }

  /** 派发旧的“拖拽开始”事件 DragStartEvent */
  start(signal: IDragSignal): void {
    this.engine.dispatch(new DragStartEvent(this.toLegacyEventData(signal)))
  }

  /** 派发旧的“拖拽移动”事件 DragMoveEvent */
  move(signal: IDragSignal): void {
    this.engine.dispatch(new DragMoveEvent(this.toLegacyEventData(signal)))
  }

  /** 派发旧的“拖拽落点”事件 DragStopEvent */
  drop(signal: IDragSignal): void {
    this.engine.dispatch(new DragStopEvent(this.toLegacyEventData(signal)))
  }

  /** 派发旧的“拖拽取消”事件；旧体系无独立取消事件，故同样以 DragStop 收尾 */
  cancel(signal: IDragSignal): void {
    this.engine.dispatch(new DragStopEvent(this.toLegacyEventData(signal)))
  }
}
