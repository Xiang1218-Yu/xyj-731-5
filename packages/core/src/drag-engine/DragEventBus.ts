import {
  DragEventName,
  IDragEventBus,
  IDragEventPayloadMap,
  IDragUnsubscribe,
} from './types'

/**
 * ============================================================================
 * DragEventBus —— 类型化拖拽事件总线
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：仅负责“事件的订阅 / 取消订阅 / 广播”，不含任何拖拽业务逻辑。
 *
 * 重构思路：
 *   旧实现里，DragDropDriver 通过 engine.dispatch 直接把事件塞进全局订阅器，
 *   而消费方（MoveHelper / GhostWidget）各自主动读取 Cursor 等可变状态。这种
 *   “边广播边主动拉取状态”的混合模式在跨画布场景下产生时序竞争。
 *
 *   这里改为纯粹的“推”模型：DragEngine 只在一处计算好标准信号后 emit，所有
 *   消费者被动接收同一份不可变负载，天然消除多副本状态不同步的延迟问题。
 *
 *   泛型映射（IDragEventPayloadMap）保证 emit / on 的负载类型端到端可推导，
 *   全程不使用 any。
 * ============================================================================
 */

/** 单个事件名对应的处理器集合类型 */
type DragEventHandler<Name extends DragEventName> = (
  payload: IDragEventPayloadMap[Name]
) => void

export class DragEventBus implements IDragEventBus {
  /**
   * 事件名 -> 处理器集合。
   * 使用 Set 便于去重与 O(1) 删除；用 unknown 承载不同事件的处理器，
   * 在 on/off/emit 边界处通过泛型收窄，对外表现为完全类型安全。
   */
  private handlers: Map<DragEventName, Set<DragEventHandler<DragEventName>>> =
    new Map()

  on<Name extends DragEventName>(
    name: Name,
    handler: DragEventHandler<Name>
  ): IDragUnsubscribe {
    let group = this.handlers.get(name)
    if (!group) {
      group = new Set()
      this.handlers.set(name, group)
    }
    // 处理器实际签名由 Name 约束，此处以基类签名存储，emit 时按 Name 分发保证一致
    group.add(handler as DragEventHandler<DragEventName>)
    return () => this.off(name, handler)
  }

  off<Name extends DragEventName>(
    name: Name,
    handler: DragEventHandler<Name>
  ): void {
    const group = this.handlers.get(name)
    if (!group) return
    group.delete(handler as DragEventHandler<DragEventName>)
    if (group.size === 0) {
      this.handlers.delete(name)
    }
  }

  emit<Name extends DragEventName>(
    name: Name,
    payload: IDragEventPayloadMap[Name]
  ): void {
    const group = this.handlers.get(name)
    if (!group) return
    // 复制一份快照，避免处理器在回调中增删订阅导致遍历异常
    const snapshot = Array.from(group)
    for (const handler of snapshot) {
      ;(handler as DragEventHandler<Name>)(payload)
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
