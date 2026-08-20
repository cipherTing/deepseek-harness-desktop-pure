# Agent Note: Tauri Shell 启动 Desktop Node sidecar

Status: implemented

[English](2026-08-20-tauri-shell-sidecar-launch.md) | 中文

## Problem

Desktop 原先通过 `process-wrap` 启动内置 Node 运行时。它在 Windows 上组合创建标志和 Job Object 时，无法可靠保留无控制台标志，应用启动时可能弹出可见终端。这个 carrier 同时必须保留二进制帧 stdin/stdout，不能改变 Harness Web profile、插件加载、路径或子进程行为。

## Decision

Node 可执行文件继续作为 Tauri `externalBin` 中固定的 `binaries/node`。Rust 通过 `tauri-plugin-shell` 的 `app.shell().sidecar("node")` 启动它，使用原始 stdout/stderr 事件，并由 actor 串行处理同步 stdin 写入和兜底终止。sidecar 启动 `web` profile 时固定传入 `--no-open`，因为面向用户的窗口由 Tauri 持有。ready、重启、实时 origin 导航、优雅关闭和 Windows eval 参数仍由 Desktop carrier 负责。

WebView 不获得任何 Shell plugin 权限。DeepSeek Harness 插件仍在 Node 运行时内部加载和运行，Tauri Shell 只拥有最外层 Node 进程。常规 Desktop 关闭会停止 sidecar；应用异常终止时不承诺整棵进程树清理。

## Alternatives considered

**保留 `process-wrap`。** 不采用。它的 Windows 创建标志与 Job Object 组合正是启动终端的疑似来源，并且带来了 Desktop 适配要求之外的进程树行为。

**通过直接的平台命令启动 Node。** 不采用。Tauri 维护的 Shell plugin 已能解析声明的 sidecar、传递原始输出，并在 Windows 使用无控制台启动行为。

**向 WebView 暴露 Shell 启动能力。** 不采用。loopback 页面不需要通用可执行权限，sidecar 启动仍由 Rust 独占。

## Verification

Rust 测试执行官方 sidecar 路径并验证二进制 stdout 和 stdin 字节，同时单独验证直接终止能收到进程结束事件。Desktop smoke 通过原生脚本和 Windows eval 两种 Node 参数启动真实 Web host，再覆盖 bridge、HTTP、插件 bundle、取消和关闭路径。

## Consequences

- 官方 Shell 实现会为 Windows 的内置 Node 进程设置 `CREATE_NO_WINDOW`。真实 Windows 打包程序启动仍是确认没有可见终端的最终产品级验证。
- DSH 插件及其自身子进程不经过这条 Tauri 启动路径。Harness 插件启动的 PowerShell、cmd 或其他子进程弹出终端，属于另一类问题。
- 常规 Desktop 关闭会停止其拥有的 Node 进程。该 carrier 不再承诺应用异常终止后的整棵进程树清理。
