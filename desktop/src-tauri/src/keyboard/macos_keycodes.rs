//! Map macOS virtual key codes to the DOM physical codes used by Desktop shortcuts.

/** Return the DOM physical code for a macOS virtual key code. */
pub(super) fn code_for_keycode(key_code: u16) -> Option<&'static str> {
    Some(match key_code {
        0x00 => "KeyA",
        0x01 => "KeyS",
        0x02 => "KeyD",
        0x03 => "KeyF",
        0x04 => "KeyH",
        0x05 => "KeyG",
        0x06 => "KeyZ",
        0x07 => "KeyX",
        0x08 => "KeyC",
        0x09 => "KeyV",
        0x0B => "KeyB",
        0x0C => "KeyQ",
        0x0D => "KeyW",
        0x0E => "KeyE",
        0x0F => "KeyR",
        0x10 => "KeyY",
        0x11 => "KeyT",
        0x12 => "Digit1",
        0x13 => "Digit2",
        0x14 => "Digit3",
        0x15 => "Digit4",
        0x16 => "Digit6",
        0x17 => "Digit5",
        0x18 => "Equal",
        0x19 => "Digit9",
        0x1A => "Digit7",
        0x1B => "Minus",
        0x1C => "Digit8",
        0x1D => "Digit0",
        0x1E => "BracketRight",
        0x1F => "KeyO",
        0x20 => "KeyU",
        0x21 => "BracketLeft",
        0x22 => "KeyI",
        0x23 => "KeyP",
        0x24 => "Enter",
        0x25 => "KeyL",
        0x26 => "KeyJ",
        0x27 => "Quote",
        0x28 => "KeyK",
        0x29 => "Semicolon",
        0x2A => "Backslash",
        0x2B => "Comma",
        0x2C => "Slash",
        0x2D => "KeyN",
        0x2E => "KeyM",
        0x2F => "Period",
        0x30 => "Tab",
        0x31 => "Space",
        0x32 => "Backquote",
        0x33 => "Backspace",
        0x35 => "Escape",
        0x36 => "MetaRight",
        0x37 => "MetaLeft",
        0x38 => "ShiftLeft",
        0x3A => "AltLeft",
        0x3B => "ControlLeft",
        0x3C => "ShiftRight",
        0x3D => "AltRight",
        0x3E => "ControlRight",
        0x40 => "F17",
        0x4F => "F18",
        0x50 => "F19",
        0x5A => "F20",
        0x60 => "F5",
        0x61 => "F6",
        0x62 => "F7",
        0x63 => "F3",
        0x64 => "F8",
        0x65 => "F9",
        0x67 => "F11",
        0x69 => "F13",
        0x6A => "F16",
        0x6B => "F14",
        0x6D => "F10",
        0x6F => "F12",
        0x71 => "F15",
        0x75 => "Delete",
        0x76 => "F4",
        0x78 => "F2",
        0x7A => "F1",
        0x7B => "ArrowLeft",
        0x7C => "ArrowRight",
        0x7D => "ArrowDown",
        0x7E => "ArrowUp",
        _ => return None,
    })
}

/** Return the DOM key value, preserving the layout-produced character. */
pub(super) fn key_for_event(code: &str, characters: &str) -> String {
    let named = match code {
        "Enter" => Some("Enter"),
        "Escape" => Some("Escape"),
        "Space" => Some(" "),
        "Tab" => Some("Tab"),
        "Backspace" => Some("Backspace"),
        "Delete" => Some("Delete"),
        "ArrowUp" => Some("ArrowUp"),
        "ArrowDown" => Some("ArrowDown"),
        "ArrowLeft" => Some("ArrowLeft"),
        "ArrowRight" => Some("ArrowRight"),
        "ControlLeft" | "ControlRight" => Some("Control"),
        "AltLeft" | "AltRight" => Some("Alt"),
        "ShiftLeft" | "ShiftRight" => Some("Shift"),
        "MetaLeft" | "MetaRight" => Some("Meta"),
        _ => None,
    };
    if let Some(key) = named {
        return key.to_string();
    }

    if let Some(number) = code.strip_prefix('F') {
        if number
            .parse::<u8>()
            .is_ok_and(|value| (1..=24).contains(&value))
        {
            return code.to_string();
        }
    }

    if characters.is_empty() {
        return "Dead".to_string();
    }
    if characters == "\r" || characters == "\n" {
        return "Enter".to_string();
    }
    if characters == "\t" {
        return "Tab".to_string();
    }
    if characters == "\u{1b}" {
        return "Escape".to_string();
    }
    characters.to_string()
}

/** Resolve function keys above F20 from AppKit's documented private-use key value. */
pub(super) fn code_for_function_character(characters: &str) -> Option<&'static str> {
    let mut chars = characters.chars();
    let value = chars.next()? as u32;
    if chars.next().is_some() || !(0xF704..=0xF71B).contains(&value) {
        return None;
    }
    let number = value - 0xF704 + 1;
    match number {
        1 => Some("F1"),
        2 => Some("F2"),
        3 => Some("F3"),
        4 => Some("F4"),
        5 => Some("F5"),
        6 => Some("F6"),
        7 => Some("F7"),
        8 => Some("F8"),
        9 => Some("F9"),
        10 => Some("F10"),
        11 => Some("F11"),
        12 => Some("F12"),
        13 => Some("F13"),
        14 => Some("F14"),
        15 => Some("F15"),
        16 => Some("F16"),
        17 => Some("F17"),
        18 => Some("F18"),
        19 => Some("F19"),
        20 => Some("F20"),
        21 => Some("F21"),
        22 => Some("F22"),
        23 => Some("F23"),
        24 => Some("F24"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_us_physical_keys() {
        for (key_code, expected) in [
            (0x00, "KeyA"),
            (0x1D, "Digit0"),
            (0x24, "Enter"),
            (0x33, "Backspace"),
            (0x35, "Escape"),
            (0x37, "MetaLeft"),
            (0x3E, "ControlRight"),
            (0x75, "Delete"),
            (0x7B, "ArrowLeft"),
            (0x7E, "ArrowUp"),
        ] {
            assert_eq!(code_for_keycode(key_code), Some(expected));
        }
        assert_eq!(code_for_keycode(0x0A), None);
        assert_eq!(code_for_keycode(0x41), None);
    }

    #[test]
    fn maps_function_keys_through_f24() {
        assert_eq!(code_for_keycode(0x7A), Some("F1"));
        assert_eq!(code_for_keycode(0x5A), Some("F20"));
        for number in 1..=24 {
            let character = char::from_u32(0xF704 + number - 1).unwrap().to_string();
            assert_eq!(
                code_for_function_character(&character),
                Some(format!("F{number}").as_str())
            );
        }
        assert_eq!(code_for_function_character("\u{f71c}"), None);
    }

    #[test]
    fn preserves_layout_characters_and_marks_dead_keys() {
        assert_eq!(key_for_event("KeyQ", "a"), "a");
        assert_eq!(key_for_event("KeyQ", "A"), "A");
        assert_eq!(key_for_event("KeyE", ""), "Dead");
        assert_eq!(key_for_event("Space", " "), " ");
        assert_eq!(key_for_event("F5", "\u{f708}"), "F5");
    }
}
