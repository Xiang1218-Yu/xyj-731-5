import { DragSourceType, IDragSource } from '../../drag-engine'
import { Engine } from '../Engine'

/**
 * ============================================================================
 * DragSourceResolver —— 拖拽源解析器
 * ----------------------------------------------------------------------------
 * 单一职责：仅负责把原始事件目标（DOM）按设计器的 data-designer-* 属性约定
 * 解析为标准拖拽源 IDragSource。它是唯一“懂” DOM 约定的地方。
 *
 * 拆分自原 DragEngineAdapter：DOM 解析规则未来可能随宿主变化（如自定义属性名、
 * 多选拖拽），独立成类后可单独演进而不影响坐标换算 / 桥接 / 预览。
 * ============================================================================
 */
export class DragSourceResolver {
  /** 设计器引擎，提供 data-designer-* 属性名与节点查询 */
  private readonly engine: Engine

  /**
   * @param engine 提供 DOM 属性约定的设计器引擎实例
   */
  constructor(engine: Engine) {
    this.engine = engine
  }

  /** 将原始事件目标解析为标准拖拽源集合 */
  resolve(target: EventTarget | null): IDragSource[] {
    const element = target as HTMLElement | null
    const closest = element?.closest?.(`
      *[${this.engine.props.nodeIdAttrName}],
      *[${this.engine.props.sourceIdAttrName}],
      *[${this.engine.props.outlineNodeIdAttrName}]
    `) as HTMLElement | null
    if (!closest?.getAttribute) return []
    const sourceId = closest.getAttribute(this.engine.props.sourceIdAttrName)
    const nodeId = closest.getAttribute(this.engine.props.nodeIdAttrName)
    const outlineId = closest.getAttribute(
      this.engine.props.outlineNodeIdAttrName
    )
    if (sourceId) {
      return [{ id: sourceId, type: DragSourceType.Resource, element: closest }]
    }
    const id = nodeId || outlineId
    if (id) {
      return [{ id, type: DragSourceType.Node, element: closest }]
    }
    return []
  }
}
