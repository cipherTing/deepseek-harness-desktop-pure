# Agent Note: 用户触发的 Desktop 更新详情

Status: implemented

[English](2026-08-22-desktop-update-release-details.md) | 中文

## Problem

Desktop 更新徽标能够识别新版本，但只显示旧版本与新版本，随后把用户带到通用 Release 页面。它没有展示 GitHub Release 已经维护的双语 Markdown 更新日志；关于页面在手动检查成功后还会立即打开更新弹窗。

## Decision

Desktop 通过一次请求读取最新 GitHub Release 的 tag、Markdown 正文和附件。新版本只会让更新徽标出现，绝不会自行打开弹窗。只有用户点击徽标后才会打开弹窗；关于页面的手动检查会在原位置显示结果，并提供一个单独操作打开同一弹窗。

弹窗复用客户端共享的 `Modal`、`Button` 和 `MarkdownText` 组件。它展示已安装版本和可用版本，直接渲染 GitHub Release 正文，不再维护第二份更新日志，并把过长内容限制在内部滚动区域。Release 正文继续由[双语 Desktop 发布流程](../process/2026-08-20-desktop-release-bilingual-notes.zh.md)负责。

主操作会选择当前平台对应的 `deepdive-macos-arm64-<version>.dmg` 或 `deepdive-windows-x64-<version>.exe` Release 附件；附件缺失时回退到 Release 页面。现有原生外部链接载体负责打开该 URL，因此操作会开始下载安装包，但不宣称在应用内完成安装。

## Alternatives considered

- **轮询发现新版本后自动打开弹窗。** 不采用，因为后台网络结果不能打断用户当前工作。
- **为 Release 正文另写 Desktop Markdown 解析器。** 不采用，因为共享的不可信 Markdown 渲染器已经负责解析、净化、链接和主题表现。
- **在本次改动中通过 Tauri Updater 安装。** 不采用，因为当前发布流程只生成普通 DMG 和 NSIS 安装包，没有签名的 updater 产物和更新清单。应用内安装需要把官方 updater 插件、更新签名密钥、生命周期接入和发布流程调整作为一项独立决策完整实现。

## Consequences

更新详情与已发布的 GitHub Release 保持一致，长日志可以正常阅读，并且没有用户操作就不会出现更新弹窗。开始更新会在系统浏览器中打开当前平台的安装包下载，用户仍通过操作系统完成安装。Desktop 交互测试覆盖点击后才显示弹窗、GitHub 更新日志、滚动容器以及 macOS 和 Windows 附件选择。
