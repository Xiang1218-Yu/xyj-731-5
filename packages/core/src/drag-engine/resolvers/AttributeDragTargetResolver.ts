/**
 * ============================================================================
 *  AttributeDragTargetResolver —— 基于 DOM 属性的拖拽目标解析器
 * ============================================================================
 *
 *  职责（单一职责原则）：
 *    根据当前指针位置，识别命中的可放置目标节点，并给出放置位置语义。
 *    与旧实现不同的是，这里只负责「DOM 层面的命中检测与方向判定」，
 *    不直接调用 TreeNode 的插入逻辑。真正的节点变更由业务层在订阅
 *    drag:engine:drop 事件后执行，从而保证拖拽引擎与组件树模型解耦。
 *
 *  放置位置的判定（DragDropPosition）：
 *    - 指针落在节点矩形内部中部 -> Inner（作为子节点）
 *    - 落在矩形上 / 下边缘       -> Before / After（作为兄弟节点）
 *    - 命中节点不可放置          -> Forbid
 *
 *  业务层可以通过实现 IDragTargetResolver 完全替换该解析器，
 *  例如实现网格布局的列插入、自由布局的坐标吸附等自定义行为。
 * ============================================================================
 */

import {
  DragDropPosition,
} from '../types'
import type {
  DragTarget,
  IDragTargetResolver,
  DragPointerData,
  DragSession,
} from '../types'

export interface IAttributeTargetResolverConfig {
  /** 画布节点 id 属性名 */
  nodeIdAttrName?: string
  /** 大纲节点 id 属性名 */
  outlineNodeIdAttrName?: string
  /** 边缘判定的灵敏度（像素），越小越容易触发兄弟插入 */
  edgeThreshold?: number
}

export class AttributeDragTargetResolver implements IDragTargetResolver {
  private readonly config: Required<IAttributeTargetResolverConfig>

  constructor(config: IAttributeTargetResolverConfig = {}) {
    this.config = {
      nodeIdAttrName: config.nodeIdAttrName ?? 'data-designer-node-id',
      outlineNodeIdAttrName:
        config.outlineNodeIdAttrName ?? 'data-designer-outline-node-id',
      edgeThreshold: config.edgeThreshold ?? 10,
    }
  }

  resolve(
    pointer: DragPointerData,
    _session: DragSession
  ): DragTarget | null {
    const target = pointer.target
    if (!(target instanceof HTMLElement)) return null

    const nodeElement = target.closest(
      `[${this.config.nodeIdAttrName}], [${this.config.outlineNodeIdAttrName}]`
    ) as HTMLElement | null

    if (!nodeElement) {
      // 未命中任何节点时，不产生目标，由业务层决定是否回退到根节点。
      return null
    }

    const id =
      nodeElement.getAttribute(this.config.outlineNodeIdAttrName) ??
      nodeElement.getAttribute(this.config.nodeIdAttrName)

    if (!id) return null

    const rect = nodeElement.getBoundingClientRect()
    const position = this.calcPosition(pointer.clientX, pointer.clientY, rect)

    return {
      id,
      payload: id,
      element: nodeElement,
      position,
      // 是否允许放置由业务层结合拖拽源决定；这里默认允许，
      // 业务层可在事件回调中覆盖 target.droppable。
      droppable: position !== DragDropPosition.Forbid,
    }
  }

  /**
   * 根据指针在目标矩形中的相对位置计算放置方向。
   */
  private calcPosition(
    clientX: number,
    clientY: number,
    rect: DOMRect
  ): DragDropPosition {
    if (rect.width === 0 || rect.height === 0) {
      return DragDropPosition.Forbid
    }

    const relativeY = clientY - rect.top
    const relativeX = clientX - rect.left
    const threshold = Math.min(
      this.config.edgeThreshold,
      rect.height * 0.25
    )

    // 垂直方向判定为主（块级布局），同时兼容水平布局的左右判定。
    if (relativeY <= threshold) {
      return DragDropPosition.Before
    }
    if (relativeY >= rect.height - threshold) {
      return DragDropPosition.After
    }
    if (relativeX <= threshold) {
      return DragDropPosition.Upper
    }
    if (relativeX >= rect.width - threshold) {
      return DragDropPosition.Under
    }
    return DragDropPosition.Inner
  }
}
