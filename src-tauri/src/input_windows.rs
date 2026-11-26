use std::time::Duration;

use tauri::{Emitter, Manager};
use windows_sys::Win32::{
    Foundation::POINT,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
        WindowsAndMessaging::GetCursorPos,
    },
};

pub fn cursor() -> Option<(f64, f64)> {
    let mut position = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut position) } == 0 {
        return None;
    }
    Some((f64::from(position.x), f64::from(position.y)))
}

fn pressed(key: i32) -> bool {
    unsafe { GetAsyncKeyState(key) < 0 }
}

const LETTERS: [&str; 26] = [
    "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK", "KeyL",
    "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX",
    "KeyY", "KeyZ",
];
const DIGITS: [&str; 10] = [
    "Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8",
    "Digit9",
];

// Codes match the key names consumed by the existing scene.
const SPECIAL_KEYS: &[(i32, &str)] = &[
    (0x08, "Backspace"),
    (0x09, "Tab"),
    (0x0D, "Enter"),
    (0x14, "CapsLock"),
    (0x1B, "Escape"),
    (0x20, "Space"),
    (0x24, "Home"),
    (0x23, "End"),
    (0x21, "PageUp"),
    (0x22, "PageDown"),
    (0x2E, "Delete"),
    (0x25, "ArrowLeft"),
    (0x26, "ArrowUp"),
    (0x27, "ArrowRight"),
    (0x28, "ArrowDown"),
    (0x5B, "MetaLeft"),
    (0x5C, "MetaRight"),
    (0xA0, "ShiftLeft"),
    (0xA1, "ShiftRight"),
    (0xA2, "ControlLeft"),
    (0xA3, "ControlRight"),
    (0xA4, "AltLeft"),
    (0xA5, "AltRight"),
    (0xBA, "Semicolon"),
    (0xBB, "Equal"),
    (0xBC, "Comma"),
    (0xBD, "Minus"),
    (0xBE, "Period"),
    (0xBF, "Slash"),
    (0xC0, "Backquote"),
    (0xDB, "BracketLeft"),
    (0xDC, "Backslash"),
    (0xDD, "BracketRight"),
    (0xDE, "Quote"),
];

pub fn spawn(app: tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    std::thread::spawn(move || {
        let mut keys = (0x41..=0x5A)
            .zip(LETTERS)
            .chain((0x30..=0x39).zip(DIGITS))
            .chain(SPECIAL_KEYS.iter().copied())
            .map(|(key, code)| (key, code, false))
            .collect::<Vec<_>>();
        let mut visible = false;
        let mut last_visibility_check = std::time::Instant::now();

        loop {
            std::thread::sleep(Duration::from_millis(10));
            if last_visibility_check.elapsed() >= Duration::from_millis(100) {
                visible = window.is_visible().unwrap_or(false);
                last_visibility_check = std::time::Instant::now();
            }
            if crate::is_dragging() {
                if !pressed(i32::from(VK_LBUTTON)) {
                    crate::end_window_drag();
                } else if let Some((x, y)) = cursor() {
                    crate::drag_to(x, y);
                }
            }
            let active = visible && crate::input_active();
            for (key, code, was_down) in &mut keys {
                let down = active && pressed(*key);
                if down == *was_down {
                    continue;
                }
                *was_down = down;
                let kind = if down { "keydown" } else { "keyup" };
                let _ = window.emit(
                    "pet:input",
                    serde_json::json!({ "kind": kind, "code": *code }),
                );
            }
        }
    });
}
