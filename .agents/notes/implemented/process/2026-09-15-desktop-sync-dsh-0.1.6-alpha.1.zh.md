# Agent Note: Desktop 适配 DeepSeek Harness 0.1.6-alpha.1

Status: implemented

[English](2026-09-15-desktop-sync-dsh-0.1.6-alpha.1.md) | 中文

## Problem

DeepDive 需要接入官方 tag `dsh-v0.1.6-alpha.1`，精确提交为 `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`，同时保留独立的 Tauri Desktop 产品、DeepDive 品牌、About 和更新入口、原生目录选择以及原生 Session 导出。

本次上游范围包含 Harness 包、客户端表面、Session 与沙箱行为、生成产物和文档变动，也继续扩展位于 `apps/desktop` 与 `apps/desktop-host` 的官方 Electron Desktop 产品。它与 DeepDive 的 Tauri 实现属于不同产品层。

## Decision

经过审查的集成树通过真实 no-commit merge 应用官方 `dsh-v0.1.6-alpha.1`，并保留 fork 自有的 Desktop 增量。共享 Harness 包和已批准的 client seam 会被同步；上游 Electron 产品层、其打包与发版机制、其治理笔记、`@electron/osx-sign` 补丁以及根目录的 Electron 脚本被排除。DeepDive 继续只保留 `desktop/` 下的 Tauri 实现。

本次同步分支从同步前的 `master` tip 出发；其集成 merge 将已验证的官方 tag 记录为第二父提交。最终落回 `master` 时，落地 merge 将经过审查的同步分支记录为第二父提交。

上游本次发布了 PTC 执行 seam 的重命名，因此 `desktop/runtime/package.json` 改为依赖 `@deepseek-ai/dsh-ptc-runtime`，不再依赖 `@deepseek-ai/dsh-code-runtime`。`pnpm-lock.yaml` 与 `THIRD_PARTY_NOTICES.md` 按合并后的 workspace 重新生成，因此不再包含 Electron importer 与 Electron 签名补丁。

`settings.update` seat 与异步 Session 导出载体保持不变。上游重写的 `apply.client.spec.ts` 取代 fork 手写的 bench，并保留一条 fork 断言：General 插件在 Web 上不占用 update 洞位；载体文档保留 fork 的措辞，同时采用上游的预检路径写法。

上游新增的 `verify-repository-references` gate 禁止维护文件中出现 commit hash，而 fork 的治理规则要求记录精确的同步上游提交。该 gate 排除 `AGENTS.md`、`desktop/UPSTREAM_COMMIT` 以及 `desktop-sync` 与 `desktop-upstream-ancestry` 笔记，其余位置仍然拒绝 commit hash。

根 README 标明集成的 DSH 内核为 `0.1.6-alpha.1`（`dsh-v0.1.6-alpha.1`）。`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.6-alpha.1`。独立的 DeepDive Desktop 版本在本次集成中升到 `0.1.14`。

## Alternatives considered

- **reset 到上游 tag 或复制选定目录**——不采用，因为这会绕过上游与 fork 自有行为重叠部分的审查，并丢失连续的 fork 历史。

- **把官方 Electron Desktop 与 Tauri 一起接入**——不采用，因为这会创建第二套 Desktop 产品、打包路径和运行时所有权模型，偏离 DeepDive 已选择的 Tauri 路线。

- **在被吸收的文档中保留已排除 Electron 产品的引用**——不采用，因为审查树不能链接到它并不交付的打包内容；受影响笔记现在只点名本仓库存在的 CLI 组合测试。

- **放任继承来的 repository-reference gate 失败**——不采用，因为 fork 的可追溯性要求精确的上游提交，而该 gate 仍须在其他所有位置拒绝 commit hash。

## Consequences

同步后的树以已验证的 0.1.6-alpha.1 提交为祖先，相对该 tag 只保留 fork 增量，并保留经过审查的 Tauri Desktop 改动。官方 Electron 产品仍不进入本 fork 的 Desktop workspace。

Desktop 包继续以 `0.1.14` 独立编号；上游内核的可追溯信息分别记录在 README 和 `desktop/UPSTREAM_COMMIT` 中。

所有被吸收的 Harness 包与 client seam 现在都描述重命名后的 PTC 运行时，部署的 Desktop 运行时按当前包名解析该 seam。

## Verification

上游远端 tag 解析为 0a15e36e7f82b6ed45af6fa9759f29b40dcd965d，手工 merge 没有未解决路径。审查树已通过 pnpm install、pnpm run typecheck、pnpm run test:docs、pnpm run verify-third-party-notices、pnpm run verify-dependency-catalog、pnpm run verify-repository-references、pnpm run verify-default-product-isolation、pnpm run verify-concrete-terms、pnpm run verify-client-ui-i18n、pnpm desktop:version:check、Desktop runtime 构建与部署、Desktop lint 和 32 个 Desktop Node 测试，以及针对 ui-settings-general 与 session-log-export 的 116 个聚焦 client seam 测试。
