/**
 * 拖拽系统类型守卫
 *
 * 职责单一：在系统边界（DOM 事件目标）处做运行时收窄，
 * 用类型守卫替代强制类型转换（as HTMLElement），
 * 使「DOM 结构不符合预期」时得到安全的空值结果而非运行时崩溃
 */

/**
 * 判断事件目标是否为可查询的元素节点（HTMLElement 类型守卫）
 *
 * 判定策略：
 * 1. 优先使用 instanceof（同窗口场景最准确）
 * 2. 跨 iframe 场景下元素的构造器不属于顶层窗口，instanceof 失效，
 *    退化为特征检测（closest / getAttribute 方法存在即可安全查询）
 *
 * @param target DOM 事件目标（可能为 null、Window、Document 等非元素节点）
 */
export const isElementTarget = (
  target: EventTarget | null
): target is HTMLElement => {
  if (!target) return false
  // 非浏览器环境（如 SSR）下 HTMLElement 构造器不存在，需先判空
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
    return true
  }
  return 'closest' in target && 'getAttribute' in target
}
