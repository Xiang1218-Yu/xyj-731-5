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

  /**
   * 本次拖拽是否已落点。
   * 原生事件时序固定为 drop 先于 dragend；用该标志实现 drop 与 dragend 的互斥：
   * 已 drop 则 dragend 不再重复派发取消，未 drop 则 dragend 视为取消。
   */
  private dropped = false

  /**
   * 1x1 透明图片，作为原生拖影占位。
   * 惰性创建并复用，避免每次 dragstart 都重新构造。
   */
  private transparentImage: HTMLImageElement | null = null

  /** 绑定原生 DnD 事件（dragstart/dragover/drop/dragend）到容器 */
  attach(container: EventTarget, host: IDragBackendHost): void {
    this.host = host
    container.addEventListener('dragstart', this.onDragStart as EventListener)
    container.addEventListener('dragover', this.onDragOver as EventListener)
    container.addEventListener('drop', this.onDrop as EventListener)
    container.addEventListener('dragend', this.onDragEnd as EventListener)
  }

  /** 解绑全部原生 DnD 事件并复位内部状态 */
  detach(container: EventTarget): void {
    container.removeEventListener(
      'dragstart',
      this.onDragStart as EventListener
    )
    container.removeEventListener('dragover', this.onDragOver as EventListener)
    container.removeEventListener('drop', this.onDrop as EventListener)
    container.removeEventListener('dragend', this.onDragEnd as EventListener)
    this.dragging = false
    this.dropped = false
    this.transparentImage = null
    this.host = null
  }

  /** 惰性获取 1x1 透明拖影图片 */
  private getTransparentImage(): HTMLImageElement | null {
    if (typeof document === 'undefined') return null
    if (!this.transparentImage) {
      const image = new Image()
      // 1x1 透明 GIF，base64 内联，避免额外网络请求
      image.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      this.transparentImage = image
    }
    return this.transparentImage
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
    this.dropped = false
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      // 设置透明拖影，彻底隐藏浏览器默认拖影，避免与虚拟预览层重叠
      const transparent = this.getTransparentImage()
      if (transparent && event.dataTransfer.setDragImage) {
        event.dataTransfer.setDragImage(transparent, 0, 0)
      }
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
    // 先标记已落点，再派发；随后到来的 dragend 据此不再派发取消
    this.dropped = true
    const signal = this.buildSignal(event)
    if (signal) this.host.dispatchDrop(signal)
    this.dragging = false
  }

  private onDragEnd = (event: DragEvent): void => {
    if (!this.host) return
    // drop 与 dragend 互斥：已落点则本次拖拽已在 drop 中收尾，直接复位
    if (this.dropped) {
      this.dropped = false
      this.dragging = false
      return
    }
    if (!this.dragging) return
    // 未经过 drop（如拖到无效区域松开），视为取消
    const signal = this.buildSignal(event)
    if (signal) this.host.dispatchCancel(signal)
    this.dragging = false
  }
}
