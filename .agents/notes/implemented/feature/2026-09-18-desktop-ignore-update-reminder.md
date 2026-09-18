# Agent Note: Ignore one Desktop update reminder

Status: implemented

English | [中文](2026-09-18-desktop-ignore-update-reminder.zh.md)

## Problem

The Desktop update badge sits below the settings trigger and the release dialog it opens offers only "later" and "start update". A user who deliberately stays on the installed version therefore sees the same reminder on every launch and can silence it only by installing the release.

## Decision

The release dialog gains a third action, "ignore this version", with a caption naming where the update stays available: Settings → About DeepDive. Ignoring hides the badge for that release alone. The badge reappears as soon as the next poll finds a different release, and the About section is unchanged: it keeps reporting the found release with its own "view update" action, which is the path the caption names.

The preference is one durable field, `ignoredUpdateVersion`, in a `desktop-ui` settings namespace. The Host half of `@deepseek-ai/dsh-desktop-client-ui` registers that namespace, and the browser half binds it through `ctx.settingsScope`, so the value lives in the same user-settings document as every other preference and survives a restart. Writes go through the authenticated settings Remote namespace; the Desktop carrier adds no HTTP route, no Tauri command, and no second configuration store. No surface clears the field, so editing the settings document is the only way to restore the reminder before the next release.

The badge compares the ignored release by exact version string. A suppression therefore cannot outlive the release it names, and no comparison against the installed version is needed to restore the reminder.

## Verification

Desktop Node tests cover the new dialog action and its caption, the badge disappearing after the action, the stored version, and the ignored release staying quiet while a newer release still shows the badge. The Desktop composition test pins the client bundle's declared injections, and the repository gates cover the new package dependency.

## Alternatives considered

- **Persisting in the WebView's `localStorage`.** Rejected because the sidecar binds a random loopback port on every launch, so the page origin — and with it the storage area — does not survive a restart.

- **Persisting in a Desktop-owned file under the Tauri app-data directory.** Rejected because this is user configuration, which the shared settings document already owns; a second store would also need a new Tauri command and capability.

- **Suppressing every release at or below the ignored version.** Rejected because an exact match states the user's choice, while any newer release must still be offered.

## Consequences

The reminder is now user-controlled without weakening the update path: the About section keeps checking, keeps reporting, and keeps starting the install. The badge stays the only component that honors the preference, so a future surface that shows availability must read the same namespace rather than re-deriving it from the release feed.
