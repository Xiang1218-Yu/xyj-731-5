import { IDragSource, IVirtualPreviewNode } from '../../drag-engine'
import { Engine } from '../Engine'

/**
 * ============================================================================
 * PreviewNodeFactory —— 虚拟预览节点工厂
 * ----------------------------------------------------------------------------
 * 单一职责：仅负责由拖拽源生成虚拟预览节点（标题等展示信息），
 * 供预览层渲染，预览层因此无需解析业务模型。
 *
 * 拆分自原 DragEngineAdapter：预览节点的“取标题”策略（未来可能加图标、层级、
 * 多选缩略）与坐标换算 / DOM 解析 / 桥接无关，独立成类后可单独扩展。
 * ============================================================================
 */
export class PreviewNodeFactory {
  private readonly engine: Engine

  constructor(engine: Engine) {
    this.engine = engine
  }

  /** 由拖拽源生成虚拟预览节点集合 */
  create(sources: IDragSource[]): IVirtualPreviewNode[] {
    return sources.map((source) => {
      // 预览标题优先取真实节点标题；取不到时回退为标识，预览层不再解析业务
      const node = this.engine.findNodeById(source.id)
      const title =
        (node?.designerProps?.title as string) ??
        node?.componentName ??
        source.id
      return { sourceId: source.id, title }
    })
  }
}
