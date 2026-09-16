//! Task di build in Rust (`cargo xtask appimage`).
//!
//! Costruisce il binario di release, assembla un AppDir (binario + icona +
//! .desktop) e produce una AppImage con `appimagetool`, scaricato una volta in
//! cache. Nessuno script esterno da lanciare a mano.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const APP_ID: &str = "org.joel.xmind_equation_studio";
const BIN: &str = "xmind-equation-studio";
const APPIMAGE_TOOL_URL: &str =
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage";

fn main() {
    match env::args().nth(1).as_deref() {
        Some("appimage") => appimage(),
        _ => {
            eprintln!("uso: cargo xtask appimage");
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
    let icon256 = appdir.join(format!("usr/share/icons/hicolor/256x256/apps/{APP_ID}.png"));
    let icon512 = appdir.join(format!("usr/share/icons/hicolor/512x512/apps/{APP_ID}.png"));
    for dir in [
        bin_dir.as_path(),
        apps_dir.as_path(),
        icon256.parent().unwrap(),
        icon512.parent().unwrap(),
    ] {
        fs::create_dir_all(dir).expect("creazione AppDir");
    }

    fs::copy(release.join(BIN), bin_dir.join(BIN)).expect("copia binario");
    fs::copy(root.join("assets/icon-256.png"), &icon256).expect("copia icona 256");
    fs::copy(root.join("assets/icon-512.png"), &icon512).expect("copia icona 512");
    fs::copy(root.join("assets/icon-256.png"), appdir.join(format!("{APP_ID}.png"))).unwrap();
    fs::copy(root.join("assets/icon-256.png"), appdir.join(".DirIcon")).unwrap();

    let apprun = appdir.join("AppRun");
    let _ = fs::remove_file(&apprun);
    std::os::unix::fs::symlink(format!("usr/bin/{BIN}"), &apprun).expect("AppRun");

    let desktop = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=XMind Equation Studio\n\
         Comment=Editor di equazioni LaTeX per mappe XMind\n\
         Exec={BIN}\n\
         Icon={APP_ID}\n\
         Categories=Office;\n\
         Terminal=false\n\
         StartupWMClass={APP_ID}\n"
    );
    fs::write(apps_dir.join(format!("{APP_ID}.desktop")), &desktop).unwrap();
    fs::write(appdir.join(format!("{APP_ID}.desktop")), &desktop).unwrap();

    let tool = ensure_appimagetool();
    let dist = root.join("dist");
    fs::create_dir_all(&dist).unwrap();
    let output = dist.join(format!("XMind_Equation_Studio-{version}-x86_64.AppImage"));
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

fn ensure_appimagetool() -> PathBuf {
    let cache = env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        .unwrap_or_else(env::temp_dir)
        .join("xmind-equation-studio");
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
