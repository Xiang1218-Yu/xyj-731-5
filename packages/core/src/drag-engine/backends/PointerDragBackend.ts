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
 *    类名保留 PointerDragBackend 仅为公共 API 的向后兼容（作为默认后端
 *    标识），实际事件源为鼠标事件。如需 Pointer Events / 触摸 / 测试 mock，
 *    可实现 IDragBackend 自行替换。
 *
 *  多窗口 / iframe 说明：
 *    设计器画布可能运行在 iframe 中。引擎会为顶层 document 与 iframe 的
 *    document 分别创建驱动实例（见 Event.attachEvents）。本后端：
 *      - mousedown 绑定在各自的容器上（由 attach 传入）；
 *      - 拖拽开始后，在源窗口 + 所有同源 iframe 的 contentWindow 上绑定
 *        mousemove/mouseup，覆盖「画布内拖拽」与「从顶层资源面板拖入 iframe
 *        画布」两种场景；
 *      - 用静态 isAnyTracking 标记保证同一根鼠标只有一个实例处理。
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

/** 拖拽期间扫描同源 iframe 的时间间隔（毫秒）。 */
const WINDOW_SCAN_INTERVAL = 200

export class PointerDragBackend implements IDragBackend {
  readonly type: DragBackendType = 'Pointer'

  /** 事件绑定的根容器。 */
  private container: HTMLElement | Document | null = null

  /** 引擎宿主。 */
  private host: IDragBackendHost | null = null

  /** 当前是否正在跟踪一次拖拽（按下后）。 */
  private tracking = false

  /** mousedown 发生的窗口（事件源头）。 */
  private sourceWindow: Window | null = null

  /** 当前正在监听 mousemove/mouseup 的所有窗口集合。 */
  private trackedWindows: Set<Window> = new Set()

  /** 扫描同源 iframe 的定时器。 */
  private scanTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 跨实例共享的「是否有实例正在跟踪拖拽」标记。
   * 引擎会为顶层 document 与每个 iframe document 各创建一个后端实例，
   * 用静态标记保证同一次鼠标拖拽只有一个实例响应。
   */
  private static isAnyTracking = false

  /** 拖拽过程中临时屏蔽系统右键菜单。 */
  private onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  /** 处理鼠标按下：仅响应主键（鼠标左键）。 */
  private onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return
    if (event.ctrlKey || event.metaKey) return
    // 已有其它实例在跟踪，当前实例不重复处理。
    if (PointerDragBackend.isAnyTracking) return

    // 跳过可编辑区域，避免干扰原地编辑。
    const target = event.target as HTMLElement | null
    if (target) {
      if (target.isContentEditable) return
      if (target.getAttribute?.('contenteditable') === 'true') return
      if (target.closest?.('.monaco-editor')) return
    }

    this.tracking = true
    PointerDragBackend.isAnyTracking = true

    const eventWindow = this.resolveEventWindow(event)
    this.sourceWindow = eventWindow

    this.host?.onBackendPointerDown(
      normalizePointerEvent(event as NativePointerLike)
    )

    // 开始监听：源窗口 + 当前可访问的同源子窗口。
    // 不使用 setPointerCapture / Pointer Events，避免隐式指针捕获导致
    // 跨 iframe 时子窗口接收不到 move 事件。
    this.startWindowTracking(eventWindow)
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

  /** 处理鼠标抬起。 */
  private onMouseUp = (event: MouseEvent): void => {
    if (!this.tracking) return

    this.host?.onBackendPointerUp(
      normalizePointerEvent(event as NativePointerLike)
    )

    this.stopWindowTracking()
    this.tracking = false
    PointerDragBackend.isAnyTracking = false
    this.sourceWindow = null
  }

  /* ---------------------------------------------------------------------- */
  /*                          多窗口跟踪逻辑                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * 在源窗口与所有同源子窗口上绑定 mousemove/mouseup，
   * 并启动定时器持续扫描新挂载的 iframe。
   */
  private startWindowTracking(sourceWindow: Window): void {
    this.stopWindowTracking()
    this.trackWindow(sourceWindow)
    this.attachChildWindows(sourceWindow)

    this.scanTimer = setInterval(() => {
      if (!this.sourceWindow) return
      this.attachChildWindows(this.sourceWindow)
    }, WINDOW_SCAN_INTERVAL)
  }

  /** 停止所有窗口监听并清理定时器。 */
  private stopWindowTracking(): void {
    if (this.scanTimer !== null) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }
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

  /**
   * 递归把源窗口下所有同源 iframe 的 contentWindow 纳入跟踪。
   * 跨域 iframe 访问 contentWindow 会抛异常，这里用 try/catch 静默跳过。
   */
  private attachChildWindows(win: Window): void {
    let frames: HTMLCollectionOf<HTMLIFrameElement>
    try {
      frames = win.document.getElementsByTagName('iframe')
    } catch {
      // 跨域文档不可访问，忽略。
      return
    }
    for (let i = 0; i < frames.length; i++) {
      const childWindow = frames[i].contentWindow
      if (!childWindow) continue
      try {
        // 访问同源标记以探测跨域；跨域访问会抛错。
        if (!childWindow.document) continue
      } catch {
        continue
      }
      this.trackWindow(childWindow)
      // 递归嵌套 iframe。
      this.attachChildWindows(childWindow)
    }
  }

  /**
   * 解析鼠标事件所在的 window。
   * MouseEvent.view 通常指向事件所在窗口，做防御性兜底。
   */
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
    this.container = container
    this.host = host
    container.addEventListener(
      MOUSE_DOWN,
      this.onMouseDown as EventListener,
      true
    )
  }

  detach(): void {
    if (this.container) {
      this.container.removeEventListener(
        MOUSE_DOWN,
        this.onMouseDown as EventListener,
        true
      )
    }
    this.stopWindowTracking()
    this.container = null
    this.host = null
    this.tracking = false
    PointerDragBackend.isAnyTracking = false
    this.sourceWindow = null
  }
}
