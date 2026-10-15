import { WriteReport } from './types.js';
import { sha256HexAsync } from './archive.js';

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
  makeBackup: boolean = true,
  expectedHash?: string
): Promise<WriteReport> {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);

  if (!fs.existsSync(dir)) {
    throw new Error(`La cartella ${dir} non esiste`);
  }

  if (expectedHash !== undefined) {
    if (!fs.existsSync(resolved)) {
      throw new Error('Il file è cambiato o è stato rimosso dopo l\'apertura.');
    }
    const currentHash = await sha256HexAsync(fs.readFileSync(resolved));
    if (currentHash !== expectedHash) {
      throw new Error('Il file è cambiato su disco dopo l\'apertura. Ricaricalo prima di salvare.');
    }
  }

  // 1) File temporaneo nella stessa cartella (garantisce stesso filesystem per rename atomico)
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const tempPath = path.join(dir, `.xmind-eq-${Date.now()}-${randomSuffix}.tmp`);

  let backupPath: string | undefined;
  try {
    const fd = fs.openSync(tempPath, 'wx');
    try {
      fs.writeSync(fd, bytes, 0, bytes.length);
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
      const bfd = fs.openSync(candidate, 'r');
      try {
        fs.fsyncSync(bfd);
      } finally {
        fs.closeSync(bfd);
      }
      backupPath = candidate;

      // Prune backups oltre MAX_BACKUPS
      pruneBackups(fs, path, backupDir, stem);
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
    throw err instanceof Error ? err : new Error(String(err));
  }

  return {
    backup: backupPath,
    bytesWritten: bytes.length,
  };
}

function pruneBackups(
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
  dir: string,
  stem: string
): void {
  try {
    const prefix = `${stem}.backup.`;
    const entries = fs.readdirSync(dir);
    const backups: { file: string; mtime: number }[] = [];

    for (const file of entries) {
      if (file.startsWith(prefix) && file.endsWith('.xmind')) {
        const full = path.join(dir, file);
        try {
          const stat = fs.statSync(full);
          backups.push({ file: full, mtime: stat.mtimeMs });
        } catch {
          // Ignora
        }
      }
    }

    if (backups.length <= MAX_BACKUPS) return;

    // Ordina dal più vecchio al più recente
    backups.sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));

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
