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
  private readonly coordinateTransformer: CoordinateTransformer
  private readonly sourceResolver: DragSourceResolver
  private readonly previewFactory: PreviewNodeFactory
  private readonly legacyBridge: LegacyEventBridge

  constructor(engine: Engine) {
    this.coordinateTransformer = new CoordinateTransformer()
    this.sourceResolver = new DragSourceResolver(engine)
    this.previewFactory = new PreviewNodeFactory(engine)
    this.legacyBridge = new LegacyEventBridge(engine)
  }

  getContainer(): EventTarget {
    return globalThisPolyfill
  }

  resolveSources(target: EventTarget | null): IDragSource[] {
    return this.sourceResolver.resolve(target)
  }

  normalizeCoordinate(
    view: Window | null,
    raw: IRawCoordinate
  ): IDragCoordinate {
    return this.coordinateTransformer.toTopCoordinate(view, raw)
  }

  createPreviewNodes(sources: IDragSource[]): IVirtualPreviewNode[] {
    return this.previewFactory.create(sources)
  }

  bridgeStart(signal: IDragSignal): void {
    this.legacyBridge.start(signal)
  }

  bridgeMove(signal: IDragSignal): void {
    this.legacyBridge.move(signal)
  }

  bridgeDrop(signal: IDragSignal): void {
    this.legacyBridge.drop(signal)
  }

  bridgeCancel(signal: IDragSignal): void {
    this.legacyBridge.cancel(signal)
  }
}
