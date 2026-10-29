// Tipi del ponte Electron (preload): il file è incluso dal tsconfig, quindi non serve importarlo.
declare global {
  interface Window {
    electronAPI?: {
      checkAndDownloadUpdate: () => Promise<
        | { status: 'unsupported'; message: string }
        | { status: 'upToDate'; version: string }
        | { status: 'downloaded'; version: string; path: string }
        | { status: 'error'; message: string }
      >;
      platform: () => Promise<string>;
      openFileDialog: () => Promise<{ path: string; name: string; bytes: Uint8Array } | null>;
      openFilePath: (filePath: string) => Promise<{ path: string; name: string; bytes: Uint8Array } | null>;
      openFile: (options?: { description?: string; extensions?: string[] }) => Promise<{ path: string; name: string; bytes: Uint8Array } | null>;
      saveFileDialog: (suggestedName?: string) => Promise<string | null>;
      saveBytes: (
        suggestedName: string,
        bytes: Uint8Array,
        options?: { description?: string; extensions?: string[]; targetPath?: string; force?: boolean }
      ) => Promise<
        | { path: string }
        | { ok: false; code: string; message: string; processes?: string[]; path: string }
        | null
      >;
      saveAtomic: (
        filePath: string,
        bytes: Uint8Array,
        options?: { expectedHash?: string; force?: boolean }
      ) => Promise<
        | { ok: true; backup?: string; bytes: number }
        | { ok: false; code: string; message: string; processes?: string[] }
      >;
      checkXMindRunning: () => Promise<string[]>;
      printToPdf: (opts: { pageSize: 'A4' | 'A3' | { widthMm: number; heightMm: number }; landscape: boolean }) => Promise<Uint8Array>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      forceClose: () => void;
      isMaximized: () => Promise<boolean>;
      getInitialFile: () => Promise<string | null>;
      onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
      onBeforeClose: (callback: () => void) => () => void;
      setZoomFactor: (factor: number) => void;
    };
  }
}

export {};
