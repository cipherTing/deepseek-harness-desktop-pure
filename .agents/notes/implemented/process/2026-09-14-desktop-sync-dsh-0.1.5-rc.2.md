# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.5-rc.2

Status: implemented

English | [中文](2026-09-14-desktop-sync-dsh-0.1.5-rc.2.zh.md)

## Problem

DeepDive must integrate upstream tag `dsh-v0.1.5-rc.2` at exact commit `fb2c4b9e698e30edb738bca4cf0618587db7d203` while retaining its independent Tauri Desktop product, DeepDive branding, About and update entries, scoped drag feedback, and native Session export.

The upstream range adds substantial Harness package, client, session, native-system, generated-artifact, and documentation changes. It also contains the official Electron Desktop product under `apps/desktop` and `apps/desktop-host`, which is a separate product layer from DeepDive's Tauri implementation.

## Decision

The reviewed integration tree applies upstream `dsh-v0.1.5-rc.2` through a real no-commit merge and keeps the fork-owned Desktop delta. Shared Harness packages and the approved client seams are integrated; the upstream Electron product layer, its packaging and release machinery, and Electron-specific governance are excluded. DeepDive retains the single Tauri implementation under `desktop/`.

The Desktop client waits for its locale and slots services before registering the DeepDive brand, About section, update seat, and Desktop drag feedback. The macOS overlay brand group is painted 4px lower without changing the 60px logo-row layout; Windows keeps the upstream position.

The root README identifies the integrated DSH kernel as `0.1.5-rc.2` (`dsh-v0.1.5-rc.2`). `desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.5-rc.2`. The independent DeepDive Desktop version remains `0.1.12`.

## Alternatives considered

- **Reset the fork to the upstream tag or copy selected directories** — rejected because it bypasses review of overlapping upstream and fork-owned behavior and loses the continuous fork history.

- **Integrate the official Electron Desktop alongside Tauri** — rejected because it would create a second Desktop product, packaging path, and runtime ownership model instead of preserving DeepDive's chosen Tauri route.

- **Move the macOS title by changing the row height or window height** — rejected because the request is a visual vertical adjustment while preserving the existing window and layout geometry.

- **Treat source or static bundle checks as sufficient Desktop validation** — rejected because the earlier client-plugin lifecycle regression showed that source presence does not prove assembled branding and settings contributions are active.

## Consequences

The synchronized tree has the verified rc.2 commit as an ancestor, is ahead-only relative to that tag, and keeps the reviewed Tauri Desktop delta. The official Electron product remains outside this fork's Desktop workspace.

The Desktop package stays independently versioned at `0.1.12`; upstream kernel traceability is recorded separately in the README and `desktop/UPSTREAM_COMMIT`.

The macOS adjustment changes paint position only. It does not affect title-bar gesture handling, total window height, New Session placement, or Windows rendering.

## Verification

The upstream remote tag resolves to fb2c4b9e698e30edb738bca4cf0618587db7d203, and the manual merge has no unresolved paths. The reviewed tree passes pnpm run clean, pnpm run build, pnpm run constraints, pnpm run verify-third-party-notices, pnpm run verify-translation-pairing, pnpm run verify-agent-note-format, pnpm run verify-agent-note-classification, pnpm run verify-client-ui-i18n, pnpm run verify-md-links, pnpm desktop:version:check, Desktop typecheck, Desktop lint, and 32 Desktop Node tests.

The known pre-existing `verify-md-wrap` `ENOTDIR` fixture-path failure remains outside this synchronization and is not claimed as passed.
