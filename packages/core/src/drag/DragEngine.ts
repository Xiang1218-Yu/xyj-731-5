/**
 * @file 拖拽引擎核心
 *
 * 重构思路：
 * 1. DragEngine 是拖拽系统的门面(Facade)和协调者(Mediator)
 * 2. 通过策略模式持有 IDragBackend，可切换不同的事件捕获后端
 * 3. 通过事件总线与后端、预览、业务层通信，实现完全解耦
 * 4. 负责将底层拖拽事件转换为业务操作（查询节点、计算放置位置、执行移动）
 * 5. 复用原有的 MoveHelper 计算逻辑，保持行为一致
 * 6. 向后兼容：对外暴露与原 useDragDropEffect 相同的能力
 *
 * 架构关系：
 *   DragBackend(事件捕获) -> EventBus -> DragEngine(业务协调) -> MoveHelper(计算)
 *                                       ↓
 *                                  DragPreview(预览)
 */

import type { Engine } from '../models/Engine'
import { TreeNode } from '../models/TreeNode'
import type { Operation } from '../models/Operation'
import { CursorType, CursorDragType } from '../models/Cursor'
import { ClosestPosition } from '../models/MoveHelper'
import { Point } from '@designable/shared'
import { DragEventBus } from './EventBus'
import { DragContext } from './DragContext'
import { DragPreviewRenderer } from './DragPreview'
import {
  createBestBackend,
  Html5DragBackend,
  PointerDragBackend,
} from './backends'
import { DragBackendType, DragSourceType } from './types'
import type {
  DragBackendOptions,
  DragPreviewOptions,
  DragPreviewVNode,
  IDragBackend,
  IDragEventBus,
} from './types'
import {
  ViewportScrollEvent,
  DragStartEvent,
  DragMoveEvent,
  DragStopEvent,
} from '../events'

/**
 * DragEngine 配置选项
 */
export interface DragEngineOptions {
  /** 拖拽后端类型，默认自动选择最佳后端 */
  backend?: DragBackendType | IDragBackend
  /** 后端配置 */
  backendOptions?: DragBackendOptions
  /** 是否启用虚拟DOM拖拽预览 */
  enablePreview?: boolean
  /** 自定义预览生成函数 */
  previewGenerator?: (nodes: TreeNode[]) => DragPreviewVNode | null
}

/**
 * 拖拽引擎
 *
 * 职责：
 * - 初始化和管理拖拽后端、上下文、预览渲染器
 * - 监听事件总线，协调各模块工作
 * - 处理拖拽节点的查找、过滤和放置逻辑
 * - 对外提供简洁的API
 *
 * 不负责：
 * - 直接监听DOM事件（由Backend处理）
 * - 拖拽状态存储（由DragContext处理）
 * - 预览DOM渲染（由DragPreviewRenderer处理）
 * - 命中计算（复用MoveHelper）
 */
export class DragEngine {
  /** 设计器引擎引用 */
  private engine: Engine

  /** 事件总线 */
  private bus: IDragEventBus

  /** 拖拽上下文 */
  private context: DragContext

  /** 拖拽后端 */
  private backend: IDragBackend

  /** 预览渲染器 */
  private previewRenderer: DragPreviewRenderer | null = null

  /** 配置选项 */
  private options: DragEngineOptions

  /** 事件取消订阅函数 */
  private unsubscribers: Array<() => void> = []

  /** 是否已挂载 */
  private mounted = false

  constructor(engine: Engine, options?: DragEngineOptions) {
    this.engine = engine
    this.options = {
      enablePreview: true,
      ...options,
    }

    // 初始化事件总线
    this.bus = new DragEventBus()

    // 初始化拖拽上下文（纯状态管理）
    this.context = new DragContext()

    // 初始化拖拽后端
    this.backend = this.createBackend(this.options.backend)

    // 初始化预览渲染器
    if (this.options.enablePreview) {
      this.previewRenderer = new DragPreviewRenderer(this.bus)
    }

    this.setupEventListeners()
  }

  /**
   * 获取事件总线（供外部订阅拖拽事件）
   */
  get eventBus(): IDragEventBus {
    return this.bus
  }

  /**
   * 获取拖拽上下文（供外部读取状态）
   */
  get dragContext(): DragContext {
    return this.context
  }

  /**
   * 获取当前后端
   */
  get dragBackend(): IDragBackend {
    return this.backend
  }

  /**
   * 是否启用了虚拟DOM拖拽预览
   * GhostWidget 等外部预览组件可通过此属性判断是否应跳过自身渲染
   */
  get previewEnabled(): boolean {
    return this.options.enablePreview !== false && this.previewRenderer !== null
  }

  /**
   * 挂载拖拽引擎
   * 在指定容器上激活后端事件监听
   */
  mount(container?: HTMLElement | Document): void {
    if (this.mounted) return
    const target = container || document
    this.backend.activate(target)
    this.setupEngineListeners()
    this.mounted = true
  }

  /**
   * 卸载拖拽引擎
   * 清理所有资源
   */
  unmount(): void {
    if (!this.mounted) return
    this.backend.deactivate()
    this.cleanupEngineListeners()
    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []
    this.previewRenderer?.destroy()
    this.bus.removeAllListeners()
    this.context.endDrag()
    this.mounted = false
  }

  /**
   * 切换拖拽后端
   * 运行时动态切换，无需重建引擎
   */
  switchBackend(backend: DragBackendType | IDragBackend): void {
    if (this.mounted) {
      this.backend.deactivate()
    }
    this.backend = this.createBackend(backend)
    if (this.mounted) {
      this.backend.activate(document)
    }
  }

  /**
   * 显示自定义拖拽预览
   */
  showPreview(options: DragPreviewOptions): void {
    this.previewRenderer?.show(options)
  }

  /**
   * 隐藏拖拽预览
   */
  hidePreview(): void {
    this.previewRenderer?.hide()
  }

  /**
   * 创建后端实例
   */
  private createBackend(
    backend: DragBackendType | IDragBackend | undefined
  ): IDragBackend {
    // 如果传入的是后端实例，直接使用
    if (backend && typeof backend === 'object' && 'activate' in backend) {
      return backend
    }

    const backendOptions: DragBackendOptions = {
      ...this.options.backendOptions,
      attrNames: {
        sourceId: this.engine.props.sourceIdAttrName,
        nodeId: this.engine.props.nodeIdAttrName,
        outlineNodeId: this.engine.props.outlineNodeIdAttrName,
        nodeDragHandler: this.engine.props.nodeDragHandlerAttrName,
        nodeSelectionId: this.engine.props.nodeSelectionIdAttrName,
      },
    }

    // 如果未指定，自动选择最佳后端
    if (!backend) {
      return createBestBackend(this.bus, backendOptions)
    }

    // 根据类型创建
    switch (backend) {
      case DragBackendType.Pointer:
        return new PointerDragBackend(this.bus, backendOptions)
      case DragBackendType.Html5:
        return new Html5DragBackend(this.bus, backendOptions)
      default:
        return createBestBackend(this.bus, backendOptions)
    }
  }

  /**
   * 设置事件总线监听
   * 监听后端上报的底层拖拽事件，执行业务逻辑
   */
  private setupEventListeners(): void {
    // 拖拽准备阶段：后端检测到拖拽阈值后上报
    this.unsubscribers.push(
      this.bus.on('drag:prepare', (payload) => {
        this.handleDragPrepare(
          payload.sourceType,
          payload.startPoint,
          payload.originalEvent,
          payload.startEventData
        )
      })
    )

    // 拖拽移动：更新命中节点
    this.unsubscribers.push(
      this.bus.on('drag:move', (payload) => {
        this.handleDragMove(payload.point, payload.originalEvent)
      })
    )

    // 拖拽结束：执行放置
    this.unsubscribers.push(
      this.bus.on('drag:end', (payload) => {
        this.handleDragEnd(payload.cancelled, payload.originalEvent)
      })
    )
  }

  /**
   * 设置对引擎原有事件系统的监听
   * 主要用于视口滚动等非后端直接触发的事件
   */
  private setupEngineListeners(): void {
    this.engine.subscribeTo(ViewportScrollEvent, (event) => {
      this.handleViewportScroll(event)
    })
  }

  /**
   * 清理引擎事件监听
   */
  private cleanupEngineListeners(): void {
    // Event 类的 unsubscribe 会在 unmount 时统一处理
  }

  /**
   * 处理拖拽准备事件
   *
   * 重构要点：
   * 1. dragNodes 只解析一次（在 workspace 循环外），避免多 workspace 场景下被覆盖
   * 2. 派发旧版 DragStartEvent 保证 useCursorEffect/useAutoScrollEffect 等正常工作
   * 3. 遍历 workspace 时只负责将已解析的 dragNodes 同步到各 moveHelper
   */
  private handleDragPrepare(
    sourceType: DragSourceType,
    startPoint: Point,
    originalEvent: MouseEvent | DragEvent | TouchEvent | PointerEvent,
    startEventData: {
      clientX: number
      clientY: number
      pageX: number
      pageY: number
      target: EventTarget | null
      view: Window | null
    }
  ): void {
    if (this.engine.cursor.type !== CursorType.Normal) return

    // 使用 mousedown 时的目标元素查找拖拽源，而非 mousemove 的当前目标
    // 因为拖拽阈值触发时鼠标可能已移出源元素，导致找不到 source/node ID
    const target = startEventData.target as HTMLElement | null

    // 查找拖拽相关元素
    const el = target?.closest?.(
      `[${this.engine.props.nodeIdAttrName}],` +
        `[${this.engine.props.sourceIdAttrName}],` +
        `[${this.engine.props.outlineNodeIdAttrName}]`
    ) as HTMLElement | null

    const handler = target?.closest?.(
      `[${this.engine.props.nodeDragHandlerAttrName}]`
    ) as HTMLElement | null

    const helper = handler?.closest?.(
      `[${this.engine.props.nodeSelectionIdAttrName}]`
    ) as HTMLElement | null

    if (!el && !handler) return

    const sourceId = el?.getAttribute?.(this.engine.props.sourceIdAttrName)
    const outlineId = el?.getAttribute?.(
      this.engine.props.outlineNodeIdAttrName
    )
    const handlerId = helper?.getAttribute?.(
      this.engine.props.nodeSelectionIdAttrName
    )
    const nodeId = el?.getAttribute?.(this.engine.props.nodeIdAttrName)

    // 在循环外统一解析 dragNodes，避免多 workspace 迭代中共享变量被覆盖
    const dragNodes = this.resolveDragNodes(
      nodeId,
      outlineId,
      handlerId,
      sourceId
    )

    if (dragNodes.length === 0) return

    // 将解析好的 dragNodes 同步到每个 workspace 的 moveHelper
    // 这是跨 workspace 拖拽所必需的：所有 workspace 都需要知道当前拖拽的节点
    this.engine.workbench.eachWorkspace((workspace) => {
      workspace.operation.moveHelper.dragStart({ dragNodes })
    })

    // 更新拖拽上下文状态
    this.context.startDrag({
      dragNodes,
      sourceType,
      startPoint,
    })

    // 派发旧版 DragStartEvent，保持与现有 effects 的向后兼容：
    // - useCursorEffect: 设置 cursor.status=DragStart、dragStartPosition
    // - useAutoScrollEffect: 调用 takeDragStartSnapshot()（修复 dragStartSnapshot undefined）
    this.engine.dispatch(
      new DragStartEvent({
        clientX: startEventData.clientX,
        clientY: startEventData.clientY,
        pageX: startEventData.pageX,
        pageY: startEventData.pageY,
        target: startEventData.target as EventTarget,
        view: (startEventData.view || window) as Window,
      })
    )

    // 设置拖拽类型和鼠标样式（useCursorEffect 不处理这两项）
    this.engine.cursor.setDragType(CursorDragType.Move)
    this.engine.cursor.setStyle('move')

    // 通过事件总线派发 drag:start（供外部新API订阅）
    this.bus.emit('drag:start', {
      dragNodes,
      sourceType,
      startPoint,
      originalEvent,
      startEventData,
    })

    // 显示虚拟DOM预览
    this.showDragPreview(dragNodes)
  }

  /**
   * 解析拖拽节点列表
   *
   * 独立方法，确保只解析一次：
   * - 节点拖拽：检查 allowDrag，多选时拖拽所有已选节点
   * - 资源拖拽：从资源面板创建新节点
   *
   * @returns 可拖拽的节点数组，空数组表示不可拖拽
   */
  private resolveDragNodes(
    nodeId: string | null | undefined,
    outlineId: string | null | undefined,
    handlerId: string | null | undefined,
    sourceId: string | null | undefined
  ): TreeNode[] {
    if (nodeId || outlineId || handlerId) {
      const node = this.engine.findNodeById(
        outlineId || nodeId || handlerId || ''
      )
      if (!node) return []
      if (!node.allowDrag()) return []
      if (node === node.root) return []

      const validSelected = this.engine
        .getAllSelectedNodes()
        .filter((n) => n.allowDrag())

      if (validSelected.some((selectNode) => selectNode === node)) {
        return TreeNode.sort(validSelected)
      }
      return [node]
    }

    if (sourceId) {
      const sourceNode = this.engine.findNodeById(sourceId)
      if (sourceNode) {
        return [sourceNode]
      }
    }

    return []
  }

  /**
   * 处理拖拽移动事件
   *
   * 重构要点：
   * 1. 各 workspace 独立查找 touchNode，不使用共享变量
   * 2. 派发旧版 DragMoveEvent 保证 useCursorEffect/useAutoScrollEffect 等正常工作
   */
  private handleDragMove(
    point: Point,
    originalEvent: MouseEvent | DragEvent | TouchEvent | PointerEvent
  ): void {
    if (this.engine.cursor.type !== CursorType.Normal) return
    if (this.engine.cursor.dragType !== CursorDragType.Move) return
    if (!this.context.isDragging) return

    const event = originalEvent as MouseEvent
    const target = event.target as HTMLElement

    const el = target?.closest?.(
      `[${this.engine.props.nodeIdAttrName}],` +
        `[${this.engine.props.outlineNodeIdAttrName}]`
    ) as HTMLElement | null

    const nodeId = el?.getAttribute?.(this.engine.props.nodeIdAttrName)
    const outlineId = el?.getAttribute?.(
      this.engine.props.outlineNodeIdAttrName
    )

    // 记录最后一个命中的 touchNode，用于更新 context
    let lastTouchNode: TreeNode | null = null

    this.engine.workbench.eachWorkspace((workspace) => {
      const operation = workspace.operation
      const moveHelper = operation.moveHelper

      if (!moveHelper.dragNodes.length) return

      const tree = operation.tree
      // 每个 workspace 在自己的 tree 中独立查找 touchNode
      const touchNode = tree.findById(outlineId || nodeId || '') || null

      moveHelper.dragMove({
        point,
        touchNode: touchNode as TreeNode,
      })

      if (touchNode) {
        lastTouchNode = touchNode
      }
    })

    // 派发旧版 DragMoveEvent，由 useCursorEffect 设置 cursor.status 和 position
    // useAutoScrollEffect 也依赖此事件进行自动滚动
    this.engine.dispatch(
      new DragMoveEvent({
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        target: event.target as EventTarget,
        view: (event.view || window) as Window,
      })
    )

    // 更新上下文
    this.context.updateDrag({
      point,
      touchNode: lastTouchNode,
      closestNode: lastTouchNode,
    })
  }

  /**
   * 处理视口滚动事件
   * 拖拽过程中滚动时重新计算命中节点
   * 逻辑迁移自原 useDragDropEffect 的 ViewportScrollEvent 处理
   */
  private handleViewportScroll(event: ViewportScrollEvent): void {
    if (this.engine.cursor.type !== CursorType.Normal) return
    if (this.engine.cursor.dragType !== CursorDragType.Move) return
    if (!this.context.isDragging) return

    const point = new Point(
      this.engine.cursor.position.topClientX,
      this.engine.cursor.position.topClientY
    )
    const currentWorkspace =
      event?.context?.workspace ?? this.engine.workbench.activeWorkspace
    if (!currentWorkspace) return

    const operation = currentWorkspace.operation
    const moveHelper = operation.moveHelper
    if (!moveHelper.dragNodes.length) return

    const tree = operation.tree
    const viewport = currentWorkspace.viewport
    const outline = currentWorkspace.outline
    const viewportTarget = viewport.elementFromPoint(point)
    const outlineTarget = outline.elementFromPoint(point)

    const viewportNodeElement = viewportTarget?.closest?.(
      `[${this.engine.props.nodeIdAttrName}],` +
        `[${this.engine.props.outlineNodeIdAttrName}]`
    ) as HTMLElement | null

    const outlineNodeElement = outlineTarget?.closest?.(
      `[${this.engine.props.nodeIdAttrName}],` +
        `[${this.engine.props.outlineNodeIdAttrName}]`
    ) as HTMLElement | null

    const nodeId = viewportNodeElement?.getAttribute?.(
      this.engine.props.nodeIdAttrName
    )
    const outlineNodeId = outlineNodeElement?.getAttribute?.(
      this.engine.props.outlineNodeIdAttrName
    )

    const touchNode = tree.findById(outlineNodeId || nodeId || '')
    if (touchNode) {
      moveHelper.dragMove({ point, touchNode })
      this.context.updateDrag({
        point,
        touchNode,
        closestNode: moveHelper.closestNode,
      })
    }
  }

  /**
   * 处理拖拽结束事件
   *
   * 重构要点：
   * 1. 根据closestDirection执行节点插入
   * 2. 调用moveHelper.dragEnd清理状态
   * 3. 派发旧版 DragStopEvent 保证 useCursorEffect/useFreeSelectionEffect/useAutoScrollEffect 正常工作
   * 4. 清理context和预览
   */
  private handleDragEnd(
    cancelled: boolean,
    originalEvent: MouseEvent | DragEvent | TouchEvent | PointerEvent
  ): void {
    if (this.engine.cursor.type !== CursorType.Normal) return
    if (this.engine.cursor.dragType !== CursorDragType.Move) return

    const event = originalEvent as MouseEvent

    this.engine.workbench.eachWorkspace((workspace) => {
      const operation: Operation = workspace.operation
      const moveHelper = operation.moveHelper
      const dragNodes = moveHelper.dragNodes
      const closestNode = moveHelper.closestNode
      const closestDirection = moveHelper.closestDirection
      const selection = operation.selection

      if (!dragNodes.length) return

      if (!cancelled && dragNodes.length && closestNode && closestDirection) {
        if (
          closestDirection === ClosestPosition.After ||
          closestDirection === ClosestPosition.Under
        ) {
          if (closestNode.allowSibling(dragNodes)) {
            selection.batchSafeSelect(
              closestNode.insertAfter(
                ...TreeNode.filterDroppable(
                  dragNodes,
                  closestNode.parent as TreeNode
                )
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
                ...TreeNode.filterDroppable(
                  dragNodes,
                  closestNode.parent as TreeNode
                )
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

    // 派发旧版 DragStopEvent，保持与现有 effects 的向后兼容：
    // - useCursorEffect: 设置 cursor.status=DragStop→Normal、dragEndPosition、清除 dragStartPosition
    // - useFreeSelectionEffect: 执行框选逻辑（依赖订阅顺序在 useCursorEffect 之前执行）
    // - useAutoScrollEffect: 停止自动滚动
    this.engine.dispatch(
      new DragStopEvent({
        clientX: event?.clientX ?? 0,
        clientY: event?.clientY ?? 0,
        pageX: event?.pageX ?? 0,
        pageY: event?.pageY ?? 0,
        target: (event?.target as EventTarget) || document,
        view: (event?.view || window) as Window,
      })
    )

    // 清理上下文和预览
    this.context.endDrag()
    this.previewRenderer?.hide()
    this.engine.cursor.setStyle('')
  }

  /**
   * 显示拖拽预览
   * 优先使用自定义previewGenerator，否则生成默认预览
   */
  private showDragPreview(nodes: TreeNode[]): void {
    if (!this.previewRenderer) return

    let vNode: DragPreviewVNode | null = null

    // 尝试使用自定义生成器
    if (this.options.previewGenerator) {
      vNode = this.options.previewGenerator(nodes)
    }

    // 默认预览：显示拖拽数量
    if (!vNode) {
      vNode = this.createDefaultPreviewVNode(nodes)
    }

    if (vNode) {
      this.previewRenderer.show({
        vNode,
        offsetX: 15,
        offsetY: 15,
        opacity: 0.85,
      })
    }
  }

  /**
   * 创建默认预览虚拟DOM
   */
  private createDefaultPreviewVNode(nodes: TreeNode[]): DragPreviewVNode {
    const count = nodes.length
    const label =
      count === 1 ? nodes[0]?.componentName || '组件' : `${count} 个组件`

    return {
      type: 'div',
      props: {
        className: 'designable-drag-preview',
        style: {
          padding: '8px 16px',
          background: 'linear-gradient(135deg, #1890ff, #096dd9)',
          color: '#fff',
          borderRadius: '4px',
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          whiteSpace: 'nowrap',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        } as CSSStyleDeclaration,
      },
      children: [label],
    }
  }
}
