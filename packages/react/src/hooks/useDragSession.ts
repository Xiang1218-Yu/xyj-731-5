import { useEffect, useState } from 'react'
import { IDragSessionState } from '@designable/core'
import { useDesigner } from './useDesigner'

/**
 * 订阅拖拽会话状态（跨画布同步）
 *
 * 数据通道为 DragEngine 的事件总线：每次拖拽手势产生状态变更时，
 * 总线在同一帧内同步推送最新快照，相比「渲染期轮询各 workspace
 * moveHelper」的方式无感知延迟，且天然支持多画布场景。
 *
 * @returns 当前拖拽会话状态快照（未拖拽时 dragging 为 false）
 */
export const useDragSession = (): IDragSessionState => {
  const designer = useDesigner()
  const [sessionState, setSessionState] = useState<IDragSessionState>(() =>
    designer.dragEngine.getState()
  )
  useEffect(() => {
    // 订阅总线状态同步广播，返回取消订阅函数随组件卸载清理
    return designer.dragEngine.subscribe('drag:stateSync', (nextState) => {
      setSessionState(nextState)
    })
  }, [designer])
  return sessionState
}
