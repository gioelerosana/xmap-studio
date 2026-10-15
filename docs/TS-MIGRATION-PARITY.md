# Audit di parità Rust → TypeScript

**Ambito:** `src-tauri/` è il riferimento precedente; `packages/core`,
`apps/web` e `apps/desktop` sono l'implementazione attiva. L'audit confronta
operazioni del controller, formato `.xmind`, flussi desktop/browser e interfaccia.

## Inventario

| Area | Rust di riferimento | TypeScript attivo | Esito |
|---|---|---|---|
| Apertura, round-trip e campi sconosciuti | `model.rs`, `archive.rs`, `state.rs` | `model/`, `archive/`, `state/` | Presente; round-trip della mappa demo coperto |
| Equazioni MathJax, rimozione, preview, export SVG/PNG | `equation.rs`, `mathjax.rs`, `raster.rs`, `controller.rs` | `latex/`, `AppController` | Presente; schema immagine annidata e hash PNG coperti |
| Editing, note, labels, link, marker, drag & drop, undo/redo | `edit.rs`, `gui.rs` | `model/edit.ts`, `TopicTree`, `Inspector` | Presente; validazione marker allineata |
| Task e colore del ramo | `task.rs`, `model.rs` | `task/`, `model/utils.ts`, `Inspector` | Presente; campi task sconosciuti e stile preservati |
| Relazioni, boundary e summary | `edit.rs`, `controller.rs`, `gui.rs` | `model/edit.ts`, `AppController`, `Inspector` | Presente; relazioni tra fogli diversi rifiutate |
| Allegati | `media.rs`, `validate.rs` | `AppController`, `safety/` | Presente; allegato nel manifest e conservato in merge/split |
| Markdown/OPML/outliner, import | `export.rs`, `import.rs` | `exporters/` | Presente |
| Merge e split di mappe | `merge.rs`, `controller.rs` | `AppController.mergeWorkbook/splitTopic` | Presente; collisioni allegati e id del ramo gestiti |
| Vista mappa, ricerca, filtri e outliner | `map_view.rs`, `gui.rs` | `MapView`, `TopicTreeSidebar`, `OutlineView` | Presente |
| Salvataggio, backup, XMind aperto e conflitti | `state.rs`, `archive.rs`, `safety.rs` | `atomic.ts`, IPC Electron, adapter browser | Presente nel desktop; limiti del browser sotto |
| Apertura di più file | una finestra per workbook | una finestra Electron per ogni file aperto dal sistema | Allineata |

## Difetti trovati e corretti in questo audit

- Gli allegati aggiunti da TypeScript non venivano registrati nel manifest e
  merge/split non li trasferivano correttamente. Ora si copiano solo gli allegati
  referenziati, si risolvono le collisioni e si valida il risultato.
- TypeScript accettava relazioni tra fogli e marker nuovi fuori catalogo. Ora
  rifiuta entrambi; i marker sconosciuti già presenti restano rimovibili.
- `applyBatch` poteva applicare solo una parte delle formule quando una voce
  falliva. Ora modifica una copia e committa solo il batch completo.
- Il salvataggio sovrascriveva senza confrontare il file originale; il metodo
  core poteva inoltre segnare come salvato un workbook senza aver scritto byte.
  Ora Electron e il browser con handle controllano l'hash e il core non dichiara
  salvato un file quando manca l'adapter di filesystem.
- Electron riutilizzava una sola finestra per i file aperti dal file manager e
  rimpiazzava il contenuto. Ora crea una finestra per file; la sostituzione
  manuale in una finestra chiede Salva, Non salvare o Annulla.
- Lo split Rust scriveva il nuovo `.xmind` con `std::fs::write`; ora usa
  `archive::atomic_write`, come gli altri salvataggi desktop.

## Evidenze automatiche

Baseline prima delle correzioni: 7 test core TypeScript verdi; 100 test unitari
e 7 end-to-end Rust verdi. Dopo le correzioni: 16 test core TypeScript verdi e
build completo di core, UI kit, web ed Electron. Il nuovo file
`packages/core/tests/migration-parity.test.ts` copre allegati, collisioni,
split, relazioni, marker, task/stile, import, batch atomico, conflitto su file
modificato e mancato falso-successo del salvataggio.

## Limiti rimasti

- Il browser non può rilevare i processi XMind del sistema. Il lock e la
  forzatura esplicita sono disponibili nell'app Electron.
- La build web avvisa che alcuni moduli Node vengono esternalizzati e che il
  bundle JavaScript principale supera 500 kB. Il build termina comunque; è un
  tema di packaging/performance, non una feature mancante.
- MathJax e parte del layout girano nel renderer React; a differenza del vecchio
  flusso GTK, non sono ancora spostati in un worker.
- I test non pilotano XMind: per dichiarare verificata la compatibilità finale
  bisogna aprire in XMind un archivio generato, soprattutto un file con allegati
  e un file ottenuto da split.
- Non ci sono test automatizzati di interazione UI; la parità visiva e i flussi
  di dialogo restano da provare manualmente.
