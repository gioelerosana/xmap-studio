# Guscio Tauri (prototipo)

Prototipo di guscio desktop alternativo a Electron (`apps/desktop`). Usa
[Tauri 2](https://tauri.app) e la **WebView del sistema** al posto del Chromium
incluso nel pacchetto: WebKitGTK su Linux, WebView2 su Windows.

La UI è la stessa di `apps/web` compilata (`apps/web/dist`), **senza modifiche**.
Il guscio inietta `src-tauri/src/bridge.js`, che espone la stessa
`window.electronAPI` del preload Electron sopra i comandi Rust di
`src-tauri/src/main.rs`.

## Comandi

Servono Rust (`cargo`) e, su Linux, le librerie di sviluppo di WebKitGTK 4.1
(Ubuntu/Debian: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev`).

```bash
pnpm build:web                                   # UI compilata in apps/web/dist
cd apps/tauri/src-tauri
cargo build --release                            # eseguibile in target/release/xmap-studio-tauri
cargo test --release                             # test di salvataggio atomico e rilevamento di XMind
./target/release/xmap-studio-tauri mappa.xmind   # avvio, con file facoltativo
```

Per lo sviluppo con HMR: `pnpm dev:web` in un terminale, poi
`cargo run --no-default-features` (senza `custom-protocol` la finestra carica
`http://localhost:3000`).

## Cosa c'è

| Funzione | Stato |
|---|---|
| Apertura (dialogo, file da riga di comando/file manager) | ✅ |
| Salvataggio sicuro (regole 2–4 di AGENTS.md) | ✅ porting in Rust di `atomicWrite` e `guardedSave` (`atomic.rs`, `safety.rs`), con test |
| Blocco con XMind aperto e forzatura | ✅ con dialogo nativo (vedi sotto) |
| Salva con nome, export (PNG, SVG, Markdown…) | ✅ |
| Barra del titolo personalizzata: trascinamento, doppio clic, riduci/ingrandisci/chiudi | ✅ |
| Chiusura con modifiche non salvate | ✅ |
| Zoom dell'interfaccia | ✅ |
| Esportazione PDF (`printToPdf`) | ❌ WebKitGTK non ha un equivalente di `webContents.printToPDF` |
| Aggiornamenti automatici (AppImage/zsync, exe portable) | ❌ la UI mostra "installazione manuale" |
| Pacchetti (AppImage, deb, exe) | ❌ serve `tauri-cli` (`cargo tauri build`) |
| Più finestre, una per file aperto dal file manager | ❌ una sola finestra |
| Tema di sistema sullo sfondo nativo della finestra | ❌ |

### Differenze trovate

- **`confirm()` sincrono.** Nella WebView di sistema non chiede nulla e risponde
  sì: con XMind aperto la UI avrebbe forzato il salvataggio da sola. Il ponte
  ora chiede la conferma con un dialogo nativo (`confirm_force_save`) e la UI
  riceve solo l'esito finale. Per una migrazione vera i `confirm()` della UI
  (anche in `NextcloudBrowserModal`) vanno sostituiti con dialoghi asincroni.
- **`-webkit-app-region: drag`** non esiste in WebKitGTK: il trascinamento
  della barra del titolo lo gestisce `bridge.js`, con le stesse regole di
  `.app-drag-region` in `ui-kit/theme.css`.
- **Compositing di WebKitGTK.** Con il rendering GL software (niente GPU, Xvfb,
  alcune VM) raddoppia la memoria: il guscio imposta
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` se l'utente non l'ha già scelto. Su un
  desktop con GPU va misurato se conviene tenerlo attivo.

## Misure

Linux (Ubuntu 24.04, WebKitGTK 2.52, Electron 45) sotto Xvfb, senza GPU.
Memoria PSS sommata su tutti i processi dell'app, dopo 15 s dall'avvio. La
mappa di prova ha 3 fogli e 468 blocchi, con una formula ogni 4.

| | Electron | Tauri | Differenza |
|---|---|---|---|
| App vuota | 289 MB | 229 MB | −21% |
| Mappa da 468 blocchi | 368 MB | 337 MB | −8% |
| Tauri con compositing attivo, mappa | — | 546 MB | +48% |
| Eseguibile / runtime su disco | 274 MB (Electron) | 8,9 MB (UI inclusa) | −97% |

Dove va la memoria con la mappa aperta:

| Processo | Electron | Tauri |
|---|---|---|
| Processo principale | 85 MB | 96 MB (GTK + WebKit lato UI) |
| Pagina (JS + DOM + disegno) | 150 MB (V8/Blink) | 219 MB (JavaScriptCore/WebKit) |
| GPU / compositing | 74 MB | — (disattivato) |
| Rete, utility, zygote | 57 MB | 21 MB |

**Lettura.** Il guadagno di Tauri è il peso fisso di Chromium (processo GPU,
utility, zygote) e soprattutto lo spazio su disco. Con una mappa vera la pagina
in WebKitGTK occupa più memoria che in Chromium, e il vantaggio scende a circa
l'8%. Su Windows la WebView di sistema è Chromium (WebView2): il disegno della
pagina costa come in Electron, il runtime è condiviso con il sistema.

Da misurare prima di decidere:
- desktop Linux con GPU vera, con compositing attivo e disattivo;
- Windows (WebView2);
- fluidità di pan/zoom su mappe grandi in WebKitGTK.
