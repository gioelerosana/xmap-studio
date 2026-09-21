# AGENTS.md — guida operativa per lo sviluppo

Istruzioni destinate agli agenti AI (e ai contributor) che lavorano su questo
repository. Leggi questa pagina prima di toccare il codice. Per il dettaglio
tecnico vedi [`docs/`](docs/README.md).

## Cos'è questo progetto

**XMap Studio** è un'app desktop Linux nativa, companion di XMind gratuito.
Apre un file `.xmind`, mostra la mappa come lista di blocchi, permette di
**modificare il contenuto** dei blocchi — testo, aggiunta di sotto-blocchi,
eliminazione, spostamento con drag & drop — e di sostituire il contenuto di un
blocco con una formula **LaTeX nativa** (MathJax), salvando in modo sicuro.
Scrive nel formato nativo di XMind, quindi in XMind la formula appare
renderizzata e cliccandoci sopra si riapre l'editor equazioni con il LaTeX
corretto.

Obiettivo: fare ciò che XMind gratuito non consente, restando compatibili con il
formato. Posizionamento, inventario delle feature e roadmap in
[`docs/PRODUCT.md`](docs/PRODUCT.md).

Niente account, niente telemetria, niente webview. Apre, mostra, modifica, salva.

- Stack: Rust + GTK4/libadwaita, resvg/tiny-skia, `mathjax-full` via Node.
- Documentazione: [`README.md`](README.md) (utente), [`docs/`](docs/README.md)
  (tecnica).
- Repository: privato su GitLab (`gitlab.com`).

## Regole non negoziabili

Queste sono le invarianti del progetto. Una modifica che le viola è un bug, non
una scelta di stile.

1. **Mai distruggere dati dell'utente.** In `content.json` ogni campo sconosciuto
   deve sopravvivere al round-trip. Le struct hanno sempre
   `#[serde(flatten)] extra` (`src-tauri/src/model.rs`). Non rimuovere mai
   `extra`, non usare `serde(default)` senza `skip_serializing_if`.
2. **Il disco si tocca solo in `archive::atomic_write`** (`archive.rs:209`):
   temp nella stessa directory → `fsync` → backup datato nella cartella nascosta
   `.xmap-studio/backups/` (ultimi 5 per file) → `rename` → `fsync`
   della directory. Non aggiungere altre scritture dirette sul file `.xmind`.
3. **Si valida prima di scrivere.** `validate_archive_bytes` (`validate.rs:28`)
   deve passare in memoria prima di sovrascrivere. Se fallisce, il file originale
   resta intatto.
4. **Il salvataggio è bloccato mentre XMind è aperto** (`safety.rs:12`), non
   semplicemente avvisato; la forzatura è sempre esplicita (`force`).
5. **Lo schema MathJax è sacro.** Rispetta le 12 regole in
   [`docs/XMIND-FORMAT.md`](docs/XMIND-FORMAT.md). In particolare: `image` è un
   oggetto annidato, `extensions` è un array, provider
   `org.xmind.ui.mathJax`, nome risorsa = SHA-256 del PNG, risorsa registrata
   nel manifest.
6. **La UI non fa lavoro pesante.** Apertura, rendering, applicazione,
   salvataggio ed esportazione passano da `gui::spawn_blocking` (`gui.rs:785`) e
   rientrano con `glib::MainContext::spawn_local`.
7. **Il backend non dipende da GTK.** `controller.rs` e i moduli sottostanti non
   importano nulla di GTK: restano testabili anche senza display.
8. **Niente nuove dipendenze senza necessità.** Il punto di forza è la
   compattezza. Prima di aggiungere un crate, chiediti se la std o una dipendenza
   esistente bastano.

## Ambiente e prerequisiti

- Rust edizione 2021, `rust-version = 1.77`.
- `gtk4` e `libadwaita` di **sistema**; `node` nel `PATH`; `npm` come fallback.
- `curl` + FUSE solo per generare l'AppImage.

```bash
sudo apt install libgtk-4-dev libadwaita-1-dev nodejs npm
```

## Comandi essenziali

```bash
cargo run                 # avvio in sviluppo
cargo build --release     # binario in target/release/
cargo test                # 65 unit + 3 end-to-end (gli skip sono attesi)
cargo fmt                 # formattazione
cargo clippy --all-targets
cargo xtask appimage      # AppImage in dist/
```

Alias `cargo xtask` definito in `.cargo/config.toml`.

### Definizione di "fatto"

Prima di considerare concluso un cambiamento:

1. `cargo fmt`
2. `cargo clippy --all-targets` pulito (niente nuovi warning)
3. `cargo test` verde (gli skip sono accettabili e motivati)
4. se hai toccato il formato `.xmind` o il salvataggio: verifica manuale in XMind
   con il file generato da `examples/inject.rs` (vedi
   [`docs/TESTING.md`](docs/TESTING.md))

## Struttura del repository

```
xmind-LaTeX/
├── Cargo.toml                    # workspace: src-tauri + xtask, profilo di release
├── .cargo/config.toml            # alias `cargo xtask`
├── .gitignore
├── AGENTS.md                     # questo file
├── README.md                     # documentazione utente
├── assets/                       # icona (PNG 256/512 generati da icon.svg)
├── docs/                         # documentazione tecnica
├── demo/                         # mappa di prova con equazione applicata
├── src-tauri/
│   ├── build.rs                  # prepara e incorpora il renderer MathJax
│   ├── resources/renderer/       # gen_equation.mjs (+ node_modules, NON versionato)
│   ├── examples/inject.rs        # CLI di supporto
│   ├── tests/e2e_real_map.rs     # test end-to-end su mappa reale
│   └── src/                      # sorgenti (mappa dei moduli in docs/ARCHITECTURE.md)
└── xtask/                        # `cargo xtask appimage`
```

Mappa dei moduli e flusso dati: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Convenzioni di codice

- **Lingua:** commenti e doc-comment in **italiano**, identificatori e API in
  inglese. I messaggi di errore mostrati all'utente sono in italiano.
- **Doc-comment di modulo** (`//!`) obbligatorio in cima a ogni file: spiega il
  *perché*, non il *cosa*.
- **Errori:** usa `Result` + `anyhow` con `with_context`; converti in
  `ErrorPayload { code, message }` al confine col controller (`error.rs`). Usa i
  codici esistenti (`CODE_*`), non stringhe letterali.
- **Niente `unwrap()`** su input utente, I/O o parsing: solo dove l'invariante è
  ovvia (es. `self.renderer.as_ref().unwrap()` dopo `ensure_renderer()`).
- **Test:** aggiungi test per nuova logica. I test che richiedono risorse esterne
  si saltano con `eprintln!`, non con `#[ignore]` (vedi `mathjax.rs`,
  `e2e_real_map.rs`).
- **Niente commenti ovunque:** commenta il non-ovvio, non ripetere il codice.

## Cosa non committare mai

`.gitignore` copre già:

- `target/` (root, `src-tauri/`, `xtask/`)
- `dist/` e `*.AppImage`
- `src-tauri/resources/renderer/node_modules/` e i `package*.json` generati
- cartella backup `.xmap-studio/`, `*.backup.*.xmind` e temp `.xmind-eq-*.tmp`
- log e file editor/OS

`Cargo.lock` è **versionato** (è un'applicazione, non una libreria). Non
aggiungere file di build o cache al repository.

## Git e GitLab

- Repository remoto: `gitlab.com`, **privato**.
- Branch principale: **`main`**.
- Commit: [Conventional Commits](https://www.conventionalcommits.org/) con tipo
  in inglese e descrizione in italiano:

  ```
  feat(equation): supporta titolo personalizzato
  fix(save): evita backup duplicati nello stesso secondo
  docs(agents): aggiorna i comandi di test
  ```

- Branch di lavoro: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `refactor/<slug>`.
- Apri una Merge Request verso `main`; non fare push diretto su `main` per
  cambiamenti non banali.
- Non riscrivere la storia di `main`, non fare force-push su `main`.

### Comandi utili

```bash
glab auth status                       # verifica login GitLab
glab repo view --web                   # apri il repo nel browser
glab mr create --fill --target-branch main
```

## Ricette rapide

### Aprire una variabile d'ambiente del renderer

| Variabile | Effetto |
|---|---|
| `XMIND_LATEX_RENDERER` | directory esplicita del renderer |
| `XMIND_LATEX_NODE` | binario Node |
| `XMIND_LATEX_ORACLE` | origine della copia a tempo di build |
| `XMIND_TEST_MAP` | mappa per i test E2E |

### Rigenerare il renderer / svuotare la cache

```bash
rm -rf ~/.cache/xmap-studio/renderer
cargo build   # build.rs ricostruisce e reincorpora il renderer
```

### Generare un file di prova e aprirlo in XMind

```bash
cargo run --example inject -- \
  "$XMIND_TEST_MAP" \
  demo/Relazioni.xmap-studio.xmind \
  "Unione" 'A \cup B = B \iff A \subseteq B'
```

### Verificare un campo di formato su XMind reale

Non serve una licenza Pro né pilotare la GUI: il binario XMind installato
contiene il serializer di `content.json` e i cataloghi (marker, strutture), e le
mappe salvate sono su disco.

1. **Bundle XMind**: `app.asar` in
   `~/.local/share/flatpak/app/net.xmind.XMind/current/active/files/main/resources/`
   (build verificata: `buildVersion 26.03.04129`; per installazioni non Flatpak
   cercare `resources/app.asar` accanto all'eseguibile).
2. **Cerca il campo/provider**:
   `rg -a -o '.{80}NOME_CAMPO.{160}' .../app.asar`. Il serializer di un topic è
   la funzione che destruttura `{id, classes, title, notes, labels, imageSource,
   …, markers, structureClass}` e costruisce l'oggetto JSON (`j.notes`,
   `j.markers`, `j.boundaries`, `j.summaries`, …). L'enum dei provider
   (`AudioNotes:"org.xmind.ui.audionotes"`, `Equation`, `Numbering`, `Task`, …)
   è la fonte autorevole: un provider non presente lì **non esiste**.
3. **Incrocia con i file reali**: `~/.var/app/net.xmind.XMind/config/Xmind/Electron v3/vana/file-cache/**/*.xmind`
   e i backup nel Trash. Estrai `content.json` con `unzip -p FILE.xmind content.json`
   e controlla i campi osservati.
4. **Aggiorna la doc**: `docs/PRODUCT.md` §3 (stato/campi/provider) e, se cambia
   lo schema o una regola, `docs/XMIND-FORMAT.md`.

Un campo si dice **Confermato** solo se compare nel serializer o in un file
reale; il *lock* della versione Free, non deducibile offline, resta l'unico
punto da verificare in UI.

### Aggiungere una regola di formato

1. Leggi [`docs/XMIND-FORMAT.md`](docs/XMIND-FORMAT.md) e verifica il campo
   reale con la ricetta §"Verificare un campo di formato su XMind reale".
2. Implementa la modifica minima in `model.rs` / `equation.rs` / `validate.rs`.
3. Aggiungi un test che dimostri la regola.
4. Aggiorna `docs/XMIND-FORMAT.md` e, se serve, il `README.md`.
5. Verifica in XMind che il file si apra e l'equazione sia editabile.

## Limiti noti (non introdurre regressioni)

- Solo formato moderno (`content.json`); il legacy XMind 8 non è supportato.
- Il rendering richiede Node.js nel `PATH`.
- Editing: testo dei blocchi, aggiunta di sotto-blocchi, eliminazione (con i
  figli) e spostamento (riordino/riannidamento) via drag & drop nell'albero.
  Restano fuori scope note, marker e temi.
- L'AppImage non include GTK4/libadwaita né Node.
- Le risorse orfane non vengono rimosse dallo ZIP (scelta a favore della
  sicurezza dei dati e dell'undo).
