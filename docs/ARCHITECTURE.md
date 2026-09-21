# Architettura

App desktop Linux nativa in Rust con UI GTK4 + libadwaita. Nessun webview,
nessun runtime JS nel processo principale: MathJax gira in un processo `node`
separato e viene incorporato nel binario.

## Panoramica

```
                    ┌────────────────────────────────────────────┐
                    │ gui.rs — GTK4 + libadwaita (main thread)   │
                    │  ListView, TextView, Picture, azioni, CSS  │
                    └───────────────┬────────────────────────────┘
                                    │ chiamate sincrone (thread di lavoro)
                                    │ ritorno via glib::MainContext::spawn_local
                    ┌───────────────▼────────────────────────────┐
                    │ controller.rs — AppController              │
                    │  unica porta verso la logica backend       │
                    └───────────────┬────────────────────────────┘
             ┌──────────────────────┼───────────────────────┐
             ▼                      ▼                       ▼
      state.rs               equation.rs            mathjax.rs (Node)
   OpenWorkbook +           applica/rimuovi          SVG MathJax
   undo/redo + save          su un Topic
             │                      │                       │
             ▼                      ▼                       ▼
      archive.rs             model.rs                raster.rs
      ZIP + atomic           content.json           SVG → PNG (resvg)
      write + backup         tipizzato + extra
             │
             ▼
      validate.rs (+ safety.rs)
```

## Mappa dei moduli

Tutto vive in `src-tauri/src/`.

| Modulo | Responsabilità | Punti d'ingresso |
|---|---|---|
| `lib.rs` | radice della libreria, `APP_ID`, `run()` | `lib.rs:21` |
| `main.rs` | entry point del binario | `main.rs:1` |
| `gui.rs` | costruzione UI, segnali, azioni, drag & drop, thread di lavoro | `gui.rs:129`, `gui.rs:150`, `gui.rs:887` |
| `controller.rs` | API sincrona del backend, stato globale (workbook + renderer) | `controller.rs:26` |
| `state.rs` | workbook aperto, undo/redo, costruzione byte, salvataggio | `state.rs:18` |
| `model.rs` | modello tipizzato di `content.json`, traversal, `extra` preservato | `model.rs:69` |
| `archive.rs` | lettura/scrittura ZIP, hashing, scrittura atomica, backup nascosti con retention | `archive.rs:59`, `archive.rs:209` |
| `equation.rs` | applica/rimuove un'equazione su un topic | `equation.rs:61`, `equation.rs:135` |
| `edit.rs` | rinomina, aggiunge, elimina e sposta topic; note/etichette/marker/link | `edit.rs:59`, `edit.rs:66`, `edit.rs:158` |
| `export.rs` | intera mappa in Markdown / OPML (solo modello, nessuno schema) | `export.rs:13`, `export.rs:119` |
| `import.rs` | parse Markdown/OPML in albero e conversione in `Topic` | `import.rs:24`, `import.rs:82`, `import.rs:295` |
| `markers.rs` | catalogo marker verificato dal binario XMind | `markers.rs:1` |
| `mathjax.rs` | scoperta ed esecuzione del renderer Node | `mathjax.rs:30`, `mathjax.rs:90` |
| `raster.rs` | SVG → PNG con resvg/tiny-skia | `raster.rs:10` |
| `renderer_assets.rs` | estrazione del renderer incorporato in cache | `renderer_assets.rs:15` |
| `validate.rs` | validazione dell'archivio prima di scrivere | `validate.rs:28` |
| `safety.rs` | rilevamento XMind aperto e conflitti su disco | `safety.rs:12`, `safety.rs:80` |
| `error.rs` | `ErrorPayload { code, message }` verso la UI | `error.rs:7` |
| `build.rs` | prepara e impacchetta il renderer in `renderer.tar.gz` | `build.rs:20` |

Moduli fuori da `src-tauri/src/`:

- `src-tauri/examples/inject.rs` — CLI per generare file di prova.
- `src-tauri/tests/e2e_real_map.rs` — test end-to-end su mappa reale.
- `xtask/src/main.rs` — task di build (`cargo xtask appimage`).

## Flusso dati

### Apertura

```
controller.open(path)
  → state::OpenWorkbook::open           (state.rs:77)
      → archive::read_archive           (legge tutte le entry, risorse separate)
      → serde_json::from_slice → Vec<Sheet>
      → hash + mtime iniziali           (per rilevare conflitti)
  → WorkbookDto (to_dto)                (state.rs:239)
```

`content.json` viene deserializzato in `Vec<Sheet>`: i campi noti sono tipizzati,
tutto il resto finisce in `#[serde(flatten)] extra` e viene riserializzato
identico. Vedi `model.rs:69`.

### Applicazione di un'equazione

```
controller.apply(topic_id, latex, title_mode)
  → apply_batch ([BatchSpec])           (controller.rs:237)
      → renderer.render                 (mathjax.rs:90 → node gen_equation.mjs)
      → equation::apply_equation        (equation.rs:61)
          → raster::svg_to_png          (3×, `currentColor` concretizzato)
          → resource = "resources/<sha256(png)>.png"
          → aggiorna extensions[] + image{} annidato + title
      → risorse aggiunte all'archivio, commit() (snapshot undo/redo)
```

`apply_batch_inner` (`controller.rs:185`) lavora su una **copia** del contenuto:
se una formula è invalida, nulla viene modificato. "Applica" tocca solo la
memoria; il disco resta intatto fino a `Salva`.

### Salvataggio

```
controller.save(force)
  → state::OpenWorkbook::save_to        (state.rs:179)
      → safety::xmind_processes         (blocca se XMind è aperto, salvo force)
      → safety::has_conflict            (file cambiato dall'apertura?)
      → build_bytes                     (state.rs:149)
          → serializza content.json
          → rimuove Thumbnails/thumbnail.png
          → validate::refresh_manifest  (registra risorse, elimina thumbnail)
          → build_archive_bytes in memoria
          → validate::validate_archive_bytes  (PRIMA di scrivere)
      → archive::atomic_write           (archive.rs:209)
          → temp nella stessa dir → fsync → backup (cartella nascosta) → rename → fsync dir
      → validazione post-scrittura del file reale
```

Lo ZIP viene riaperto e validato in memoria prima di sovrascrivere qualsiasi
cosa. Se la validazione fallisce, il file dell'utente non viene toccato.

### Export / import testuale

```
controller.export_outline(format, path)
  → export::to_markdown / to_opml        (solo modello in memoria)
  → std::fs::write (file NUOVO dell'utente, non il .xmind)

controller.import_outline(format, path)
  → import::parse → OutlineNode          (parser senza dipendenze)
  → import::node_to_topic + renderer     (le `$…$` diventano equazioni native)
  → nuova Sheet in wb.content + commit   (nessuna scrittura finché non salvi)
```

### Anteprima

```
gui::schedule_preview  (debounce ~220 ms)
  → controller.preview(latex, DEFAULT_EM_PX)
  → raster::svg_to_png (fino a 2×, colore in base al tema; scala ridotta se la
    formula supera l'altezza massima della striscia)
  → gdk::Texture mostrata in una gtk::Picture
```

### Spostamento nell'albero (drag & drop)

```
gtk::DragSource sulla riga
  → prepare: id del topic in `State::dragging` + ContentProvider (string)
gtk::DropTarget sulla riga
  → enter/motion: `drop_plan` = id sorgente + id bersaglio, rifiuta sé stesso e i
    discendenti; `drop_placement` (terzi della riga) → Into/Before/After
  → drop: controller.move_topic(...) su un thread, poi refresh e selezione
```

`edit::move_topic` (`edit.rs:158`) stacca il sotto-albero e lo reinserisce rispetto
al bersaglio, rifiutando radici e cicli. Il rientro è calcolato dal `depth` nel
DTO, quindi si aggiorna da solo dopo ogni spostamento. La mappa `State::row_ids`
associa ogni widget-riga al suo topic (il `ListItem` non è un widget).

### Chiusura della finestra

`gui::confirm_close` (`gui.rs:1615`) intercetta `close-request`: con modifiche non
salvate chiede Salva / Non salvare / Annulla. "Salva" riusa `do_save` con
`CloseAfter::Yes` (rispettando i blocchi XMind/conflitto) e chiude solo a
salvataggio riuscito; il flag `State::closing` evita il ri-prompt al rientro.

## Threading

Il main loop GTK non esegue mai lavoro pesante. Tutte le operazioni (apertura,
rendering, applicazione, salvataggio, esportazione) passano per
`gui::spawn_blocking` (`gui.rs:1060`):

```rust
fn spawn_blocking<T, F, D>(work: F, done: D)
where F: FnOnce() -> T + Send + 'static, D: FnOnce(T) + 'static
```

Un `std::thread` esegue il lavoro e invia il risultato su un `async_channel`;
il main thread lo riceve con `glib::MainContext::default().spawn_local` e invoca
la callback `done`. Lo stato condiviso è `Arc<Mutex<AppController>>`.

## Confini e invarianti

- **La UI non conosce il formato XMind.** Parla solo con `AppController` e con
  i DTO in `state.rs`/`controller.rs`.
- **Il backend non conosce GTK.** `controller.rs` non importa nulla di GTK: è
  testabile e riutilizzabile (lo fa `examples/inject.rs`).
- **Nessuna dipendenza da Tauri** nel codice attuale, nonostante i nomi ereditati
  (`src-tauri/`, DTO con suffisso `Dto`). Vedi le deviazioni nel `README.md`.
- **Il disco si tocca solo in `archive::atomic_write`.** Ogni altra operazione è
  in memoria finché non si salva.

## Vedi anche

- Formato `.xmind` e schema MathJax: [`XMIND-FORMAT.md`](XMIND-FORMAT.md)
- Build e ambiente: [`DEVELOPMENT.md`](DEVELOPMENT.md)
- Test: [`TESTING.md`](TESTING.md)
