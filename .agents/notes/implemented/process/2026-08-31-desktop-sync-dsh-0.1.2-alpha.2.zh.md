# Agent Note: Desktop 适配 DeepSeek Harness 0.1.2-alpha.2

Status: implemented

[English](2026-08-31-desktop-sync-dsh-0.1.2-alpha.2.md) | 中文

## Problem

Desktop fork 需要跟随上游 tag `dsh-v0.1.2-alpha.2`，目标 SHA 为 `0a53fb55bea101816fa226bb964ae2bed71c343b`，同时不能丢失 fork 自己的打包、原生集成、品牌名、更新入口和拖拽行为。

这段上游范围包含 234 个 commit，涉及 1,604 个路径。它新增 client connection 恢复界面，改变 client 服务归属，调整依赖校验，并从仓库工具中移除 Knip。直接替换代码树会隐藏决定 Desktop runtime 能否启动以及 UI 贡献能否注册的重叠决策。

## Decision

本次同步遵循 [`dsh-desktop-upstream-sync`](../../../skills/dsh-desktop-upstream-sync/SKILL.md)：临时分支从已发布 fork tip 出发，对已验证的上游 tag 执行真实的 no-commit merge，按责任归属解决冲突，最后才把审查过的代码树整理到未发布的 `0.1.9` 分支。

最终 `0.1.9` 分支以上游 `dsh-v0.1.2-alpha.2` 为基线，并在其上保留经过审查的 fork 增量。已发布的 `master`、`v0.1.8` 及其 commit 保持不变。Desktop 版本继续独立于上游根版本。

上游的 `ConnectionIndicator` 和 connection state 注入保留在 settings shell 中。fork 自己的 `settings.update` seat 也继续声明和渲染；更新徽标嵌套在设置入口下方，连接指示器则保持上游相邻横排的位置。

Desktop sidecar 继续使用上游 Web profile、Connection transport、overlay 机制、Tauri Shell plugin、原生文件处理器和 loopback session export carrier。不新增通用 WebView shell 或文件系统能力。

alpha2 将 `@deepseek-ai/dsh-util-time` 作为 subagent 包的必需 workspace peer 引入。Desktop runtime 显式声明它，确保全新生产 deploy 在 sidecar 加载 plugin tree 前已经包含这个包。

接受上游移除 Knip 的决定。删除过时的 Knip 包配置、锁文件条目和 rescope 规则，不保留已经失效的校验器配置。

vendored 包 rescope 保留 fork 当前的精确文案对和 Inspector wire 标识排除规则，同时接入 alpha2 新增的 Inspector import 覆盖。合并后的树仍通过幂等 rescope 校验。

`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.2-alpha.2`，Desktop 包元数据同步到 `0.1.9`，不修改上游根版本。

## Alternatives considered

- **把 fork reset 到 alpha2，或按白名单重建代码树**：不采用，因为这会隐藏冲突，也无法证明 fork 自己的 Desktop 行为在同步后仍然存在。

- **重新应用旧的 alpha1 同步 commit**：不采用，因为那些 commit 携带旧上游代码树，会重新引入过时的依赖和 client 服务假设。

- **为了与上游完全一致而删除 Desktop 更新 seat**：不采用，因为这会删除已经发布的 Desktop 更新入口；保留这个受批准的 seat，并只做必要的布局适配。

- **本轮直接把 alpha2 合并进已发布的 `master`**：不采用，因为新的 `0.1.9` 同步必须先在未发布分支上完成审查，再决定是否进入发布流程。

## Consequences

分支把 alpha2 记录为祖先，同时保留 fork 的 Desktop carrier 和品牌。settings footer 现在同时支持上游连接恢复反馈和 Desktop 更新徽标，不改变 Web-only 的连接行为。

仓库不再运行 Knip。hygiene 改用上游 alpha2 的门禁集合，其中包含 package dependency 和 install-layout 校验。

已知的 `verify-md-wrap` 失败仍不属于本次同步范围：校验器沿着 snapshot 路径进入了一个文件，最终抛出 `ENOTDIR`。本轮不修改校验器或 snapshot。

## Verification

上游远端将 `dsh-v0.1.2-alpha.2` 解析为 `0a53fb55bea101816fa226bb964ae2bed71c343b`。真实手工 merge 暴露四个文本冲突：Knip 删除、settings shell 样式表、settings shell 组件和 vendored rescope 脚本。

`pnpm install --frozen-lockfile`、`pnpm run rescope-vendor:check`、根目录 typecheck、根目录 lint、根目录 build、Desktop typecheck、Desktop lint 和 Desktop runtime build 均通过。

Desktop Node 测试共 30 项全部通过，覆盖两种生产 sidecar 启动方式、client contribution 生命周期、更新 UI、原生文件拖拽行为和 SemVer 校验。

`pnpm run hygiene` 的 15 个门禁全部通过。

`pnpm run doc-sync` 通过 31 个门禁，只在上述 snapshot 路径的 `ENOTDIR` 已知 markdown-wrap 门禁失败；本轮按范围不修复该问题。
