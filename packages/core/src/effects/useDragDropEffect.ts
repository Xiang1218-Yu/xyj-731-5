import { Engine } from '../models'
import {
  DragStartEvent,
  DragMoveEvent,
  DragStopEvent,
  ViewportScrollEvent,
} from '../events'

/**
 * 拖拽放置 Effect（兼容适配层）
 *
 * 重构说明：
 * 拖拽业务逻辑（节点解析、命中计算、放置执行、预览渲染、跨画布状态同步）
 * 已迁移至独立的 DragEngine 模块（见 packages/core/src/drag）。
 * 本 effect 仅保留「订阅引擎事件并委托给 DragEngine」的适配职责，
 * 对外 API（effect 名称、挂载方式）与行为保持向后兼容，
 * DEFAULT_EFFECTS 无需任何改动。
 */
export const useDragDropEffect = (engine: Engine) => {
  engine.subscribeTo(DragStartEvent, (event) => {
    engine.dragEngine.handleDragStart(event)
  })

  engine.subscribeTo(DragMoveEvent, (event) => {
    engine.dragEngine.handleDragMove(event)
  })

  engine.subscribeTo(ViewportScrollEvent, (event) => {
    engine.dragEngine.handleViewportScroll(event)
  })

  engine.subscribeTo(DragStopEvent, () => {
    engine.dragEngine.handleDragStop()
  })
}
