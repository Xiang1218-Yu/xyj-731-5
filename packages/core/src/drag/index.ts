/**
 * 拖拽系统模块（DragEngine）
 *
 * 模块划分（单一职责）：
 * - types.ts                  拖拽系统全部类型定义
 * - guards.ts                 系统边界的运行时类型守卫（替代强制类型转换）
 * - DragEngine.ts             拖拽会话编排（节点解析/放置执行/状态快照）
 * - DragEventBus.ts           拖拽事件总线（跨画布状态同步通道）
 * - DragPreviewRenderer.ts    虚拟DOM拖拽预览渲染器（与真实组件解耦）
 * - backends/LegacyDragBackend.ts   HTML5 拖拽后端策略（默认，向后兼容）
 * - backends/PointerDragBackend.ts  Pointer 拖拽后端策略（复杂布局下表现一致）
 */
export * from './types'
export * from './guards'
export * from './DragEventBus'
export * from './DragPreviewRenderer'
export * from './DragEngine'
export * from './backends/LegacyDragBackend'
export * from './backends/PointerDragBackend'
