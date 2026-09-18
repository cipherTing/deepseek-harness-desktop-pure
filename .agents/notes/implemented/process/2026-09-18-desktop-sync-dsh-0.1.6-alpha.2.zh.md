# Agent Note: Desktop 适配 DeepSeek Harness 0.1.6-alpha.2

Status: implemented

[English](2026-09-18-desktop-sync-dsh-0.1.6-alpha.2.md) | 中文

## Problem

DeepDive 需要接入官方 tag `dsh-v0.1.6-alpha.2`，精确提交为 `ddefc45fbc7f8e46dd73185e68295696d1297887`，同时保留独立的 Tauri Desktop 产品、DeepDive 品牌、About 和更新入口、原生目录选择以及原生 Session 导出。

本次上游范围包含 Harness 包、客户端表面、Session 与沙箱行为、生成产物和文档变动，也继续扩展位于 `apps/desktop` 与 `apps/desktop-host` 的官方 Electron Desktop 产品。它与 DeepDive 的 Tauri 实现属于不同产品层。

## Decision

经审查的集成树通过真实的无提交合并应用上游 `dsh-v0.1.6-alpha.2`，并保留 fork 自有的 Desktop 增量。共享 Harness 包与已批准的客户端 seam 被接入；上游 Electron 产品层、其打包与发布机制、其治理笔记、其工作区资源以及其宿主专属测试 fixture 被排除。DeepDive 继续只保留 `desktop/` 下的单一 Tauri 实现。

同步分支从同步前的 `master` 尖端开始，其集成合并把经验证的上游 tag 记为第二父提交。最终落到 `master` 的合并把经审查的同步分支记为第二父提交。

本次上游范围通过 Git 重命名检测把新的 Electron 文件搬进了 `desktop/assets/`。这些路径被恢复为 fork 自有资源，`apps/desktop`、`apps/desktop-host`、`snapshots/session/workspace-dependencies` 与 `apps/cli/tests/desktop-host.e2e.ts` 均不进入本树。治理 Electron 产品的 27 组上游 Agent Note 一并排除，归档 manifest 同时移除被排除的 `2026-09-09-desktop-in-place-profile` 三元组的封存记录。

`scripts/gen-third-party-notices.ts` 不再读取 Electron 的 `primary-runtime-lock.json`，因此生成的声明文件不再包含 Desktop 内置 Python 分发包一节；`lefthook.yml` 也不再监听该路径。`pnpm-lock.yaml` 与 `THIRD_PARTY_NOTICES.md` 依据合并后的工作区重新生成。`scripts/check-workspace-constraints.ts` 保留上游为 `@deepseek-ai/dsh` 增加的 `lib/types/*.d.ts` 发布条目，并去掉 `@deepseek-ai/dsh-desktop-host` 条目；`tsconfig.host.json` 保留上游的 Host include 列表，但不含 Electron 应用 glob。

三处共享表面带有 Electron 专属引用，现在改述本 fork 实际交付的内容：`ui-settings-general` README 双语文档把 Desktop 更新段落指向 fork 的发布规则，`node-office-kit` 笔记保留共享 Office 决策但不含其 Electron 构建指南，`docs/architecture` 保留 DeepDive Desktop 段落。共享测试去掉其 Electron 载体：`client-flow.client.spec.tsx` 移除 Electron preload bridge 用例，`manager.spec.ts` 移除内置 pnpm 用例，`apps/web/tests/desktop-updates.e2e.ts` 及其 `apps/web/tsconfig.json` 条目随其导入的 Electron preload 源码一并移除，`AGENTS.md` 与 `.gitignore` 移除 Electron 专属行。

Desktop 载体跟进它所依赖的三处上游变化。`desktop/scripts/build-runtime.mjs` 同时接受 dsh bin 稳定的 `profile-boot.js` facade 与带哈希的同名文件。`desktop/runtime/src/sidecar.ts` 为共享 `web` profile 请求 `link` 解析模式，因为强制校验的 runtime 表只描述 dsh 安装本身，会拒绝本 sidecar 播种的 desktop runtime 包。`desktop/tests/config.test.mjs` 跟随 base bundle 的 HMR 行改用更名后的 `@deepseek-ai/dsh-hmr`。

`settings.update` 座位与异步 Session 导出载体保持原位，`ui-settings-general` 继续渲染该座位，而上游由载体驱动的更新指示器在没有 `dshDesktop` preload 时不渲染任何内容。新增的上游 `weighted-approval.yml` 与 `weighted-approval-review-event.yml` 工作流原样进入本树，并与其他上游工作流一样在 GitHub Actions 中保持禁用。

`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.6-alpha.2`；根 README 标注集成的内核为 `0.1.6-alpha.2`。本次集成不改变独立的 DeepDive Desktop 版本。

## Alternatives considered

- **把 fork 重置到上游 tag，或按目录挑选复制**——拒绝，因为这会绕过对上游与 fork 自有行为重叠部分的审查，并丢失连续的 fork 历史。

- **在 Tauri 之外同时接入官方 Electron Desktop**——拒绝，因为这会造出第二个 Desktop 产品、打包路径与运行时归属模型，而不是坚持 DeepDive 选定的 Tauri 路线。

- **在被吸收的文档中保留被排除的 Electron 产品引用**——拒绝，因为经审查的树不能链接到它并不分发的打包内容；`verify-md-links` 会把每个此类目标报为断链。

- **把 Desktop 运行时锁文件保留为第三方声明输入**——拒绝，因为本 fork 不打包 Electron Python 运行时，该节会披露任何产物都不包含的分发包。

## Consequences

同步后的树以经验证的 0.1.6-alpha.2 提交为祖先，相对该 tag 只领先不落后，并保留经审查的 Tauri Desktop 增量。官方 Electron 产品仍在本 fork 的 Desktop 工作区之外。

所有引用被排除产品的保留路径，要么随其移除，要么改指 fork 自身的治理文档，因此 `verify-md-links`、`verify-translation-pairing` 与 `verify-archived-agent-notes` 在经审查的树上保持通过。

## Verification

上游远端 tag 解析为 `ddefc45fbc7f8e46dd73185e68295696d1297887`，手工合并没有遗留未解决路径。经审查的树通过 `pnpm install`、`pnpm run clean`、`pnpm run build`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test:docs`、`pnpm desktop:version:check`、Desktop lint、Desktop typecheck，以及在重新构建并部署的 runtime 上运行的 20 项 Desktop Node 测试。单元测试套件报告 25,359 项通过；`packages/boot/hmr` 与 `packages/experimental/ptc-runtime-python` 中三项依赖墙钟时间的测试在整套并发下超出上限，单独运行均通过。
