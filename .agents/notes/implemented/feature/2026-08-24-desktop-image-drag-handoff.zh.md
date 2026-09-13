# Agent Note: Desktop 附件拖拽交接与松手反馈

Status: implemented

[English](2026-08-24-desktop-image-drag-handoff.md) | 中文

## Problem

浏览器图片附件入口支持整页文件拖放，经输入栏完成校验，并展示共享的 `DropOverlay`。Tauri 默认的原生拖放处理器会接管操作系统文件，并发出路径而不是携带 `File` 对象的浏览器 `DragEvent`。Desktop 必须保留浏览器入口，不能根据不完整的悬停元数据再推导一套准入结果。

## Decision

Desktop 的 `WebviewWindowBuilder` 会关闭 Tauri 原生拖放处理器。现有 document 级输入栏监听器接收浏览器 `File` 对象，并继续作为图片准入、忙碌和锁定拒绝、草稿附件创建以及提交的唯一所有者。

Desktop 客户端插件只通过 `DataTransfer.types` 识别文件拖放。它不会读取 MIME 元数据、调用 `preventDefault()`、停止事件传播或设置 `dropEffect`。输入栏会接收每个浏览器文件拖放事件，并继续负责类型、大小、批次、忙碌与锁定校验。

对于文件拖放，插件从 `data-shell-overlay` 的父元素及其相邻侧栏列推导工作区矩形，并在文件拖入时同步把该矩形写入 document 根节点的 CSS 变量。这样 body portal 中已有的 `DropOverlay` 会直接挂载在工作区，不会先画出全窗口的一帧。侧栏保持清晰，不会被模糊。`DropOverlay` 通过 `data-dsh-drop-accepting` 暴露由输入栏持有的可接受状态；Desktop CSS 依据这个标记展示“松开即可添加”/“Release to add”或“当前无法添加”/“Cannot add now”，数量和大小说明始终隐藏。Desktop 不展示松手成功脉冲，因为浏览器收到 drop 并不能证明 DSH 已添加草稿附件。

Desktop 不会向 WebView 暴露拖入文件的文件系统路径，也不会新增原生上传命令、文件系统权限或并行的附件链路。

## Verification

Desktop 源码测试会固定 Tauri 处理器已关闭以及由输入栏持有的 `data-dsh-drop-accepting` 标记。Desktop 客户端交互测试覆盖工作区 inset、简洁文案变量、清理，以及 PDF、未知、混合和可接受文件拖放保持原有事件传播。共享附件测试覆盖该可接受状态标记、`File` 准入、上限和锁定输入栏的拒绝。

## Alternatives considered

- **把 Tauri `onDragDropEvent` 路径接到原生上传命令。** 不采用，因为这会绕过浏览器持有的 `File` 准入路径、向 WebView 暴露文件系统路径，并重复附件所有权。
- **从 `dropEffect` 推导可接受状态。** 不采用，因为它是浏览器的拖放协商信号，不是 DSH 最终的附件结果。
- **在悬停阶段过滤 MIME 类型。** 不采用，因为 WebView 可能在 drop 前不暴露文件元数据，导致有效文件在 DSH 接收前被错误地显示为不可用。

## Consequences

Desktop 与 Web 复用同一套准入和草稿生命周期，同时 Desktop 提供限定在工作区内的拖入聚焦，但不改变浏览器事件结果。DSH 最终拒绝的文件仍可能显示拖放视觉，但在输入栏完成校验前不会被错误地标为不可用。若要重新开启 Tauri 原生处理器，必须完整替换为仍能向现有输入栏提供浏览器 `File` 对象的实现；只传路径的桥接并不等价。
