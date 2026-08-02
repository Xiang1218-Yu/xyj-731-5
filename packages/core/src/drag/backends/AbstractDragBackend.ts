/**
 * @file 拖拽后端抽象基类
 *
 * 重构思路：
 * 1. 策略模式核心：定义统一的拖拽后端接口 IDragBackend
 * 2. 不同的后端实现（Html5DragBackend、PointerDragBackend）
 *    只需实现此接口，DragEngine 无需关心底层事件来源
 * 3. 后端只负责事件捕获和转换，不包含业务逻辑
 * 4. 后端将原始DOM事件转换为统一的拖拽事件，通过事件总线上报
 *
 * 多容器支持：
 * - 设计器画布可能运行在 iframe（沙箱模式）中，事件需要跨容器监听
 * - attach/detach 支持多次调用，维护容器集合
 * - 拖拽开始时，在所有容器上绑定 move/up 事件（等价于旧版 batchAddEventListener）
 */

import type {
  DragBackendOptions,
  DragBackendType,
  DragContainer,
  IDragEventBus,
} from '../types'

/**
 * 拖拽后端抽象基类
 *
 * 提供通用的工具方法、多容器管理和默认配置，具体后端继承此类
 */
export abstract class AbstractDragBackend {
  /** 事件总线 */
  protected eventBus: IDragEventBus

  /** 后端配置 */
  protected options: Required<DragBackendOptions>

  /** 已激活的容器集合（支持顶层 document + 多个 iframe） */
  protected containers: Set<DragContainer> = new Set()

  /** DOM属性名配置 */
  protected attrNames: NonNullable<DragBackendOptions['attrNames']>

  /** 拖拽是否正在进行 */
  protected dragging = false

  constructor(eventBus: IDragEventBus, options?: DragBackendOptions) {
    this.eventBus = eventBus
    this.attrNames = {
      sourceId: 'data-designer-source-id',
      nodeId: 'data-designer-node-id',
      outlineNodeId: 'data-designer-outline-node-id',
      nodeDragHandler: 'data-designer-node-drag-handler',
      nodeSelectionId: 'data-designer-node-helpers-id',
      ...options?.attrNames,
    }
    this.options = {
      dragThreshold: 4,
      dragDelay: 10,
      enableRightClick: false,
      preventDefault: true,
      ...options,
      attrNames: this.attrNames,
    }
  }

  /**
   * 后端类型标识
   */
  abstract get type(): DragBackendType

  /**
   * 激活后端，在指定容器上绑定事件
   * 支持多次调用，每个容器（document/iframe）独立绑定 mousedown
   */
  attach(container: DragContainer): void {
    if (this.containers.has(container)) return
    this.containers.add(container)
    this.addStartListener(container)
  }

  /**
   * 停用后端，移除指定容器上的事件
   * 若不传 container，则移除所有容器
   */
  detach(container?: DragContainer): void {
    if (container) {
      this.removeStartListener(container)
      this.containers.delete(container)
    } else {
      this.containers.forEach((c) => this.removeStartListener(c))
      this.containers.clear()
    }
    if (this.containers.size === 0) {
      this.removeDragListeners()
      this.dragging = false
    }
  }

  /**
   * 在容器上绑定拖拽起始事件（mousedown/pointerdown）
   * 由子类实现
   */
  protected abstract addStartListener(container: DragContainer): void

  /**
   * 从容器移除拖拽起始事件
   * 由子类实现
   */
  protected abstract removeStartListener(container: DragContainer): void

  /**
   * 在所有容器上绑定拖拽中的事件（mousemove/mouseup等）
   * 拖拽开始时调用，确保跨 iframe 也能接收事件
   */
  protected abstract addDragListeners(): void

  /**
   * 从所有容器移除拖拽中的事件
   */
  protected abstract removeDragListeners(): void

  /**
   * 设置拖拽阈值
   */
  setThreshold(distance: number, delay: number): void {
    this.options.dragThreshold = distance
    this.options.dragDelay = delay
  }

  /**
   * 判断事件目标是否为可编辑区域（不应触发拖拽）
   */
  protected isEditableTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null
    if (!element) return false
    if (element.isContentEditable) return true
    if (element.getAttribute?.('contenteditable') === 'true') return true
    if (element.closest?.('.monaco-editor')) return true
    return false
  }

  /**
   * 判断事件目标是否为拖拽手柄
   */
  isDragHandle(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null
    if (!element || !element.closest) return false
    return !!element.closest(`[${this.attrNames.nodeDragHandler}]`)
  }

  /**
   * 判断目标是否可拖拽，返回拖拽信息
   */
  isDraggable(target: EventTarget | null): {
    draggable: boolean
    nodeId?: string
    sourceId?: string
  } {
    const element = target as HTMLElement | null
    if (!element || !element.closest) {
      return { draggable: false }
    }

    const nodeEl = element.closest(
      `[${this.attrNames.nodeId}], [${this.attrNames.outlineNodeId}]`
    ) as HTMLElement | null
    if (nodeEl) {
      const nodeId =
        nodeEl.getAttribute(this.attrNames.nodeId) ||
        nodeEl.getAttribute(this.attrNames.outlineNodeId) ||
        undefined
      return { draggable: true, nodeId }
    }

    const sourceEl = element.closest(
      `[${this.attrNames.sourceId}]`
    ) as HTMLElement | null
    if (sourceEl) {
      const sourceId =
        sourceEl.getAttribute(this.attrNames.sourceId) || undefined
      return { draggable: true, sourceId }
    }

    return { draggable: false }
  }

  /**
   * 计算两点间的欧几里得距离
   */
  protected calcDistance(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2))
  }

  /**
   * 判断拖拽阈值是否已达到
   */
  protected isDragThresholdReached(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
    startTime: number
  ): boolean {
    const distance = this.calcDistance(startX, startY, currentX, currentY)
    const timeDelta = Date.now() - startTime
    return (
      timeDelta > this.options.dragDelay && distance > this.options.dragThreshold
    )
  }

  /**
   * 遍历所有容器执行操作
   */
  protected forEachContainer(fn: (container: DragContainer) => void): void {
    this.containers.forEach(fn)
  }

  /**
   * 安全地为容器添加事件监听
   */
  protected addListener(
    container: DragContainer,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    container.addEventListener(type, listener, options)
  }

  /**
   * 安全地为容器移除事件监听
   */
  protected removeListener(
    container: DragContainer,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void {
    container.removeEventListener(type, listener, options)
  }
}
