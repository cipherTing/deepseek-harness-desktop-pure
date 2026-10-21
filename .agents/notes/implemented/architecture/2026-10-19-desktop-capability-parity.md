# Agent Note: Desktop capability parity with the Electron product layer

Status: implemented

English | [中文](2026-10-19-desktop-capability-parity.zh.md)

## Problem

The upstream Electron product layer (`apps/desktop`, `apps/desktop-host`) is not integrated into DeepDive, so every capability it provides had to be rebuilt inside `desktop/` or not exist at all. Two of those gaps were structural rather than cosmetic.

The Browser tab in the sidebar is carried by an Electron `<webview>`: a Chromium out-of-process frame the renderer positions like any DOM element. A Tauri window has no such element, and the iframe fallback this fork shipped cannot load a site that answers `X-Frame-Options: DENY`, which includes GitHub and most large sites. The tab was therefore unusable for the sites users actually open in it.

The rest of the gap was the Desktop signal itself. The upstream client branches on `globalThis.dshDesktop`, on `document.documentElement.dataset.platform`, and on a native keyboard channel. Without them, the same client runs its Web behavior inside a desktop window: no Desktop onboarding, no tray residency, no device-local keybindings, no update reminder, no `dsh` on `PATH`.

## Decision

The sidebar Browser tab keeps its page-side layout role and gives up its page-side content role. `ElectronWebviewPresentation` now creates a positioned anchor element instead of a `<webview>`, and `browser_window.rs` owns one borderless `WebviewWindow` per tab, parented to the main window and moved to the anchor's rectangle. The shared browser business logic — URL normalization, history gating, title and loading state, tab lifetime — is unchanged; only the carrier is replaced.

Guest state is cached natively and pushed to the page as one event stream (`desktop-browser-event`) carrying `load-started`, `load-finished`, `navigated`, and `title`. The page keeps reading a synchronous snapshot, because `goBack`/`goForward`/`loadUrl`/`reload` gate themselves on the current history availability and cannot await a round trip. History availability itself comes from an initialization script that patches `history.pushState`/`replaceState`/`go`/`back`/`forward` and answers a read through `eval_with_callback`, so no `objc2-web-kit`, `webview2-com`, or `webkit2gtk` dependency is needed.

Positioning is `inner_position() + rect × scale_factor`: on macOS the window's inner position is its client-area origin, and the WebView fills that area, so no title-bar or decoration compensation is required. The main window's `Moved` and `Resized` events re-run that arithmetic natively, and the page's per-frame follow runs in parallel; the duplicate is deliberate, because Tauri delivers only one move per drag step and the native pass alone visibly lags.

The Desktop signal is now complete. `dshDesktop` exposes `deviceInfo`, `browser`, `shortcuts`, and `keyboard`; `dshOnboarding` exposes `hasApiKey` and `setActive`; `data-platform`, `data-fullscreen`, and the macOS window material are published by the carrier. Keybindings are device-local files under the Desktop configuration directory, read and written through narrow commands rather than WebView filesystem access.

Keyboard input is forwarded from the DOM. Tauri's `WindowEvent` has no keyboard input on any platform, so a capture-phase `keydown`/`keyup` pair resolves each press against the same binding index the Electron main process built, calls `preventDefault` when a command claims it, and hands the resulting input to the client's `installNativeKeyboard`. That path is scoped to macOS and Windows, the two platforms where the shared client installs its own dispatcher with native input ownership; on Linux the DOM path already delivers every configurable binding.

## Update feed

Releases publish one `latest.json` asset beside the packages, addressed as `releases/latest/download/latest.json`, so its URL never changes with a tag. The document carries the version, the bilingual release notes, the release page, the installer link per platform, and an optional `mandatoryMinVersion`. The shell polls that feed in the background, with the base interval doubling up to one hour while a poll fails, and raises one notification per release (never while the window is focused). A `mandatoryMinVersion` above the installed build opens a blocking window that loads a bundled document and holds no page capability; an unparseable value never blocks an installation that would otherwise have no way to fetch a replacement.

The feed has one reader. The About section and the update badge ask the shell for what it already knows instead of querying the release host themselves, so the badge and the native reminder cannot name different releases, and the page owns no version comparison or installer-name rule of its own.

Half of the schedule's state is the feed it last read, so a poll that fails leaves the previous answer intact rather than withdrawing a release the user already saw. The page reports a manual check that the shell could not complete as a failure rather than as "up to date".

## Why the DOM keyboard forwarder

Electron intercepts a matched key in the main process, so the renderer never sees it and cannot re-fire the command. A Tauri carrier has no comparable hook. Forwarding from a capture-phase listener reproduces the two properties that matter — the command runs once, and the page does not also act on the key — without adding a native input surface, a platform-specific keycode table, or a second source of truth for what a press means. The cost is that the forwarder does not see input delivered to an embedded frame, so a shortcut pressed inside a rendered HTML preview or a browser guest is not claimed by a global command.

## Alternatives considered

**`Window::add_child` for the guest.** The documented way to place a WebView over another window, and it needs the `unstable` feature. Linux `set_bounds` is a no-op, a child webview always draws above the parent, and the two open input defects ([tauri#8705](https://github.com/tauri-apps/tauri/issues/8705), [tauri#10194](https://github.com/tauri-apps/tauri/issues/10194)) reproduce under exactly that mode. Enabling `unstable` would also change how the main webview is created.

**An iframe for the guest.** No native window to place or follow, and no extra process. It cannot load any site that refuses framing, which is the requirement.

**Native key interception through a platform input API.** It would see input inside embedded frames. It costs a new native permission surface, three platform implementations, and a keycode mapping that has to stay in step with the shared protocol; the shared client's own keyboard adapter is written against preload-verified input, not a platform event stream.

**Reimplementing the shortcut document format in the carrier.** The shared `ShortcutPersistence` already owns validation, conflict detection, revision freshness, and atomic writes. The bridge bundles that protocol module from source instead of restating it, so a binding the editor accepts is a binding the carrier accepts.

**Reading the release through the GitHub API instead of a published asset.** The API is rate-limited per IP, unauthenticated, and returns a payload whose fields the carrier would have to keep in step with the release workflow. One generated asset keeps the contract in the workflow that already knows the version, the notes, and the policy floor.

**Blocking on `mandatory` read from the release body.** The body is human-facing prose; a policy field belongs in a machine-read document. An unparseable or absent policy must also leave an installation usable, which prose markers cannot express.

## Consequences

The guest window always draws above its parent. A page-side overlay that opens over the sidebar — a settings menu, the composer's pickers — is covered by the guest until the follow loop reports the anchor off screen or another tab becomes active; the carrier cannot clip a native window to a CSS region.

The guest is an ordinary browser window, so the page cannot read its DOM. Navigation, title, and history availability are the whole contract, and anything else the Electron guest reported through its preload has no equivalent.

`data-platform` switches several shared rules at once: the macOS frame becomes transparent over a native sidebar material, the collapsed sidebar has no icon rail, and the window-drag recall loop starts. A carrier that publishes the mark without the material shows a washed-out sidebar, which is why the window's transparency and effect are configured in the same change as the mark.

The keyboard forwarder is macOS/Windows only. On Linux, configurable bindings continue to arrive through the client's DOM dispatcher, and a chord recorded on a macOS installation is not claimed there.

The mandatory window is the release feed's only enforcement point. A build that cannot reach the feed at all never learns it is blocked, which is the deliberate trade: an offline installation stays usable rather than becoming unusable with no path to a replacement.

`dsh` installation writes a launcher into `~/.local/bin` on macOS and Linux and under `LOCALAPPDATA` with a user `PATH` edit on Windows. It only removes a launcher whose bytes still match the receipt it wrote, so a launcher the user replaced is left alone.
