# Vista mappa ad albero

La vista mappa mostra la mappa come **Logic Chart orizzontale** in stile XMind
(topic centrale a sinistra, rami di primo livello in colonna, sottoalberi verso
destra), con rami colorati e immagini/equazioni renderizzate. **L'editing resta
nell'albero laterale e nell'ispettore**: la mappa serve a orientarsi,
selezionare, collassare/espandere e zoomare. Nessuna webview esterna: la vista è
un SVG dentro l'app React.

## 1. Scelte di progetto

| Tema | Scelta |
|---|---|
| Collocazione | `MapView` (`apps/web/src/components/MapView.tsx`) è la vista primaria; l'outliner testuale è `OutlineView`. |
| Equazioni nei nodi | SVG MathJax (`renderLatexToSvg`) con cache per stringa LaTeX; immagini XMind da `resources/`. |
| Interazione | Selezione, collapse/expand, pan e zoom. Niente menu contestuale. |
| Dati | Il layout è alimentato dai **DTO** (`SheetDto`/`TopicView`), non dal modello. |

## 2. Architettura

```text
WorkbookDto (packages/core/src/state/types.ts)
   │  sola lettura
   ▼
buildSheetTrees()      ricostruzione albero per sheet (layout/layout.ts)
   │
   ▼
layoutSheets(sheets, collapsed, metrics, opts) → Layout { nodes, edges, relationships, bounds }
   ▲ NodeMetrics (EstimatedMetrics)
   │
AppController.mapLayout(sheetIndex, collapsed)
   ▼
MapView (SVG) — stato di vista: zoom, pan, collapsed, sheet corrente
```

Principi:

1. **Il core non conosce la vista.** `packages/core/src/layout/` è geometria
   pura, testabile senza display; riceve le dimensioni dei nodi tramite
   `NodeMetrics`.
2. **Lo stato di vista non sporca il modello**: zoom, pan e `collapsed` vivono
   nel componente React.
3. **La vista è in sola lettura sui DTO**: non ha impatto su formato e
   salvataggio.

## 3. Layout (`packages/core/src/layout/`)

- Tidy tree orizzontale con altezza variabile in base al contenuto
  (`EstimatedMetrics`); spaziature in `DEFAULT_LAYOUT_OPTS` (`hGap`, `vGap`,
  `sheetGap`).
- `collapsed` salta il sottoalbero; il nodo conserva il numero di figli per
  mostrare l'indicatore.
- Colore del ramo ereditato dai discendenti (`BRANCH_COLORS`): colora connettori
  e topic principali senza trasformare ogni nodo in una card.
- I topic staccati (`group: "detached"`) sono posizionati come floating; le
  relazioni sono restituite come `LayoutRelationship`.
- `Layout` espone `nodes`, `edges` e i bounds per il fit-to-view.

## 4. Canvas interattivo (`MapView.tsx`)

- Trasformazione CSS `translate` (pan) + `scale` (zoom 0.12–3.5×) sull'SVG; le
  coordinate dei nodi restano in "mondo".
- Rotella per lo zoom, trascinamento per il pan, pulsanti `+`/`−` e «Adatta alla
  finestra» (`fitToView`, rieseguito al ridimensionamento).
- Click sul nodo → selezione sincronizzata con l'albero laterale e l'ispettore;
  click sull'indicatore → collapse/expand.
- Cache degli SVG delle formule per stringa LaTeX; fallback al testo LaTeX se il
  render fallisce.

## 5. Rischi e limiti

| Rischio | Mitigazione |
|---|---|
| Misura dei nodi stimata, non reale | `EstimatedMetrics` con limiti di larghezza; da rivalutare se servono misure esatte |
| Strutture XMind non ad albero (org, fishbone, timeline) | Rese comunque come albero orizzontale |
| Mappe grandi / molte formule | Cache SVG delle formule; MathJax gira nel renderer, non in un worker |
| Layout e rendering nel thread UI | Possibile evoluzione: spostarli in un worker |

## 6. Fuori scope

Menu contestuale sulla mappa, drag & drop dei nodi nel canvas (resta
nell'albero), editing inline, export SVG/PNG della mappa, temi personalizzati.
