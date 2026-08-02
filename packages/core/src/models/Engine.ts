import { IEngineProps } from '../types'
import { ITreeNode, TreeNode } from './TreeNode'
import { Workbench } from './Workbench'
import { Cursor } from './Cursor'
import { Keyboard } from './Keyboard'
import { Screen, ScreenType } from './Screen'
import { Event, uid, globalThisPolyfill } from '@designable/shared'
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
    this.dragEngine?.mount()
  }

  unmount() {
    this.dragEngine?.unmount()
    this.detachEvents()
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
