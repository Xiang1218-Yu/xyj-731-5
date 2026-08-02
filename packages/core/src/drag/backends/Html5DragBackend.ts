/**
 * @file HTML5 鼠标事件拖拽后端
 *
 * 重构思路：
 * 1. 将原 DragDropDriver 中的鼠标事件捕获逻辑独立为 DragBackend
 * 2. 只负责底层事件监听和阈值判断，不包含任何业务逻辑
 * 3. 事件通过事件总线上报，由 DragEngine 统一处理
 * 4. 支持鼠标和原生HTML5 DnD事件，保持与原有行为一致
 * 5. 可被 PointerDragBackend 等其他后端替代，实现策略切换
 */

import { Point } from '@designable/shared'
import { DragBackendType, DragSourceType } from '../types'
import type {
  DragBackendOptions,
  IDragEventBus,
} from '../types'
import { AbstractDragBackend } from './AbstractDragBackend'

/**
 * 拖拽开始时记录的初始状态
 */
interface DragStartState {
  /** 鼠标按下时的X坐标 */
  startX: number
  /** 鼠标按下时的Y坐标 */
  startY: number
  /** 鼠标按下时的页面X坐标 */
  startPageX: number
  /** 鼠标按下时的页面Y坐标 */
  startPageY: number
  /** 鼠标按下的时间戳 */
  startTime: number
  /** 起始事件目标 */
  target: EventTarget | null
  /** 起始视图窗口（用于iframe坐标转换） */
  view: Window | null
  /** 命中的节点ID */
  nodeId: string | undefined
  /** 命中的拖拽源ID */
  sourceId: string | undefined
}

/**
 * HTML5鼠标事件拖拽后端
 *
 * 处理流程：
 * 1. mousedown -> 记录起始状态，开始监听 mousemove/mouseup
 * 2. mousemove -> 判断是否超过拖拽阈值，超过则触发 drag:start
 * 3. 拖拽中持续触发 drag:move
 * 4. mouseup -> 触发 drag:end
 *
 * 同时兼容原生HTML5 dragstart/dragover/dragend事件
 */
export class Html5DragBackend extends AbstractDragBackend {
  /** 拖拽起始状态 */
  private startState: DragStartState | null = null

  /** 是否正在拖拽 */
  private dragging: boolean = false

  /** 上一次移动事件的坐标，用于过滤重复事件 */
  private lastMoveX: number = 0
  private lastMoveY: number = 0

  /** 绑定的事件处理函数引用（用于移除监听） */
  private boundMouseDown: (e: MouseEvent) => void
  private boundMouseMove: (e: MouseEvent) => void
  private boundMouseUp: (e: MouseEvent) => void
  private boundDragStart: (e: DragEvent) => void
  private boundDragOver: (e: DragEvent) => void
  private boundDragEnd: (e: DragEvent) => void
  private boundContextMenu: (e: MouseEvent) => void

  constructor(eventBus: IDragEventBus, options?: DragBackendOptions) {
    super(eventBus, options)
    this.boundMouseDown = this.onMouseDown.bind(this)
    this.boundMouseMove = this.onMouseMove.bind(this)
    this.boundMouseUp = this.onMouseUp.bind(this)
    this.boundDragStart = this.onDragStart.bind(this)
    this.boundDragOver = this.onDragOver.bind(this)
    this.boundDragEnd = this.onDragEnd.bind(this)
    this.boundContextMenu = this.onContextMenu.bind(this)
  }

  /**
   * 后端类型
   */
  get type(): DragBackendType {
    return DragBackendType.Html5
  }

  /**
   * 激活后端
   * 在document上监听mousedown事件
   */
  activate(container: HTMLElement | Document): void {
    if (this.active) return
    this.container = container
    this.active = true
    container.addEventListener('mousedown', this.boundMouseDown, true)
  }

  /**
   * 停用后端
   * 移除所有事件监听
   */
  deactivate(): void {
    if (!this.active || !this.container) return
    this.removeDragListeners()
    this.container.removeEventListener('mousedown', this.boundMouseDown, true)
    this.cleanup()
  }

  /**
   * 鼠标按下处理
   * 记录起始状态，添加移动和抬起监听
   */
  private onMouseDown(e: MouseEvent): void {
    // 只处理左键，忽略Ctrl/Cmd+点击（多选场景）
    if (e.button !== 0 || e.ctrlKey || e.metaKey) {
      return
    }

    // 忽略可编辑区域
    if (this.isEditableTarget(e.target)) {
      return
    }

    const draggableInfo = this.isDraggable(e.target)
    if (!draggableInfo.draggable) {
      return
    }

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

    // 监听后续事件
    document.addEventListener('mousemove', this.boundMouseMove, true)
    document.addEventListener('mouseup', this.boundMouseUp, true)
    document.addEventListener('dragstart', this.boundDragStart, true)
  }

  /**
   * 鼠标移动处理
   * 在未正式开始拖拽前判断阈值，开始后持续上报move事件
   */
  private onMouseMove(e: MouseEvent): void {
    if (!this.startState) return

    // 过滤相同坐标的重复事件
    if (e.clientX === this.lastMoveX && e.clientY === this.lastMoveY) {
      return
    }
    this.lastMoveX = e.clientX
    this.lastMoveY = e.clientY

    if (!this.dragging) {
      // 判断是否达到拖拽阈值
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
      // 拖拽中，上报移动事件
      this.emitDragMove(e)
    }
  }

  /**
   * 鼠标抬起处理
   * 如果正在拖拽，上报结束事件
   */
  private onMouseUp(e: MouseEvent): void {
    if (this.dragging) {
      this.emitDragEnd(e, false)
    }
    this.reset()
  }

  /**
   * 原生HTML5 dragstart事件处理
   * 兼容浏览器原生拖拽
   */
  private onDragStart(e: DragEvent): void {
    if (this.dragging) return
    if (!this.startState) {
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
   * 原生HTML5 dragover事件处理
   */
  private onDragOver(e: DragEvent): void {
    if (this.dragging) {
      e.preventDefault()
      this.emitDragMove(e)
    }
  }

  /**
   * 原生HTML5 dragend事件处理
   */
  private onDragEnd(e: DragEvent): void {
    if (this.dragging) {
      this.emitDragEnd(e, false)
    }
    this.reset()
  }

  /**
   * 拖拽时阻止右键菜单
   */
  private onContextMenu(e: MouseEvent): void {
    e.preventDefault()
  }

  /**
   * 正式开始拖拽
   * 内部方法，由阈值判断或dragstart触发
   */
  private startDragging(e: MouseEvent | DragEvent): void {
    if (!this.startState || this.dragging) return

    this.dragging = true

    // 添加拖拽中的事件监听
    document.addEventListener('dragover', this.boundDragOver, true)
    document.addEventListener('dragend', this.boundDragEnd, true)
    document.addEventListener('contextmenu', this.boundContextMenu, true)

    const point = this.getTopLevelPoint(e)

    // 通过事件总线上报拖拽开始
    // 注意：dragNodes由DragEngine在接收到事件后查询并填充
    this.eventBus.emit('drag:prepare', {
      dragNodes: [],
      sourceType: this.startState.sourceId
        ? DragSourceType.Resource
        : DragSourceType.Node,
      startPoint: point,
      originalEvent: e,
    })
  }

  /**
   * 上报拖拽移动事件
   */
  private emitDragMove(e: MouseEvent | DragEvent): void {
    const point = this.getTopLevelPoint(e)
    this.eventBus.emit('drag:move', {
      point,
      touchNode: null, // 由DragEngine负责查找
      originalEvent: e,
    })
  }

  /**
   * 上报拖拽结束事件
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
   * 获取顶层窗口坐标
   * 处理iframe内坐标转换，逻辑与原AbstractCursorEvent保持一致
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
   * 移除拖拽阶段的事件监听
   */
  private removeDragListeners(): void {
    document.removeEventListener('mousemove', this.boundMouseMove, true)
    document.removeEventListener('mouseup', this.boundMouseUp, true)
    document.removeEventListener('dragstart', this.boundDragStart, true)
    document.removeEventListener('dragover', this.boundDragOver, true)
    document.removeEventListener('dragend', this.boundDragEnd, true)
    document.removeEventListener('contextmenu', this.boundContextMenu, true)
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
