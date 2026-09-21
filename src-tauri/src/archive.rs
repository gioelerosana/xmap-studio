//! Lettura e scrittura dell'archivio `.xmind` (ZIP).
//!
//! Principi:
//!  * ogni entry viene letta integralmente (verifica CRC implicita) e conservata
//!    byte per byte, incluse quelle che non conosciamo;
//!  * le risorse (`resources/*`) sono tenute separate per poter aggiornare il
//!    manifest in modo affidabile;
//!  * la scrittura è atomica: temp nella stessa directory → fsync → backup →
//!    rename → fsync della directory;
//!  * i backup finiscono in una cartella nascosta accanto al file, con
//!    retention: non si accumulano copie visibili nella cartella di lavoro.

use anyhow::{anyhow, bail, Context, Result};
use indexmap::IndexMap;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Tutte le entry dello ZIP tranne `resources/*`.
pub type Entries = IndexMap<String, Vec<u8>>;
/// Entry `resources/*` indicizzate per nome.
pub type Resources = IndexMap<String, Vec<u8>>;

pub struct RawArchive {
    pub entries: Entries,
    pub resources: Resources,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

pub fn hash_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path).with_context(|| format!("lettura {}", path.display()))?;
    Ok(sha256_hex(&bytes))
}

pub fn mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

/// Legge l'intero archivio. `content.json` deve esistere (formato moderno).
pub fn read_archive(path: &Path) -> Result<RawArchive> {
    let file = File::open(path).with_context(|| format!("apertura {}", path.display()))?;
    let mut zip = ZipArchive::new(file).with_context(|| {
        format!(
            "{} non è un archivio .xmind valido (ZIP corrotto?)",
            path.display()
        )
    })?;

    let mut entries: Entries = IndexMap::new();
    let mut resources: Resources = IndexMap::new();
    for i in 0..zip.len() {
        let mut f = zip
            .by_index(i)
            .with_context(|| format!("entry #{i} illeggibile"))?;
        let name = f.name().to_string();
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf)
            .with_context(|| format!("CRC/lettura fallita su {name}"))?;
        if name.starts_with("resources/") && !name.ends_with('/') {
            resources.insert(name, buf);
        } else {
            entries.insert(name, buf);
        }
    }

    if !entries.contains_key("content.json") {
        bail!("content.json assente: formato legacy XMind 8 non supportato");
    }
    Ok(RawArchive { entries, resources })
}

/// Costruisce i byte dello ZIP: prima le entry non-risorsa, poi le risorse.
pub fn build_archive_bytes(archive: &RawArchive) -> Result<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, data) in &archive.entries {
            if name.ends_with('/') {
                writer.add_directory(name.as_str(), opts)?;
            } else {
                writer.start_file(name.as_str(), opts)?;
                writer.write_all(data)?;
            }
        }
        for (name, data) in &archive.resources {
            if name.ends_with('/') {
                writer.add_directory(name.as_str(), opts)?;
            } else {
                writer.start_file(name.as_str(), opts)?;
                writer.write_all(data)?;
            }
        }
        writer.finish()?;
    }
    Ok(cursor.into_inner())
}

pub struct WriteReport {
    pub backup: Option<PathBuf>,
    pub bytes_written: usize,
}

/// Quanti backup conservare per ogni mappa: oltre questa soglia i più vecchi
/// vengono eliminati, così la cartella non cresce all'infinito.
const MAX_BACKUPS: usize = 5;

/// Cartella nascosta dei backup, accanto al file sorgente.
const BACKUP_DIR: &str = ".xmap-studio/backups";

fn timestamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Cartella dei backup per `target`, creata se assente.
fn backup_dir(target: &Path) -> Result<PathBuf> {
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| anyhow!("percorso senza directory padre: {}", target.display()))?;
    let backup_dir = dir.join(BACKUP_DIR);
    fs::create_dir_all(&backup_dir)
        .with_context(|| format!("creazione cartella backup {}", backup_dir.display()))?;
    Ok(backup_dir)
}

/// Percorso del prossimo backup, unico anche con più salvataggi nello stesso
/// secondo.
fn backup_path(target: &Path, dir: &Path) -> PathBuf {
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("workbook");
    let mut candidate = dir.join(format!("{stem}.backup.{}.xmind", timestamp()));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}.backup.{}-{n}.xmind", timestamp()));
        n += 1;
    }
    candidate
}

/// Copia datata dell'originale nella cartella nascosta e potatura dei backup
/// eccedenti.
fn create_backup(target: &Path) -> Result<PathBuf> {
    let dir = backup_dir(target)?;
    let backup = backup_path(target, &dir);
    fs::copy(target, &backup).with_context(|| format!("backup in {}", backup.display()))?;
    File::open(&backup)?.sync_all().context("fsync backup")?;
    prune_backups(&dir, target);
    Ok(backup)
}

/// Elimina i backup più vecchi di `target`, lasciando i `MAX_BACKUPS` recenti.
fn prune_backups(dir: &Path, target: &Path) {
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("workbook");
    let prefix = format!("{stem}.backup.");
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    let mut backups: Vec<PathBuf> = read
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(&prefix) && n.ends_with(".xmind"))
                .unwrap_or(false)
        })
        .collect();
    if backups.len() <= MAX_BACKUPS {
        return;
    }
    // Ordina dal più vecchio al più recente; a parità di mtime (salvataggi nello
    // stesso istante) decide il nome, per un ordine deterministico.
    backups.sort_by(|a, b| {
        let ma = fs::metadata(a).and_then(|m| m.modified()).ok();
        let mb = fs::metadata(b).and_then(|m| m.modified()).ok();
        ma.cmp(&mb).then_with(|| a.cmp(b))
    });
    for old in &backups[..backups.len() - MAX_BACKUPS] {
        let _ = fs::remove_file(old);
    }
}

/// Scrive `bytes` in `target` in modo atomico, con backup datato dell'esistente.
pub fn atomic_write(target: &Path, bytes: &[u8], make_backup: bool) -> Result<WriteReport> {
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    if !dir.exists() {
        bail!("la directory {} non esiste", dir.display());
    }

    // 1) temp nella STESSA directory (stesso filesystem → rename atomico)
    let mut tmp = tempfile::Builder::new()
        .prefix(".xmind-eq-")
        .suffix(".tmp")
        .tempfile_in(&dir)
        .with_context(|| format!("creazione file temporaneo in {}", dir.display()))?;
    tmp.write_all(bytes).context("scrittura temporaneo")?;
    tmp.as_file().sync_all().context("fsync temporaneo")?;

    // 2) backup datato dell'originale, prima di toccarlo
    let backup = if make_backup && target.exists() {
        Some(create_backup(target)?)
    } else {
        None
    };

    // 3) rename atomico
    tmp.persist(target)
        .map_err(|e| anyhow!("rename atomico fallito: {}", e.error))?;

    // 4) fsync della directory per rendere il rename durevole
    if let Ok(d) = File::open(&dir) {
        let _ = d.sync_all();
    }

    Ok(WriteReport {
        backup,
        bytes_written: bytes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn atomic_write_creates_backup_and_content() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("m.xmind");
        fs::write(&target, b"old").unwrap();
        let report = atomic_write(&target, b"new", true).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        let backup = report.backup.expect("backup creato");
        assert_eq!(fs::read(&backup).unwrap(), b"old");
        assert!(backup
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .contains(".backup."));
        // il backup sta nella cartella nascosta, non accanto al file
        assert_eq!(
            backup.parent().unwrap(),
            backup_dir(&target).unwrap().as_path()
        );
        assert!(backup
            .parent()
            .unwrap()
            .to_string_lossy()
            .contains(".xmap-studio"));
        // nessun temp residuo
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".xmind-eq-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn backups_are_pruned_to_the_retention_limit() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("m.xmind");
        fs::write(&target, b"v0").unwrap();
        for i in 0..(MAX_BACKUPS + 3) {
            fs::write(&target, format!("v{i}")).unwrap();
            atomic_write(&target, b"new", true).unwrap();
        }
        let count = fs::read_dir(backup_dir(&target).unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with("m.backup.") && n.ends_with(".xmind"))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(count, MAX_BACKUPS);
    }

    #[test]
    fn round_trip_zip_entries() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("m.xmind");
        fs::write(&target, b"x").unwrap();
        let mut entries = Entries::new();
        entries.insert("content.json".into(), b"[]".to_vec());
        entries.insert("manifest.json".into(), b"{}".to_vec());
        entries.insert("content.xml".into(), b"<xml/>".to_vec());
        entries.insert("Thumbnails/".into(), Vec::new());
        let mut resources = Resources::new();
        resources.insert("resources/a.png".into(), vec![1u8, 2, 3]);
        let bytes = build_archive_bytes(&RawArchive { entries, resources }).unwrap();
        let parsed = read_archive_bytes(&bytes).unwrap();
        assert!(parsed.entries.contains_key("content.xml"));
        assert!(parsed.entries.contains_key("Thumbnails/"));
        assert_eq!(parsed.resources["resources/a.png"], vec![1, 2, 3]);
        assert!(!parsed.entries.contains_key("resources/a.png"));
    }

    // helper di test: legge da byte, riusa la logica di read_archive
    fn read_archive_bytes(bytes: &[u8]) -> Result<RawArchive> {
        let mut zip = ZipArchive::new(Cursor::new(bytes.to_vec()))?;
        let mut entries = Entries::new();
        let mut resources = Resources::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i)?;
            let name = f.name().to_string();
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            if name.starts_with("resources/") && !name.ends_with('/') {
                resources.insert(name, buf);
            } else {
                entries.insert(name, buf);
            }
        }
        Ok(RawArchive { entries, resources })
    }
}
