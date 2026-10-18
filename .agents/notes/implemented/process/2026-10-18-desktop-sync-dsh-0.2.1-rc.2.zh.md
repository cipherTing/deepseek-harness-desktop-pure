# Agent Note: DeepSeek Harness 0.2.1-rc.2 的 Desktop 适配

Status: implemented

[English](2026-10-18-desktop-sync-dsh-0.2.1-rc.2.md) | 中文

## Problem

DeepDive 必须在保留独立 Tauri Desktop 产品及其已有 Desktop 增量的前提下，集成上游 tag `dsh-v0.2.1-rc.2`（精确提交 `687f282e8625c6b8d11ff58211a90524be2e4317`）。

从 `dsh-v0.2.1-alpha.2` 起的上游区间在 API、boot、client、experimental 及其他分组新增了大量 Harness 包、客户端界面、spec、快照与文档，并继续扩充 `apps/desktop` 与 `apps/desktop-host` 下的官方 Electron Desktop 产品。它新增了私有参考工具 `apps/plugin-market-generator`，并改动了仓库构建链，在 Host 与 Client 两个编译面之间打包 Electron Desktop 产品。

## Decision

经审查的集成树通过一次真实的 no-commit 合并应用上游 `dsh-v0.2.1-rc.2`，并保留 fork 自有的 Desktop 增量。共享 Harness 包、客户端界面与已批准的客户端接缝一并集成；Electron 产品层不进入：`apps/desktop`、`apps/desktop-host`、`apps/web/tests` 与 `scripts` 下的 88 处 modify/delete 路径，该区间内 `apps/desktop` 新增的 83 个文件，本 fork 不携带对应 spec 的两个 Electron e2e 快照目录，以及三个 Electron 打包 workflow spec（`desktop-package-source`、`desktop-publish-workflow` 与 `macos-package-workflow`）。

同步分支 `codex/sync-dsh-v0.2.1-rc.2` 从同步前的 `master` tip `81b61fe3218392688f00c77b028e6f2a2b95e0c5` 开始，其集成合并把已验证的上游 tag 记为第二父提交。合并前本 fork 相对该 tag 落后 990 个提交、领先 83 个提交；集成后的树没有仅上游的提交，领先 84 个提交。

`apps/plugin-market-generator` 是私有仓库工具，与 Electron 无关，因此连同它在 `tsconfig.host.json` 中的聚合引用一起进入本树。`check-workspace-constraints` 的发布成员规则按目录豁免它，并且不再点名任何 Electron 应用目录。

仓库构建链不再在 Host 与 Client 两个编译面之间打包 Electron Desktop 应用：`scripts/compile-referenced-projects.ts` 去掉 `desktop-bundle` 步骤，让 Client 编译直接依赖 `host-bundle`，`scripts/build.spec.ts` 同步记录该图。DeepDive Desktop 应用由 `pnpm desktop:build` 经 Tauri 构建，不在 Harness 构建内。`desktop/package.json` 通过 `pnpm -C .. run build` 运行 Harness 构建：它原先的 npm 包装会把仓库构建的 `pnpm exec` 参数交给 npm 处理，丢掉 `--env.DSH_BUILD_FACE host`，导致 Host bundle 按 Client 配置运行、Desktop bundle 准备失败。

`pnpm-workspace.yaml` 保留上游的 `@earendil-works/pi-ai@1.1.0` 升级及其 patch，并去掉 `@electron/osx-sign` 与 `app-builder-lib` 两条 patch 条目——它们唯一的消费者是被排除的 Electron 打包；`patches/app-builder-lib@26.17.0.patch` 与 `THIRD_PARTY_NOTICES.md` 中对应条目一并移除。

`scripts/doc-budgets.manifest.json` 把根 `AGENTS.md` 上限提高到 3550 词，因为该区间在 fork 的 Desktop 章节之外新增了根规则；`docs/AGENTS.md` 采用上游的 1430。

`packages/client/ui-settings-account` 是带两处 fork 自有链接的共享配对。上游现在把侧栏入口、Account 设置、登录步骤与账号流描述为 Desktop 与普通 Web 共用；该文本被采纳，Electron README 链接改为 [Desktop 规则](../../../../AGENTS.md)，引导决策链接保留 fork 的 `implemented/` 目标。`apps/cli` 采用上游的 "create or reset" 措辞并保留 fork 关于 DeepDive 的句子；Electron 内置命令那句不进入。

两篇上游 Note 描述的是本 fork 排除的 Electron 产品，已改写为实际交付的 Tauri 行为：构建链 Note 不再包含 Desktop bundle 步骤，Host release Note 把 Desktop 例外指向 sidecar 重启而不是 Electron main 进程。`docs/defensive-patterns/package-surface.md` 从其依赖示例中去掉了被排除的 `apps/desktop-host` 清单。

`desktop/UPSTREAM_COMMIT` 记录 `dsh-v0.2.1-rc.2`。独立的 DeepDive Desktop 版本不因本次集成改变。该区间引入两个上游 workflow 文件 `desktop-publish.yml` 与 `macos-package.yml`；与其余上游 CI 一样，它们保持不变并保持禁用。

## Alternatives considered

- **把 fork 重置到上游 tag，或只复制选定目录**——拒绝，因为这会绕过对上游与 fork 自有重叠行为的审查，并丢失连续的 fork 历史。

- **把官方 Electron Desktop 与 Tauri 一起集成**——拒绝，因为这会造出第二套 Desktop 产品、打包路径与 runtime 归属模型。

- **保留 `desktop-bundle` 构建步骤并给 fork 的 Desktop 包加 `bundle` 脚本**——拒绝，因为该步骤打包的是 Electron 应用，而 DeepDive Desktop 产物来自 Tauri 构建。

## Consequences

同步后的树以已验证的 `dsh-v0.2.1-rc.2` 提交为祖先，相对该 tag 只领先，并保留经审查的 Tauri Desktop 增量。官方 Electron 产品仍在本 fork 的 Desktop workspace 之外，部署的 runtime 只携带 DeepDive Desktop 包。

## Verification

上游 tag 解析为 `687f282e8625c6b8d11ff58211a90524be2e4317`，它同时是已抓取的 `upstream/master` tip。手工合并没有留下未解决路径或冲突标记，第一父为同步前的 `master` tip、第二父为该 tag，且没有仅上游的提交。`pnpm install` 重新生成 lockfile，其中不再有 `apps/desktop` 或 `apps/desktop-host` importer，并保留 `desktop`、`desktop/client-ui` 与 `desktop/runtime` 三个 importer。

经审查的树通过 `pnpm run build`（8 个 gate 全过）、`pnpm run lint`（0 错误）、`pnpm run verify-translation-pairing`（1010 对）、`pnpm run verify-third-party-notices` 与 `pnpm run hygiene`（21 个 gate 全过）。两处 gate 输入跟随被裁剪的构建链与本区间引入的 preset id：`scripts/compile-referenced-projects.spec.ts` 期望 Client 编译依赖 `host-bundle`；`scripts/rescope-vendor.ts` 把 `cordis` preset id 在 CLI bundle-transition 场景与 `v0.2.1-alpha.1` 的 subagent preset 升级指南中列为产品数据，而不是按 rescope 前的包名处理。

`pnpm run doc-sync` 通过 43 个 gate 中的 42 个；其余 `verify-repository-references` 发现是本地对象库碰撞，不是同步进来的引用：`python/sdk/uv.lock` 中一条 PyPI wheel URL 含七字符片段 `6344383`，它在本克隆中唯一前缀匹配上游提交 `6344383228e5373ab239d856e153f61bd7928776`。同一 lock 行在上游 tag 中也存在，因此没有任何维护文本引用提交。

`pnpm run test` 运行 42701 个用例。在这台 8 核机器上，完全争抢状态下的全量运行会有少量无关文件里的 5 秒用例超时（三次运行分别为 48、12、6 个失败）；它报告的每个文件单独运行都通过，这些文件的 367 个用例中 365 个通过、2 个跳过。其余套件不受影响。

Desktop runtime 构建及其 Node 测试针对同步后的 Harness 包通过（51 个测试中 50 个通过、1 个平台相关跳过），其中包含两个 bundled-sidecar smoke 启动都在 loopback host 上通过；`version:check` 报告 Desktop 版本未变，仍为 `0.1.22`。
