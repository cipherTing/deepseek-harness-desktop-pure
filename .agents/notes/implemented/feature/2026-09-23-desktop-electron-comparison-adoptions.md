# Agent Note: Desktop carrier decisions taken from the Electron comparison

Status: implemented

English | [中文](2026-09-23-desktop-electron-comparison-adoptions.zh.md)

## Problem

DeepDive carries the same Harness product on Tauri that upstream ships on Electron, and the two carriers solved several of the same problems independently. Comparing the fork's `desktop/` against the upstream Electron product at `dsh-v0.1.7-alpha.1` surfaced gaps where Electron's approach is better, and places where the fork is deliberately simpler or already stronger.

## Decision

Four Electron-side findings are adopted inside `desktop/`; the rest are either Electron packaging artifacts or carriers differences this fork must not copy.

The sidecar now asks for a **stable loopback port** (`47821`, falling back to an ephemeral port when it is taken). Electron gives its renderer the fixed `dsh-app://app` origin; this fork forbids custom schemes, and a fresh `--port 0` origin every launch made the WebView's origin-keyed storage unreachable — the client persists sidebar layout, panel widths, and store snapshots to `localStorage`. The preferred port keeps that state across restarts, and a taken port costs only that launch's client state.

The deployed runtime now ships **pnpm** and the sidecar passes `packageManager` to profile boot. Electron bundles a package manager and an app-owned invocation for the same reason: the Plugin Manager runs `pnpm` for install and inspect, and a self-contained install has no system Node.js or pnpm, so the page failed on a PATH lookup that could not succeed. `desktop/runtime/package.json` also declares the two workspace packages that were only peers of packages already in the closure (`@deepseek-ai/dsh-hook-protocol`, `@deepseek-ai/dsh-sdk-protocol`), which is the rule Electron's package-set selection already follows.

The **page-reachable file read is removed**: `desktop_copy_file_contents` accepted any absolute path from the page and put the file's text on the clipboard, which is arbitrary local read (Harness credentials included) for any script in the app document, including a third-party client plugin. Electron exposes no path-authoritative native action, and the fork's own drag-handoff decision already keeps filesystem paths out of the WebView. The capability additionally denies `core:path` resolution, and the session-export save name is reduced to its basename before it reaches the native dialog. The file menu keeps open, open-with, save-as, reveal, and copy-path.

Smaller adopted differences: `window.open` and `target="_blank"` now reach the system browser instead of being dropped (the account "Contact us" link and the sidebar browser's external button were dead); the macOS overlay strip declares the shared `--dsh-frame-top-clearance` token that the client sets only for Electron's `data-platform="darwin"`; the failure dialog carries a bounded tail of sidecar stderr, because a GUI launch has no console to read it from; the release lookup is bounded by a timeout so a stalled connection cannot leave the update check disabled; and the head injection registers structured index rows instead of a raw string tap so it survives any change to the served document's head tag.

## Alternatives considered

- **Adopt Electron's fixed custom scheme** — rejected: the carrier rules forbid a custom URI scheme and an HTTP reimplementation, and a stable loopback port reaches the same outcome through the supported `--host/--port` surface.
- **Keep `desktop_copy_file_contents` and validate its path** — rejected: the fork has no root that legitimately contains every file a rendered row may name, and a scope check would still leave the page able to read outside the workspace.
- **Port Electron's runtime file policy, per-file digest, ASAR/NSIS packaging, automatic updates, and mandatory-update policy** — rejected: they exist to serve electron-builder, signed update feeds, and an enterprise policy channel this fork does not have, and the fork already ships a version-and-SHA pinned Node runtime plus a validation-only release workflow.
- **Adopt Electron's macOS notarization and Windows signing pipeline** — deferred: both need certificates the fork deliberately does not own, and `README.md` documents the ad-hoc choice; the verification half is worth taking the day credentials exist.
- **Adopt Electron's app-owned profile directory and main-process cookie handling** — rejected: they contradict the shared-profile and shared-`DSH_HOME` invariants, and holding the launch cookie in Rust would reimplement upstream Connection authentication.

## Consequences

Desktop keeps the sanctioned carrier shape while gaining the plugin-management path, stable WebView storage, working external links, and the macOS layout token. The removed command is a deliberate capability reduction; its affordance can return only through a Host-owned read that never accepts a page-chosen path. `desktop/tests/config.test.mjs` and the bundled-sidecar smoke pin each adopted behavior; the release workflow and the independent Desktop version are unchanged.

## Verification

`pnpm install`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:docs`, `pnpm run hygiene`, the Desktop runtime build with `pnpm --filter @deepseek-ai/dsh-desktop run test` (both launch modes boot the packaged tree on the loopback host), and `cargo test --manifest-path desktop/src-tauri/Cargo.toml`. The stable port was confirmed by two consecutive sidecar launches reporting the same origin.
