/**
 * @file 虚拟DOM拖拽预览渲染器
 *
 * 重构思路：
 * 1. 替代原有的浏览器原生拖拽预览，实现完全可控的预览效果
 * 2. 使用轻量级虚拟DOM描述（DragPreviewVNode），与真实组件解耦
 * 3. 预览层独立挂载到body，不受画布布局影响，解决复杂布局下的预览不一致问题
 * 4. 使用requestAnimationFrame优化位置更新，确保流畅度
 * 5. 预览内容可自定义，支持从拖拽节点自动生成或外部传入
 *
 * 解决的问题：
 * - 原生HTML5 DnD预览在复杂布局/iframe中位置不一致
 * - 原生预览样式无法完全控制
 * - 跨画布拖拽时预览延迟或闪烁
 */

import type {
  DragPreviewOptions,
  DragPreviewVNode,
  IDragEventBus,
} from './types'

/**
 * 默认预览样式
 */
const DEFAULT_PREVIEW_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  top: '0',
  left: '0',
  pointerEvents: 'none',
  zIndex: '99999',
  opacity: '0.8',
  transform: 'translate3d(0, 0, 0)',
  willChange: 'transform',
}

/**
 * 将虚拟DOM节点渲染为真实DOM
 *
 * 轻量级虚拟DOM渲染器，不依赖React/Vue等框架
 * 支持标签名、属性、子节点、文本节点
 */
function renderVNode(vNode: DragPreviewVNode | string): HTMLElement | Text {
  // 文本节点
  if (typeof vNode === 'string') {
    return document.createTextNode(vNode)
  }

  const element = document.createElement(vNode.type)

  // 设置属性
  if (vNode.props) {
    for (const [key, value] of Object.entries(vNode.props)) {
      if (value === undefined || value === null) continue

      if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value as CSSStyleDeclaration)
      } else if (key === 'className') {
        element.className = String(value)
      } else if (key.startsWith('on') && typeof value === 'function') {
        // 事件绑定（预览层通常不需要，但保留支持）
        const eventName = key.slice(2).toLowerCase()
        element.addEventListener(
          eventName,
          value as EventListener
        )
      } else if (key in element) {
        // DOM属性
        ;(element as unknown as Record<string, unknown>)[key] = value
      } else {
        // 自定义属性
        element.setAttribute(key, String(value))
      }
    }
  }

  // 渲染子节点
  if (vNode.children) {
    for (const child of vNode.children) {
      element.appendChild(renderVNode(child))
    }
  }

  return element
}

/**
 * 从DOM元素生成虚拟DOM描述
 * 用于快速克隆现有元素作为预览
 */
export function createVNodeFromElement(
  element: HTMLElement
): DragPreviewVNode {
  const vNode: DragPreviewVNode = {
    type: element.tagName.toLowerCase(),
    props: {
      className: element.className,
    },
    children: [],
  }

  // 复制内联样式
  if (element.style.length > 0) {
    const style: Record<string, string> = {}
    for (let i = 0; i < element.style.length; i++) {
      const prop = element.style[i]
      style[prop] = element.style.getPropertyValue(prop)
    }
    vNode.props!.style = style as unknown as CSSStyleDeclaration
  }

  // 克隆子节点
  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      vNode.children!.push(child.textContent || '')
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      vNode.children!.push(
        createVNodeFromElement(child as HTMLElement)
      )
    }
  })

  if (vNode.children!.length === 0) {
    delete vNode.children
  }

  return vNode
}

/**
 * 拖拽预览渲染器
 *
 * 职责：
 * - 管理预览DOM的创建、更新、销毁
 * - 跟随鼠标/指针位置更新预览位置
 * - 使用requestAnimationFrame保证流畅度
 * - 支持自定义预览内容
 *
 * 不负责：
 * - 决定预览内容（由外部通过options传入）
 * - 拖拽逻辑（由DragEngine处理）
 */
export class DragPreviewRenderer {
  /** 事件总线 */
  private eventBus: IDragEventBus

  /** 当前预览配置 */
  private options: DragPreviewOptions | null = null

  /** 预览容器元素 */
  private previewElement: HTMLElement | null = null

  /** 当前X坐标 */
  private currentX: number = 0
  /** 当前Y坐标 */
  private currentY: number = 0

  /** rAF ID */
  private rafId: number | null = null

  /** 事件取消订阅函数集合 */
  private unsubscribers: Array<() => void> = []

  constructor(eventBus: IDragEventBus) {
    this.eventBus = eventBus
    this.bindEvents()
  }

  /**
   * 绑定拖拽事件
   */
  private bindEvents(): void {
    // 拖拽开始时显示预览
    this.unsubscribers.push(
      this.eventBus.on('drag:start', () => {
        // 预览内容由show方法设置，这里只做准备
      })
    )

    // 拖拽移动时更新位置
    this.unsubscribers.push(
      this.eventBus.on('drag:move', (payload) => {
        this.currentX = payload.point.x
        this.currentY = payload.point.y
        this.scheduleUpdate()
      })
    )

    // 拖拽结束时隐藏预览
    this.unsubscribers.push(
      this.eventBus.on('drag:end', () => {
        this.hide()
      })
    )

    this.unsubscribers.push(
      this.eventBus.on('drag:cancel', () => {
        this.hide()
      })
    )
  }

  /**
   * 显示拖拽预览
   * @param options - 预览配置
   */
  show(options: DragPreviewOptions): void {
    this.hide()
    this.options = options

    const container = options.container || document.body

    // 创建预览元素
    this.previewElement = renderVNode(options.vNode) as HTMLElement

    // 应用默认样式（vNode中的样式优先级更高）
    Object.assign(this.previewElement.style, DEFAULT_PREVIEW_STYLE)

    // 应用自定义配置
    if (options.zIndex !== undefined) {
      this.previewElement.style.zIndex = String(options.zIndex)
    }
    if (options.opacity !== undefined) {
      this.previewElement.style.opacity = String(options.opacity)
    }

    // 初始定位
    this.updatePosition()

    container.appendChild(this.previewElement)
  }

  /**
   * 更新预览位置
   * 使用transform实现高性能动画
   */
  private updatePosition(): void {
    if (!this.previewElement || !this.options) return

    const offsetX = this.options.offsetX ?? 10
    const offsetY = this.options.offsetY ?? 10

    const x = this.currentX + offsetX
    const y = this.currentY + offsetY

    this.previewElement.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  /**
   * 调度位置更新
   * 使用requestAnimationFrame合并多次更新，确保每帧只更新一次
   */
  private scheduleUpdate(): void {
    if (this.rafId !== null) return
    if (!this.previewElement) return

    this.rafId = requestAnimationFrame(() => {
      this.updatePosition()
      this.rafId = null
    })
  }

  /**
   * 隐藏并销毁预览
   */
  hide(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.previewElement && this.previewElement.parentNode) {
      this.previewElement.parentNode.removeChild(this.previewElement)
    }

    this.previewElement = null
    this.options = null
  }

  /**
   * 销毁预览渲染器
   * 移除所有事件监听和DOM元素
   */
  destroy(): void {
    this.hide()
    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []
  }
}
