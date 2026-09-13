# Agent Note: Desktop adaptation for DeepSeek Harness 0.1.2-alpha.3

Status: implemented

English | [中文](2026-09-01-desktop-sync-dsh-0.1.2-alpha.3.zh.md)

## Problem

The Desktop fork must follow upstream tag `dsh-v0.1.2-alpha.3` at `dd6322d604e00eec1ba5e0c8541159906a21094a` without losing the fork-owned packaging, native integration, branding, update entry, drag-and-drop behavior, or native session export carrier.

The upstream range from `dsh-v0.1.2-alpha.2` changes the connection lifecycle, removes the SQLite session persistence backend, removes the agent spine demo, and refreshes a large set of package metadata, snapshots, and documentation. These changes overlap the fork's Desktop seams and cannot be accepted by replacing the tree or choosing one side globally.

## Decision

The synchronization follows [`dsh-desktop-upstream-sync`](../../../skills/dsh-desktop-upstream-sync/SKILL.md): a local checkpoint starts from the pushed `0.1.10` base, performs a real no-commit merge of the verified alpha3 tag, resolves conflicts by ownership, and records the reviewed tree before the final unpublished branch topology is produced.

The final `0.1.10` branch is based on `dsh-v0.1.2-alpha.3` and carries the reviewed fork delta above it. Published `master`, `v0.1.9`, and their history are not rewritten. Desktop versioning remains independent from the upstream root version.

The alpha3 connection behavior that reports a stalled generation without cancelling it is retained. The Desktop client UI continues to declare and use its locale and slots services, register the DeepDive brand, About section, and update seat, and keep its native drag-and-drop integration.

The upstream removal of SQLite persistence is accepted. Desktop runtime composition and session export continue to use the JSONL persistence path; no Desktop code adds a SQLite dependency to replace the removed backend.

The session export documentation keeps alpha3's JSONL raw-artifact requirement and browser-default behavior while documenting the fork's optional native save carrier. The default browser carrier remains unchanged for Web.

The vendored-package rescope removes exact edits for the upstream agent spine demo, which alpha3 removes, while preserving the fork's Inspector wire-identifier exclusions and alpha3's real Inspector framework-import edits.

`desktop/UPSTREAM_COMMIT` records only `dsh-v0.1.2-alpha.3`, and Desktop package metadata is synchronized to `0.1.10` without changing the upstream root version.

## Alternatives considered

- **Reset the fork to alpha3 or replace the tree from an allowlist** — rejected because either operation hides overlapping behavior and cannot prove that Desktop adaptations survived.

- **Select the upstream side for every conflict** — rejected because it would remove the Desktop native save carrier documentation and fork-owned rescope behavior.

- **Preserve the removed SQLite backend or agent spine demo** — rejected because alpha3 deliberately removes both from the upstream product and retaining them would leave obsolete package and dependency state.

- **Rewrite published `master` or its release tag** — rejected because the synchronization is prepared on the unpublished `0.1.10` branch and published history must remain stable.

## Consequences

The fork contains the complete alpha3 upstream tree while retaining the Desktop carrier and its branding, About, update, and native integration surfaces. The branch records alpha3 as an ancestor and keeps fork-owned commits above that upstream target.

The repository no longer provides the upstream SQLite session persistence package or agent spine demo. Session export documentation distinguishes the upstream browser default from the Desktop embedding carrier instead of claiming that Web itself writes Host paths.

Alpha3's stalled-host connection behavior changes when a generation is considered recoverable: the connection controller warns after the readiness timeout and retains the generation instead of immediately cancelling it. Desktop accepts that upstream behavior while keeping its own sidecar and UI lifecycle.

## Verification

The verified upstream remote resolves `dsh-v0.1.2-alpha.3` to `dd6322d604e00eec1ba5e0c8541159906a21094a`. A real no-commit merge exposed four textual conflict groups: the session export documentation pair and the vendored rescope script; the merge also applied alpha3's package, snapshot, and removal changes.

The focused connection, settings, session export, client-catalog, Desktop Node, Desktop typecheck, Desktop lint, and vendored-rescope checks pass. The repository build, hygiene gates (15/15), rescope check, Desktop version check, and fresh Desktop runtime build/deployment pass. `doc-sync` has 31 passing gates and one known `markdown wrap` failure: the repository's existing `verify-md-wrap` raises `ENOTDIR` for `snapshots/acp/image-compaction/system-prompt.expected.md/system-prompt.expected.md`; this unrelated checker issue remains unchanged.
