import { globalThisPolyfill } from '@designable/shared'
import { Engine } from '../../models/Engine'
import { DragMoveEvent, DragStartEvent, DragStopEvent } from '../../events'
import { isElementTarget } from '../guards'
import { DragBackendType, IDragBackend } from '../types'

/**
 * Pointer 拖拽后端（策略模式的可替换实现）
 *
 * 职责单一：基于 pointer 事件采集拖拽手势，并把手势转换为既有的
 * DragStartEvent / DragMoveEvent / DragStopEvent 派发到引擎事件流中。
 *
 * 解决的问题：
 * 1. 不再依赖原生 HTML5 DnD，拖拽过程完全由 DragEngine 控制，
 *    在缩放、嵌套滚动容器、复杂层叠布局下手势坐标表现一致
 * 2. 拖拽影像由 DragEngine 的虚拟DOM预览层渲染，而非浏览器原生影像
 *
 * 向后兼容说明：
 * 该后端派发的仍是标准拖拽事件，useCursorEffect / useAutoScrollEffect /
 * GhostWidget 等所有既有订阅方无感知；同时 DragDropDriver 会检测当前
 * 后端类型并自动让位，避免手势被重复采集。
 */
export class PointerDragBackend implements IDragBackend {
  readonly type = DragBackendType.Pointer

  /** 引擎引用，用于派发归一化后的拖拽事件 */
  private engine: Engine

  /** 触发拖拽所需的最小位移（px），与原 DragDropDriver 保持一致 */
  private dragThreshold = 4

  /** 手势会话内部状态 */
  private dragging = false

  private startEvent: PointerEvent | null = null

  private lastMoveEvent: PointerEvent | null = null

  constructor(engine: Engine) {
    this.engine = engine
  }

  attach(): void {
    const doc = globalThisPolyfill.document
    doc.addEventListener('pointerdown', this.onPointerDown, true)
  }

  detach(): void {
    const doc = globalThisPolyfill.document
    doc.removeEventListener('pointerdown', this.onPointerDown, true)
    this.removeDragListeners()
    this.dragging = false
    this.startEvent = null
    this.lastMoveEvent = null
  }

  private onPointerDown = (event: PointerEvent) => {
    // 仅响应主键，且忽略 ctrl/meta 组合键（与历史行为一致）
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return
    // 类型守卫收窄：非元素目标（如 Window/Document）直接忽略
    const target = event.target
    if (!isElementTarget(target)) return
    if (target.isContentEditable || target.contentEditable === 'true') return
    if (target.closest('.monaco-editor')) return
    this.startEvent = event
    this.dragging = false
    const doc = globalThisPolyfill.document
    doc.addEventListener('pointermove', this.onDistanceChange, true)
    doc.addEventListener('pointerup', this.onPointerUp, true)
    doc.addEventListener('pointercancel', this.onPointerUp, true)
  }

  private onDistanceChange = (event: PointerEvent) => {
    if (!this.startEvent) return
    const distance = Math.sqrt(
      Math.pow(event.pageX - this.startEvent.pageX, 2) +
        Math.pow(event.pageY - this.startEvent.pageY, 2)
    )
    if (distance > this.dragThreshold) {
      const doc = globalThisPolyfill.document
      doc.removeEventListener('pointermove', this.onDistanceChange, true)
      this.startDrag(event)
    }
  }

  private startDrag(event: PointerEvent) {
    if (this.dragging || !this.startEvent) return
    this.dragging = true
    const doc = globalThisPolyfill.document
    doc.addEventListener('pointermove', this.onPointerMove, true)
    doc.addEventListener('contextmenu', this.onContextMenuWhileDragging, true)
    this.dispatchGesture(DragStartEvent, this.startEvent)
    // 记录初始坐标，避免 start 后立即重复派发同一坐标的 move
    this.lastMoveEvent = event
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return
    if (
      event.clientX === this.lastMoveEvent?.clientX &&
      event.clientY === this.lastMoveEvent?.clientY
    ) {
      return
    }
    this.dispatchGesture(DragMoveEvent, event)
    this.lastMoveEvent = event
  }

  private onPointerUp = (event: PointerEvent) => {
    if (this.dragging) {
      this.dispatchGesture(DragStopEvent, event)
    }
    this.dragging = false
    this.startEvent = null
    this.lastMoveEvent = null
    this.removeDragListeners()
  }

  private onContextMenuWhileDragging = (event: Event) => {
    event.preventDefault()
  }

  private removeDragListeners() {
    const doc = globalThisPolyfill.document
    doc.removeEventListener('pointermove', this.onDistanceChange, true)
    doc.removeEventListener('pointermove', this.onPointerMove, true)
    doc.removeEventListener('pointerup', this.onPointerUp, true)
    doc.removeEventListener('pointercancel', this.onPointerUp, true)
    doc.removeEventListener(
      'contextmenu',
      this.onContextMenuWhileDragging,
      true
    )
  }

  /**
   * 将 pointer 手势归一化为引擎标准拖拽事件
   * 事件数据结构与 DragDropDriver 保持一致，确保所有下游订阅方兼容
   */
  private dispatchGesture(
    EventClass:
      | typeof DragStartEvent
      | typeof DragMoveEvent
      | typeof DragStopEvent,
    event: PointerEvent
  ) {
    this.engine.dispatch(
      new EventClass({
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        target: event.target,
        view: event.view,
      })
    )
  }
}
