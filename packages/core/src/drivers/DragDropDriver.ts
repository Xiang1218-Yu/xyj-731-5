import { EventDriver } from '@designable/shared'
import { Engine } from '../models/Engine'
import { DragStartEvent, DragMoveEvent, DragStopEvent } from '../events'

const GlobalState = {
  dragging: false,
  onMouseDownAt: 0,
  startEvent: null,
  moveEvent: null,
}

export class DragDropDriver extends EventDriver<Engine> {
  mouseDownTimer = null

  startEvent: MouseEvent

  /**
   * 归属标记：标识本实例是否由 DragEngine 的拖拽后端持有并管理
   * 仅 LegacyDragBackend 在创建实例时置为 true，
   * 用于区分「后端自包含采集」与「外部手动注册」两种使用方式
   */
  managedByDragEngine = false

  onMouseDown = (e: MouseEvent) => {
    // 拖拽手势采集已由 DragEngine 的拖拽后端自包含管理：
    // 本驱动若被外部手动注册到引擎驱动列表中（非后端持有），
    // 则自动让位以避免手势被重复采集；后端持有的实例不受影响
    if (this.engine.dragEngine && !this.managedByDragEngine) {
      return
    }
    if (e.button !== 0 || e.ctrlKey || e.metaKey) {
      return
    }
    if (
      e.target['isContentEditable'] ||
      e.target['contentEditable'] === 'true'
    ) {
      return true
    }
    if (e.target?.['closest']?.('.monaco-editor')) return
    GlobalState.startEvent = e
    GlobalState.dragging = false
    GlobalState.onMouseDownAt = Date.now()
    this.batchAddEventListener('mouseup', this.onMouseUp)
    this.batchAddEventListener('dragend', this.onMouseUp)
    this.batchAddEventListener('dragstart', this.onStartDrag)
    this.batchAddEventListener('mousemove', this.onDistanceChange)
  }

  onMouseUp = (e: MouseEvent) => {
    if (GlobalState.dragging) {
      this.dispatch(
        new DragStopEvent({
          clientX: e.clientX,
          clientY: e.clientY,
          pageX: e.pageX,
          pageY: e.pageY,
          target: e.target,
          view: e.view,
        })
      )
    }
    this.batchRemoveEventListener(
      'contextmenu',
      this.onContextMenuWhileDragging,
      true
    )
    this.batchRemoveEventListener('mouseup', this.onMouseUp)
    this.batchRemoveEventListener('mousedown', this.onMouseDown)
    this.batchRemoveEventListener('dragover', this.onMouseMove)
    this.batchRemoveEventListener('mousemove', this.onMouseMove)
    this.batchRemoveEventListener('mousemove', this.onDistanceChange)
    GlobalState.dragging = false
  }

  onMouseMove = (e: MouseEvent | DragEvent) => {
    if (
      e.clientX === GlobalState.moveEvent?.clientX &&
      e.clientY === GlobalState.moveEvent?.clientY
    )
      return
    this.dispatch(
      new DragMoveEvent({
        clientX: e.clientX,
        clientY: e.clientY,
        pageX: e.pageX,
        pageY: e.pageY,
        target: e.target,
        view: e.view,
      })
    )
    GlobalState.moveEvent = e
  }

  onContextMenuWhileDragging = (e: MouseEvent) => {
    e.preventDefault()
  }

  onStartDrag = (e: MouseEvent | DragEvent) => {
    if (GlobalState.dragging) return
    GlobalState.startEvent = GlobalState.startEvent || e
    this.batchAddEventListener('dragover', this.onMouseMove)
    this.batchAddEventListener('mousemove', this.onMouseMove)
    this.batchAddEventListener(
      'contextmenu',
      this.onContextMenuWhileDragging,
      true
    )
    this.dispatch(
      new DragStartEvent({
        clientX: GlobalState.startEvent.clientX,
        clientY: GlobalState.startEvent.clientY,
        pageX: GlobalState.startEvent.pageX,
        pageY: GlobalState.startEvent.pageY,
        target: GlobalState.startEvent.target,
        view: GlobalState.startEvent.view,
      })
    )
    GlobalState.dragging = true
  }

  onDistanceChange = (e: MouseEvent) => {
    const distance = Math.sqrt(
      Math.pow(e.pageX - GlobalState.startEvent.pageX, 2) +
        Math.pow(e.pageY - GlobalState.startEvent.pageY, 2)
    )
    const timeDelta = Date.now() - GlobalState.onMouseDownAt
    if (timeDelta > 10 && e !== GlobalState.startEvent && distance > 4) {
      this.batchRemoveEventListener('mousemove', this.onDistanceChange)
      this.onStartDrag(e)
    }
  }

  attach() {
    this.batchAddEventListener('mousedown', this.onMouseDown, true)
  }

  detach() {
    GlobalState.dragging = false
    GlobalState.moveEvent = null
    GlobalState.onMouseDownAt = null
    GlobalState.startEvent = null
    this.batchRemoveEventListener('mousedown', this.onMouseDown, true)
    this.batchRemoveEventListener('dragstart', this.onStartDrag)
    this.batchRemoveEventListener('dragend', this.onMouseUp)
    this.batchRemoveEventListener('dragover', this.onMouseMove)
    this.batchRemoveEventListener('mouseup', this.onMouseUp)
    this.batchRemoveEventListener('mousemove', this.onMouseMove)
    this.batchRemoveEventListener('mousemove', this.onDistanceChange)
    this.batchRemoveEventListener(
      'contextmenu',
      this.onContextMenuWhileDragging,
      true
    )
  }
}
