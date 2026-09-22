# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.7-alpha.1

Status: implemented

English | [中文](2026-09-22-desktop-sync-dsh-0.1.7-alpha.1.zh.md)

## Problem

DeepDive must integrate upstream tag `dsh-v0.1.7-alpha.1` at exact commit `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61` while retaining its independent Tauri Desktop product and the Desktop delta it already carries.

The upstream range adds Harness packages, client surfaces, settings infrastructure, and documentation. It also keeps growing the official Electron Desktop product under `apps/desktop` and `apps/desktop-host`.

## Decision

The reviewed integration tree applies upstream `dsh-v0.1.7-alpha.1` through a real no-commit merge and keeps the fork-owned Desktop delta. Shared Harness packages and the approved client seams are integrated; the Electron product layer, its relocated workspace assets, its governance notes, its host tests, and its `@electron/osx-sign` patch entry stay out. DeepDive keeps the single Tauri implementation under `desktop/`. Shared client packages keep the browser-side carrier implementations they ship for every host, including the Electron-backed browser carrier, because those files belong to the packages' own build and specs; no Electron host, packaging, release, or dependency enters the tree.

The sync branch starts at the pre-sync `master` tip; its integration merge records the verified upstream tag as second parent.

Upstream moved the pinned interpreter/Office payload tooling out of the Electron tree into `scripts/primary-runtime/`, where the exe, wheel, and CI builds consume it. That tooling is shared, so this fork now carries it and the Third-Party Notices generator keeps its runtime-lock disclosure; the previous fork adaptation that dropped the lock input is retired, and `lefthook.yml` watches the shared path.

Upstream renamed the client settings service `settingsScope` to `configForms` and moved preferences onto each plugin entry's own configuration form. The Desktop client UI follows both: its Host half declares the entry `Config` and keeps the entry out of the generated settings pages, and its browser half reads and writes the same entry form. The About page and the update badge keep their behavior.

Upstream replaced the fixed settings trigger with the `settings.launcher` seat. The shell adopts that seat and keeps the fork's `settings.update` seat and trigger column below it, so the Desktop update badge still renders where this fork places it.

The asynchronous Session-export save carrier stays in `session-log-export`; upstream's plain browser save would drop native Session ZIP saving. Electron-only test cases stay removed from `plugin-manager`'s manager spec, `ui-directory-picker-native`'s client spec, and `apps/web/tsconfig.json`.

The WebKit model-menu press patch this fork added for `dsh-v0.1.6-alpha.2` survives the integration; upstream's icon rename in that file is absorbed, and the fix is still required because upstream has not shipped its own.

`desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.7-alpha.1`; the root README identifies the integrated kernel as `0.1.7-alpha.1`. The independent DeepDive Desktop version is unchanged by this integration.

Upstream replaced the per-profile module-fallback links and the `resolutionMode` option with an installation-scoped runtime resolution computed before any plugin import. The sidecar now loads the shared `web` profile itself and boots it with `resolvedProfile` anchored on the deployed runtime manifest — this carrier's own installation — so that resolution carries both the Harness closure and the fork's Desktop runtime packages, and no fallback links are written under the Harness home. The Desktop Settings Controller follows upstream's narrowed internals contract and passes only its Tauri-backed `openTextFile`; the removed `openPath` and `canOpenPath` overrides and its own `Config` leave with the old contract.

Upstream's Electron package set selects the Desktop closure from `dependencies` and `peerDependencies` alike. This fork's deployed closure comes from its runtime manifest instead, so the peer-only `@deepseek-ai/dsh-deepseek-account`, required by the new account packages, is declared there; without it the packaged account rows fail to import and the credential surface stays pending.

The upstream Windows Electron packaging and update notes (`2026-09-17-windows-runtime-signature-cache`, `2026-09-17-windows-signature-completion`, `2026-09-20-windows-embedded-mandatory-update`) rule on excluded Electron decisions and leave the tree with them; the archive manifest drops the seal of the excluded `2026-09-16-movable-mandatory-update-window` triplet, and the recorded unknown-cast inventory drops its `apps/desktop` entries. Shared records, package READMEs, specs, and developer docs that referenced the excluded layer now name the Electron product or this fork's own commands: the primary-runtime spec keeps its repository package-manager pin without the Electron carrier comparison, the executable-source allowlist drops its Electron notarization wrapper, and the Makefile and the appended upstream command list state this fork's Desktop commands.

The Session-export save carrier keeps upstream's document-relative route and settles on the carrier's result; the Desktop page bridge resolves that route against the document base before handing it to the Rust command, which validates the request against the current loopback origin.

## Alternatives considered

- **Reset the fork to the upstream tag or copy selected directories** — rejected because it bypasses review of overlapping upstream and fork-owned behavior and loses the continuous fork history.

- **Integrate the official Electron Desktop alongside Tauri** — rejected because it would create a second Desktop product, packaging path, and runtime ownership model.

- **Drop the shared primary-runtime tooling with the Electron tree it came from** — rejected because the exe, Python wheel, and CI builds consume it independently of Electron.

- **Re-add the removed `settingsScope` service instead of following the rename** — rejected because the upstream service carries the live settings transport; a fork-only copy would fork the settings path.

## Consequences

The synchronized tree has the verified 0.1.7-alpha.1 commit as an ancestor, is ahead-only relative to that tag, and keeps the reviewed Tauri Desktop delta. The official Electron product stays outside this fork's Desktop workspace.

## Verification

The upstream remote tag resolves to `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`, and the manual merge leaves no unresolved path. The reviewed tree passes `pnpm install`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:docs`, `pnpm run hygiene`, `pnpm run build`, and the Desktop runtime build with its Node tests, whose bundled-sidecar smoke boots the packaged tree on the loopback host in both launch modes and fails on any stalled composition row. Every unit spec that the merge touched passes alone; the full unit run's remaining failures reproduce as load-sensitive timeouts and pass in isolation.
