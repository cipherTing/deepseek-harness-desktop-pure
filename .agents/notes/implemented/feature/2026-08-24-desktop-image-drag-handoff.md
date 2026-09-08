# Agent Note: Desktop attachment drag handoff and release feedback

Status: implemented

English | [中文](2026-08-24-desktop-image-drag-handoff.zh.md)

## Problem

The browser image-attachment entry accepts whole-page file drops, validates them through the composer, and displays the shared `DropOverlay`. Tauri's default native drag-drop handler consumes operating-system drops and emits paths instead of the browser `DragEvent` with its `File` objects. Desktop must preserve the browser entry without deriving a second admission result from incomplete hover metadata.

## Decision

The Desktop `WebviewWindowBuilder` disables Tauri's native drag-drop handler. The existing document-level composer listener receives browser `File` objects and remains the sole owner of image admission, busy and locked rejection, draft attachment creation, and submission.

The Desktop client plugin only checks `DataTransfer.types` for a file drag. It does not inspect MIME metadata, call `preventDefault()`, stop propagation, or set `dropEffect`. The composer receives every browser file-drop event and remains responsible for type, size, batch, busy, and locked validation.

For a file drag, the plugin derives the work-area rectangle from the `data-shell-overlay` parent and the sidebar column beside it, then writes the rectangle to document-root CSS variables synchronously on file drag enter. The existing body-portaled `DropOverlay` therefore mounts directly in the work area instead of painting a full-window frame first. The sidebar stays visible and unblurred. `DropOverlay` exposes its composer-owned acceptance state as `data-dsh-drop-accepting`; Desktop CSS uses that marker for “Release to add” / “松开即可添加” and “Cannot add now” / “当前无法添加”, while the count-and-size line stays hidden. Desktop does not display a release-success pulse because a browser drop alone does not prove that DSH added a draft attachment.

Desktop does not expose dropped filesystem paths to the WebView or add a native upload command, filesystem permission, or parallel attachment pipeline.

## Verification

Desktop source tests require the Tauri handler opt-out and the composer-owned `data-dsh-drop-accepting` marker. The Desktop client interaction tests cover the work-area inset, concise copy variables, cleanup, and unchanged propagation for PDF, unknown, mixed, and accepted file drags. The shared attachment tests cover the acceptance marker, `File` intake, limits, and locked composer rejection.

## Alternatives considered

- **Bridge Tauri `onDragDropEvent` paths into a native upload command.** Rejected because it would bypass the browser-owned `File` admission path, expose filesystem paths to the WebView, and duplicate attachment ownership.
- **Infer acceptance from `dropEffect`.** Rejected because it is a browser drag-negotiation signal, not DSH's final attachment result.
- **Filter MIME types during hover.** Rejected because a WebView may withhold file metadata until drop, which makes a valid file appear unavailable before DSH sees it.

## Consequences

Desktop and Web use the same admission and draft lifecycle, while Desktop supplies scoped drag focus without changing the browser event outcome. A file that DSH later rejects can still display the drag presentation, but it never receives a false unavailable state before the composer validates it. Re-enabling Tauri's native handler requires a complete replacement that still supplies browser `File` objects to the existing composer; a path-only bridge is not an equivalent substitute.
