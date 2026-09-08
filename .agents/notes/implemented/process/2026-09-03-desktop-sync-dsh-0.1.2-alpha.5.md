# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.2-alpha.5

Status: implemented

English | [中文](2026-09-03-desktop-sync-dsh-0.1.2-alpha.5.zh.md)

## Problem

The DeepDive Desktop distribution must adopt upstream tag `dsh-v0.1.2-alpha.5` at `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` without losing its Tauri carrier, DeepDive brand, About page, update entry, scoped drag feedback, or native Session export carrier.

The upstream range since `dsh-v0.1.2-alpha.3` changes client rendering and slot metadata, session event identity, projection-cache recovery, package layout, generated artifacts, and documentation. The fork therefore needs a reviewed integration tree rather than an upstream reset or a directory copy.

## Decision

The reviewed `0.1.11` tree starts at the verified alpha.5 commit and contains the complete fork delta above it. The local manual integration branch is only the content-review anchor. Published `master`, `v0.1.10`, and their history remain unchanged.

Upstream-owned Harness behavior, package metadata, lockfile updates, snapshots, and package removals use the alpha.5 result. The cleanup step removes ignored `lib/` and `node_modules/` residue from two packages that alpha.5 deletes; it does not restore those removed packages or weaken the workspace hierarchy check.

Desktop retains only its carrier and the two approved non-Desktop additions: the empty-on-Web `settings.update` seat and the asynchronous Session-export save carrier. The target slot catalog still exposes `sidebar.brand.name`, `settings.section`, and `settings.update`. The Desktop client plugin waits for its locale and slots services before registering all three contributions.

`desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.2-alpha.5`. Desktop package metadata is `0.1.11`; the upstream root version remains `0.1.2-alpha.5`.

## Alternatives considered

- **Reset to alpha.5 or replace the tree from a Desktop allowlist** — rejected because either approach hides overlap between upstream changes and fork-owned behavior.

- **Keep deleted upstream packages to satisfy a dirty local build directory** — rejected because those directories are ignored build residue, not alpha.5 source packages; `pnpm run clean` removes them safely.

- **Skip runtime and browser assembly checks after static checks pass** — rejected because a prior client-plugin lifecycle regression left the DeepDive brand and About entry absent while source and bundle checks still passed.

- **Rebase or force-push published `master`** — rejected because published `master` and release tags are not rewritten. The upstream-rooted candidate topology is prepared separately; an authorized later landing preserves the continuous `master` line through a normal merge.

## Consequences

The Desktop runtime uses the current alpha.5 web profile and presents DeepDive in the real assembled browser UI. Its settings navigation contains About DeepDive, and a newer mocked release renders the Desktop update control. Web keeps no update contribution and continues to use the browser download carrier by default.

The fork is ahead of alpha.5 by its reviewed Desktop delta, while alpha.5 is an ancestor of `0.1.11`. The branch can be tested or published later without rewriting the released branch.

## Verification

The upstream remote tag resolves to `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`, and the manual no-commit merge has no unresolved paths. The reviewed tree passes `pnpm run clean`, `pnpm run build`, `pnpm --filter @deepseek-ai/dsh-desktop run build:runtime`, `pnpm run hygiene`, `pnpm desktop:version:check`, the 30 Desktop Node tests, Desktop typecheck, and Desktop lint.

A headless browser starts the deployed sidecar through its bundled Node executable, completes the upstream beta notice, and verifies the rendered DeepDive brand, version `0.1.11`, alpha.5 kernel version, update control, About DeepDive entry, and About-page update action without browser errors.
