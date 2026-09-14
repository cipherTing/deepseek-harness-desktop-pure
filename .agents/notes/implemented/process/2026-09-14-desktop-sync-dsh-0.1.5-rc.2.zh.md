# Agent Note: Desktop 适配 DeepSeek Harness 0.1.5-rc.2

Status: implemented

[English](2026-09-14-desktop-sync-dsh-0.1.5-rc.2.md) | 中文

## Problem

DeepDive 需要接入官方 tag `dsh-v0.1.5-rc.2`，精确提交为 `fb2c4b9e698e30edb738bca4cf0618587db7d203`，同时保留独立的 Tauri Desktop 产品、DeepDive 品牌、About 和更新入口、受限拖拽反馈以及原生 Session 导出。

本次上游范围包含大量 Harness 包、客户端、Session、native-system、生成产物和文档变动，也包含位于 `apps/desktop` 与 `apps/desktop-host` 的官方 Electron Desktop 产品。它与 DeepDive 的 Tauri 实现属于不同产品层。

## Decision

经过审查的集成树通过真实 no-commit merge 应用官方 `dsh-v0.1.5-rc.2`，并保留 fork 自有的 Desktop 增量。共享 Harness 包和已批准的 client seam 会被同步；上游 Electron 产品层、其打包与发版机制以及 Electron 专属治理文件被排除。DeepDive 继续只保留 `desktop/` 下的 Tauri 实现。

本次同步分支从同步前的 `master` tip 出发；其集成 merge 将已验证的官方 tag 记录为第二父提交。最终落回 `master` 时，落地 merge 将经过审查的同步分支记录为第二父提交。

Desktop client 会等待 locale 和 slots 服务，再注册 DeepDive 品牌、About 区块、更新 seat 和 Desktop 拖拽反馈。macOS overlay 下的品牌组只在绘制时下移 4px，不改变 60px 的 logo 行布局；Windows 保持上游位置。

根 README 标明集成的 DSH 内核为 `0.1.5-rc.2`（`dsh-v0.1.5-rc.2`）。`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.5-rc.2`。独立的 DeepDive Desktop 版本保持 `0.1.12`。

## Alternatives considered

- **reset 到上游 tag 或复制选定目录**——不采用，因为这会绕过上游与 fork 自有行为重叠部分的审查，并丢失连续的 fork 历史。

- **把官方 Electron Desktop 与 Tauri 一起接入**——不采用，因为这会创建第二套 Desktop 产品、打包路径和运行时所有权模型，偏离 DeepDive 已选择的 Tauri 路线。

- **通过改变行高或窗口高度移动 macOS 标题**——不采用，因为本次需求是保持现有窗口和布局几何尺寸，只调整视觉上的垂直位置。

- **把源码或静态 bundle 检查当成完整 Desktop 验收**——不采用，因为此前客户端插件生命周期回归已经证明，源码存在不等于组装后的品牌和设置贡献实际生效。

## Consequences

同步后的树以已验证的 rc.2 提交为祖先，相对该 tag 只保留 fork 增量，并保留经过审查的 Tauri Desktop 改动。官方 Electron 产品仍不进入本 fork 的 Desktop workspace。

Desktop 包继续以 `0.1.12` 独立编号；上游内核的可追溯信息分别记录在 README 和 `desktop/UPSTREAM_COMMIT` 中。

macOS 调整只改变绘制位置，不影响标题栏手势、窗口总高度、New Session 位置或 Windows 渲染。

## Verification

上游远端 tag 解析为 fb2c4b9e698e30edb738bca4cf0618587db7d203，手工 merge 没有未解决路径。审查树已通过 pnpm run clean、pnpm run build、pnpm run constraints、pnpm run verify-third-party-notices、pnpm run verify-translation-pairing、pnpm run verify-agent-note-format、pnpm run verify-agent-note-classification、pnpm run verify-client-ui-i18n、pnpm run verify-md-links、pnpm desktop:version:check、Desktop typecheck、Desktop lint 和 32 个 Desktop Node 测试。

已知的 `verify-md-wrap` fixture 路径 `ENOTDIR` 失败仍属于本次同步之外的问题，因此没有宣称该项通过。
