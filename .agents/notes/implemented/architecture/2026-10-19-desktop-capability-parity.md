# Agent Note: Desktop capability parity with the Electron product layer

Status: implemented

English | [中文](2026-10-19-desktop-capability-parity.zh.md)

## Problem

The upstream Electron product layer (`apps/desktop`, `apps/desktop-host`) is not integrated into DeepDive, so every capability it provides had to be rebuilt inside `desktop/` or not exist at all. Two of those gaps were structural rather than cosmetic.

In the upstream Electron product, the sidebar Browser tab uses an Electron `<webview>`: a Chromium out-of-process frame the renderer positions like any DOM element. DeepDive's Tauri window has no such element, and its former iframe carrier could not load sites that answer `X-Frame-Options: DENY`, including GitHub and many large sites. The Tauri carrier now hosts those pages in a native child WebView.

The rest of the gap was the Desktop signal itself. The upstream client branches on `globalThis.dshDesktop`, on `document.documentElement.dataset.platform`, and on a native keyboard channel. Without them, the same client runs its Web behavior inside a desktop window: no Desktop onboarding, no tray residency, no device-local keybindings, no update reminder, no `dsh` on `PATH`.

## Decision

The sidebar Browser tab keeps its page-side layout role and gives up its page-side content role. `ElectronWebviewPresentation` creates a positioned anchor element instead of a `<webview>`. On macOS and Windows, `browser_window.rs` owns one child `Webview` per tab through Tauri's `Window::add_child` API, enabled by the `unstable` feature; the guest uses the anchor's client-area rectangle as its bounds and moves with the main window. The shared browser business logic — URL normalization, history gating, title and loading state, tab lifetime — is unchanged; only the carrier is replaced. DeepDive Desktop supports macOS and Windows; Linux is outside its supported platforms.

Guest state is cached natively and pushed to the page as one event stream (`desktop-browser-event`) carrying navigation, title, history, focus, and main-document failure updates. Each platform reads and moves through its native back-forward list; a small WebKit user script reports same-document history changes, which native navigation callbacks do not expose. The bootstrap document is replaced by the first requested address, so Back never returns to a blank page. The Browser rejects top-level navigation to the running application and blocks requests to the application origin currently configured at guest creation. A failed main-document load clears loading and shows the existing localized Browser error; a cancelled navigation does not.

The guest denies WebKit media-capture permissions, downloads, and native popups; approved HTTP(S) popup requests open Sidebar tabs. DeepDive owns this download policy, independent of Electron's download handler.

The child view uses the page's CSS-pixel rectangle directly as logical bounds inside the main window, so native parent movement carries it without screen-coordinate updates.

The Desktop signal is now complete. `dshDesktop` exposes `deviceInfo`, `browser`, `shortcuts`, and `keyboard`; `dshOnboarding` exposes `hasApiKey` and `setActive`; `data-platform`, `data-fullscreen`, and the macOS window material are published by the carrier. Keybindings are device-local files under the Desktop configuration directory, read and written through narrow commands rather than WebView filesystem access.

The main document matches its shortcuts in the capture-phase DOM listener. Native keyboard hooks handle keys sent to HTML preview frames and Browser guests before the embedded page receives them. Both paths use the shared client's accepted bindings and `installNativeKeyboard`; the native event includes the trusted iframe name or Browser guest lease so the client can verify the focused embedding. The Browser guest lease selects its connected anchor as the shortcut target without changing DOM focus. A guest focus notification sends DockKit a synthetic focus event on that anchor, also without changing DOM or native WebView focus.

## Update feed

Releases publish one `latest.json` asset beside the macOS and Windows packages, addressed as `releases/latest/download/latest.json`, so its URL never changes with a tag. The document carries the version, the bilingual release notes, the release page, installer links, and an optional `mandatoryMinVersion`. The shell polls that feed in the background, with the base interval doubling up to one hour while a poll fails, and raises one notification per release (never while the window is focused). A `mandatoryMinVersion` above the installed build opens a blocking window that loads a bundled document and holds no page capability; an unparseable value never blocks an installation that would otherwise have no way to fetch a replacement.

The feed has one reader. The About section and the update badge ask the shell for what it already knows instead of querying the release host themselves, so the badge and the native reminder cannot name different releases, and the page owns no version comparison or installer-name rule of its own.

Half of the schedule's state is the feed it last read, so a poll that fails leaves the previous answer intact rather than withdrawing a release the user already saw. The page reports a manual check that the shell could not complete as a failure rather than as "up to date".

## Keyboard input ownership

Electron intercepts keydown and keyup in `before-input-event`. Tauri has no shared cross-platform equivalent, so each native carrier hooks input at the platform WebView boundary; the main document keeps the existing DOM listener. A matched embedded-page press and its consumed release are stopped before the guest or iframe handles them, then the trusted source identity is checked by the shared client before dispatch.

## Alternatives considered

**An iframe for the guest.** No native window to place or follow, and no extra process. It cannot load any site that refuses framing, which is the requirement.

**Reimplementing the shortcut document format in the carrier.** The shared `ShortcutPersistence` already owns validation, conflict detection, revision freshness, and atomic writes. The bridge bundles that protocol module from source instead of restating it, so a binding the editor accepts is a binding the carrier accepts.

**Reading the release through the GitHub API instead of a published asset.** The API is rate-limited per IP, unauthenticated, and returns a payload whose fields the carrier would have to keep in step with the release workflow. One generated asset keeps the contract in the workflow that already knows the version, the notes, and the policy floor.

**Blocking on `mandatory` read from the release body.** The body is human-facing prose; a policy field belongs in a machine-read document. An unparseable or absent policy must also leave an installation usable, which prose markers cannot express.

## Consequences

The guest is a native child view, not a DOM element. Page CSS cannot clip it or set its stacking order, so the carrier hides it when DOM hit-testing detects an overlay over the anchor or the anchor disables pointer events.

The guest is a native child WebView, not an ordinary browser window or a DOM element. The page cannot read its DOM; the Tauri host reports navigation state and accepts only scoped guest operations. Windows denies WebView2 permission requests; macOS denies WebKit media-capture requests on macOS 13 and later. Application-address protection, load-error reporting, and DockKit focus notification follow the Electron Browser behavior. DeepDive denies guest downloads under its own policy. Electron `<webview>` and preload behavior belongs to the separate Electron product layer and is not used by DeepDive Desktop.

Browser guests in one Workspace share an in-memory storage partition; different Workspaces use separate partitions. DeepDive retains each partition after its last tab closes and releases it when the application exits, matching Electron's non-persistent `session.fromPartition` behavior. macOS shares a `WKWebsiteDataStore` created with `nonPersistentDataStore`; Windows keeps an InPrivate WebView2 anchor alive for each workspace profile.

`data-platform` switches several shared rules at once: the macOS frame becomes transparent over a native sidebar material, the collapsed sidebar has no icon rail, and the window-drag recall loop starts. A carrier that publishes the mark without the material shows a washed-out sidebar, which is why the window's transparency and effect are configured in the same change as the mark.

The mandatory window is the release feed's only enforcement point. A build that cannot reach the feed at all never learns it is blocked, which is the deliberate trade: an offline installation stays usable rather than becoming unusable with no path to a replacement.

`dsh` installation writes a launcher into `~/.local/bin` on macOS and under `LOCALAPPDATA` with a user `PATH` edit on Windows. It only removes a launcher whose bytes still match the receipt it wrote, so a launcher the user replaced is left alone.
