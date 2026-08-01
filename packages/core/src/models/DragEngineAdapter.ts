import {
  DragEngine,
  DragSourceType,
  IDragCoordinate,
  IDragEngineAdapter,
  IDragSignal,
  IDragSource,
  IRawCoordinate,
  IVirtualPreviewNode,
} from '../drag-engine'
import { DragStartEvent, DragMoveEvent, DragStopEvent } from '../events'
import { globalThisPolyfill } from '@designable/shared'
import { Engine } from './Engine'

/**
 * ============================================================================
 * createEngineDragAdapter —— 把 DragEngine 接入设计器 Engine 的宿主适配器
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：仅提供“设计器专属的 DOM 约定 / 坐标换算 / 旧事件桥接 /
 * 预览节点生成”，把宿主相关细节从 DragEngine 中隔离出来。
 *
 * 重构思路：
 *   DragEngine 本身与设计器 Engine 无耦合。真正“懂” data-designer-* 属性约定、
 *   懂 iframe 坐标换算、懂旧 DragStart/DragMove/DragStop 事件的，是这个适配器。
 *   这样既让 DragEngine 可独立复用/测试，又通过 bridge* 把标准信号回放为既有
 *   事件，确保旧的 useDragDropEffect 等逻辑零改动继续工作（向后兼容）。
 * ============================================================================
 */

/** 计算原始坐标到顶层文档坐标的换算（复用既有 iframe 缩放换算规则） */
const toTopCoordinate = (
  view: Window | null,
  raw: IRawCoordinate
): IDragCoordinate => {
  const frameElement = view?.frameElement as HTMLElement | null
  if (frameElement && view && view !== globalThisPolyfill) {
    const frameRect = frameElement.getBoundingClientRect()
    const scale = frameRect.width / frameElement.offsetWidth
    return {
      x: raw.clientX,
      y: raw.clientY,
      clientX: raw.clientX,
      clientY: raw.clientY,
      pageX: raw.pageX,
      pageY: raw.pageY,
      topClientX: raw.clientX * scale + frameRect.x,
      topClientY: raw.clientY * scale + frameRect.y,
      topPageX: raw.pageX + frameRect.x - view.scrollX,
      topPageY: raw.pageY + frameRect.y - view.scrollY,
    }
  }
  return {
    x: raw.clientX,
    y: raw.clientY,
    clientX: raw.clientX,
    clientY: raw.clientY,
    pageX: raw.pageX,
    pageY: raw.pageY,
    topClientX: raw.clientX,
    topClientY: raw.clientY,
    topPageX: raw.pageX,
    topPageY: raw.pageY,
  }
}

/** 把标准信号还原为旧 Cursor 事件所需的数据结构 */
const toLegacyEventData = (signal: IDragSignal) => ({
  clientX: signal.coordinate.clientX,
  clientY: signal.coordinate.clientY,
  pageX: signal.coordinate.pageX,
  pageY: signal.coordinate.pageY,
  target: signal.target,
  view: signal.view ?? globalThisPolyfill,
})

/** 创建绑定到指定 Engine 的适配器 */
export const createEngineDragAdapter = (
  engine: Engine
): IDragEngineAdapter => ({
  getContainer: () => globalThisPolyfill,

  resolveSources: (target) => {
    const element = target as HTMLElement | null
    const closest = element?.closest?.(`
      *[${engine.props.nodeIdAttrName}],
      *[${engine.props.sourceIdAttrName}],
      *[${engine.props.outlineNodeIdAttrName}]
    `) as HTMLElement | null
    if (!closest?.getAttribute) return []
    const sourceId = closest.getAttribute(engine.props.sourceIdAttrName)
    const nodeId = closest.getAttribute(engine.props.nodeIdAttrName)
    const outlineId = closest.getAttribute(engine.props.outlineNodeIdAttrName)
    if (sourceId) {
      return [{ id: sourceId, type: DragSourceType.Resource, element: closest }]
    }
    const id = nodeId || outlineId
    if (id) {
      return [{ id, type: DragSourceType.Node, element: closest }]
    }
    return []
  },

  normalizeCoordinate: (view, raw) => toTopCoordinate(view, raw),

  createPreviewNodes: (sources): IVirtualPreviewNode[] =>
    sources.map((source: IDragSource) => {
      // 预览标题优先取真实节点标题；取不到时回退为标识，预览层不再解析业务
      const node = engine.findNodeById(source.id)
      const title =
        (node?.designerProps?.title as string) ??
        node?.componentName ??
        source.id
      return { sourceId: source.id, title }
    }),

  // 向后兼容：把标准信号回放为既有事件，旧 effects 无需改动
  bridgeStart: (signal) =>
    engine.dispatch(new DragStartEvent(toLegacyEventData(signal))),
  bridgeMove: (signal) =>
    engine.dispatch(new DragMoveEvent(toLegacyEventData(signal))),
  bridgeDrop: (signal) =>
    engine.dispatch(new DragStopEvent(toLegacyEventData(signal))),
  bridgeCancel: (signal) =>
    engine.dispatch(new DragStopEvent(toLegacyEventData(signal))),
})

/** 工厂：创建并配置好设计器专用的 DragEngine 实例 */
export const createDesignerDragEngine = (engine: Engine): DragEngine =>
  new DragEngine(createEngineDragAdapter(engine))
