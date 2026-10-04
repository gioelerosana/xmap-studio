//! Task di build in Rust (`cargo xtask appimage`, `cargo xtask install`).
//!
//! `appimage` costruisce il binario di release, assembla un AppDir (binario +
//! icona + `.desktop` + tipo MIME) e produce una AppImage con `appimagetool`,
//! scaricato una volta in cache. `install` registra invece binario, `.desktop`
//! e tipo MIME in `~/.local/share` per provare l'associazione `*.xmind` senza
//! rifare l'AppImage. Nessuno script esterno da lanciare a mano.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const APP_ID: &str = "org.joel.xmap_studio";
const BIN: &str = "xmap-studio";
const APPIMAGE_TOOL_URL: &str =
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage";

fn main() {
    match env::args().nth(1).as_deref() {
        Some("appimage") => appimage(),
        Some("install") => install(),
        _ => {
            eprintln!("uso: cargo xtask appimage | cargo xtask install");
            std::process::exit(2);
        }
    }
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("root workspace")
        .to_path_buf()
}

fn appimage() {
    let root = root();
    let version = pkg_version(&root);
    let release = root.join("target/release");

    println!("==> cargo build --release -p {BIN}");
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let ok = Command::new(cargo)
        .args(["build", "--release", "-p", BIN])
        .current_dir(&root)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "build di release fallita");

    let appdir = root.join("target/appimage/AppDir");
    let _ = fs::remove_dir_all(&appdir);

    let bin_dir = appdir.join("usr/bin");
    let apps_dir = appdir.join("usr/share/applications");
    let mime_dir = appdir.join("usr/share/mime/packages");
    let icon256 = appdir.join(format!("usr/share/icons/hicolor/256x256/apps/{APP_ID}.png"));
    let icon512 = appdir.join(format!("usr/share/icons/hicolor/512x512/apps/{APP_ID}.png"));
    for dir in [
        bin_dir.as_path(),
        apps_dir.as_path(),
        mime_dir.as_path(),
        icon256.parent().unwrap(),
        icon512.parent().unwrap(),
    ] {
        fs::create_dir_all(dir).expect("creazione AppDir");
    }

    fs::copy(release.join(BIN), bin_dir.join(BIN)).expect("copia binario");
    fs::copy(root.join("assets/icon-256.png"), &icon256).expect("copia icona 256");
    fs::copy(root.join("assets/icon-512.png"), &icon512).expect("copia icona 512");
    fs::copy(
        root.join("assets/icon-256.png"),
        appdir.join(format!("{APP_ID}.png")),
    )
    .unwrap();
    fs::copy(root.join("assets/icon-256.png"), appdir.join(".DirIcon")).unwrap();
    fs::copy(mime_source(&root), mime_dir.join(format!("{APP_ID}.xml"))).expect("copia tipo MIME");

    let apprun = appdir.join("AppRun");
    let _ = fs::remove_file(&apprun);
    std::os::unix::fs::symlink(format!("usr/bin/{BIN}"), &apprun).expect("AppRun");

    let desktop = desktop_entry(&format!("{BIN} %f"));
    fs::write(apps_dir.join(format!("{APP_ID}.desktop")), &desktop).unwrap();
    fs::write(appdir.join(format!("{APP_ID}.desktop")), &desktop).unwrap();

    let tool = ensure_appimagetool();
    let dist = root.join("dist");
    fs::create_dir_all(&dist).unwrap();
    let output = dist.join(format!("XMap_Studio-{version}-x86_64.AppImage"));
    let _ = fs::remove_file(&output);

    println!("==> appimagetool");
    let run = |extra: &[(&str, &str)]| {
        let mut cmd = Command::new(&tool);
        cmd.arg(&appdir).arg(&output).arg("--no-appstream");
        cmd.env("ARCH", "x86_64");
        for (key, value) in extra {
            cmd.env(key, value);
        }
        cmd.status().map(|s| s.success()).unwrap_or(false)
    };
    let ok = run(&[]) || run(&[("APPIMAGE_EXTRACT_AND_RUN", "1")]);
    assert!(ok, "appimagetool è fallito");

    let size = fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    println!(
        "\nAppImage pronta: {}\n  {:.1} MB",
        output.display(),
        size as f64 / 1_048_576.0
    );
}

/// `.desktop` condiviso tra AppDir e installazione locale. `exec` include già
/// il segnaposto `%f` per i file aperti dal file manager.
fn desktop_entry(exec: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=XMap Studio\n\
         Comment=Companion desktop per mappe XMind: equazioni LaTeX ed editing avanzato\n\
         Exec={exec}\n\
         Icon={APP_ID}\n\
         Categories=Office;\n\
         MimeType=application/xmind;\n\
         Terminal=false\n\
         StartupWMClass={APP_ID}\n"
    )
}

fn mime_source(root: &Path) -> PathBuf {
    root.join(format!("assets/{APP_ID}.xml"))
}

/// Registra binario, `.desktop` e tipo MIME in `~/.local/share` per provare
/// l'apertura dei `*.xmind` dal file manager senza produrre l'AppImage.
///
/// Non imposta l'app come predefinita per `application/xmind`: la scelta resta
/// dell'utente. Il comando da eseguire viene stampato a fine installazione.
fn install() {
    let root = root();
    println!("==> cargo build --release -p {BIN}");
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let ok = Command::new(cargo)
        .args(["build", "--release", "-p", BIN])
        .current_dir(&root)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "build di release fallita");

    let data = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    let apps_dir = data.join("applications");
    let mime_dir = data.join("mime/packages");
    fs::create_dir_all(&apps_dir).expect("cartella applications");
    fs::create_dir_all(&mime_dir).expect("cartella mime/packages");

    let bin_path = root.join("target/release").join(BIN);
    let exec = format!("\"{}\" %f", bin_path.display());
    fs::write(
        apps_dir.join(format!("{APP_ID}.desktop")),
        desktop_entry(&exec),
    )
    .expect("scrivo .desktop");
    fs::copy(mime_source(&root), mime_dir.join(format!("{APP_ID}.xml"))).expect("scrivo tipo MIME");

    for (cmd, args) in [
        ("update-mime-database", vec![data.join("mime")]),
        ("update-desktop-database", vec![apps_dir.clone()]),
    ] {
        let _ = Command::new(cmd).args(&args).status();
    }

    println!(
        "\nRegistrato:\n  {}\n  {}\n\nPer aprirla come predefinita per i .xmind:\n  xdg-mime default {APP_ID}.desktop application/xmind\n(oppure tasto destro → Apri con…)",
        apps_dir.join(format!("{APP_ID}.desktop")).display(),
        mime_dir.join(format!("{APP_ID}.xml")).display(),
    );
}

fn ensure_appimagetool() -> PathBuf {
    let cache = env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        .unwrap_or_else(env::temp_dir)
        .join("xmap-studio");
    fs::create_dir_all(&cache).expect("cache appimagetool");
    let tool = cache.join("appimagetool-x86_64.AppImage");
    if tool.is_file() {
        return tool;
    }

    println!("==> scarico appimagetool in {}", tool.display());
    let ok = Command::new("curl")
        .args(["-L", "--fail", "--silent", "--show-error", "-o"])
        .arg(&tool)
        .arg(APPIMAGE_TOOL_URL)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "download di appimagetool fallito");

    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).expect("chmod appimagetool");
    tool
}

fn pkg_version(root: &Path) -> String {
    let manifest = fs::read_to_string(root.join("src-tauri/Cargo.toml")).unwrap_or_default();
    manifest
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("version")
                .and_then(|rest| rest.trim_start().strip_prefix('='))
                .map(|value| value.trim().trim_matches('"').to_string())
        })
        .unwrap_or_else(|| "0.0.0".to_string())
}
