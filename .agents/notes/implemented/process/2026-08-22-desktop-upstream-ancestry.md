# Agent Note: Desktop upstream ancestry preservation

Status: implemented

English | [中文](2026-08-22-desktop-upstream-ancestry.zh.md)

## Problem

A complexity-ordered manual synchronization can reproduce an upstream release's content without making the exact upstream target an ancestor of the fork. GitHub then reports already integrated commits as behind, and a later merge must reconsider the same history.

## Decision

Every completed Desktop synchronization confirms the target's peeled commit SHA against the upstream remote and makes that verified commit an ancestor of the fork HEAD. A target that is not already an ancestor is recorded through a normal `--no-ff` merge of the verified SHA after its changes have been reviewed and resolved in complexity-ordered batches. Published `master` history and release tags are never rebased or force-pushed to repair ancestry.

The already integrated `dsh-v0.1.1-rc.2` target at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` uses one tree-preserving `-s ours` merge as a named exception. The rc2 content remains owned by the existing [synchronization decision and verification](2026-08-21-desktop-sync-dsh-0.1.1-rc.2.md); the exception only adds the target as a second parent. It neither applies nor verifies upstream files and cannot be reused for a later target.

A completed synchronization verifies the target's upstream identity, confirms that it is an ancestor, and reports no commits from the fixed target on the right side of `HEAD...target`. The ancestry and count checks do not prove content integration. The rc2 repair also verifies its two parents and an empty tree diff against its first parent.

## Alternatives considered

- **Rebase the fork onto rc2.** Rejected because it rewrites the published `master` history and disconnects existing release tags from the maintained branch.
- **Run a normal merge for the disconnected rc2 history.** Rejected for this one repair because the content was already integrated and verified, while a normal merge replays legacy translation-pairing and rename conflicts with no intended tree change.
- **Keep content-only synchronization history.** Rejected because it leaves GitHub's behind count misleading and makes later merges reconsider upstream commits that the fork already reviewed.

## Consequences

Git history records every synchronized upstream target, so future comparisons begin at the recorded release instead of the older common ancestor. The rc2 merge carries no content evidence by itself; its safety depends on the existing synchronization audit, and routine synchronizations must continue to expose and resolve real upstream changes through normal merges.
