import { IDragCoordinate, IRawCoordinate } from '../../drag-engine'
import { globalThisPolyfill } from '@designable/shared'

/**
 * ============================================================================
 * CoordinateTransformer —— 坐标换算器
 * ----------------------------------------------------------------------------
 * 单一职责：仅负责把某个窗口内的原始坐标换算为“顶层文档统一坐标系”，
 * 复用既有 iframe 缩放换算规则，用于跨 iframe / 缩放画布下的一致定位。
 *
 * 拆分自原 DragEngineAdapter：坐标换算是纯函数式计算，与 DOM 解析 / 事件桥接 /
 * 预览生成互不相关，独立成类后可单独测试与替换。
 * ============================================================================
 */
export class CoordinateTransformer {
  /** 将窗口内原始坐标换算为顶层统一坐标 */
  toTopCoordinate(view: Window | null, raw: IRawCoordinate): IDragCoordinate {
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
    // 顶层窗口：顶层坐标与原始坐标一致
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
}
