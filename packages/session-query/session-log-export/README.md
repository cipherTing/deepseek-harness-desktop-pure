---
description: "Web Session-log ZIP export: Host streaming, the authenticated download route, the Session Header action, and the /export command."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-log-export

English | [中文](README.zh.md)

## Summary

`dsh-session-log-export` lets the Web interface download a session's full history: a `Download session log` menu item under the Session Header's more-actions button and an `/export` slash command both hand the session tree — the session, its sub-sessions, and attachments — to a ZIP save carrier. The package owns the Host archive stream, its authenticated Fetch route, and the browser controls and feedback. The default carrier lets the browser choose the destination, while an embedding surface may install an asynchronous native save carrier before the client tree boots. Setup and usage come first; implementation details follow.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when the Web bundle should let users export a session log. It requires Connection, the command registry, Session query and persistence, and attachments. Mount the plugin, then choose `Download session log` from the Session Header's more-actions menu or type `/export`; the browser downloads `dsh-session-<id>.zip`.

### When to choose it

Choose it for a Web deployment that needs user-facing session export with a visible download dialog. Avoid it when a programmatic or Host-side export is needed: this package produces a browser download, not a Host path write. The logs are serialized from persistence read handles, so any mounted backend is supported.

### Composition

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
```

The Web bundle mounts the package with Connection, `dsh-commands`, `dsh-client-ui-commands`, and `dsh-client-ui-conversation`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `compressionLevel` | `6` | DEFLATE level from 0 through 9 for each ZIP entry. |

### Command contract

| Input | Result |
|---|---|
| `/export` | Records a human-command lifecycle; the submitting browser downloads `GET /api/session.export?sessionId=<id>&includeDescendants=true` |
| `/export <path>` | An error; browser downloads choose their destination through the browser's ordinary download behavior |

### What to expect

The modal reports preparation, browser download start, native file save completion, or failure. A native save cancellation closes the modal without reporting success. Closing the modal does not cancel an in-flight operation, and the modal does not reopen when that operation later settles. One Session admits one active download at a time; repeated gestures share that operation. The export includes the live Session's newest events: the Host endpoint flushes a live root Session before reading, so a slash-triggered ZIP includes the `command/run` and `command/done` pair that started the download; cold persisted Sessions need no flush. Each logical log uses the current generation's canonical filename inside the archive (`session.jsonl` for v0, otherwise `session.vN.jsonl`), including beneath each sub-session directory. Images use `media/<attachmentId>.<ext>`, and generic files use `files/<digest-prefix>/<digest>/<name>`. Generic-file bytes are read and compressed as bounded chunks, so exporting a large upload does not buffer it in full.

### Failures

The modal shows an error when the preflight or active save carrier fails. A native save cancellation is not an error. A descendant or attachment read failure after a carrier accepts the GET is reported by that carrier, not by the modal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package wires the export control and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design split

The package has two halves. The Host half ([`src/index.ts`](src/index.ts)) registers the `/export` command and contributes the exact `GET`/`HEAD /api/session.export` Fetch route to Connection; [`src/archive.ts`](src/archive.ts) builds the bounded ZIP stream. The browser half ([`src/client/index.ts`](src/client/index.ts)) provides the shared download controller and UI, resolves the optional surface save carrier, and observes `command/executed` so only the submitting browser starts a download.

### Download flow

Both entry paths issue a `HEAD` preflight to `/api/session.export?...`, then hand the GET URL and safe filename to the active save carrier without buffering the ZIP in JavaScript. The default carrier clicks a browser download anchor and returns immediately; an embedding surface may install `globalThis.__DSH_DOWNLOAD_CARRIER__` before client boot and settle with `file-saved` or `cancelled`. One controller owns one in-flight download per Session, collapses concurrent gestures into that operation, and cancels the preflight on plugin disposal. Modal state lives in a snapshot store keyed by Session, so the button and the command share one modal per Session.

The Host route is a feature-owned exact Fetch contribution. Connection applies its Host/Origin and browser-session checks and bridges the streaming `Response`; this package owns query validation, live-session flushes, handle-based log reads and attachment reads, ZIP generation, and HTTP status semantics.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the Web control to the host endpoint and the surrounding command and session surfaces.

- [dsh-client-connection](../../client/connection/README.md) — the authenticated Fetch-route carrier used by the Host endpoint.
- [Commands subsystem reference](../../../docs/subsystems/commands.md) — the human-command registry the `/export` command registers on.
- [dsh-client-ui-commands](../../client/ui-commands/README.md) — the browser command surface that renders and acknowledges `/export`.
- [Session Query package map](../README.md) — the retrieval family this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/export` control

#### What the model sees

Nothing. `/export` stays on the human-command plane, and the ZIP download does not enter model history.

#### Token effect

Zero. The command creates no model turn.

#### KV Cache effect

None. The log-only command lifecycle and browser download do not change the derived request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Browser download or embedding save carrier, not a Host-path writer** — the default carrier lets the browser choose the local destination. An embedding surface may install a native save carrier, but the page receives no general filesystem access or Host path result.
- **Preflight reports only pre-stream failures** — a descendant or attachment failure after the browser accepts the GET is reported by the browser download manager, not by the dialog.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked pages.

#### Future: export destinations beyond the browser

The download route deliberately returns bytes rather than a Host path. A future Host-path export would need a separate API and an explicit ownership decision for the destination.

</details>

**Runtime invariant:** No companion is published. Connection and the command registry own both registrations, while each export reads authoritative Session services.
