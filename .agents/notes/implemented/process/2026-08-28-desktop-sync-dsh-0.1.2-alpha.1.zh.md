# Agent Note: Desktop 适配 DeepSeek Harness 0.1.2-alpha.1

Status: implemented

[English](2026-08-28-desktop-sync-dsh-0.1.2-alpha.1.md) | 中文

## Problem

Desktop fork 需要接入上游 `dsh-v0.1.2-alpha.1`，目标为 `cd5ef8148158c3a752a658978873241fdf8e2bbc`。这段上游范围改变了 Web 组合、Connection 认证、Settings Remote 归属、profile 模块 fallback、包依赖和文档结构。直接用上游替换 fork 代码树会隐藏决定 Desktop 是否仍保持上游行为的冲突。

## Decision

本次同步采用 [`dsh-desktop-upstream-sync`](../../../skills/dsh-desktop-upstream-sync/SKILL.md) 定义的先手工后整理流程。临时分支从原始 `0.1.9` tip 出发，对已验证的上游 SHA 执行真实的 `--no-commit --no-ff` merge。所有冲突和重叠的自动合并都先按责任归属和复杂度顺序处理，之后才允许整理最终历史。

最终未发布的 `0.1.9` 分支以 `dsh-v0.1.2-alpha.1` 为基线，在其上提交已验证的手工集成增量。最终代码树必须与临时集成 commit 一致。已发布的 `master`、Desktop release tag 及其 commit 均保持不变；重写后的分支使用精确 `--force-with-lease`。Desktop 继续使用独立版本 `0.1.7`。

Desktop 保留上游 Connection、Host/Origin 检查、精确 Fetch 路由和 Typert Remote gateway。overlay 只替换目录选择和 Settings Controller 的原生打开操作。sidecar 发送 Connection 的一次性认证启动 URL，Rust 只接受 loopback HTTP 根路径上唯一且非空的 token，然后才导航 WebView。

Alpha1 的 `runProfile()` 会修复 CLI 安装闭包。Desktop 还会在 profile 启动前修复已部署的 Desktop runtime 闭包，因为 overlay 会加载由 deploy 根目录持有的包。runtime manifest 显式包含 Web profile 所需的 Service Definition peer，确保生产 deploy 含有全部 Loader 可见包。

Desktop 保留的 Harness 源码改动只有设置触发控件之后的可选 `settings.update` slot，以及异步 Session ZIP 保存载体。Web 将更新 slot 留空并继续使用浏览器下载载体；Desktop 用该 slot 承载更新徽标，并安装 Tauri 保存载体，不向页面暴露通用文件系统访问能力。

Tauri 保存载体先校验导出 URL 必须属于当前 sidecar origin，再通过 Tauri cookie API 从主 WebView 读取该 URL 对应的 cookie，包括 HttpOnly 浏览器 session，并且只在这次原生 GET 中附带这些 cookie。页面既不提供 cookie，也不能提供任意请求 header。

根文档使用 `README.md` 作为中文版本，使用 `README.en.md` 作为英文版本。translation-link resolver 将该组合识别为根级例外，其他上游双语文档仍采用 `.zh.md` 约定。

Desktop workspace manifest 按 alpha1 的 package-license 检查声明 MIT。Knip 将四个 Desktop runtime 源文件登记为 entry，并从 unused-dependency 报告中排除只用于补齐 profile 与 overlay 部署依赖图的 DSH 包；`verify-runtime-closure` 与生产 sidecar smoke 继续验证该依赖图。

Alpha1 的文档重写改变了 Cordis rescope codemod 跟踪的 6 处完整文案，并新增 Inspector 中带引号的 `cordis/tree` wire topic。本次同步更新精确的正向与反向文案对，只把该 wire 标识排除出通用包名改写，同时由精确规则继续处理 Inspector 中 3 处真实的 Cordis import；alpha1 的产品与文档文本保持不变。

## Alternatives considered

- **把 `0.1.9` reset 到上游 tag，再根据白名单重建 fork**：不采用，因为这会跳过手工集成代码树、隐藏冲突决策，也无法证明重叠的上游改动经过审查。
- **把历史同步 commit 重新应用到 alpha1**：不采用，因为这些 commit 包含旧上游代码树，会覆盖或冲突于已验证的 alpha1 状态。
- **保留已移除的 ApiProxy adapter**：不采用，因为 alpha1 通过 `SettingsController`、Connection 和 Typert Remote 持有设置功能；保留旧 gateway 会重复或绕过上游传输层。
- **把 alpha1 直接 merge 到已发布 `master`**：本轮不采用，因为 `0.1.9` 是已明确授权的未发布同步分支，最终必须以上游为基线。

## Consequences

同步后的分支把 alpha1 记录为祖先，并且其上只有经过审查的 fork 增量。Desktop 启动现在同时依赖上游 CLI fallback 和 Desktop deploy 根目录 fallback，deploy manifest 会显式列出所需的 Service Definition peer。Windows 安装包行为仍由双平台 GitHub workflow 负责；本次 macOS 验证不能替代安装后的 Windows 验收。

## Verification

上游远端将 `dsh-v0.1.2-alpha.1` 解析为 `cd5ef8148158c3a752a658978873241fdf8e2bbc`。手工 merge 在按归属处理前暴露 84 个冲突。最终 package 审计确认 `packages/` 下除 Desktop 目录外只保留 Settings 更新 slot、Session ZIP 保存载体及生成的 client slot catalog。

Harness 生产构建、根级 lint、Desktop 版本检查、Desktop typecheck 与 lint 均通过；Settings 与 Session 导出的聚焦测试共 39 项通过；Desktop 配置和更新 UI 测试共 29 项通过；Desktop Node 测试共 31 项通过，包含两种生产 sidecar 启动方式和 token-cookie 认证闭环；Rust 测试共 9 项通过；translation-link 测试共 19 项通过；`test:docs` 的 15 项检查和 `doc-sync` 的 32 项检查全部通过。

`pnpm run hygiene` 的 15 项检查全部通过。rescope classifier 的 4 项聚焦测试通过，`rescope-vendor:check` 通过；detached worktree 依次完成 `--apply --reverse`、反向检查、正向 apply 和正向检查，最后恢复为与起始状态完全相同的 tree。
