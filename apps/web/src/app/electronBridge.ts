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

/** Richiesta di Claude per la mappa della finestra; ricalca `McpRendererRequest` di apps/desktop/src/mcp-host.ts. */
export type McpRendererRequest = { requestId: number; tool: string; args: Record<string, unknown> };
export type McpMapInfo = { fileName: string; path: string | null; dirty: boolean };
export type McpRendererReply =
  | { requestId: number; ok: true; text: string; info?: McpMapInfo | null }
  | { requestId: number; ok: false; error: string };
/** Stato del collegamento con Claude Desktop e Claude Code; ricalca `ClaudeLinkStatus` di apps/desktop/src/claude-link.ts. */
export type ClaudeLinkStatus = {
  state: 'starting' | 'listening' | 'error';
  error: string | null;
  /** Percorso del socket locale (o della named pipe). */
  socketPath: string;
  /** Ponti collegati in questo momento (Claude Desktop, Claude Code…). */
  clients: number;
  /** Comando da incollare nel terminale per Claude Code. */
  claudeCodeCommand: string;
  /** Claude Desktop sa installare estensioni su questa piattaforma. */
  desktopSupported: boolean;
};
/** Esito di "Aggiungi a Claude Desktop"; ricalca `ClaudeInstallResult` di apps/desktop/src/claude-link.ts. */
export type ClaudeInstallResult = { ok: true; path: string } | { ok: false; error: string; path: string | null };

/** Stato del collegamento con Hermes Desktop; ricalca `HermesLinkStatus` di apps/desktop/src/hermes-link.ts. */
export type HermesLinkStatus = {
  enabled: boolean;
  /** Porta su 127.0.0.1 da inserire nel plugin di Hermes. */
  port: number;
  /** Token di accoppiamento; `null` finché il collegamento non è mai stato acceso. */
  token: string | null;
  /** `off`: spento; `listening`: in ascolto; `error`: non è partito (vedi `error`). */
  state: 'off' | 'listening' | 'error';
  /** Plugin di Hermes collegati e autenticati in questo momento. */
  clients: number;
  error: string | null;
};
/** Strumento interno: descrive la mappa della finestra per `list_maps`. */
export const MCP_DESCRIBE = '__describe';

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
      /** Collegamento con Claude; assente nelle shell desktop più vecchie. */
      onMcpRequest?: (callback: (request: McpRendererRequest) => void) => () => void;
      respondMcp?: (reply: McpRendererReply) => void;
      /** Collegamento con Claude (socket locale); assente nelle shell desktop più vecchie. */
      getClaudeLink?: () => Promise<ClaudeLinkStatus>;
      /** Genera l'estensione `.mcpb` e la apre con Claude Desktop, che chiede conferma. */
      installClaudeDesktopExtension?: () => Promise<ClaudeInstallResult>;
      /** Mostra nella cartella l'estensione generata. */
      revealClaudeExtension?: () => Promise<void>;
      /** Nuova chiave: scollega estensione e Claude Code finché non si reinstalla. */
      regenerateClaudeLinkKey?: () => Promise<ClaudeLinkStatus>;
      onClaudeLinkStatus?: (callback: (status: ClaudeLinkStatus) => void) => () => void;
      /** Collegamento con Hermes Desktop; assente nelle shell desktop più vecchie. */
      getHermesLink?: () => Promise<HermesLinkStatus>;
      setHermesLinkEnabled?: (enabled: boolean) => Promise<HermesLinkStatus>;
      regenerateHermesLinkToken?: () => Promise<HermesLinkStatus>;
      openHermesInstaller?: () => Promise<{ ok: true } | { ok: false; error: string }>;
      onHermesLinkStatus?: (callback: (status: HermesLinkStatus) => void) => () => void;
    };
  }
}

