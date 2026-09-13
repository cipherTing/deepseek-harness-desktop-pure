# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.2-alpha.2

Status: implemented

English | [中文](2026-08-31-desktop-sync-dsh-0.1.2-alpha.2.zh.md)

## Problem

The Desktop fork must follow upstream tag `dsh-v0.1.2-alpha.2` at `0a53fb55bea101816fa226bb964ae2bed71c343b` without losing the fork-owned packaging, native integration, branding, update entry, or drag-and-drop behavior.

The upstream range contains 234 commits and changes 1,604 paths. It adds the client connection recovery surface, moves client service ownership, changes dependency verification, and removes Knip from repository tooling. A tree replacement would hide the overlapping decisions that determine whether the Desktop runtime still starts and whether its UI contributions remain registered.

## Decision

The synchronization follows [`dsh-desktop-upstream-sync`](../../../skills/dsh-desktop-upstream-sync/SKILL.md): a temporary branch starts from the published fork tip, performs a real no-commit merge of the verified upstream tag, resolves conflicts by ownership, and only then materializes the reviewed tree on the unpublished `0.1.9` branch.

The final `0.1.9` branch is based on `dsh-v0.1.2-alpha.2` and contains the reviewed fork delta above it. Published `master`, `v0.1.8`, and their commits remain unchanged. Desktop versioning remains independent from the upstream root version.

The upstream `ConnectionIndicator` and connection-state injection stay in the settings shell. The fork-owned `settings.update` seat also remains declared and rendered; its badge is nested below the settings trigger while the connection indicator keeps the upstream adjacent-row placement.

The Desktop sidecar continues to use the upstream Web profile, Connection transport, overlay mechanism, Tauri Shell plugin, native file handlers, and loopback session export carrier. No generic WebView shell or filesystem capability is added.

Alpha2 adds `@deepseek-ai/dsh-util-time` as a required workspace peer of the subagent package. The Desktop runtime declares it explicitly so a fresh production deploy contains the package before the sidecar loads the plugin tree.

The upstream removal of Knip is accepted. Knip-specific package, lockfile, and rescope entries are removed instead of preserving an obsolete checker configuration.

The vendored-package rescope keeps the fork's current exact prose pairs and Inspector wire-identifier exclusions, while incorporating alpha2's added Inspector import coverage. The rescope check remains idempotent on the merged tree.

`desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.2-alpha.2`, and Desktop package metadata is synchronized to `0.1.9` without changing the upstream root version.

## Alternatives considered

- **Reset the fork to alpha2 or replace the tree from an allowlist** — rejected because it hides conflicts and cannot prove that fork-owned Desktop behavior survived the synchronization.

- **Replay the old alpha1 synchronization commits** — rejected because those commits contain an older upstream tree and would reintroduce obsolete dependency and client-service assumptions.

- **Remove the Desktop update seat to match upstream exactly** — rejected because it would remove the shipped Desktop update affordance; the sanctioned seat is retained with the smallest layout adaptation.

- **Merge alpha2 into published `master` during this cycle** — rejected because the new `0.1.9` synchronization must be reviewed on an unpublished branch before any release integration.

## Consequences

The branch records alpha2 as an ancestor while keeping the fork's Desktop carrier and branding intact. The settings footer now supports both upstream connection recovery feedback and the Desktop update badge without changing the Web-only connection behavior.

The repository no longer runs Knip. Hygiene uses the upstream alpha2 gate set, including package dependency and install-layout checks.

The known `verify-md-wrap` failure remains outside this synchronization: the checker still follows a snapshot path through a file and raises `ENOTDIR`. No validator or snapshot change is included in this cycle.

## Verification

The upstream remote resolves `dsh-v0.1.2-alpha.2` to `0a53fb55bea101816fa226bb964ae2bed71c343b`. The manual merge exposed four textual conflicts: the Knip deletion, the settings shell stylesheet, the settings shell component, and the vendored rescope script.

`pnpm install --frozen-lockfile`, `pnpm run rescope-vendor:check`, root typecheck, root lint, root build, Desktop typecheck, Desktop lint, and Desktop runtime build pass.

The Desktop Node suite passes all 30 tests, including both production sidecar launch modes, the client contribution lifecycle, update UI, native file-drop behavior, and SemVer checks.

`pnpm run hygiene` passes all 15 gates.

`pnpm run doc-sync` passes 31 gates and fails only the known markdown-wrap gate with the snapshot-path `ENOTDIR` described above; the failure is intentionally not repaired in this cycle.
