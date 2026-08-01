import { globalThisPolyfill } from '@designable/shared'
import { Engine } from '../../models/Engine'
import { DragDropDriver } from '../../drivers/DragDropDriver'
import { DragBackendType, IDragBackend } from '../types'

/**
 * HTML5 拖拽后端（默认策略，自包含实现）
 *
 * 职责单一：基于原生 HTML5 DnD + 鼠标距离阈值完成拖拽手势采集，
 * 并将手势归一化为 DragStartEvent / DragMoveEvent / DragStopEvent。
 *
 * 自包含说明：
 * 手势采集能力由本后端内部持有的 DragDropDriver 实例提供，
 * 驱动实例的创建、挂载、销毁全部由本后端管理，不再依赖
 * DEFAULT_DRIVERS 中的全局驱动注册——即使外部完全移除
 * DragDropDriver 的注册，本后端依然可独立工作。
 *
 * 向后兼容说明：
 * 内部复用 DragDropDriver 的成熟实现，手势采集行为（阈值、
 * 事件结构、派发时机）与历史版本完全一致。
 */
export class LegacyDragBackend implements IDragBackend {
  readonly type = DragBackendType.Html5

  /** 引擎引用，用于初始化内部驱动 */
  private engine: Engine

  /** 内部持有的手势采集驱动实例（本后端自包含的关键） */
  private driver: DragDropDriver | null = null

  constructor(engine: Engine) {
    this.engine = engine
  }

  attach(): void {
    if (this.driver) return
    const driver = new DragDropDriver(this.engine)
    // 标记归属：告知驱动本实例由后端管理，不触发「外部注册让位」逻辑
    driver.managedByDragEngine = true
    // 与引擎 attachEvents 的挂载语义保持一致：监听顶层 document
    driver.contentWindow = globalThisPolyfill
    driver.container = globalThisPolyfill.document
    driver.attach()
    this.driver = driver
  }

  detach(): void {
    if (!this.driver) return
    this.driver.detach()
    this.driver = null
  }
}
