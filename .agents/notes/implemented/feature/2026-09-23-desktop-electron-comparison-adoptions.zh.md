# Agent Note: 从 Electron 对比中采纳的 Desktop 载体决策

Status: implemented

[English](2026-09-23-desktop-electron-comparison-adoptions.md) | 中文

## Problem

DeepDive 在 Tauri 上承载与上游 Electron 相同的 Harness 产品，两种载体各自独立解决了若干相同问题。把本 fork 的 `desktop/` 与上游 `dsh-v0.1.7-alpha.1` 的 Electron 产品对比后，既发现了 Electron 做法更好的缺口，也发现了本 fork 故意更简单或本来就更强的地方。

## Decision

在 `desktop/` 内采纳四项来自 Electron 一侧的发现；其余要么是 Electron 打包机制的产物，要么是本 fork 不能照搬的载体差异。

sidecar 现在申请**固定的 loopback 端口**（`47821`，被占用时退回临时端口）。Electron 给渲染进程固定 origin `dsh-app://app`；本 fork 禁止自定义 scheme，而每次启动都换一个 `--port 0` origin 会让 WebView 按 origin 隔离的存储在下次启动时不可达——客户端把侧边栏布局、面板宽度与 store 快照持久化在 `localStorage`。固定端口让这些状态跨重启保留，端口被占用时只损失当次启动的客户端状态。

部署运行时现在随包提供 **pnpm**，sidecar 向 profile boot 传入 `packageManager`。Electron 随包提供包管理器并传入应用自有的调用方式，原因相同：Plugin Manager 安装与检查插件时执行 `pnpm`，而自包含安装既没有系统 Node.js 也没有 pnpm，页面因此停在一个不可能成功的 PATH 查找上。`desktop/runtime/package.json` 同时声明了此前仅作为 peer 存在、但消费方已在闭包中的两个 workspace 包（`@deepseek-ai/dsh-hook-protocol`、`@deepseek-ai/dsh-sdk-protocol`），这正是 Electron 的包集合选择已经遵循的规则。

**删除了页面可达的文件读取**：`desktop_copy_file_contents` 接受页面给出的任意绝对路径并把文件文本写入剪贴板，等于让应用文档中的任何脚本（包括第三方客户端插件）任意读取本地文件（含 Harness 凭证）。Electron 不暴露任何以路径为准的原生操作，本 fork 自己的拖拽交接决策也已把文件系统路径挡在 WebView 之外。capability 另外拒绝 `core:path` 解析，Session 导出的保存名在进入原生对话框前被裁剪为 basename。文件菜单保留打开、用其他应用打开、另存为、在文件管理器中显示与复制路径。

其余较小的采纳项：`window.open` 与 `target="_blank"` 改为交给系统浏览器，而不再被静默丢弃（账号页“联系我们”链接与侧边栏浏览器的外部按钮此前是死的）；macOS 覆盖式标题栏声明共享的 `--dsh-frame-top-clearance` 变量（客户端只为 Electron 的 `data-platform="darwin"` 设置它）；失败弹窗附带一段有界的 sidecar stderr，因为 GUI 启动没有可读的控制台；发布查询加了超时，避免连接卡住时更新检查一直不可用；head 注入改为注册结构化 index 行，不再用字符串替换，从而不再依赖被服务文档的 head 标签原样存在。

部署运行时现在在 `pnpm deploy` 之后应用一套**文件策略**：finalize 步骤省略 source map、类型声明、TypeScript 构建缓存、包管理器状态、其他平台的 `node-pty` 预编译产物，以及 Domino 的测试夹具，然后把部署清单重写为名称、版本、exports 与依赖名，使安装路径不再随产物分发。macOS arm64 树上实测：620 MB 变为 471 MB，省略 113 MiB 文件字节。Harness 运行时加载的一切都保留：已编译包、客户端 bundle、被服务的前端、目标平台的原生预编译产物、许可证，以及 Plugin Manager 使用的 pnpm。

## Alternatives considered

- **采纳 Electron 的固定自定义 scheme**——拒绝：载体规则禁止自定义 URI scheme 与 HTTP 重实现，而固定 loopback 端口通过受支持的 `--host/--port` 面达到同样效果。
- **保留 `desktop_copy_file_contents` 并校验路径**——拒绝：本 fork 没有能合法包含渲染行可能给出的所有文件的根，任何范围校验仍会留下页面读取工作区之外文件的能力。
- **照搬 Electron 的逐文件摘要、ASAR/NSIS 打包、自动更新与强更策略**——拒绝：它们服务于 electron-builder、签名更新源与本 fork 没有的企业策略通道，而本 fork 已有按版本与 SHA 固定的 Node 运行时，以及仅做校验的发布流程。其运行时文件策略应维护者要求采纳，位于 `desktop/scripts/runtime-file-policy.mjs`。
- **采纳 Electron 的 macOS 公证与 Windows 签名流水线**——推迟：两者都需要本 fork 故意不持有的证书，`README.md` 已记录 ad-hoc 选择；等具备凭证时值得补上校验那一半。
- **采纳 Electron 的应用自有 profile 目录与主进程 cookie 处理**——拒绝：它们与共享 profile、共享 `DSH_HOME` 的不变量冲突，而把启动 cookie 放进 Rust 会重实现上游 Connection 认证。

## Consequences

Desktop 保持既定的载体形态，同时获得插件管理路径、稳定的 WebView 存储、可用的外链、macOS 布局变量，以及只装载自身所需文件的运行时树。删除命令是有意的能力收缩；该功能只能在由 Host 拥有读取、且绝不接受页面指定路径的前提下回归。`desktop/tests/config.test.mjs` 与自带 sidecar 冒烟测试固定每项采纳行为；发布流程与独立的 Desktop 版本不变。

## Verification

`pnpm install`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test:docs`、`pnpm run hygiene`、Desktop 运行时构建加 `pnpm --filter @deepseek-ai/dsh-desktop run test`（两种启动方式都在 loopback 主机上启动打包树，且树测试会重新套用该策略），以及 `cargo test --manifest-path desktop/src-tauri/Cargo.toml`。固定端口通过连续两次 sidecar 启动报告同一 origin 得到确认；裁剪后的树通过用随包 Node 加载 `node-pty`/`koffi`、运行随包 pnpm `view`，以及部署体积从 620 MB 降到 471 MB 得到确认。
