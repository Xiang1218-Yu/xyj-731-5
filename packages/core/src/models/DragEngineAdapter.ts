import { DragEngine, IDragEngineAdapter } from '../drag-engine'
import { EngineDragAdapter } from './drag-adapter'
import { Engine } from './Engine'

/**
 * ============================================================================
 * 设计器拖拽引擎装配入口
 * ----------------------------------------------------------------------------
 * 原本集中在此文件的“坐标换算 / DOM 解析 / 预览生成 / 旧事件桥接”已按单一职责
 * 拆分到 ./drag-adapter 下的四个协作者，并由 EngineDragAdapter 组合。
 * 本文件仅保留对外的装配工厂，维持既有导出 API 不变（向后兼容）。
 * ============================================================================
 */

/** 创建绑定到指定 Engine 的适配器（委派给拆分后的组合适配器） */
export const createEngineDragAdapter = (
  engine: Engine
): IDragEngineAdapter => new EngineDragAdapter(engine)

/** 工厂：创建并配置好设计器专用的 DragEngine 实例 */
export const createDesignerDragEngine = (engine: Engine): DragEngine =>
  new DragEngine(createEngineDragAdapter(engine))

export * from './drag-adapter'
