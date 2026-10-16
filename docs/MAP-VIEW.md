# Vista mappa ad albero

La vista mappa mostra la mappa come **Logic Chart orizzontale** in stile XMind
(topic centrale a sinistra, rami di primo livello in colonna, sottoalberi verso
destra), con rami colorati e immagini/equazioni renderizzate. Sulla mappa si
seleziona, si collassa, si zooma, si **spostano i blocchi con drag & drop** e si
**piegano le relazioni** trascinandone le maniglie; il resto dell'editing passa
dall'albero laterale e dall'ispettore. Nessuna webview esterna: la vista è
un SVG dentro l'app React.

## 1. Scelte di progetto

| Tema | Scelta |
|---|---|
| Collocazione | `MapView` (`apps/web/src/components/MapView.tsx`) è la vista primaria; l'outliner testuale è `OutlineView`. |
| Equazioni nei nodi | SVG MathJax (`renderLatexToSvg`) con cache per stringa LaTeX; immagini XMind da `resources/`. |
| Interazione | Selezione, collapse/expand, pan, zoom, drag & drop dei blocchi, maniglie delle relazioni. Niente menu contestuale. |
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
- **Tree Chart** (`structureClass: org.xmind.ui.tree.right` sul topic
  centrale): la radice sta in alto a sinistra e i rami di primo livello
  scendono in colonna lungo un tronco verticale in `trunkX(radice)`
  (`LayoutNode.childrenBelow`, archi `kind: 'tree'`); i sottoalberi restano in
  stile Logic Chart. Le altre strutture usano la Logic Chart.
- **Sommari**: i topic del gruppo `summary` non stanno nella colonna dei
  figli. Sono abbinati al descrittore `summaries[]` del genitore (stesso id) e
  il loro `range` `(start,end)` decide i figli raccolti; senza descrittore
  valido raccolgono tutti i figli. Una graffa (`LayoutSummary`) abbraccia
  l'intervallo a destra del sottoalbero più largo e il topic di sommario è
  centrato sulla sua punta. Se il sommario è più alto dell'intervallo, la
  colonna si allarga attorno all'intervallo per non sovrapporsi ai fratelli.
- `Layout` espone `nodes`, `edges`, `summaries`, `relationships` e i bounds
  per il fit-to-view.

## 4. Canvas interattivo (`MapView.tsx`)

- Trasformazione CSS `translate` (pan) + `scale` (zoom 0.12–3.5×) sull'SVG; le
  coordinate dei nodi restano in "mondo".
- **Navigazione fluida**: listener `wheel` nativo non passivo (così il pinch
  non zooma la pagina). Il pinch del touchpad arriva come `wheel` con
  `ctrlKey` e zooma in modo continuo (`exp(-deltaY · k)`), ancorato al
  puntatore; la rotella semplice fa pan. Durante i gesti la trasformazione è
  applicata direttamente al DOM in `requestAnimationFrame`, senza
  ri-renderizzare i nodi React; lo stato React si allinea a gesto concluso.
  Trascinamento con inerzia; pulsanti `+`/`−` e «Adatta alla finestra»
  (`fitToView`, rieseguito al ridimensionamento) animati.
- Click sul nodo → selezione sincronizzata con l'albero laterale e l'ispettore;
  click sull'indicatore → collapse/expand.
- Cache degli SVG delle formule per stringa LaTeX; fallback al testo LaTeX se il
  render fallisce.
- **Drag & drop dei blocchi** (`map/dragTarget.ts`, funzioni pure): col mouse
  parte oltre `TAP_SLOP_PX` su un blocco non radice, al tocco con pressione
  prolungata (~400 ms); lo sfondo continua a fare pan. Sopra un blocco: fascia
  alta/bassa della metà sinistra → `before`/`after`, il resto → `into`; nello
  spazio vuoto vince il fratello vicino o il blocco più vicino a sinistra
  (così un blocco portato accanto alla radice diventa un nuovo ramo). Esc
  annulla; il rilascio chiama `moveTopic` come l'albero laterale.
- **Stile del testo**: `textStyle` (`style.properties`) e `titleRuns`
  (`attributedTitle`) resi con `map/RichTitle.tsx`; i sotto-blocchi hanno peso
  normale così il grassetto del file si distingue. Un colore del file illeggibile
  sul tema corrente (verde scuro su blocco scuro) cede al colore del blocco.
- **Relazioni** (`map/RelationshipLayer.tsx`, geometria in
  `packages/core/src/layout/relationship.ts`): forma, tratteggio, spessore,
  colore e frecce dal tema del foglio (`theme.relationship`) o dalla relazione;
  forme curved/straight/angled/zigzag ricostruite dal codice di XMind 26.03.
  `controlPoints` sono offset dal centro del blocco di estremità. Clic =
  selezione; le maniglie si trascinano (nello zig-zag spostano il tratto
  centrale, quindi cambiano entrambi i punti in un solo passo di undo); doppio
  clic su una maniglia ripristina il default.

## 5. Rischi e limiti

| Rischio | Mitigazione |
|---|---|
| Misura dei nodi stimata, non reale | `EstimatedMetrics` con limiti di larghezza; da rivalutare se servono misure esatte |
| Strutture XMind non ad albero (org, fishbone, timeline) | Rese come albero orizzontale; solo la Tree Chart verso destra ha un layout dedicato |
| Mappe grandi / molte formule | Cache SVG delle formule; MathJax gira nel renderer, non in un worker |
| Layout e rendering nel thread UI | Possibile evoluzione: spostarli in un worker |

## 6. Fuori scope

Menu contestuale sulla mappa, editing inline, export SVG/PNG della mappa, temi
personalizzati: sono voci della matrice di parità
([`PRODUCT.md`](PRODUCT.md) §4 Fase 8).
