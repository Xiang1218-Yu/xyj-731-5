/**
 * ============================================================================
 *  drag-engine 模块统一导出
 * ============================================================================
 *
 *  对外暴露：
 *    - DragEngine        核心引擎
 *    - EventBus          类型安全事件总线
 *    - DragEngineDriver  向后兼容的旧 EventDriver 适配器
 *    - 两种后端策略      PointerDragBackend / Html5DragBackend
 *    - 默认解析器        AttributeDragSourceResolver / AttributeDragTargetResolver
 *    - 虚拟预览渲染器    VirtualPreviewRenderer
 *    - 全部类型定义
 *
 *  使用方可按需 import，实现自定义拖拽行为时推荐：
 *    1. 实现 IDragBackend 接入自定义输入源；
 *    2. 实现 IDragSourceResolver / IDragTargetResolver 自定义命中规则；
 *    3. 实现 IDragPreviewProvider 自定义预览；
 *    4. 通过 engine.on('drag:engine:drop', ...) 执行业务落位。
 * ============================================================================
 */

export * from './types'
export * from './EventBus'
export * from './DragEngine'
export * from './DragEngineDriver'
export * from './coordinates'
export * from './backends/PointerDragBackend'
export * from './backends/Html5DragBackend'
export * from './preview/VirtualPreviewRenderer'
export * from './resolvers/AttributeDragSourceResolver'
export * from './resolvers/AttributeDragTargetResolver'
