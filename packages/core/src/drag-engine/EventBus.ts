/**
 * ============================================================================
 *  EventBus —— 类型安全的事件总线
 * ============================================================================
 *
 *  设计目标：
 *    1. 替代过去「直接状态传递」的耦合方式。各画布 / 大纲树 / 预览组件之间
 *       不再互相持有引用，而是通过事件名 + 载荷进行通信，从根本上解决
 *       跨画布拖拽时因层层透传导致的状态同步延迟问题；
 *    2. 借助泛型事件映射表（TEventMap），在「编译期」保证 on/emit 的
 *       事件名与载荷类型一一对应，杜绝运行期因拼写错误或载荷不匹配
 *       引发的隐蔽 bug；
 *    3. 单一职责：本类只负责「订阅 - 发布 - 取消订阅」，
 *       不掺杂任何拖拽业务逻辑。
 *
 *  与 packages/shared 中 Subscribable 的区别：
 *    - Subscribable 是面向「自定义事件对象（instanceof 匹配）」的分发器，
 *      事件载荷类型为 any，适合核心引擎内部既有事件体系；
 *    - EventBus 是面向「字符串事件名 + 强类型载荷」的发布订阅器，
 *      专门服务于新的 DragEngine，二者通过适配器桥接，互不侵入。
 * ============================================================================
 */

import type {
  DragEngineEventMap,
  DragEventHandler,
  Unsubscribe,
} from './types'

/**
 * 事件总线。
 *
 * 使用示例：
 * ```ts
 * const bus = new EventBus()
 * bus.on('drag:engine:start', ({ session }) => { ... })
 * bus.emit('drag:engine:start', { session, pointer })
 * ```
 */
export class EventBus<
  TEventMap extends Record<string, unknown> = DragEngineEventMap
> {
  /**
   * 监听器表。键为事件名，值为「处理函数集合」。
   * 使用 Set 保证同一处理函数不会被重复注册，并支持 O(1) 删除。
   */
  private readonly listeners: Map<
    keyof TEventMap,
    Set<DragEventHandler<TEventMap[keyof TEventMap]>>
  > = new Map()

  /**
   * 订阅一个事件。
   *
   * @param eventName 事件名
   * @param handler   处理函数，参数类型由事件映射表推导
   * @returns         取消订阅函数
   */
  on<K extends keyof TEventMap>(
    eventName: K,
    handler: DragEventHandler<TEventMap[K]>
  ): Unsubscribe {
    let bucket = this.listeners.get(eventName)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(eventName, bucket)
    }
    // 此处的类型断言是安全的：bucket 仅会被同 eventName 的 handler 写入，
    // 而 TEventMap[K] 在同一 eventName 下保持一致。
    bucket.add(
      handler as DragEventHandler<TEventMap[keyof TEventMap]>
    )

    return () => {
      this.off(eventName, handler)
    }
  }

  /**
   * 订阅一个事件，但仅触发一次后自动取消订阅。
   */
  once<K extends keyof TEventMap>(
    eventName: K,
    handler: DragEventHandler<TEventMap[K]>
  ): Unsubscribe {
    const wrapper: DragEventHandler<TEventMap[K]> = (payload) => {
      this.off(eventName, wrapper)
      handler(payload)
    }
    return this.on(eventName, wrapper)
  }

  /**
   * 取消订阅。若不传 handler，则移除该事件名下的所有监听器。
   */
  off<K extends keyof TEventMap>(
    eventName: K,
    handler?: DragEventHandler<TEventMap[K]>
  ): void {
    const bucket = this.listeners.get(eventName)
    if (!bucket) return
    if (handler) {
      bucket.delete(
        handler as DragEventHandler<TEventMap[keyof TEventMap]>
      )
      if (bucket.size === 0) {
        this.listeners.delete(eventName)
      }
    } else {
      this.listeners.delete(eventName)
    }
  }

  /**
   * 发布一个事件，同步调用所有订阅者。
   *
   * 注意：这里刻意保持「同步」语义，以确保拖拽过程中
   * 指针位置、目标解析、预览更新等状态在同一帧内顺序一致，
   * 避免异步派发引入的跨画布状态延迟。
   */
  emit<K extends keyof TEventMap>(eventName: K, payload: TEventMap[K]): void {
    const bucket = this.listeners.get(eventName)
    if (!bucket || bucket.size === 0) return
    // 复制一份再遍历，避免回调中修改集合导致迭代异常。
    const handlers = Array.from(bucket)
    for (const handler of handlers) {
      handler(payload)
    }
  }

  /**
   * 清空所有事件监听器。通常在引擎销毁时调用。
   */
  clear(): void {
    this.listeners.clear()
  }

  /**
   * 获取某事件当前的监听器数量（主要用于调试与测试）。
   */
  listenerCount<K extends keyof TEventMap>(eventName: K): number {
    return this.listeners.get(eventName)?.size ?? 0
  }
}
