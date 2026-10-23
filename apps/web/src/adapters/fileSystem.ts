import { sha256HexAsync, validateArchiveBytes } from '@xmap/core';

export interface FileHandleHolder {
  handle?: FileSystemFileHandle;
}

/** iPhone/iPad, incluso iPadOS che si presenta come Mac con touch. */
function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Legge un File scelto dal selettore. Con i provider di file remoti di iOS
 * (Nextcloud, …) il file può essere un segnaposto da scaricare: `arrayBuffer()`
 * può fallire dove `FileReader` riesce, quindi si prova prima l'uno poi l'altro.
 */
async function readPickedFile(file: File): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () =>
        reject(
          new Error(
            `Impossibile leggere "${file.name}". Se il file è su Nextcloud o un altro cloud, ` +
              'aprilo prima dall\'app File (per scaricarlo sul dispositivo) e riprova.'
          )
        );
      reader.readAsArrayBuffer(file);
    });
  }
}

/**
 * Apre il selettore file nativo del browser. L'input viene agganciato al DOM
 * finché il selettore è aperto: su iOS un input staccato può essere raccolto dal
 * garbage collector e `change` non arriva mai. Gli errori di lettura vengono
 * rifiutati (e quindi mostrati dal chiamante) invece di restare silenziosi.
 */
function pickFileViaInput(accept?: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => input.remove();
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        resolve({ name: file.name, bytes: await readPickedFile(file) });
      } catch (err) {
        reject(err);
      } finally {
        cleanup();
      }
    });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });
    input.click();
  });
}

export async function openLocalXmindFile(): Promise<{
  name: string;
  data: Uint8Array;
  handle?: FileSystemFileHandle;
} | null> {
  // 1. Prova File System Access API
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'XMind Map (*.xmind)',
            accept: {
              'application/vnd.xmind.workbook': ['.xmind'],
              'application/zip': ['.xmind'],
            },
          },
        ],
        multiple: false,
      });

      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      return {
        name: file.name,
        data: new Uint8Array(buffer),
        handle,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') return null;
      // Fallback a input standard se rifiutato
    }
  }

  // 2. Fallback input file standard
  // iOS non associa `.xmind` a un tipo noto e disabiliterebbe il file nel selettore.
  const picked = await pickFileViaInput(isIOS() ? undefined : '.xmind');
  return picked ? { name: picked.name, data: picked.bytes } : null;
}

export async function saveLocalXmindFile(
  bytes: Uint8Array,
  suggestedName: string = 'map.xmind',
  existingHandle?: FileSystemFileHandle,
  expectedHash?: string
): Promise<FileSystemFileHandle | undefined> {
  // Se abbiamo un handle esistente e possiamo scrivere
  if (existingHandle && 'createWritable' in existingHandle) {
    try {
      if (expectedHash) {
        const currentFile = await existingHandle.getFile();
        const currentHash = await sha256HexAsync(new Uint8Array(await currentFile.arrayBuffer()));
        if (currentHash !== expectedHash) {
          throw new FileConflictError('Il file è cambiato su disco dopo l\'apertura. Ricaricalo prima di salvare.');
        }
      }
      const writable = await (existingHandle as any).createWritable();
      await writable.write(bytes);
      await writable.close();
      return existingHandle;
    } catch (err) {
      if (err instanceof FileConflictError) throw err;
      // Procedi con showSaveFilePicker o download
    }
  }

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'XMind Map (*.xmind)',
            accept: {
              'application/vnd.xmind.workbook': ['.xmind'],
              'application/zip': ['.xmind'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return handle;
    } catch (err: any) {
      if (err.name === 'AbortError') return undefined;
    }
  }

  // Fallback download browser
  downloadBlob(bytes, suggestedName, 'application/vnd.xmind.workbook');
  return undefined;
}

class FileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileConflictError';
  }
}

/**
 * Apre un file qualsiasi (per unire mappe o allegare file) con dialogo nativo
 * su Electron e input file su web.
 */
export async function pickAnyFile(options?: {
  description?: string;
  extensions?: string[];
}): Promise<{ name: string; path?: string; bytes: Uint8Array } | null> {
  const api = (window as any).electronAPI;
  if (api?.openFile) {
    const res = await api.openFile({
      description: options?.description,
      extensions: options?.extensions,
    });
    if (!res) return null;
    return { name: res.name, path: res.path, bytes: new Uint8Array(res.bytes) };
  }

  const accept =
    options?.extensions?.length && !isIOS() ? options.extensions.map((e) => `.${e}`).join(',') : undefined;
  return pickFileViaInput(accept);
}

/**
 * Il main di Electron rifiuta di scrivere mentre XMind è aperto (regola 4):
 * qui si chiede se forzare, mostrando i processi trovati.
 */
export function confirmForceSave(processes: string[]): boolean {
  return confirm(
    `XMind è in esecuzione (${processes.join(', ')}). Salvando adesso il file potrebbe essere sovrascritto o corrotto.\n\nForzare il salvataggio?`
  );
}

/**
 * Salva byte arbitrari (export, split, …) con dialogo nativo o download.
 */
export async function saveBytes(
  bytes: Uint8Array,
  suggestedName: string,
  mimeType: string,
  options?: { description?: string; extensions?: string[] }
): Promise<{ path?: string } | null> {
  if (mimeType === 'application/vnd.xmind.workbook') await validateArchiveBytes(bytes);

  const api = (window as any).electronAPI;
  if (api?.saveBytes) {
    const payload = Array.from(bytes);
    let res = await api.saveBytes(suggestedName, payload, options);
    if (res && 'ok' in res && res.code === 'xmind_running') {
      if (!confirmForceSave(res.processes ?? [])) return null;
      res = await api.saveBytes(suggestedName, payload, {
        ...options,
        targetPath: res.path,
        force: true,
      });
    }
    if (res && 'ok' in res) throw new Error(res.message);
    return res || null;
  }

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: options?.extensions
          ? [{ description: options.description || 'File', accept: { [mimeType]: options.extensions.map((e) => `.${e}`) } }]
          : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return { path: handle.name };
    } catch (err: any) {
      if (err?.name === 'AbortError') return null;
    }
  }

  downloadBlob(bytes, suggestedName, mimeType);
  return {};
}

/** Base64 a blocchi: `String.fromCharCode(...bytes)` su file grandi supera il limite di argomenti. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function downloadBlob(bytes: Uint8Array, filename: string, mimeType: string): void {
  // Nel WebView Android un download da `blob:` non arriva a nessuno: salva l'app nativa.
  if (window.xmapAndroid) {
    window.xmapAndroid.saveFile(toBase64(bytes), filename, mimeType);
    return;
  }
  const blob = new Blob([bytes as any], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
