# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.7-rc.1

Status: implemented

English | [中文](2026-09-24-desktop-sync-dsh-0.1.7-rc.1.zh.md)

## Problem

DeepDive must integrate upstream tag `dsh-v0.1.7-rc.1` at exact commit `46a7f68b0922371ce7144b668b90e377d8e799f4` while retaining its independent Tauri Desktop product and the Desktop delta it already carries.

The upstream range adds Harness packages, client surfaces, specs, snapshots, and documentation, and keeps growing the official Electron Desktop product under `apps/desktop` and `apps/desktop-host`. It also changes two conventions this fork consumes: workspace dependency release ranges, and a `cordis` locale namespace in a new client row.

## Decision

The reviewed integration tree applies upstream `dsh-v0.1.7-rc.1` through a real no-commit merge and keeps the fork-owned Desktop delta. Shared Harness packages, client surfaces, and the approved client seams are integrated; the Electron product layer stays out: 58 modify/delete conflicts under `apps/desktop`, `apps/desktop-host`, and `apps/web/tests/desktop-updates.e2e.ts`, 7 files newly added under `apps/desktop`, and the `2026-09-15-desktop-native-fatal-recovery` note triplet that documents the Electron dialog and profile recovery. DeepDive keeps the single Tauri implementation under `desktop/`.

The sync branch `codex/sync-dsh-v0.1.7-rc.1` starts at the pre-sync `master` tip `4cff7a2a1867e9dcc1c6dcb3f214185bbd5a5da1`; its integration merge records the verified upstream tag as second parent. At the verification point the fork is 318 commits behind and 66 ahead of that tag.

Git's rename detection paired two unrelated pairs because both sides open with similar headings. The fork's `desktop/assets/README.*` was paired with upstream's `apps/desktop/README.*`, and the fork's `bug-fix/2026-08-19-desktop-omits-native-menu.*` with upstream's excluded `architecture/2026-09-15-desktop-native-fatal-recovery.*`. Both pairing records keep the fork's own side, so the brand-asset page and the native-menu note stay recorded against their own translations.

`packages/client/ui-settings-general` is a genuine shared pair. Upstream refined the Desktop update-control paragraph with its geometry and color spec; that text is adopted with the fork's [Desktop release rules](../../../../AGENTS.md) link kept in place of the link into the excluded Electron README, and the pairing record is re-recorded with `pnpm run verify-translation-pairing --write`.

Upstream added a real-Git SSH-fallback test to `plugin-manager`'s manager spec that reaches for the pnpm bundled inside the Electron application. That product layer is excluded, so the spec points at this fork's own deployed runtime package manager, `desktop/runtime/node_modules/pnpm/bin/pnpm.mjs`, which is the same bundled-pnpm carrier the Plugin Manager runs in a packaged installation. The removed Electron-only cases stay removed.

Upstream's `2026-09-22-workspace-release-ranges` rule requires `workspace:*` for DSH targets and `workspace:~` for vendor and native targets, and the workspace gate enforces it for every consumer. `desktop/runtime/package.json` carried 47 caret ranges across both families and `desktop/client-ui/package.json` carried the vendor caret for `@deepseek-ai/schemastery`; both now follow the rule, and `desktop/tests/config.test.mjs` asserts the DSH range it now observes.

Upstream's new `2026-09-22-fatal-diagnostics-and-crash-reports` note partially supersedes the excluded Electron fatal-recovery note. Its supersession sentence now names the upstream Electron product instead of linking a file this fork does not carry; the shared Harness decisions it records stay intact.

The new `CordisPreparingRow` client row uses the `cordis` locale namespace, which the vendor rescope treats as a pre-rescope name token everywhere else in `ui-cordis`. The row joins that gate's generic skip list.

`desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.7-rc.1`, and the root READMEs identify the integrated kernel as `0.1.7-rc.1`. The root manifest carries upstream's version; the independent DeepDive Desktop version is unchanged by this integration. The upstream range introduces no new workflow file; the existing upstream workflows are modified only, and this fork keeps them disabled.

## Alternatives considered

- **Reset the fork to the upstream tag or copy selected directories** — rejected because it bypasses review of overlapping upstream and fork-owned behavior and loses the continuous fork history.

- **Integrate the official Electron Desktop alongside Tauri** — rejected because it would create a second Desktop product, packaging path, and runtime ownership model.

- **Keep the Electron-bundled pnpm path in the SSH-fallback spec** — rejected because the path does not exist here and the test covers Harness install behavior that this fork ships; the deployed runtime package manager serves the same role.

- **Exempt `desktop/runtime` from the workspace release-range rule** — rejected because the rule owns packed version substitution for every consumer, and the deploy root is one.

- **Rename the false-rename pairing records to match the Electron files** — rejected because the fork's own pages would then be recorded against translations they do not have.

## Consequences

The synchronized tree has the verified `dsh-v0.1.7-rc.1` commit as an ancestor, is ahead-only relative to that tag, and keeps the reviewed Tauri Desktop delta. The official Electron product stays outside this fork's Desktop workspace, and the deployed runtime carries only the DeepDive Desktop packages.

## Verification

The upstream tag resolves to `46a7f68b0922371ce7144b668b90e377d8e799f4`. The manual merge leaves no unresolved path and no conflict marker. `pnpm install --no-frozen-lockfile` regenerates the lockfile with no `apps/desktop` importer and keeps the three `desktop/` importers. The reviewed tree passes `pnpm run typecheck`, `pnpm run lint` (0 errors, 0 warnings), `pnpm run hygiene` (18 of 18 gates), `pnpm run test:docs`, `pnpm run build`, and the focused unit run over the packages this range changed. The Desktop runtime build passes, its Node tests pass 37 of 37 — including both bundled-sidecar smoke launches on the loopback host — and `version:check` reports `0.1.17` synchronized. A combined unit run over seven changed packages timed out four `plugin-manager` cases at the 5s default; each passes in isolation and the full `plugin-manager` spec passes 243 of 243 alone.
