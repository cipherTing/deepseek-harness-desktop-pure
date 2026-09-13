# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.2-alpha.1

Status: implemented

English | [中文](2026-08-28-desktop-sync-dsh-0.1.2-alpha.1.zh.md)

## Problem

The Desktop fork must integrate upstream `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`. The upstream range changes the Web composition, Connection authentication, Settings Remote ownership, profile module fallback, package dependencies, and documentation structure. Replacing the fork tree with upstream would hide the conflicts that determine whether Desktop still preserves upstream behavior.

## Decision

The synchronization uses the manual-first workflow in [`dsh-desktop-upstream-sync`](../../../skills/dsh-desktop-upstream-sync/SKILL.md). A temporary branch starts from the original `0.1.9` tip and performs a real `--no-commit --no-ff` merge of the verified upstream SHA. Conflicts and overlapping auto-merges are resolved by ownership in complexity order before any final history rewrite.

The final unpublished `0.1.9` branch is based on `dsh-v0.1.2-alpha.1`, with the verified manual integration delta committed above it. The final tree must match the temporary integration commit. Published `master`, Desktop release tags, and their commits remain unchanged; the rewritten branch uses an exact `--force-with-lease`. Desktop keeps its independent version `0.1.7`.

Desktop retains the upstream Connection, Host/Origin checks, exact Fetch routes, and Typert Remote gateway. The overlay replaces only directory picking and Settings Controller native open operations. The sidecar sends Connection's one-time authenticated launch URL, and Rust accepts only one non-empty token on a loopback HTTP root URL before navigating the WebView.

Alpha1's `runProfile()` heals the CLI installation closure. Desktop additionally heals the deployed Desktop runtime closure before profile boot because its overlay loads packages owned by the deploy root. The runtime manifest explicitly includes the Service Definition peers required by the Web profile so the production deploy contains every loader-visible package.

The only Harness source changes retained for Desktop are the optional `settings.update` slot after the settings trigger and the asynchronous Session ZIP save carrier. Web leaves the update slot empty and keeps the browser download carrier; Desktop occupies the slot with its update badge and installs a Tauri save carrier without exposing general filesystem access.

The Tauri carrier validates the export URL against the current sidecar origin, reads matching cookies including the HttpOnly browser session from the main WebView through Tauri's cookie API, and attaches them only to that native GET. The page supplies neither cookies nor arbitrary request headers.

The root documentation uses `README.md` for Chinese and `README.en.md` for English. The translation-link resolver treats that pair as the root exception while ordinary upstream pairs retain the `.zh.md` convention.

Desktop workspace manifests declare MIT for alpha1's package-license check. Knip treats the four Desktop runtime sources as entries and excludes DSH packages that exist only to close the profile and overlay deploy graph from unused-dependency reporting; `verify-runtime-closure` and the production sidecar smoke continue to validate that graph.

Alpha1's documentation rewrite changes six complete prose sites tracked by the Cordis rescope codemod and introduces Inspector's quoted `cordis/tree` wire topic. The synchronization updates the exact forward/reverse prose pairs, excludes only that wire identifier from generic package-name rewriting, and keeps the three real Inspector Cordis imports under exact edits; the alpha1 product and documentation text stays unchanged.

## Alternatives considered

- **Reset `0.1.9` to the upstream tag and reconstruct the fork from an allowlist** — rejected because it skips the manual integration tree, hides conflict decisions, and provides no proof that overlapping upstream changes were reviewed.
- **Replay historical synchronization commits onto alpha1** — rejected because those commits contain older upstream trees and would overwrite or conflict with the verified alpha1 state.
- **Keep the removed ApiProxy adapter** — rejected because alpha1 owns settings through `SettingsController`, Connection, and Typert Remote; retaining the old gateway would duplicate or bypass the upstream transport.
- **Merge alpha1 directly into published `master`** — rejected for this cycle because `0.1.9` is the explicitly authorized unpublished synchronization branch and must end with upstream as its base.

## Consequences

The synchronized branch records alpha1 as an ancestor and contains only the reviewed fork delta above it. Desktop startup now depends on both the upstream CLI fallback and the Desktop deploy-root fallback, and the deploy manifest names the required Service Definition peers explicitly. Windows installer behavior remains owned by the two-platform GitHub workflow; this macOS verification does not replace installed Windows acceptance.

## Verification

The upstream remote resolves `dsh-v0.1.2-alpha.1` to `cd5ef8148158c3a752a658978873241fdf8e2bbc`. The manual merge exposes 84 conflicts before ownership-based resolution. The final package audit leaves only the Settings update slot, Session ZIP save carrier, and generated client slot catalog outside `desktop/` under `packages/`.

Verification passes the Harness production build, root lint, Desktop version check, Desktop typecheck and lint, 39 focused Settings and Session-export tests, 29 Desktop configuration and update-UI tests, 31 Desktop Node tests including both production sidecar launch modes and the token-cookie authentication round trip, 7 Rust tests, 19 translation-link tests, all 15 `test:docs` gates, and all 32 `doc-sync` gates.

`pnpm run hygiene` passes all 15 gates. The focused rescope classifier run passes 4 tests, `rescope-vendor:check` passes, and a detached worktree completes `--apply --reverse`, reverse check, forward apply, and forward check before returning to the exact starting tree.
