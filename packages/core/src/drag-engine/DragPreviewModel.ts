import { action, define, observable } from '@formily/reactive'
import {
  EMPTY_DRAG_COORDINATE,
  IDragCoordinate,
  IDragPreviewState,
  IVirtualPreviewNode,
} from './types'

/**
 * ============================================================================
 * DragPreviewModel —— 虚拟 DOM 拖拽预览状态模型
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：仅维护“拖拽预览”所需的可观察状态（是否可见、跟随坐标、
 * 虚拟节点集合），不涉及任何真实 DOM 渲染与业务落点逻辑。
 *
 * 重构思路：
 *   旧 GhostWidget 直接读取 Cursor.position 并渲染真实节点标题，预览与真实组件
 *   坐标计算耦合，复杂布局（缩放、嵌套滚动、跨 iframe）下会出现错位与抖动。
 *
 *   本模型把预览抽象成一棵“虚拟节点树 + 一个坐标”，与真实组件彻底解耦：
 *     - 数据侧：DragEngine 在 start 时用拖拽源生成 IVirtualPreviewNode 快照；
 *     - 渲染侧：任意渲染层（React 虚拟预览 Widget）只消费本模型的只读快照，
 *       用 transform 跟随坐标绘制，不再依赖真实组件的实时布局。
 *
 *   借助 @formily/reactive 的可观察能力，渲染层可用 observer 自动响应，
 *   与仓库既有响应式风格保持一致。
 * ============================================================================
 */
export class DragPreviewModel {
  /** 是否可见 */
  visible = false

  /** 预览跟随坐标 */
  coordinate: IDragCoordinate | null = null

  /** 虚拟预览节点集合 */
  nodes: IVirtualPreviewNode[] = []

  constructor() {
    this.makeObservable()
  }

  /** 将预览状态注册为 @formily/reactive 可观察，使渲染层能自动响应 */
  private makeObservable(): void {
    define(this, {
      visible: observable.ref,
      coordinate: observable.ref,
      nodes: observable.ref,
      show: action,
      move: action,
      hide: action,
    })
  }

  /** 开始展示预览（拖拽开始时调用） */
  show(nodes: IVirtualPreviewNode[], coordinate: IDragCoordinate): void {
    this.nodes = nodes
    this.coordinate = coordinate
    this.visible = true
  }

  /** 更新预览坐标（拖拽移动时调用） */
  move(coordinate: IDragCoordinate): void {
    if (!this.visible) return
    this.coordinate = coordinate
  }

  /** 隐藏并清空预览（拖拽结束 / 取消时调用） */
  hide(): void {
    this.visible = false
    this.coordinate = null
    this.nodes = []
  }

  /** 导出只读快照，供无响应式依赖的消费者读取 */
  snapshot(): IDragPreviewState {
    return {
      visible: this.visible,
      coordinate: this.coordinate ?? EMPTY_DRAG_COORDINATE,
      nodes: this.nodes,
    }
  }
}
