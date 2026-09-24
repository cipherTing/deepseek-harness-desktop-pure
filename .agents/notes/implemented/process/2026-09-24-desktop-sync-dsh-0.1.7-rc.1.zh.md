# Agent Note: DeepSeek Harness 0.1.7-rc.1 的 Desktop 适配

Status: implemented

[English](2026-09-24-desktop-sync-dsh-0.1.7-rc.1.md) | 中文

## Problem

DeepDive 必须在保留独立 Tauri Desktop 产品及其已有 Desktop 增量的前提下，集成上游 tag `dsh-v0.1.7-rc.1`（精确提交 `46a7f68b0922371ce7144b668b90e377d8e799f4`）。

该上游区间新增了 Harness 包、客户端界面、测试、快照与文档，并继续扩充 `apps/desktop` 与 `apps/desktop-host` 下的官方 Electron Desktop 产品。它还改动了两处本 fork 会消费的约定：workspace 依赖发布范围，以及某个新增客户端行使用的 `cordis` locale 命名空间。

## Decision

经审查的集成树通过一次真实的 no-commit 合并应用上游 `dsh-v0.1.7-rc.1`，并保留 fork 自有的 Desktop 增量。共享 Harness 包、客户端界面与已批准的客户端接缝一并集成；Electron 产品层不进入：`apps/desktop`、`apps/desktop-host`、`apps/web/tests/desktop-updates.e2e.ts` 下的 58 处 modify/delete 冲突，`apps/desktop` 下新增的 7 个文件，以及记录 Electron 对话框与 profile 恢复的 `2026-09-15-desktop-native-fatal-recovery` note 三元组。DeepDive 保留 `desktop/` 下唯一的 Tauri 实现。

同步分支 `codex/sync-dsh-v0.1.7-rc.1` 从同步前的 `master` tip `4cff7a2a1867e9dcc1c6dcb3f214185bbd5a5da1` 开始，其集成合并把已验证的上游 tag 记为第二父提交。在验证时点，本 fork 相对该 tag 落后 318 个提交、领先 66 个提交。

Git 的重命名检测因为两侧都以相似标题开头而配错了两对文件：fork 的 `desktop/assets/README.*` 被配到上游的 `apps/desktop/README.*`，fork 的 `bug-fix/2026-08-19-desktop-omits-native-menu.*` 被配到上游已被排除的 `architecture/2026-09-15-desktop-native-fatal-recovery.*`。两条配对记录都保留 fork 自己的一侧，因此品牌资源页与原生菜单 note 仍记录在各自的译文上。

`packages/client/ui-settings-general` 是真实的共享配对。上游用其几何与颜色规格细化了 Desktop 更新控件段落；该文本被采纳，同时保留 fork 的 [Desktop 发布规则](../../../../AGENTS.md) 链接，替代指向被排除 Electron README 的链接，并用 `pnpm run verify-translation-pairing --write` 重新记录配对。

上游在 `plugin-manager` 的 manager spec 中新增了一个真实 Git 的 SSH 回退测试，它取用 Electron 应用内打包的 pnpm。该产品层已被排除，因此该 spec 指向本 fork 自己部署的 runtime 包管理器 `desktop/runtime/node_modules/pnpm/bin/pnpm.mjs`，这正是打包安装中 Plugin Manager 运行的同一个打包 pnpm 载体。此前移除的 Electron 专用用例仍保持移除。

上游的 `2026-09-22-workspace-release-ranges` 规则要求 DSH 目标使用 `workspace:*`、vendor 与 native 目标使用 `workspace:~`，并且 workspace gate 对每个消费者强制执行。`desktop/runtime/package.json` 在两个族上共有 47 处 caret 范围，`desktop/client-ui/package.json` 带有 `@deepseek-ai/schemastery` 的 vendor caret；两者现在都遵循该规则，`desktop/tests/config.test.mjs` 也改为断言它现在观察到的 DSH 范围。

上游新增的 `2026-09-22-fatal-diagnostics-and-crash-reports` note 部分取代了已被排除的 Electron 致命恢复 note。其取代说明现在点名上游 Electron 产品，而不再链接本 fork 不携带的文件；它记录的共享 Harness 决定保持不变。

新增的 `CordisPreparingRow` 客户端行使用 `cordis` locale 命名空间，而 vendor rescope 在 `ui-cordis` 的其他位置都把它视为 rescope 前的名称 token。该行加入该 gate 的通用跳过列表。

`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.7-rc.1`，根 README 把集成的内核标识为 `0.1.7-rc.1`。根 manifest 携带上游版本；独立的 DeepDive Desktop 版本不因本次集成改变。该上游区间没有引入新的 workflow 文件，只修改了既有上游 workflow，本 fork 继续保持它们为禁用状态。

## Alternatives considered

- **把 fork 重置到上游 tag，或只复制选定目录**——拒绝，因为这会绕过对上游与 fork 自有重叠行为的审查，并丢失连续的 fork 历史。

- **把官方 Electron Desktop 与 Tauri 一起集成**——拒绝，因为这会造出第二套 Desktop 产品、打包路径与 runtime 归属模型。

- **在 SSH 回退 spec 中保留 Electron 打包的 pnpm 路径**——拒绝，因为该路径在此不存在，而该测试覆盖的是本 fork 确实交付的 Harness 安装行为；部署的 runtime 包管理器承担同一角色。

- **把 `desktop/runtime` 豁免于 workspace 发布范围规则**——拒绝，因为该规则掌管所有消费者的打包版本替换，deploy 根也不例外。

- **把误判重命名的配对记录改名为与 Electron 文件一致**——拒绝，因为这样 fork 自己的页面会被记录在它们并不具备的译文上。

## Consequences

同步后的树把已验证的 `dsh-v0.1.7-rc.1` 提交作为祖先，相对该 tag 只领先，并保留经审查的 Tauri Desktop 增量。官方 Electron 产品仍在 fork 的 Desktop workspace 之外，部署的 runtime 只携带 DeepDive Desktop 包。

## Verification

上游 tag 解析为 `46a7f68b0922371ce7144b668b90e377d8e799f4`。手工合并后没有未解决路径，也没有冲突标记。`pnpm install --no-frozen-lockfile` 重新生成 lockfile，其中没有 `apps/desktop` importer，并保留三个 `desktop/` importer。经审查的树通过 `pnpm run typecheck`、`pnpm run lint`（0 错误、0 警告）、`pnpm run hygiene`（18 个 gate 全部通过）、`pnpm run test:docs`、`pnpm run build`，以及针对该区间改动包的聚焦单元测试。Desktop runtime 构建通过，其 Node 测试 37 项全部通过——包括两种打包 sidecar 在回环主机上的 smoke 启动——`version:check` 报告 `0.1.17` 已同步。对七个改动包合并运行单元测试时有四个 `plugin-manager` 用例在 5s 默认超时下超时；它们在单独运行时全部通过，并且完整的 `plugin-manager` spec 单独运行 243 项全部通过。
