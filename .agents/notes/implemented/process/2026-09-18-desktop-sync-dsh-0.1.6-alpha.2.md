# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.6-alpha.2

Status: implemented

English | [中文](2026-09-18-desktop-sync-dsh-0.1.6-alpha.2.zh.md)

## Problem

DeepDive must integrate upstream tag `dsh-v0.1.6-alpha.2` at exact commit `ddefc45fbc7f8e46dd73185e68295696d1297887` while retaining its independent Tauri Desktop product, DeepDive branding, About and update entries, native directory picking, and native Session export.

The upstream range adds Harness packages, client surfaces, session and sandbox behavior, generated artifacts, and documentation. It also keeps growing the official Electron Desktop product under `apps/desktop` and `apps/desktop-host`, which remains a separate product layer from DeepDive's Tauri implementation.

## Decision

The reviewed integration tree applies upstream `dsh-v0.1.6-alpha.2` through a real no-commit merge and keeps the fork-owned Desktop delta. Shared Harness packages and the approved client seams are integrated; the upstream Electron product layer, its packaging and release machinery, its governance notes, its workspace assets, and its host-only test fixtures are excluded. DeepDive keeps the single Tauri implementation under `desktop/`.

The sync branch starts at the pre-sync `master` tip; its integration merge records the verified upstream tag as second parent. The final `master` landing records the reviewed sync branch as second parent.

The upstream range moves new Electron files into `desktop/assets/` through Git rename detection. Those paths are restored to the fork's own assets, and `apps/desktop`, `apps/desktop-host`, `snapshots/session/workspace-dependencies`, and `apps/cli/tests/desktop-host.e2e.ts` stay out of the tree. The 27 upstream Agent Note triplets that govern the Electron product are excluded with them, and the archive manifest drops the seals for the excluded `2026-09-09-desktop-in-place-profile` triplet.

`scripts/gen-third-party-notices.ts` no longer reads the Electron `primary-runtime-lock.json`, so the generated notices lose their Desktop bundled Python section; `lefthook.yml` stops watching that path. `pnpm-lock.yaml` and `THIRD_PARTY_NOTICES.md` are regenerated from the merged workspace. `scripts/check-workspace-constraints.ts` keeps upstream's `lib/types/*.d.ts` publication entry for `@deepseek-ai/dsh` and drops the `@deepseek-ai/dsh-desktop-host` entry; `tsconfig.host.json` keeps the upstream Host include list without the Electron app globs.

Three shared surfaces carried Electron-only references and now name what this fork actually ships: the `ui-settings-general` README pair points its Desktop update paragraph at the fork's release rules, the `node-office-kit` note keeps the shared Office decision without its Electron build guide, and `docs/architecture` keeps the DeepDive Desktop paragraph. Shared specs drop their Electron carriers: `client-flow.client.spec.tsx` loses the Electron preload bridge case, `manager.spec.ts` loses the bundled-pnpm case, `apps/web/tests/desktop-updates.e2e.ts` and its `apps/web/tsconfig.json` entry leave with the Electron preload sources they import, and `AGENTS.md` and `.gitignore` lose their Electron-only lines.

The Desktop carrier follows the three upstream changes it depends on. `desktop/scripts/build-runtime.mjs` accepts the dsh bin's stable `profile-boot.js` facade beside the hashed one. `desktop/runtime/src/sidecar.ts` requests the `link` resolution mode for the shared `web` profile, because the enforcing runtime table describes the dsh installation alone and would reject the desktop runtime packages this sidecar seeds. `desktop/tests/config.test.mjs` follows the base bundle's HMR row to its renamed `@deepseek-ai/dsh-hmr` package.

The `settings.update` seat and the asynchronous Session export carrier stay in place, and `ui-settings-general` keeps rendering that seat while upstream's carrier-driven update indicator renders nothing without a `dshDesktop` preload. The new upstream `weighted-approval.yml` and `weighted-approval-review-event.yml` workflows enter the tree unchanged and stay disabled in GitHub Actions, like the other upstream workflows.

`desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.6-alpha.2`; the root README identifies the integrated kernel as `0.1.6-alpha.2`. The independent DeepDive Desktop version is unchanged by this integration.

## Alternatives considered

- **Reset the fork to the upstream tag or copy selected directories** — rejected because it bypasses review of overlapping upstream and fork-owned behavior and loses the continuous fork history.

- **Integrate the official Electron Desktop alongside Tauri** — rejected because it would create a second Desktop product, packaging path, and runtime ownership model instead of preserving DeepDive's chosen Tauri route.

- **Keep the excluded Electron product references in absorbed documentation** — rejected because the reviewed tree cannot link to packaging it does not ship; `verify-md-links` reports every such target as broken.

- **Keep the Desktop runtime lock as a Third-Party Notices input** — rejected because the fork bundles no Electron Python runtime, so the section would disclose distributions no artifact contains.

## Consequences

The synchronized tree has the verified 0.1.6-alpha.2 commit as an ancestor, is ahead-only relative to that tag, and keeps the reviewed Tauri Desktop delta. The official Electron product stays outside this fork's Desktop workspace.

Every maintained path that referenced the excluded product is either removed with it or redirected to the fork's own governance, so `verify-md-links`, `verify-translation-pairing`, and `verify-archived-agent-notes` stay green on the reviewed tree.

## Verification

The upstream remote tag resolves to `ddefc45fbc7f8e46dd73185e68295696d1297887`, and the manual merge leaves no unresolved path. The reviewed tree passes `pnpm install`, `pnpm run clean`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:docs`, `pnpm desktop:version:check`, Desktop lint, Desktop typecheck, and the 20 Desktop Node tests against the rebuilt and deployed runtime. The unit suite reports 25,359 passing tests; three timing tests in `packages/boot/hmr` and `packages/experimental/ptc-runtime-python` exceed their wall-clock ceilings under full-suite load and pass in isolation.
