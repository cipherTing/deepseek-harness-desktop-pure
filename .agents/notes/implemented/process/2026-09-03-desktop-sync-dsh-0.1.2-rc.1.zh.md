# Agent Note: Desktop 适配 DeepSeek Harness 0.1.2-rc.1

Status: implemented

[English](2026-09-03-desktop-sync-dsh-0.1.2-rc.1.md) | 中文

## Problem

未发布的 DeepDive `0.1.11` 候选需要适配官方 `dsh-v0.1.2-rc.1`，精确提交为 `a66e4702047846cdaa10c66c9d3df3951f5ea70d`，同时不能改变 fork 自己的 Tauri carrier、DeepDive 品牌、About 页面、更新入口、受限拖拽反馈和原生 Session 导出载体。

rc.1 相比 `dsh-v0.1.2-alpha.5` 仅更新 252 个上游 package 的版本字段，没有改变 Harness 源码、workflow、lockfile 或 Desktop 路径。范围虽小，包元数据仍属于 bundled runtime closure，必须经过真实集成。

## Decision

经过审查的本地 `0.1.11` 候选从已验证的 rc.1 提交开始，在其上保留同一份已审查的 fork 增量。远端 `origin/0.1.11` 在获得明确的 force-with-lease 授权前保持旧的 alpha.5 候选。已发布的 `master`、`v0.1.10` 及其历史保持不变。

全部上游 package manifest 使用 `0.1.2-rc.1`。根 manifest 接受 rc.1 根版本，同时保留 fork 的 Desktop workspace 和命令。由于 `v0.1.11` tag 与 GitHub Release 都不存在，Desktop 继续使用 `0.1.11`。

`desktop/UPSTREAM_COMMIT` 只记录 `dsh-v0.1.2-rc.1`。目标继续保留已批准的 `settings.update` seat、原生 Session 导出保存载体，以及用于注册 DeepDive 品牌、About 区域和更新控件的 client UI 服务注入。

## Alternatives considered

- **因为只改 package version 就跳过手工集成**——不采用，因为发布元数据会控制 runtime closure，必须和 fork 根 manifest 一起审查。

- **把 Desktop 升级到 `0.1.12`**——不采用，因为 `0.1.11` 尚无 release tag 或 GitHub Release，仍是同一个未发布的 Desktop 候选。

- **立即 push 重建后的分支**——不采用，因为现有远端分支仍指向 alpha.5 候选；替换它需要单独明确授权和精确的 force-with-lease。

## Consequences

本地 `0.1.11` 候选将 rc.1 记录为上游祖先，同时保留已验证的 Desktop 行为。在 rc.1 获得自己的远端验证并得到授权更新远端前，它会刻意与 `origin/0.1.11` 不同。

alpha.5 的分支打包只能证明旧 SHA。rc.1 在后续任何 push 或发版决定前，都需要自己的构建和 runtime 验证。

## Verification

上游远端 tag 解析为 `a66e4702047846cdaa10c66c9d3df3951f5ea70d`，alpha.5 是其祖先。从已验证的 `0.1.11` alpha.5 候选执行真实 no-commit merge 后没有未解决路径。251 个发生变化的非根上游 manifest 与 rc.1 完全一致；根 manifest 同时包含 rc.1 版本和 fork 的 Desktop workspace、命令。

审查树已通过 `pnpm run clean`、`pnpm run build`、runtime 部署、hygiene、Desktop 版本校验、30 个 Desktop Node 测试、9 个 Desktop Rust 测试、Desktop typecheck 和 Desktop lint。无头浏览器会启动已部署的 bundled sidecar，渲染 Harness 内核为 `0.1.2-rc.1` 的 DeepDive `0.1.11`，并确认更新控件、About DeepDive 入口和 About 页检查更新操作，且没有浏览器错误。
