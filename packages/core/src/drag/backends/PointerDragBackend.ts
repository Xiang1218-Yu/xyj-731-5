/**
 * @file Pointer Events 拖拽后端
 *
 * 重构思路：
 * 1. 基于W3C Pointer Events标准，统一处理鼠标、触摸、触控笔
 * 2. 使用setPointerCapture实现精确的拖拽捕获，避免HTML5 DnD的不一致问题
 * 3. 作为Html5DragBackend的现代替代方案，可通过配置切换
 * 4. 同样只负责事件捕获，业务逻辑由DragEngine处理
 *
 * 多容器支持：
 * - pointerdown 在每个容器上独立绑定
 * - 拖拽开始后，在所有容器上绑定 pointermove/pointerup
 */

import { Point } from '@designable/shared'
import { DragBackendType, DragSourceType } from '../types'
import type {
  DragBackendOptions,
  DragContainer,
  IDragEventBus,
} from '../types'
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
 */
export class PointerDragBackend extends AbstractDragBackend {
  private startState: PointerDragStartState | null = null

  private lastMoveX = 0
  private lastMoveY = 0

  private pointerCaptureTarget: HTMLElement | null = null

  private readonly handlePointerDown = (e: PointerEvent) => this.onPointerDown(e)
  private readonly handlePointerMove = (e: PointerEvent) => this.onPointerMove(e)
  private readonly handlePointerUp = (e: PointerEvent) => this.onPointerUp(e)
  private readonly handlePointerCancel = (e: PointerEvent) =>
    this.onPointerCancel(e)
  private readonly handleContextMenu = (e: MouseEvent) => {
    if (this.dragging) e.preventDefault()
  }

  constructor(eventBus: IDragEventBus, options?: DragBackendOptions) {
    super(eventBus, options)
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

  protected addStartListener(container: DragContainer): void {
    this.addListener(container, 'pointerdown', this.handlePointerDown, true)
  }

  protected removeStartListener(container: DragContainer): void {
    this.removeListener(container, 'pointerdown', this.handlePointerDown, true)
  }

  protected addDragListeners(): void {
    this.forEachContainer((container) => {
      this.addListener(container, 'pointermove', this.handlePointerMove, true)
      this.addListener(container, 'pointerup', this.handlePointerUp, true)
      this.addListener(
        container,
        'pointercancel',
        this.handlePointerCancel,
        true
      )
      this.addListener(
        container,
        'contextmenu',
        this.handleContextMenu,
        true
      )
    })
  }

  protected removeDragListeners(): void {
    this.forEachContainer((container) => {
      this.removeListener(
        container,
        'pointermove',
        this.handlePointerMove,
        true
      )
      this.removeListener(container, 'pointerup', this.handlePointerUp, true)
      this.removeListener(
        container,
        'pointercancel',
        this.handlePointerCancel,
        true
      )
      this.removeListener(
        container,
        'contextmenu',
        this.handleContextMenu,
        true
      )
    })
  }

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

    this.addDragListeners()
  }

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

  private onPointerUp(e: PointerEvent): void {
    if (!this.startState || e.pointerId !== this.startState.pointerId) return

    if (this.dragging) {
      this.emitDragEnd(e, false)
    }
    this.reset()
  }

  private onPointerCancel(e: PointerEvent): void {
    if (!this.startState || e.pointerId !== this.startState.pointerId) return
    if (this.dragging) {
      this.emitDragEnd(e, true)
    }
    this.reset()
  }

  /**
   * 开始拖拽
   */
  private startDragging(e: PointerEvent): void {
    if (!this.startState || this.dragging) return
    this.dragging = true

    const target = e.target as HTMLElement
    if (target && target.setPointerCapture) {
      try {
        target.setPointerCapture(e.pointerId)
        this.pointerCaptureTarget = target
      } catch {
        // setPointerCapture可能在某些元素上失败，忽略错误
      }
    }

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

  private reset(): void {
    this.releasePointerCapture()
    this.removeDragListeners()
    this.startState = null
    this.dragging = false
    this.lastMoveX = 0
    this.lastMoveY = 0
  }
}
