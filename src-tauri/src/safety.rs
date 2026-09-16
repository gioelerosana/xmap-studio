//! Sicurezza dei dati: XMind aperto e conflitti su disco.
//!
//! Se XMind è aperto, tiene una cache del workbook e al salvataggio sovrascrive
//! il nostro file. Quindi il salvataggio va BLOCCATO (non solo avvisato).

use std::path::Path;

/// Rileva processi XMind in esecuzione leggendo `/proc` (Linux).
///
/// Riconosce sia il pacchetto Flatpak (`/app/main/xmind`, `net.xmind.XMind`)
/// sia un'eventuale build AppImage/deb. Esclude sé stesso e i propri figli.
pub fn xmind_processes() -> Vec<String> {
    let mut found = Vec::new();
    let self_pid = std::process::id();
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in dir.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Ok(pid) = name.parse::<u32>() else {
            continue;
        };
        if pid == self_pid {
            continue;
        }
        let cmdline_path = entry.path().join("cmdline");
        let Ok(raw) = std::fs::read(&cmdline_path) else {
            continue;
        };
        let cmdline = raw
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).to_string())
            .collect::<Vec<_>>();
        if cmdline.is_empty() {
            continue;
        }
        let joined = cmdline.join(" ");
        if is_xmind_invocation(&joined) {
            found.push(format!("{pid}: {}", truncate(&joined, 200)));
        }
    }
    found
}

fn is_xmind_invocation(cmdline: &str) -> bool {
    // La nostra app non conta: né il binario, né il bundle AppImage, né la
    // cartella di progetto. Il confronto è case-insensitive perché il percorso
    // può contenere "xmind-LaTeX" o "XMind Equation Studio".
    let lower = cmdline.to_ascii_lowercase();
    if lower.contains("xmind-equation-studio")
        || lower.contains("xmind-latex")
        || lower.contains("xmind equation studio")
        || lower.contains("appimage_extracted")
    {
        return false;
    }

    cmdline.split_whitespace().any(|tok| {
        let tok = tok.trim_matches('"');
        let base = tok.rsplit('/').next().unwrap_or(tok);
        // Nome eseguibile ESATTO e minuscolo di XMind ("xmind"), non qualsiasi
        // token che finisce in "XMind" (es. il nome della nostra AppImage).
        base == "xmind"
            || tok.ends_with("/app/main/xmind")
            || tok.contains("net.xmind.XMind")
    })
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

/// True se il file su disco è cambiato rispetto all'apertura.
pub fn has_conflict(path: &Path, opened_hash: &str) -> bool {
    match crate::archive::hash_file(path) {
        Ok(h) => h != opened_hash,
        // File rimosso/spostato → consideralo comunque un conflitto.
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_is_not_flagged() {
        // Il binario in test contiene "xmind-equation-studio" nel path.
        let cmd = "/home/u/progetti/xmind-LaTeX/src-tauri/target/debug/xmind-equation-studio";
        assert!(!is_xmind_invocation(cmd));
    }

    #[test]
    fn flatpak_xmind_is_flagged() {
        assert!(is_xmind_invocation(
            "/app/main/xmind --enable-features=Foo"
        ));
        assert!(is_xmind_invocation(
            "bwrap --args 34 /app/main/xmind /some/file.xmind"
        ));
        assert!(is_xmind_invocation(
            "/usr/bin/flatpak run net.xmind.XMind"
        ));
    }

    #[test]
    fn unrelated_processes_are_ignored() {
        assert!(!is_xmind_invocation("/usr/bin/node gen.mjs"));
        assert!(!is_xmind_invocation("/usr/lib/firefox/firefox"));
    }

    #[test]
    fn our_own_appimage_is_not_xmind() {
        // Falso positivo reale: il percorso, spezzato sugli spazi, produce il
        // token ".../appimage/XMind" che NON deve essere scambiato per XMind.
        assert!(!is_xmind_invocation(
            "/home/joel/progetti/xmind-LaTeX/src-tauri/target/release/bundle/appimage/XMind Equation Studio_0.1.0_amd64.AppImage"
        ));
        assert!(!is_xmind_invocation(
            "/tmp/appimage_extracted_abc/AppRun --foo"
        ));
        assert!(!is_xmind_invocation(
            "/home/joel/progetti/xmind-LaTeX/node_modules/.bin/vite"
        ));
    }

    #[test]
    fn conflict_detected_on_change() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.xmind");
        std::fs::write(&p, b"v1").unwrap();
        let h = crate::archive::hash_file(&p).unwrap();
        assert!(!has_conflict(&p, &h));
        std::fs::write(&p, b"v2").unwrap();
        assert!(has_conflict(&p, &h));
    }
}
