---
kind: upgrade-guide
description: "Windows Desktop 需要 WebView2 Runtime 138.0.3351.48 或更高版本，才能在嵌入页面中使用原生快捷键。"
---

# 更新 Windows WebView2 Runtime

[English](guide.md) | 中文

## 变更

Windows Desktop 现在需要 138.0.3351.48 或更高版本的 Evergreen WebView2 Runtime。旧版本无法把嵌入页面的键盘输入交给宿主处理，因此 DeepDive 会报错并停止启动，避免 Browser 与 HTML 预览中的快捷键失效。

## 迁移

1. 从 Microsoft 的 [WebView2 Runtime 下载页](https://developer.microsoft.com/microsoft-edge/webview2/)安装或更新 Evergreen WebView2 Runtime。Desktop 安装程序只会在系统没有安装 Runtime 时联网下载。
2. 重启 DeepDive。确认应用可以启动，并且 Sidebar Browser 和 HTML 预览中的已配置快捷键都能使用。
