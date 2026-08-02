/**
 * @file 拖拽后端模块导出
 *
 * 重构思路：
 * 1. 统一导出所有后端实现和基类
 * 2. 提供工厂函数自动选择最佳后端
 * 3. 策略模式：使用方可以自由选择或切换后端
 */

import { DragBackendType } from '../types'
import type {
  DragBackendConstructor,
  DragBackendOptions,
  IDragBackend,
  IDragEventBus,
} from '../types'
import { AbstractDragBackend } from './AbstractDragBackend'
import { Html5DragBackend } from './Html5DragBackend'
import { PointerDragBackend } from './PointerDragBackend'

export { AbstractDragBackend, Html5DragBackend, PointerDragBackend }

/**
 * 后端注册表
 * 支持通过名称注册和获取后端构造函数
 */
const backendRegistry: Map<DragBackendType, DragBackendConstructor> = new Map()
backendRegistry.set(DragBackendType.Html5, Html5DragBackend)
backendRegistry.set(DragBackendType.Pointer, PointerDragBackend)

/**
 * 注册自定义拖拽后端
 * @param type - 后端类型标识
 * @param backendClass - 后端构造函数
 */
export function registerDragBackend(
  type: DragBackendType,
  backendClass: DragBackendConstructor
): void {
  backendRegistry.set(type, backendClass)
}

/**
 * 创建拖拽后端实例
 * @param type - 后端类型
 * @param eventBus - 事件总线
 * @param options - 后端配置
 */
export function createDragBackend(
  type: DragBackendType,
  eventBus: IDragEventBus,
  options?: DragBackendOptions
): IDragBackend {
  const BackendClass = backendRegistry.get(type)
  if (!BackendClass) {
    throw new Error(`未注册的拖拽后端类型: ${type}`)
  }
  return new BackendClass(eventBus, options)
}

/**
 * 自动检测并创建最佳可用后端
 *
 * 检测顺序：
 * 1. Pointer Events（现代浏览器，统一鼠标/触摸）
 * 2. HTML5鼠标事件（兼容方案）
 *
 * @param eventBus - 事件总线
 * @param options - 后端配置
 */
export function createBestBackend(
  eventBus: IDragEventBus,
  options?: DragBackendOptions
): IDragBackend {
  if (PointerDragBackend.isSupported()) {
    return createDragBackend(DragBackendType.Pointer, eventBus, options)
  }
  return createDragBackend(DragBackendType.Html5, eventBus, options)
}
