# Architettura

Nel branch `feat/ts-migration` l'implementazione attiva è il monorepo
TypeScript. `src-tauri/` conserva la precedente app Rust/GTK come riferimento
funzionale e di formato.

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
  → SVG → PNG (resvg quando disponibile, Canvas nel browser)
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
       Browser: File System Access API oppure download
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
sovrascriverlo; in assenza di handle produce un download.

## Operazioni e UI

- Modifica topic: titolo, note, etichette, link, marker, task, colore,
  relazioni, boundary e summary.
- Struttura: aggiunta, eliminazione e spostamento di sottoalberi; undo/redo.
- Interoperabilità: export Markdown/OPML/outliner, import, merge e split.
- Presentazione: ricerca e filtri nell'albero, vista mappa interattiva e
  outliner.
- Media: equazioni e immagini XMind renderizzate nella vista mappa; allegati
  mantenuti in `attachments/` e registrati nel manifest.

## Differenze architetturali dalla versione Rust

Rust usa GTK e sposta rendering/salvataggio fuori dal main loop GTK. In questa
versione TypeScript, MathJax e parte del calcolo del layout girano nel renderer
React; mappe grandi o formule pesanti possono quindi causare pause visibili.
La divisione di file e le altre scritture `.xmind` passano per la scrittura
atomica desktop o per l'API di salvataggio del browser. La suite automatica non
sostituisce l'apertura manuale del file risultante in XMind.

## Codice Rust di riferimento

`src-tauri/src/` resta utile per confrontare le invarianti. Non aggiungere
feature alla versione Rust come unica implementazione: la versione attiva è
`packages/core` + `apps/web` + `apps/desktop`. L'audit di parità è in
[`TS-MIGRATION-PARITY.md`](TS-MIGRATION-PARITY.md).
