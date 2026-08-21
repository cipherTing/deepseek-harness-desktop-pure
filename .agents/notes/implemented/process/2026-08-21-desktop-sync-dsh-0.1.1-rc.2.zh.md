# Agent Note: Desktop 适配 DeepSeek Harness 0.1.1-rc.2

Status: implemented

[English](2026-08-21-desktop-sync-dsh-0.1.1-rc.2.md) | 中文

## Problem

Desktop fork 需要跟随上游 `dsh-v0.1.1-rc.2` release，同时保持独立的 DeepDive 载体边界，不能把 Desktop 变成上游产品变体，也不能改动 Desktop 自己的版本线。

## Decision

本 fork 已适配上游 `dsh-v0.1.1-rc.2` tag，目标为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。同步继续在既有的 `codex/sync-dsh-v0.1.1-rc.2` 分支上进行，并按提交复杂度分批审查。Desktop 保持独立的 `0.1.6` 版本，继续作为上游 Web profile 的载体。

本轮接入 rc2 的源码、测试、包元数据、生成参考和双语文档，同时保留 DeepDive 品牌与 Desktop 专属改动。根目录品牌 README 仍由 fork 自己维护。上游 `SubagentHeaderLineage` 文件被有意排除，因为本 fork 已移除 lineage slot，并使用既有的 `SubagentCatalogAction` 界面；只恢复这两个文件会留下不兼容的死代码并改变 fork 的 UI。

## Alternatives considered

- **完整恢复上游 lineage UI 链路**：不采用，因为这会改变 fork 现有的 subagent header 行为，并把同步扩大到 Desktop 适配之外。
- **保留未使用的 lineage 文件，只补依赖**：不采用，因为 fork 当前的 contract、locale slot 和 props 不提供该组件所需的上游界面，包级类型检查会失败。
- **另建临时集成分支**：不采用，因为既有同步分支就是维护工作面。

## Consequences

fork 接入上游 `0.1.1-rc.2` 更新，同时保留 DeepDive 品牌、Desktop `0.1.6` 和 Tauri 载体边界。不因 Desktop 适配而改变 Harness 运行时行为。Windows 打包仍由 CI 负责；本机是 macOS，本轮不尝试 Windows 构建。

## Verification

本次同步已通过宿主构建、类型等价和生成目录检查、文档站检查、Markdown 链接检查、双语配对检查以及 `ui-subagent` TypeScript 检查。rc2 完整性审计未发现缺失的上游路径；剩余差异属于有意保留的 fork 品牌与 UI 差异。
