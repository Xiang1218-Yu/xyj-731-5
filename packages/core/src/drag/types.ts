/**
 * @file 拖拽系统类型定义
 *
 * 重构思路：
 * 1. 将拖拽相关的所有类型集中管理，避免类型散落在各模块中
 * 2. 通过泛型约束确保类型安全，全程不使用 any
 * 3. 定义清晰的拖拽后端接口，支持策略模式扩展
 * 4. 定义虚拟DOM预览节点类型，与真实组件解耦
 */

import type { TreeNode } from '../models/TreeNode'
import type { IPoint } from '@designable/shared'

/**
 * 拖拽状态枚举
 * 描述拖拽生命周期的各个阶段
 */
export enum DragState {
  /** 空闲状态，未进行拖拽 */
  Idle = 'IDLE',
  /** 准备拖拽，鼠标按下但未达到拖拽阈值 */
  Prepare = 'PREPARE',
  /** 拖拽中 */
  Dragging = 'DRAGGING',
  /** 拖拽结束，正在执行放置操作 */
  Dropping = 'DROPPING',
}

/**
 * 拖拽源类型
 * 区分拖拽操作的来源
 */
export enum DragSourceType {
  /** 从资源面板拖拽新组件 */
  Resource = 'RESOURCE',
  /** 在画布/大纲树中拖拽现有节点 */
  Node = 'NODE',
  /** 外部拖拽源（如文件拖入） */
  External = 'EXTERNAL',
}

/**
 * 拖拽后端类型标识
 * 用于区分不同的拖拽后端实现
 */
export enum DragBackendType {
  /** 基于鼠标事件的HTML5后端 */
  Html5 = 'HTML5',
  /** 基于Pointer Events的现代后端 */
  Pointer = 'POINTER',
  /** 基于触摸事件的移动端后端 */
  Touch = 'TOUCH',
}

/**
 * 拖拽开始事件数据
 */
export interface DragStartPayload {
  /** 拖拽的节点列表 */
  dragNodes: TreeNode[]
  /** 拖拽源类型 */
  sourceType: DragSourceType
  /** 起始位置（顶层窗口坐标） */
  startPoint: IPoint
  /** 原始事件对象 */
  originalEvent: MouseEvent | DragEvent | TouchEvent | PointerEvent
  /**
   * 原始鼠标按下事件的坐标数据
   * 用于构造兼容旧版事件系统的 DragStartEvent
   */
  startEventData: {
    clientX: number
    clientY: number
    pageX: number
    pageY: number
    target: EventTarget | null
    view: Window | null
  }
}

/**
 * 拖拽移动事件数据
 */
export interface DragMovePayload {
  /** 当前位置（顶层窗口坐标） */
  point: IPoint
  /** 触摸到的节点 */
  touchNode: TreeNode | null
  /** 原始事件对象 */
  originalEvent: MouseEvent | DragEvent | TouchEvent | PointerEvent
}

/**
 * 拖拽结束事件数据
 */
export interface DragEndPayload {
  /** 结束位置（顶层窗口坐标） */
  endPoint: IPoint
  /** 是否被取消（如按ESC键） */
  cancelled: boolean
  /** 原始事件对象 */
  originalEvent: MouseEvent | DragEvent | TouchEvent | PointerEvent
}

/**
 * 放置事件数据
 */
export interface DragDropPayload {
  /** 放置的目标节点 */
  dropNode: TreeNode
  /** 拖拽的节点列表 */
  dragNodes: TreeNode[]
  /** 放置位置 */
  position: IPoint
}

/**
 * 拖拽事件映射表
 * 用于事件总线的类型推导
 */
export interface DragEventMap {
  'drag:prepare': DragStartPayload
  'drag:start': DragStartPayload
  'drag:move': DragMovePayload
  'drag:end': DragEndPayload
  'drag:drop': DragDropPayload
  'drag:cancel': DragEndPayload
}

/**
 * 虚拟DOM属性类型
 * 描述拖拽预览节点的属性
 */
export interface DragPreviewVNodeProps {
  className?: string
  style?: Partial<CSSStyleDeclaration>
  [key: string]: unknown
}

/**
 * 虚拟DOM节点
 * 用于拖拽预览的轻量级描述，与真实组件解耦
 */
export interface DragPreviewVNode {
  /** 节点类型（标签名或组件标识） */
  type: string
  /** 节点属性 */
  props?: DragPreviewVNodeProps
  /** 子节点 */
  children?: (DragPreviewVNode | string)[]
  /** 节点唯一标识 */
  key?: string | number
}

/**
 * 拖拽预览配置
 */
export interface DragPreviewOptions {
  /** 预览节点的虚拟DOM描述 */
  vNode: DragPreviewVNode
  /** 预览相对于鼠标的X轴偏移 */
  offsetX?: number
  /** 预览相对于鼠标的Y轴偏移 */
  offsetY?: number
  /** 预览容器（默认挂在body上） */
  container?: HTMLElement
  /** 预览元素的z-index */
  zIndex?: number
  /** 预览元素透明度（0-1） */
  opacity?: number
}

/**
 * 拖拽后端配置选项
 */
export interface DragBackendOptions {
  /** 触发拖拽的最小移动距离（像素） */
  dragThreshold?: number
  /** 触发拖拽的最小延迟（毫秒） */
  dragDelay?: number
  /** 是否启用右键拖拽 */
  enableRightClick?: boolean
  /** 是否在拖拽时阻止默认行为 */
  preventDefault?: boolean
  /** DOM属性名配置 */
  attrNames?: {
    sourceId?: string
    nodeId?: string
    outlineNodeId?: string
    nodeDragHandler?: string
    nodeSelectionId?: string
  }
}

/**
 * 拖拽后端接口
 * 策略模式：不同的拖拽后端（HTML5、Pointer、Touch）实现此接口
 */
export interface IDragBackend {
  /** 后端类型标识 */
  readonly type: DragBackendType
  /** 初始化后端，绑定事件监听 */
  activate(container: HTMLElement | Document): void
  /** 销毁后端，移除事件监听 */
  deactivate(): void
  /** 设置拖拽阈值 */
  setThreshold(distance: number, delay: number): void
  /** 判断当前事件是否来自拖拽手柄 */
  isDragHandle(target: EventTarget | null): boolean
  /** 判断当前事件目标是否为可拖拽节点 */
  isDraggable(target: EventTarget | null): {
    draggable: boolean
    nodeId?: string
    sourceId?: string
  }
}

/**
 * 拖拽后端构造函数类型
 */
export interface DragBackendConstructor {
  new (eventBus: IDragEventBus, options?: DragBackendOptions): IDragBackend
}

/**
 * 拖拽事件总线接口
 * 提供类型安全的事件订阅和派发机制
 */
export interface IDragEventBus {
  /** 订阅事件 */
  on<K extends keyof DragEventMap>(
    event: K,
    listener: (payload: DragEventMap[K]) => void
  ): () => void
  /** 订阅事件（只触发一次） */
  once<K extends keyof DragEventMap>(
    event: K,
    listener: (payload: DragEventMap[K]) => void
  ): () => void
  /** 取消订阅 */
  off<K extends keyof DragEventMap>(
    event: K,
    listener: (payload: DragEventMap[K]) => void
  ): void
  /** 派发事件 */
  emit<K extends keyof DragEventMap>(
    event: K,
    payload: DragEventMap[K]
  ): boolean
  /** 移除所有事件监听 */
  removeAllListeners(): void
}

/**
 * 拖拽上下文状态
 * 集中管理拖拽过程中的状态数据
 */
export interface DragContextState {
  /** 当前拖拽状态 */
  state: DragState
  /** 拖拽的节点列表 */
  dragNodes: TreeNode[]
  /** 拖拽源类型 */
  sourceType: DragSourceType
  /** 起始位置 */
  startPoint: IPoint | null
  /** 当前位置 */
  currentPoint: IPoint | null
  /** 当前触摸的节点 */
  touchNode: TreeNode | null
  /** 最近的可放置节点 */
  closestNode: TreeNode | null
  /** 拖拽开始时间戳 */
  startTime: number
}
