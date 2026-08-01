import React, { useEffect, useRef } from 'react'
import { autorun } from '@formily/reactive'
import { observer } from '@formily/reactive-react'
import { useDesigner, usePrefix } from '../../hooks'
import './styles.less'

/**
 * ============================================================================
 * VirtualDragPreviewWidget —— 虚拟 DOM 拖拽预览渲染层
 * ----------------------------------------------------------------------------
 * 职责（单一职责）：仅把 core 中 DragEngine.preview（虚拟预览模型）渲染为跟随
 * 光标的“影子”，不参与任何输入采集或落点计算。
 *
 * 重构思路：
 *   旧 GhostWidget 直接读取 cursor.position 并渲染真实节点标题，预览与真实组件
 *   坐标计算耦合。本 Widget 改为消费 core 的虚拟预览模型：
 *     - 数据来自 engine.dragEngine.preview（虚拟节点 + 顶层统一坐标）；
 *     - 用 transform 跟随 topClient 坐标，跨 iframe/缩放画布下表现一致；
 *     - 与真实组件解耦，复杂布局不再抖动。
 *   通过 autorun 订阅坐标变化，仅更新 transform，避免整树重渲染。
 *
 *   注意：该 Widget 仅在启用了新拖拽后端（engine.dragEngine.useBackend(...)）时
 *   才会显示，默认不与旧 GhostWidget 冲突，保证向后兼容。
 * ============================================================================
 */
export const VirtualDragPreviewWidget = observer(() => {
  const designer = useDesigner()
  const prefix = usePrefix('virtual-drag-preview')
  const ref = useRef<HTMLDivElement>(null)
  const preview = designer?.dragEngine?.preview

  useEffect(() => {
    if (!preview) return
    // 仅订阅坐标，用 transform 跟随，避免频繁触发 React 重渲染
    return autorun(() => {
      const coordinate = preview.coordinate
      if (!ref.current || !coordinate) return
      ref.current.style.transform = `perspective(1px) translate3d(${
        coordinate.topClientX - 18
      }px, ${coordinate.topClientY - 12}px, 0) scale(0.8)`
    })
  }, [preview])

  if (!preview?.visible || !preview.nodes.length) return null

  const [firstNode, ...restNodes] = preview.nodes
  return (
    <div ref={ref} className={prefix}>
      <span style={{ whiteSpace: 'nowrap' }}>
        {firstNode.title}
        {restNodes.length > 0 ? '...' : ''}
      </span>
    </div>
  )
})

VirtualDragPreviewWidget.displayName = 'VirtualDragPreviewWidget'
