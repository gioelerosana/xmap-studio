// Tipi del ponte Electron (preload): il file è incluso dal tsconfig, quindi non serve importarlo.
declare global {
  interface Window {
    electronAPI?: {
      openFileDialog: () => Promise<{ path: string; name: string; bytes: number[] } | null>;
      openFilePath: (filePath: string) => Promise<{ path: string; name: string; bytes: number[] } | null>;
      openFile: (options?: { description?: string; extensions?: string[] }) => Promise<{ path: string; name: string; bytes: number[] } | null>;
      saveFileDialog: (suggestedName?: string) => Promise<string | null>;
      saveBytes: (
        suggestedName: string,
        bytes: number[],
        options?: { description?: string; extensions?: string[]; targetPath?: string; force?: boolean }
      ) => Promise<
        | { path: string }
        | { ok: false; code: string; message: string; processes?: string[]; path: string }
        | null
      >;
      saveAtomic: (
        filePath: string,
        bytes: number[],
        options?: { expectedHash?: string; force?: boolean }
      ) => Promise<
        | { ok: true; backup?: string; bytes: number }
        | { ok: false; code: string; message: string; processes?: string[] }
      >;
      checkXMindRunning: () => Promise<string[]>;
      printToPdf: (opts: { pageSize: 'A4' | 'A3'; landscape: boolean }) => Promise<number[]>;
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
