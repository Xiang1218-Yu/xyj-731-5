import { globalThisPolyfill } from '@designable/shared'
import { IDragPreviewNode } from './types'

/**
 * 小驼峰样式名转 kebab-case
 * 例如 backgroundColor -> background-color
 */
const toKebabCase = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/**
 * 拖拽预览渲染器（虚拟DOM实现）
 *
 * 职责单一：只负责把「预览描述（IDragPreviewNode）」渲染成真实 DOM 浮层，
 * 并跟随手势移动，不参与任何拖拽业务判定。
 *
 * 重构动机：
 * 原先拖拽预览依赖原生 HTML5 DnD 的拖拽影像 + 业务组件（GhostWidget 直接
 * 读取真实节点组件渲染），在缩放/嵌套滚动/iframe 等复杂布局下影像位置与
 * 样式表现不一致。这里改为：业务侧只产出一份与组件无关的虚拟DOM描述，
 * 渲染器用 document.createElement 同步物化为浮层元素，位置用 transform
 * 精确控制，从而与真实组件完全解耦、跨布局表现一致。
 */
export class DragPreviewRenderer {
  /** 预览浮层宿主元素（挂载在顶层 document.body 上） */
  private hostElement: HTMLDivElement | null = null

  /** 当前已渲染的虚拟DOM描述，用于做引用比对避免重复渲染 */
  private currentDescriptor: IDragPreviewNode | null = null

  /**
   * 渲染（或更新）预览内容
   * 采用轻量 reconcile 策略：描述引用未变化时不重复渲染；
   * 描述变化时整体重建浮层内容（预览结构简单，重建成本极低）
   */
  render(descriptor: IDragPreviewNode): void {
    if (descriptor === this.currentDescriptor) return
    this.currentDescriptor = descriptor
    const host = this.ensureHostElement()
    host.innerHTML = ''
    host.appendChild(this.createDomElement(descriptor))
    host.style.display = 'block'
  }

  /**
   * 移动预览浮层到指定视口坐标
   * 使用 translate3d 触发合成层，避免引起文档流重排
   */
  moveTo(clientX: number, clientY: number): void {
    if (!this.hostElement) return
    this.hostElement.style.transform = `perspective(1px) translate3d(${
      clientX + 12
    }px, ${clientY + 12}px, 0)`
  }

  /**
   * 隐藏并清空预览（拖拽结束时调用）
   */
  clear(): void {
    this.currentDescriptor = null
    if (this.hostElement) {
      this.hostElement.style.display = 'none'
      this.hostElement.innerHTML = ''
    }
  }

  /**
   * 销毁浮层（引擎卸载时调用）
   */
  destroy(): void {
    this.clear()
    if (this.hostElement?.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement)
    }
    this.hostElement = null
  }

  /**
   * 惰性创建浮层宿主元素
   * 浮层脱离业务组件树，fixed 定位 + 最高层级 + 禁用指针事件，
   * 保证不会干扰画布内的命中计算
   */
  private ensureHostElement(): HTMLDivElement {
    if (this.hostElement) return this.hostElement
    const host = globalThisPolyfill.document.createElement('div')
    host.setAttribute('data-designer-drag-preview', 'true')
    host.style.position = 'fixed'
    host.style.left = '0'
    host.style.top = '0'
    host.style.zIndex = '99999'
    host.style.pointerEvents = 'none'
    host.style.display = 'none'
    globalThisPolyfill.document.body.appendChild(host)
    this.hostElement = host
    return host
  }

  /**
   * 将虚拟DOM描述物化为真实 DOM 元素（递归）
   */
  private createDomElement(descriptor: IDragPreviewNode): HTMLElement {
    const element = globalThisPolyfill.document.createElement(
      descriptor.tagName
    )
    if (descriptor.className) {
      element.className = descriptor.className
    }
    if (descriptor.attributes) {
      Object.keys(descriptor.attributes).forEach((name) => {
        element.setAttribute(name, descriptor.attributes[name])
      })
    }
    if (descriptor.styles) {
      Object.keys(descriptor.styles).forEach((name) => {
        element.style.setProperty(toKebabCase(name), descriptor.styles[name])
      })
    }
    if (descriptor.textContent !== undefined) {
      element.textContent = descriptor.textContent
    } else if (descriptor.children) {
      descriptor.children.forEach((child) => {
        element.appendChild(this.createDomElement(child))
      })
    }
    return element
  }
}
