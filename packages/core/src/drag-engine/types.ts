/**
 * ============================================================================
 *  DragEngine 类型定义
 * ============================================================================
 *
 *  本文件是拖拽引擎的「类型契约层」，遵循以下设计原则：
 *    1. 单一职责：仅声明类型，不包含任何运行时逻辑；
 *    2. 零 any：所有不确定类型统一使用 unknown，由调用方在边界处做收窄；
 *    3. 大小驼峰：接口 / 类型别名使用大驼峰（PascalCase），
 *       属性 / 方法使用小驼峰（camelCase）；
 *    4. 可扩展：通过「事件映射表（DragEngineEventMap）+ 字符串字面量联合」
 *       让 EventBus 获得完整的类型推导能力，同时支持外部模块以
 *       「模块声明合并（declaration merging）」扩展事件。
 *
 *  架构分层概览：
 *    ┌──────────────────────────────────────────────────────────────┐
 *    │                      DragEngine（编排者）                     │
 *    │   负责会话生命周期、解析器调度、向后兼容的事件桥接              │
 *    └───────────────┬───────────────────────────┬──────────────────┘
 *                    │                           │
 *        ┌───────────▼──────────┐     ┌──────────▼───────────┐
 *        │   IDragBackend       │     │   VirtualPreview     │
 *        │   （策略：输入抽象）  │     │   （虚拟 DOM 预览）   │
 *        │  Pointer / Html5 ... │     │   VNode -> DOM       │
 *        └──────────────────────┘     └──────────────────────┘
 *                    │                           ▲
 *        ┌───────────▼───────────────────────────┴──────────┐
 *        │              EventBus（类型安全事件总线）          │
 *        │   替代直接的状态传递，实现跨画布的发布 / 订阅       │
 *        └──────────────────────────────────────────────────┘
 * ============================================================================
 */

/**
 * 拖拽后端类型。
 * - Pointer：基于 Pointer Events 的统一指针后端，推荐用于复杂布局；
 * - Html5：基于原生 HTML5 Drag and Drop，用于需要与外部 DnD 交互的场景；
 * - Custom：自定义后端，使用者可实现 IDragBackend 接入任意输入源。
 */
export type DragBackendType = 'Pointer' | 'Html5' | 'Custom'

/**
 * 拖拽源的种类。
 * - Node：画布中已有的节点（移动 / 排序）；
 * - Resource：组件资源面板中的素材（新增节点）；
 * - External：来自画布外部的任意数据（例如外部文件、第三方 DnD）。
 */
export type DragSourceKind = 'Node' | 'Resource' | 'External'

/**
 * 拖拽放置结果的相对位置。
 * 与现有 MoveHelper.ClosestPosition 保持语义一致，
 * 但去除对核心模型的直接依赖，使引擎层保持纯粹。
 */
export enum DragDropPosition {
  Before = 'BEFORE',
  After = 'AFTER',
  Upper = 'UPPER',
  Under = 'UNDER',
  Inner = 'INNER',
  InnerBefore = 'INNER_BEFORE',
  InnerAfter = 'INNER_AFTER',
  Forbid = 'FORBID',
}

/**
 * 拖拽引擎内部的事件名称。
 * 使用字符串常量枚举（const enum 不便于外部扩展，这里使用联合字符串类型），
 * 命名规范为「领域:动作」，与现有事件系统（drag:start 等）保持一致。
 */
export type DragEngineEventType =
  | 'drag:engine:start'
  | 'drag:engine:move'
  | 'drag:engine:enter'
  | 'drag:engine:over'
  | 'drag:engine:leave'
  | 'drag:engine:drop'
  | 'drag:engine:stop'
  | 'drag:preview:update'
  | 'drag:source:resolve'
  | 'drag:target:resolve'

/**
 * 指针输入数据。由各后端负责把原生事件归一化为此结构，
 * 这样上层引擎不关心输入来自鼠标、触摸还是 HTML5 DnD。
 */
export interface DragPointerData {
  /** 视口坐标系 X */
  clientX: number
  /** 视口坐标系 Y */
  clientY: number
  /** 页面坐标系 X（含滚动） */
  pageX: number
  /** 页面坐标系 Y（含滚动） */
  pageY: number
  /** 顶层窗口视口坐标系 X（跨 iframe 场景使用） */
  topClientX: number
  /** 顶层窗口视口坐标系 Y（跨 iframe 场景使用） */
  topClientY: number
  /** 顶层窗口页面坐标系 X */
  topPageX: number
  /** 顶层窗口页面坐标系 Y */
  topPageY: number
  /** 原生事件目标，可能为 null（例如来自外部数据传输） */
  target: EventTarget | null
  /** 事件所在的 window，用于跨 iframe 坐标换算 */
  view: Window
  /** 原始事件对象，使用 unknown 避免在类型层泄露后端细节 */
  nativeEvent: unknown
}

/**
 * 拖拽源描述。解析器（IDragSourceResolver）将 DOM 上的属性
 * 转换为该结构，使引擎与真实组件解耦。
 */
export interface DragSource {
  /** 拖拽源种类 */
  kind: DragSourceKind
  /**
   * 业务侧的唯一标识。对于节点为 node id，对于资源为 resource id，
   * 对于外部数据由调用方自行约定。
   */
  id: string
  /** 拖拽时携带的业务载荷，引擎不关心具体结构，统一使用 unknown */
  payload: unknown
  /** 拖拽发起时的 DOM 元素（只读，供预览或定位参考） */
  element: HTMLElement | null
  /** 多选场景下的同源节点集合（例如批量移动） */
  relatedIds: string[]
}

/**
 * 拖拽目标描述。由 IDragTargetResolver 在 move / over 阶段解析。
 */
export interface DragTarget {
  /** 目标的业务标识（如节点 id），无目标时为 null */
  id: string | null
  /** 目标业务载荷 */
  payload: unknown
  /** 命中的 DOM 元素 */
  element: HTMLElement | null
  /** 计算出的放置位置 */
  position: DragDropPosition
  /** 是否允许放置 */
  droppable: boolean
}

/**
 * 一次完整拖拽的会话状态。
 * 会话在 dragstart 时创建，在 dragstop（无论成功与否）时销毁。
 */
export interface DragSession {
  /** 会话唯一标识 */
  sessionId: string
  /** 当前使用的后端类型 */
  backendType: DragBackendType
  /** 拖拽源 */
  source: DragSource
  /** 当前拖拽目标（移动过程中实时更新） */
  target: DragTarget | null
  /** 会话开始时的指针数据 */
  startPointer: DragPointerData
  /** 最新的指针数据 */
  currentPointer: DragPointerData
  /** 会话是否仍然活跃 */
  active: boolean
  /** 自定义会话级别的数据袋，供业务侧存放临时状态 */
  stateBag: Map<string, unknown>
}

/**
 * 引擎事件的基础载荷，所有具体事件都继承它。
 */
export interface DragEngineBaseEvent {
  /** 当前会话 */
  session: DragSession
  /** 事件触发时的指针数据 */
  pointer: DragPointerData
}

/** 拖拽开始事件载荷 */
export interface DragStartPayload extends DragEngineBaseEvent {}

/** 拖拽移动事件载荷 */
export interface DragMovePayload extends DragEngineBaseEvent {
  /** 本次移动相对上一帧的位移 */
  delta: { dx: number; dy: number }
}

/** 指针进入某个放置目标 */
export interface DragEnterPayload extends DragEngineBaseEvent {
  target: DragTarget
}

/** 指针在放置目标上移动 */
export interface DragOverPayload extends DragEngineBaseEvent {
  target: DragTarget
}

/** 指针离开放置目标 */
export interface DragLeavePayload extends DragEngineBaseEvent {
  target: DragTarget
}

/** 成功放置事件载荷 */
export interface DragDropPayload extends DragEngineBaseEvent {
  target: DragTarget
}

/** 拖拽结束事件载荷（无论是否成功放置都会触发） */
export interface DragStopPayload extends DragEngineBaseEvent {
  /** 本次拖拽是否成功完成了放置 */
  dropped: boolean
}

/** 预览更新事件载荷 */
export interface DragPreviewUpdatePayload {
  session: DragSession
  /** 当前应渲染的虚拟节点树，为 null 时表示隐藏预览 */
  vNode: DragVNode | null
  /** 预览位置偏移（相对指针） */
  offset: { x: number; y: number }
}

/** 拖拽源解析完成事件载荷 */
export interface DragSourceResolvePayload {
  source: DragSource
  pointer: DragPointerData
}

/** 拖拽目标解析完成事件载荷 */
export interface DragTargetResolvePayload {
  target: DragTarget | null
  pointer: DragPointerData
}

/**
 * 事件映射表：将事件名映射到其载荷类型。
 * 这是 EventBus 获得端到端类型安全的关键。
 * 外部模块可通过「declare module」对该接口进行声明合并来扩展事件。
 *
 * 末尾的字符串索引签名允许业务侧通过声明合并扩展自定义事件，
 * 同时使该接口满足 EventBus 的 Record<string, unknown> 泛型约束。
 */
export interface DragEngineEventMap {
  'drag:engine:start': DragStartPayload
  'drag:engine:move': DragMovePayload
  'drag:engine:enter': DragEnterPayload
  'drag:engine:over': DragOverPayload
  'drag:engine:leave': DragLeavePayload
  'drag:engine:drop': DragDropPayload
  'drag:engine:stop': DragStopPayload
  'drag:preview:update': DragPreviewUpdatePayload
  'drag:source:resolve': DragSourceResolvePayload
  'drag:target:resolve': DragTargetResolvePayload
  [eventName: string]: unknown
}

/* -------------------------------------------------------------------------- */
/*                           虚拟 DOM 预览相关类型                              */
/* -------------------------------------------------------------------------- */

/**
 * 虚拟节点属性。键为字符串，值限定为可安全渲染到 DOM 的类型。
 * 不使用 any，显式枚举允许的属性值类型。
 */
export type DragVNodeAttr =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, string | number | boolean | null | undefined>
  | EventListenerOrEventListenerObject

/** 虚拟节点的样式对象 */
export type DragVNodeStyle = Partial<CSSStyleDeclaration>

/**
 * 虚拟 DOM 节点。
 * 该结构独立于 React/Vue，使拖拽预览可以与真实组件渲染完全解耦：
 * 业务侧把任意组件「投影」为轻量 VNode，由 VirtualPreviewRenderer
 * 渲染为真实 DOM，避免使用原生 HTML5 DnD 的 ghost image。
 */
export interface DragVNode {
  /** 标签名，例如 'div' / 'span' */
  tagName: string
  /** 属性 */
  attrs?: Record<string, DragVNodeAttr>
  /** 内联样式 */
  style?: DragVNodeStyle
  /** class 名 */
  className?: string
  /** 文本内容（与 children 互斥） */
  text?: string
  /** 子节点 */
  children?: DragVNode[]
  /** 业务侧的 key，用于 diff */
  key?: string | number
}

/* -------------------------------------------------------------------------- */
/*                           解析器与后端相关类型                               */
/* -------------------------------------------------------------------------- */

/**
 * 拖拽源解析器接口。
 * 职责单一：根据原生指针事件与被命中的元素，识别出「正在拖什么」。
 * 这样不同宿主（画布、大纲树、资源面板）可提供不同的解析策略。
 */
export interface IDragSourceResolver {
  /**
   * 解析拖拽源。无法识别时返回 null，引擎将放弃本次拖拽。
   */
  resolve(pointer: DragPointerData): DragSource | null
}

/**
 * 拖拽目标解析器接口。
 * 职责单一：根据当前指针位置，识别出「拖到哪里」以及「以什么方式放置」。
 */
export interface IDragTargetResolver {
  /**
   * 解析放置目标。
   * @param pointer 当前指针数据
   * @param session 当前会话（可读取 source 做合法性校验）
   */
  resolve(pointer: DragPointerData, session: DragSession): DragTarget | null
}

/**
 * 预览内容提供者。
 * 业务侧实现该接口，将拖拽源转换为虚拟节点树；引擎不直接依赖组件树。
 */
export interface IDragPreviewProvider {
  /**
   * 根据会话生成预览虚拟节点，返回 null 表示不显示预览。
   */
  resolvePreview(session: DragSession): DragVNode | null
}

/**
 * 后端向引擎上报事件的统一宿主接口。
 * 后端只感知「指针的原始交互」，不感知会话、目标等业务概念。
 */
export interface IDragBackendHost {
  /** 通知引擎检测到一次潜在拖拽的开始（pointerdown 等） */
  onBackendPointerDown(pointer: DragPointerData): void
  /** 通知引擎指针移动 */
  onBackendPointerMove(pointer: DragPointerData): void
  /** 通知引擎指针抬起 / 拖拽结束 */
  onBackendPointerUp(pointer: DragPointerData): void
}

/**
 * 拖拽后端策略接口。
 * 使用策略模式：引擎在运行时持有一个后端实例，可整体替换，
 * 从而支持 Pointer / Html5 / 触摸 / 测试 mock 等不同实现。
 */
export interface IDragBackend {
  /** 后端类型标识 */
  readonly type: DragBackendType
  /**
   * 将后端绑定到给定的 DOM 容器。
   * @param container 事件绑定的根容器
   * @param host 引擎侧的事件接收宿主
   */
  attach(container: HTMLElement | Document, host: IDragBackendHost): void
  /** 解绑后端，移除所有事件监听 */
  detach(): void
  /** 是否支持当前运行环境 */
  isSupported(): boolean
}

/**
 * DragEngine 构造参数。
 */
export interface IDragEngineOptions {
  /** 使用的拖拽后端实例 */
  backend: IDragBackend
  /** 拖拽源解析器 */
  sourceResolver: IDragSourceResolver
  /** 拖拽目标解析器 */
  targetResolver: IDragTargetResolver
  /** 拖拽预览内容提供者（可选） */
  previewProvider?: IDragPreviewProvider
  /** 判定拖拽开始的最小位移（像素），默认 4 */
  dragThreshold?: number
  /** 判定拖拽开始的最长按压时长（毫秒），默认 0 表示不限时 */
  dragDelay?: number
  /** 预览相对指针的 X 轴偏移 */
  previewOffsetX?: number
  /** 预览相对指针的 Y 轴偏移 */
  previewOffsetY?: number
  /** 预览容器，默认为 document.body */
  previewContainer?: HTMLElement
  /** 预览元素的 class 名前缀 */
  previewClassName?: string
}

/**
 * 事件订阅者函数类型。
 */
export type DragEventHandler<TPayload> = (payload: TPayload) => void

/**
 * 取消订阅函数。
 */
export type Unsubscribe = () => void
