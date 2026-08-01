import { DragBackendType, IDragBackend } from '../types'

/**
 * HTML5 拖拽后端（默认策略）
 *
 * 职责单一：声明「手势采集复用既有 DragDropDriver（原生 HTML5 DnD +
 * 鼠标距离阈值）」这一策略，自身不再绑定任何 DOM 监听。
 *
 * 向后兼容说明：
 * 该后端下，手势事件仍由 DEFAULT_DRIVERS 中的 DragDropDriver 派发为
 * DragStartEvent / DragMoveEvent / DragStopEvent，并由 useDragDropEffect
 * 委托给 DragEngine 处理，行为与重构前完全一致。
 */
export class LegacyDragBackend implements IDragBackend {
  readonly type = DragBackendType.Html5

  attach(): void {
    // 手势采集由既有 DragDropDriver 完成，无需额外监听
  }

  detach(): void {
    // 无资源需要清理
  }
}
