/**
 * ============================================================================
 *  coordinates —— 指针坐标归一化工具
 * ============================================================================
 *
 *  单一职责：把不同来源的原生事件（MouseEvent / PointerEvent / DragEvent）
 *  统一转换为 DragPointerData，并完成跨 iframe 的顶层窗口坐标换算。
 *
 *  说明：该换算逻辑参考了既有 AbstractCursorEvent.transformCoordinates，
 *  被独立提取为纯函数，便于在不同后端中复用，也便于单测。
 * ============================================================================
 */

import { globalThisPolyfill } from '@designable/shared'
import type { DragPointerData } from './types'

/**
 * 可被归一化的原生指针事件类型联合。
 * 不使用 any，列出实际需要读取的字段。
 */
export type NativePointerLike = MouseEvent | PointerEvent | DragEvent

/**
 * 判断给定对象是否为 Window。
 */
function isWindow(value: unknown): value is Window {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Window).window === (value as Window)
  )
}

/**
 * 把原生事件归一化为 DragPointerData。
 *
 * @param nativeEvent 原始事件
 * @param view        事件所在 window，默认取事件自身 view
 */
export function normalizePointerEvent(
  nativeEvent: NativePointerLike,
  view?: Window
): DragPointerData {
  const eventView =
    view ??
    (isWindow((nativeEvent as MouseEvent).view)
      ? (nativeEvent as MouseEvent).view
      : globalThisPolyfill)

  const base: DragPointerData = {
    clientX: nativeEvent.clientX,
    clientY: nativeEvent.clientY,
    pageX: nativeEvent.pageX,
    pageY: nativeEvent.pageY,
    topClientX: nativeEvent.clientX,
    topClientY: nativeEvent.clientY,
    topPageX: nativeEvent.pageX,
    topPageY: nativeEvent.pageY,
    target: nativeEvent.target,
    view: eventView,
    nativeEvent,
  }

  // 跨 iframe 场景：当事件来自子窗口时，需要把坐标换算到顶层窗口坐标系，
  // 否则在不同画布 / 大纲树之间拖拽时命中检测会错位。
  const frameElement = eventView?.frameElement as
    | (HTMLIFrameElement & { offsetWidth: number })
    | null
  if (frameElement && eventView !== globalThisPolyfill) {
    const frameRect = frameElement.getBoundingClientRect()
    // offsetWidth 可能在某些隐藏 frame 上为 0，这里做防御。
    const offsetWidth = frameElement.offsetWidth || frameRect.width || 1
    const scale = frameRect.width / offsetWidth
    // 顶层视口坐标：子窗口 client 坐标 × 缩放 + iframe 在顶层视口中的偏移。
    base.topClientX = nativeEvent.clientX * scale + frameRect.x
    base.topClientY = nativeEvent.clientY * scale + frameRect.y
    // 顶层页面坐标：子窗口 page 坐标已包含子窗口自身滚动，只需叠加
    // iframe 在顶层视口中的偏移即可（不要再减去子窗口 scrollX/Y）。
    base.topPageX = nativeEvent.pageX + frameRect.x
    base.topPageY = nativeEvent.pageY + frameRect.y

    // 命中目标提升到顶层文档，保证跨 frame 拖拽时目标解析准确。
    // elementFromPoint 接收「视口坐标」，因此必须使用 topClientX/Y，
    // 不能传入 topPageX（页面坐标会随顶层滚动而错位）。
    const topElement = document.elementFromPoint(
      base.topClientX,
      base.topClientY
    )
    if (topElement && topElement !== frameElement) {
      base.target = topElement
    }
  }

  return base
}

/**
 * 计算两个指针数据之间的欧氏距离（用于判定是否超过拖拽阈值）。
 */
export function distanceBetween(
  a: DragPointerData,
  b: DragPointerData
): number {
  const dx = a.pageX - b.pageX
  const dy = a.pageY - b.pageY
  return Math.sqrt(dx * dx + dy * dy)
}
