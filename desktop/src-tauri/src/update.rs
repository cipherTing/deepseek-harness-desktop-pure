//! Background update polling.
//!
//! The release workflow publishes one `latest.json` asset beside the packages,
//! so a single document carries the version, notes, download page and the
//! policy floor. This module owns that feed's schedule: it polls while the user
//! does not, and raises the native reminder once per release so a long-running
//! window cannot nag.

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::AtomicBool,
        Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/**
 * First poll after startup, kept short because the feed also carries the
 * policy floor a blocked installation has to learn before the user works.
 */
const FIRST_POLL: Duration = Duration::from_secs(20);
/** Steady-state delay; the schedule never goes below this. */
const BASE_INTERVAL: Duration = Duration::from_secs(600);
/** Ceiling for the backoff, so an idle installation still checks daily. */
const MAX_INTERVAL: Duration = Duration::from_secs(3_600);
/** One feed fetch, bounded so a stalled connection cannot hold the task. */
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/** Remembered notification state, beside the other Desktop configuration. */
const STATE_FILE: &str = "update-state.json";

/** The release the feed reported, and the facts that suppress it. */
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateState {
    /** Latest release version, `v` prefix removed. */
    pub(crate) latest: Option<String>,
    /** Release notes as the release workflow published them. */
    pub(crate) notes: Option<String>,
    /** Release page a download starts from. */
    pub(crate) page: Option<String>,
    /** Installer link per platform key, as the release workflow published them. */
    pub(crate) assets: Option<std::collections::BTreeMap<String, String>>,
    /** Release whose one-time native reminder was already raised. */
    notified: Option<String>,
    /** Lowest version this build may run; from the feed's policy block. */
    pub(crate) mandatory_minimum: Option<String>,
}

/** Polling state shared by the reminder and the blocking window. */
#[derive(Default)]
pub(crate) struct UpdateMonitor {
    state: Mutex<UpdateState>,
}

/** What the deployed manifest says about this installation. */
struct Installation {
    version: String,
    feed: Option<String>,
}

/** The published feed document; every field is optional so a truncated one cannot panic. */
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedDocument {
    version: Option<String>,
    notes: Option<String>,
    #[serde(alias = "url")]
    page: Option<String>,
    /// Per-platform installer links, so the page never reads a second feed.
    assets: Option<std::collections::BTreeMap<String, String>>,
    mandatory_minimum: Option<String>,
    /// Policy block form, kept for a feed that groups policy fields.
    mandatory: Option<MandatoryBlock>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MandatoryBlock {
    min_version: Option<String>,
}

/**
 * @param app - application handle owning the resource directory.
 * @returns the installed Desktop version, or `0.0.0` when it cannot be read.
 */
pub(crate) fn installed_version(app: &AppHandle) -> String {
    resolve_manifest(app).version
}

/**
 * Read the installed Desktop version and repository from the deployed manifest.
 *
 * The manifest is read on demand rather than cached: a poll runs minutes apart,
 * and the deployed file is the artifact's own record of what is installed.
 * @param app - application handle owning the resource directory.
 * @returns the version text and feed URL, or a placeholder when the manifest is missing.
 */
fn resolve_manifest(app: &AppHandle) -> Installation {
    let unreadable = Installation {
        version: "0.0.0".into(),
        feed: None,
    };
    let Some(path) = app.path().resource_dir().ok().map(|root| root.join("rt/package.json")) else {
        return unreadable;
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return unreadable;
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return unreadable;
    };
    let version = manifest
        .get("version")
        .and_then(|value| value.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    let repository = manifest
        .get("repository")
        .and_then(|value| value.get("url").or(Some(value)))
        .and_then(|value| value.as_str());
    Installation {
        version,
        feed: repository.and_then(feed_url),
    }
}

/**
 * Derive the published feed endpoint from a GitHub repository URL.
 *
 * `releases/latest/download/latest.json` is GitHub's stable redirect to the
 * newest release's asset, so the feed address never has to change.
 * @param repository - `repository.url` from the deployed manifest.
 * @returns the absolute feed URL, or `None` for a non-GitHub origin.
 */
fn feed_url(repository: &str) -> Option<String> {
    let tail = repository.split("github.com/").nth(1)?;
    let mut parts = tail.trim_end_matches(".git").split('/');
    let owner = parts.next()?;
    let name = parts.next()?;
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some(format!(
        "https://github.com/{owner}/{name}/releases/latest/download/latest.json"
    ))
}

/**
 * Restore the release the last session already announced.
 *
 * `manage` installs the state before the resource and configuration
 * directories are resolvable, so the remembered answer is read here instead of
 * inside `Default`.
 * @param app - application handle owning the configuration directory.
 */
pub(crate) fn restore(app: &AppHandle) {
    let remembered = read_state(app).unwrap_or_default();
    *app.state::<crate::DesktopState>().updates.state.lock().unwrap() = remembered;
}

impl UpdateMonitor {
    /** @returns the current state, cloned for a reader outside the lock. */
    pub(crate) fn snapshot(&self) -> UpdateState {
        self.state.lock().unwrap().clone()
    }
}

/** @returns the remembered state, or `None` before the first successful poll. */
fn read_state(app: &AppHandle) -> Option<UpdateState> {
    let raw = fs::read_to_string(state_path(app)?).ok()?;
    serde_json::from_str(&raw).ok()
}

/** Persist the remembered state; a failure only costs one repeated reminder. */
fn write_state(app: &AppHandle, state: &UpdateState) {
    let Some(path) = state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string(state) {
        let _ = fs::write(path, raw);
    }
}

/** @returns the remembered-state path in the Desktop configuration directory. */
fn state_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join(STATE_FILE))
}

/**
 * Compare two versions, `v` prefix optional.
 * @returns `-1`, `0` or `1`, or `None` when either side is not a version this
 * build understands — an unparseable feed value must never claim an update.
 */
pub(crate) fn compare_versions(candidate: &str, baseline: &str) -> Option<i32> {
    let left = parse_version(candidate)?;
    let right = parse_version(baseline)?;
    for index in 0..3 {
        match left.0[index].cmp(&right.0[index]) {
            std::cmp::Ordering::Equal => {}
            other => return Some(if other.is_lt() { -1 } else { 1 }),
        }
    }
    // A release outranks a prerelease of the same core version, and an
    // identifier compares numerically only when both sides are numeric.
    match (left.1.is_empty(), right.1.is_empty()) {
        (true, true) => Some(0),
        (true, false) => Some(1),
        (false, true) => Some(-1),
        (false, false) => {
            for (a, b) in left.1.iter().zip(right.1.iter()) {
                let ordering = match (a.parse::<u64>(), b.parse::<u64>()) {
                    (Ok(a), Ok(b)) => a.cmp(&b),
                    (Ok(_), Err(_)) => std::cmp::Ordering::Less,
                    (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
                    (Err(_), Err(_)) => a.cmp(b),
                };
                match ordering {
                    std::cmp::Ordering::Equal => {}
                    other => return Some(if other.is_lt() { -1 } else { 1 }),
                }
            }
            Some(match left.1.len().cmp(&right.1.len()) {
                std::cmp::Ordering::Equal => 0,
                std::cmp::Ordering::Less => -1,
                std::cmp::Ordering::Greater => 1,
            })
        }
    }
}

/** @returns the three core numbers and the prerelease identifiers. */
fn parse_version(value: &str) -> Option<([u64; 3], Vec<String>)> {
    let text = value.trim().trim_start_matches(['v', 'V']);
    let (core, prerelease) = text.split_once('-').unwrap_or((text, ""));
    // A build suffix carries no ordering, so it is dropped before comparison.
    let core = core.split('+').next()?;
    let mut numbers = core.split('.');
    let mut parsed = [0_u64; 3];
    for slot in &mut parsed {
        *slot = numbers.next()?.parse().ok()?;
    }
    if numbers.next().is_some() {
        return None;
    }
    let identifiers = if prerelease.is_empty() {
        Vec::new()
    } else {
        prerelease
            .split('+')
            .next()?
            .split('.')
            .map(str::to_string)
            .collect()
    };
    Some((parsed, identifiers))
}

/**
 * Fetch and parse the published feed.
 * @param url - feed endpoint.
 * @returns the document, or `None` on any transport or format failure.
 */
fn fetch_feed(url: &str) -> Option<FeedDocument> {
    let agent = ureq::AgentBuilder::new().timeout(REQUEST_TIMEOUT).build();
    let response = agent
        .get(url)
        .set("Accept", "application/json")
        .set("User-Agent", "DeepDive-Desktop")
        .call()
        .ok()?;
    serde_json::from_str(&response.into_string().ok()?).ok()
}

/**
 * Compute what one feed document means for this installation.
 * @param installation - installed version and feed the document came from.
 * @param document - fetched feed document.
 * @param state - state to update in place.
 * @returns whether the one-time native reminder should be raised.
 */
fn absorb(installation: &Installation, document: FeedDocument, state: &mut UpdateState) -> bool {
    let Some(version) = document.version else { return false };
    let version = version.trim().trim_start_matches(['v', 'V']).to_string();
    let known = state
        .latest
        .as_deref()
        .filter(|previous| compare_versions(&version, previous).is_some_and(|ordering| ordering <= 0));
    if known.is_some()
        || compare_versions(&version, &installation.version).is_none_or(|ordering| ordering <= 0)
    {
        // A feed naming this build, an older one, or anything below the release
        // already announced withdraws nothing: the feed can regress behind a
        // prerelease channel, and quietly retracting a known update is worse
        // than keeping it.
        return false;
    }
    let first_announcement = state.notified.as_deref() != Some(version.as_str());
    state.latest = Some(version.clone());
    state.notes = document.notes;
    state.page = document.page;
    state.assets = document.assets;
    // A policy block only ever raises the floor; a malformed one leaves the
    // previous floor in place rather than releasing an installation early.
    let minimum = document
        .mandatory_minimum
        .or_else(|| document.mandatory.and_then(|block| block.min_version));
    if let Some(minimum) = minimum {
        let parsed = minimum.trim().trim_start_matches(['v', 'V']);
        if compare_versions(parsed, &version).is_some() {
            state.mandatory_minimum = Some(parsed.to_string());
        }
    }
    if first_announcement {
        state.notified = Some(version);
    }
    first_announcement
}

/**
 * Raise the reminder for a release the user has not seen.
 *
 * A focused window is left alone — the About section and badge already show
 * the release there, and a notification over the app the user is reading is
 * noise. A background installation gets one silent notification and a Dock or
 * taskbar hint; the page owns the readable dialog.
 * @param app - application handle owning the notification and the window.
 * @param state - state carrying the release found.
 */
fn announce(app: &AppHandle, state: &UpdateState) {
    let Some(version) = state.latest.clone() else { return };
    let focused = app.get_webview_window("main")
        .is_some_and(|window| window.is_focused().unwrap_or(false));
    if focused {
        return;
    }
    // A notification that cancels itself on click stays in the notification
    // center until read, without interrupting whatever the user is doing.
    let notified = app.notification()
        .builder()
        .title("DeepDive")
        .body(format!("Version {version} is available."))
        .auto_cancel()
        .show();
    if let Err(error) = notified {
        eprintln!("DeepDive update notification unavailable: {error}");
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}

/**
 * Poll once, remember the answer and raise the native reminder when it is new.
 * @param app - application handle owning the window and state.
 * @returns whether a release newer than this build is known afterwards.
 */
pub(crate) fn poll_now(app: &AppHandle) -> bool {
    let installation = resolve_manifest(app);
    let Some(url) = installation.feed.clone() else { return false };
    let Some(document) = fetch_feed(&url) else { return false };
    let state = app.state::<crate::DesktopState>();
    let mut guard = state.updates.state.lock().unwrap();
    let announce_now = absorb(&installation, document, &mut guard);
    let snapshot = guard.clone();
    drop(guard);
    write_state(app, &snapshot);
    if announce_now {
        announce(app, &snapshot);
    }
    let floor = snapshot.mandatory_minimum.clone();
    drop(snapshot);
    if let Some(minimum) = floor {
        crate::mandatory::enforce(app, &minimum);
    }
    true
}

/** Release facts the About section and the update badge render. */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseReport {
    /** Installed Desktop version, the baseline the badge compares against. */
    version: String,
    /** Newest release the feed named when it was above this build. */
    latest: Option<String>,
    notes: Option<String>,
    page: Option<String>,
    /** Installer link per platform key; the page picks its own. */
    assets: Option<std::collections::BTreeMap<String, String>>,
}

/** @returns the release facts the shell currently knows, without a network read. */
fn report(app: &AppHandle) -> ReleaseReport {
    let snapshot = app.state::<crate::DesktopState>().updates.snapshot();
    ReleaseReport {
        version: installed_version(app),
        latest: snapshot.latest,
        notes: snapshot.notes,
        page: snapshot.page,
        assets: snapshot.assets,
    }
}

/**
 * Report the remembered release, for the badge's periodic refresh.
 *
 * The page does not poll the release host itself: one schedule owns the feed,
 * so the badge and the native reminder cannot disagree about what exists.
 * @param app - application handle owning the remembered state.
 * @returns the cached release facts.
 */
#[tauri::command]
pub(crate) async fn desktop_release_state(app: AppHandle) -> Result<ReleaseReport, String> {
    Ok(report(&app))
}

/**
 * Read the feed once, for the About section's check button.
 * @param app - application handle owning the poll.
 * @returns the refreshed release facts, or an error when the feed was unreachable.
 */
#[tauri::command]
pub(crate) async fn desktop_release_check(app: AppHandle) -> Result<ReleaseReport, String> {
    let polled = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || poll_now(&app)
    })
    .await
    .map_err(|error| error.to_string())?;
    if !polled {
        return Err("the release feed is unreachable".into());
    }
    Ok(report(&app))
}

/**
 * Start the poll loop, which backs off while the feed has nothing new.
 * @param app - application handle owning the process lifetime.
 */
fn start(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut delay = FIRST_POLL;
        loop {
            tokio::time::sleep(delay).await;
            let polled = handle.clone();
            let found = tauri::async_runtime::spawn_blocking(move || poll_now(&polled))
                .await
                .unwrap_or(false);
            // Nothing new costs less to keep re-reading, so the wait doubles up
            // to the ceiling; a found release resets it to the steady interval.
            delay = if found {
                BASE_INTERVAL
            } else {
                (delay.max(BASE_INTERVAL) * 2).min(MAX_INTERVAL)
            };
        }
    });
}

/** Guards against a second poll loop after a sidecar respawn. */
static POLLING: AtomicBool = AtomicBool::new(false);

/**
 * Start the poll loop exactly once per process.
 * @param app - application handle owning the process lifetime.
 */
pub(crate) fn ensure_started(app: &AppHandle) {
    if POLLING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    start(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installation(installed: &str) -> Installation {
        Installation {
            version: installed.into(),
            feed: None,
        }
    }

    fn document(version: &str, minimum: Option<&str>) -> FeedDocument {
        FeedDocument {
            version: Some(version.into()),
            notes: Some("notes".into()),
            page: Some("https://example.test/v".into()),
            assets: None,
            mandatory_minimum: minimum.map(str::to_string),
            mandatory: None,
        }
    }

    #[test]
    fn release_versions_order_releases_above_prereleases() {
        assert_eq!(compare_versions("v1.2.3", "1.2.3"), Some(0));
        assert_eq!(compare_versions("1.2.4", "1.2.3"), Some(1));
        assert_eq!(compare_versions("1.2.3", "1.10.0"), Some(-1));
        assert_eq!(compare_versions("0.2.0", "0.2.0-rc.1"), Some(1));
        assert_eq!(compare_versions("0.2.0-rc.2", "0.2.0-rc.1"), Some(1));
        assert_eq!(compare_versions("0.2.0-rc.10", "0.2.0-rc.9"), Some(1));
        assert_eq!(compare_versions("0.2.0-alpha", "0.2.0-rc.1"), Some(-1));
    }

    #[test]
    fn an_unparseable_version_never_claims_an_update() {
        for value in ["", "nightly", "1.2", "1.2.3.4", "v1.x.3"] {
            assert_eq!(compare_versions(value, "1.2.3"), None, "{value}");
        }
    }

    #[test]
    fn a_github_repository_yields_the_published_feed_address() {
        assert_eq!(
            feed_url("https://github.com/owner/name").as_deref(),
            Some("https://github.com/owner/name/releases/latest/download/latest.json"),
        );
        assert_eq!(
            feed_url("git+https://github.com/owner/name.git").as_deref(),
            Some("https://github.com/owner/name/releases/latest/download/latest.json"),
        );
        assert!(feed_url("https://example.test/owner/name").is_none());
    }

    #[test]
    fn a_newer_release_announces_once_and_records_its_notes() {
        let installation = installation("0.1.0");
        let mut state = UpdateState::default();
        assert!(absorb(&installation, document("0.2.0", None), &mut state));
        assert_eq!(state.latest.as_deref(), Some("0.2.0"));
        assert_eq!(state.notes.as_deref(), Some("notes"));
        assert_eq!(state.notified.as_deref(), Some("0.2.0"));
        assert!(!absorb(&installation, document("0.2.0", None), &mut state));
    }

    #[test]
    fn a_policy_floor_survives_a_malformed_update_and_raises_only_upwards() {
        let installation = installation("0.1.0");
        let mut state = UpdateState::default();
        absorb(&installation, document("0.2.0", Some("0.2.0")), &mut state);
        assert_eq!(state.mandatory_minimum.as_deref(), Some("0.2.0"));
        absorb(&installation, document("0.3.0", Some("not-a-version")), &mut state);
        assert_eq!(state.mandatory_minimum.as_deref(), Some("0.2.0"));
        absorb(&installation, document("0.4.0", Some("0.3.5")), &mut state);
        assert_eq!(state.mandatory_minimum.as_deref(), Some("0.3.5"));
    }

    #[test]
    fn an_older_or_equal_release_never_replaces_a_newer_known_one() {
        let installation = installation("0.1.0");
        let mut state = UpdateState::default();
        absorb(&installation, document("0.3.0", None), &mut state);
        for version in ["0.2.0", "0.3.0"] {
            assert!(!absorb(&installation, document(version, None), &mut state));
        }
        assert_eq!(state.latest.as_deref(), Some("0.3.0"));
    }

    #[test]
    fn a_release_announces_once_and_a_newer_one_again() {
        let installation = installation("0.1.0");
        let mut state = UpdateState::default();
        assert!(absorb(&installation, document("0.2.0", None), &mut state));
        assert!(!absorb(&installation, document("0.2.0", None), &mut state));
        assert!(absorb(&installation, document("0.3.0", None), &mut state));
        assert_eq!(state.notified.as_deref(), Some("0.3.0"));
    }

    #[test]
    fn a_build_ahead_of_the_feed_keeps_the_last_known_release() {
        let installation = installation("0.4.0");
        let mut state = UpdateState {
            latest: Some("0.3.0".into()),
            ..UpdateState::default()
        };
        assert!(!absorb(&installation, document("0.3.0", None), &mut state));
        assert_eq!(state.latest.as_deref(), Some("0.3.0"));
    }
}
