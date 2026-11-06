import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256HexAsync } from '../archive/archive.js';
import { WriteReport } from '../archive/types.js';
import { CODE_CONFLICT, CODE_IO, XmapError } from '../errors.js';

const MAX_BACKUPS = 5;
const BACKUP_DIR = '.xmap-studio/backups';

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const mins = pad(now.getMinutes());
  const secs = pad(now.getSeconds());
  return `${year}${month}${day}-${hours}${mins}${secs}`;
}

/**
 * Scrive bytes su target in modo atomico:
 * 1) Scrive su file temporaneo nella stessa cartella e chiama fsync
 * 2) Se makeBackup è true ed il target esiste, crea copia datata in .xmap-studio/backups/
 *    e cancella i backup eccedenti (conserva max 5 per file)
 * 3) Esegue rename atomico
 * 4) Esegue fsync della directory padre
 */
export async function atomicWrite(
  targetPath: string,
  bytes: Uint8Array,
  options: { makeBackup?: boolean; expectedHash?: string } = {}
): Promise<WriteReport> {
  const { makeBackup = true, expectedHash } = options;

  // Un collegamento simbolico va seguito: rinominare sul link lo sostituirebbe con un
  // file normale e il file vero (es. in una cartella sincronizzata) non verrebbe aggiornato.
  const resolved = resolveSymlink(path.resolve(targetPath));
  const dir = path.dirname(resolved);

  if (!fs.existsSync(dir)) {
    throw new XmapError(CODE_IO, `La cartella ${dir} non esiste`);
  }

  if (expectedHash !== undefined) {
    if (!fs.existsSync(resolved)) {
      throw new XmapError(CODE_CONFLICT, 'Il file è cambiato o è stato rimosso dopo l\'apertura.');
    }
    const currentHash = await sha256HexAsync(fs.readFileSync(resolved));
    if (currentHash !== expectedHash) {
      throw new XmapError(CODE_CONFLICT, 'Il file è cambiato su disco dopo l\'apertura. Ricaricalo prima di salvare.');
    }
  }

  // 1) File temporaneo nella stessa cartella (garantisce stesso filesystem per rename atomico)
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const tempPath = path.join(dir, `.xmind-eq-${Date.now()}-${randomSuffix}.tmp`);

  let backupPath: string | undefined;
  try {
    const fd = fs.openSync(tempPath, 'wx');
    try {
      // writeSync può scrivere meno byte di quelli chiesti: si ripete fino alla fine.
      let written = 0;
      while (written < bytes.length) {
        written += fs.writeSync(fd, bytes, written, bytes.length - written);
      }
      preserveMode(fd, resolved);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // 2) Backup se richiesto e file esistente
    if (makeBackup && fs.existsSync(resolved)) {
      const backupDir = path.join(dir, BACKUP_DIR);
      fs.mkdirSync(backupDir, { recursive: true });

      const stem = path.basename(resolved, path.extname(resolved));
      const ts = formatTimestamp();
      let candidate = path.join(backupDir, `${stem}.backup.${ts}.xmind`);
      let n = 1;
      while (fs.existsSync(candidate)) {
        candidate = path.join(backupDir, `${stem}.backup.${ts}-${n}.xmind`);
        n++;
      }

      fs.copyFileSync(resolved, candidate);
      // 'r+' e non 'r': su Windows fsync (FlushFileBuffers) richiede un handle
      // aperto in scrittura, altrimenti fallisce con EPERM.
      const bfd = fs.openSync(candidate, 'r+');
      try {
        fs.fsyncSync(bfd);
      } finally {
        fs.closeSync(bfd);
      }
      backupPath = candidate;

      // Prune backups oltre MAX_BACKUPS
      pruneBackups(backupDir, stem);
    }

    // 3) Rename atomico
    fs.renameSync(tempPath, resolved);
    // 4) Fsync della directory padre
    try {
      const dirFd = fs.openSync(dir, 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Fsync su directory può non essere supportato su tutti gli OS (es. Windows)
    }
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignora
      }
    }
    throw err instanceof Error ? err : new XmapError(CODE_IO, String(err));
  }

  return {
    backup: backupPath,
    bytesWritten: bytes.length,
  };
}

/** Percorso reale di `target` se è un collegamento simbolico esistente; altrimenti `target`. */
function resolveSymlink(target: string): string {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) return fs.realpathSync(target);
  } catch {
    // Il file non esiste ancora (Salva con nome) o il link è interrotto: si scrive su `target`.
  }
  return target;
}

/**
 * Riporta sul file temporaneo i permessi del file che sostituisce: senza, il rename
 * lascerebbe i permessi di default (es. un file privato 0600 diventerebbe leggibile da tutti).
 */
function preserveMode(fd: number, target: string): void {
  let mode: number;
  try {
    mode = fs.statSync(target).mode & 0o7777;
  } catch {
    return; // file nuovo: restano i permessi di default
  }
  try {
    fs.fchmodSync(fd, mode);
  } catch {
    // Filesystem senza permessi POSIX (es. FAT, alcune condivisioni di rete)
  }
}

/** Escape dei caratteri speciali delle regex, per usare un nome di file come letterale. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tiene gli ultimi MAX_BACKUPS backup di `stem`. Riconosce solo i nomi generati da
 * `atomicWrite` (`<stem>.backup.<AAAAMMGG-hhmmss>[-n].xmind`): un prefisso non basta,
 * prenderebbe i backup di un altro file chiamato `<stem>.backup.X.xmind`. L'ordine viene
 * dal timestamp nel nome e non dall'mtime, che `copyFileSync` su macOS/Windows copia
 * dall'originale.
 */
function pruneBackups(dir: string, stem: string): void {
  try {
    const pattern = new RegExp(`^${escapeRegExp(stem)}\\.backup\\.(\\d{8}-\\d{6})(?:-(\\d+))?\\.xmind$`);
    const backups: { file: string; ts: string; n: number }[] = [];

    for (const file of fs.readdirSync(dir)) {
      const match = pattern.exec(file);
      if (!match) continue;
      backups.push({ file: path.join(dir, file), ts: match[1], n: match[2] ? Number(match[2]) : 0 });
    }

    if (backups.length <= MAX_BACKUPS) return;

    // Dal più vecchio al più recente: timestamp, poi contatore di collisione nello stesso secondo.
    backups.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.n - b.n));

    const toRemove = backups.slice(0, backups.length - MAX_BACKUPS);
    for (const b of toRemove) {
      try {
        fs.unlinkSync(b.file);
      } catch {
        // Ignora
      }
    }
  } catch {
    // Non fallire il salvataggio se la potatura ha un problema minore
  }
}
