/**
 * @file 拖拽事件总线
 *
 * 重构思路：
 * 1. 替代原有的直接状态传递和方法调用，实现发布-订阅模式
 * 2. 完全类型安全，事件名与payload类型严格对应
 * 3. 支持 once、off、removeAllListeners 等完整事件API
 * 4. 事件总线是连接 DragBackend、DragEngine、DragPreview 的桥梁
 * 5. 各模块通过事件通信，彼此不直接依赖，实现解耦
 */

import type {
  DragEventMap,
  IDragEventBus,
} from './types'

/**
 * 事件监听器类型
 */
type DragEventListener<K extends keyof DragEventMap> = (
  payload: DragEventMap[K]
) => void | boolean

/**
 * 拖拽事件总线实现
 *
 * 使用示例：
 * ```typescript
 * const bus = new DragEventBus()
 * const unsubscribe = bus.on('drag:start', (payload) => {
 *   console.log('拖拽开始', payload.dragNodes)
 * })
 * bus.emit('drag:start', { dragNodes: [...], ... })
 * unsubscribe() // 取消订阅
 * ```
 */
export class DragEventBus implements IDragEventBus {
  /**
   * 事件监听器存储
   * 使用 Map 结构，key为事件名，value为监听器集合
   */
  private listeners: Map<
    keyof DragEventMap,
    Set<DragEventListener<keyof DragEventMap>>
  > = new Map()

  /**
   * 只触发一次的监听器存储
   */
  private onceListeners: Map<
    keyof DragEventMap,
    Set<DragEventListener<keyof DragEventMap>>
  > = new Map()

  /**
   * 订阅事件
   * @param event - 事件名称
   * @param listener - 事件监听器
   * @returns 取消订阅函数
   */
  on<K extends keyof DragEventMap>(
    event: K,
    listener: DragEventListener<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners
      .get(event)!
      .add(listener as DragEventListener<keyof DragEventMap>)

    return () => this.off(event, listener)
  }

  /**
   * 订阅事件，只触发一次
   * @param event - 事件名称
   * @param listener - 事件监听器
   * @returns 取消订阅函数
   */
  once<K extends keyof DragEventMap>(
    event: K,
    listener: DragEventListener<K>
  ): () => void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set())
    }
    this.onceListeners
      .get(event)!
      .add(listener as DragEventListener<keyof DragEventMap>)

    return () => this.off(event, listener)
  }

  /**
   * 取消订阅事件
   * @param event - 事件名称
   * @param listener - 要移除的事件监听器
   */
  off<K extends keyof DragEventMap>(
    event: K,
    listener: DragEventListener<K>
  ): void {
    const listenerSet = this.listeners.get(event)
    if (listenerSet) {
      listenerSet.delete(listener as DragEventListener<keyof DragEventMap>)
    }

    const onceSet = this.onceListeners.get(event)
    if (onceSet) {
      onceSet.delete(listener as DragEventListener<keyof DragEventMap>)
    }
  }

  /**
   * 派发事件
   * @param event - 事件名称
   * @param payload - 事件数据
   * @returns 如果有任一监听器返回 false，则返回 false；否则返回 true
   */
  emit<K extends keyof DragEventMap>(
    event: K,
    payload: DragEventMap[K]
  ): boolean {
    let result = true

    // 触发普通监听器
    const listenerSet = this.listeners.get(event)
    if (listenerSet) {
      listenerSet.forEach((listener) => {
        if (listener(payload) === false) {
          result = false
        }
      })
    }

    // 触发一次性监听器，执行后自动移除
    const onceSet = this.onceListeners.get(event)
    if (onceSet) {
      onceSet.forEach((listener) => {
        if (listener(payload) === false) {
          result = false
        }
      })
      onceSet.clear()
    }

    return result
  }

  /**
   * 移除所有事件监听器
   */
  removeAllListeners(): void {
    this.listeners.clear()
    this.onceListeners.clear()
  }

  /**
   * 获取指定事件的监听器数量
   * 主要用于调试和测试
   */
  listenerCount(event: keyof DragEventMap): number {
    const normalCount = this.listeners.get(event)?.size ?? 0
    const onceCount = this.onceListeners.get(event)?.size ?? 0
    return normalCount + onceCount
  }
}
