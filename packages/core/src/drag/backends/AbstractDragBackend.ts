/**
 * @file 拖拽后端接口定义
 *
 * 重构思路：
 * 1. 策略模式核心：定义统一的拖拽后端接口 IDragBackend
 * 2. 不同的后端实现（Html5DragBackend、PointerDragBackend、TouchDragBackend）
 *    只需实现此接口，DragEngine 无需关心底层事件来源
 * 3. 后端只负责事件捕获和转换，不包含业务逻辑
 * 4. 后端将原始DOM事件转换为统一的拖拽事件，通过事件总线上报
 */

import type {
  DragBackendOptions,
  DragBackendType,
  IDragEventBus,
} from '../types'

/**
 * 拖拽后端抽象基类
 *
 * 提供通用的工具方法和默认配置，具体后端继承此类
 */
export abstract class AbstractDragBackend {
  /** 事件总线 */
  protected eventBus: IDragEventBus

  /** 后端配置 */
  protected options: Required<DragBackendOptions>

  /** 事件容器 */
  protected container: HTMLElement | Document | null = null

  /** 是否已激活 */
  protected active: boolean = false

  /** DOM属性名配置 */
  protected attrNames: NonNullable<DragBackendOptions['attrNames']>

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
   * 激活后端，绑定事件监听
   */
  abstract activate(container: HTMLElement | Document): void

  /**
   * 停用后端，移除事件监听
   */
  abstract deactivate(): void

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
    // 排除 Monaco 编辑器
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
   *
   * 查找顺序：
   * 1. 画布节点 data-designer-node-id
   * 2. 大纲节点 data-designer-outline-node-id
   * 3. 拖拽源 data-designer-source-id
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
    return timeDelta > this.options.dragDelay && distance > this.options.dragThreshold
  }

  /**
   * 销毁时清理
   */
  protected cleanup(): void {
    this.container = null
    this.active = false
  }
}
