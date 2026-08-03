/**
 * ============================================================================
 *  PointerDragBackend —— 默认拖拽后端（内部基于 Mouse Events 实现）
 * ============================================================================
 *
 *  职责（单一职责原则）：
 *    仅负责「监听底层指针交互（mousedown / mousemove / mouseup）」，
 *    并把原生事件归一化后上报给引擎宿主（IDragBackendHost）。
 *    它不关心拖的是什么、放到哪里，也不维护会话状态。
 *
 *  为什么内部使用 Mouse Events 而不是 Pointer Events：
 *    Pointer Events 规范规定：在 pointerdown 之后浏览器会对目标元素建立
 *    「隐式指针捕获（implicit pointer capture）」。这会导致跨 iframe 拖拽时，
 *    指针进入子窗口后子窗口不再派发 pointermove（事件全部路由回按下时的源
 *    元素），表现为「能开始拖拽但移到画布上无法命中目标、无法放置」。
 *    Mouse Events 没有隐式捕获机制，鼠标进入 iframe 时子窗口会正常派发
 *    mousemove，这也是旧 DragDropDriver 长期验证可行的方案。
 *
 *  多容器 / iframe 架构（关键）：
 *    设计器会为顶层 document 与 iframe 的 contentDocument 各创建一个
 *    DragEngineDriver 实例。为了避免「每个 driver 各自 new 一个 DragEngine
 *    导致会话重复、drag:stop 触发多次」，DragEngine 与本后端都是单例，
 *    attach() 会被多次调用以把多个容器纳入监听：
 *      - mousedown 绑定在每个容器上；
 *      - 拖拽开始后，遍历所有已挂载容器，在各自的 defaultView（window）上
 *        绑定 mousemove/mouseup，从而同时覆盖顶层窗口与 iframe 窗口；
 *      - 任意窗口收到 mouseup 即结束会话，保证只触发一次。
 *
 *  策略模式：本类是 IDragBackend 的一个具体策略，引擎可在运行时替换为
 *           Html5DragBackend 或自定义实现。
 * ============================================================================
 */

import { globalThisPolyfill } from '@designable/shared'
import type {
  IDragBackend,
  IDragBackendHost,
  DragBackendType,
} from '../types'
import { normalizePointerEvent, type NativePointerLike } from '../coordinates'

/** 鼠标事件名常量，避免拼写错误。 */
const MOUSE_DOWN = 'mousedown'
const MOUSE_MOVE = 'mousemove'
const MOUSE_UP = 'mouseup'
const CONTEXT_MENU = 'contextmenu'

export class PointerDragBackend implements IDragBackend {
  readonly type: DragBackendType = 'Pointer'

  /** 所有挂载的容器（顶层 document + 各 iframe contentDocument）。 */
  private containers: Set<HTMLElement | Document> = new Set()

  /** 引擎宿主（所有容器共享同一个）。 */
  private host: IDragBackendHost | null = null

  /** 当前是否正在跟踪一次拖拽（按下后）。 */
  private tracking = false

  /** mousedown 发生的窗口。 */
  private sourceWindow: Window | null = null

  /** 当前正在监听 mousemove/mouseup 的所有窗口集合。 */
  private trackedWindows: Set<Window> = new Set()

  /** 拖拽过程中临时屏蔽系统右键菜单。 */
  private onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  /** 处理鼠标按下：仅响应主键（鼠标左键）。 */
  private onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return
    if (event.ctrlKey || event.metaKey) return
    // 已经在拖拽中，忽略其它容器的按下事件。
    if (this.tracking) return

    // 跳过可编辑区域，避免干扰原地编辑。
    const target = event.target as HTMLElement | null
    if (target) {
      if (target.isContentEditable) return
      if (target.getAttribute?.('contenteditable') === 'true') return
      if (target.closest?.('.monaco-editor')) return
    }

    this.tracking = true
    const eventWindow = this.resolveEventWindow(event)
    this.sourceWindow = eventWindow

    this.host?.onBackendPointerDown(
      normalizePointerEvent(event as NativePointerLike)
    )

    // 在所有已挂载容器对应的 window 上绑定 move/up。
    // 顶层资源在顶层窗口按下、拖入 iframe 时，iframe 窗口也能收到 move；
    // 画布内部按下时，源窗口本身也在集合内。
    this.startWindowTracking()
  }

  /** 处理鼠标移动。 */
  private onMouseMove = (event: MouseEvent): void => {
    if (!this.tracking) return
    // 阻止默认行为（文本选中、图片原生拖拽等）。
    event.preventDefault()
    this.host?.onBackendPointerMove(
      normalizePointerEvent(event as NativePointerLike)
    )
  }

  /** 处理鼠标抬起。任意跟踪窗口收到即结束（只触发一次）。 */
  private onMouseUp = (event: MouseEvent): void => {
    if (!this.tracking) return

    this.host?.onBackendPointerUp(
      normalizePointerEvent(event as NativePointerLike)
    )

    this.stopWindowTracking()
    this.tracking = false
    this.sourceWindow = null
  }

  /* ---------------------------------------------------------------------- */
  /*                          多窗口跟踪逻辑                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * 在所有已挂载容器对应的 window 上绑定 mousemove/mouseup。
   * 对于 iframe 容器，其 defaultView 即为 iframe.contentWindow；
   * 对于顶层 document，defaultView 为 window。
   */
  private startWindowTracking(): void {
    this.stopWindowTracking()
    this.containers.forEach((container) => {
      const win = this.containerToWindow(container)
      if (win) this.trackWindow(win)
    })
  }

  /** 停止所有窗口监听。 */
  private stopWindowTracking(): void {
    this.trackedWindows.forEach((win) => {
      this.detachWindowListeners(win)
    })
    this.trackedWindows.clear()
  }

  /** 在单个窗口上注册监听。 */
  private trackWindow(win: Window): void {
    if (this.trackedWindows.has(win)) return
    win.addEventListener(MOUSE_MOVE, this.onMouseMove as EventListener, {
      passive: false,
    })
    win.addEventListener(MOUSE_UP, this.onMouseUp as EventListener)
    win.addEventListener(CONTEXT_MENU, this.onContextMenu, {
      capture: true,
    })
    this.trackedWindows.add(win)
  }

  /** 移除单个窗口上的监听。 */
  private detachWindowListeners(win: Window): void {
    win.removeEventListener(MOUSE_MOVE, this.onMouseMove as EventListener)
    win.removeEventListener(MOUSE_UP, this.onMouseUp as EventListener)
    win.removeEventListener(CONTEXT_MENU, this.onContextMenu, {
      capture: true,
    } as EventListenerOptions)
  }

  /** 从容器解析其所属 window。 */
  private containerToWindow(
    container: HTMLElement | Document
  ): Window | null {
    if (container === document) {
      return typeof window !== 'undefined' ? window : null
    }
    const doc =
      container.nodeType === 9
        ? (container as Document)
        : container.ownerDocument
    return doc?.defaultView ?? null
  }

  /** 解析鼠标事件所在的 window。 */
  private resolveEventWindow(event: MouseEvent): Window {
    if (event.view) return event.view
    if (this.sourceWindow) return this.sourceWindow
    if (typeof window !== 'undefined') return window
    return globalThisPolyfill as unknown as Window
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'MouseEvent' in window
  }

  attach(
    container: HTMLElement | Document,
    host: IDragBackendHost
  ): void {
    if (this.containers.has(container)) return
    this.containers.add(container)
    // 所有容器共享同一个宿主（DragEngine 单例）。
    this.host = host
    container.addEventListener(
      MOUSE_DOWN,
      this.onMouseDown as EventListener,
      true
    )
  }

  detach(container?: HTMLElement | Document): void {
    if (!container) {
      // 解绑所有容器。
      this.containers.forEach((c) => {
        c.removeEventListener(
          MOUSE_DOWN,
          this.onMouseDown as EventListener,
          true
        )
      })
      this.containers.clear()
      this.stopWindowTracking()
      this.host = null
      this.tracking = false
      this.sourceWindow = null
      return
    }
    if (this.containers.has(container)) {
      container.removeEventListener(
        MOUSE_DOWN,
        this.onMouseDown as EventListener,
        true
      )
      this.containers.delete(container)
    }
  }
}
