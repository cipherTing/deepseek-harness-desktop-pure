# Agent Note: Desktop 适配 DeepSeek Harness 0.1.1-rc.1

Status: implemented

[English](2026-08-21-desktop-sync-dsh-0.1.1-rc.1.md) | 中文

## Problem

Desktop fork 需要适配上游 `dsh-v0.1.1-rc.1` release，同时保持独立的 DeepDive 载体边界，不能把 Desktop 变成上游产品变体，也不能改动 Desktop 自己的版本线。

## Decision

本 fork 已适配上游 `dsh-v0.1.1-rc.1` tag（上游版本 `0.1.1-rc.1`）。本次同步直接在既有同步分支上按顺序分批应用，并在所属文件中处理冲突。Desktop 保持独立版本 `0.1.5`，继续作为上游 Web profile 的载体。

## Scope

- 接入与 Desktop 载体不冲突的上游 release、Web/UI、session、authorization、文档和测试更新。
- 保留 DeepDive 品牌、打包规则、Tauri 生命周期和现有低侵入 Desktop 范围。
- 不因 Desktop 适配而改变 Harness 业务行为。

## Alternatives considered

- **把整段提交一次性做成不透明的 rebase**：本轮不采用，因为改动同时包含文档、CI、Web、session 和 authorization，冲突成本与验证范围不同。
- **另建临时集成分支**：不采用，因为既有同步分支就是维护工作面，本轮直接在该分支分批应用。
- **把 Desktop 版本改成上游版本**：不采用，因为 Desktop 使用独立的 SemVer 版本线。

## Consequences

fork 接入上游 `0.1.1-rc.1` 的源码更新，同时保留 DeepDive 品牌、Desktop `0.1.5` 和 Tauri 载体边界。工作树保持未提交，交由维护者审阅；本机是 macOS，Windows 打包继续只由 CI 检查。

## Verification

同步后的工作树没有未解决的合并项。Windows 打包仍由 CI 负责；本机是 macOS，本轮不尝试 Windows 构建。
