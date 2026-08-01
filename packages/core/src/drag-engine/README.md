# DragEngine —— 拖拽系统重构模块

> 本模块对 Formily 表单设计器（`@designable`）的核心拖拽系统进行重构，独立于组件
> 渲染，可被单元测试与其他宿主复用。全程强类型（无 `any`），命名遵循大小驼峰，
> 遵循单一职责原则。

## 一、重构背景与目标

旧实现存在三个痛点：

1. **拖拽逻辑与组件渲染强耦合**：`DragDropDriver` 采集输入、`MoveHelper` 计算落点、
   `GhostWidget` 直接读 `Cursor` 渲染预览，三者靠全局可变状态与直接方法调用串联，
   自定义拖拽行为需改动多处。
2. **预览基于原生 HTML5 DnD**：浏览器接管拖影，跨 iframe、缩放画布、复杂布局下各端
   表现不一致，且无法定制。
3. **跨画布状态同步延迟**：消费方各自主动“拉取”可变状态，产生时序竞争。

重构目标（逐项落地）：

| 要求 | 落地方式 |
| --- | --- |
| ① 抽象为独立 DragEngine 模块 | `DragEngine` 编排器，与渲染彻底解耦 |
| ② 策略模式支持不同后端 | `IDragBackend` + `PointerDragBackend` / `NativeDndBackend` |
| ③ 虚拟 DOM 预览与组件解耦 | `DragPreviewModel` + React `VirtualDragPreviewWidget` |
| ④ 事件总线替代直接状态传递 | `DragEventBus`（类型化 on/off/emit） |
| 向后兼容 | 适配器 `bridge*` 把标准信号回放为旧 `DragStart/Move/Stop` 事件 |

## 二、模块结构与职责（单一职责）

```
drag-engine/
├── types.ts              # 全部类型契约（无 DOM / 无框架依赖）
├── DragEventBus.ts       # 类型化事件总线：仅负责订阅/广播
├── DragPreviewModel.ts   # 虚拟预览状态：仅维护可观察的预览数据
├── DragEngine.ts         # 编排器：串联 后端 + 总线 + 预览 + 状态机
└── backends/
    ├── AbstractDragBackend.ts  # 后端抽象基类：沉淀阈值判定等通用能力
    ├── PointerDragBackend.ts   # 指针后端（默认）：跨端一致，不触发原生拖影
    └── NativeDndBackend.ts     # 原生 DnD 后端：向后兼容既有依赖
```

宿主接入相关（设计器专属细节隔离在此，保持 DragEngine 宿主无关）：

```
models/DragEngineAdapter.ts   # 解析 data-designer-* 约定、坐标换算、旧事件桥接
```

## 三、数据流

```
宿主事件 → IDragBackend（采集/翻译）→ IDragSignal（标准信号）
        → DragEngine（状态机 + 预览更新 + 桥接旧事件）
        → DragEventBus.emit → 各消费者被动接收（含跨画布）
        → DragPreviewModel → VirtualDragPreviewWidget 渲染
```

关键点：所有消费者接收的是**同一份不可变负载**（推模型），不再各自拉取可变状态，
从根本上消除跨画布同步延迟。

## 四、如何启用（可选，默认不改变旧行为）

`Engine` 已内置 `engine.dragEngine`，但默认**不挂载后端**，以免与既有
`DragDropDriver` 双重派发。需要启用新后端时：

```ts
import { PointerDragBackend } from '@designable/core'

// 启用指针后端（推荐）
engine.dragEngine.useBackend(new PointerDragBackend())

// 或启用原生 DnD 后端（向后兼容场景）
// engine.dragEngine.useBackend(new NativeDndBackend())

// 订阅领域事件（替代直接读状态）
const off = engine.dragEngine.bus.on('drag:move', (signal) => {
  // signal.coordinate / signal.sources 均为强类型
})
```

React 侧渲染虚拟预览：

```tsx
import { VirtualDragPreviewWidget } from '@designable/react'
// 放入设计器布局中即可；仅在启用新后端时显示
<VirtualDragPreviewWidget />
```

## 五、扩展新后端

实现 `IDragBackend`（或继承 `AbstractDragBackend`）即可接入新的输入方式
（触摸拖拽、无障碍键盘拖拽等），无需改动落点计算与预览渲染：

```ts
class MyBackend extends AbstractDragBackend {
  readonly name = 'MyBackend'
  attach(container, host) { /* 采集输入 → host.dispatchStart/Move/Drop */ }
  detach(container) { /* 清理监听 */ }
}
```
