---
name: dsh-desktop-upstream-sync
description: Use when checking or synchronizing DeepDive with an upstream DeepSeek Harness tag or commit through a manual sync branch created from the fork master branch.
---

# Synchronize DeepDive with upstream

DeepDive is an independent Desktop distribution that follows official Harness releases while retaining its Desktop packaging and integrations. Each synchronization uses a newly named sync branch created from the verified current `master` tip. The sync branch performs the real upstream merge, carries the reviewed tree, and is later merged back into `master`. This workflow does not authorize pushing, force-pushing, mirroring tags, merging `master`, or publishing a release; obtain authorization for each requested remote action.

## Create and review the sync branch

Never reset an existing fork line to the upstream target as a substitute for synchronization, replace the whole tree with upstream, reconstruct it from a directory allowlist, create the sync branch from the upstream tag, or use `-s ours` to bypass content review. The sole named rc2 ancestry-repair exception is documented in root `AGENTS.md` and is not a routine synchronization mechanism.

1. Fetch the exact upstream tag or commit and confirm its remote peeled SHA.
2. Fetch `origin/master`, verify the destination tip, and record its exact OID. Create a new sync branch from that tip and create a local backup ref before any history rewrite.
3. On the sync branch, run a real no-commit merge of the verified upstream SHA:

   ```sh
   git merge --no-commit --no-ff <verified-upstream-sha>
   ```

4. Resolve textual conflicts and inspect overlapping automatic merges by responsibility. Keep upstream-owned Harness behavior from the verified upstream result unless a concrete current fork rule is an integration blocker. Keep fork-owned branding, Desktop packaging, native integration, and sanctioned seams.
5. Commit the resolved tree only after its relevant checks pass. This commit is the sync branch's integration commit and must retain the pre-sync `master` tip as first parent and the verified upstream SHA as second parent.

A conflict-free merge still needs review. A source diff or generated artifact check does not prove that the Desktop runtime and UI remain functional.

## Product-layer divergence

The upstream `apps/desktop` and `apps/desktop-host` directories implement the official Electron Desktop product. They are not shared Harness packages. DeepDive keeps its Tauri product under `desktop/`; exclude Electron-only shell, Host, packaging, release, UI, and Electron-specific governance files from the reviewed integration tree. Keep upstream packages and client seams that have independent Web or Harness consumers, then verify that the workspace contains only the DeepDive Desktop package.

## Validate and merge the sync branch into master

The sync branch is the reviewed integration artifact. Before landing it, verify its ancestry and tree:

```sh
sync_branch=<sync-branch>
master_base=<pre-sync-master-sha>
verified_upstream=<verified-upstream-sha>
test "$(git rev-parse "$sync_branch^1")" = "$master_base"
test "$(git rev-parse "$sync_branch^2")" = "$verified_upstream"
git merge-base --is-ancestor "$verified_upstream" "$sync_branch"
test "$(git rev-list --count "$sync_branch".."$verified_upstream")" = 0
```

After the sync branch passes the requested checks and the user authorizes landing it, fetch `master` again and merge the sync branch normally:

```sh
git fetch origin master
git switch master
master_base=$(git rev-parse HEAD)
test "$master_base" = "$(git rev-parse origin/master)"
git merge --no-ff <sync-branch>
```

Do not reset or rebase `master` to the upstream target. Capture the landing merge immediately after the merge, before any later governance or release-note commit. Verify that its first parent is the current `master` tip, its second parent is the reviewed sync branch, and its tree is exactly the sync branch:

```sh
landing_merge=$(git rev-parse HEAD)
test "$(git rev-parse "$landing_merge^1")" = "$master_base"
test "$(git rev-parse "$landing_merge^2")" = "$(git rev-parse <sync-branch>)"
git diff --exit-code <sync-branch> "$landing_merge"
git merge-base --is-ancestor <verified-upstream-sha> "$landing_merge"
test "$(git rev-list --count "$landing_merge"..<verified-upstream-sha)" = 0
```

The landing merge records that the sync started from the fork's `master` line. Do not replace the sync branch with the upstream tag or rebuild the branch on the upstream tag.

When reporting the fork's relationship to upstream, use:

```sh
git rev-list --left-right --count <verified-upstream-sha>...<master>
```

The left-hand count is upstream-only (behind) and the right-hand count is fork-only (ahead). `origin/master...master` is only the local/remote delivery comparison and must not be called the fork's upstream lead.

## Finish safely

Update `desktop/UPSTREAM_COMMIT` only after the target and integrated tree are verified. If the target is a tag, mirror that exact tag target only after explicit authorization. Stop without pushing if the remote branch moved, the sync branch ancestry is wrong, a relevant check fails, or any fork delta remains unexplained.
