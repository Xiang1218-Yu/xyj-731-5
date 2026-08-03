/**
 * ============================================================================
 *  AttributeDragSourceResolver —— 基于 DOM 属性的拖拽源解析器
 * ============================================================================
 *
 *  职责（单一职责原则）：
 *    根据指针事件命中的 DOM 元素，读取预定义的 data-* 属性，识别出拖拽源。
 *    解析器不依赖 TreeNode / React 组件，只依赖 DOM 契约，因此可以被
 *    画布、大纲树、资源面板等任意宿主复用，真正实现「拖拽逻辑与组件渲染解耦」。
 *
 *  识别优先级（与旧 useDragDropEffect 保持一致，保证向后兼容）：
 *    1. 节点拖拽手柄（nodeDragHandlerAttrName）   -> 画布内节点移动
 *    2. 节点 id 属性（nodeIdAttrName）            -> 画布内节点移动
 *    3. 大纲节点 id 属性（outlineNodeIdAttrName） -> 大纲树节点移动
 *    4. 资源 id 属性（sourceIdAttrName）          -> 从资源面板新增
 *
 *  业务侧可自行实现 IDragSourceResolver 接入更复杂的来源（例如外部文件），
 *  并在构造 DragEngine 时注入，这正是策略模式带来的可扩展性。
 * ============================================================================
 */

import type {
  DragSource,
  DragSourceKind,
  IDragSourceResolver,
  DragPointerData,
} from '../types'

/** 解析器需要的 DOM 属性名集合。 */
export interface IAttributeSourceResolverConfig {
  /** 画布节点 id 属性名，默认 data-designer-node-id */
  nodeIdAttrName?: string
  /** 资源源 id 属性名，默认 data-designer-source-id */
  sourceIdAttrName?: string
  /** 大纲节点 id 属性名，默认 data-designer-outline-node-id */
  outlineNodeIdAttrName?: string
  /** 节点选择区属性名，默认 data-designer-node-helpers-id */
  nodeSelectionIdAttrName?: string
  /** 节点拖拽手柄属性名，默认 data-designer-node-drag-handler */
  nodeDragHandlerAttrName?: string
}

interface IResolvedSource {
  kind: DragSourceKind
  id: string
  element: HTMLElement
  relatedIds: string[]
}

export class AttributeDragSourceResolver implements IDragSourceResolver {
  private readonly config: Required<IAttributeSourceResolverConfig>

  constructor(config: IAttributeSourceResolverConfig = {}) {
    this.config = {
      nodeIdAttrName: config.nodeIdAttrName ?? 'data-designer-node-id',
      sourceIdAttrName:
        config.sourceIdAttrName ?? 'data-designer-source-id',
      outlineNodeIdAttrName:
        config.outlineNodeIdAttrName ?? 'data-designer-outline-node-id',
      nodeSelectionIdAttrName:
        config.nodeSelectionIdAttrName ??
        'data-designer-node-helpers-id',
      nodeDragHandlerAttrName:
        config.nodeDragHandlerAttrName ??
        'data-designer-node-drag-handler',
    }
  }

  resolve(pointer: DragPointerData): DragSource | null {
    const target = pointer.target
    if (!(target instanceof HTMLElement)) return null

    const resolved = this.resolveFromElement(target)
    if (!resolved) return null

    return {
      kind: resolved.kind,
      id: resolved.id,
      // payload 默认即 id，业务层在 DragEngine 的事件回调中可进一步关联实体。
      payload: resolved.id,
      element: resolved.element,
      relatedIds: resolved.relatedIds,
    }
  }

  /**
   * 按优先级从命中元素向上查找可识别的拖拽源。
   */
  private resolveFromElement(target: HTMLElement): IResolvedSource | null {
    const {
      nodeIdAttrName,
      sourceIdAttrName,
      outlineNodeIdAttrName,
      nodeSelectionIdAttrName,
      nodeDragHandlerAttrName,
    } = this.config

    // 1. 优先识别「拖拽手柄」，手柄命中其父级选择区对应的节点。
    const handler = target.closest(`[${nodeDragHandlerAttrName}]`)
    if (handler) {
      const helper = handler.closest(`[${nodeSelectionIdAttrName}]`)
      const nodeId =
        helper?.getAttribute(nodeSelectionIdAttrName) ??
        handler.getAttribute(nodeIdAttrName)
      if (nodeId) {
        return {
          kind: 'Node',
          id: nodeId,
          element: handler as HTMLElement,
          relatedIds: this.collectSelectionIds(helper as HTMLElement | null),
        }
      }
    }

    // 2. 直接命中画布节点。
    const nodeElement = target.closest(
      `[${nodeIdAttrName}], [${outlineNodeIdAttrName}]`
    ) as HTMLElement | null
    if (nodeElement) {
      const nodeId =
        nodeElement.getAttribute(outlineNodeIdAttrName) ??
        nodeElement.getAttribute(nodeIdAttrName)
      if (nodeId) {
        return {
          kind: 'Node',
          id: nodeId,
          element: nodeElement,
          relatedIds: [],
        }
      }
    }

    // 3. 命中资源面板素材。
    const sourceElement = target.closest(
      `[${sourceIdAttrName}]`
    ) as HTMLElement | null
    if (sourceElement) {
      const sourceId = sourceElement.getAttribute(sourceIdAttrName)
      if (sourceId) {
        return {
          kind: 'Resource',
          id: sourceId,
          element: sourceElement,
          relatedIds: [],
        }
      }
    }

    return null
  }

  /**
   * 收集当前处于选中态的节点 id（用于多选拖拽）。
   * 这里仅通过 DOM 上的 data-selected 属性读取，避免对核心 Selection 模型的依赖；
   * 真正的批量选中语义由业务层在处理 drag:engine:start 时结合引擎状态决定。
   */
  private collectSelectionIds(helper: HTMLElement | null): string[] {
    if (!helper) return []
    const selectedAttr = 'data-designer-node-selected'
    const selected = helper.ownerDocument.querySelectorAll<HTMLElement>(
      `[${selectedAttr}="true"]`
    )
    const ids: string[] = []
    selected.forEach((element) => {
      const id = element.getAttribute(this.config.nodeIdAttrName)
      if (id && !ids.includes(id)) ids.push(id)
    })
    return ids
  }
}
