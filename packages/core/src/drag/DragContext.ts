/**
 * @file 拖拽上下文
 *
 * 重构思路：
 * 1. 集中管理拖拽过程中的所有状态，替代原 MoveHelper 中分散的状态字段
 * 2. 状态变更通过 action 方法进行，确保状态流转的可控性
 * 3. 使用 @formily/reactive 实现响应式，与现有体系保持一致
 * 4. 状态与业务逻辑分离：DragContext 只管状态，不管节点计算和放置逻辑
 * 5. 不直接派发事件，事件通知由 DragEngine 统一协调（单一职责）
 */

import { observable, define, action } from '@formily/reactive'
import type { TreeNode } from '../models/TreeNode'
import type { IPoint } from '@designable/shared'
import { DragState, DragSourceType } from './types'
import type { DragContextState } from './types'

/**
 * 拖拽开始参数
 */
export interface StartDragParams {
  dragNodes: TreeNode[]
  sourceType: DragSourceType
  startPoint: IPoint
}

/**
 * 拖拽移动参数
 */
export interface UpdateDragParams {
  point: IPoint
  touchNode: TreeNode | null
  closestNode: TreeNode | null
}

/**
 * 拖拽上下文
 *
 * 职责：
 * - 维护拖拽生命周期状态（Idle/Prepare/Dragging/Dropping）
 * - 维护拖拽节点列表和位置信息
 * - 提供状态查询和变更的action方法
 *
 * 不负责：
 * - 事件派发（由 DragEngine 统一处理）
 * - 节点放置的具体逻辑（由 DragEngine 协调）
 * - DOM事件监听（由 DragBackend 处理）
 * - 预览渲染（由 DragPreview 处理）
 */
export class DragContext {
  /** 当前拖拽状态 */
  state: DragState = DragState.Idle

  /** 拖拽的节点列表 */
  dragNodes: TreeNode[] = []

  /** 拖拽源类型 */
  sourceType: DragSourceType = DragSourceType.Node

  /** 拖拽起始位置 */
  startPoint: IPoint | null = null

  /** 当前鼠标位置 */
  currentPoint: IPoint | null = null

  /** 当前触摸/悬停的节点 */
  touchNode: TreeNode | null = null

  /** 最近的可放置节点 */
  closestNode: TreeNode | null = null

  /** 拖拽开始时间戳 */
  startTime: number = 0

  constructor() {
    this.makeObservable()
  }

  /**
   * 是否正在拖拽中
   */
  get isDragging(): boolean {
    return (
      this.state === DragState.Dragging ||
      this.state === DragState.Prepare ||
      this.state === DragState.Dropping
    )
  }

  /**
   * 是否有拖拽节点
   */
  get hasDragNodes(): boolean {
    return this.dragNodes.length > 0
  }

  /**
   * 获取当前状态快照（不可变）
   * 用于需要整体读取状态的场景
   */
  getState(): Readonly<DragContextState> {
    return {
      state: this.state,
      dragNodes: [...this.dragNodes],
      sourceType: this.sourceType,
      startPoint: this.startPoint ? { ...this.startPoint } : null,
      currentPoint: this.currentPoint ? { ...this.currentPoint } : null,
      touchNode: this.touchNode,
      closestNode: this.closestNode,
      startTime: this.startTime,
    }
  }

  /**
   * 开始拖拽
   * 1. 校验参数
   * 2. 更新状态
   */
  startDrag(params: StartDragParams): void {
    const { dragNodes, sourceType, startPoint } = params

    if (!dragNodes.length) {
      return
    }

    this.state = DragState.Dragging
    this.dragNodes = dragNodes
    this.sourceType = sourceType
    this.startPoint = { ...startPoint }
    this.currentPoint = { ...startPoint }
    this.touchNode = null
    this.closestNode = null
    this.startTime = Date.now()
  }

  /**
   * 更新拖拽位置信息
   * 在拖拽移动过程中持续调用
   */
  updateDrag(params: UpdateDragParams): void {
    if (this.state !== DragState.Dragging) {
      return
    }

    const { point, touchNode, closestNode } = params
    this.currentPoint = { ...point }
    this.touchNode = touchNode
    this.closestNode = closestNode
  }

  /**
   * 准备放置
   * 状态从 Dragging 转为 Dropping
   */
  prepareDrop(): void {
    if (this.state === DragState.Dragging) {
      this.state = DragState.Dropping
    }
  }

  /**
   * 结束拖拽
   * 清空所有拖拽状态，回到 Idle
   */
  endDrag(): void {
    this.state = DragState.Idle
    this.dragNodes = []
    this.sourceType = DragSourceType.Node
    this.startPoint = null
    this.currentPoint = null
    this.touchNode = null
    this.closestNode = null
    this.startTime = 0
  }

  /**
   * 取消拖拽
   * 等价于 endDrag()，语义化方法
   */
  cancelDrag(): void {
    this.endDrag()
  }

  /**
   * 设置响应式观察
   * 使用 @formily/reactive 的 observable/action
   */
  private makeObservable(): void {
    define(this, {
      state: observable.ref,
      dragNodes: observable.ref,
      sourceType: observable.ref,
      startPoint: observable.ref,
      currentPoint: observable.ref,
      touchNode: observable.ref,
      closestNode: observable.ref,
      startTime: observable.ref,
      startDrag: action,
      updateDrag: action,
      prepareDrop: action,
      endDrag: action,
      cancelDrag: action,
    })
  }
}
