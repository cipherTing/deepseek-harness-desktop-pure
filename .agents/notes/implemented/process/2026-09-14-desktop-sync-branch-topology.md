# Agent Note: Desktop synchronization branch topology

Status: implemented

English | [中文](2026-09-14-desktop-sync-branch-topology.zh.md)

## Problem

DeepDive must integrate each verified upstream release while preserving the fork's continuous `master` line and showing that synchronization started from that line. A branch rooted directly at an upstream tag can carry the same files but gives Git history the wrong starting point for the fork's synchronization branch.

## Decision

Each synchronization fetches and verifies the exact upstream tag or commit, verifies the current `origin/master` tip, and creates a newly named `codex/` sync branch at that `master` tip. The sync branch performs a real `git merge --no-commit --no-ff <verified-upstream-sha>`, resolves and reviews the resulting tree, and records the pre-sync `master` tip as its first parent and the verified upstream target as its second parent.

After the sync branch passes its relevant checks, a normal `git merge --no-ff <sync-branch>` lands it on `master`. The landing merge records the current `master` tip as its first parent and the reviewed sync branch as its second parent. Routine synchronization does not create an upstream-rooted candidate, rebuild a branch on the upstream tag, reset `master`, or rebase published history.

The exact upstream target is an ancestor of the final `master` tree. `desktop/UPSTREAM_COMMIT` records the exact tag name or full commit SHA. The fork relationship is reported with `git rev-list --left-right --count <verified-upstream-sha>...master`; the left count is upstream-only and the right count is fork-only.

## Alternatives considered

- **Create an upstream-rooted candidate after manual integration** — rejected because it makes the synchronization branch appear to start from the official project and separates the branch ancestry from the fork line that was actually reviewed.

- **Reset or rebase `master` onto the upstream target** — rejected because it rewrites the continuous fork history and can disconnect published commits and release tags.

- **Fast-forward `master` to the sync branch without a landing merge** — rejected because the explicit no-ff landing records the reviewed branch as the unit that was accepted into the continuous line.

## Consequences

Conflicts are resolved on a branch whose first parent is the fork's current `master`, so the integration history directly identifies the fork baseline and the official upstream target. The final `master` remains ahead of the verified upstream target without replacing the fork's existing history. The sync branch itself is the validation and release-preparation artifact; no second upstream-rooted branch is required.
