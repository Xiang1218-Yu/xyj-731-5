/**
 * ============================================================================
 *  Html5DragBackend —— 基于原生 HTML5 Drag and Drop 的兼容后端
 * ============================================================================
 *
 *  背景：
 *    旧实现直接使用原生 HTML5 DnD（见历史 DragDropDriver），其问题是：
 *      - 拖拽预览（ghost image）由浏览器控制，在复杂布局 / iframe 下不一致；
 *      - dragover 事件触发频率与坐标在不同浏览器存在差异；
 *      - 无法方便地自定义拖拽阈值。
 *
 *  本后端把这些「不一致」封装在策略内部，对上层引擎统一上报
 *  onBackendPointerDown / Move / Up。它保留与外部 DnD（例如从操作系统
 *  拖入文件、与第三方可拖拽区域互操作）的能力，但预览交给引擎的
 *  VirtualPreviewRenderer 接管，从而屏蔽浏览器差异。
 *
 *  注意：HTML5 DnD 没有真正的 pointerdown，dragstart 即视为拖拽开始。
 *
 *  事件顺序（重要）：
 *    原生规范保证：成功放置时触发顺序为 drop -> dragend；
 *    未成功放置（拖到无效区域 / 按 ESC）时只触发 dragend。
 *    为了避免 drop 与 dragend 重复调用 host.onBackendPointerUp 导致
 *    会话被结束两次，本实现统一在 dragend 中上报 Up；
 *    drop 仅做 preventDefault 并记录「已放置」标记。
 * ============================================================================
 */

import type {
  IDragBackend,
  IDragBackendHost,
  DragBackendType,
} from '../types'
import { normalizePointerEvent, type NativePointerLike } from '../coordinates'

const DRAG_START = 'dragstart'
const DRAG_OVER = 'dragover'
const DRAG_END = 'dragend'
const DROP = 'drop'

export class Html5DragBackend implements IDragBackend {
  readonly type: DragBackendType = 'Html5'

  /** 所有挂载的容器（支持顶层 document + iframe）。 */
  private containers: Set<HTMLElement | Document> = new Set()

  /** 引擎宿主（所有容器共享同一个）。 */
  private host: IDragBackendHost | null = null
  private dragging = false
  /**
   * 标记本次拖拽是否触发了原生 drop。
   * 仅用于后端内部状态判断，引擎是否真正放置由 session.target 决定。
   */
  private dropped = false

  /**
   * 用于制造一个透明的拖拽图像，以屏蔽浏览器原生预览，
   * 让 VirtualPreviewRenderer 全权负责预览渲染。
   */
  private transparentImage: HTMLCanvasElement | null = null

  private getTransparentImage(): HTMLCanvasElement {
    if (!this.transparentImage) {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      context?.clearRect(0, 0, 1, 1)
      this.transparentImage = canvas
    }
    return this.transparentImage
  }

  private onDragStart = (event: DragEvent): void => {
    this.dragging = true
    this.dropped = false
    const pointer = normalizePointerEvent(event as NativePointerLike)
    this.host?.onBackendPointerDown(pointer)

    // 屏蔽原生 ghost image，交由虚拟预览渲染器显示统一预览。
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      try {
        event.dataTransfer.setDragImage(this.getTransparentImage(), 0, 0)
      } catch {
        // 部分浏览器（如旧版 Safari）对 setDragImage 支持有限，忽略。
      }
    }

    // HTML5 DnD 不会派发 mousemove，这里在 dragover 中持续上报 move。
    window.addEventListener(DRAG_OVER, this.onDragOver as EventListener)
    window.addEventListener(DROP, this.onDrop as EventListener)
    window.addEventListener(DRAG_END, this.onDragEnd as EventListener)
  }

  private onDragOver = (event: DragEvent): void => {
    if (!this.dragging) return
    // 必须阻止默认行为，否则浏览器不会触发 drop。
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    this.host?.onBackendPointerMove(
      normalizePointerEvent(event as NativePointerLike)
    )
  }

  private onDrop = (event: DragEvent): void => {
    // 这里不能调用 host.onBackendPointerUp，否则会与紧随其后的 dragend
    // 造成重复结束会话。仅阻止默认行为并记录已 drop 即可。
    event.preventDefault()
    this.dropped = true
  }

  private onDragEnd = (event: DragEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    const wasDropped = this.dropped
    this.dropped = false

    // 统一在 dragend 中上报一次 Up。
    // 无论是否成功 drop（drop 事件可能不触发），dragend 都会触发，
    // 因此这里是结束会话最可靠的时机。
    const pointer = normalizePointerEvent(event as NativePointerLike)
    this.host?.onBackendPointerUp(pointer)

    window.removeEventListener(DRAG_OVER, this.onDragOver as EventListener)
    window.removeEventListener(DROP, this.onDrop as EventListener)
    window.removeEventListener(DRAG_END, this.onDragEnd as EventListener)

    // 标记为未使用，保留 wasDropped 以便未来扩展（例如区分 dropEffect）。
    void wasDropped
  }

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'draggable' in document.createElement('div')
    )
  }

  attach(
    container: HTMLElement | Document,
    host: IDragBackendHost
  ): void {
    if (this.containers.has(container)) return
    this.containers.add(container)
    this.host = host
    container.addEventListener(
      DRAG_START,
      this.onDragStart as EventListener,
      true
    )
  }

  detach(container?: HTMLElement | Document): void {
    if (!container) {
      this.containers.forEach((c) => {
        c.removeEventListener(
          DRAG_START,
          this.onDragStart as EventListener,
          true
        )
      })
      this.containers.clear()
    } else if (this.containers.has(container)) {
      container.removeEventListener(
        DRAG_START,
        this.onDragStart as EventListener,
        true
      )
      this.containers.delete(container)
    }
    window.removeEventListener(DRAG_OVER, this.onDragOver as EventListener)
    window.removeEventListener(DROP, this.onDrop as EventListener)
    window.removeEventListener(DRAG_END, this.onDragEnd as EventListener)
    this.host = this.containers.size > 0 ? this.host : null
    this.dragging = false
    this.dropped = false
  }
}
