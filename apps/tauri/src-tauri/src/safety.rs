//! Rilevamento di XMind in esecuzione: porting di `isXmindInvocation`
//! (packages/core/src/safety/process.ts) e di `xmindProcesses`
//! (packages/core/src/node/process.ts). Le due versioni devono restare allineate.

/// Eseguibili della nostra app (AppImage estratta, vecchi nomi): non sono XMind.
const OWN_APP_MARKERS: [&str; 6] = [
    "xmap-studio",
    "xmap studio",
    "xmind-equation-studio",
    "xmind equation studio",
    "xmind-latex",
    "appimage_extracted",
];

const XMIND_FLATPAK_ID: &str = "net.xmind.XMind";

/// Toglie un apice iniziale e uno finale, come `/^["']|["']$/g`.
fn clean_token(token: &str) -> &str {
    let token = token.strip_prefix(['"', '\'']).unwrap_or(token);
    token.strip_suffix(['"', '\'']).unwrap_or(token)
}

fn base_name(token: &str) -> &str {
    match token.rsplit('/').next() {
        Some(name) if !name.is_empty() => name,
        _ => token,
    }
}

fn is_xmind_executable(token: &str) -> bool {
    base_name(token) == "xmind" || token.ends_with("/app/main/xmind")
}

/// Vero se la riga di comando (già divisa in argomenti) avvia XMind.
pub fn is_xmind_invocation(argv: &[String]) -> bool {
    let tokens: Vec<&str> = argv.iter().map(|t| clean_token(t)).filter(|t| !t.is_empty()).collect();
    let Some((exe, args)) = tokens.split_first() else {
        return false;
    };
    let lower_exe = exe.to_lowercase();
    if OWN_APP_MARKERS.iter().any(|marker| lower_exe.contains(marker)) {
        return false;
    }
    if is_xmind_executable(exe) {
        return true;
    }
    match base_name(exe) {
        "flatpak" => args.iter().any(|arg| arg.split("//").next() == Some(XMIND_FLATPAK_ID)),
        "bwrap" => args.iter().any(|arg| is_xmind_executable(arg)),
        _ => false,
    }
}

/// Processi XMind attivi (`"<pid>: <riga di comando>"`). Solo Linux, come la versione Node.
#[cfg(target_os = "linux")]
pub fn xmind_processes() -> Vec<String> {
    let mut found = Vec::new();
    let self_pid = std::process::id();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(|n| n.parse::<u32>().ok()) else {
            continue;
        };
        if pid == self_pid {
            continue;
        }
        // Processo terminato nel frattempo o non leggibile: si salta.
        let Ok(raw) = std::fs::read(entry.path().join("cmdline")) else {
            continue;
        };
        let tokens: Vec<String> = raw
            .split(|b| *b == 0)
            .filter(|part| !part.is_empty())
            .map(|part| String::from_utf8_lossy(part).into_owned())
            .collect();
        if !tokens.is_empty() && is_xmind_invocation(&tokens) {
            let line = tokens.join(" ");
            let shown: String = if line.chars().count() <= 200 {
                line
            } else {
                line.chars().take(200).chain(std::iter::once('…')).collect()
            };
            found.push(format!("{pid}: {shown}"));
        }
    }
    found
}

#[cfg(not(target_os = "linux"))]
pub fn xmind_processes() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::is_xmind_invocation;

    fn argv(line: &str) -> Vec<String> {
        line.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn riconosce_xmind() {
        assert!(is_xmind_invocation(&argv("/opt/Xmind/xmind --no-sandbox")));
        assert!(is_xmind_invocation(&argv("/app/main/xmind")));
        assert!(is_xmind_invocation(&argv("/usr/bin/flatpak run net.xmind.XMind//stable")));
        assert!(is_xmind_invocation(&argv("bwrap --args 1 /app/main/xmind")));
    }

    #[test]
    fn ignora_la_nostra_app_e_gli_altri() {
        assert!(!is_xmind_invocation(&argv("/opt/xmap-studio/xmind")));
        assert!(!is_xmind_invocation(&argv("/usr/bin/vim notes-xmind.txt")));
        assert!(!is_xmind_invocation(&argv("flatpak run org.other.App")));
        assert!(!is_xmind_invocation(&[]));
    }
}
