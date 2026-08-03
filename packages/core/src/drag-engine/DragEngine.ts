/**
 * ============================================================================
 *  DragEngine —— 拖拽引擎核心
 * ============================================================================
 *
 *  重构思路（对应需求）：
 *    1. 「拖拽逻辑与组件渲染强耦合」
 *       -> 引擎只持有 IDragBackend / IDragSourceResolver /
 *          IDragTargetResolver / IDragPreviewProvider 等抽象接口，
 *          具体的节点查找、方向计算、预览内容生成全部以可替换策略注入，
 *          引擎内部不 import 任何 React 组件或 TreeNode 模型。
 *
 *    2. 「拖拽预览使用原生 HTML5 DnD，复杂布局下不一致」
 *       -> 引擎通过 VirtualPreviewRenderer 自行渲染 position:fixed 浮层，
 *          并屏蔽后端（Html5DragBackend）的原生 ghost image，
 *          预览内容由业务侧产出虚拟节点树，跨 iframe / 缩放均一致。
 *
 *    3. 「跨画布拖拽状态同步延迟」
 *       -> 废弃过去在 useDragDropEffect 中 eachWorkspace 直接读写
 *          moveHelper 的做法。引擎内部维护唯一的 DragSession，并通过
 *          EventBus 同步广播 drag:engine:* 事件。任意画布 / 大纲树
 *          订阅事件即可获得一致状态，发布是同步的，无延迟。
 *
 *    4. 「策略模式支持不同拖拽后端」
 *       -> 构造时注入 IDragBackend，运行期可通过 setBackend 整体切换
 *          （Pointer / Html5 / 自定义 mock），对上层业务零影响。
 *
 *    5. 「保持向后兼容」
 *       -> 本引擎不直接替换核心 Event 体系，而是由 DragEngineDriver
 *          作为旧 EventDriver 接入。引擎仍 dispatch DragStartEvent 等
 *          既有事件，保证 useDragDropEffect 等旧 effect 无需改动即可工作。
 *
 *  单一职责：
 *    DragEngine 只做「会话生命周期编排 + 事件广播」，不做 DOM 查询、
 *    不做坐标换算（交给 coordinates）、不做真实渲染（交给 preview）。
 * ============================================================================
 */

import { uid } from '@designable/shared'
import { EventBus } from './EventBus'
import { VirtualPreviewRenderer } from './preview/VirtualPreviewRenderer'
import { distanceBetween } from './coordinates'
import type {
  IDragBackend,
  IDragBackendHost,
  IDragEngineOptions,
  IDragPreviewProvider,
  IDragSourceResolver,
  IDragTargetResolver,
  DragSession,
  DragTarget,
  DragPointerData,
  DragEngineEventMap,
  Unsubscribe,
  DragEventHandler,
} from './types'

export class DragEngine implements IDragBackendHost {
  /** 类型安全的事件总线，所有拖拽状态通过它广播。 */
  readonly eventBus: EventBus<DragEngineEventMap> = new EventBus()

  private backend: IDragBackend
  private readonly sourceResolver: IDragSourceResolver
  private readonly targetResolver: IDragTargetResolver
  private readonly previewProvider: IDragPreviewProvider | null
  private readonly previewRenderer: VirtualPreviewRenderer

  private readonly dragThreshold: number
  private readonly dragDelay: number

  /** 当前拖拽会话，未在拖拽时为 null。 */
  private session: DragSession | null = null

  /** pointerdown 时记录的初始指针，用于阈值判定。 */
  private pendingPointer: DragPointerData | null = null

  /** 延迟判定计时器（dragDelay > 0 时使用）。 */
  private dragDelayTimer: ReturnType<typeof setTimeout> | null = null

  /** 上一帧的指针，用于计算 move 的 delta。 */
  private lastPointer: DragPointerData | null = null

  /** 上一次命中的目标，用于 enter/leave 事件差分。 */
  private lastTarget: DragTarget | null = null

  constructor(options: IDragEngineOptions) {
    this.backend = options.backend
    this.sourceResolver = options.sourceResolver
    this.targetResolver = options.targetResolver
    this.previewProvider = options.previewProvider ?? null
    this.dragThreshold = options.dragThreshold ?? 4
    this.dragDelay = options.dragDelay ?? 0

    this.previewRenderer = new VirtualPreviewRenderer({
      container: options.previewContainer,
      className: options.previewClassName,
      offsetX: options.previewOffsetX ?? 18,
      offsetY: options.previewOffsetY ?? 12,
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                           公共 API：挂载 / 卸载                           */
  /* ------------------------------------------------------------------------ */

  /**
   * 将引擎挂载到指定 DOM 容器。
   */
  mount(container: HTMLElement | Document = document): void {
    this.backend.attach(container, this)
  }

  /**
   * 卸载引擎，释放所有事件监听与预览 DOM。
   */
  unmount(): void {
    this.cancelPending()
    this.backend.detach()
    this.previewRenderer.dispose()
    this.eventBus.clear()
    this.session = null
    this.lastPointer = null
    this.lastTarget = null
  }

  /**
   * 运行时切换拖拽后端（策略模式）。
   * 若切换时正在拖拽，会先结束当前会话。
   */
  setBackend(backend: IDragBackend, container?: HTMLElement | Document): void {
    if (this.session) {
      this.endSession(false)
    }
    this.backend.detach()
    this.backend = backend
    if (container) {
      this.backend.attach(container, this)
    }
  }

  /** 获取当前会话（只读快照）。 */
  getSession(): Readonly<DragSession> | null {
    return this.session
  }

  /* ------------------------------------------------------------------------ */
  /*                           公共 API：事件订阅                               */
  /* ------------------------------------------------------------------------ */

  on<K extends keyof DragEngineEventMap>(
    eventName: K,
    handler: DragEventHandler<DragEngineEventMap[K]>
  ): Unsubscribe {
    return this.eventBus.on(eventName, handler)
  }

  once<K extends keyof DragEngineEventMap>(
    eventName: K,
    handler: DragEventHandler<DragEngineEventMap[K]>
  ): Unsubscribe {
    return this.eventBus.once(eventName, handler)
  }

  off<K extends keyof DragEngineEventMap>(
    eventName: K,
    handler?: DragEventHandler<DragEngineEventMap[K]>
  ): void {
    this.eventBus.off(eventName, handler)
  }

  /* ------------------------------------------------------------------------ */
  /*                    IDragBackendHost：后端事件入口                          */
  /* ------------------------------------------------------------------------ */

  /** @internal 由后端在指针按下时调用。 */
  onBackendPointerDown(pointer: DragPointerData): void {
    this.pendingPointer = pointer
    this.lastPointer = pointer

    if (this.dragDelay > 0) {
      this.dragDelayTimer = setTimeout(() => {
        // 延迟到期时若指针仍未抬起，则尝试启动拖拽。
        if (this.pendingPointer) {
          this.tryStartSession(pointer)
        }
      }, this.dragDelay)
    }
  }

  /** @internal 由后端在指针移动时调用。 */
  onBackendPointerMove(pointer: DragPointerData): void {
    if (!this.session) {
      // 尚未正式开始拖拽，检查是否超过位移阈值。
      if (this.pendingPointer) {
        if (
          distanceBetween(pointer, this.pendingPointer) >= this.dragThreshold
        ) {
          this.tryStartSession(this.pendingPointer)
        }
      }
      if (!this.session) return
    }

    const delta = {
      dx: this.lastPointer ? pointer.clientX - this.lastPointer.clientX : 0,
      dy: this.lastPointer ? pointer.clientY - this.lastPointer.clientY : 0,
    }
    this.lastPointer = pointer

    this.updateSession(pointer, delta)
  }

  /** @internal 由后端在指针抬起 / 拖拽结束时调用。 */
  onBackendPointerUp(pointer: DragPointerData): void {
    this.cancelPending()

    if (!this.session) return

    this.session.currentPointer = pointer
    const dropped = this.maybeDrop(pointer)
    this.endSession(dropped)
  }

  /* ------------------------------------------------------------------------ */
  /*                            会话生命周期管理                                */
  /* ------------------------------------------------------------------------ */

  /**
   * 尝试基于初始指针解析拖拽源并启动会话。
   */
  private tryStartSession(pointer: DragPointerData): void {
    this.cancelPending()

    const source = this.sourceResolver.resolve(pointer)
    if (!source) return

    const session: DragSession = {
      sessionId: uid(),
      backendType: this.backend.type,
      source,
      target: null,
      startPointer: pointer,
      currentPointer: pointer,
      active: true,
      stateBag: new Map<string, unknown>(),
    }
    this.session = session
    this.lastTarget = null

    this.eventBus.emit('drag:source:resolve', {
      source,
      pointer,
    })
    this.eventBus.emit('drag:engine:start', {
      session,
      pointer,
    })

    this.updatePreview()
    // 必须先把预览定位到指针位置，再设置 display:block，
    // 否则浮层会先在 (0,0) 闪现一帧，随后才跳到正确位置。
    this.previewRenderer.move(pointer.topClientX, pointer.topClientY)
    this.previewRenderer.show()
  }

  /**
   * 更新会话：解析目标、广播 move / enter / over 事件、移动预览。
   */
  private updateSession(
    pointer: DragPointerData,
    delta: { dx: number; dy: number }
  ): void {
    if (!this.session) return
    this.session.currentPointer = pointer

    const target = this.targetResolver.resolve(pointer, this.session)
    const previousTarget = this.lastTarget
    this.session.target = target
    this.lastTarget = target

    this.eventBus.emit('drag:engine:move', {
      session: this.session,
      pointer,
      delta,
    })

    // 目标差分发 enter / over / leave，避免业务层做重复判断。
    if (target && previousTarget?.id !== target.id) {
      this.eventBus.emit('drag:engine:enter', {
        session: this.session,
        pointer,
        target,
      })
    }
    if (target) {
      this.eventBus.emit('drag:engine:over', {
        session: this.session,
        pointer,
        target,
      })
    }
    if (previousTarget && !target) {
      this.eventBus.emit('drag:engine:leave', {
        session: this.session,
        pointer,
        target: previousTarget,
      })
    }

    this.eventBus.emit('drag:target:resolve', {
      target,
      pointer,
    })

    this.previewRenderer.move(pointer.topClientX, pointer.topClientY)
  }

  /**
   * 判定是否成功放置，并广播 drop 事件。
   */
  private maybeDrop(pointer: DragPointerData): boolean {
    if (!this.session) return false
    const target = this.session.target
    if (target && target.droppable) {
      this.eventBus.emit('drag:engine:drop', {
        session: this.session,
        pointer,
        target,
      })
      return true
    }
    return false
  }

  /**
   * 结束会话并广播 stop 事件，重置内部状态。
   */
  private endSession(dropped: boolean): void {
    if (!this.session) return
    const session = this.session
    session.active = false

    this.eventBus.emit('drag:engine:stop', {
      session,
      pointer: session.currentPointer,
      dropped,
    })

    // render(null) 内部已经会调用 hide()，这里无需再单独 hide，
    // 否则会造成对同一 DOM 的重复样式写入。
    this.previewRenderer.render(null)
    this.session = null
    this.lastPointer = null
    this.lastTarget = null
  }

  /**
   * 取消「待启动」状态（阈值 / 延迟判定期间）。
   */
  private cancelPending(): void {
    if (this.dragDelayTimer) {
      clearTimeout(this.dragDelayTimer)
      this.dragDelayTimer = null
    }
    this.pendingPointer = null
  }

  /* ------------------------------------------------------------------------ */
  /*                                  预览                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * 使用预览提供者生成虚拟节点并渲染。
   */
  private updatePreview(): void {
    if (!this.session || !this.previewProvider) return
    const vNode = this.previewProvider.resolvePreview(this.session)
    this.previewRenderer.render(vNode)
    this.eventBus.emit('drag:preview:update', {
      session: this.session,
      vNode,
      offset: { x: 18, y: 12 },
    })
  }

  /**
   * 允许业务侧在拖拽过程中主动刷新预览（例如异步加载图标后）。
   */
  refreshPreview(): void {
    this.updatePreview()
  }
}
