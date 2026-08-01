import { IDragBackend, IDragBackendHost, IDragBackendOptions } from '../types'

/**
 * ============================================================================
 * AbstractDragBackend —— 拖拽后端抽象基类（策略模式的抽象角色）
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：沉淀所有后端共享的“阈值判定 / host 持有 / 配置归一”逻辑，
 * 让具体后端只关注各自的输入采集差异。
 *
 * 重构思路：
 *   原 DragDropDriver 把“按压阈值判定 + DnD 监听 + 坐标换算 + 事件派发”糅在
 *   一个类里。抽象基类将“通用能力”上提，使新增后端（如触摸屏、无障碍键盘拖拽）
 *   只需实现 attach/detach 两个方法即可接入，符合开闭原则。
 * ============================================================================
 */
export abstract class AbstractDragBackend implements IDragBackend {
  abstract readonly name: string

  /** 归一化后的配置，子类可直接读取 */
  protected readonly options: Required<IDragBackendOptions>

  /** 信号回传入口，attach 时由 DragEngine 注入 */
  protected host: IDragBackendHost | null = null

  /**
   * @param options 后端可选配置；未提供的项使用默认值（阈值 4px、按压时长 10ms）
   */
  constructor(options?: IDragBackendOptions) {
    this.options = {
      dragThreshold: options?.dragThreshold ?? 4,
      pressDelay: options?.pressDelay ?? 10,
    }
  }

  /**
   * 判断从按下点到当前点的位移与耗时是否越过拖拽触发阈值。
   * 抽离为受保护方法，供 PointerDragBackend 等复用。
   * @param startX    按下点 X（clientX）
   * @param startY    按下点 Y（clientY）
   * @param currentX  当前点 X（clientX）
   * @param currentY  当前点 Y（clientY）
   * @param pressedAt 按下时间戳（毫秒）
   * @returns 同时满足按压时长与位移距离阈值时返回 true
   */
  protected isOverThreshold(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
    pressedAt: number
  ): boolean {
    const distance = Math.sqrt(
      Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2)
    )
    const elapsed = Date.now() - pressedAt
    return (
      elapsed > this.options.pressDelay && distance > this.options.dragThreshold
    )
  }

  /**
   * 绑定到宿主容器并开始采集输入（由具体后端实现）。
   * @param container 事件监听容器
   * @param host      信号回传入口，供后端上报标准拖拽信号
   */
  abstract attach(container: EventTarget, host: IDragBackendHost): void

  /**
   * 解绑并清理监听器（由具体后端实现）。
   * @param container 之前 attach 的同一容器
   */
  abstract detach(container: EventTarget): void
}
