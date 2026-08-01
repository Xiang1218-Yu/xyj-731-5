import { IPoint } from '@designable/shared'

/**
 * ============================================================================
 * DragEngine 类型契约（Type Contracts）
 * ----------------------------------------------------------------------------
 * 重构思路：
 *   旧实现中，拖拽的“输入采集”（DragDropDriver 原生 DnD）、“业务落点计算”
 *   （MoveHelper）、“视觉预览”（GhostWidget 直接读 Cursor）三者通过全局可变
 *   状态与直接方法调用强耦合，导致：
 *     1) 自定义拖拽行为需要改动多处；
 *     2) 预览依赖真实组件坐标，复杂布局下表现不一致；
 *     3) 跨画布拖拽依赖同步的状态读写，存在时序延迟。
 *
 *   本模块用一套“无 DOM / 无框架依赖”的纯类型契约，把拖拽拆分为三个正交关注点：
 *     - IDragBackend：输入后端（策略模式），只负责把宿主事件翻译成标准拖拽信号；
 *     - IDragEventBus：类型化事件总线，负责解耦的信号广播；
 *     - IDragPreviewState：虚拟预览状态，与真实组件彻底解耦。
 *
 *   所有契约均为显式强类型，全程禁用 any，命名遵循大小驼峰（类型/接口 PascalCase，
 *   成员 camelCase），并遵循单一职责原则。
 * ============================================================================
 */

/**
 * 拖拽生命周期阶段。
 * 与既有 CursorStatus 概念对齐，但独立定义以避免 DragEngine 反向依赖 Cursor 模型。
 */
export enum DragPhase {
  /** 空闲，无拖拽发生 */
  Idle = 'IDLE',
  /** 已按下并达到触发阈值，即将进入拖拽 */
  Start = 'START',
  /** 拖拽移动中 */
  Move = 'MOVE',
  /** 拖拽结束（落点已确定或取消） */
  Drop = 'DROP',
  /** 拖拽被显式取消（如 ESC / 右键 / detach） */
  Cancel = 'CANCEL',
}

/**
 * 标准化拖拽坐标。
 * client* 为当前视口坐标；top* 为顶层文档坐标（跨 iframe 画布时用于统一坐标系），
 * 从而解决“跨画布拖拽状态同步延迟”中的坐标错位问题。
 */
export interface IDragCoordinate extends IPoint {
  clientX: number
  clientY: number
  pageX: number
  pageY: number
  /** 顶层文档坐标，用于跨 iframe/画布统一定位 */
  topClientX: number
  topClientY: number
  topPageX: number
  topPageY: number
}

/**
 * 拖拽数据来源类型。
 * - Resource：来自组件资源面板的“新建源”，落点后会创建新节点；
 * - Node：来自画布中已存在的节点，落点后会移动节点。
 */
export enum DragSourceType {
  Resource = 'RESOURCE',
  Node = 'NODE',
  Unknown = 'UNKNOWN',
}

/**
 * 单个拖拽源描述（与 TreeNode 解耦，仅保存标识与来源类型）。
 * DragEngine 不直接持有 TreeNode，避免核心拖拽逻辑与树模型耦合。
 */
export interface IDragSource {
  /** 节点或资源的唯一标识 */
  id: string
  /** 来源类型 */
  type: DragSourceType
  /** 触发拖拽的原始宿主元素（供落点计算/预览读取快照，可为空以便无 DOM 环境测试） */
  element?: HTMLElement | null
}

/**
 * 后端产生的标准化拖拽信号负载。
 * 这是 IDragBackend 与 DragEngine 之间唯一的数据契约。
 */
export interface IDragSignal {
  /** 触发本次信号的原始宿主事件目标 */
  target: EventTarget | null
  /** 事件发生的窗口（用于跨 iframe 坐标换算） */
  view: Window | null
  /** 标准化坐标 */
  coordinate: IDragCoordinate
  /** 该信号涉及的拖拽源（仅在 Start 阶段必定存在） */
  sources: IDragSource[]
}

/**
 * DragEngine 对外/对内广播的领域事件负载映射表。
 * 使用映射类型让事件总线的 on/emit 获得端到端类型推导，无需 any。
 */
export interface IDragEventPayloadMap {
  'drag:start': IDragSignal
  'drag:move': IDragSignal
  'drag:drop': IDragSignal
  'drag:cancel': IDragSignal
  /** 阶段变更通知，便于外部只关心状态机而不关心具体信号 */
  'drag:phaseChange': IDragPhaseChangePayload
}

/** 事件总线可用的事件名联合类型 */
export type DragEventName = keyof IDragEventPayloadMap

/** 阶段变更负载 */
export interface IDragPhaseChangePayload {
  previous: DragPhase
  current: DragPhase
}

/**
 * 类型化事件总线契约。
 * 采用发布订阅替代“直接状态传递”，从而让跨画布消费者以最终一致的方式收到同一信号，
 * 消除多处主动读取可变状态带来的时序延迟。
 */
export interface IDragEventBus {
  /** 订阅指定事件，返回取消订阅函数 */
  on<Name extends DragEventName>(
    name: Name,
    handler: (payload: IDragEventPayloadMap[Name]) => void
  ): IDragUnsubscribe
  /** 取消订阅（与 on 返回的函数等价，提供以兼容命令式写法） */
  off<Name extends DragEventName>(
    name: Name,
    handler: (payload: IDragEventPayloadMap[Name]) => void
  ): void
  /** 广播事件 */
  emit<Name extends DragEventName>(
    name: Name,
    payload: IDragEventPayloadMap[Name]
  ): void
  /** 清空所有订阅（detach 时使用） */
  clear(): void
}

/** 取消订阅函数 */
export interface IDragUnsubscribe {
  (): void
}

/**
 * 后端可回调给 DragEngine 的信号入口。
 * 后端只依赖这个窄接口，不依赖 DragEngine 全量能力，符合依赖倒置。
 */
export interface IDragBackendHost {
  /** 后端上报“拖拽开始” */
  dispatchStart(signal: IDragSignal): void
  /** 后端上报“拖拽移动” */
  dispatchMove(signal: IDragSignal): void
  /** 后端上报“拖拽落点” */
  dispatchDrop(signal: IDragSignal): void
  /** 后端上报“拖拽取消” */
  dispatchCancel(signal: IDragSignal): void
  /**
   * 将原始宿主事件解析为标准化拖拽源。
   * 解析规则（读取 designer 的各类 data-* 属性）由宿主提供，
   * 后端因此无需了解具体 DOM 约定，保持后端可替换。
   */
  resolveSources(target: EventTarget | null): IDragSource[]
  /** 将原始坐标换算为顶层统一坐标系 */
  normalizeCoordinate(
    view: Window | null,
    raw: IRawCoordinate
  ): IDragCoordinate
}

/** 后端从宿主事件中读取到的原始坐标 */
export interface IRawCoordinate {
  clientX: number
  clientY: number
  pageX: number
  pageY: number
}

/**
 * 拖拽后端策略接口（策略模式核心）。
 * 每个后端封装一种“输入采集方式”：指针事件、原生 HTML5 DnD、或桥接既有事件。
 * 后端间可运行时切换而不影响业务落点计算与预览渲染。
 */
export interface IDragBackend {
  /** 后端名称，便于调试与运行时识别 */
  readonly name: string
  /**
   * 绑定到宿主容器并开始采集输入。
   * @param container 事件监听容器（通常是 document 或画布根）
   * @param host      信号回传入口
   */
  attach(container: EventTarget, host: IDragBackendHost): void
  /** 解绑并清理监听器 */
  detach(container: EventTarget): void
}

/** 后端构造器类型，供 DragEngine 以策略方式实例化 */
export interface IDragBackendClass {
  new (options?: IDragBackendOptions): IDragBackend
}

/** 后端通用可选配置 */
export interface IDragBackendOptions {
  /** 触发拖拽的最小位移阈值（像素），默认 4 */
  dragThreshold?: number
  /** 触发拖拽的最小按压时长（毫秒），默认 10 */
  pressDelay?: number
}

/**
 * 虚拟预览节点。
 * 这是一棵与真实组件完全解耦的轻量结构，供预览渲染器绘制“拖拽影子”。
 * 复杂布局下不再依赖真实 DOM 的实时布局计算，因此表现一致、无抖动。
 */
export interface IVirtualPreviewNode {
  /** 关联的拖拽源标识（可用于渲染层查图标/标题） */
  sourceId: string
  /** 预览显示的文本（如组件标题），由宿主注入，预览层不解析 i18n */
  title: string
  /** 附加子节点，用于多选拖拽时展示层级 */
  children?: IVirtualPreviewNode[]
}

/** 虚拟预览状态（只读快照） */
export interface IDragPreviewState {
  /** 是否可见 */
  visible: boolean
  /** 预览跟随的坐标 */
  coordinate: IDragCoordinate | null
  /** 预览虚拟节点集合 */
  nodes: IVirtualPreviewNode[]
}

/** 空坐标常量，避免各处重复构造 */
export const EMPTY_DRAG_COORDINATE: IDragCoordinate = {
  x: 0,
  y: 0,
  clientX: 0,
  clientY: 0,
  pageX: 0,
  pageY: 0,
  topClientX: 0,
  topClientY: 0,
  topPageX: 0,
  topPageY: 0,
}
