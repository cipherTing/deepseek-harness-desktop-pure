# Agent Note: Desktop adaptation for DeepSeek Harness 0.2.1-rc.2

Status: implemented

English | [中文](2026-10-18-desktop-sync-dsh-0.2.1-rc.2.zh.md)

## Problem

DeepDive must integrate upstream tag `dsh-v0.2.1-rc.2` at exact commit `687f282e8625c6b8d11ff58211a90524be2e4317` while retaining its independent Tauri Desktop product and the Desktop delta it already carries.

The upstream range from `dsh-v0.2.1-alpha.2` adds Harness packages across the API, boot, client, experimental and other groups, client surfaces, specs, snapshots, and documentation, and keeps growing the official Electron Desktop product under `apps/desktop` and `apps/desktop-host`. It adds a private reference tool, `apps/plugin-market-generator`, and changes the repository build chain to bundle the Electron Desktop product between the Host and Client faces.

## Decision

The reviewed integration tree applies upstream `dsh-v0.2.1-rc.2` through a real no-commit merge and keeps the fork-owned Desktop delta. Shared Harness packages, client surfaces, and the sanctioned client seams are integrated; the Electron product layer stays out: the 88 modify/delete paths under `apps/desktop`, `apps/desktop-host`, `apps/web/tests`, and `scripts`, the 83 files `apps/desktop` gained in this range, the two Electron e2e snapshot directories whose specs this fork does not carry, and the three Electron packaging workflow specs (`desktop-package-source`, `desktop-publish-workflow`, and `macos-package-workflow`).

The sync branch `codex/sync-dsh-v0.2.1-rc.2` starts from the pre-sync `master` tip `81b61fe3218392688f00c77b028e6f2a2b95e0c5` and records the verified upstream tag as its second parent. Before the merge this fork was 990 commits behind that tag and 83 commits ahead; the integrated tree has no upstream-only commit and is 84 commits ahead.

`apps/plugin-market-generator` is a private repository tool with no Electron dependency, so it enters the tree with its own aggregate reference in `tsconfig.host.json`. The `check-workspace-constraints` release-member rule exempts it by directory and no longer names an Electron application directory.

The repository build chain no longer bundles an Electron Desktop application between the Host and Client faces: `scripts/compile-referenced-projects.ts` drops the `desktop-bundle` step and lets the Client compiler depend on `host-bundle`, and `scripts/build.spec.ts` records the same graph. The DeepDive Desktop application is built by `pnpm desktop:build` through Tauri, outside the Harness build. `desktop/package.json` runs the Harness build through `pnpm -C .. run build`: the npm wrapper it used before passed the repository build's `pnpm exec` arguments through npm, which dropped `--env.DSH_BUILD_FACE host`, so the Host bundle ran the Client configuration and the Desktop bundle preparation failed.

`pnpm-workspace.yaml` keeps the upstream `@earendil-works/pi-ai@1.1.0` bump and its patch, and drops the `@electron/osx-sign` and `app-builder-lib` patch entries whose only consumers are the excluded Electron packaging; `patches/app-builder-lib@26.17.0.patch` and its `THIRD_PARTY_NOTICES.md` line go with them.

`scripts/doc-budgets.manifest.json` raises the root `AGENTS.md` ceiling to 3550 words, because this range added root rules beside the fork's Desktop chapters, and takes the upstream `docs/AGENTS.md` ceiling of 1430.

`packages/client/ui-settings-account` is a shared pair with two fork-owned links. Upstream now describes the sidebar launcher, Account settings, the sign-in step, and the account stream as shared by Desktop and plain Web; that text is adopted, the Electron README link becomes the [Desktop rules](../../../../AGENTS.md) link, and the onboarding-decision link keeps the fork's `implemented/` target. `apps/cli` takes upstream's "create or reset" wording and keeps the fork sentence about DeepDive; the Electron-installed-command sentence stays out.

Two upstream notes describe the Electron product this fork excludes, and they are rewritten to the shipped Tauri behavior: the build-chain note no longer carries a Desktop bundle step, and the host-release note points the Desktop exception at the sidecar restart instead of the Electron main process. `docs/defensive-patterns/package-surface.md` drops the excluded `apps/desktop-host` manifest from its dependency example.

`desktop/UPSTREAM_COMMIT` records `dsh-v0.2.1-rc.2`. The independent DeepDive Desktop version does not change with this integration. This range introduces two upstream workflow files, `desktop-publish.yml` and `macos-package.yml`; they stay unchanged and disabled, like the rest of upstream CI.

## Alternatives considered

- **Reset the fork to the upstream tag, or copy selected directories** — rejected: it bypasses review of overlapping upstream and fork behavior and discards continuous fork history.
- **Integrate the official Electron Desktop beside Tauri** — rejected: it creates a second Desktop product, packaging path, and runtime ownership model.
- **Keep the `desktop-bundle` build step and add a `bundle` script to the fork's Desktop package** — rejected: the step packages the Electron application, while the DeepDive Desktop artifact comes from the Tauri build.

## Consequences

The synchronized tree has the verified `dsh-v0.2.1-rc.2` commit as an ancestor, is ahead-only relative to that tag, and keeps the reviewed Tauri Desktop delta. The official Electron product stays outside this fork's Desktop workspace, and the deployed runtime carries only the DeepDive Desktop packages.

## Verification

The upstream tag resolves to `687f282e8625c6b8d11ff58211a90524be2e4317`, which is also the fetched `upstream/master` tip. The manual merge leaves no unresolved path and no conflict marker, keeps the pre-sync `master` tip as its first parent and the tag as its second, and leaves no upstream-only commit. `pnpm install` regenerates the lockfile with no `apps/desktop` or `apps/desktop-host` importer and keeps the `desktop`, `desktop/client-ui`, and `desktop/runtime` importers.

The reviewed tree passes `pnpm run build` (8 of 8 gates), `pnpm run lint` (0 errors), `pnpm run verify-translation-pairing` (1010 pairs), `pnpm run verify-third-party-notices`, and `pnpm run hygiene` (21 of 21 gates). Two gate inputs follow the trimmed build chain and the preset ids this range introduces: `scripts/compile-referenced-projects.spec.ts` expects the Client compiler to depend on `host-bundle`, and `scripts/rescope-vendor.ts` lists the `cordis` preset id as product data in the CLI bundle-transition scenario and the `v0.2.1-alpha.1` subagent-preset upgrade guide instead of reading it as a pre-rescope package name.

`pnpm run doc-sync` passes 42 of 43 gates; the remaining `verify-repository-references` finding is a local object-database collision, not a synchronized reference: a PyPI wheel URL in `python/sdk/uv.lock` contains the seven-character fragment `6344383`, which uniquely prefixes the upstream commit `6344383228e5373ab239d856e153f61bd7928776` in this clone. The same lockfile line is present at the upstream tag, so no maintained text references a commit.

`pnpm run test` runs 42701 cases. On this 8-core host a fully contended run times out a handful of 5-second cases in unrelated files (48, then 12, then 6 across three runs); every file it reports passes alone, where their 367 cases yield 365 passes and two skips. The remaining suites are unaffected.

The Desktop runtime build and its Node tests pass against the synchronized Harness packages (50 of 51 tests, one skipped), including both bundled-sidecar smoke launches on the loopback host, and `version:check` reports the Desktop version unchanged at `0.1.22`.
