// 桌面桌宠的宿主：一个透明、置顶、无边框的小窗口。
//
// 关键点：
// 1. 窗口默认「鼠标穿透」，只有指针落在猫（或气泡）的实际矩形里才接收事件，
//    否则会把桌面上的点击吞掉；命中矩形由前端通过 set_hit_rect 上报。
// 2. 托盘负责显示/隐藏与退出，避免桌宠没有可点的地方时无法关闭。
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[path = "input_windows.rs"]
mod input;
mod platform;

use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[derive(Clone, Copy, Debug, Serialize, serde::Deserialize)]
struct HitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct PetState {
    hit: Mutex<Option<HitRect>>,
    // 桌宠当前外观/选项的 JSON 快照，供网页端通过本机桥读取，做到两端一致。
    config: Mutex<Option<String>>,
    // 实时通道是否真的连上了（有令牌≠有效，前端连上后再回填）。
    connected: Mutex<bool>,
}

impl PetState {
    fn new() -> Self {
        Self {
            hit: Mutex::new(None),
            config: Mutex::new(None),
            connected: Mutex::new(false),
        }
    }
}

/// 桌宠窗口的拖动由宿主自己做：命中矩形只有猫那么大，一旦用系统的
/// `startDragging`，指针拖出猫的范围就会触发「鼠标穿透」把拖动掐断，
/// 表现就是拖到一半碰到空气墙。这里改成监听全局左键，按位移移动窗口。
struct DragState {
    start_cursor: (f64, f64),
    start_origin: (i32, i32),
    last_sent: (i32, i32),
}

static DRAG: Mutex<Option<DragState>> = Mutex::new(None);
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub fn is_dragging() -> bool {
    DRAG.lock().map(|drag| drag.is_some()).unwrap_or(false)
}

pub fn end_window_drag() {
    if let Ok(mut drag) = DRAG.lock() {
        if drag.is_some() {
            eprintln!("[drag] end");
        }
        *drag = None;
    }
}

fn point_inside_hit_rect(app: &tauri::AppHandle, cx: f64, cy: f64) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let state = app.state::<PetState>();
    let rect = state.hit.lock().ok().and_then(|hit| *hit);
    let Some(rect) = rect else {
        return false;
    };
    let (Ok(position), Ok(scale)) = (window.outer_position(), window.scale_factor()) else {
        return false;
    };
    let left = position.x as f64 + rect.x * scale;
    let top = position.y as f64 + rect.y * scale;
    cx >= left && cx <= left + rect.width * scale && cy >= top && cy <= top + rect.height * scale
}

#[tauri::command]
fn begin_windows_drag(window: WebviewWindow) {
    if window.label() == "main" {
        if let Some((x, y)) = input::cursor() {
            maybe_begin_window_drag(x, y);
        }
    }
}

pub fn maybe_begin_window_drag(cx: f64, cy: f64) {
    let Some(app) = APP_HANDLE.get() else { return };
    if !point_inside_hit_rect(app, cx, cy) {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let Ok(position) = window.outer_position() else {
        return;
    };
    eprintln!("[drag] start at {cx:.0},{cy:.0}");
    if let Ok(mut drag) = DRAG.lock() {
        *drag = Some(DragState {
            start_cursor: (cx, cy),
            start_origin: (position.x, position.y),
            last_sent: (position.x, position.y),
        });
    }
}

pub fn drag_to(cx: f64, cy: f64) {
    let target = {
        let Ok(mut guard) = DRAG.lock() else { return };
        let Some(drag) = guard.as_mut() else { return };
        // Windows 光标与窗口位置均使用物理像素。
        let dx = (cx - drag.start_cursor.0).round() as i32;
        let dy = (cy - drag.start_cursor.1).round() as i32;
        let target = (drag.start_origin.0 + dx, drag.start_origin.1 + dy);
        // 每次 mouseMoved 都走主线程会排队卡顿，位移小于 2 物理像素就不发。
        if (target.0 - drag.last_sent.0).abs() < 2 && (target.1 - drag.last_sent.1).abs() < 2 {
            return;
        }
        drag.last_sent = target;
        eprintln!(
            "[drag] pos {}x{} cursor {:.0},{:.0}",
            target.0, target.1, cx, cy
        );
        target
    };
    let Some(app) = APP_HANDLE.get() else { return };
    let handle = app.clone();
    let inner = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(window) = inner.get_webview_window("main") {
            let _ = window.set_position(PhysicalPosition::new(target.0, target.1));
        }
    });
}

/// 前端上报「猫 + 气泡」的合并矩形（窗口内逻辑像素），用于鼠标穿透判定。
#[tauri::command]
fn set_hit_rect(state: tauri::State<'_, PetState>, x: f64, y: f64, width: f64, height: f64) {
    if let Ok(mut hit) = state.hit.lock() {
        *hit = if width > 0.0 && height > 0.0 {
            Some(HitRect {
                x,
                y,
                width,
                height,
            })
        } else {
            None
        };
    }
}

/// 宿主推送一条气泡消息（平台通知 / 员工聊天 / AI 回复都走这里）。
#[tauri::command]
fn debug_log(line: String) {
    eprintln!("[ui] {line}");
}

fn place_bottom_right(window: &WebviewWindow) {
    let Some(monitor) = window.current_monitor().ok().flatten() else {
        return;
    };
    // 用工作区而不是整屏：菜单栏、Dock 会让整屏高度偏大，桌宠会有一截压在屏幕外。
    let area = monitor.work_area();
    let window_size = window
        .outer_size()
        .unwrap_or(tauri::PhysicalSize::new(460, 414));

    let x = area.position.x as i64 + area.size.width as i64 - window_size.width as i64;
    let y = area.position.y as i64 + area.size.height as i64 - window_size.height as i64;
    let _ = window.set_position(PhysicalPosition::new(
        x.max(0) as i32,
        y.max(area.position.y as i64) as i32,
    ));
}

// 比较命中区域时，把 Windows 物理像素换算成 WebView 的逻辑像素。
fn cursor_point(window: &WebviewWindow) -> Option<(f64, f64)> {
    if let Some((x, y)) = input::cursor() {
        let factor = window.scale_factor().ok()?;
        return Some((x / factor, y / factor));
    }
    // Windows API 取不到位置时，尝试通过窗口接口读取。
    let cursor = window.cursor_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some((cursor.x / scale, cursor.y / scale))
}

fn cursor_inside(window: &WebviewWindow, rect: HitRect) -> bool {
    let Some((cx, cy)) = cursor_point(window) else {
        return false;
    };
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(scale) = window.scale_factor() else {
        return false;
    };
    let left = position.x as f64 / scale + rect.x;
    let top = position.y as f64 / scale + rect.y;
    cx >= left && cx <= left + rect.width && cy >= top && cy <= top + rect.height
}

fn spawn_hit_test(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_cursor: Option<(f64, f64)> = None;
        let mut last_ignore: Option<bool> = None;
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) {
                if last_ignore != Some(true) {
                    let _ = window.set_ignore_cursor_events(true);
                    last_ignore = Some(true);
                }
                last_cursor = None;
                continue;
            }
            let state = app.state::<PetState>();
            let rect = state.hit.lock().ok().and_then(|hit| *hit);
            let inside = rect.map(|r| cursor_inside(&window, r)).unwrap_or(false);
            // 拖动中不切换穿透，否则指针离开猫的范围时窗口会收不到后续事件。
            let dragging = is_dragging();
            if !dragging && Some(!inside) != last_ignore {
                eprintln!("[hit] ignore={} cursor_inside={}", !inside, inside);
                last_ignore = Some(!inside);
                let _ = window.set_ignore_cursor_events(!inside);
            }

            // 指针在命中矩形外时窗口不接收事件，桌面版必须自己把光标位置喂给场景，
            // 否则猫不会跟随光标、也不会被"逗"起来；矩形内由系统正常派发，避免重复。
            // 无论是否在命中区内都转发光标：窗口不是 key window 时系统不一定
            // 派发 mouseMoved，没有这层转发就会出现"先点一下才 hover"。
            if let (Some((cx, cy)), Ok(position), Ok(scale)) = (
                cursor_point(&window),
                window.outer_position(),
                window.scale_factor(),
            ) {
                let x = cx - position.x as f64 / scale;
                let y = cy - position.y as f64 / scale;
                let delta = last_cursor
                    .map(|(px, py)| (x - px, y - py))
                    .unwrap_or((0.0, 0.0));
                last_cursor = Some((x, y));
                let _ = window.emit(
                    "pet:input",
                    serde_json::json!({ "kind": "mousemove", "x": x, "y": y, "dx": delta.0, "dy": delta.1 }),
                );
            }
        }
    });
}

const BRIDGE_PORT: u16 = 47821;

fn visibility_path(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(app.path().app_config_dir()?.join("visibility"))
}

fn restore_visibility(app: &tauri::AppHandle) -> bool {
    visibility_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map_or(true, |value| value.trim() != "hidden")
}

fn pet_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "missing pet window".into())
}

fn set_pet_visibility(window: &WebviewWindow, visible: bool) -> Result<bool, String> {
    if visible {
        window.show()
    } else {
        end_window_drag();
        window.hide()
    }
    .map_err(|error| error.to_string())?;
    let actual = window.is_visible().map_err(|error| error.to_string())?;
    if actual != visible {
        return Err("pet window visibility did not change".into());
    }
    if let Err(error) = (|| {
        let path = visibility_path(window.app_handle())?;
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory)?;
        }
        std::fs::write(path, if visible { "visible" } else { "hidden" })?;
        Ok::<_, tauri::Error>(())
    })() {
        eprintln!("saving desktop pet visibility failed: {error}");
    }
    Ok(actual)
}

#[tauri::command]
fn toggle_visible(app: tauri::AppHandle) -> Result<bool, String> {
    let window = pet_window(&app)?;
    let visible = window.is_visible().map_err(|error| error.to_string())?;
    set_pet_visibility(&window, !visible)
}

/// 首次挂载或调整桌宠大小时，按比例给气泡预留空间。
#[tauri::command]
fn set_window_height(window: WebviewWindow, height: f64) {
    if !height.is_finite() || window.label() != "main" {
        return;
    }
    let height = height.clamp(120.0, 900.0);
    resize_window_bottom_aligned(window, height);
}

fn resize_window_bottom_aligned(window: WebviewWindow, height: f64) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let old_h = size.height as f64 / scale;
    let new_h = height;
    if (new_h - old_h).abs() < 4.0 {
        return;
    }
    let dy = ((old_h - new_h) * scale).round() as i32;
    let mut y = pos.y + dy;
    // 底边贴住工作区：窗口长高长矮都只动上沿，但绝不让猫被屏幕底部切掉。
    if let Ok(Some(monitor)) = window.current_monitor() {
        let area = monitor.work_area();
        let max_bottom = area.position.y + area.size.height as i32;
        let bottom = y + (new_h * scale).round() as i32;
        if bottom > max_bottom {
            y -= bottom - max_bottom;
        }
    }
    if let Ok(hwnd) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
        };
        unsafe {
            SetWindowPos(
                hwnd.0,
                std::ptr::null_mut(),
                pos.x,
                y,
                size.width as i32,
                (new_h * scale).round() as i32,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
    }
}

fn default_platform_url() -> String {
    std::env::var("SZKJ_PET_LOGIN_URL").unwrap_or_else(|_| {
        if production_build() {
            "https://zjshuzhi.cn:9435/"
        } else {
            "https://zjshuzhi.cn:7936/"
        }
        .into()
    })
}

#[tauri::command]
async fn open_platform(
    window: WebviewWindow,
    conversation_id: Option<String>,
    contact_id: Option<String>,
    notifications: Option<bool>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("platform launcher is available only in the pet window".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        platform::open(
            &default_platform_url(),
            conversation_id,
            contact_id,
            notifications.unwrap_or(false),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn reset_position(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        place_bottom_right(&window);
    }
}

#[tauri::command]
fn set_login_state(app: tauri::AppHandle, connected: bool) {
    if let Ok(mut slot) = app.state::<PetState>().connected.lock() {
        *slot = connected;
    }
}

#[tauri::command]
fn set_config_cache(app: tauri::AppHandle, config: String) {
    if let Ok(mut slot) = app.state::<PetState>().config.lock() {
        *slot = Some(config);
    }
}

fn http_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

/// 网页端 ↔ 桌宠的本机桥：127.0.0.1:47821。
///
/// 网页用 https 打开时，浏览器把 localhost 视为安全源，可以直接 fetch；
/// 这样浏览器里登录后能把令牌交给桌宠、桌宠也能告诉网页"我已经在了"，
/// 不需要在服务端加新接口。
fn production_build() -> bool {
    option_env!("SZKJ_PET_ENV") == Some("production")
}

fn platform_origin_allowed(origin: &str) -> bool {
    if production_build() {
        origin == "https://zjshuzhi.cn:9435"
    } else {
        matches!(
            origin,
            "https://zjshuzhi.cn:7936" | "http://localhost:5173" | "http://127.0.0.1:5173"
        )
    }
}

fn origin_allowed(request: &str) -> bool {
    request
        .lines()
        .skip(1)
        .take_while(|line| !line.is_empty())
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("origin").then_some(value.trim())
        })
        .map_or(true, platform_origin_allowed)
}

fn spawn_bridge(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let listener = match std::net::TcpListener::bind(("127.0.0.1", BRIDGE_PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("desktop bridge bind failed on {BRIDGE_PORT}: {error}");
                return;
            }
        };
        eprintln!("desktop bridge listening on {BRIDGE_PORT}");
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buffer = vec![0u8; 8192];
                let mut read = 0usize;
                loop {
                    match stream.read(&mut buffer[read..]) {
                        Ok(0) => break,
                        Ok(n) => {
                            read += n;
                            let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                            if text.contains("\r\n\r\n") {
                                if let Some(length) = text
                                    .lines()
                                    .find_map(|line| line.strip_prefix("content-length: "))
                                    .or_else(|| {
                                        text.lines()
                                            .find_map(|line| line.strip_prefix("Content-Length: "))
                                    })
                                {
                                    let length: usize = length.trim().parse().unwrap_or(0);
                                    if let Some(index) = text.find("\r\n\r\n") {
                                        if read >= index + 4 + length {
                                            break;
                                        }
                                    }
                                } else {
                                    break;
                                }
                            }
                            if read >= buffer.len() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                let mut lines = request.lines();
                let request_line = lines.next().unwrap_or("");
                let method = request_line.split_whitespace().next().unwrap_or("");
                let path = request_line.split_whitespace().nth(1).unwrap_or("/");
                let body = request
                    .split("\r\n\r\n")
                    .nth(1)
                    .unwrap_or("")
                    .trim()
                    .to_string();

                if !origin_allowed(&request) {
                    // 网页只向对应环境的桌宠同步会话。
                    http_response(
                        &mut stream,
                        "403 Forbidden",
                        "{\"error\":\"origin not allowed\"}",
                    );
                    return;
                }

                if method == "OPTIONS" {
                    http_response(&mut stream, "204 No Content", "");
                    return;
                }

                if path == "/status" && method == "GET" {
                    let visible = pet_window(&app)
                        .ok()
                        .and_then(|window| window.is_visible().ok());
                    let has_token = read_token(app.clone()).is_some();
                    let connected = app
                        .state::<PetState>()
                        .connected
                        .lock()
                        .map(|slot| *slot)
                        .unwrap_or(false);
                    let logged_in = has_token && connected;
                    let config = app
                        .state::<PetState>()
                        .config
                        .lock()
                        .ok()
                        .and_then(|slot| slot.clone());
                    let payload = serde_json::json!({
                        "desktop": true,
                        "visible": visible,
                        "loggedIn": logged_in,
                        "hasSession": has_token,
                        "config": config.and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok()),
                    });
                    http_response(&mut stream, "200 OK", &payload.to_string());
                    return;
                }

                if path == "/visibility" && method == "POST" {
                    let requested = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|payload| payload.get("visible")?.as_bool());
                    let Some(visible) = requested else {
                        http_response(
                            &mut stream,
                            "400 Bad Request",
                            "{\"error\":\"expected boolean visibility\"}",
                        );
                        return;
                    };
                    let result = pet_window(&app).and_then(|window| {
                        let (sender, receiver) = std::sync::mpsc::channel();
                        app.run_on_main_thread(move || {
                            let _ = sender.send(set_pet_visibility(&window, visible));
                        })
                        .map_err(|error| error.to_string())?;
                        receiver
                            .recv_timeout(Duration::from_secs(2))
                            .map_err(|error| error.to_string())?
                    });
                    match result {
                        Ok(actual) => {
                            let payload = serde_json::json!({ "ok": true, "visible": actual });
                            http_response(&mut stream, "200 OK", &payload.to_string());
                        }
                        Err(error) => {
                            eprintln!("desktop pet visibility update failed: {error}");
                            http_response(
                                &mut stream,
                                "503 Service Unavailable",
                                "{\"error\":\"window unavailable\"}",
                            );
                        }
                    }
                    return;
                }

                if path == "/token" && method == "POST" {
                    let token = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|value| {
                            value
                                .get("token")
                                .and_then(|v| v.as_str())
                                .map(str::to_string)
                        })
                        .unwrap_or_else(|| body.clone());
                    let token = token.trim().trim_matches('"').to_string();
                    if token.is_empty() {
                        http_response(
                            &mut stream,
                            "400 Bad Request",
                            "{\"error\":\"empty token\"}",
                        );
                        return;
                    }
                    if read_token(app.clone()).as_deref() == Some(token.as_str()) {
                        http_response(&mut stream, "200 OK", "{\"ok\":true}");
                        return;
                    }
                    if save_token(app.clone(), token.clone()).is_err() {
                        http_response(
                            &mut stream,
                            "500 Internal Server Error",
                            "{\"error\":\"token persistence failed\"}",
                        );
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("pet:token", token);
                    }
                    http_response(&mut stream, "200 OK", "{\"ok\":true}");
                    return;
                }

                // 显式退出登录时同步清理桌宠会话。
                if path == "/logout" && method == "POST" {
                    if let Some(file) = token_path(&app) {
                        let _ = std::fs::remove_file(file);
                    }
                    if let Ok(mut slot) = app.state::<PetState>().connected.lock() {
                        *slot = false;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("pet:logout", "");
                    }
                    http_response(&mut stream, "200 OK", "{\"ok\":true}");
                    return;
                }

                if path == "/config" && method == "POST" {
                    if let Ok(mut slot) = app.state::<PetState>().config.lock() {
                        *slot = Some(body.clone());
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("pet:remote-config", body);
                    }
                    http_response(&mut stream, "200 OK", "{\"ok\":true}");
                    return;
                }

                http_response(
                    &mut stream,
                    "404 Not Found",
                    "{\"error\":\"unknown endpoint\"}",
                );
            });
        }
    });
}

fn token_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let file = if production_build() {
        "access-token-production"
    } else {
        "access-token"
    };
    app.path().app_config_dir().ok().map(|dir| dir.join(file))
}

/// 桌面端自己保存一份令牌，重启后自动连接，不用每次粘贴。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 清除本地令牌：页面登出、令牌失效时都要把宿主里的副本一起清掉，否则重启后又会“自己登录”。
#[tauri::command]
fn clear_token(app: tauri::AppHandle) {
    if let Some(path) = token_path(&app) {
        let _ = std::fs::remove_file(path);
    }
    if let Ok(mut slot) = app.state::<PetState>().connected.lock() {
        *slot = false;
    }
}

#[tauri::command]
fn read_token(app: tauri::AppHandle) -> Option<String> {
    let path = token_path(&app)?;
    let token = std::fs::read_to_string(path).ok()?;
    let token = token.trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

#[tauri::command]
fn save_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let path = token_path(&app).ok_or_else(|| "no app config dir".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, token.trim()).map_err(|error| error.to_string())?;
    Ok(())
}

fn percent_decode(text: &str) -> String {
    let mut out = String::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(value as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// 打开平台登录页，用它自己的登录流程拿到 accessToken。
///
/// 页面登录成功后，注入的脚本每 0.5 秒读一次 localStorage，发现令牌就把页面
/// 导航到本机回环地址（127.0.0.1 的临时端口）；回环服务收到令牌后落盘、
/// 推给桌宠窗口并关掉登录窗。这样既不用手动粘贴，也不碰密码。
#[tauri::command]
fn open_login(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("login") {
        let _ = window.set_focus();
        return Ok(());
    }

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let app_for_server = app.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            if started.elapsed() > Duration::from_secs(600) {
                return;
            }
            match listener.accept() {
                Ok((mut stream, _peer)) => {
                    let mut buffer = [0u8; 4096];
                    let _ = stream.read(&mut buffer);
                    let request = String::from_utf8_lossy(&buffer).to_string();
                    let line = request.lines().next().unwrap_or("");
                    let path = line.split_whitespace().nth(1).unwrap_or("");
                    let token = path
                        .split("token=")
                        .nth(1)
                        .and_then(|rest| rest.split('&').next())
                        .map(percent_decode)
                        .unwrap_or_default();
                    let body = if token.is_empty() {
                        "<meta charset=utf-8><p>登录未完成，回到桌宠重试。</p>"
                    } else {
                        let _ = save_token(app_for_server.clone(), token.clone());
                        if let Some(window) = app_for_server.get_webview_window("main") {
                            let _ = window.emit("pet:token", token);
                        }
                        if let Some(window) = app_for_server.get_webview_window("login") {
                            let _ = window.close();
                        }
                        "<meta charset=utf-8><p>已连接管理中心，这个窗口可以关掉了。</p>"
                    };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.as_bytes().len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => return,
            }
        }
    });

    let login_url = default_platform_url();
    let target: url::Url = login_url
        .parse()
        .map_err(|error: url::ParseError| error.to_string())?;
    if !platform_origin_allowed(&target.origin().ascii_serialization()) {
        return Err("login origin does not match desktop environment".into());
    }

    // 页面登录/刷新都会重新注入，令牌出现在 localStorage 时跳回本机回调。
    let probe_script = format!(
        r#"(function() {{
  if (window.__szkjPetTokenProbe) return;
  window.__szkjPetTokenProbe = true;
  var send = function(token) {{
    try {{ window.location.href = 'http://127.0.0.1:{port}/token?token=' + encodeURIComponent(token); }} catch (e) {{}}
  }};
  setInterval(function() {{
    try {{
      var token = localStorage.getItem('accessToken');
      if (token && token.length > 20) send(token);
    }} catch (e) {{}}
  }}, 500);
}})();"#,
        port = port
    );

    WebviewWindowBuilder::new(&app, "login", WebviewUrl::External(target))
        .title("登录管理中心")
        .inner_size(1080.0, 760.0)
        .center()
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = window.eval(&probe_script);
            }
        })
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let login = MenuItem::with_id(app, "login", "登录 / 重新登录", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &login])?;
    menu.append(&quit)?;

    let mut builder = TrayIconBuilder::with_id("pet-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                let _ = toggle_visible(app.clone());
            }
            "login" => {
                let _ = open_login(app.clone());
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn is_show_pet_url(address: &str) -> bool {
    url::Url::parse(address).is_ok_and(|target| {
        target.scheme() == "szkj-pet"
            && target.host_str() == Some("show")
            && matches!(target.path(), "" | "/")
            && target.username().is_empty()
            && target.password().is_none()
            && target.port().is_none()
            && target.query().is_none()
            && target.fragment().is_none()
    })
}

fn show_from_windows_launch(app: &tauri::AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = pet_window(&handle).and_then(|window| set_pet_visibility(&window, true))
        {
            eprintln!("opening desktop pet from browser failed: {error}");
        }
    });
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.len() == 1 || args.iter().skip(1).any(|arg| is_show_pet_url(arg)) {
                show_from_windows_launch(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init());

    builder
        .plugin(tauri_plugin_http::init())
        .manage(PetState::new())
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            begin_windows_drag,
            debug_log,
            read_token,
            save_token,
            clear_token,
            open_login,
            quit_app,
            set_config_cache,
            set_login_state,
            reset_position,
            toggle_visible,
            set_window_height,
            open_platform
        ])
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_ignore_cursor_events(true);
                let _ = window.set_always_on_top(true);
                place_bottom_right(&window);
                let show_from_url = std::env::args().skip(1).any(|arg| is_show_pet_url(&arg));
                if show_from_url {
                    set_pet_visibility(&window, true).map_err(std::io::Error::other)?;
                } else if restore_visibility(app.handle()) {
                    window.show()?;
                }
            }
            build_tray(app.handle())?;
            spawn_hit_test(app.handle().clone());
            input::spawn(app.handle().clone());
            spawn_bridge(app.handle().clone());
            if std::env::var("PET_MENU_DEMO").is_ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.emit("pet:demo-menu", ());
                    }
                });
            }
            // 调试用：PET_AUTO_LOGIN=1 时启动即弹登录页，便于无人值守验证。
            if std::env::var("PET_AUTO_LOGIN").is_ok() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = open_login(handle) {
                        eprintln!("open_login failed: {error}");
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {});
}
