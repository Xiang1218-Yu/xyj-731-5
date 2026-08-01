import { DragEventHandler, DragEventType, IDragEventMap } from './types'

/**
 * 拖拽事件总线
 *
 * 职责单一：仅负责拖拽生命周期事件的发布/订阅。
 *
 * 重构动机：
 * 原先跨画布的拖拽状态同步依赖「遍历所有 workspace 直接读写各自 moveHelper」
 * 的隐式状态传递，状态以响应式轮询方式被感知，存在同步延迟且链路不透明。
 * 事件总线以同步发布的方式广播统一的状态快照（IDragSessionState），
 * 所有画布/预览层在同一时刻拿到同一份数据，从根本上消除同步延迟。
 */
export class DragEventBus {
  /**
   * 订阅者表：事件名 -> 处理器集合
   * 所有事件载荷均为 IDragSessionState 快照，因此可以使用统一的处理器签名存储
   */
  private handlers: Map<DragEventType, Set<DragEventHandler<DragEventType>>> =
    new Map()

  /**
   * 订阅指定类型的拖拽事件
   * @param type 事件名
   * @param handler 事件处理器
   * @returns 取消订阅函数
   */
  subscribe<T extends DragEventType>(
    type: T,
    handler: DragEventHandler<T>
  ): () => void {
    const wrappedHandler = handler as DragEventHandler<DragEventType>
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type).add(wrappedHandler)
    return () => {
      this.unsubscribe(type, handler)
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe<T extends DragEventType>(
    type: T,
    handler: DragEventHandler<T>
  ): void {
    const wrappedHandler = handler as DragEventHandler<DragEventType>
    this.handlers.get(type)?.delete(wrappedHandler)
  }

  /**
   * 同步发布事件
   * 注意：
   * 1. 发布是同步的，保证跨画布订阅方在同一帧内感知状态变化
   * 2. 单个 handler 抛出异常时会被隔离（记录日志后继续执行），
   *    不会中断同事件后续 handler，也不会影响拖拽主流程
   */
  publish<T extends DragEventType>(type: T, payload: IDragEventMap[T]): void {
    this.handlers.get(type)?.forEach((handler) => {
      try {
        handler(payload)
      } catch (error) {
        console.error(
          `[DragEventBus] handler of "${type}" threw an error:`,
          error
        )
      }
    })
  }

  /**
   * 清空所有订阅（引擎销毁时调用）
   */
  clear(): void {
    this.handlers.clear()
  }
}
