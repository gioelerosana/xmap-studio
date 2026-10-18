# XMap Studio

Companion desktop Linux nativo di **XMind gratuito**. Apre un file `.xmind`,
mostra la mappa come lista di blocchi e permette di fare ciò che l'app nativa non
lascia fare, **restando pienamente compatibile con il formato XMind**: quello che
scrivi si riapre in XMind e si modifica lì.

Oggi sa:

- modificare i blocchi — testo, aggiunta di sotto-blocchi, eliminazione,
  spostamento con drag & drop nell'albero;
- sostituire il contenuto di un blocco con una formula **LaTeX nativa**
  (MathJax), senza il pulsante "Equation" bloccato nella versione gratuita;
- arricchire il blocco con **note, etichette, marker e link**, con **anteprima
  live** della formula, modalità titolo e colore;
- aggiungere **relazioni, cornici e sommari** e collegare i blocchi;
- **allegare file** e gestire **task** (priorità, avanzamento, date) e il
  **colore del ramo**;
- **esportare** la mappa in **Markdown/OPML**, esportare l'**equazione in
  SVG/PNG**, **importarla** e **unire o dividere** file `.xmind`, oltre a un'
  **anteprima grafica**;
- salvare in modo sicuro (scrittura atomica, backup nascosti, validazione) e
  non perdere nulla alla chiusura (prompt Salva/Non salvare/Annulla);
- **aprire i `.xmind` dal file manager** (doppio clic / "Apri con…").

Niente account, niente telemetria. Apre, mostra, modifica, salva.

Interfaccia minimale a tre pannelli: **albero** a sinistra (ricerca, filtri per
tipo, drag & drop), **mappa** al centro, **ispettore** del blocco a
destra (chiuso di base) (titolo, equazione, note, etichette, marker, link, colore, task,
struttura).

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
| Kernel | **TypeScript** (`@xmap/core`) | ZIP/JSON sicuri, round-trip lossless, testabile headless |
| UI | **React 19 + Vite + Tailwind** (`@xmap/web`) | componente riusabile web/desktop, design system in `@xmap/ui-kit` |
| Desktop | **Electron** (`@xmap/desktop`) | ornate system, CSD GNOME, dialogo file nativi, IPC atomico |
| Rasterizzazione | **@resvg/resvg-js** (Node) / Canvas (browser) | SVG → PNG, nessun binario esterno |
| Rendering LaTeX | **mathjax-full** dentro `@xmap/core` | *lo stesso motore di XMind* (fedeltà garantita) |

Prerequisiti: **Node ≥ 20** e **pnpm**. Il pacchetto core non dipende dalla UI
(regola storica mantenuta: backend testabile senza display).

Stack monorepo:

```
xmap-studio/
├── apps/web/          # UI React (Vite) — gira anche da sola nel browser
├── apps/desktop/      # Electron: finestra nativa + dialogo file + scrittura atomica
├── packages/core/     # modello, archive, salvataggio, renderer LaTeX, export/import, task
└── packages/ui-kit/   # design system (Button, Menu, Modal, Toast, tema)
```

---

## 2. Architettura

```
packages/core/src/
  model/         # struct Topic/Sheet con campi extra preservati (round-trip)
  archive/       # lettura/scrittura ZIP + atomic write + backup nascosti
  safety/        # validazione, manifest, rilevamento XMind aperto
  latex/         # mathjax-full (SVG) + rasterizzazione PNG
  layout/        # tidy tree puro per la vista mappa
  markers/       # catalogo marker di XMind
  task/          # extension org.xmind.ui.task (solo chiavi scalari)
  exporters/     # Markdown, OPML, outliner, import
  state/         # workbook aperto, undo/redo, DTO verso la UI
  controller.ts  # API unica verso la UI
apps/web/src/
  components/    # MapView (+ map/: editor, menu contestuale), Inspector, modali
  adapters/      # dialogo file web / Electron
apps/desktop/src # main (finestra, IPC, scrittura atomica) + preload
```

Il componente `AppController` resta l'unico punto di accesso ai dati: la UI non
conosce il formato se non tramite i DTO (`WorkbookDto`, `TopicView`). Questo
mantiene la logica testabile senza display (i test in `packages/core/tests`).

### Flusso dati

```
open(bytes)
  → readArchive               (tutte le entry, risorse separate)
  → Sheet[]                   (campi noti tipizzati + campi sconosciuti preservati)
  → OpenWorkbook              (cronologia undo/redo, manifest)

apply(topicId, latex)
  → renderLatexToSvg          (mathjax-full → SVG + dimensioni + errori)
  → svgToPng                  (@resvg/resvg-js / Canvas, 3×)
  → sha256(png) → resources/<sha>.png
  → aggiorna extensions[] + image{} annidato, titolo
  → pushHistory()             (snapshot per undo/redo; nulla tocca il disco)

preview(latex)
  → renderLatexToSvg          (SVG mostrato nell'ispettore, debounce 220 ms)

save()
  → xmindProcesses            (blocca se XMind è aperto)
  → prepareArchiveBytes       (content.json + manifest + thumbnail rimossa)
  → validateArchiveBytes      (in memoria, PRIMA di scrivere)
  → scrittura atomica         (desktop: IPC su fs; web: File System Access)
  → markSaved(path, hash)
```

L'anteprima della formula è **debounced** (~220 ms). Chiudendo la finestra con
modifiche non salvate l'app chiede se salvare, scartare o annullare.

---

## 3. Formato `.xmind` (verificato su XMind 26.03.04129)

`content.json` viene letto come `Sheet[]`; ogni interfaccia cattura i campi ignoti:

```ts
interface Topic {
  id?: string; title?: string;
  image?: Image; extensions?: Extension[];
  children?: Children;
  [key: string]: unknown;   // ← obbligatorio: campi sconosciuti preservati
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

```bash
pnpm install
pnpm dev:web        # UI nel browser su http://localhost:3000
pnpm dev:desktop    # app Electron (richiede la build web)
pnpm build          # build di core + ui-kit + web + desktop
pnpm test           # test core, round-trip e regressioni di parità
```

`pnpm build` compila nell'ordine corretto: `@xmap/core` e `@xmap/ui-kit`
(typescript), poi `@xmap/web` (Vite) e `@xmap/desktop` (Electron).

Per aprire i `.xmind` dal file manager con la versione desktop, associa il MIME
`application/xmind` all'eseguibile prodotto dal pacchetto Electron.

### Scorciatoie

`Ctrl+O` apri · `Ctrl+S` salva · `Ctrl+Shift+S` salva con nome · `Ctrl+Z` annulla ·
`Ctrl+Shift+Z`/`Ctrl+Y` ripeti · `Ctrl+Shift+N` aggiungi
sotto-blocco · `Ctrl+,` impostazioni.

Sulla mappa, come in XMind: `Tab` nuovo sotto-blocco · `Invio` nuovo blocco fratello
(`Maiusc+Invio` prima) · `F2`, `Spazio` o doppio clic per modificare il testo nel
blocco (o inizia a scrivere) · `Canc` elimina (si annulla con `Ctrl+Z`) · frecce per
spostarsi · `Ctrl+I` dettagli del blocco (barra destra, chiusa di base; anche il
pulsante in alto) · `Ctrl+Maiusc+L` formula · `Esc` chiude i dettagli, poi deseleziona.
La barra flottante sul blocco compare solo su touch. I blocchi liberi si trascinano dove vuoi.

Nell'albero a sinistra puoi **cercare**, filtrare per tipo (**Testo/Formule/
Immagini**) e **trascinare un blocco** su un altro: rilasciando al centro diventa
un sotto-blocco, sui bordi superiore/inferiore si riordina tra i fratelli.

L'ispettore a destra raccoglie l'editing del blocco selezionato: testo, equazione
LaTeX con anteprima, note, etichette, link, marker, colore del ramo, task e
struttura (relazioni, cornici, sommari). Il menu **⋮** in alto raccoglie
salva-con-nome, export/import Markdown/OPML, export equazione SVG/PNG, allega
file, unisci mappa, estrai ramo e informazioni.

---

## 6. Prova end-to-end

`packages/core/tests/e2e.test.ts` apre il file reale `demo/Relazioni.xmap-studio.xmind`,
applica un'equazione a una foglia, salva, **valida**, riapre e verifica:

- la forma JSON esatta (image annidata, `isMathJaxImage`, extension MathJax);
- il nome risorsa = SHA-256 del PNG, presente nello ZIP e nel manifest;
- la thumbnail rimossa;
- **tutti gli altri topic e i campi sconosciuti invariati** (`revisionId`, `theme`, …);
- il round-trip senza modifiche è semanticamente identico.

`packages/core/tests/task.test.ts` verifica che le chiavi scalari del task
sopravvivano al round-trip e che `dependencies`/`creator` non vengano toccati.

```bash
pnpm test
```

Per la conferma finale in XMind: apri `demo/Relazioni.xmap-studio.xmind`,
l'equazione appare renderizzata; cliccandoci sopra si riapre l'editor equazioni
nativo con il LaTeX corretto.

---

## 7. Note di implementazione (motivate)

1. **`mathjax-full` dentro `@xmap/core`**: lo stesso SVG alimenta sia il PNG
   scritto nel file sia l'anteprima a schermo, quindi coincidono per costruzione.
2. **Ordine delle chiavi JSON non rilevante** per XMind; i tipi numerici di
   `width`/`height` sono preservati.
3. **Risorse orfane non eliminate**: rimuovere un'equazione non cancella la PNG
   dallo ZIP (potrebbe servire all'undo e non è referenziata da nessuno).
4. **Anteprima con em di default (23.33px)** salvo che il topic dichiari
   `fo:font-size`; all'atto di "Applica" si usa l'em effettivo del topic.
5. **Riunione di mappe con rimappatura degli id** (`remapIds`): due file creati in
   modo indipendente possono condividere gli stessi UUID; l'unione li riscrive per
   non rompere i riferimenti.
6. **Inchiostro delle equazioni**: il PNG salvato resta nero (compatibilità con il
   tema chiaro di XMind); in tema scuro la vista mappa lo tinta solo a schermo.

## 8. Limiti noti

- Solo formato moderno (`content.json`); il legacy XMind 8 (`content.xml`) non è
  supportato e viene segnalato.
- Editing supportato: testo, note, etichette, marker, link e task dei blocchi;
  aggiunta, eliminazione (con i figli), spostamento (riordino/riannidamento) e
  struttura (relazioni, cornici, sommari). Restano fuori scope il rich text, la
  registrazione audio e l'editor di temi (il colore del ramo è supportato).
- Il desktop Electron confronta l'hash del file prima di sovrascriverlo e
  richiede conferma se XMind è aperto. Il browser non può ispezionare i processi
  del sistema; con un `FileSystemFileHandle` confronta comunque l'hash del file.
- MathJax e parte del layout vengono calcolati nel renderer React: mappe grandi
  o formule pesanti possono causare pause. Non sono ancora spostati in un
  worker.
- La build web segnala un bundle JavaScript principale sopra 500 kB e moduli
  Node esternalizzati. La build riesce; resta lavoro di packaging/performance.
