# Agent Note: Desktop 上游祖先关系保留

Status: implemented

[English](2026-08-22-desktop-upstream-ancestry.md) | 中文

## Problem

按复杂度分批进行手工同步时，可以复现上游 release 的内容，却没有让精确的上游目标成为 fork 的祖先。GitHub 因此会把已经接入的提交显示为 behind，后续 merge 还会重新处理同一段历史。

## Decision

每次完成 Desktop 同步前，都必须从上游远端确认目标最终指向的 commit SHA，并让这个已验证的 commit 成为 fork HEAD 的祖先。目标尚未成为祖先时，在按复杂度分批审查和解决其改动后，通过对已验证 SHA 执行正常的 `--no-ff` merge 记录祖先关系。不得为了修复祖先关系而 rebase 或 force-push 已发布的 `master` 历史和 release tag。

已经完成内容接入的 `dsh-v0.1.1-rc.2`，其 commit 为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，允许一次保持代码树不变的 `-s ours` merge 作为具名例外。rc2 内容仍由既有的[同步决策与验证](2026-08-21-desktop-sync-dsh-0.1.1-rc.2.zh.md)负责；该例外只把目标补为第二父提交。它既不应用也不验证上游文件，后续目标不得复用。

同步完成时必须验证目标的上游身份、确认目标已经成为祖先，并确认固定目标没有提交残留在 `HEAD...target` 的右侧。祖先和数量检查都不能证明内容已经接入。rc2 修复还必须验证两个父提交，并确认相对第一父提交的代码树 diff 为空。

## Alternatives considered

- **把 fork rebase 到 rc2。** 不采用，因为这会改写已发布的 `master` 历史，并使现有 release tag 与维护分支脱节。
- **对当前断开的 rc2 历史执行正常 merge。** 本次修复不采用，因为内容已经接入并验证，而正常 merge 会重新触发历史翻译配对和重命名冲突，却没有预期的代码树改动。
- **继续保留只有内容、没有祖先关系的同步历史。** 不采用，因为 GitHub 的 behind 数量会持续产生误导，后续 merge 还要重新处理 fork 已经审查过的上游提交。

## Consequences

Git 历史会记录每个已同步的上游目标，后续比较从已记录的 release 开始，不再回到更早的共同祖先。rc2 merge 本身不提供内容完整性证据；它的安全性依赖既有同步审计，常规同步仍必须通过正常 merge 暴露并解决真实的上游改动。
