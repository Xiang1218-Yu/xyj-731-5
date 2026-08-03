/**
 * ============================================================================
 *  PointerDragBackend —— 基于 Pointer Events 的拖拽后端
 * ============================================================================
 *
 *  职责（单一职责原则）：
 *    仅负责「监听底层指针交互（pointerdown / pointermove / pointerup）」，
 *    并把原生事件归一化后上报给引擎宿主（IDragBackendHost）。
 *    它不关心拖的是什么、放到哪里，也不维护会话状态。
 *
 *  为什么默认使用 Pointer Events：
 *    1. 统一鼠标、触摸、触控笔输入，避免在复杂布局下 mousemove 与
 *       HTML5 drag 事件混用导致的行为不一致；
 *    2. 支持 setPointerCapture，在指针移出元素时仍能持续接收事件，拖拽更跟手；
 *    3. 可被测试环境用伪事件完整模拟。
 *
 *  多窗口 / iframe 说明：
 *    设计器画布可能运行在 iframe 中。引擎会为顶层 document 与 iframe 的
 *    document 分别创建驱动实例（见 Event.attachEvents）。本后端需要同时处理
 *    两种拖拽场景：
 *      A. 画布内部拖拽：pointerdown/move/up 都发生在 iframe 的 contentWindow；
 *      B. 跨窗口拖拽（从顶层资源面板拖入 iframe 画布）：pointerdown 发生在
 *         顶层 window，但指针进入 iframe 后顶层 window 不再接收 move/up。
 *
 *    解决方案：
 *      - pointerdown 所在窗口记为 sourceWindow，在其上绑定 move/up；
 *      - 拖拽期间通过定时扫描，把同源 iframe 的 contentWindow 也纳入监听，
 *        使指针进入子窗口后仍能持续上报 move；
 *      - 子窗口事件携带其自身的 view 坐标，由 coordinates 层统一换算到顶层；
 *      - 任意一个窗口收到 pointerup/cancel 即结束拖拽；
 *      - 用静态 activePointerId 保证同一根指针只有一个后端实例处理，避免重复。
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

/** Pointer 事件名常量，避免拼写错误。 */
const POINTER_DOWN = 'pointerdown'
const POINTER_MOVE = 'pointermove'
const POINTER_UP = 'pointerup'
const POINTER_CANCEL = 'pointercancel'
const CONTEXT_MENU = 'contextmenu'

/** 拖拽期间扫描 iframe 的时间间隔（毫秒）。 */
const WINDOW_SCAN_INTERVAL = 200

export class PointerDragBackend implements IDragBackend {
  readonly type: DragBackendType = 'Pointer'

  /** 事件绑定的根容器。 */
  private container: HTMLElement | Document | null = null

  /** 引擎宿主。 */
  private host: IDragBackendHost | null = null

  /** 当前按下的指针 id，用于保证多指 / 多设备场景只跟踪一根指针。 */
  private activePointerId: number | null = null

  /** pointerdown 发生的窗口（事件源头）。 */
  private sourceWindow: Window | null = null

  /** 当前正在监听 move/up 的所有窗口集合（含 sourceWindow 与桥接的子窗口）。 */
  private trackedWindows: Set<Window> = new Set()

  /** 扫描同源 iframe 的定时器。 */
  private scanTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 跨实例共享的「当前正在拖拽的指针 id」。
   * 引擎会为顶层 document 与每个 iframe document 各创建一个后端实例，
   * 用静态标记保证同一次拖拽只有一个实例响应。
   */
  private static activePointerId: number | null = null

  /** 拖拽过程中临时屏蔽系统右键菜单。 */
  private onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  /** 处理指针按下：仅响应主键（鼠标左键 / 触摸接触）。 */
  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (event.ctrlKey || event.metaKey) return
    // 已有其它实例在跟踪该指针，当前实例不重复处理。
    if (PointerDragBackend.activePointerId !== null) return

    // 跳过可编辑区域，避免干扰原地编辑。
    const target = event.target as HTMLElement | null
    if (target) {
      if (target.isContentEditable) return
      if (target.getAttribute?.('contenteditable') === 'true') return
      if (target.closest?.('.monaco-editor')) return
    }

    this.activePointerId = event.pointerId
    PointerDragBackend.activePointerId = event.pointerId

    const eventWindow = this.resolveEventWindow(event)
    this.sourceWindow = eventWindow

    // 注意：这里刻意不调用 setPointerCapture。
    // 指针捕获会把该次拖拽后续所有 pointermove/up 事件的 target 强制重定向
    // 到被捕获的「拖拽源元素」，导致拖拽目标解析器（IDragTargetResolver）
    // 永远拿不到指针下方真实的画布节点，表现为「拖得动但放不进画布」。
    // 事件的可靠接收已通过在源窗口及同源 iframe 上绑定 window 级监听保证，
    // 无需指针捕获。

    this.host?.onBackendPointerDown(
      normalizePointerEvent(event as NativePointerLike)
    )

    // 开始监听：源窗口 + 当前可访问的同源子窗口。
    this.startWindowTracking(eventWindow)
  }

  /** 处理指针移动。 */
  private onPointerMove = (event: PointerEvent): void => {
    if (
      this.activePointerId !== null &&
      event.pointerId !== this.activePointerId
    ) {
      return
    }
    if (this.activePointerId !== null) {
      // 阻止默认行为（文本选中、图片原生拖拽等）。
      event.preventDefault()
    }
    this.host?.onBackendPointerMove(
      normalizePointerEvent(event as NativePointerLike)
    )
  }

  /** 处理指针抬起 / 取消。 */
  private onPointerUp = (event: PointerEvent): void => {
    if (
      this.activePointerId !== null &&
      event.pointerId !== this.activePointerId
    ) {
      return
    }

    this.host?.onBackendPointerUp(
      normalizePointerEvent(event as NativePointerLike)
    )

    this.stopWindowTracking()
    this.activePointerId = null
    PointerDragBackend.activePointerId = null
    this.sourceWindow = null
  }

  /* ---------------------------------------------------------------------- */
  /*                          多窗口跟踪逻辑                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * 在源窗口与所有同源子窗口上绑定 move/up/cancel，
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
    win.addEventListener(
      POINTER_MOVE,
      this.onPointerMove as EventListener,
      { passive: false }
    )
    win.addEventListener(POINTER_UP, this.onPointerUp as EventListener)
    win.addEventListener(
      POINTER_CANCEL,
      this.onPointerUp as EventListener
    )
    win.addEventListener(CONTEXT_MENU, this.onContextMenu, {
      capture: true,
    })
    this.trackedWindows.add(win)
  }

  /** 移除单个窗口上的监听。 */
  private detachWindowListeners(win: Window): void {
    win.removeEventListener(
      POINTER_MOVE,
      this.onPointerMove as EventListener
    )
    win.removeEventListener(POINTER_UP, this.onPointerUp as EventListener)
    win.removeEventListener(
      POINTER_CANCEL,
      this.onPointerUp as EventListener
    )
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
   * 解析指针事件所在的 window。
   * PointerEvent.view 通常指向事件所在窗口，做防御性兜底。
   */
  private resolveEventWindow(event: PointerEvent): Window {
    if (event.view) return event.view
    if (this.sourceWindow) return this.sourceWindow
    if (typeof window !== 'undefined') return window
    return globalThisPolyfill as unknown as Window
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'PointerEvent' in window
  }

  attach(
    container: HTMLElement | Document,
    host: IDragBackendHost
  ): void {
    this.container = container
    this.host = host
    container.addEventListener(
      POINTER_DOWN,
      this.onPointerDown as EventListener,
      true
    )
  }

  detach(): void {
    if (this.container) {
      this.container.removeEventListener(
        POINTER_DOWN,
        this.onPointerDown as EventListener,
        true
      )
    }
    this.stopWindowTracking()
    this.container = null
    this.host = null
    this.activePointerId = null
    PointerDragBackend.activePointerId = null
    this.sourceWindow = null
  }
}
