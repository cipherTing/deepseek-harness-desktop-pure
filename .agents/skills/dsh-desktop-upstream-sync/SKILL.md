---
name: dsh-desktop-upstream-sync
description: Use when checking or synchronizing DeepDive with an upstream DeepSeek Harness tag or commit, including manual conflict integration and an upstream-rooted release candidate that is later merged into the fork master branch.
---

# Synchronize DeepDive with upstream

DeepDive is an independent Desktop distribution that follows official Harness releases while retaining its Desktop packaging and integrations. Each synchronization has two Git artifacts:

- a reviewed manual integration tree, which proves how upstream changes and fork-owned changes were reconciled;
- an upstream-rooted candidate, which carries the reviewed fork delta above the verified upstream target and is used for validation and release preparation.

The candidate is then merged into the continuous fork `master` line. This workflow does not authorize pushing, force-pushing, mirroring tags, merging `master`, or publishing a release; obtain authorization for each requested remote action.

## Manual integration first

Never reset an existing fork line to the upstream target as a substitute for synchronization, replace the whole tree with upstream, reconstruct it from a directory allowlist, or use `-s ours` to bypass content review. After manual review, creating or rebuilding a separately named upstream-rooted candidate is allowed and is the required candidate-materialization step. The sole named rc2 ancestry-repair exception is documented in root `AGENTS.md` and is not a routine synchronization mechanism.

1. Fetch the exact upstream tag or commit and confirm its remote peeled SHA.
2. Record the previous fork candidate or destination tip and the exact remote branch OID. Create a local backup ref before any history rewrite.
3. From the previous reviewed fork tip, run a real no-commit merge of the verified upstream SHA:

   ```sh
   git merge --no-commit --no-ff <verified-upstream-sha>
   ```

4. Resolve textual conflicts and inspect overlapping automatic merges by responsibility. Keep upstream-owned Harness behavior from the verified upstream result unless a concrete current fork rule is an integration blocker. Keep fork-owned branding, Desktop packaging, native integration, and sanctioned seams.
5. Commit the resolved tree only after its relevant checks pass. Record this commit as the manual integration reference.

A conflict-free merge still needs review. A source diff or generated artifact check does not prove that the Desktop runtime and UI remain functional.

## Build the upstream-rooted candidate

After the manual tree is reviewed, materialize the candidate on the verified upstream commit. Carry only the reviewed fork delta above that target; do not replay obsolete synchronization commits or use an unreviewed path allowlist.

The candidate must satisfy:

```sh
git merge-base --is-ancestor <verified-upstream-sha> <candidate>
test "$(git rev-list --count <candidate>..<verified-upstream-sha>)" = 0
git diff --exit-code <manual-integration-commit> <candidate>
```

The candidate's tree must equal the manual integration tree. Its ahead/behind status is measured against the verified upstream target, not the old remote fork branch:

```sh
git rev-list --left-right --count <verified-upstream-sha>...<candidate>
```

The left-hand count is upstream-only (candidate behind upstream) and must be `0`. The right-hand count is the reviewed fork delta above upstream.

Rebase or rebuild is a topology choice, not a rule tied to whether a branch is published. It requires explicit authorization whenever it rewrites a remote branch. Published `master` and release tags are never rewritten; any authorized rewritten push uses the exact observed remote OID with `--force-with-lease`, never raw `--force`.

## Merge the candidate into master

The candidate and `master` have different roles. The candidate is the ahead-only, upstream-rooted validation artifact. `master` is the continuous fork line and keeps its existing history as the first parent.

After the candidate passes the requested checks and the user authorizes landing it, fetch `master` again and merge the candidate normally:

```sh
git fetch origin master
git switch master
master_base=$(git rev-parse HEAD)
test "$master_base" = "$(git rev-parse origin/master)"
git merge --no-ff <candidate>
```

Do not reset or rebase `master` to the upstream target. Capture the merge commit immediately after the merge, before any later governance or release-note commit. Verify that this landing merge was made from the current fork tip and that its tree is exactly the validated candidate:

```sh
landing_merge=$(git rev-parse HEAD)
test "$(git rev-parse "$landing_merge^1")" = "$master_base"
test "$(git rev-parse "$landing_merge^2")" = "$(git rev-parse <candidate>)"
git diff --exit-code <candidate> "$landing_merge"
git merge-base --is-ancestor <verified-upstream-sha> "$landing_merge"
test "$(git rev-list --count "$landing_merge"..<verified-upstream-sha)" = 0
```

The candidate may be used as the second parent of the `master` merge. Do not replace it with the upstream tag: doing so would make the merge tree depend on a different, unreviewed merge result and would no longer preserve the validated candidate artifact.

Later commits may update documentation, release metadata, or other fork-owned files. Keep the landing-merge checks anchored to `landing_merge`; those later commits do not change which candidate was landed.

When reporting the fork's relationship to upstream, use:

```sh
git rev-list --left-right --count <verified-upstream-sha>...<master>
```

The right-hand count is the fork's commits above upstream and the left-hand count is the remaining upstream-only count. `origin/master...master` is only the local/remote delivery comparison; before push it can include the entire synchronized upstream range and must not be called the fork's upstream lead.

## Finish safely

Update `desktop/UPSTREAM_COMMIT` only after the target and integrated tree are verified. If the target is a tag, mirror that exact tag target only after explicit authorization. Stop without pushing if the remote branch moved, the candidate tree differs from the manual integration tree, a relevant check fails, or any fork delta remains unexplained.
