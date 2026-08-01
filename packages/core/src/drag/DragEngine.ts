import { Point } from '@designable/shared'
import { Engine } from '../models/Engine'
import { TreeNode } from '../models/TreeNode'
import { CursorDragType, CursorType } from '../models/Cursor'
import { ClosestPosition } from '../models/MoveHelper'
import { DragMoveEvent, DragStartEvent, ViewportScrollEvent } from '../events'
import { DragEventBus } from './DragEventBus'
import { DragPreviewRenderer } from './DragPreviewRenderer'
import { LegacyDragBackend } from './backends/LegacyDragBackend'
import { PointerDragBackend } from './backends/PointerDragBackend'
import {
  DragBackendType,
  DragEventHandler,
  DragEventType,
  IDragBackend,
  IDragEngineProps,
  IDragPreviewNode,
  IDragSessionState,
} from './types'

/**
 * 拖拽引擎（DragEngine）
 *
 * ============================ 重构思路 ============================
 * 重构前的问题：
 * 1. 拖拽逻辑（节点解析、命中计算、放置执行）散落在 useDragDropEffect 中，
 *    与引擎事件流强耦合，想自定义拖拽行为必须改写 effect 内部实现
 * 2. 拖拽预览依赖原生 HTML5 DnD 影像与真实组件渲染，复杂布局下表现不一致
 * 3. 跨画布拖拽时，通过遍历所有 workspace 直接读写各自 moveHelper 做状态
 *    传递，订阅方依赖响应式轮询感知变化，存在同步延迟
 *
 * 重构后的职责划分（单一职责）：
 * - DragEngine       ：拖拽会话的编排者，负责节点解析、放置执行、状态快照
 * - IDragBackend     ：策略接口，仅负责手势采集（Html5 / Pointer 可替换）
 * - DragEventBus     ：仅负责拖拽事件的发布订阅（跨画布同步的通道）
 * - DragPreviewRenderer：仅负责虚拟DOM预览浮层的渲染与位移
 * - useDragDropEffect ：退化为「兼容适配层」，把引擎事件委托给 DragEngine
 *
 * 向后兼容保障：
 * - 默认使用 Html5 后端，手势仍由 DragDropDriver 产生，行为与历史版本一致
 * - 所有拖拽操作最终仍调用 MoveHelper 的 dragStart/dragMove/dragDrop/dragEnd，
 *   GhostWidget、大纲树、辅助线等既有订阅方完全无感知
 * ================================================================
 */
export class DragEngine {
  /** 设计器引擎引用 */
  engine: Engine

  /** 拖拽事件总线（跨画布状态同步通道，替代直接状态传递） */
  bus: DragEventBus

  /** 当前拖拽后端策略 */
  backend: IDragBackend

  /** 虚拟DOM拖拽预览渲染器 */
  preview: DragPreviewRenderer

  /** 是否启用虚拟DOM预览层 */
  previewEnabled: boolean

  constructor(engine: Engine, props: IDragEngineProps = {}) {
    this.engine = engine
    this.bus = new DragEventBus()
    this.preview = new DragPreviewRenderer()
    this.previewEnabled =
      props.previewEnabled ?? props.backend === DragBackendType.Pointer
    this.backend = this.createBackend(props.backend ?? DragBackendType.Html5)
  }

  /**
   * 挂载拖拽引擎（初始化后端策略）
   */
  mount() {
    this.backend.attach()
  }

  /**
   * 卸载拖拽引擎，清理后端监听、预览浮层与事件订阅
   */
  unmount() {
    this.backend.detach()
    this.preview.destroy()
    this.bus.clear()
  }

  /**
   * 运行时切换拖拽后端策略（策略模式的核心能力）
   * 切换后预览层默认跟随后端语义：Pointer 后端自动启用虚拟DOM预览
   */
  setBackend(type: DragBackendType, previewEnabled?: boolean) {
    this.backend.detach()
    this.backend = this.createBackend(type)
    this.backend.attach()
    if (previewEnabled !== undefined) {
      this.previewEnabled = previewEnabled
    } else {
      this.previewEnabled = type === DragBackendType.Pointer
    }
  }

  /**
   * 订阅拖拽事件总线
   */
  subscribe<T extends DragEventType>(
    type: T,
    handler: DragEventHandler<T>
  ): () => void {
    return this.bus.subscribe(type, handler)
  }

  /**
   * 获取当前拖拽会话状态快照
   * 快照聚合自激活 workspace 的 moveHelper，是跨画布同步的唯一数据源
   */
  getState(): IDragSessionState {
    const workspace = this.engine.workbench.activeWorkspace
    const moveHelper = workspace?.operation?.moveHelper
    const position = this.engine.cursor.position
    const hasValidPoint =
      position?.topClientX !== undefined && position?.topClientY !== undefined
    return {
      dragging: moveHelper?.dragging ?? false,
      point: hasValidPoint
        ? new Point(position.topClientX, position.topClientY)
        : null,
      dragNodes: this.engine.findMovingNodes(),
      closestNode: moveHelper?.closestNode ?? null,
      closestDirection: moveHelper?.closestDirection ?? null,
      activeWorkspaceId: workspace?.id ?? null,
    }
  }

  /**
   * 处理拖拽开始事件（由 useDragDropEffect 委托调用）
   * 逻辑与重构前保持一致：解析拖拽节点 -> 启动各画布 moveHelper -> 广播快照
   */
  handleDragStart(event: DragStartEvent) {
    const engine = this.engine
    if (engine.cursor.type !== CursorType.Normal) return
    const target = event.data.target as HTMLElement
    const el = target?.closest(`
       *[${engine.props.nodeIdAttrName}],
       *[${engine.props.sourceIdAttrName}],
       *[${engine.props.outlineNodeIdAttrName}]
      `)
    const handler = target?.closest(
      `*[${engine.props.nodeDragHandlerAttrName}]`
    )
    const helper = handler?.closest(
      `*[${engine.props.nodeSelectionIdAttrName}]`
    )
    if (!el?.getAttribute && !handler) return
    const sourceId = el?.getAttribute(engine.props.sourceIdAttrName)
    const outlineId = el?.getAttribute(engine.props.outlineNodeIdAttrName)
    const handlerId = helper?.getAttribute(engine.props.nodeSelectionIdAttrName)
    const nodeId = el?.getAttribute(engine.props.nodeIdAttrName)
    engine.workbench.eachWorkspace((currentWorkspace) => {
      const operation = currentWorkspace.operation
      const moveHelper = operation.moveHelper
      if (nodeId || outlineId || handlerId) {
        const node = engine.findNodeById(outlineId || nodeId || handlerId)
        if (node) {
          if (!node.allowDrag()) return
          if (node === node.root) return
          const validSelected = engine
            .getAllSelectedNodes()
            .filter((node) => node.allowDrag())
          if (validSelected.some((selectNode) => selectNode === node)) {
            moveHelper.dragStart({ dragNodes: TreeNode.sort(validSelected) })
          } else {
            moveHelper.dragStart({ dragNodes: [node] })
          }
        }
      } else if (sourceId) {
        const sourceNode = engine.findNodeById(sourceId)
        if (sourceNode) {
          moveHelper.dragStart({ dragNodes: [sourceNode] })
        }
      }
    })
    engine.cursor.setStyle('move')
    // 渲染虚拟DOM预览并广播会话开始
    this.renderPreview()
    this.publishSession('drag:sessionStart')
  }

  /**
   * 处理拖拽移动事件（由 useDragDropEffect 委托调用）
   */
  handleDragMove(event: DragMoveEvent) {
    const engine = this.engine
    if (engine.cursor.type !== CursorType.Normal) return
    if (engine.cursor.dragType !== CursorDragType.Move) return
    const target = event.data.target as HTMLElement
    const el = target?.closest(`
      *[${engine.props.nodeIdAttrName}],
      *[${engine.props.outlineNodeIdAttrName}]
    `)
    const point = new Point(event.data.topClientX, event.data.topClientY)
    const nodeId = el?.getAttribute(engine.props.nodeIdAttrName)
    const outlineId = el?.getAttribute(engine.props.outlineNodeIdAttrName)
    engine.workbench.eachWorkspace((currentWorkspace) => {
      const operation = currentWorkspace.operation
      const moveHelper = operation.moveHelper
      const dragNodes = moveHelper.dragNodes
      const tree = operation.tree
      if (!dragNodes.length) return
      const touchNode = tree.findById(outlineId || nodeId)
      moveHelper.dragMove({
        point,
        touchNode,
      })
    })
    // 移动预览浮层并同步广播最新状态快照（跨画布同步无延迟的关键）
    this.movePreview(event.data.topClientX, event.data.topClientY)
    this.publishSession('drag:sessionMove')
  }

  /**
   * 处理视口滚动事件（拖拽中画布自动滚动时重算命中）
   */
  handleViewportScroll(event: ViewportScrollEvent) {
    const engine = this.engine
    if (engine.cursor.type !== CursorType.Normal) return
    if (engine.cursor.dragType !== CursorDragType.Move) return
    const point = new Point(
      engine.cursor.position.topClientX,
      engine.cursor.position.topClientY
    )
    const currentWorkspace =
      event?.context?.workspace ?? engine.workbench.activeWorkspace
    if (!currentWorkspace) return
    const operation = currentWorkspace.operation
    const moveHelper = operation.moveHelper
    if (!moveHelper.dragNodes.length) return
    const tree = operation.tree
    const viewport = currentWorkspace.viewport
    const outline = currentWorkspace.outline
    const viewportTarget = viewport.elementFromPoint(point)
    const outlineTarget = outline.elementFromPoint(point)
    const viewportNodeElement = viewportTarget?.closest(`
      *[${engine.props.nodeIdAttrName}],
      *[${engine.props.outlineNodeIdAttrName}]
    `)
    const outlineNodeElement = outlineTarget?.closest(`
    *[${engine.props.nodeIdAttrName}],
    *[${engine.props.outlineNodeIdAttrName}]
  `)
    const nodeId = viewportNodeElement?.getAttribute(
      engine.props.nodeIdAttrName
    )
    const outlineNodeId = outlineNodeElement?.getAttribute(
      engine.props.outlineNodeIdAttrName
    )
    const touchNode = tree.findById(outlineNodeId || nodeId)
    moveHelper.dragMove({ point, touchNode })
    this.publishSession('drag:sessionMove')
  }

  /**
   * 处理拖拽结束事件（由 useDragDropEffect 委托调用）
   * 按命中方向执行放置，逻辑与重构前完全一致
   */
  handleDragStop() {
    const engine = this.engine
    if (engine.cursor.type !== CursorType.Normal) return
    if (engine.cursor.dragType !== CursorDragType.Move) return
    engine.workbench.eachWorkspace((currentWorkspace) => {
      const operation = currentWorkspace.operation
      const moveHelper = operation.moveHelper
      const dragNodes = moveHelper.dragNodes
      const closestNode = moveHelper.closestNode
      const closestDirection = moveHelper.closestDirection
      const selection = operation.selection
      if (!dragNodes.length) return
      if (dragNodes.length && closestNode && closestDirection) {
        if (
          closestDirection === ClosestPosition.After ||
          closestDirection === ClosestPosition.Under
        ) {
          if (closestNode.allowSibling(dragNodes)) {
            selection.batchSafeSelect(
              closestNode.insertAfter(
                ...TreeNode.filterDroppable(dragNodes, closestNode.parent)
              )
            )
          }
        } else if (
          closestDirection === ClosestPosition.Before ||
          closestDirection === ClosestPosition.Upper
        ) {
          if (closestNode.allowSibling(dragNodes)) {
            selection.batchSafeSelect(
              closestNode.insertBefore(
                ...TreeNode.filterDroppable(dragNodes, closestNode.parent)
              )
            )
          }
        } else if (
          closestDirection === ClosestPosition.Inner ||
          closestDirection === ClosestPosition.InnerAfter
        ) {
          if (closestNode.allowAppend(dragNodes)) {
            selection.batchSafeSelect(
              closestNode.append(
                ...TreeNode.filterDroppable(dragNodes, closestNode)
              )
            )
            moveHelper.dragDrop({ dropNode: closestNode })
          }
        } else if (closestDirection === ClosestPosition.InnerBefore) {
          if (closestNode.allowAppend(dragNodes)) {
            selection.batchSafeSelect(
              closestNode.prepend(
                ...TreeNode.filterDroppable(dragNodes, closestNode)
              )
            )
            moveHelper.dragDrop({ dropNode: closestNode })
          }
        }
      }
      moveHelper.dragEnd()
    })
    engine.cursor.setStyle('')
    // 清理预览并广播会话结束
    this.preview.clear()
    this.publishSession('drag:sessionEnd')
  }

  /**
   * 根据策略类型创建后端实例
   */
  private createBackend(type: DragBackendType): IDragBackend {
    if (type === DragBackendType.Pointer) {
      return new PointerDragBackend(this.engine)
    }
    return new LegacyDragBackend()
  }

  /**
   * 渲染虚拟DOM拖拽预览
   * 预览内容仅由节点标题等元数据生成描述，不渲染真实业务组件
   */
  private renderPreview() {
    if (!this.previewEnabled) return
    const dragNodes = this.engine.findMovingNodes()
    if (!dragNodes.length) return
    this.preview.render(this.buildPreviewDescriptor(dragNodes))
  }

  /**
   * 移动预览浮层
   */
  private movePreview(clientX: number, clientY: number) {
    if (!this.previewEnabled) return
    this.preview.moveTo(clientX, clientY)
  }

  /**
   * 构建预览的虚拟DOM描述
   * 默认实现：首个拖拽节点标题 + 多选省略标记，样式内联以保证跨画布一致
   * 如需自定义预览，可在 drag:sessionStart 订阅中调用 preview.render 覆盖
   */
  private buildPreviewDescriptor(dragNodes: TreeNode[]): IDragPreviewNode {
    const firstNode = dragNodes[0]
    const displayNode =
      firstNode.componentName === '$$ResourceNode$$'
        ? firstNode.children[0]
        : firstNode
    const title = displayNode?.getMessage('title') || displayNode?.componentName
    const text = dragNodes.length > 1 ? `${title}...` : `${title}`
    return {
      tagName: 'div',
      className: 'dn-drag-preview',
      styles: {
        display: 'inline-block',
        padding: '4px 10px',
        backgroundColor: 'var(--dn-brand-color, #1890ff)',
        color: '#ffffff',
        borderRadius: '4px',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        opacity: '0.9',
      },
      children: [
        {
          tagName: 'span',
          textContent: text,
        },
      ],
    }
  }

  /**
   * 发布会话事件：先发布阶段事件，再同步广播状态快照
   * 同一帧内完成，保证跨画布订阅方读取到的是同一份最新状态
   */
  private publishSession(type: DragEventType) {
    const state = this.getState()
    this.bus.publish(type, state)
    this.bus.publish('drag:stateSync', state)
  }
}
