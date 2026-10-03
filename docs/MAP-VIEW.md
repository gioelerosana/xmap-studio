# Vista mappa ad albero (Fase 7)

> Documento di progetto per la feature più importante dell'app: la
> visualizzazione interna della mappa come albero orizzontale (radice a
> sinistra, rami verso destra) in stile XMind. **L'editing resta testuale**:
> la mappa serve a orientarsi, selezionare, collassare/espandere e zoomare.
> Nessuna webview; il backend resta senza GTK.

Si appoggia alla base già presente della Fase 6 (`layout.rs` e
`show_map_preview`) e la promuove da anteprima modale a vista primaria.

## 1. Decisioni confermate

| Tema | Scelta |
|---|---|
| Collocazione | Il pannello destro diventa uno `gtk::Stack`: pagina **Mappa** (default) + pagina **Testo** (attuale editor). |
| Equazioni nei nodi | PNG renderizzato con cache (`raster::svg_to_png`), come in XMind. |
| Interazione v1 | Selezione, collapse/expand, pan/zoom. Niente menu contestuale. |
| Dati | Layout alimentato dai **DTO** (`SheetDto`/`TopicView`), non dal modello. |
| Documento | Questo file + voce in `docs/PRODUCT.md` (§4 e §8). |

## 2. Stato attuale e limiti

- `layout.rs:52` calcola già un tidy tree orizzontale, ma:
  - dimensioni **fisse** (`NODE_W`/`NODE_H`, `layout.rs:11`);
  - titolo troncato a 60 caratteri (`layout.rs:131`);
  - nessun collapse, pan o zoom;
  - dipende da `model::{Sheet, Topic}` invece che dai DTO.
- `show_map_preview` (`gui.rs:3238`) è un **dialog modale una tantum** con
  `gtk::Fixed` + `DrawingArea` cairo + `Label` sovrapposti. Non è sincronizzato
  con selezione/editing e non si aggiorna da solo.
- `controller.map_layout` (`controller.rs:783`) espone il layout dal modello.
- I DTO contengono già tutto il necessario per ricostruire l'albero senza
  toccare il modello: `WorkbookDto`/`SheetDto`/`TopicView`
  (`state.rs:40,52,98`) con `parent_id`, `depth`, `group`, `kind`, `latex`,
  `image_src`, `labels`, `markers`, `notes`, `child_count`, `fill_color`.

## 3. Architettura

```
WorkbookDto (state.rs)
   │  (sola lettura, già in memoria)
   ▼
MapModel  ── ricostruzione albero per sheet + colore ramo ereditato
   │
   ▼
layout.rs  (puro, senza GTK)
   layout(sheets, collapsed, metrics, opts) → Layout { nodes, edges, bounds }
   ▲                                        │
   │ metrics (id → w,h)                      │
   │                                        ▼
map_view.rs  (GTK/cairo + Pango)  ◄── gui.rs: State (zoom, pan, collapsed)
   DrawingArea · pan/zoom/selezione/collapse/scroll-to-selected
```

Principi:

1. **Il backend non cambia e non conosce la vista.** La mappa legge i DTO, che
   sono già l'interfaccia verso la UI (`controller.rs`).
2. **Il layout resta puro e testabile.** Riceve le dimensioni già misurate; il
   measuring con Pango gira nel modulo GUI.
3. **Niente nuove dipendenze reali.** Per il testo vettoriale si usa
   `pangocairo`, già dipendenza transitiva di `gtk4`. In alternativa il
   toy-text di cairo, ma con qualità inferiore (niente wrapping/ellissi Pango).
4. **Lo stato di vista non sporca il modello**: zoom, pan, `collapsed` e sheet
   corrente vivono in `gui.rs::State` (`gui.rs:74`).

## 4. Modello della vista

`MapModel` è costruito dai DTO (nessuna nuova serializzazione):

- un albero per ogni `SheetDto`, radice = primo topic senza `parent_id`
  (`sheet.root_topic` è già il primo nodo in pre-ordine, `state.rs:450`);
- nodo: `id`, `display_title`/`latex`, `kind`, `fill_color`, `labels`,
  `markers`, `child_count`, `group`;
- **colore del ramo ereditato**: il `fill_color` di un nodo scende ai
  discendenti finché uno non ne ridefinisce uno proprio;
- `collapsed: HashSet<String>` (in `State`) decide se un sottoalbero si salta;
- i gruppi `summary`/`callout`/`detached` sono individuati dal campo `group`
  (`TopicView.group`): in v1 vengono resi come rami secondari o esclusi.

## 5. Layout (evoluzione di `layout.rs`)

```rust
pub trait NodeMetrics {
    /// Dimensioni del blocco a partire dal nodo (testo, stile, kind).
    fn measure(&self, node: &MapNode) -> (f64, f64);
}

pub struct LayoutOpts {
    pub h_gap: f64,
    pub v_gap: f64,
    pub sheet_gap: f64,
}

pub fn layout(
    sheets: &[SheetDto],
    collapsed: &HashSet<String>,
    metrics: &dyn NodeMetrics,
    opts: LayoutOpts,
) -> Layout;
```

- Altezza **variabile** in base al testo e larghezza di colonna; wrapping Pango
  calcolato dal `metrics` del modulo GUI.
- `collapsed` salta il sottoalbero; il nodo conserva `child_count` per
  disegnare l'indicatore con il numero di figli nascosti.
- Connettori a gomito/curva stile XMind, `edges` tipizzate per `group`.
- `Layout` espone `nodes`, `edges`, `width`, `height` (bounds per fit-to-view).

Test unitari (con misura finta): albero bilanciato, centratura del genitore,
ordine dei figli, collapse, colore ereditato, bounds corrette.

## 6. Canvas interattivo (`map_view.rs`)

- Widget: `gtk::DrawingArea` + `set_draw_func` (cairo per nodi/connettori,
  Pango per il testo, `pangocairo::functions::show_layout`). In alternativa una
  subclass di `gtk::Widget` con `Snapshot`, ma richiede più boilerplate.
- **Viewport**: trasformazione cairo `translate` (pan) + `scale` (zoom
  0.2–3×). Le coordinate dei nodi restano in "mondo".
- **Gesti**:
  - `GestureDrag` → pan;
  - `GestureZoom` + Ctrl+scroll → zoom (il `GestureZoom` da solo è debole su
    desktop, servono anche pulsanti `+`/`−` e "adatta");
  - `GestureClick` → selezione;
  - doppio click sull'indicatore → collapse/expand.
- **Hit test puro** `node_at(world_x, world_y) -> Option<usize>`, testabile
  separatamente.
- **Culling**: si disegnano solo i nodi intersecanti il viewport.
- **Cache misure Pango** per `(testo, stile, larghezza)`.
- **Equazioni**: cache di texture GDK per `latex` (chiave = stringa LaTeX);
  la rasterizzazione usa `raster::svg_to_png` come già fa l'anteprima
  (`gui.rs:2019`). Fallback al segnaposto `⟨latex⟩` se il render fallisce.
- **Selezione**: bordo/ombra evidenziata; scroll automatico sul nodo selezionato.

## 7. Integrazione UI (`gui.rs`)

- Il figlio destro del `Paned` (`gui.rs:825`) diventa uno `Stack`:
  - pagina `map` → `map_view::build(...)`;
  - pagina `text` → l'attuale `editor_stack` (`gui.rs:819`).
- `adw::ViewSwitcher` (o coppia di ToggleButton) in header per passare
  Mappa/Testo; **Mappa è la pagina iniziale** all'apertura di un workbook.
- **Selezione bidirezionale**:
  - click mappa → imposta `state.selected` e `ui.selection.set_selected`
    (il `connect_selected_notify` esistente a `gui.rs:926` aggiorna già
    l'editor);
  - selezione dalla lista → evidenzia e porta in vista il nodo sulla mappa.
- `refresh()` (`gui.rs:1503`) ricostruisce anche il `MapModel`; il re-layout
  avviene solo se cambia la struttura o il testo, altrimenti solo ridisegno.
- **Selettore sheet** in cima al canvas (una sheet per volta). Le relazioni
  restano di livello sheet e verranno disegnate come archi in una fase
  successiva.
- L'azione "Anteprima grafica" del menu (`gui.rs:243`) apre/focalizza la
  pagina Mappa invece del dialog modale; il dialog viene rimosso.

## 8. Fasi incrementali (ognuna spedibile da sola)

### 7.1 — Fondamenta pure
`layout.rs` passa a input DTO, aggiunge `NodeMetrics`, `collapsed` e bounds;
test unitari. La UI continua a usare il dialog attuale per verifica visiva.
**Nessun cambio di comportamento visibile.**

### 7.2 — Canvas interattivo
Nuovo `map_view.rs`: disegno nodi/connettori, pan/zoom, selezione, collapse,
fit-to-view. Stack Mappa/Testo con switcher. Mappa come pagina iniziale.
Rimosso `show_map_preview`.

### 7.3 — Sincronia e aggiornamento live
Selezione bidirezionale, refresh su modifica/undo/redo/apertura,
scroll-to-selected, stile coerente col tema chiaro/scuro.

### 7.4 — Ricchezza visiva
Equazioni renderizzate con cache, badge marker/etichette, colore del ramo
ereditato, note (icona), selettore sheet, culling e performance su mappe grandi.

### 7.5 — Export dalla stessa layout
Export SVG/PNG su file riusando `Layout` (già previsto in
`docs/PRODUCT.md` §3.4).

## 9. Definizione di "fatto"

- `cargo fmt`, `cargo clippy --all-targets` pulito, `cargo test` verde, con
  nuovi test per layout e hit test.
- Verifica manuale su mappa reale: l'albero coincide con XMind, l'editing
  testuale si riflette in tempo reale, pan/zoom/collapse fluidi, selezione
  sincronizzata lista↔mappa.
- **Nessun impatto su formato e salvataggio**: la feature è in sola lettura sui
  DTO, quindi non servono verifiche di round-trip in XMind per 7.1–7.3.

## 10. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| `gui.rs` già enorme (3465 righe) | Tutto il nuovo codice visivo in `map_view.rs` |
| Misura Pango costosa / performance | Cache misure, culling, misura stimata al primo pass |
| Strutture XMind non ad albero (org, fishbone, timeline) | v1 rende solo lo schema `map`/`unbalanced`; le altre come albero o fuori scope |
| Floating topic / callout / boundary | v1 esclusi dal layout automatico; da rivalutare in 7.4 |
| GestureZoom debole su desktop | Ctrl+scroll e pulsanti `+`/`−`/adatta |
| Render equazioni ripetuto | Cache texture per stringa LaTeX |

## 11. Fuori scope v1

Menu contestuale sulla mappa, drag & drop dei nodi nel canvas (resta nella
lista), editing inline, rendering di relazioni/boundary/summary, export file
(rimandato a 7.5), temi personalizzati.
