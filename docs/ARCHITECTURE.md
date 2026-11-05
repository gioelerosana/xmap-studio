# Architettura

L'implementazione è un monorepo TypeScript: `packages/core` (motore),
`packages/ui-kit` (design system), `apps/web` (UI React) e `apps/desktop`
(Electron).

## Componenti

```text
apps/desktop — Electron main + preload
     │ IPC tipizzato, dialoghi, finestre, scrittura atomica
     ▼
apps/web — React 19 + Vite
     │ DTO e azioni
     ▼
packages/core — AppController (unico accesso al workbook)
     ├── model/       modello XMind, traversal, editing
     ├── archive/     ZIP, hash, scrittura atomica e backup
     ├── safety/      validazione, manifest, rilevamento XMind su Linux
     ├── latex/       MathJax SVG, rasterizzazione PNG, schema equazione
     ├── exporters/   Markdown, OPML, outliner, import
     ├── layout/      geometria pura per la vista mappa
     ├── task/        provider org.xmind.ui.task
     ├── update/      confronto versioni e client zsync (piano dei blocchi da scaricare)
     └── markers/     catalogo marker XMind
     ▼
packages/ui-kit — componenti React condivisi
```

`AppController` e i tipi in `state/` separano il modello XMind dalla UI. I
componenti React ricevono `WorkbookDto` e invocano operazioni del controller;
non devono modificare `content.json` direttamente.

## Apertura e round-trip

```text
AppController.open(bytes)
  → readArchive                 ZIP: entry normali e resources/
  → JSON.parse(content.json)    Sheet[]; le chiavi sconosciute restano nei campi extra
  → OpenWorkbook                archivio, manifest, hash originale, undo/redo
  → WorkbookDto                 fogli e topic per albero, ispettore e mappa
```

Le interfacce di `model/types.ts` accettano chiavi aggiuntive (`[key: string]:
unknown`); la serializzazione non deve eliminare proprietà che XMap Studio non
conosce. Il formato dettagliato e lo schema MathJax sono descritti in
[`XMIND-FORMAT.md`](XMIND-FORMAT.md).

## Modifica di un'equazione

```text
controller.apply(topicId, latex)
  → MathJax SVG
  → SVG → PNG (`@resvg/resvg-js` in Node/Electron, Canvas nel browser)
  → SHA-256 → resources/<hash>.png
  → topic.extensions[] + topic.image{} + titolo
  → snapshot undo/redo in memoria
```

L'applicazione non scrive subito il file. `applyBatch` usa una copia di lavoro e
registra il batch solo se tutte le formule riescono. Le risorse orfane non si
rimuovono, così undo/redo e campi non riconosciuti restano sicuri.

## Salvataggio

```text
prepareArchiveBytes()
  → content.json e manifest aggiornati
  → thumbnail obsoleta rimossa
  → ZIP ricostruito in memoria
  → validateArchiveBytes (risorse, allegati, manifest, JSON, ZIP)
  → adapter di destinazione
       Electron: check hash → temp/fsync → backup → rename/fsync directory
       Browser: File System Access API, Nextcloud (PUT con If-Match) oppure download
  → markSaved(path, hash)
```

Nel desktop Electron il processo principale valida di nuovo i byte prima della
scrittura e rifiuta l'overwrite se il file è cambiato dall'apertura. Il controllo
di XMind in esecuzione richiede conferma esplicita per forzare il salvataggio.
Ogni workbook aperto dal file manager ha una finestra indipendente; all'interno
della stessa finestra, aprire o creare un'altra mappa chiede prima come gestire
le modifiche non salvate.

Il browser non può ispezionare i processi del sistema. Se è disponibile un
`FileSystemFileHandle`, il salvataggio confronta l'hash del file prima di
sovrascriverlo; in assenza di handle produce un download. Con un account
Nextcloud collegato la mappa si apre e si salva sul server, con l'ETag al posto
dell'hash ([`NEXTCLOUD.md`](NEXTCLOUD.md)).

## Operazioni e UI

- Modifica topic: titolo, note, etichette, link, marker, task, colore,
  relazioni, boundary e summary.
- Struttura: aggiunta, eliminazione e spostamento di sottoalberi; undo/redo.
- Interoperabilità: export Markdown/OPML/outliner, import, merge e split.
- Presentazione: ricerca e filtri nell'albero, vista mappa interattiva e
  outliner.
- Media: equazioni e immagini XMind renderizzate nella vista mappa; allegati
  mantenuti in `attachments/` e registrati nel manifest.

## Prestazioni e limiti

MathJax (caricato su richiesta, vedi sotto) e il calcolo del layout girano nel
renderer React, non in un worker; mappe grandi o formule pesanti possono quindi causare pause visibili.
Per contenerle:

- la cronologia undo/redo tiene gli snapshot come stringhe JSON (una sola
  serializzazione per modifica) e una modifica senza cambiamenti non crea un
  passo; lo stato salvato si riconosce da una revisione, non dalla posizione;
- il layout tiene in cache le dimensioni dei blocchi su due livelli: per id del
  blocco, confrontando direttamente i campi che ne determinano la misura (titolo,
  stile, font del tema, larghezza…), e per contenuto, con una chiave JSON (blocchi
  nuovi, undo). A ogni modifica si rimisurano solo i blocchi cambiati; le cache si
  svuotano quando la UI installa una nuova misura del testo o arriva MathJax;
- il `TopicView` porta solo i campi che la UI legge: niente percorso dei titoli
  né campi calcolati per nessuno (costavano un array e una regex per blocco);
- la mappa si calcola dal `SheetDto` già in stato, senza ricostruire il DTO;
- `NodeCard` e `MapEdges` sono memoizzati: selezione, editing e ridimensionamento
  ridisegnano solo i blocchi che cambiano; le immagini si codificano in base64
  una volta per risorsa;
- nell'app desktop i file passano l'IPC come `Uint8Array`, non come array di numeri.

### Avvio e caricamento su richiesta

Il bundle iniziale contiene solo ciò che serve a mostrare l'app; il resto sono
chunk separati:

- **MathJax** (`latex/mathjax-engine.ts`, circa i 2/3 del codice) si carica con
  `import()` da `loadMathJax()`. La UI lo precarica a browser libero
  (`preloadMathJax` in `apps/web/src/mathReady.ts`). `renderLatexToSvg` resta
  sincrona: se il motore non c'è ancora lancia `XmapError(CODE_RENDERER)` e ne
  avvia il caricamento. Il layout misura allora la formula come sorgente e,
  all'arrivo del motore (`onMathJaxReady`), svuota la cache delle dimensioni;
  `useMathJaxReady` fa ricalcolare layout e titoli. I percorsi che producono
  dati (`applyEquation`, `exportEquation`) usano `renderLatexToSvgAsync`, che
  attende motore e glifi: mai una misura stimata finisce nel file. I test lo
  caricano in `tests/setup.ts`.
- **Glifi di MathJax 4.** Il font `mathjax-newcm` tiene gli alfabeti meno comuni
  in file separati. `\mathbb`, `\mathcal`, `\mathfrak`, `\mathscr`, `\mathsf` e
  `\mathtt` sono precaricati da `loadMathJax()`; gli altri (es. `\text{Жизнь}`)
  arrivano alla prima formula che li usa. In quel caso `renderLatexToSvg` lancia
  "I simboli della formula sono ancora in caricamento.", avvia il caricamento e,
  a file arrivato, notifica `onMathJaxReady` e incrementa `getMathJaxVersion()`:
  chi disegna in modo sincrono si ridisegna su quella notifica. Se il file non
  si carica (offline senza cache), la formula resta come sorgente. Ogni file di
  glifi è un chunk separato, che il service worker mette in cache con il resto
  della build (uso offline).
- **JSZip** (`archive/zip.ts`) si carica alla prima apertura, salvataggio o
  validazione.
- **Finestre secondarie** (export, stampa, tema, import, impostazioni, editor
  LaTeX) sono `React.lazy` in `apps/web/src/app/lazyPanels.ts`: si montano alla
  prima apertura, poi restano montate (conservano lo stato), e si precaricano a
  browser libero.
- **React** ha un chunk suo (`manualChunks` in `vite.config.ts`), che resta in
  cache tra una release e l'altra.

### Rendering della mappa

Con mappe grandi il costo di una modifica è quasi tutto del browser (ricalcolo
dello stile e paint di migliaia di elementi SVG), non di JavaScript. Per non
aggravarlo:

- niente letture di geometria (`scrollWidth`, `getBoundingClientRect`…) in
  effetti che girano a ogni render: forzano un reflow sincrono di tutta la
  pagina. L'header adattivo misura solo quando cambiano livello, pulsanti o
  dimensioni (ResizeObserver);
- Tailwind usa `experimental.optimizeUniversalDefaults`: le variabili `--tw-*`
  stanno solo sugli elementi che usano le utility corrispondenti, non su
  `*, ::before, ::after` (≈20% in meno sul ricalcolo dello stile);
- le scorciatoie verificano un dialog aperto con `isDialogOpen()`
  (`app/dialogOpen.ts`): una sola query sul documento per pressione di tasto;
- la cronologia undo ha anche un tetto di memoria (`MAX_HISTORY_CHARS`, ~64 MB
  di testo): con mappe grandi 200 snapshot completi farebbero chiudere la PWA
  su iPad.

Un clone del DOM vivo della mappa serve a stampa ed export immagine
(`print/mapClone.ts`): per questo la mappa disegna tutti i blocchi, anche
quelli fuori schermo.
La divisione di file e le altre scritture `.xmind` passano per la scrittura
atomica desktop (`atomicWrite` in `packages/core/src/node/atomic.ts`) o per
l'API di salvataggio del browser. La suite automatica non
sostituisce l'apertura manuale del file risultante in XMind.
