export interface FileHandleHolder {
  handle?: FileSystemFileHandle;
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
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xmind';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const buffer = await file.arrayBuffer();
      resolve({
        name: file.name,
        data: new Uint8Array(buffer),
      });
    };
    input.click();
  });
}

export async function saveLocalXmindFile(
  bytes: Uint8Array,
  suggestedName: string = 'map.xmind',
  existingHandle?: FileSystemFileHandle
): Promise<FileSystemFileHandle | undefined> {
  // Se abbiamo un handle esistente e possiamo scrivere
  if (existingHandle && 'createWritable' in existingHandle) {
    try {
      const writable = await (existingHandle as any).createWritable();
      await writable.write(bytes);
      await writable.close();
      return existingHandle;
    } catch {
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

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options?.extensions?.length) {
      input.accept = options.extensions.map((e) => `.${e}`).join(',');
    }
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    };
    input.click();
  });
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
  const api = (window as any).electronAPI;
  if (api?.saveBytes) {
    return (await api.saveBytes(suggestedName, Array.from(bytes), options)) || null;
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
  return null;
}

export function downloadBlob(bytes: Uint8Array, filename: string, mimeType: string): void {
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
