# Agent Note: Windows eval sidecar preserves the main-module argument

Status: implemented

English | [中文](2026-08-19-windows-eval-sidecar-argv.zh.md)

## Problem

Windows starts the bundled Node runtime with `--input-type=module --eval` to avoid Node main-script lookup against the packaged resource path. Eval mode has no main script, so `process.argv[1]` is `undefined` unless the command supplies a positional argument. The Web profile's fallback HMR resolves `process.argv[1]` while booting, which makes the Desktop sidecar fail before its `ready` message. The existing sidecar smoke launched `sidecar.mjs` directly, while the packaging test only checked that the Rust source contained `--eval`; neither executed the Windows command.

## Decision

The Windows command is `node --input-type=module --eval <import expression> -- <absolute sidecar path>`. The eval expression imports the sidecar through its file URL, and the positional path gives every imported module the same `process.argv[1]` that a normal main-script launch provides. A single Rust helper constructs the complete argument list so the delimiter and positional path cannot diverge from the import expression.

The sidecar smoke executes both the native main-script launch and the Windows eval launch on every supported smoke host. Both variants must reach the real Web host's `ready` message and complete the existing protocol and HTTP checks. This lets macOS exercise the Windows Node argument semantics without pretending to validate Windows process ownership or installer layout. A Rust unit test separately fixes the argument order and a path containing spaces.

## Alternatives considered

**Disable fallback HMR in Desktop.** Rejected because Desktop carries the standard Web profile and does not own a second boot policy. Removing HMR would hide the missing main-module argument while changing shared Harness behavior.

**Assign `process.argv[1]` inside the eval expression.** Rejected because mutating process globals recreates Node's command-line semantics inside application code. A positional argument uses Node's normal argv handling and remains visible to the entire imported graph.

**Keep the direct smoke plus source-text assertions.** Rejected because that combination accepted the broken command: it proved that both pieces existed, not that their composition could boot.

## Consequences

Windows sidecar startup preserves the main-module path without returning to direct main-script lookup. The full smoke runs one additional sidecar generation and therefore costs a few seconds on supported hosts. It still does not validate NSIS installation, WebView startup, Windows Job Object teardown, or installed resource paths; those require Windows product-level acceptance rather than more source assertions.
