# Agent Note: Tauri Shell launches the Desktop Node sidecar

Status: implemented

English | [中文](2026-08-20-tauri-shell-sidecar-launch.zh.md)

## Problem

Desktop launched its bundled Node runtime through `process-wrap`. Its Windows wrapper combination did not reliably preserve the no-console creation flag, which could open a visible terminal during application startup. The carrier also must preserve binary framed stdin/stdout without changing the Harness Web profile, plugin loading, paths, or child-process behavior.

## Decision

The Node executable remains the fixed `binaries/node` Tauri `externalBin`. Rust starts it through `tauri-plugin-shell` with `app.shell().sidecar("node")`, raw stdout/stderr events, and an actor that serializes synchronous stdin writes and fallback termination. The sidecar starts its `web` profile with `--no-open` because Tauri owns the user-facing window. Readiness, respawn, live-origin navigation, graceful shutdown, and the Windows eval arguments remain in the Desktop carrier.

The WebView receives no Shell plugin permission. DeepSeek Harness plugins still load and run inside the Node runtime, while Tauri Shell owns only the outer Node process. Normal Desktop shutdown terminates the sidecar; abnormal termination does not promise whole-tree cleanup.

## Alternatives considered

**Keep `process-wrap`.** Rejected because its Windows creation-flag and Job Object composition is the suspected source of the startup console, while it adds process-tree behavior outside the Desktop adaptation requirement.

**Start Node through a direct platform command.** Rejected because Tauri's maintained Shell plugin already resolves declared sidecars, pipes raw output, and applies its Windows no-console launch behavior.

**Expose Shell spawning to the WebView.** Rejected because the loopback page needs no generic executable authority; sidecar startup remains Rust-owned.

## Verification

Rust tests execute the official sidecar path with binary stdout and stdin bytes, and separately prove direct termination reaches a process-ended event. Desktop smoke tests boot the real Web host through native-script and Windows eval Node arguments, then exercise bridge, HTTP, plugin bundle, cancellation, and shutdown paths.

## Consequences

- The official Shell implementation applies `CREATE_NO_WINDOW` to the bundled Node process on Windows. A real Windows packaged launch remains the final product-level confirmation that no visible console appears.
- DSH plugins and their own subprocesses do not pass through this Tauri launch path. A console opened by a Harness plugin's PowerShell, cmd, or other child process is a separate issue.
- Normal Desktop shutdown stops the owned Node process. This carrier no longer promises whole-tree cleanup after an abnormal application termination.
