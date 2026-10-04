# Sviluppo

## Prerequisiti

| Requisito | Note |
|---|---|
| Rust | edizione 2021, `rust-version = 1.77` (`src-tauri/Cargo.toml`) |
| `gtk4` + `libadwaita` | librerie di **sistema**, non incluse nell'AppImage |
| `node` | nel `PATH`; esegue `gen_equation.mjs` |
| `npm` | solo come fallback per ricostruire il renderer |
| `curl` + FUSE (`fusermount`) | solo per produrre l'AppImage |

Su distro con apt:

```bash
sudo apt install libgtk-4-dev libadwaita-1-dev nodejs npm
```

## Comandi principali

Nessun npm, nessun bundler, nessuno script di setup: solo Cargo.

```bash
cargo run                 # avvio in sviluppo
cargo build --release     # binario in target/release/xmap-studio
cargo test                # test unitari + end-to-end
cargo xtask appimage      # AppImage in dist/
cargo xtask install       # registra .desktop + MIME application/xmind in ~/.local/share
```

L'alias `cargo xtask` è definito in `.cargo/config.toml` e lancia il crate
`xtask`.

## Associazione dei file `.xmind`

L'app dichiara il tipo MIME `application/xmind` (`assets/org.joel.xmap_studio.xml`)
e il `.desktop` lo espone con `MimeType=application/xmind;` ed `Exec=… %f`. Il
codice gestisce l'argomento file con `HANDLES_OPEN` (`gui.rs:144`): ogni file
ricevuto apre una finestra indipendente.

```bash
cargo xtask install       # build di release + registrazione in ~/.local/share
xdg-mime default org.joel.xmap_studio.desktop application/xmind   # rendila predefinita
```

`install` non cambia l'app predefinita: la scelta resta dell'utente (o di XMind).
Dal file manager basta "Apri con… → XMap Studio". L'AppImage include lo stesso
`.desktop` e il file MIME in `usr/share/`; l'integrazione desktop del sistema
(AppManager, `appimaged`, …) li registra.

Non servono i **desktop portal** di xdg-desktop-portal: quelli servono alle app
in sandbox (Flatpak/Snap) per accedere a file fuori sandbox. XMap Studio è
nativa/AppImage e usa il filesystem direttamente.

## Il renderer MathJax incorporato

Il progetto **non richiede passi manuali** per il renderer. `build.rs`:

1. se `resources/renderer/node_modules/mathjax-full` esiste, lo usa;
2. altrimenti lo ricostruisce copiando l'installazione "oracolo"
   (`~/.local/share/xmind-latex`, o `XMIND_LATEX_ORACLE`);
3. in ultima istanza esegue `npm install` nella cartella del renderer;
4. impacchetta tutto in `renderer.tar.gz` (~9,5 MB) e lo fa incorporare al
   binario con `include_bytes!`;
5. se il renderer manca, **fallisce la build** invece di produrre un binario muto.

A runtime `renderer_assets::ensure_extracted` (`renderer_assets.rs:15`) estrae
l'archivio una sola volta in
`~/.cache/xmap-studio/renderer/<versione>-<len>/` (o `$XDG_CACHE_HOME`).
La lunghezza dell'archivio fa da chiave di cache: quando il renderer cambia, la
cache si invalida da sola.

L'app funziona quindi anche senza `resources/renderer` su disco. Per rigenerare
la cache a mano: rimuovi la cartella in `~/.cache/xmap-studio/renderer/`.

### Variabili d'ambiente

| Variabile | Effetto |
|---|---|
| `XMIND_LATEX_RENDERER` | directory esplicita del renderer (massima priorità) |
| `XMIND_LATEX_NODE` | binario Node da usare (default `node`) |
| `XMIND_LATEX_ORACLE` | origine della copia del renderer a tempo di build |
| `XMIND_TEST_MAP` | mappa `.xmind` per i test end-to-end |
| `XDG_CACHE_HOME` | radice della cache del renderer |

## Release

```bash
cargo xtask appimage
```

Compila in release, assembla l'AppDir (binario + icona + `.desktop`) e produce:

```
dist/XMap_Studio-<versione>-x86_64.AppImage
```

`appimagetool` viene scaricato automaticamente in cache al primo uso; la versione
è letta da `src-tauri/Cargo.toml`.

> L'AppImage dipende dalle librerie **GTK4/libadwaita** e da **`node`** di
> sistema. Per un bundle che includa anche GTK si può aggiungere `linuxdeploy`
> con il plugin GTK.

## Convenzioni di codice

- Commenti e doc-comment in **italiano**; identificatori in inglese.
- Doc-comment di modulo (`//!`) in cima a ogni file: spiega *perché*, non *cosa*.
- Niente `unwrap()` su input utente o I/O: usa `Result` + `anyhow` con contesto
  (`with_context`), poi converti in `ErrorPayload` al confine col controller.
- La UI non fa I/O né rendering: tutto passa da `spawn_blocking`.
- Non aggiungere dipendenze senza motivo; il progetto punta a restare compatto.
- `cargo fmt` prima di ogni commit. `cargo clippy` deve restare pulito.

## Struttura del repository

```
xmind-LaTeX/
├── Cargo.toml                    # workspace + profilo di release
├── .cargo/config.toml            # alias `cargo xtask`
├── assets/                       # icona (i PNG 256/512 sono generati da icon.svg)
├── docs/                         # questa documentazione
├── demo/                         # mappa di prova con equazione
├── src-tauri/
│   ├── build.rs                  # prepara e incorpora il renderer
│   ├── resources/renderer/       # gen_equation.mjs + mathjax-full
│   ├── examples/inject.rs        # CLI di supporto
│   ├── tests/e2e_real_map.rs     # test end-to-end
│   └── src/                      # sorgenti (vedi ARCHITECTURE.md)
└── xtask/                        # task di build
```

## Generare un file di prova

```bash
cargo run --example inject -- \
  "$HOME/Nextcloud/Polimi/Logica e Algebra/Relazioni.xmind" \
  demo/Relazioni.xmap-studio.xmind \
  "Unione" 'A \cup B = B \iff A \subseteq B'
```

Apri il risultato in XMind: l'equazione appare renderizzata sotto "Unione" e,
cliccandoci sopra, si riapre l'editor equazioni nativo con il LaTeX corretto.
