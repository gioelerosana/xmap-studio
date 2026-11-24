//! Scrittura atomica del `.xmind`: porting di `atomicWrite`
//! (packages/core/src/node/atomic.ts, regola 2 di AGENTS.md). Temp nella stessa
//! cartella → fsync → backup datato in `.xmap-studio/backups/` (ultimi 5) →
//! rename → fsync della cartella. Le due versioni devono restare allineate.

use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BACKUPS: usize = 5;
const BACKUP_DIR: &str = ".xmap-studio/backups";

/// Errore con il codice di `packages/core/src/errors.ts` (`io`, `conflict`, …).
#[derive(Debug)]
pub struct SaveError {
    pub code: &'static str,
    pub message: String,
}

impl SaveError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl From<std::io::Error> for SaveError {
    fn from(err: std::io::Error) -> Self {
        SaveError::new("io", err.to_string())
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Percorso reale di `target` se è un collegamento simbolico esistente; altrimenti `target`.
fn resolve_symlink(target: &Path) -> PathBuf {
    match fs::symlink_metadata(target) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf()),
        _ => target.to_path_buf(),
    }
}

/// Scrive `bytes` su `target` in modo atomico. Restituisce il percorso del backup, se creato.
pub fn atomic_write(target: &Path, bytes: &[u8], expected_hash: Option<&str>) -> Result<Option<PathBuf>, SaveError> {
    let resolved = resolve_symlink(target);
    let dir = resolved
        .parent()
        .ok_or_else(|| SaveError::new("io", "Percorso di salvataggio senza cartella"))?
        .to_path_buf();
    if !dir.is_dir() {
        return Err(SaveError::new("io", format!("La cartella {} non esiste", dir.display())));
    }

    if let Some(expected) = expected_hash {
        if !resolved.exists() {
            return Err(SaveError::new("conflict", "Il file è cambiato o è stato rimosso dopo l'apertura."));
        }
        if sha256_hex(&fs::read(&resolved)?) != expected {
            return Err(SaveError::new(
                "conflict",
                "Il file è cambiato su disco dopo l'apertura. Ricaricalo prima di salvare.",
            ));
        }
    }

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let temp = dir.join(format!(
        ".xmind-eq-{}-{:x}{:x}.tmp",
        now.as_millis(),
        now.subsec_nanos(),
        std::process::id()
    ));

    let result = write_and_swap(&temp, &resolved, &dir, bytes);
    if result.is_err() && temp.exists() {
        // Il temp orfano non deve restare accanto al file dell'utente.
        let _ = fs::remove_file(&temp);
    }
    result
}

fn write_and_swap(temp: &Path, resolved: &Path, dir: &Path, bytes: &[u8]) -> Result<Option<PathBuf>, SaveError> {
    {
        let mut file = OpenOptions::new().write(true).create_new(true).open(temp)?;
        file.write_all(bytes)?;
        preserve_mode(&file, resolved);
        file.sync_all()?;
    }

    let mut backup = None;
    if resolved.exists() {
        let backup_dir = dir.join(BACKUP_DIR);
        fs::create_dir_all(&backup_dir)?;
        let stem = resolved.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let ts = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let mut candidate = backup_dir.join(format!("{stem}.backup.{ts}.xmind"));
        let mut n = 1;
        while candidate.exists() {
            candidate = backup_dir.join(format!("{stem}.backup.{ts}-{n}.xmind"));
            n += 1;
        }
        fs::copy(resolved, &candidate)?;
        OpenOptions::new().write(true).open(&candidate)?.sync_all()?;
        prune_backups(&backup_dir, &stem);
        backup = Some(candidate);
    }

    fs::rename(temp, resolved)?;
    sync_dir(dir);
    Ok(backup)
}

/// Riporta sul temp i permessi del file che sostituisce (un file 0600 resta privato).
#[cfg(unix)]
fn preserve_mode(file: &File, target: &Path) {
    if let Ok(meta) = fs::metadata(target) {
        let _ = file.set_permissions(meta.permissions());
    }
}

#[cfg(not(unix))]
fn preserve_mode(_file: &File, _target: &Path) {}

/// fsync della cartella: rende persistente il rename. Non tutti i filesystem lo supportano.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// `<AAAAMMGG-hhmmss>` oppure `<AAAAMMGG-hhmmss>-<n>`: chiave d'ordine del backup, se il nome è nostro.
fn backup_key(middle: &str) -> Option<(String, u64)> {
    let (ts, n) = match middle.get(15..) {
        Some("") => (middle, 0),
        Some(rest) => (middle.get(..15)?, rest.strip_prefix('-')?.parse().ok()?),
        None => return None,
    };
    let bytes = ts.as_bytes();
    let well_formed = bytes.len() == 15
        && bytes[8] == b'-'
        && bytes.iter().enumerate().all(|(i, b)| i == 8 || b.is_ascii_digit());
    well_formed.then(|| (ts.to_string(), n))
}

/// Tiene gli ultimi `MAX_BACKUPS` backup di `stem`, riconoscendo solo i nomi generati qui.
fn prune_backups(dir: &Path, stem: &str) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let prefix = format!("{stem}.backup.");
    let mut backups: Vec<(String, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let middle = name.strip_prefix(&prefix)?.strip_suffix(".xmind")?;
            let (ts, n) = backup_key(middle)?;
            Some((ts, n, entry.path()))
        })
        .collect();
    if backups.len() <= MAX_BACKUPS {
        return;
    }
    backups.sort();
    let excess = backups.len() - MAX_BACKUPS;
    for (_, _, file) in backups.into_iter().take(excess) {
        let _ = fs::remove_file(file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("xmap-atomic-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scrive_e_fa_il_backup() {
        let dir = scratch("backup");
        let target = dir.join("mappa.xmind");
        assert!(atomic_write(&target, b"uno", None).unwrap().is_none());
        let backup = atomic_write(&target, b"due", Some(&sha256_hex(b"uno"))).unwrap().unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"due");
        assert_eq!(fs::read(backup).unwrap(), b"uno");
        // Nessun temp rimasto nella cartella.
        assert!(fs::read_dir(&dir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
    }

    #[test]
    fn rifiuta_un_file_cambiato() {
        let dir = scratch("conflict");
        let target = dir.join("mappa.xmind");
        fs::write(&target, b"altro").unwrap();
        let err = atomic_write(&target, b"nuovo", Some(&sha256_hex(b"vecchio"))).unwrap_err();
        assert_eq!(err.code, "conflict");
        assert_eq!(fs::read(&target).unwrap(), b"altro");
    }

    #[test]
    fn tiene_solo_gli_ultimi_cinque_backup() {
        let dir = scratch("prune");
        for i in 0..8 {
            fs::write(dir.join(format!("m.backup.20260101-00000{i}.xmind")), b"x").unwrap();
        }
        fs::write(dir.join("m.backup.altro.xmind"), b"x").unwrap();
        prune_backups(&dir, "m");
        let mut left: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left.len(), 6);
        assert!(left.contains(&"m.backup.altro.xmind".to_string()));
        assert!(!left.contains(&"m.backup.20260101-000002.xmind".to_string()));
    }
}
