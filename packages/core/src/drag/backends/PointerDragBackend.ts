/**
 * @file Pointer Events 拖拽后端
 *
 * 重构思路：
 * 1. 基于W3C Pointer Events标准，统一处理鼠标、触摸、触控笔
 * 2. 使用setPointerCapture实现精确的拖拽捕获，避免HTML5 DnD的不一致问题
 * 3. 作为Html5DragBackend的现代替代方案，可通过配置切换
 * 4. 同样只负责事件捕获，业务逻辑由DragEngine处理
 */

import { Point } from '@designable/shared'
import { DragBackendType, DragSourceType } from '../types'
import type { DragBackendOptions, IDragEventBus } from '../types'
import { AbstractDragBackend } from './AbstractDragBackend'

/**
 * 拖拽起始状态
 */
interface PointerDragStartState {
  pointerId: number
  startX: number
  startY: number
  startPageX: number
  startPageY: number
  startTime: number
  target: EventTarget | null
  view: Window | null
  sourceId: string | undefined
  nodeId: string | undefined
}

/**
 * Pointer Events拖拽后端
 *
 * 优势：
 * - 统一处理鼠标和触摸输入
 * - setPointerCapture提供可靠的事件捕获
 * - 不依赖浏览器原生DnD，行为一致
 * - 支持多点触控（虽然拖拽通常只需要一个触点）
 */
export class PointerDragBackend extends AbstractDragBackend {
  private startState: PointerDragStartState | null = null
  private dragging = false
  private lastMoveX = 0
  private lastMoveY = 0
  private pointerCaptureTarget: HTMLElement | null = null

  private boundPointerDown: (e: PointerEvent) => void
  private boundPointerMove: (e: PointerEvent) => void
  private boundPointerUp: (e: PointerEvent) => void
  private boundPointerCancel: (e: PointerEvent) => void
  private boundContextMenu: (e: MouseEvent) => void

  constructor(eventBus: IDragEventBus, options?: DragBackendOptions) {
    super(eventBus, options)
    this.boundPointerDown = this.onPointerDown.bind(this)
    this.boundPointerMove = this.onPointerMove.bind(this)
    this.boundPointerUp = this.onPointerUp.bind(this)
    this.boundPointerCancel = this.onPointerCancel.bind(this)
    this.boundContextMenu = this.onContextMenu.bind(this)
  }

  get type(): DragBackendType {
    return DragBackendType.Pointer
  }

  /**
   * 检测浏览器是否支持Pointer Events
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'PointerEvent' in window
  }

  activate(container: HTMLElement | Document): void {
    if (this.active) return
    this.container = container
    this.active = true
    container.addEventListener('pointerdown', this.boundPointerDown, true)
  }

  deactivate(): void {
    if (!this.active || !this.container) return
    this.removeListeners()
    this.releasePointerCapture()
    this.container.removeEventListener(
      'pointerdown',
      this.boundPointerDown,
      true
    )
    this.cleanup()
  }

  /**
   * 指针按下
   */
  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return
    if (this.isEditableTarget(e.target)) return

    const draggableInfo = this.isDraggable(e.target)
    if (!draggableInfo.draggable) return

    this.startState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPageX: e.pageX,
      startPageY: e.pageY,
      startTime: Date.now(),
      target: e.target,
      view: e.view,
      nodeId: draggableInfo.nodeId,
      sourceId: draggableInfo.sourceId,
    }
    this.dragging = false
    this.lastMoveX = e.clientX
    this.lastMoveY = e.clientY

    document.addEventListener('pointermove', this.boundPointerMove, true)
    document.addEventListener('pointerup', this.boundPointerUp, true)
    document.addEventListener('pointercancel', this.boundPointerCancel, true)
  }

  /**
   * 指针移动
   */
  private onPointerMove(e: PointerEvent): void {
    if (!this.startState || e.pointerId !== this.startState.pointerId) return

    if (e.clientX === this.lastMoveX && e.clientY === this.lastMoveY) return
    this.lastMoveX = e.clientX
    this.lastMoveY = e.clientY

    if (!this.dragging) {
      if (
        this.isDragThresholdReached(
          this.startState.startX,
          this.startState.startY,
          e.clientX,
          e.clientY,
          this.startState.startTime
        )
      ) {
        this.startDragging(e)
      }
    } else {
      this.emitDragMove(e)
    }
  }

  /**
   * 指针抬起
   */
  private onPointerUp(e: PointerEvent): void {
    if (!this.startState || e.pointerId !== this.startState.pointerId) return

    if (this.dragging) {
      this.emitDragEnd(e, false)
    }
    this.reset()
  }

  /**
   * 指针取消（如系统中断）
   */
  private onPointerCancel(e: PointerEvent): void {
    if (!this.startState || e.pointerId !== this.startState.pointerId) return
    if (this.dragging) {
      this.emitDragEnd(e, true)
    }
    this.reset()
  }

  private onContextMenu(e: MouseEvent): void {
    if (this.dragging) {
      e.preventDefault()
    }
  }

  /**
   * 开始拖拽
   * 使用setPointerCapture捕获指针，确保拖拽过程中持续接收事件
   */
  private startDragging(e: PointerEvent): void {
    if (!this.startState || this.dragging) return

    this.dragging = true

    // 设置指针捕获
    const target = e.target as HTMLElement
    if (target && target.setPointerCapture) {
      try {
        target.setPointerCapture(e.pointerId)
        this.pointerCaptureTarget = target
      } catch {
        // setPointerCapture可能在某些元素上失败，忽略错误
      }
    }

    document.addEventListener('contextmenu', this.boundContextMenu, true)

    const point = this.getTopLevelPoint(e)
    this.eventBus.emit('drag:prepare', {
      dragNodes: [],
      sourceType: this.startState.sourceId
        ? DragSourceType.Resource
        : DragSourceType.Node,
      startPoint: point,
      originalEvent: e,
      startEventData: {
        clientX: this.startState.startX,
        clientY: this.startState.startY,
        pageX: this.startState.startPageX,
        pageY: this.startState.startPageY,
        target: this.startState.target,
        view: this.startState.view,
      },
    })
  }

  private emitDragMove(e: PointerEvent): void {
    const point = this.getTopLevelPoint(e)
    this.eventBus.emit('drag:move', {
      point,
      touchNode: null,
      originalEvent: e,
    })
  }

  private emitDragEnd(e: PointerEvent, cancelled: boolean): void {
    const point = this.getTopLevelPoint(e)
    this.eventBus.emit('drag:end', {
      endPoint: point,
      cancelled,
      originalEvent: e,
    })
  }

  /**
   * 获取顶层窗口坐标（处理iframe）
   */
  private getTopLevelPoint(e: PointerEvent): Point {
    const view = e.view || window
    const frameElement = view.frameElement as HTMLElement | null

    if (frameElement && view !== window) {
      const frameRect = frameElement.getBoundingClientRect()
      const scale = frameRect.width / frameElement.offsetWidth
      return new Point(
        e.clientX * scale + frameRect.x,
        e.clientY * scale + frameRect.y
      )
    }

    return new Point(e.clientX, e.clientY)
  }

  private releasePointerCapture(): void {
    if (this.pointerCaptureTarget && this.startState) {
      try {
        this.pointerCaptureTarget.releasePointerCapture(
          this.startState.pointerId
        )
      } catch {
        // 忽略释放错误
      }
      this.pointerCaptureTarget = null
    }
  }

  private removeListeners(): void {
    document.removeEventListener('pointermove', this.boundPointerMove, true)
    document.removeEventListener('pointerup', this.boundPointerUp, true)
    document.removeEventListener('pointercancel', this.boundPointerCancel, true)
    document.removeEventListener('contextmenu', this.boundContextMenu, true)
  }

  private reset(): void {
    this.releasePointerCapture()
    this.removeListeners()
    this.startState = null
    this.dragging = false
    this.lastMoveX = 0
    this.lastMoveY = 0
  }
}
