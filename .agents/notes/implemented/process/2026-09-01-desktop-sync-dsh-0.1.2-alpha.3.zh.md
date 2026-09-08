# Agent Note: Desktop 适配 DeepSeek Harness 0.1.2-alpha.3

Status: implemented

[English](2026-09-01-desktop-sync-dsh-0.1.2-alpha.3.md) | 中文

## Problem

Desktop fork 需要跟随官方 `dsh-v0.1.2-alpha.3`（`dd6322d604e00eec1ba5e0c8541159906a21094a`），同时不能丢失 fork 自己的打包、原生集成、品牌名、更新入口、拖拽行为和原生会话导出载体。

从 `dsh-v0.1.2-alpha.2` 到 alpha3 的上游范围改变了连接生命周期，移除了 SQLite 会话持久化后端和 agent spine demo，并刷新了大量包元数据、快照和文档。这些变化与 fork 的 Desktop 接入点重叠，不能通过替换代码树或对所有冲突统一选择一侧来接受。

## Decision

本次同步遵循 [`dsh-desktop-upstream-sync`](../../../skills/dsh-desktop-upstream-sync/SKILL.md)：本地检查点从已 push 的 `0.1.10` 基点出发，对已验证的 alpha3 tag 执行真实的 no-commit merge，按责任归属解决冲突，在生成最终未发布分支拓扑前记录经过审查的代码树。

最终 `0.1.10` 分支以上游 `dsh-v0.1.2-alpha.3` 为基线，并在其上携带经过审查的 fork 增量。已发布的 `master`、`v0.1.9` 及其历史不改写。Desktop 版本继续独立于上游根版本。

保留 alpha3 中“报告 generation 卡住但不取消它”的连接行为。Desktop client UI 继续声明并使用 locale 和 slots 服务，注册 DeepDive 品牌、About 区域和更新 seat，并保留原生拖拽集成。

接受上游移除 SQLite 持久化后端的决定。Desktop runtime 组合和会话导出继续使用 JSONL 持久化路径；不添加 SQLite 依赖来替代已移除的后端。

会话导出文档保留 alpha3 对 JSONL 原始产物和浏览器默认行为的说明，同时记录 fork 可选的原生保存载体。Web 的默认浏览器载体保持不变。

vendored 包 rescope 删除上游已经移除的 agent spine demo 对应精确编辑，同时保留 fork 的 Inspector wire 标识排除规则和 alpha3 新增的真实 Inspector 框架导入编辑。

`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.2-alpha.3`，Desktop 包元数据同步到 `0.1.10`，不修改上游根版本。

## Alternatives considered

- **把 fork reset 到 alpha3，或按白名单替换代码树**——不采用，因为这两种操作都会隐藏重叠行为，无法证明 Desktop 适配仍然保留。

- **所有冲突都选择上游版本**——不采用，因为这会删掉 Desktop 原生保存载体文档和 fork 自己的 rescope 行为。

- **保留已经移除的 SQLite 后端或 agent spine demo**——不采用，因为 alpha3 明确从上游产品移除了它们，保留会留下过时的包和依赖状态。

- **改写已发布的 `master` 或发布 tag**——不采用，因为本次同步在未发布的 `0.1.10` 分支上准备，已发布历史必须保持稳定。

## Consequences

fork 包含完整的 alpha3 上游代码树，同时保留 Desktop carrier 以及品牌、About、更新和原生集成表面。分支把 alpha3 记录为祖先，并把 fork 自己的 commit 保留在该上游目标之上。

仓库不再提供上游的 SQLite 会话持久化包或 agent spine demo。会话导出文档区分上游浏览器默认行为和 Desktop 嵌入载体，不再声称 Web 自己写入 Host 路径。

alpha3 的卡住 Host 连接行为改变了 generation 被视为可恢复的时机：连接控制器在 readiness 超时后发出警告并保留 generation，而不是立即取消它。Desktop 接受这一上游行为，同时保留自己的 sidecar 和 UI 生命周期。

## Verification

已验证的上游远端将 `dsh-v0.1.2-alpha.3` 解析为 `dd6322d604e00eec1ba5e0c8541159906a21094a`。真实 no-commit merge 暴露了四组文本冲突：session export 文档对和 vendored rescope 脚本；同时合入 alpha3 的包、快照和删除变更。

连接、设置、会话导出、客户端目录、Desktop Node、Desktop typecheck、Desktop lint 和 vendored rescope 定向检查已通过。仓库 build、hygiene 门禁（15/15）、rescope 校验、Desktop 版本校验和全新的 Desktop runtime 构建/部署均已通过。`doc-sync` 有 31 个门禁通过、1 个已知的 `markdown wrap` 失败：仓库原有的 `verify-md-wrap` 在 `snapshots/acp/image-compaction/system-prompt.expected.md/system-prompt.expected.md` 路径上触发 `ENOTDIR`；这个与本次同步无关的校验器问题保持不变。
