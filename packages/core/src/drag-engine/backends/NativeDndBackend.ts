import { IDragBackendHost, IDragSignal, IRawCoordinate } from '../types'
import { AbstractDragBackend } from './AbstractDragBackend'

/**
 * ============================================================================
 * NativeDndBackend —— 基于 HTML5 原生 Drag & Drop 的后端（向后兼容策略）
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：以浏览器原生 DnD 事件采集输入并翻译为标准拖拽信号。
 *
 * 重构思路：
 *   为满足“保持现有所有拖拽功能向后兼容”，保留一条原生 DnD 通道。旧行为里
 *   dragstart/dragover/dragend 的语义在此完整保留，使依赖原生 DnD（例如从桌面
 *   拖入文件、或第三方组件强依赖 dataTransfer）的场景仍可用。
 *
 *   与旧实现不同的是，这里同样只负责“采集与翻译”，不再自行修改光标或直接操作
 *   业务状态——落点计算与预览由 DragEngine 下游统一处理。因此原生后端可与指针
 *   后端在运行时互换而不影响业务层。
 * ============================================================================
 */
export class NativeDndBackend extends AbstractDragBackend {
  readonly name = 'NativeDndBackend'

  /** 是否处于拖拽中 */
  private dragging = false

  attach(container: EventTarget, host: IDragBackendHost): void {
    this.host = host
    container.addEventListener('dragstart', this.onDragStart as EventListener)
    container.addEventListener('dragover', this.onDragOver as EventListener)
    container.addEventListener('drop', this.onDrop as EventListener)
    container.addEventListener('dragend', this.onDragEnd as EventListener)
  }

  detach(container: EventTarget): void {
    container.removeEventListener(
      'dragstart',
      this.onDragStart as EventListener
    )
    container.removeEventListener('dragover', this.onDragOver as EventListener)
    container.removeEventListener('drop', this.onDrop as EventListener)
    container.removeEventListener('dragend', this.onDragEnd as EventListener)
    this.dragging = false
    this.host = null
  }

  /** 从原生 DragEvent 构造标准信号 */
  private buildSignal(event: DragEvent): IDragSignal | null {
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

  private onDragStart = (event: DragEvent): void => {
    if (!this.host) return
    this.dragging = true
    // 使用透明拖影，禁用浏览器默认拖影，视觉预览交由虚拟 DOM 层
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
    }
    const signal = this.buildSignal(event)
    if (signal) this.host.dispatchStart(signal)
  }

  private onDragOver = (event: DragEvent): void => {
    if (!this.dragging || !this.host) return
    // 必须阻止默认行为，否则 drop 不会触发
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    const signal = this.buildSignal(event)
    if (signal) this.host.dispatchMove(signal)
  }

  private onDrop = (event: DragEvent): void => {
    if (!this.dragging || !this.host) return
    event.preventDefault()
    const signal = this.buildSignal(event)
    if (signal) this.host.dispatchDrop(signal)
    this.dragging = false
  }

  private onDragEnd = (event: DragEvent): void => {
    if (!this.dragging || !this.host) return
    // 若未经过 drop（如拖到无效区域松开），视为取消
    const signal = this.buildSignal(event)
    if (signal) this.host.dispatchCancel(signal)
    this.dragging = false
  }
}
