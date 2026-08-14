# DeepSeek Harness Desktop

[English](README.md) | 中文

这是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立 Desktop 打包 fork，使用 Tauri 将上游 Web 客户端打包为 macOS Apple Silicon 和 Windows x64 桌面客户端。

本仓库不是 DeepSeek Harness 官方仓库，也不是另一套 Harness 实现。Tauri 直接承载编译后的 Web 前端，随包 Node.js sidecar 运行同一套 Harness 后端组合，但不会启动 Harness WebServer 或 localhost 传输服务。

## 本仓库做什么

- 将上游 Web 客户端打包为自包含的 Desktop 应用。
- 随包提供 Node.js 和 Harness 编译依赖闭包，正式安装包不要求用户自行安装 Node.js 或包管理器。
- 通过 Desktop IPC 适配层连接 Web 客户端与 Harness，不使用 HTTP 或 WebSocket 作为 Desktop 传输。
- 由维护者运行本地命令或手动触发打包 workflow，构建带版本号的 macOS Apple Silicon 和 Windows x64 安装包。
- Desktop 使用从 `0.1.0` 开始的独立版本号；`desktop/package.json` 是唯一版本源，上游版本记录仅用于 Release 追溯。

## 本仓库不改变什么

- 不新增 Harness 功能，不改变非 Desktop 端的 Harness 行为。
- Desktop 启动和原生 Web 启动使用相同的 Harness 配置文件、环境规则、配置档、会话、工作区、缓存和用户目录。
- 不把原有 Harness 路径重定向到 Tauri 安装目录、打包资源目录或 Tauri 应用数据目录。
- 仓库中的 `desktop/` 仅存放打包源码和资源，不是另一套 Harness 工作区或用户数据目录。
- 上游同步和 GitHub Release 均由维护者手动完成。打包 workflow 仅支持手动触发，不选择或同步上游 commit，也不创建 Release。

## 运行

启动原生 Web 客户端时，请参见[上游 Web 运行说明](https://github.com/deepseek-ai/deepseek-harness#run)。

### 从源码运行

从 checkout 进行开发时，请参见[上游从源码运行说明](https://github.com/deepseek-ai/deepseek-harness#run-from-source)。

### 运行 Desktop 开发环境

安装仓库开发依赖后，在仓库根目录启动 Tauri 和随包 Harness sidecar：

```sh
pnpm desktop:dev
```

### 构建 Desktop 安装包

在支持的目标系统运行：

```sh
pnpm desktop:build
```

该命令会在 Apple Silicon Mac 上构建 macOS Apple Silicon 包，或在 Windows x64 机器上构建 Windows x64 包，并将带版本号的产物写入 `desktop/dist/`：`deepseek-harness-desktop-macos-arm64-<version>.dmg` 或 `deepseek-harness-desktop-windows-x64-<version>.exe`。

GitHub Release 由维护者手动创建。Release 描述必须记录 Desktop 版本、已同步的上游 commit、存在时对应的上游 tag，以及本次构建使用的 fork commit。CI 只负责手动触发的打包并上传 workflow artifact，不创建 Release。当前已同步的上游 commit 存放在 [`desktop/UPSTREAM_COMMIT`](desktop/UPSTREAM_COMMIT)。

## 上游项目

Harness 的架构、Web 行为、插件模型、源码开发指南和项目贡献流程，请以[上游 DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)为准。本 fork 的 Desktop 专属规则见 [AGENTS.md](AGENTS.md)。

## 许可证

本 fork 保留 [MIT License](LICENSE) 和上游项目归属信息。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
