import {
  IDragCoordinate,
  IDragEngineAdapter,
  IDragSignal,
  IDragSource,
  IRawCoordinate,
  IVirtualPreviewNode,
} from '../../drag-engine'
import { globalThisPolyfill } from '@designable/shared'
import { Engine } from '../Engine'
import { CoordinateTransformer } from './CoordinateTransformer'
import { DragSourceResolver } from './DragSourceResolver'
import { PreviewNodeFactory } from './PreviewNodeFactory'
import { LegacyEventBridge } from './LegacyEventBridge'

/**
 * ============================================================================
 * EngineDragAdapter —— 设计器拖拽适配器（组合根 / Facade）
 * ----------------------------------------------------------------------------
 * 单一职责：仅负责“组合装配”，把 IDragEngineAdapter 契约的各方法委派给四个各司
 * 其职的协作者，自身不含任何具体算法。
 *
 * 拆分思路：
 *   原 createEngineDragAdapter 把“坐标换算 / DOM 解析 / 预览生成 / 旧事件桥接”
 *   四类逻辑塞进同一个工厂闭包，违反单一职责。现按关注点拆为四个可独立测试、
 *   独立演进的协作者：
 *     - CoordinateTransformer：坐标换算
 *     - DragSourceResolver：DOM 拖拽源解析
 *     - PreviewNodeFactory：虚拟预览节点生成
 *     - LegacyEventBridge：旧事件桥接（向后兼容）
 *   本类作为组合根把它们装配为 DragEngine 需要的适配器契约。
 * ============================================================================
 */
export class EngineDragAdapter implements IDragEngineAdapter {
  /** 坐标换算协作者：把窗口内原始坐标换算为顶层统一坐标系 */
  private readonly coordinateTransformer: CoordinateTransformer

  /** 拖拽源解析协作者：按 data-designer-* 约定把 DOM 目标解析为标准拖拽源 */
  private readonly sourceResolver: DragSourceResolver

  /** 预览节点工厂协作者：由拖拽源生成虚拟预览节点 */
  private readonly previewFactory: PreviewNodeFactory

  /** 旧事件桥接协作者：把标准信号回放为既有拖拽事件（向后兼容） */
  private readonly legacyBridge: LegacyEventBridge

  /**
   * 组合装配四个协作者。
   * @param engine 设计器引擎实例，作为解析/预览/桥接所需的宿主上下文
   */
  constructor(engine: Engine) {
    this.coordinateTransformer = new CoordinateTransformer()
    this.sourceResolver = new DragSourceResolver(engine)
    this.previewFactory = new PreviewNodeFactory(engine)
    this.legacyBridge = new LegacyEventBridge(engine)
  }

  /**
   * 返回后端监听的事件容器。
   * 设计器统一在顶层 window 上采集拖拽输入，以覆盖跨 iframe 画布。
   */
  getContainer(): EventTarget {
    return globalThisPolyfill
  }

  /**
   * 将原始事件目标解析为标准拖拽源集合。
   * @param target 触发拖拽的原始 DOM 事件目标
   * @returns 解析出的拖拽源；无有效来源时返回空数组
   */
  resolveSources(target: EventTarget | null): IDragSource[] {
    return this.sourceResolver.resolve(target)
  }

  /**
   * 将某窗口内的原始坐标换算为顶层统一坐标系。
   * @param view 事件发生的窗口（可能是 iframe 画布），为空时按顶层处理
   * @param raw  原始坐标
   * @returns 含顶层坐标的标准化坐标
   */
  normalizeCoordinate(
    view: Window | null,
    raw: IRawCoordinate
  ): IDragCoordinate {
    return this.coordinateTransformer.toTopCoordinate(view, raw)
  }

  /**
   * 由拖拽源生成虚拟预览节点，供预览层渲染。
   * @param sources 当前拖拽源集合
   * @returns 虚拟预览节点集合
   */
  createPreviewNodes(sources: IDragSource[]): IVirtualPreviewNode[] {
    return this.previewFactory.create(sources)
  }

  /** 向后兼容：把“拖拽开始”标准信号回放为旧 DragStartEvent */
  bridgeStart(signal: IDragSignal): void {
    this.legacyBridge.start(signal)
  }

  /** 向后兼容：把“拖拽移动”标准信号回放为旧 DragMoveEvent */
  bridgeMove(signal: IDragSignal): void {
    this.legacyBridge.move(signal)
  }

  /** 向后兼容：把“拖拽落点”标准信号回放为旧 DragStopEvent */
  bridgeDrop(signal: IDragSignal): void {
    this.legacyBridge.drop(signal)
  }

  /** 向后兼容：把“拖拽取消”标准信号回放为旧 DragStopEvent */
  bridgeCancel(signal: IDragSignal): void {
    this.legacyBridge.cancel(signal)
  }
}
