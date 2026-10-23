//! Physical shortcut matching for focused Browser guests and HTML frames.
//!
//! The shared client resolves preferences and conflicts; this owner receives
//! only its accepted bindings and intercepts physical input before a nested
//! browsing context can consume it. Main-document input keeps its DOM carrier.

use std::{
    collections::{BTreeSet, HashMap},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

/** Event consumed by the main document's shared keyboard dispatcher. */
const SHORTCUT_EVENT: &str = "desktop-shortcut-input";

/** Native listener attached to one main or guest WebView. */
pub(crate) enum NativeHook {
    #[cfg(target_os = "macos")]
    Macos(macos::Hook),
    #[cfg(windows)]
    Windows(windows::Hook),
}

impl NativeHook {
    /** Remove the physical input listener before its WebView closes. */
    pub(crate) async fn remove(self, view: &tauri::Webview) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Macos(hook) => macos::remove(view, hook).await,
            #[cfg(windows)]
            Self::Windows(hook) => windows::remove(view, hook).await,
        }
    }
}

/** Physical key input supplied by the platform's focused-view hook. */
pub(crate) struct KeyInput {
    pub(crate) code: String,
    pub(crate) key: String,
    pub(crate) control: bool,
    pub(crate) alt: bool,
    pub(crate) shift: bool,
    pub(crate) meta: bool,
    pub(crate) repeat: bool,
    /** IME composition or AltGr input must reach the native text system. */
    pub(crate) composing: bool,
    pub(crate) down: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "lowercase")]
enum Modifier {
    Control,
    Alt,
    Shift,
    Meta,
}

/** Already-resolved physical binding; no command or conflict policy lives here. */
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NormalizedBinding {
    code: String,
    second_code: Option<String>,
    modifiers: Vec<Modifier>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum FocusKind {
    Keyboard,
    Iframe,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyboardFocus {
    kind: FocusKind,
    frame_name: String,
}

/** Main-document configuration, accepted only from the Desktop capability. */
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KeyboardConfiguration {
    revision: Option<String>,
    bindings: Vec<NormalizedBinding>,
    recording: bool,
    blocked: bool,
    focus: KeyboardFocus,
}

impl KeyboardConfiguration {
    /** Reject malformed wire values without resolving preferences a second time. */
    fn validate(&self) -> Result<(), String> {
        if self.revision.as_deref() == Some("") {
            return Err("Desktop keyboard revision must not be empty".into());
        }
        if (self.focus.kind == FocusKind::Keyboard) != self.focus.frame_name.is_empty() {
            return Err("Desktop keyboard focus must identify its iframe".into());
        }
        for binding in &self.bindings {
            if !supported_code(&binding.code)
                || binding
                    .second_code
                    .as_ref()
                    .is_some_and(|second| !supported_code(second) || second <= &binding.code)
                || !binding.modifiers.windows(2).all(|pair| pair[0] < pair[1])
            {
                return Err("Desktop keyboard binding must be normalized".into());
            }
        }
        Ok(())
    }

    fn has(&self, binding: &NormalizedBinding) -> bool {
        self.bindings.contains(binding)
    }
}

/** Physical codes admitted by the shared shortcut protocol. */
fn supported_code(code: &str) -> bool {
    if let Some(letter) = code.strip_prefix("Key") {
        return letter.len() == 1 && letter.as_bytes()[0].is_ascii_uppercase();
    }
    if let Some(digit) = code.strip_prefix("Digit") {
        return digit.len() == 1 && digit.as_bytes()[0].is_ascii_digit();
    }
    if let Some(number) = code.strip_prefix('F') {
        return number
            .parse::<u8>()
            .is_ok_and(|value| (1..=24).contains(&value) && number == value.to_string());
    }
    matches!(
        code,
        "Slash"
            | "Comma"
            | "Period"
            | "Backslash"
            | "Backquote"
            | "Minus"
            | "Equal"
            | "BracketLeft"
            | "BracketRight"
            | "Semicolon"
            | "Quote"
            | "Enter"
            | "Escape"
            | "Space"
            | "Tab"
            | "Backspace"
            | "Delete"
            | "ArrowUp"
            | "ArrowDown"
            | "ArrowLeft"
            | "ArrowRight"
    )
}

fn modifier_key(code: &str) -> bool {
    ["Control", "Alt", "Shift", "Meta"]
        .iter()
        .any(|prefix| code == format!("{prefix}Left") || code == format!("{prefix}Right"))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum SourceKind {
    Iframe,
    Webview,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct InputSource {
    kind: SourceKind,
    frame_name: String,
}

/** Fields of the shared `DesktopShortcutInput` protocol. */
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutInput {
    kind: SourceKind,
    revision: String,
    frame_name: String,
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    second_code: Option<String>,
    control: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    repeat: bool,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum Consumption {
    /** The renderer never saw this press, so it must not see its release. */
    Press,
    /** The first chord key reached the renderer, which still needs its release. */
    Repeat,
}

#[derive(Default)]
struct MatcherState {
    dead_key: bool,
    held: BTreeSet<String>,
    consumed: HashMap<String, Consumption>,
}

#[derive(Default)]
struct ProcessResult {
    consumed: bool,
    event: Option<ShortcutInput>,
}

impl MatcherState {
    /** Match one physical event with Electron's press, repeat and chord priority. */
    fn process(
        &mut self,
        configuration: &KeyboardConfiguration,
        source: InputSource,
        input: &KeyInput,
    ) -> ProcessResult {
        if configuration.blocked {
            return ProcessResult {
                consumed: true,
                event: None,
            };
        }
        let Some(revision) = configuration.revision.as_ref() else {
            *self = Self::default();
            return ProcessResult::default();
        };
        let composing = input.composing || input.key == "Dead" || self.dead_key;
        if input.down {
            self.dead_key = input.key == "Dead";
        }
        if configuration.recording || composing {
            self.held.clear();
            self.consumed.clear();
            return ProcessResult::default();
        }
        let modifier_key = modifier_key(&input.code);
        if !input.down {
            let consumed = self.consumed.remove(&input.code) == Some(Consumption::Press);
            self.held.remove(&input.code);
            if modifier_key {
                self.held.clear();
            }
            return ProcessResult {
                consumed,
                event: None,
            };
        }
        if !input.repeat {
            self.consumed.remove(&input.code);
        }
        if modifier_key {
            self.held.clear();
            return ProcessResult::default();
        }
        let modifiers = [
            (input.control, Modifier::Control),
            (input.alt, Modifier::Alt),
            (input.shift, Modifier::Shift),
            (input.meta, Modifier::Meta),
        ]
        .into_iter()
        .filter_map(|(held, modifier)| held.then_some(modifier))
        .collect();
        let mut binding = NormalizedBinding {
            code: input.code.clone(),
            second_code: None,
            modifiers,
        };
        let single = configuration.has(&binding);
        if input.repeat && self.consumed.contains_key(&input.code) && !single {
            return ProcessResult {
                consumed: true,
                event: None,
            };
        }
        if input.repeat && !self.held.contains(&input.code) && !single {
            return ProcessResult::default();
        }
        self.held.insert(input.code.clone());
        let mut matched = single;
        if self.held.len() >= 2 {
            let mut codes = self.held.iter();
            let pair = NormalizedBinding {
                code: codes.next().unwrap().clone(),
                second_code: codes.next().cloned(),
                modifiers: binding.modifiers.clone(),
            };
            if configuration.has(&pair) {
                binding = pair;
                matched = true;
            }
        }
        if !matched {
            return ProcessResult::default();
        }
        if !input.repeat {
            if let Some(second) = &binding.second_code {
                self.consumed
                    .insert(binding.code.clone(), Consumption::Repeat);
                self.consumed.insert(second.clone(), Consumption::Repeat);
            }
            self.consumed.insert(input.code.clone(), Consumption::Press);
        }
        // Interception can omit keyups; a completed press cannot seed a chord.
        self.held.clear();
        ProcessResult {
            consumed: true,
            event: Some(ShortcutInput {
                kind: source.kind,
                revision: revision.clone(),
                frame_name: source.frame_name,
                code: binding.code,
                second_code: binding.second_code,
                control: input.control,
                alt: input.alt,
                shift: input.shift,
                meta: input.meta,
                repeat: input.repeat,
            }),
        }
    }
}

#[derive(Default)]
struct KeyboardInner {
    configuration: Option<KeyboardConfiguration>,
    focused_view: Option<String>,
    views: HashMap<String, MatcherState>,
}

impl KeyboardInner {
    fn configure(&mut self, configuration: KeyboardConfiguration) {
        if self.configuration.as_ref() != Some(&configuration) {
            self.views.clear();
            self.configuration = Some(configuration);
        }
    }

    fn set_focus(&mut self, view: &str, focused: bool) {
        if focused {
            if self.focused_view.as_deref() != Some(view) {
                self.views.clear();
                self.focused_view = Some(view.to_string());
            }
        } else if self.focused_view.as_deref() == Some(view) {
            self.focused_view = None;
            self.views.remove(view);
        }
    }

    fn process(&mut self, view: &str, input: &KeyInput) -> ProcessResult {
        let Some(configuration) = &self.configuration else {
            return ProcessResult::default();
        };
        let source = if view == "main" {
            if configuration.focus.kind != FocusKind::Iframe {
                self.views.remove(view);
                return ProcessResult::default();
            }
            InputSource {
                kind: SourceKind::Iframe,
                frame_name: configuration.focus.frame_name.clone(),
            }
        } else {
            InputSource {
                kind: SourceKind::Webview,
                frame_name: view.into(),
            }
        };
        self.views
            .entry(view.into())
            .or_default()
            .process(configuration, source, input)
    }
}

/** Application-owned configuration and one physical-key state per native view. */
#[derive(Default)]
pub(crate) struct KeyboardState {
    inner: Mutex<KeyboardInner>,
    main_hook: Mutex<Option<NativeHook>>,
}

impl KeyboardState {
    /** Keep the main WebView's native hook alive until the application exits. */
    pub(crate) fn retain_main_hook(&self, hook: NativeHook) {
        *self.main_hook.lock().unwrap() = Some(hook);
    }
}

/** Attach the platform's native keyboard source to one identified view. */
pub(crate) async fn install(
    app: &AppHandle,
    view: &tauri::Webview,
    label: &str,
) -> Result<NativeHook, String> {
    #[cfg(target_os = "macos")]
    {
        return macos::install(view, app.clone(), label.to_string())
            .await
            .map(NativeHook::Macos);
    }
    #[cfg(windows)]
    {
        return windows::install(view, app.clone(), label.to_string())
            .await
            .map(NativeHook::Windows);
    }
}

/** Install the main page's resolved bindings; malformed updates leave them intact. */
#[tauri::command]
pub(crate) fn desktop_keyboard_configure(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::DesktopState>,
    configuration: KeyboardConfiguration,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Desktop keyboard configuration requires the main view".into());
    }
    configuration.validate()?;
    state
        .keyboard
        .inner
        .lock()
        .unwrap()
        .configure(configuration);
    Ok(())
}

/**
 * Process input from a platform-verified focused native view.
 * @returns whether the native hook must consume the physical event.
 */
pub(crate) fn handle(app: &AppHandle, view: &str, input: KeyInput) -> bool {
    let state = app.state::<crate::DesktopState>();
    let result = state.keyboard.inner.lock().unwrap().process(view, &input);
    if let Some(event) = result.event {
        if let Err(error) = app.emit_to("main", SHORTCUT_EVENT, event) {
            crate::devlog::write(format_args!("shortcut input delivery failed: {error}"));
        }
    }
    result.consumed
}

/** Track which native WebView currently owns keyboard focus. */
pub(crate) fn set_focus(app: &AppHandle, view: &str, focused: bool) {
    app.state::<crate::DesktopState>()
        .keyboard
        .inner
        .lock()
        .unwrap()
        .set_focus(view, focused);
}

/** Route a host message to the view identified by WebView2 focus notifications. */
pub(crate) fn handle_focused(app: &AppHandle, input: KeyInput) -> bool {
    let state = app.state::<crate::DesktopState>();
    let result = {
        let mut inner = state.keyboard.inner.lock().unwrap();
        let Some(view) = inner.focused_view.clone() else {
            return false;
        };
        inner.process(&view, &input)
    };
    if let Some(event) = result.event {
        if let Err(error) = app.emit_to("main", SHORTCUT_EVENT, event) {
            crate::devlog::write(format_args!("shortcut input delivery failed: {error}"));
        }
    }
    result.consumed
}

/** Forget a view's held keys when its focus or native lease ends. */
pub(crate) fn reset(app: &AppHandle, view: &str) {
    app.state::<crate::DesktopState>()
        .keyboard
        .inner
        .lock()
        .unwrap()
        .views
        .remove(view);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configuration(bindings: serde_json::Value) -> KeyboardConfiguration {
        let configuration: KeyboardConfiguration = serde_json::from_value(serde_json::json!({
            "revision": "revision-1", "bindings": bindings, "recording": false,
            "blocked": false, "focus": {"kind": "iframe", "frameName": "preview"}
        }))
        .unwrap();
        configuration.validate().unwrap();
        configuration
    }

    fn key(code: &str) -> KeyInput {
        KeyInput {
            code: code.into(),
            key: code.strip_prefix("Key").unwrap_or(code).into(),
            control: false,
            alt: false,
            shift: false,
            meta: true,
            repeat: false,
            composing: false,
            down: true,
        }
    }

    fn state(bindings: serde_json::Value) -> KeyboardInner {
        let mut state = KeyboardInner::default();
        state.configure(configuration(bindings));
        state
    }

    #[test]
    fn iframe_and_guest_inputs_report_their_trusted_embedding() {
        let mut state = state(serde_json::json!([{"code":"KeyK","modifiers":["meta"]}]));
        let iframe = state.process("main", &key("KeyK")).event.unwrap();
        assert_eq!(iframe.kind, SourceKind::Iframe);
        assert_eq!(iframe.frame_name, "preview");
        let guest = state
            .process("browser-guest-4", &key("KeyK"))
            .event
            .unwrap();
        assert_eq!(guest.kind, SourceKind::Webview);
        assert_eq!(guest.frame_name, "browser-guest-4");
        let json = serde_json::to_value(guest).unwrap();
        assert!(json.get("secondCode").is_none());
        assert_eq!(json["revision"], "revision-1");
    }

    #[test]
    fn main_document_keys_stay_with_the_dom_carrier() {
        let mut state = state(serde_json::json!([{"code":"KeyK","modifiers":["meta"]}]));
        let mut configuration = state.configuration.take().unwrap();
        configuration.focus.kind = FocusKind::Keyboard;
        configuration.focus.frame_name.clear();
        state.configure(configuration);
        assert!(!state.process("main", &key("KeyK")).consumed);
        assert!(state.process("browser-guest-1", &key("KeyK")).consumed);
    }

    #[test]
    fn unclaimed_keys_and_wrong_modifiers_reach_the_page() {
        let mut state = state(serde_json::json!([{"code":"KeyK","modifiers":["meta"]}]));
        assert!(!state.process("main", &key("KeyJ")).consumed);
        let mut input = key("KeyK");
        input.shift = true;
        assert!(!state.process("main", &input).consumed);
    }

    #[test]
    fn recording_and_composition_do_not_intercept_text() {
        let bindings = serde_json::json!([{"code":"KeyK","modifiers":["meta"]}]);
        let mut state = state(bindings.clone());
        let mut input = key("KeyK");
        input.composing = true;
        assert!(!state.process("main", &input).consumed);
        input.composing = false;
        input.key = "Dead".into();
        assert!(!state.process("main", &input).consumed);
        input.key = "k".into();
        assert!(!state.process("main", &input).consumed);
        assert!(state.process("main", &input).consumed);
        let mut configuration = configuration(bindings);
        configuration.recording = true;
        state.configure(configuration);
        assert!(!state.process("main", &input).consumed);
    }

    #[test]
    fn a_two_key_chord_outranks_the_second_keys_single_binding() {
        let mut state = state(serde_json::json!([
            {"code":"KeyJ","secondCode":"KeyK","modifiers":["meta"]},
            {"code":"KeyK","modifiers":["meta"]}
        ]));
        assert!(!state.process("main", &key("KeyJ")).consumed);
        let event = state.process("main", &key("KeyK")).event.unwrap();
        assert_eq!(event.code, "KeyJ");
        assert_eq!(event.second_code.as_deref(), Some("KeyK"));
        let mut release = key("KeyJ");
        release.down = false;
        assert!(!state.process("main", &release).consumed);
        release.code = "KeyK".into();
        assert!(state.process("main", &release).consumed);
    }

    #[test]
    fn chord_repeats_are_consumed_without_refiring_and_single_repeats_dispatch() {
        let mut state = state(serde_json::json!([
            {"code":"KeyJ","secondCode":"KeyK","modifiers":["meta"]},
            {"code":"KeyW","modifiers":["meta"]}
        ]));
        state.process("main", &key("KeyJ"));
        assert!(state.process("main", &key("KeyK")).event.is_some());
        let mut repeat = key("KeyJ");
        repeat.repeat = true;
        let repeated_chord = state.process("main", &repeat);
        assert!(repeated_chord.consumed);
        assert!(repeated_chord.event.is_none());
        repeat.code = "KeyW".into();
        assert!(state.process("main", &repeat).event.unwrap().repeat);
    }

    #[test]
    fn a_completed_press_never_seeds_a_later_chord() {
        let mut state = state(serde_json::json!([
            {"code":"KeyJ","secondCode":"KeyK","modifiers":["meta"]},
            {"code":"KeyK","secondCode":"KeyL","modifiers":["meta"]}
        ]));
        state.process("main", &key("KeyJ"));
        assert!(state.process("main", &key("KeyK")).consumed);
        assert!(!state.process("main", &key("KeyL")).consumed);
    }

    #[test]
    fn configuration_and_frame_changes_forget_old_presses_and_revisions() {
        let bindings = serde_json::json!([
            {"code":"KeyJ","secondCode":"KeyK","modifiers":["meta"]},
            {"code":"KeyW","modifiers":["meta"]}
        ]);
        let mut state = state(bindings.clone());
        state.process("main", &key("KeyJ"));
        let mut next = configuration(bindings.clone());
        next.revision = Some("revision-2".into());
        state.configure(next);
        assert!(!state.process("main", &key("KeyK")).consumed);
        let event = state.process("main", &key("KeyW")).event.unwrap();
        assert_eq!(event.revision, "revision-2");
        state.process("main", &key("KeyJ"));
        let mut next = configuration(bindings);
        next.focus.frame_name = "other-preview".into();
        state.configure(next);
        assert!(!state.process("main", &key("KeyK")).consumed);
    }

    #[test]
    fn blur_release_and_modifiers_cannot_leave_a_stuck_chord() {
        let mut state = state(serde_json::json!([
            {"code":"KeyJ","secondCode":"KeyK","modifiers":["meta"]}
        ]));
        state.process("browser-guest-1", &key("KeyJ"));
        state.views.remove("browser-guest-1");
        assert!(!state.process("browser-guest-1", &key("KeyK")).consumed);
        state.process("main", &key("KeyJ"));
        state.process("main", &key("MetaLeft"));
        assert!(!state.process("main", &key("KeyK")).consumed);
    }

    #[test]
    fn shell_blocking_eats_guest_input_without_dispatch() {
        let mut state = state(serde_json::json!([{"code":"KeyK","modifiers":["meta"]}]));
        state.configuration.as_mut().unwrap().blocked = true;
        let result = state.process("browser-guest-1", &key("KeyJ"));
        assert!(result.consumed);
        assert!(result.event.is_none());
    }

    #[test]
    fn wire_configuration_rejects_invalid_fields_and_noncanonical_bindings() {
        for bindings in [
            serde_json::json!([{"code":"Keya","modifiers":[]}]),
            serde_json::json!([{"code":"F01","modifiers":[]}]),
            serde_json::json!([{"code":"KeyK","secondCode":"KeyJ","modifiers":[]}]),
            serde_json::json!([{"code":"KeyK","secondCode":"KeyK","modifiers":[]}]),
            serde_json::json!([{"code":"KeyK","modifiers":["meta","control"]}]),
            serde_json::json!([{"code":"KeyK","modifiers":["meta","meta"]}]),
        ] {
            let mut candidate = configuration(serde_json::json!([]));
            candidate.bindings = serde_json::from_value(bindings).unwrap();
            assert!(candidate.validate().is_err());
        }
        assert!(
            serde_json::from_value::<KeyboardConfiguration>(serde_json::json!({
                "revision":null,"bindings":[],"recording":false,"blocked":false,
                "focus":{"kind":"keyboard","frameName":""},"unexpected":true
            }))
            .is_err()
        );
    }
}
