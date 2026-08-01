import {
  MouseClickDriver,
  MouseMoveDriver,
  ViewportResizeDriver,
  ViewportScrollDriver,
  KeyboardDriver,
} from './drivers'
import {
  useCursorEffect,
  useViewportEffect,
  useDragDropEffect,
  useSelectionEffect,
  useResizeEffect,
  useKeyboardEffect,
  useAutoScrollEffect,
  useWorkspaceEffect,
  useFreeSelectionEffect,
  useContentEditableEffect,
  useTranslateEffect,
} from './effects'
import {
  SelectNodes,
  SelectAllNodes,
  SelectSameTypeNodes,
  DeleteNodes,
  CopyNodes,
  PasteNodes,
  UndoMutation,
  RedoMutation,
  CursorSwitchSelection,
  PreventCommandX,
  SelectPrevNode,
  SelectNextNode,
} from './shortcuts'

export const DEFAULT_EFFECTS = [
  useFreeSelectionEffect,
  useCursorEffect,
  useViewportEffect,
  useDragDropEffect,
  useSelectionEffect,
  useKeyboardEffect,
  useAutoScrollEffect,
  useWorkspaceEffect,
  useContentEditableEffect,
  useTranslateEffect,
  useResizeEffect,
]

export const DEFAULT_DRIVERS = [
  MouseMoveDriver,
  // DragDropDriver 已从默认驱动中移除：拖拽手势采集改由 DragEngine 的
  // 拖拽后端（drag/backends）自包含管理，DragDropDriver 类仍保留导出
  // 以兼容外部直接引用，其内部会在 DragEngine 存在时自动让位
  MouseClickDriver,
  ViewportResizeDriver,
  ViewportScrollDriver,
  KeyboardDriver,
]

export const DEFAULT_SHORTCUTS = [
  PreventCommandX,
  SelectNodes,
  SelectAllNodes,
  SelectSameTypeNodes,
  DeleteNodes,
  CopyNodes,
  PasteNodes,
  SelectPrevNode,
  SelectNextNode,
  UndoMutation,
  RedoMutation,
  CursorSwitchSelection,
]
