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
 *    2. 支持 setPointerCapture，在指针移出浏览器窗口时仍能持续接收事件，
 *       拖拽更跟手；
 *    3. 可被测试环境用伪事件完整模拟。
 *
 *  策略模式：本类是 IDragBackend 的一个具体策略，引擎可在运行时替换为
 *           Html5DragBackend 或自定义实现。
 * ============================================================================
 */

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

export class PointerDragBackend implements IDragBackend {
  readonly type: DragBackendType = 'Pointer'

  /** 事件绑定的根容器。 */
  private container: HTMLElement | Document | null = null

  /** 引擎宿主。 */
  private host: IDragBackendHost | null = null

  /** 当前按下的指针 id，用于保证多指 / 多设备场景只跟踪一根指针。 */
  private activePointerId: number | null = null

  /** 拖拽过程中临时屏蔽系统右键菜单。 */
  private onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  /** 处理指针按下：仅响应主键（鼠标左键 / 触摸接触）。 */
  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (event.ctrlKey || event.metaKey) return
    // 跳过可编辑区域，避免干扰原地编辑。
    const target = event.target as HTMLElement | null
    if (target) {
      if (target.isContentEditable) return
      if (target.getAttribute?.('contenteditable') === 'true') return
      if (target.closest?.('.monaco-editor')) return
    }

    this.activePointerId = event.pointerId
    // 捕获指针，确保后续 move/up 不丢失。
    const captureTarget = event.currentTarget as Element | null
    if (captureTarget && 'setPointerCapture' in captureTarget) {
      try {
        captureTarget.setPointerCapture(event.pointerId)
      } catch {
        // 某些元素（如 document）不支持 setPointerCapture，忽略即可。
      }
    }

    this.host?.onBackendPointerDown(
      normalizePointerEvent(event as NativePointerLike)
    )

    // 在 window 上监听 move/up，保证拖出容器后仍能继续。
    window.addEventListener(POINTER_MOVE, this.onPointerMove as EventListener, {
      passive: false,
    })
    window.addEventListener(POINTER_UP, this.onPointerUp as EventListener)
    window.addEventListener(
      POINTER_CANCEL,
      this.onPointerUp as EventListener
    )
    window.addEventListener(CONTEXT_MENU, this.onContextMenu, {
      capture: true,
    })
  }

  /** 处理指针移动。 */
  private onPointerMove = (event: PointerEvent): void => {
    if (
      this.activePointerId !== null &&
      event.pointerId !== this.activePointerId
    ) {
      return
    }
    // 拖拽过程中阻止默认行为（如文本选中、图片原生拖拽）。
    if (this.activePointerId !== null) {
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
    const captureTarget = event.currentTarget as Element | null
    if (
      captureTarget &&
      'releasePointerCapture' in captureTarget &&
      this.activePointerId !== null
    ) {
      try {
        captureTarget.releasePointerCapture(this.activePointerId)
      } catch {
        // 忽略释放失败。
      }
    }
    this.activePointerId = null

    this.host?.onBackendPointerUp(
      normalizePointerEvent(event as NativePointerLike)
    )

    window.removeEventListener(
      POINTER_MOVE,
      this.onPointerMove as EventListener
    )
    window.removeEventListener(POINTER_UP, this.onPointerUp as EventListener)
    window.removeEventListener(
      POINTER_CANCEL,
      this.onPointerUp as EventListener
    )
    window.removeEventListener(CONTEXT_MENU, this.onContextMenu, {
      capture: true,
    } as EventListenerOptions)
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
    window.removeEventListener(
      POINTER_MOVE,
      this.onPointerMove as EventListener
    )
    window.removeEventListener(POINTER_UP, this.onPointerUp as EventListener)
    window.removeEventListener(
      POINTER_CANCEL,
      this.onPointerUp as EventListener
    )
    window.removeEventListener(CONTEXT_MENU, this.onContextMenu, {
      capture: true,
    } as EventListenerOptions)
    this.container = null
    this.host = null
    this.activePointerId = null
  }
}
