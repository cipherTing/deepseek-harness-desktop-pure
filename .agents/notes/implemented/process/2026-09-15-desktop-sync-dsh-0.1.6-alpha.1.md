# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.6-alpha.1

Status: implemented

English | [中文](2026-09-15-desktop-sync-dsh-0.1.6-alpha.1.zh.md)

## Problem

DeepDive must integrate upstream tag `dsh-v0.1.6-alpha.1` at exact commit `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d` while retaining its independent Tauri Desktop product, DeepDive branding, About and update entries, native directory picking, and native Session export.

The upstream range adds Harness packages, client surfaces, session and sandbox behavior, generated artifacts, and documentation. It also keeps growing the official Electron Desktop product under `apps/desktop` and `apps/desktop-host`, which remains a separate product layer from DeepDive's Tauri implementation.

## Decision

The reviewed integration tree applies upstream `dsh-v0.1.6-alpha.1` through a real no-commit merge and keeps the fork-owned Desktop delta. Shared Harness packages and the approved client seams are integrated; the upstream Electron product layer, its packaging and release machinery, its governance notes, its `@electron/osx-sign` patch, and its root Electron scripts are excluded. DeepDive keeps the single Tauri implementation under `desktop/`.

The sync branch starts at the pre-sync `master` tip; its integration merge records the verified upstream tag as second parent. The final `master` landing records the reviewed sync branch as second parent.

The upstream release renames the PTC execution seam, so `desktop/runtime/package.json` depends on `@deepseek-ai/dsh-ptc-runtime` in place of `@deepseek-ai/dsh-code-runtime`. `pnpm-lock.yaml` and `THIRD_PARTY_NOTICES.md` are regenerated from the merged workspace, which drops the Electron importers and the Electron signer patch.

The `settings.update` seat and the asynchronous Session export carrier stay in place. Upstream's rewritten `apply.client.spec.ts` replaces the fork's hand-built bench and keeps one fork assertion that the General plugin seats nothing in the update hole on Web; the carrier documentation keeps the fork's wording and adopts upstream's preflight path.

The new upstream `verify-repository-references` gate rejects commit hashes in maintained files, while fork policy requires the exact synchronized upstream commit in its own governance. The gate excludes `AGENTS.md`, `desktop/UPSTREAM_COMMIT`, and the `desktop-sync` and `desktop-upstream-ancestry` notes, and still rejects hashes everywhere else.

The root README identifies the integrated DSH kernel as `0.1.6-alpha.1` (`dsh-v0.1.6-alpha.1`). `desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.6-alpha.1`. The independent DeepDive Desktop version remains `0.1.13`.

## Alternatives considered

- **Reset the fork to the upstream tag or copy selected directories** — rejected because it bypasses review of overlapping upstream and fork-owned behavior and loses the continuous fork history.

- **Integrate the official Electron Desktop alongside Tauri** — rejected because it would create a second Desktop product, packaging path, and runtime ownership model instead of preserving DeepDive's chosen Tauri route.

- **Keep the excluded Electron product references in absorbed documentation** — rejected because the reviewed tree cannot link to packaging it does not ship; the affected note now names only the CLI composition tests that exist here.

- **Leave the inherited repository-reference gate failing** — rejected because the fork's traceability requires the exact upstream commit while the gate must still reject hashes everywhere else.

## Consequences

The synchronized tree has the verified 0.1.6-alpha.1 commit as an ancestor, is ahead-only relative to that tag, and keeps the reviewed Tauri Desktop delta. The official Electron product stays outside this fork's Desktop workspace.

The Desktop package stays independently versioned at `0.1.13`; upstream kernel traceability is recorded separately in the README and `desktop/UPSTREAM_COMMIT`.

Every absorbed Harness package and client seam now describes the renamed PTC runtime, and the deployed Desktop runtime resolves that seam by its current package name.

## Verification

The upstream remote tag resolves to 0a15e36e7f82b6ed45af6fa9759f29b40dcd965d, and the manual merge has no unresolved paths. The reviewed tree passes pnpm install, pnpm run typecheck, pnpm run test:docs, pnpm run verify-third-party-notices, pnpm run verify-dependency-catalog, pnpm run verify-repository-references, pnpm run verify-default-product-isolation, pnpm run verify-concrete-terms, pnpm run verify-client-ui-i18n, pnpm desktop:version:check, the Desktop runtime build and deploy, Desktop lint, and 32 Desktop Node tests, plus 116 focused client-seam tests for ui-settings-general and session-log-export.
