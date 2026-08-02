/**
 * @file 拖拽系统模块入口
 *
 * 重构思路：
 * 1. 统一导出拖拽系统的所有公共API
 * 2. 提供清晰的模块边界，外部只通过此入口访问
 * 3. 向后兼容：原有的 DragDropDriver、MoveHelper、useDragDropEffect 保持不变
 *
 * 模块架构：
 *   DragEngine（门面/协调者）
 *     ├── EventBus（事件总线，发布-订阅）
 *     ├── DragContext（状态管理）
 *     ├── DragPreviewRenderer（虚拟DOM预览）
 *     └── IDragBackend（策略接口）
 *          ├── Html5DragBackend（鼠标事件后端）
 *          └── PointerDragBackend（Pointer Events后端）
 */

// 类型导出
export {
  DragState,
  DragSourceType,
  DragBackendType,
} from './types'

export type {
  DragStartPayload,
  DragMovePayload,
  DragEndPayload,
  DragDropPayload,
  DragEventMap,
  DragPreviewVNode,
  DragPreviewVNodeProps,
  DragPreviewOptions,
  DragBackendOptions,
  IDragBackend,
  IDragEventBus,
  DragBackendConstructor,
  DragContextState,
} from './types'

// 核心模块
export { DragEventBus } from './EventBus'
export { DragContext } from './DragContext'
export type { StartDragParams, UpdateDragParams } from './DragContext'
export { DragEngine } from './DragEngine'
export type { DragEngineOptions } from './DragEngine'
export { DragPreviewRenderer, createVNodeFromElement } from './DragPreview'

// 后端模块
export {
  AbstractDragBackend,
  Html5DragBackend,
  PointerDragBackend,
  createDragBackend,
  createBestBackend,
  registerDragBackend,
} from './backends'
