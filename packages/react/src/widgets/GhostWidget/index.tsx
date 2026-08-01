import React, { useRef, useEffect } from 'react'
import { useCursor, usePrefix, useDesigner, useDragSession } from '../../hooks'
import { CursorStatus } from '@designable/core'
import { autorun } from '@formily/reactive'
import { observer } from '@formily/reactive-react'
import { NodeTitleWidget } from '../NodeTitleWidget'
import './styles.less'

export const GhostWidget = observer(() => {
  const designer = useDesigner()
  const cursor = useCursor()
  const ref = useRef<HTMLDivElement>()
  const prefix = usePrefix('ghost')
  // 拖拽节点取自事件总线同步的会话快照（跨画布同帧更新），
  // 替代原先渲染期轮询各 workspace moveHelper 的方式
  const dragSession = useDragSession()
  const movingNodes = dragSession.dragNodes
  const firstNode = movingNodes[0]
  useEffect(
    () =>
      autorun(() => {
        const transform = `perspective(1px) translate3d(${
          cursor.position?.topClientX - 18
        }px,${cursor.position?.topClientY - 12}px,0) scale(0.8)`
        if (!ref.current) return
        ref.current.style.transform = transform
      }),
    [designer, cursor]
  )
  const renderNodes = () => {
    return (
      <span
        style={{
          whiteSpace: 'nowrap',
        }}
      >
        <NodeTitleWidget node={firstNode} />
        {movingNodes.length > 1 ? '...' : ''}
      </span>
    )
  }
  if (!firstNode) return null
  return cursor.status === CursorStatus.Dragging ? (
    <div ref={ref} className={prefix}>
      {renderNodes()}
    </div>
  ) : null
})

GhostWidget.displayName = 'GhostWidget'
