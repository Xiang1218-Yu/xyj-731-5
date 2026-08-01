import { IPoint } from '@designable/shared'
import { TreeNode } from '../models/TreeNode'
import { ClosestPosition } from '../models/MoveHelper'

/**
 * 拖拽系统类型定义
 *
 * 重构思路：
 * 1. 所有拖拽相关类型集中在此处，避免散落在 effect/driver 中形成隐式耦合
 * 2. 通过 IDragBackend 策略接口抽象「拖拽手势的采集方式」，
 *    使 HTML5 DnD 与 Pointer 自绘两种后端可以互相替换
 * 3. 通过 IDragSessionState 描述一次拖拽会话的完整快照，
 *    事件总线仅传递该快照，替代原先跨画布直接读写 moveHelper 的状态传递方式
 */

/**
 * 拖拽后端类型（策略标识）
 * Html5：复用原生 HTML5 Drag & Drop 与既有 DragDropDriver 事件流（默认，行为与历史版本一致）
 * Pointer：基于 pointer 事件自绘拖拽，预览与拖拽过程完全由 DragEngine 控制，
 *          在复杂布局（缩放、iframe、阴影DOM）下表现一致
 */
export enum DragBackendType {
  Html5 = 'HTML5',
  Pointer = 'POINTER',
}

/**
 * 归一化后的拖拽手势阶段
 */
export enum DragGesturePhase {
  Start = 'START',
  Move = 'MOVE',
  End = 'END',
}

/**
 * 归一化拖拽手势
 * 不同后端采集到的原始 DOM 事件统一转换为该结构后再进入 DragEngine，
 * 使上层拖拽逻辑与具体事件源解耦
 */
export interface IDragGesture {
  phase: DragGesturePhase
  clientX: number
  clientY: number
  pageX: number
  pageY: number
  target: EventTarget | null
  view: Window | null
}

/**
 * 拖拽手势回调
 */
export type DragGestureHandler = (gesture: IDragGesture) => void

/**
 * 拖拽后端策略接口（策略模式）
 * 每个后端只负责一件事：从 DOM 中采集拖拽手势并上报，不参与任何业务逻辑
 */
export interface IDragBackend {
  /** 后端类型标识 */
  readonly type: DragBackendType
  /** 挂载后端，开始采集手势 */
  attach(): void
  /** 卸载后端，停止采集并清理监听 */
  detach(): void
}

/**
 * 拖拽预览的虚拟DOM节点描述
 * 预览层仅消费该描述结构渲染，不引用任何真实业务组件，
 * 从而实现「拖拽预览与真实组件解耦」
 */
export interface IDragPreviewNode {
  /** 标签名 */
  tagName: keyof HTMLElementTagNameMap
  /** class 名 */
  className?: string
  /** 文本内容（与 children 互斥，优先取文本） */
  textContent?: string
  /** 内联样式，key 为小驼峰（如 backgroundColor），渲染时自动转 kebab-case */
  styles?: Record<string, string>
  /** 普通属性 */
  attributes?: Record<string, string>
  /** 子节点 */
  children?: IDragPreviewNode[]
}

/**
 * 拖拽会话状态快照
 * 作为事件总线的统一载荷，跨画布同步时各订阅方读取同一份快照，
 * 避免多画布各自维护状态导致的同步延迟
 */
export interface IDragSessionState {
  /** 是否处于拖拽中 */
  dragging: boolean
  /** 当前手势坐标（顶层视口坐标系） */
  point: IPoint | null
  /** 当前拖拽的节点集合 */
  dragNodes: TreeNode[]
  /** 命中的最近节点 */
  closestNode: TreeNode | null
  /** 命中方向 */
  closestDirection: ClosestPosition | null
  /** 当前激活的画布（workspace）id */
  activeWorkspaceId: string | null
}

/**
 * 拖拽事件总线的事件映射表
 * key 为事件名，value 为该事件的载荷类型
 */
export interface IDragEventMap {
  /** 会话开始（节点解析完成，进入拖拽态） */
  'drag:sessionStart': IDragSessionState
  /** 会话移动（坐标/命中结果发生变化） */
  'drag:sessionMove': IDragSessionState
  /** 会话结束（已执行放置或取消） */
  'drag:sessionEnd': IDragSessionState
  /** 状态同步广播（跨画布同步专用，每次状态变更同步触发） */
  'drag:stateSync': IDragSessionState
}

/**
 * 拖拽事件名
 */
export type DragEventType = keyof IDragEventMap

/**
 * 拖拽事件处理器
 */
export type DragEventHandler<T extends DragEventType> = (
  payload: IDragEventMap[T]
) => void

/**
 * DragEngine 构造参数
 */
export interface IDragEngineProps {
  /** 指定拖拽后端策略，默认 Html5（向后兼容） */
  backend?: DragBackendType
  /**
   * 是否启用虚拟DOM拖拽预览层
   * 默认仅在 Pointer 后端下启用（Html5 后端沿用原生拖拽影像 + GhostWidget）
   */
  previewEnabled?: boolean
}
