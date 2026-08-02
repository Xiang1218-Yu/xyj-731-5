/**
 * @file HTML5 鼠标事件拖拽后端
 *
 * 重构思路：
 * 1. 将原 DragDropDriver 中的鼠标事件捕获逻辑独立为 DragBackend
 * 2. 只负责底层事件监听和阈值判断，不包含任何业务逻辑
 * 3. 事件通过事件总线上报，由 DragEngine 统一处理
 * 4. 支持鼠标和原生HTML5 DnD事件，保持与原有行为一致
 * 5. 可被 PointerDragBackend 等其他后端替代，实现策略切换
 *
 * 多容器支持：
 * - mousedown 在每个容器（顶层document + iframe）上独立绑定
 * - 拖拽开始后，mousemove/mouseup 在所有容器上绑定，确保跨 iframe 不丢失事件
 * - 等价于旧版 batchAddEventListener 的跨容器批量监听机制
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
 * 拖拽开始时记录的初始状态
 */
interface DragStartState {
  startX: number
  startY: number
  startPageX: number
  startPageY: number
  startTime: number
  target: EventTarget | null
  view: Window | null
  nodeId: string | undefined
  sourceId: string | undefined
}

/**
 * HTML5鼠标事件拖拽后端
 */
export class Html5DragBackend extends AbstractDragBackend {
  /** 拖拽起始状态 */
  private startState: DragStartState | null = null

  /** 上一次移动事件的坐标，用于过滤重复事件 */
  private lastMoveX = 0
  private lastMoveY = 0

  /** 绑定的事件处理函数引用 */
  private readonly handleMouseDown = (e: MouseEvent) => this.onMouseDown(e)
  private readonly handleMouseMove = (e: MouseEvent) => this.onMouseMove(e)
  private readonly handleMouseUp = (e: MouseEvent) => this.onMouseUp(e)
  private readonly handleDragStart = (e: DragEvent) => this.onDragStart(e)
  private readonly handleDragOver = (e: DragEvent) => this.onDragOver(e)
  private readonly handleDragEnd = (e: DragEvent) => this.onDragEnd(e)
  private readonly handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
  }

  constructor(eventBus: IDragEventBus, options?: DragBackendOptions) {
    super(eventBus, options)
  }

  get type(): DragBackendType {
    return DragBackendType.Html5
  }

  /**
   * 在容器上绑定 mousedown
   */
  protected addStartListener(container: DragContainer): void {
    this.addListener(container, 'mousedown', this.handleMouseDown, true)
  }

  /**
   * 从容器移除 mousedown
   */
  protected removeStartListener(container: DragContainer): void {
    this.removeListener(container, 'mousedown', this.handleMouseDown, true)
  }

  /**
   * 在所有容器上绑定拖拽中的事件
   * 等价于旧版 batchAddEventListener 的跨容器批量绑定
   */
  protected addDragListeners(): void {
    this.forEachContainer((container) => {
      this.addListener(container, 'mousemove', this.handleMouseMove, true)
      this.addListener(container, 'mouseup', this.handleMouseUp, true)
      this.addListener(container, 'dragstart', this.handleDragStart, true)
      this.addListener(container, 'dragover', this.handleDragOver, true)
      this.addListener(container, 'dragend', this.handleDragEnd, true)
      this.addListener(
        container,
        'contextmenu',
        this.handleContextMenu,
        true
      )
    })
  }

  /**
   * 从所有容器移除拖拽中的事件
   */
  protected removeDragListeners(): void {
    this.forEachContainer((container) => {
      this.removeListener(container, 'mousemove', this.handleMouseMove, true)
      this.removeListener(container, 'mouseup', this.handleMouseUp, true)
      this.removeListener(container, 'dragstart', this.handleDragStart, true)
      this.removeListener(container, 'dragover', this.handleDragOver, true)
      this.removeListener(container, 'dragend', this.handleDragEnd, true)
      this.removeListener(
        container,
        'contextmenu',
        this.handleContextMenu,
        true
      )
    })
  }

  /**
   * 鼠标按下处理
   */
  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return
    if (this.isEditableTarget(e.target)) return

    const draggableInfo = this.isDraggable(e.target)
    if (!draggableInfo.draggable) return

    this.startState = {
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

    // 在所有容器上绑定后续事件（跨 iframe）
    this.addDragListeners()
  }

  /**
   * 鼠标移动处理
   */
  private onMouseMove(e: MouseEvent): void {
    if (!this.startState) return

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
   * 鼠标抬起处理
   */
  private onMouseUp(e: MouseEvent): void {
    if (this.dragging) {
      this.emitDragEnd(e, false)
    }
    this.reset()
  }

  /**
   * 原生HTML5 dragstart
   */
  private onDragStart(e: DragEvent): void {
    if (this.dragging) return
    if (!this.startState) {
      // 没有 mousedown 记录但触发了 dragstart（可能来自外部）
      this.startState = {
        startX: e.clientX,
        startY: e.clientY,
        startPageX: e.pageX,
        startPageY: e.pageY,
        startTime: Date.now(),
        target: e.target,
        view: e.view,
        nodeId: undefined,
        sourceId: undefined,
      }
    }
    this.startDragging(e)
  }

  /**
   * 原生HTML5 dragover
   */
  private onDragOver(e: DragEvent): void {
    if (this.dragging) {
      e.preventDefault()
      this.emitDragMove(e)
    }
  }

  /**
   * 原生HTML5 dragend
   */
  private onDragEnd(e: DragEvent): void {
    if (this.dragging) {
      this.emitDragEnd(e, false)
    }
    this.reset()
  }

  /**
   * 正式开始拖拽
   */
  private startDragging(e: MouseEvent | DragEvent): void {
    if (!this.startState || this.dragging) return
    this.dragging = true

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

  /**
   * 上报拖拽移动
   */
  private emitDragMove(e: MouseEvent | DragEvent): void {
    const point = this.getTopLevelPoint(e)
    this.eventBus.emit('drag:move', {
      point,
      touchNode: null,
      originalEvent: e,
    })
  }

  /**
   * 上报拖拽结束
   */
  private emitDragEnd(
    e: MouseEvent | DragEvent,
    cancelled: boolean
  ): void {
    const point = this.getTopLevelPoint(e)
    this.eventBus.emit('drag:end', {
      endPoint: point,
      cancelled,
      originalEvent: e,
    })
  }

  /**
   * 获取顶层窗口坐标（处理 iframe 坐标转换）
   */
  private getTopLevelPoint(e: MouseEvent | DragEvent): Point {
    const view = (e as MouseEvent).view || window
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

  /**
   * 重置状态
   */
  private reset(): void {
    this.removeDragListeners()
    this.startState = null
    this.dragging = false
    this.lastMoveX = 0
    this.lastMoveY = 0
  }
}
