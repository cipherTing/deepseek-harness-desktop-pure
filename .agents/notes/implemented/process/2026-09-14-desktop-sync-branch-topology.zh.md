# Agent Note: Desktop 同步分支拓扑

Status: implemented

[English](2026-09-14-desktop-sync-branch-topology.md) | 中文

## Problem

DeepDive 需要在保留 fork 连续 `master` 线的同时接入每个已经验证的上游 release，并让 Git 历史明确显示同步从这条线开始。直接以官方 tag 为根创建的分支虽然可以携带相同的代码文件，却会让 fork 的同步分支拥有错误的起点。

## Decision

每次同步都先获取并验证精确的上游 tag 或 commit，确认当前 `origin/master` tip，然后从该 `master` tip 创建新的 `codex/` 同步分支。在同步分支上执行真实的 `git merge --no-commit --no-ff <verified-upstream-sha>`，解决并审查合并后的代码树；该集成 merge 以同步前的 `master` tip 为第一父提交，以已验证的上游目标为第二父提交。

同步分支通过相关检查后，使用正常的 `git merge --no-ff <sync-branch>` 合回 `master`。落地 merge 以当前 `master` tip 为第一父提交，以经过审查的同步分支为第二父提交。常规同步不创建以上游为根的候选分支，不把分支重建到上游 tag，不重置 `master`，也不 rebase 已发布历史。

精确的上游目标必须成为最终 `master` 代码树的祖先。`desktop/UPSTREAM_COMMIT` 记录精确的 tag 名称或完整 commit SHA。fork 与上游的关系使用 `git rev-list --left-right --count <verified-upstream-sha>...master` 报告；左侧是只属于上游的提交，右侧是只属于 fork 的提交。

## Alternatives considered

- **手工同步后创建以上游为根的候选分支**——不采用，因为这会让同步分支看起来从官方项目开始，并把分支祖先关系与实际审查过的 fork 起点分离。

- **把 `master` reset 或 rebase 到上游目标**——不采用，因为这会改写连续 fork 历史，并可能使已发布提交和 release tag 脱离维护主线。

- **直接把 `master` fast-forward 到同步分支，不创建落地 merge**——不采用，因为显式的 no-ff 落地可以把经过审查的同步分支记录为进入连续主线的完整单元。

## Consequences

冲突会在第一父提交是 fork 当前 `master` 的分支上解决，因此集成历史会直接标明 fork 基线和官方上游目标。最终 `master` 会领先已验证的上游目标，同时保留 fork 已有历史。同步分支本身就是验证和发版准备产物，不需要第二个以上游为根的分支。
