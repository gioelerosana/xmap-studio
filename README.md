# XMap Studio

Companion desktop Linux nativo di **XMind gratuito**. Apre un file `.xmind`,
mostra la mappa come lista di blocchi e permette di fare ciò che l'app nativa non
lascia fare, **restando pienamente compatibile con il formato XMind**: quello che
scrivi si riapre in XMind e si modifica lì.

Oggi sa:

- modificare i blocchi — testo, aggiunta di sotto-blocchi, eliminazione,
  spostamento con drag & drop;
- sostituire il contenuto di un blocco con una formula **LaTeX nativa**
  (MathJax), senza il pulsante "Equation" bloccato nella versione gratuita;
- arricchire il blocco con **note, etichette, marker e link**;
- aggiungere **relazioni, cornici e sommari** e collegare i blocchi;
- **allegare file** e gestire **task** (priorità, avanzamento, date) e il
  **colore del ramo**;
- **esportare** la mappa in **Markdown/OPML**, **importarla** e **unire o
  dividere** file `.xmind`, oltre a una vista **outliner** e a un'**anteprima
  grafica**;
- salvare in modo sicuro (scrittura atomica, backup nascosti, validazione).

Niente account, niente telemetria, niente webview. Apre, mostra, modifica, salva.

XMind gratuito blocca il pulsante "Equation", ma **il formato su disco accetta le
equazioni**: l'app scrive nel formato nativo, quindi in XMind la formula appare
renderizzata e **cliccandoci sopra si riapre l'editor equazioni** con il LaTeX
corretto.

La direzione del prodotto — quali capacità di XMind Free reimplementare — è in
[`docs/PRODUCT.md`](docs/PRODUCT.md).

---

## 1. Stack

| Livello | Scelta | Perché |
|---|---|---|
| UI desktop | **GTK4 + libadwaita** | nativa su GNOME/Wayland, binario unico, zero webview |
| Linguaggio | **Rust** | ZIP/JSON sicuri e veloci, rasterizzazione puro-Rust |
| Geometria | **resvg + tiny-skia** | SVG → PNG, nessun binario esterno |
| Rendering LaTeX | **mathjax-full, incorporato nel binario** | *lo stesso motore di XMind* (fedeltà garantita) |

Prerequisiti: `gtk4` e `libadwaita` di sistema e `node` nel `PATH`. Per costruire
l'AppImage servono `curl` e FUSE (`fusermount`).

---

## 2. Architettura

```
xmind-LaTeX/
├── Cargo.toml                    # workspace + profilo di release
├── .cargo/config.toml            # alias `cargo xtask`
├── assets/icon.svg               # icona (i PNG 256/512 sono generati da qui)
├── src-tauri/
│   ├── build.rs                  # prepara il renderer e lo comprime in un archivio
│   ├── resources/renderer/       # gen_equation.mjs + mathjax-full (incorporati nel binario)
│   ├── examples/inject.rs        # CLI di supporto (genera file di prova)
│   ├── tests/e2e_real_map.rs     # test end-to-end su mappa reale
│   └── src/
│       ├── main.rs, lib.rs               # entry point + run()
│       ├── gui.rs                        # UI GTK4/libadwaita + thread di lavoro
│       ├── controller.rs                 # API sincrona verso la UI
│       ├── renderer_assets.rs           # estrazione del renderer incorporato
│       ├── model.rs                      # struct con #[serde(flatten)] extra
│       ├── archive.rs                    # lettura/scrittura ZIP, atomic, backup
│       ├── equation.rs                   # applica/rimuovi equazione su un topic
│       ├── edit.rs                       # topic, struttura (relazioni/cornici/sommari)
│       ├── merge.rs                      # unione .xmind e split di un ramo
│       ├── media.rs                      # allegati (attachments/<id>.bin)
│       ├── task.rs                       # extension org.xmind.ui.task
│       ├── export.rs / import.rs         # Markdown, OPML, outliner
│       ├── markers.rs                    # catalogo marker di XMind
│       ├── layout.rs                     # layout per l'anteprima grafica (no GTK)
│       ├── mathjax.rs                    # rendering LaTeX via Node (mathjax-full)
│       ├── raster.rs                     # SVG → PNG (resvg), 3× supersampling
│       ├── validate.rs                   # validazione ZIP/JSON/risorse/manifest
│       ├── safety.rs                     # XMind aperto + conflitti su disco
│       ├── error.rs                      # ErrorPayload { code, message }
│       └── state.rs                      # workbook aperto, undo/redo, salvataggio
├── xtask/                        # `cargo xtask appimage` (task di build in Rust)
└── demo/Relazioni.xmap-studio.xmind
```

### Renderer incorporato (nessuno script esterno)

`build.rs` non richiede passi manuali:

1. se `resources/renderer/node_modules/mathjax-full` manca, lo ricostruisce
   copiando un'installazione "oracolo" (`~/.local/share/xmind-latex`) oppure, in
   ultima istanza, con `npm install`;
2. impacchetta il renderer in `renderer.tar.gz` (~9,5 MB) e lo fa incorporare al
   binario con `include_bytes!`;
3. se alla fine il renderer manca, **fallisce la build** invece di produrre un
   binario muto.

A runtime `renderer_assets.rs` estrae l'archivio una sola volta in
`~/.cache/xmap-studio/renderer/<versione>-<len>/` e da lì `node` esegue
`gen_equation.mjs`. L'app funziona quindi **anche senza `resources/renderer` su
disco** (verificato: i test passano con la cartella rimossa).

### Flusso dati

```
open(path)
  → archive::read_archive      (tutte le entry, risorse separate)
  → model::Vec<Sheet>          (campi noti tipizzati + `extra` preservato)
  → state::OpenWorkbook        (cronologia undo/redo, hash e mtime iniziali, manifest)

apply(topic_id, latex)
  → mathjax::Renderer.render   (Node: gen_equation.mjs → SVG + dimensioni + errori)
  → raster::svg_to_png         (resvg, 3×, currentColor concreto)
  → sha256(png) → resources/<sha>.png
  → aggiorna extensions[] + image{} annidato, title, titleUnedited
  → state.commit()             (snapshot per undo/redo; nulla tocca il disco)

preview(latex)
  → mathjax::Renderer.render   (SVG)
  → raster::svg_to_png         (2×)
  → gdk::Texture               (mostrata in una gtk::Picture)

save(force)
  → safety::xmind_processes    (blocca se XMind è aperto)
  → safety::has_conflict       (file cambiato su disco dall'apertura?)
  → state.build_bytes          (content.json + manifest + thumbnail rimossa)
  → validate::validate_archive_bytes  (in memoria, PRIMA di scrivere)
  → archive::atomic_write      (temp stessa dir → fsync → backup in cartella nascosta → rename → fsync dir)
  → validazione post-scrittura del file reale
```

La UI non blocca mai il main loop: apertura, rendering, applicazione e salvataggio
girano su un thread di lavoro e rientrano via `glib::MainContext::spawn_local`.
L'anteprima è debounced (~220 ms). La scoperta del renderer avviene in background
all'avvio.

Chiudendo la finestra con modifiche non salvate l'app chiede se salvare, scartare o
annullare; non si perde nulla per distrazione.

---

## 3. Formato `.xmind` (verificato su XMind 26.03.04129)

`content.json` viene letto come `Vec<Sheet>`; ogni struct cattura i campi ignoti:

```rust
#[derive(Serialize, Deserialize)]
struct Topic {
    id: Option<String>, title: Option<String>,
    image: Option<Image>, extensions: Option<Vec<Extension>>,
    children: Option<Children>,
    #[serde(flatten)] extra: serde_json::Map<String, serde_json::Value>, // ← obbligatorio
}
```

Un topic con equazione, su disco:

```json
{
  "id": "…",
  "title": "",
  "image": {
    "src": "xap:resources/<sha256>.png",
    "width": 246, "height": 20,
    "isMathJaxImage": true
  },
  "extensions": [
    { "provider": "org.xmind.ui.mathJax",
      "content": { "content": "A \\cup B = B \\iff A \\subseteq B" } }
  ]
}
```

Regole rispettate (ognuna è una trappola già incontrata):

1. `image` è un **oggetto annidato**, non `imageSource`/`imageIsMathJaxImage` flat.
2. `extensions` è un **array** di `{provider, content}`.
3. provider esatto: `org.xmind.ui.mathJax`.
4. il riferimento usa `xap:resources/…`, la entry nello ZIP è `resources/…`.
5. la PNG è **registrata in `manifest.json` → `file-entries`**.
6. `title: ""` nasconde la vista testo (equazione centrata da sola).
7. `titleUnedited` rimosso quando si scrive un titolo/equazione.
8. nessun clamp 200×200 sulle equazioni.
9. `em = 1.25 × fontSizePx` (default 23.33px = 1.25 × 14pt).
10. nome file = **SHA-256 dei byte del PNG**.
11. `Thumbnails/thumbnail.png` rimossa (e la sua entry dal manifest) → rigenerata da XMind.
12. `content.xml`, `metadata.json`, `revisionId` non vengono toccati.

---

## 4. Requisiti di robustezza

- **Round-trip preservation** — test che serializza senza modifiche e confronta i
  JSON: i campi sconosciuti restano intatti.
- **Scrittura atomica** — temp nella stessa directory → `fsync` → **backup datato**
  in una cartella nascosta (`.xmap-studio/backups/`, ultimi 5 per file)
  → `rename()` → `fsync` della directory.
- **XMind aperto** — rilevato via `/proc`; il salvataggio è **bloccato** (non un
  semplice avviso), con possibilità esplicita di forzare.
- **Conflitti** — hash del file confrontato con quello d'apertura (utile con
  Nextcloud): avviso e forzatura consapevole.
- **Validazione** — lo ZIP viene riaperto in memoria e controllato prima di
  sovrascrivere: CRC di ogni entry, JSON validi, ogni `xap:resources/X` esiste e
  è nel manifest, ogni `resources/*` è registrata. Se fallisce, il file originale
  non viene toccato.
- **Errori LaTeX** — mostrati in modo leggibile (MathJax riporta
  `data-mjx-error`), mai un crash.
- **Undo/Redo** di sessione.
- **Multi-formula**: "Applica" modifica solo in memoria; puoi applicare più
  equazioni prima di salvare (esiste anche `apply_batch`).

---

## 5. Build e avvio

Nessun npm, nessun bundler, nessuno script di setup: solo Cargo.

```bash
cargo run                 # avvio in sviluppo
cargo build --release     # binario ottimizzato (target/release/xmap-studio)
cargo test                # 30 unit + 2 end-to-end su mappa reale
cargo xtask appimage      # AppImage con icona in dist/
```

`cargo xtask appimage` compila in release, assembla l'AppDir (binario + icona +
`.desktop`) e produce:

```
dist/XMap_Studio-<versione>-x86_64.AppImage
```

`appimagetool` viene scaricato automaticamente in cache al primo uso.

> L'AppImage dipende dalle librerie **GTK4/libadwaita** e da **`node`** di sistema
> (scelte per contenere dimensione e complessità). Per un bundle che includa anche
> GTK si può aggiungere `linuxdeploy` con il plugin GTK.

### Scorciatoie

`Ctrl+O` apri · `Ctrl+S` salva · `Ctrl+Shift+S` salva con nome · `Ctrl+Z` annulla ·
`Ctrl+Shift+Z`/`Ctrl+Y` ripeti · `Ctrl+Enter` applica · `Ctrl+Shift+N` aggiungi
sotto-blocco.

Nell'albero a sinistra puoi **trascinare un blocco** su un altro per spostarlo:
rilasciando al centro diventa un sotto-blocco, sui bordi superiore/inferiore si
riordina tra i fratelli. Il rientro si aggiorna da solo.

Nella testata dell'editor il pulsante **+** aggiunge un sotto-blocco e il cestino
rosso elimina il blocco (con i suoi figli) chiedendo conferma. Esportazione SVG/PNG,
rimozione dell'equazione ed eliminazione stanno anche nel menu **☰**: si attivano
solo quando il blocco selezionato le ammette.

---

## 6. Prova end-to-end

`src-tauri/tests/e2e_real_map.rs` apre una copia reale di `Relazioni.xmind`,
applica un'equazione a una foglia, salva, **valida**, riapre e verifica:

- la forma JSON esatta (image annidata, `isMathJaxImage`, extension MathJax);
- il nome risorsa = SHA-256 del PNG, presente nello ZIP e nel manifest;
- la thumbnail rimossa;
- **tutti gli altri topic e i campi sconosciuti invariati** (`revisionId`, `theme`, …);
- il round-trip senza modifiche è semanticamente identico.

Artefatto generato e verificato:

```bash
cargo run --example inject -- \
  "$HOME/Nextcloud/Polimi/Logica e Algebra/Relazioni.xmind" \
  demo/Relazioni.xmap-studio.xmind \
  "Unione" 'A \cup B = B \iff A \subseteq B'
```

Per la conferma finale in XMind: apri `demo/Relazioni.xmap-studio.xmind`,
l'equazione appare renderizzata sotto "Unione"; cliccandoci sopra si riapre
l'editor equazioni nativo con il LaTeX corretto.

---

## 7. Deviazioni dalla specifica (motivate)

1. **Renderer LaTeX via processo Node** invece che libreria Rust. Non esiste un
   motore MathJax in Rust con pari fedeltà; la specifica stessa indica
   `mathjax-full`. Lo stesso SVG alimenta sia il PNG di fallback scritto nel file
   sia l'anteprima a schermo (rasterizzata con `resvg`), quindi le due coincidono.
   Il renderer è incorporato nel binario ed estratto in cache: nessun file esterno
   da distribuire a mano.
2. **`serde_json` senza `preserve_order`**: l'ordine delle chiavi non è
   semanticamente rilevante per XMind; l'ordinamento deterministico rende il
   round-trip test affidabile. I tipi numerici sono preservati esattamente usando
   `serde_json::Number` per `width`/`height` (interi restano interi).
3. **Risorse orfane non eliminate**: rimuovere un'equazione non cancella la PNG
   dallo ZIP (potrebbe servire all'undo e non è referenziata da nessuno). XMind la
   ignora; è una scelta a favore della sicurezza dei dati.
4. **Anteprima con em di default (23.33px)** salvo che il topic dichiari
   `fo:font-size`; la forma della formula non cambia, cambia solo la scala.
   All'atto di "Applica" il backend usa l'em effettivo del topic.
5. **Rilevamento XMind euristico su `/proc`** (Flatpak/AppImage/deb), escludendo
   il processo dell'app stessa.

## 8. Limiti noti

- Solo formato moderno (`content.json`); il legacy XMind 8 (`content.xml`) non è
  supportato e viene segnalato.
- Il rendering richiede Node.js nel `PATH` (già presente).
- Editing supportato: testo, note, etichette, marker, link e task dei blocchi;
  aggiunta, eliminazione (con i figli), spostamento (riordino/riannidamento) e
  struttura (relazioni, cornici, sommari). Restano fuori scope il rich text, la
  registrazione audio e l'editor di temi (il colore del ramo è supportato).
- L'AppImage non include GTK4/libadwaita né Node: vanno presenti sul sistema.
