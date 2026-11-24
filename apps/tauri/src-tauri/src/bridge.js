// Ponte tra la UI di apps/web e il guscio Tauri: espone la stessa `window.electronAPI`
// del preload Electron (apps/desktop/src/preload.ts) sopra i comandi di main.rs, così la
// UI resta identica. Iniettato da `initialization_script` prima degli script della pagina.
(() => {
  if (window.electronAPI) return;

  const invoke = (cmd, args, options) => window.__TAURI_INTERNALS__.invoke(cmd, args, options);

  // Eventi inviati da main.rs con `webview.eval` (beforeClose, maximized, theme).
  const listeners = new Map();
  const on = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    return () => listeners.get(name).delete(callback);
  };
  Object.defineProperty(window, '__xmapTauri', {
    value: Object.freeze({
      emit(name, value) {
        for (const callback of listeners.get(name) ?? []) callback(value);
      },
    }),
  });

  const fileName = (path) => path.split(/[\\/]/).pop() || path;
  const isXmind = (path) => path.toLowerCase().endsWith('.xmind');

  async function readPicked(path) {
    const buffer = await invoke('read_file', { path });
    return { path, name: fileName(path), bytes: new Uint8Array(buffer) };
  }

  // Byte nel corpo della richiesta (niente JSON di numeri), metadati nelle intestazioni.
  const rawHeaders = (path, extra = {}) => ({ headers: { 'x-xmap-path': encodeURIComponent(path), ...extra } });

  function writeAtomic(filePath, bytes, options, force) {
    const headers = {};
    if (options?.expectedHash) headers['x-xmap-hash'] = encodeURIComponent(options.expectedHash);
    if (force) headers['x-xmap-force'] = '1';
    return invoke('save_atomic', bytes, rawHeaders(filePath, headers));
  }

  // Con XMind aperto la conferma la chiede qui un dialogo nativo: il `confirm()` sincrono
  // della UI nella WebView di sistema risponde sì da solo. La UI riceve solo l'esito finale.
  async function saveAtomic(filePath, bytes, options) {
    const outcome = await writeAtomic(filePath, bytes, options, options?.force === true);
    if (outcome.ok || outcome.code !== 'xmind_running') return outcome;
    const forced = await invoke('confirm_force_save', { processes: outcome.processes ?? [] });
    if (!forced) return { ok: false, code: 'cancelled', message: 'salvataggio annullato perché XMind è aperto.' };
    return writeAtomic(filePath, bytes, options, true);
  }

  // Gli aggiornamenti automatici non ci sono ancora: la UI mostra "installazione manuale".
  const updateStatus = Object.freeze({
    currentVersion: '0.0.0',
    mode: 'manual',
    autoCheck: false,
    lastCheckedAt: null,
    state: Object.freeze({ phase: 'idle' }),
  });

  window.electronAPI = {
    getUpdateStatus: async () => updateStatus,
    checkForUpdates: async () => updateStatus,
    installUpdate: async () => updateStatus,
    restartToUpdate: () => {},
    setUpdateAutoCheck: async () => updateStatus,
    onUpdateStatus: () => () => {},
    platform: () => invoke('platform'),
    openFileDialog: async () => {
      const path = await invoke('pick_open', { description: 'XMind Map', extensions: ['xmind'] });
      return path ? readPicked(path) : null;
    },
    openFilePath: async (filePath) => {
      try {
        return isXmind(filePath) ? await readPicked(filePath) : null;
      } catch {
        return null;
      }
    },
    openFile: async (options) => {
      const path = await invoke('pick_open', {
        description: options?.description,
        extensions: options?.extensions?.length ? options.extensions : ['*'],
      });
      return path ? readPicked(path) : null;
    },
    saveFileDialog: (suggestedName) =>
      invoke('pick_save', { suggested: suggestedName || 'mappa.xmind', description: 'XMind Map', extensions: ['xmind'] }),
    saveBytes: async (suggestedName, bytes, options) => {
      const path =
        options?.targetPath ??
        (await invoke('pick_save', {
          suggested: suggestedName,
          description: options?.description,
          extensions: options?.extensions,
        }));
      if (!path) return null;
      if (isXmind(path)) {
        const outcome = await saveAtomic(path, bytes, { force: options?.force });
        return outcome.ok ? { path } : { ...outcome, path };
      }
      await invoke('write_file', bytes, rawHeaders(path));
      return { path };
    },
    saveAtomic,
    checkXMindRunning: () => invoke('xmind_processes'),
    printToPdf: async () => {
      throw new Error('Esportazione PDF non ancora disponibile nella versione Tauri.');
    },
    minimize: () => void invoke('win_minimize'),
    maximize: () => void invoke('win_toggle_maximize'),
    close: () => void invoke('win_close'),
    forceClose: () => void invoke('win_force_close'),
    cancelClose: () => {},
    isMaximized: () => invoke('win_is_maximized'),
    getInitialFile: () => invoke('initial_file'),
    onMaximizedChange: (callback) => on('maximized', callback),
    onBeforeClose: (callback) => on('beforeClose', callback),
    setZoomFactor: (factor) => void invoke('set_zoom', { factor }),
    setDarkMode: () => {},
    onThemeUpdated: (callback) => on('theme', callback),
    getDebugInfo: () => invoke('debug_info'),
  };

  // Barra del titolo: `-webkit-app-region` non vale nella WebView di sistema; trascinamento
  // e doppio clic per massimizzare si gestiscono qui (stesse regole di ui-kit/theme.css).
  const NO_DRAG = '.app-no-drag, button, input, textarea, select, a, [role="menu"]';
  window.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest('.app-drag-region') || event.target.closest(NO_DRAG)) return;
      if (event.detail === 2) void invoke('win_toggle_maximize');
      else void invoke('win_start_drag');
    },
    true,
  );
})();
