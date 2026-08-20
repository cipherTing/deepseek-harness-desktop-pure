# Agent Note: Desktop 不显示原生应用菜单

Status: implemented

[English](2026-08-19-desktop-omits-native-menu.md) | 中文

## Problem

Desktop 安装了一套原生应用菜单，其中的 File、View、Edit 和 Window 操作会重复系统控制或 WebView 行为。Windows 会把它渲染成标题栏下方常驻的菜单行，而 macOS 菜单提供的操作对 Desktop 产品也没有实际需要。

## Decision

Desktop 在所有平台都不构造或安装原生应用菜单。关闭窗口仍进入共享的 `ExitRequested` 流程，并在退出前等待 sidecar 关闭。macOS 保留 overlay 标题栏和原生交通灯；Windows 保留正常系统标题栏。

## Alternatives considered

**安装空菜单或隐藏菜单。** 不采用。菜单对象本身没有必要，还会让行为依赖平台特定的 Tauri 和 WebView 实现细节。

**使用 Web CSS 隐藏菜单行。** 不采用。该菜单属于 WebView 文档之外的原生窗口区域。

**只保留 macOS 应用菜单。** 不采用。它的操作在 Desktop 产品中没有使用价值，不值得保留一套仅平台特有的控制界面。

## Consequences

两个平台都只显示原生窗口控制和 WebView 内容，不再承诺由菜单提供刷新或退出快捷键；标题栏关闭操作仍受支持，并保留 sidecar 优雅清理。Desktop 源码测试固定菜单构造和安装完全不存在，平台构建继续负责验证原生窗口行为。
