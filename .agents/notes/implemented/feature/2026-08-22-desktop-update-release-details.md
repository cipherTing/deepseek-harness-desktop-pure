# Agent Note: User-invoked Desktop update details

Status: implemented

English | [中文](2026-08-22-desktop-update-release-details.zh.md)

## Problem

The Desktop update badge identified a newer release but showed only the old and new versions before sending the user to a generic Release page. It did not present the bilingual Markdown notes already owned by the GitHub Release, and the About page opened its update dialog immediately after a successful manual check.

## Decision

Desktop reads the latest GitHub Release tag, Markdown body, and assets in one request. A newer version makes the update badge visible but never opens a dialog by itself. The badge opens the dialog only after the user activates it; a manual About-page check reports the result inline and exposes a separate action that opens the same dialog.

The dialog uses the shared client `Modal`, `Button`, and `MarkdownText` primitives. It displays the installed and available versions, renders the GitHub Release body without maintaining a second changelog, and constrains long notes to an internal scrolling region. The Release body remains owned by the [bilingual Desktop release workflow](../process/2026-08-20-desktop-release-bilingual-notes.md).

The primary action targets the exact `deepdive-macos-arm64-<version>.dmg` or `deepdive-windows-x64-<version>.exe` Release asset for the current platform, falling back to the Release page when that asset is absent. The existing native external-link carrier opens the URL, so the action starts the installer download but does not claim in-application installation.

## Alternatives considered

- **Open the dialog automatically when polling finds a release.** Rejected because a background network result must not interrupt the user's current work.
- **Render the Release body with a Desktop-specific Markdown parser.** Rejected because the shared untrusted-Markdown renderer already owns parsing, sanitization, links, and theme behavior.
- **Install through Tauri Updater in this change.** Rejected because the current release workflow produces ordinary DMG and NSIS installers but no signed updater artifacts or updater manifest. In-application installation requires the official updater plugin, update signing keys, lifecycle integration, and a revised publication workflow as one separate decision.

## Consequences

Update details stay aligned with the published GitHub Release, long notes remain usable, and no update dialog appears without a user action. Starting an update opens the platform installer download in the system browser; users still complete installation through the operating system. Desktop interaction tests cover the click-only dialog, GitHub notes, scrolling container, and macOS and Windows asset selection.
