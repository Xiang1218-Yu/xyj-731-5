import { IEngineProps } from '../types'
import { ITreeNode, TreeNode } from './TreeNode'
import { Workbench } from './Workbench'
import { Cursor } from './Cursor'
import { Keyboard } from './Keyboard'
import { Screen, ScreenType } from './Screen'
import {
  Event,
  uid,
  globalThisPolyfill,
  EventContainer,
} from '@designable/shared'
import type { DragEngine } from '../drag/DragEngine'

/**
 * 设计器引擎
 */

export class Engine extends Event {
  id: string

  props: IEngineProps<Engine>

  cursor: Cursor

  workbench: Workbench

  keyboard: Keyboard

  screen: Screen

  /**
   * 拖拽引擎实例（重构后的新拖拽系统）
   * 使用策略模式支持不同后端，通过事件总线解耦
   * 当 props.dragEngine === false 时不启用
   */
  dragEngine: DragEngine | null = null

  constructor(props: IEngineProps<Engine>) {
    super(props)
    this.props = {
      ...Engine.defaultProps,
      ...props,
    }
    this.init()
    this.id = uid()
  }

  init() {
    this.workbench = new Workbench(this)
    this.screen = new Screen(this)
    this.cursor = new Cursor(this)
    this.keyboard = new Keyboard(this)
    this.initDragEngine()
  }

  /**
   * 初始化拖拽引擎
   * 当 dragEngine 配置不为 false 时启用新的拖拽系统
   */
  private initDragEngine(): void {
    if (this.props.dragEngine === false) {
      this.dragEngine = null
      return
    }
    // 延迟导入避免循环依赖
    const { DragEngine: DragEngineClass } = require('../drag/DragEngine') as {
      DragEngine: typeof import('../drag/DragEngine').DragEngine
    }
    this.dragEngine = new DragEngineClass(this, this.props.dragEngine || {})
  }

  setCurrentTree(tree?: ITreeNode) {
    if (this.workbench.currentWorkspace) {
      this.workbench.currentWorkspace.operation.tree.from(tree)
    }
  }

  getCurrentTree() {
    return this.workbench?.currentWorkspace?.operation?.tree
  }

  getAllSelectedNodes() {
    let results: TreeNode[] = []
    for (let i = 0; i < this.workbench.workspaces.length; i++) {
      const workspace = this.workbench.workspaces[i]
      results = results.concat(workspace.operation.selection.selectedNodes)
    }
    return results
  }

  findNodeById(id: string) {
    return TreeNode.findById(id)
  }

  findMovingNodes(): TreeNode[] {
    const results = []
    this.workbench.eachWorkspace((workspace) => {
      workspace.operation.moveHelper.dragNodes?.forEach((node) => {
        if (!results.includes(node)) {
          results.push(node)
        }
      })
    })
    return results
  }

  createNode(node: ITreeNode, parent?: TreeNode) {
    return new TreeNode(node, parent)
  }

  mount() {
    this.attachEvents(globalThisPolyfill)
    // attachEvents override 已将后端绑定到顶层 document
    // mount 只负责设置引擎事件监听
    this.dragEngine?.mount()
  }

  unmount() {
    this.dragEngine?.unmount()
    this.detachEvents()
  }

  /**
   * 重写父类 attachEvents，在绑定驱动事件的同时通知 DragEngine 附加到新容器
   * 确保 iframe（沙箱）内的画布节点也能被拖拽后端监听
   */
  attachEvents(
    container: EventContainer,
    contentWindow: Window = globalThisPolyfill,
    context?: unknown
  ) {
    super.attachEvents(container, contentWindow, context as never)
    if (this.dragEngine) {
      // Window 容器在父类中会被转为 document，这里保持一致
      const target = (container as Window)?.document
        ? ((container as Window).document as Document)
        : (container as HTMLElement | Document)
      this.dragEngine.attachContainer(target)
    }
  }

  /**
   * 重写父类 detachEvents，同时通知 DragEngine 从容器解绑
   */
  detachEvents(container?: EventContainer) {
    if (this.dragEngine && container) {
      const target = (container as Window)?.document
        ? ((container as Window).document as Document)
        : (container as HTMLElement | Document)
      this.dragEngine.detachContainer(target)
    }
    super.detachEvents(container)
  }

  static defaultProps: IEngineProps<Engine> = {
    shortcuts: [],
    effects: [],
    drivers: [],
    rootComponentName: 'Root',
    sourceIdAttrName: 'data-designer-source-id',
    nodeIdAttrName: 'data-designer-node-id',
    contentEditableAttrName: 'data-content-editable',
    contentEditableNodeIdAttrName: 'data-content-editable-node-id',
    clickStopPropagationAttrName: 'data-click-stop-propagation',
    nodeSelectionIdAttrName: 'data-designer-node-helpers-id',
    nodeDragHandlerAttrName: 'data-designer-node-drag-handler',
    screenResizeHandlerAttrName: 'data-designer-screen-resize-handler',
    nodeResizeHandlerAttrName: 'data-designer-node-resize-handler',
    outlineNodeIdAttrName: 'data-designer-outline-node-id',
    nodeTranslateAttrName: 'data-designer-node-translate-handler',
    defaultScreenType: ScreenType.PC,
  }
}
