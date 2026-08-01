import { IDragBackendHost, IDragSignal, IRawCoordinate } from '../types'
import { AbstractDragBackend } from './AbstractDragBackend'

/**
 * ============================================================================
 * PointerDragBackend —— 基于 Pointer Events 的拖拽后端（默认策略）
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：仅用统一的 Pointer Events 采集输入并翻译为标准拖拽信号。
 *
 * 重构思路：
 *   旧实现（DragDropDriver）混用 mousedown/mousemove 与原生 HTML5 dragstart/
 *   dragover。原生 DnD 在跨 iframe、缩放画布、复杂布局下的拖拽预览行为由浏览器
 *   接管，各端表现不一致，且预览图无法定制。
 *
 *   本后端改用 Pointer Events：
 *     - 指针事件在鼠标 / 触控 / 触控笔上语义统一，跨端一致；
 *     - 完全不触发浏览器原生拖影，预览交由虚拟 DOM 层渲染，解决“复杂布局预览
 *       不一致”问题；
 *     - 通过 setPointerCapture 让移动事件在越出元素/跨画布时仍可靠送达，缓解
 *       跨画布状态同步延迟。
 * ============================================================================
 */
export class PointerDragBackend extends AbstractDragBackend {
  readonly name = 'PointerDragBackend'

  /** 按下时的原始事件，用于阈值判定与首帧信号 */
  private pressEvent: PointerEvent | null = null

  /** 按下时间戳 */
  private pressedAt = 0

  /** 是否已进入拖拽（越过阈值后置 true） */
  private dragging = false

  /** 已捕获指针的元素，detach/停止时释放 */
  private captureElement: Element | null = null

  attach(container: EventTarget, host: IDragBackendHost): void {
    this.host = host
    container.addEventListener(
      'pointerdown',
      this.onPointerDown as EventListener,
      true
    )
  }

  detach(container: EventTarget): void {
    container.removeEventListener(
      'pointerdown',
      this.onPointerDown as EventListener,
      true
    )
    this.teardownMoveListeners()
    this.reset()
    this.host = null
  }

  /** 从原生事件构造标准信号 */
  private buildSignal(event: PointerEvent): IDragSignal | null {
    if (!this.host) return null
    const raw: IRawCoordinate = {
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
    }
    const view = (event.view as Window) ?? null
    return {
      target: event.target,
      view,
      coordinate: this.host.normalizeCoordinate(view, raw),
      sources: this.host.resolveSources(event.target),
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    // 仅响应主键；忽略修饰键组合，保持与旧交互一致
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    // 可编辑区域与代码编辑器内部不劫持拖拽
    if (
      target?.isContentEditable ||
      target?.getAttribute?.('contenteditable') === 'true' ||
      target?.closest?.('.monaco-editor')
    ) {
      return
    }
    this.pressEvent = event
    this.pressedAt = Date.now()
    this.dragging = false
    window.addEventListener(
      'pointermove',
      this.onPointerMove as EventListener,
      true
    )
    window.addEventListener(
      'pointerup',
      this.onPointerUp as EventListener,
      true
    )
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pressEvent || !this.host) return
    if (!this.dragging) {
      // 未越过阈值前，只做阈值判定，避免误触发
      if (
        !this.isOverThreshold(
          this.pressEvent.clientX,
          this.pressEvent.clientY,
          event.clientX,
          event.clientY,
          this.pressedAt
        )
      ) {
        return
      }
      // 越过阈值：捕获指针并发出 start（用按下点坐标以保证与旧行为一致）
      this.dragging = true
      this.captureElement = event.target as Element
      try {
        this.captureElement?.setPointerCapture?.(event.pointerId)
      } catch {
        // 某些宿主环境不支持 pointer capture，静默降级不影响拖拽
      }
      const startSignal = this.buildSignal(this.pressEvent)
      if (startSignal) this.host.dispatchStart(startSignal)
    }
    const moveSignal = this.buildSignal(event)
    if (moveSignal) this.host.dispatchMove(moveSignal)
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.dragging && this.host) {
      const dropSignal = this.buildSignal(event)
      if (dropSignal) this.host.dispatchDrop(dropSignal)
    }
    this.teardownMoveListeners()
    this.releaseCapture(event.pointerId)
    this.reset()
  }

  private teardownMoveListeners(): void {
    window.removeEventListener(
      'pointermove',
      this.onPointerMove as EventListener,
      true
    )
    window.removeEventListener(
      'pointerup',
      this.onPointerUp as EventListener,
      true
    )
  }

  private releaseCapture(pointerId: number): void {
    try {
      this.captureElement?.releasePointerCapture?.(pointerId)
    } catch {
      // 忽略已自动释放的情况
    }
    this.captureElement = null
  }

  private reset(): void {
    this.pressEvent = null
    this.pressedAt = 0
    this.dragging = false
  }
}
