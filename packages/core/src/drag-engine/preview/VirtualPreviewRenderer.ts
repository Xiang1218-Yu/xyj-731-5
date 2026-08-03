/**
 * ============================================================================
 *  VirtualPreviewRenderer —— 虚拟 DOM 拖拽预览渲染器
 * ============================================================================
 *
 *  职责（单一职责原则）：
 *    把「虚拟节点树（DragVNode）」渲染成真实的 DOM 预览层，并跟随指针移动。
 *    它不依赖 React/Vue，也不读取任何业务状态，从而实现与真实组件的完全解耦。
 *
 *  解决的问题：
 *    旧方案使用原生 HTML5 DnD 的 ghost image，浏览器会自行截图拖拽元素，
 *    在 iframe、transform:scale、复杂布局下位置与样式经常错位。
 *    这里改为：业务侧通过 IDragPreviewProvider 产出轻量 VNode，
 *    由本渲染器创建一个 position:fixed 的浮层，使用 translate3d 跟随指针，
 *    行为在所有布局下保持一致。
 *
 *  类型安全：
 *    样式统一通过 applyStyle -> element.style.setProperty 写入，
 *    不使用 any / as unknown as 等不安全断言，小驼峰属性名会被转换为
 *    CSS 短横线形式（zIndex -> z-index），CSS 自定义属性（--foo）原样透传。
 *
 *  性能考量：
 *    - 位置更新仅修改 transform，不触发重排；
 *    - 内容更新采用「结构替换」策略（预览树通常极小，无需完整 vdom diff）；
 *    - 对外暴露 render / move / show / hide / dispose 五个原子方法。
 * ============================================================================
 */

import type { DragVNode, DragVNodeAttr, DragVNodeStyle } from '../types'

/** 预览浮层固定使用的样式，保证不影响正常文档流。 */
const ROOT_STYLE: DragVNodeStyle = {
  position: 'fixed',
  top: '0px',
  left: '0px',
  zIndex: 99999,
  pointerEvents: 'none',
  willChange: 'transform',
}

/**
 * 把小驼峰形式的 CSS 属性名转换为短横线形式。
 * 以「--」开头的 CSS 自定义属性（CSS Variables）原样返回。
 */
function toKebabCase(propName: string): string {
  if (propName.startsWith('--')) return propName
  return propName.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

/**
 * 类型安全地把样式对象应用到目标元素。
 * 统一使用 setProperty，避免对 CSSStyleDeclaration 做不安全的索引赋值。
 */
function applyStyle(
  style: CSSStyleDeclaration,
  source: DragVNodeStyle
): void {
  Object.keys(source).forEach((propName) => {
    const value = source[propName]
    if (value === undefined || value === null || value === '') {
      // 空值视为清除该样式。
      style.removeProperty(toKebabCase(propName))
      return
    }
    style.setProperty(toKebabCase(propName), String(value))
  })
}

/** 判断属性是否为事件监听器。 */
function isEventListener(
  value: DragVNodeAttr
): value is EventListenerOrEventListenerObject {
  return typeof value === 'function'
}

/** 把虚拟节点递归渲染为真实 DOM。 */
function renderVNode(vNode: DragVNode): HTMLElement | Text {
  if (vNode.text !== undefined) {
    return document.createTextNode(vNode.text)
  }
  const element = document.createElement(vNode.tagName)

  if (vNode.className) {
    element.className = vNode.className
  }

  if (vNode.style) {
    applyStyle(element.style, vNode.style)
  }

  if (vNode.attrs) {
    Object.keys(vNode.attrs).forEach((name) => {
      const value = vNode.attrs?.[name]
      if (value === undefined || value === null || typeof value === 'boolean') {
        return
      }
      if (isEventListener(value)) {
        // 以 onXxx 形式声明的事件监听。
        if (name.startsWith('on') && name.length > 2) {
          const eventName = name.slice(2).toLowerCase()
          element.addEventListener(eventName, value)
        }
        return
      }
      if (typeof value === 'object') {
        // 形如 { value: 'x' } 的属性对象，序列化为字符串。
        element.setAttribute(name, JSON.stringify(value))
        return
      }
      element.setAttribute(name, String(value))
    })
  }

  if (vNode.children) {
    vNode.children.forEach((child) => {
      element.appendChild(renderVNode(child))
    })
  }

  return element
}

/**
 * 虚拟预览渲染器。
 */
export class VirtualPreviewRenderer {
  private container: HTMLElement
  private root: HTMLDivElement
  private content: HTMLDivElement
  private currentNode: DragVNode | null = null
  private offsetX: number
  private offsetY: number

  constructor(options?: {
    container?: HTMLElement
    className?: string
    offsetX?: number
    offsetY?: number
  }) {
    this.container = options?.container ?? document.body
    this.offsetX = options?.offsetX ?? 18
    this.offsetY = options?.offsetY ?? 12

    this.root = document.createElement('div')
    if (options?.className) {
      this.root.className = options.className
    }
    // 类型安全地写入根样式，替代旧的 Object.assign(root.style, ...)。
    applyStyle(this.root.style, ROOT_STYLE)

    this.content = document.createElement('div')
    this.root.appendChild(this.content)
    // 初始隐藏。
    this.hide()
    this.container.appendChild(this.root)
  }

  /**
   * 渲染（或更新）预览内容。
   * 传入 null 时清空内容并隐藏预览。
   */
  render(vNode: DragVNode | null): void {
    this.currentNode = vNode
    // 清空旧内容。
    while (this.content.firstChild) {
      this.content.removeChild(this.content.firstChild)
    }
    if (!vNode) {
      this.hide()
      return
    }
    this.content.appendChild(renderVNode(vNode))
  }

  /**
   * 把预览移动到指定视口坐标（会叠加偏移量）。
   * 使用 translate3d 启用 GPU 合成，避免拖拽时抖动。
   */
  move(clientX: number, clientY: number): void {
    const x = clientX - this.offsetX
    const y = clientY - this.offsetY
    this.root.style.transform = `perspective(1px) translate3d(${x}px, ${y}px, 0) scale(0.8)`
  }

  /** 显示预览（仅在存在预览内容时生效）。 */
  show(): void {
    if (this.currentNode) {
      this.root.style.display = 'block'
    }
  }

  /** 隐藏预览。 */
  hide(): void {
    this.root.style.display = 'none'
  }

  /** 更新指针偏移。 */
  setOffset(offsetX: number, offsetY: number): void {
    this.offsetX = offsetX
    this.offsetY = offsetY
  }

  /**
   * 销毁渲染器，移除 DOM 节点。
   */
  dispose(): void {
    if (this.root.parentNode) {
      this.root.parentNode.removeChild(this.root)
    }
  }
}
