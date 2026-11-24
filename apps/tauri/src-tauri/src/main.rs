//! Guscio desktop Tauri di XMap Studio (prototipo). Carica la UI compilata di
//! `apps/web` nella WebView di sistema e le inietta `bridge.js`, che espone la
//! stessa `window.electronAPI` del preload Electron: la UI non cambia.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod atomic;
mod safety;

use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const BRIDGE: &str = include_str!("bridge.js");

const WINDOW_WIDTH: f64 = 1200.0;
const WINDOW_HEIGHT: f64 = 800.0;
const MIN_WINDOW_WIDTH: f64 = 720.0;
const MIN_WINDOW_HEIGHT: f64 = 520.0;

/// Stato condiviso tra i comandi.
#[derive(Default)]
struct Shell {
    /// File `.xmind` passato all'avvio: la UI lo chiede una volta sola.
    initial_file: Mutex<Option<String>>,
    /// File scelti dall'utente nei dialoghi di apertura: solo questi si leggono se non sono `.xmind`.
    picked: Mutex<HashSet<PathBuf>>,
    /// Destinazioni scelte nei dialoghi di salvataggio: solo qui si scrivono gli export non `.xmind`.
    save_targets: Mutex<HashSet<PathBuf>>,
    /// Ultimo stato "massimizzata" inviato alla UI.
    maximized: Mutex<bool>,
}

fn has_xmind_extension(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("xmind"))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// `process.platform` di Node, che la UI già conosce.
#[tauri::command]
fn platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

#[tauri::command]
fn initial_file(shell: State<'_, Shell>) -> Option<String> {
    shell.initial_file.lock().ok()?.take()
}

#[tauri::command]
fn xmind_processes() -> Vec<String> {
    safety::xmind_processes()
}

/// Estensioni dei filtri: senza punto iniziale, non vuote; `*` = qualunque file.
fn clean_extensions(extensions: Option<Vec<String>>) -> Vec<String> {
    extensions
        .unwrap_or_default()
        .into_iter()
        .map(|ext| ext.trim().trim_start_matches('.').to_string())
        .filter(|ext| !ext.is_empty())
        .collect()
}

#[tauri::command]
async fn pick_open(
    window: Window,
    shell: State<'_, Shell>,
    description: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let extensions = clean_extensions(extensions);
    let mut dialog = window.dialog().file().set_parent(&window);
    if !extensions.is_empty() && !extensions.iter().any(|ext| ext == "*") {
        let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(description.unwrap_or_else(|| "File".into()), &refs);
    }
    let Some(path) = dialog.blocking_pick_file().and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    if let Ok(mut picked) = shell.picked.lock() {
        picked.insert(path.clone());
    }
    Ok(Some(path_string(&path)))
}

/// Byte di un file: un `.xmind` qualunque (apertura dal file manager) o un file appena scelto nel dialogo.
#[tauri::command]
async fn read_file(shell: State<'_, Shell>, path: String) -> Result<Response, String> {
    let path = PathBuf::from(path);
    let picked = shell.picked.lock().map(|mut set| set.remove(&path)).unwrap_or(false);
    if !path.is_absolute() || !(picked || has_xmind_extension(&path)) || !path.is_file() {
        return Err("File non apribile.".into());
    }
    std::fs::read(&path).map(Response::new).map_err(|err| err.to_string())
}

#[tauri::command]
async fn pick_save(
    window: Window,
    shell: State<'_, Shell>,
    suggested: Option<String>,
    description: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let mut extensions = clean_extensions(extensions);
    if extensions.is_empty() {
        extensions.push("bin".into());
    }
    let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter(description.unwrap_or_else(|| "File".into()), &refs);
    if let Some(name) = suggested.filter(|n| !n.is_empty()) {
        dialog = dialog.set_file_name(name);
    }
    let Some(mut path) = dialog.blocking_save_file().and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    // Il dialogo GTK non aggiunge l'estensione del filtro: si aggiunge qui, chiedendo
    // conferma se il file con l'estensione esiste già (il dialogo non l'ha chiesta).
    if extensions.iter().any(|ext| ext.eq_ignore_ascii_case("xmind")) && !has_xmind_extension(&path) {
        let mut with_ext = path.into_os_string();
        with_ext.push(".xmind");
        path = PathBuf::from(with_ext);
        if path.exists() {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let replace = window
                .dialog()
                .message(format!(
                    "«{name}» esiste già.\nSostituendolo, il contenuto attuale verrà sovrascritto (resta un backup)."
                ))
                .title("Sostituire il file?")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom("Sostituisci".into(), "Annulla".into()))
                .parent(&window)
                .blocking_show();
            if !replace {
                return Ok(None);
            }
        }
    }
    if let Ok(mut targets) = shell.save_targets.lock() {
        targets.insert(path.clone());
    }
    Ok(Some(path_string(&path)))
}

/// Byte grezzi e intestazioni di una richiesta `invoke(cmd, Uint8Array, { headers })`.
fn raw_request<'a>(request: &'a Request<'_>) -> Result<(&'a [u8], PathBuf), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Dati del file non validi: attesi byte.".into());
    };
    let path = header(request, "x-xmap-path").ok_or("Percorso mancante")?;
    Ok((bytes, PathBuf::from(path)))
}

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    let raw = request.headers().get(name)?.to_str().ok()?;
    percent_decode(raw)
}

/// Inverso di `encodeURIComponent`: le intestazioni HTTP accettano solo ASCII.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Controllo strutturale minimo prima di sovrascrivere: la validazione completa
/// (`validateArchiveBytes`) la fa già `prepareArchiveBytes` nella UI, che lancia se fallisce.
fn looks_like_xmind(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04") && bytes.windows(b"content.json".len()).any(|w| w == b"content.json")
}

fn failure(code: &str, message: impl Into<String>) -> Value {
    json!({ "ok": false, "code": code, "message": message.into() })
}

/// Salvataggio sotto guardia (regole 2-4): blocco con XMind aperto salvo `force`,
/// controllo dei byte, scrittura atomica con backup. Stesso esito di `guardedSave`.
#[tauri::command]
async fn save_atomic(request: Request<'_>) -> Result<Value, String> {
    let (bytes, path) = raw_request(&request)?;
    if !path.is_absolute() || !has_xmind_extension(&path) {
        return Ok(failure(
            "invalid_input",
            "Percorso di salvataggio non valido: serve un file .xmind con percorso assoluto.",
        ));
    }
    let force = header(&request, "x-xmap-force").as_deref() == Some("1");
    if !force {
        let running = safety::xmind_processes();
        if !running.is_empty() {
            return Ok(json!({
                "ok": false,
                "code": "xmind_running",
                "message": format!("XMind è in esecuzione ({}). Chiudi XMind o forza il salvataggio.", running.join(", ")),
                "processes": running,
            }));
        }
    }
    if !looks_like_xmind(bytes) {
        return Ok(failure("validation", "I byte da salvare non sono un archivio .xmind valido."));
    }
    let expected = header(&request, "x-xmap-hash").filter(|h| !h.is_empty());
    Ok(match atomic::atomic_write(&path, bytes, expected.as_deref()) {
        Ok(backup) => json!({ "ok": true, "backup": backup.map(|b| path_string(&b)), "bytes": bytes.len() }),
        Err(err) => failure(err.code, err.message),
    })
}

/// Conferma nativa per forzare il salvataggio con XMind aperto. Il `confirm()` sincrono
/// della UI non è affidabile nella WebView di sistema (WebKitGTK risponde sì senza chiedere).
#[tauri::command]
async fn confirm_force_save(window: Window, processes: Vec<String>) -> bool {
    window
        .dialog()
        .message(format!(
            "XMind è in esecuzione ({}). Salvando adesso il file potrebbe essere sovrascritto o corrotto.\n\nForzare il salvataggio?",
            processes.join(", ")
        ))
        .title("XMind è aperto")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Forza il salvataggio".into(), "Annulla".into()))
        .parent(&window)
        .blocking_show()
}

/// Export non `.xmind` (PNG, PDF, Markdown…) verso una destinazione scelta nel dialogo.
#[tauri::command]
async fn write_file(shell: State<'_, Shell>, request: Request<'_>) -> Result<(), String> {
    let (bytes, path) = raw_request(&request)?;
    let allowed = shell.save_targets.lock().map(|mut set| set.remove(&path)).unwrap_or(false);
    if !allowed {
        return Err("Destinazione non scelta nel dialogo di salvataggio.".into());
    }
    std::fs::write(&path, bytes).map_err(|err| err.to_string())
}

#[tauri::command]
fn win_minimize(window: Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn win_toggle_maximize(window: Window) {
    let _ = if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() };
}

/// Chiusura normale: passa da `CloseRequested`, così la UI può chiedere di salvare.
#[tauri::command]
fn win_close(window: Window) {
    let _ = window.close();
}

/// Chiusura confermata dalla UI (nessuna modifica o modifiche scartate).
#[tauri::command]
fn win_force_close(window: Window) {
    let _ = window.destroy();
}

#[tauri::command]
fn win_is_maximized(window: Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn win_start_drag(window: Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn set_zoom(webview: tauri::Webview, factor: f64) {
    if factor.is_finite() && factor > 0.0 {
        let _ = webview.set_zoom(factor);
    }
}

#[tauri::command]
fn debug_info(app: tauri::AppHandle) -> Value {
    json!({
        "platform": platform(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "isPackaged": !cfg!(debug_assertions),
        "execPath": std::env::current_exe().map(|p| path_string(&p)).unwrap_or_default(),
        "userData": app.path().app_data_dir().map(|p| path_string(&p)).unwrap_or_default(),
        "versions": { "tauri": tauri::VERSION, "webview": tauri::webview_version().unwrap_or_default() },
        "mainLog": [],
    })
}

/// Invia un evento al ponte JavaScript della finestra (vedi `__xmapTauri.emit` in bridge.js).
fn emit_to_ui(window: &Window, event: &str, value: Value) {
    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
        let _ = webview.eval(format!("window.__xmapTauri && window.__xmapTauri.emit({}, {value})", json!(event)));
    }
}

/// Primo argomento `.xmind` della riga di comando (apertura dal file manager).
fn initial_file_from_args() -> Option<String> {
    let arg = std::env::args().skip(1).find(|a| has_xmind_extension(Path::new(a)))?;
    let path = std::fs::canonicalize(&arg).unwrap_or_else(|_| PathBuf::from(&arg));
    Some(path_string(&path))
}

fn main() {
    // WebKitGTK con il compositing accelerato su GL software (niente GPU, Xvfb, alcune VM)
    // raddoppia la memoria del processo web: 429 MB contro 217 sulla mappa di prova (apps/tauri/README.md).
    // Si disattiva, salvo scelta esplicita dell'utente. Va fatto prima che parta GTK.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Shell { initial_file: Mutex::new(initial_file_from_args()), ..Shell::default() })
        .invoke_handler(tauri::generate_handler![
            platform,
            initial_file,
            xmind_processes,
            pick_open,
            read_file,
            pick_save,
            save_atomic,
            confirm_force_save,
            write_file,
            win_minimize,
            win_toggle_maximize,
            win_close,
            win_force_close,
            win_is_maximized,
            win_start_drag,
            set_zoom,
            debug_info,
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("XMap Studio")
                .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
                .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
                .decorations(false)
                .initialization_script(BRIDGE)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Decide la UI: chiude con `win_force_close` o chiede di salvare.
                api.prevent_close();
                emit_to_ui(window, "beforeClose", Value::Null);
            }
            WindowEvent::Resized(_) => {
                let now = window.is_maximized().unwrap_or(false);
                let changed = window
                    .state::<Shell>()
                    .maximized
                    .lock()
                    .map(|mut last| std::mem::replace(&mut *last, now) != now)
                    .unwrap_or(false);
                if changed {
                    emit_to_ui(window, "maximized", json!(now));
                }
            }
            WindowEvent::ThemeChanged(theme) => {
                emit_to_ui(window, "theme", json!(matches!(theme, tauri::Theme::Dark)));
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("avvio di XMap Studio non riuscito");
}
