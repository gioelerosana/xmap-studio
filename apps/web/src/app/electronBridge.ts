// Tipi del ponte Electron (preload): il file è incluso dal tsconfig, quindi non serve importarlo.
// I tipi degli aggiornamenti ricalcano quelli di apps/desktop/src/preload.ts.

export type UpdateInstallMode = 'appimage' | 'portable' | 'manual';

export type UpdateRelease = {
  version: string;
  tag: string;
  url: string;
  notes: string;
  publishedAt: string | null;
};

export type UpdateStep = 'scanning' | 'downloading' | 'verifying' | 'installing';

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate'; latestVersion: string }
  | { phase: 'available'; release: UpdateRelease }
  | { phase: 'downloading'; release: UpdateRelease; step: UpdateStep; progress: number | null }
  | { phase: 'ready'; release: UpdateRelease; path: string; downloadedBytes: number; reusedBytes: number }
  | { phase: 'error'; message: string; release: UpdateRelease | null };

export type UpdateStatus = {
  currentVersion: string;
  mode: UpdateInstallMode;
  autoCheck: boolean;
  lastCheckedAt: number | null;
  state: UpdateState;
};

/** Risposta di `getDebugInfo`; ricalca `DesktopDebugInfo` di apps/desktop/src/debug-log.ts. */
export type DesktopDebugInfo = {
  platform?: string;
  os?: string;
  arch?: string;
  isPackaged?: boolean;
  execPath?: string;
  userData?: string;
  versions: Record<string, string | undefined>;
  mainLog: { time: number; level: string; message: string; detail?: string }[];
  /** Impostato dal renderer se la chiamata IPC fallisce. */
  error?: string;
};

declare global {
  interface Window {
    electronAPI?: {
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<UpdateStatus>;
      restartToUpdate: () => void;
      setUpdateAutoCheck: (enabled: boolean) => Promise<UpdateStatus>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
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
      /** Assente nelle shell desktop più vecchie. */
      cancelClose?: () => void;
      isMaximized: () => Promise<boolean>;
      getInitialFile: () => Promise<string | null>;
      onMaximizedChange: (callback: (isMax: boolean) => void) => () => void;
      onBeforeClose: (callback: () => void) => () => void;
      setZoomFactor: (factor: number) => void;
      setDarkMode: (dark: boolean) => void;
      onThemeUpdated: (callback: (dark: boolean) => void) => () => void;
      /** Assente nelle shell desktop più vecchie. */
      getDebugInfo?: () => Promise<DesktopDebugInfo>;
    };
  }
}

