import {
  DragEngineDriver,
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

// 默认驱动列表：使用重构后的 DragEngineDriver 替代旧 DragDropDriver。
// DragEngineDriver 内部基于 DragEngine（策略模式 + 事件总线 + 虚拟预览），
// 同时向后兼容地派发 DragStartEvent/DragMoveEvent/DragStopEvent。
// 旧 DragDropDriver 仍被导出，如需还原原生 HTML5 DnD 行为可手动替换。
export const DEFAULT_DRIVERS = [
  MouseMoveDriver,
  DragEngineDriver,
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
