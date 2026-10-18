# XMap Studio — posizionamento e roadmap

> Documento di prodotto. Fissa visione, identità, inventario delle feature
> precluse a XMind Free con i campi di formato verificati, e la roadmap. Il
> codice delle fasi si tocca solo dopo l'ok sul documento e la verifica di Fase
> 0.5.

## 1. Visione

**XMap Studio è il companion desktop di XMind gratuito.** Fa ciò che l'app
nativa non ti lascia fare — a partire dalle equazioni LaTeX — restando
**pienamente compatibile** con il formato `.xmind` moderno: tutto ciò che
scriviamo si apre e si modifica in XMind senza conversioni.

Principio guida: **il lock è nella UI, non nel formato.** XMind Free disabilita
pulsanti, ma il file su disco (ZIP + `content.json`) accetta gli stessi campi
della versione Pro. Questa app scrive quei campi direttamente, con le stesse
invarianti di sicurezza già in vigore (round-trip fedele, scrittura atomica,
validazione prima del salvataggio). Questo è il vantaggio difendibile del
prodotto.

Cosa resta fuori per scelta: account, cloud, collaborazione, AI, telemetria,
webview. La promessa è **offline, nativa, sicura, gratuita**.

## 2. Nome e identità

| Elemento | Da | A |
|---|---|---|
| Nome prodotto | XMind Equation Studio | **XMap Studio** |
| Repo / cartella | `xmind-LaTeX` | repo GitLab rinominato in `xmap-studio`; cartella locale invariata |
| `APP_ID` | `org.joel.xmind_equation_studio` | `org.joel.xmap_studio` |
| Pacchetti | — | workspace `@xmap/*` |
| Cartella backup | `.xmind-equation-studio/` | `.xmap-studio/` |

> **Stato:** attuato in Fase 0 (branch `refactor/xmap-studio-rebrand`).

Note di attuazione:

- **`safety/process.ts`** (`isXmindInvocation`): il rilevamento dei processi XMind *non va indebolito*. Il
  filtro che esclude la nostra app ora cerca `xmap-studio` **mantenendo** i
  pattern vecchi (`xmind-equation-studio`, `xmind-latex`), così una build
  o un branch precedente non viene scambiato per XMind.
- **Compatibilità di percorso**: i vecchi backup in
  `.xmind-equation-studio/` non vanno cancellati; il nuovo nome convive, o si
  fa migrazione/fallback in lettura.
- **Trademark**: usiamo "compatibile con XMind" come descrizione, mai il
  marchio nel nome. `XMap` è un nome proprio.
- **Icona**: `assets/icon.svg` + PNG 256/512, ritoccati nella palette; simbolo
  invariato, nessun impatto tecnico.

## 3. Inventario: cosa XMind Free blocca

> **Nota di metodo.** XMind non pubblica più una matrice ufficiale Free vs Pro
> per il desktop: dal 2024 il pricing è centrato su cloud e AI, e l'help
> ufficiale dice solo *"Pro = file locali, Premium = cloud"*. Le fonti usate
> qui sono la [feature matrix storica](https://xmind.app/pricing/_feature_matrix/),
> il confronto utente Free/Pro/Trial, i progetti open source che hanno
> reverse-engineerato `content.json` (`mab-go/xmind-mcp`,
> `keweixin/xmind-mcp-server`), **il binario XMind installato** (Flatpak
> `net.xmind.XMind`, `buildVersion 26.03.04129`: serializer di `content.json` e
> catalogo marker dentro `.../main/resources/app.asar`) e le **mappe reali**
> salvate da XMind su questa macchina. Il metodo è replicabile, vedi
> [`AGENTS.md`](../AGENTS.md) §"Verificare un campo di formato su XMind reale".
>
> Legenda stato: **Fatto** = già in questa app · **Confermato** = campo e
> provider estratti dal serializer di XMind 26.03.04129 o osservati su file
> reali · **Fattibile** = campo noto, implementazione stimabile · **Da
> verificare** = resta un dubbio (di norma il *lock* nella UI Free, non
> verificabile offline).
>
> **Regola di ammissione in roadmap:** il formato/provider di una feature è
> confermato a monte; prima di stimare si verifica l'unico punto non deducibile
> dal binario (cosa la UI Free blocca) con il riscontro sul campo.

### 3.1 Equazioni e contenuto del topic

| Feature (Pro) | Lock Free | Campi su disco | Provider / nota | Stato | Priorità |
|---|---|---|---|---|---|
| Math Equation (LaTeX) | sì (noto) | `image` annidato con `isMathJaxImage:true` + PNG in `resources/` | `org.xmind.ui.mathJax` (verificato) | **Fatto** | — |
| Notes | da confermare | `topic.notes = { plain:{content}, realHTML:{content} }` + `topic.notesDisplay` (`"icon"`/`"block"`) | XMind scrive entrambe le metà; plain-only ammesso ma può desincronizzarsi | **Fatto** (Fase 1) | **Alta** |
| Labels | da confermare | `topic.labels: [string]` | additivo | **Fatto** (Fase 1) | Alta |
| Markers / icone | da confermare | `topic.markers: [{markerId}]` | catalogo svg nel binario: `priority-1..9`, `task-start/oct/quarter/3oct/5oct/7oct/3quar/half/done/pause`, `flag-*`, `star-*`, `half-star-*`, `smiley-*`, `people-*`, `arrow-*`, `symbol-*`, `tag-*`, `month-*`, `week-*`, `other-*`, `celebration-*`, `c_symbol_*`/`c_simbol-*` | **Fatto** (Fase 1) | **Alta** |
| Topic Link / File Link | sì (storico) | `topic.href`: web `http(s)://…`/`mailto:…`, file `file:…`, topic `xmind:#<id>` | XMind aggiunge `attributedTitle` **solo display**: va preservato, non generato | **Fatto** (Fase 1) | **Alta** |
| Task tracking | sì | extension `org.xmind.ui.task` con `content {priority, progress, startDate, dueDate, assignees, dependencies, creator}`; marker `task-*` per lo stato | provider nativo = `org.xmind.ui.task`; `org.xmind.ui.taskInfo` esiste ma serve alla conversione cloud | **Fatto** (Fase 5) | Media |
| Rich text / numbering | sì | `topic.attributedTitle: [{text, "fo:font-*"…}]`; numbering = extension `org.xmind.ui.numbering` con `content {pattern, tiered, fixedIndex}` | run con chiavi `fo:font-family/style/weight/size`, `fo:color`, `fo:text-decoration/transform` | **Confermato** | Bassa |

### 3.2 Struttura e relazioni

| Feature (Pro) | Lock Free | Campi su disco | Provider / nota | Stato | Priorità |
|---|---|---|---|---|---|
| Relationship | da confermare | `sheet.relationships[] = {id, class:"relationship", end1Id, end2Id, title?, attributedTitle?, controlPoints?{"0","1"}, lineEndPoints?{"0","1"}, flexibleControlPoints?, style?}` | a livello sheet, riferisce per id; `end1`/`end2` = sorgente/destinazione | **Fatto** (Fase 3) | **Alta** |
| Boundary | da confermare | `topic.boundaries[] = {id, class:"boundary", range:"(start,end)" \| "master", title?, attributedTitle?, style?}` | sta sul topic **genitore**; `range` indicizza i figli | **Fatto** (Fase 3) | Media |
| Summary | da confermare | `topic.summaries[] = {id, class:"summary", range:"(start,end)", topicId, style?}` **+** topic reale in `children.summary` | doppia rappresentazione, entrambe obbligatorie; l'`id` del descrittore è un UUID nuovo | **Fatto** (Fase 3) | Media |
| Callout / floating topic | probabile | `children.callout[]`, `children.detached[]` + `topic.position {x,y}` | già percorsi dal modello | **Confermato** | Media |
| Strutture (Fishbone/Org/Timeline/Matrix/Tree table…) | no/parziale | `topic.structureClass` | default `org.xmind.ui.map.unbalanced`; catalogo reale: `map*`, `logic.*`, `org-chart.*`, `fishbone.*`, `tree.*`, `timeline.*`, `spreadsheet*`, `treetable*`, `brace.*`, `grid`, `clockwise` | **Confermato** (campo) | Bassa |
| Align floating topic | sì | `topic.position` | solo UI di allineamento | **Confermato** | Bassa |
| Colored branch | **limitato** in Free | `topic.style = {id, properties}` con chiavi `svg:fill`, `svg:opacity`, `fill-pattern`, `line-color/-width/-pattern`, `border-line-*`, `shape-class`, `line-class`, `arrow-*-class`, `fo:*` | campo confermato; la UI scrive `svg:fill`, le altre chiavi restano preservate | **Fatto** (Fase 5, solo riempimento) | Bassa |

> Non è un campo su disco ma un dettaglio utile: `topic.branch` (`"folded"` o
> assente) memorizza il ramo ripiegato, e `topic.customWidth` la larghezza
> manuale del blocco.

### 3.3 Allegati e media

| Feature (Pro) | Lock Free | Campi su disco | Provider / nota | Stato | Priorità |
|---|---|---|---|---|---|
| Attachment | da confermare | entry ZIP `attachments/<id>.bin` + registrazione in `manifest.json` + link `xap:attachments/<id>.bin` sul topic (o sotto-topic collegato) | **non è un provider**: nel binario non esiste `org.xmind.ui.attachment` | **Fatto** (Fase 4) | Media |
| Audio Notes | sì | extension `org.xmind.ui.audionotes` con `resourceRefs`; l'audio è una risorsa in `resources/` | `org.xmind.ui.audionotes` (confermato) | **Confermato** (provider) | Bassa |
| Immagini locali / sticker | sì (sticker) | `image.src = "xap:resources/…"` + `width`, `height`, `align`, `lockRatio`, `borderColor`, `borderWidth`, `shadowVisible`, `opacity` | gli sticker proprietari richiedono asset XMind (licenza) | **Confermato** (campo) | Bassa |

Gli allegati **non** passano da `resources/` né da una extension: XMind li mette
nella cartella `attachments/` dello ZIP e sul topic scrive un link
`xap:attachments/…`. Il manifest va quindi esteso alle entry non-risorsa. L'audio
in più richiede registrazione/codec: probabile scope ridotto ad **allegare** un
file esistente.

### 3.4 Export / import (lato app, nessun lock di formato)

XMind Free esporta PNG/PDF con watermark, una mappa alla volta, e **blocca**
SVG/Markdown/OPML/Textbundle/Excel/Word. Sono vittorie a basso rischio perché
non toccano lo schema: leggiamo il modello già in memoria.

| Feature | Lock Free | Stato | Priorità |
|---|---|---|---|
| Export SVG | sì | Rinviato: l'anteprima grafica (Fase 6) disegna il layout, ma l'export SVG su file resta da fare | Media |
| Export Markdown / OPML | sì | **Fatto** (Fase 2): `exporters/markdown.ts`, `exporters/opml.ts`, un `#` per sheet, `$latex$`/note/etichette; OPML con `_note`/`_equation`/`_labels` | **Alta** |
| Export PNG senza watermark | watermark in Free | Fattibile (il layout della Fase 6 è la base) | Media |
| Import Markdown / OPML → mappa | sì | **Fatto** (Fase 2): `exporters/import.ts`, crea una nuova sheet; le equazioni `$…$` diventano native (renderer) | **Alta** |
| Merge di file `.xmind` | sì | **Fatto** (Fase 2): `AppController.mergeWorkbook`, sheet accodate con id riassegnati | Media |
| Split mappa per ramo principale | sì | **Fatto** (Fase 2): `AppController.splitTopic`, ramo → mappa autonoma validata | Bassa |
| Export PDF senza watermark | watermark in Free | Fattibile (serve libreria PDF: dipendenza) | Bassa |
| Export Excel / Word | sì | Non prioritario (dipendenza pesante) | — |

### 3.5 Presentazione e UI

| Feature | Lock Free | Note | Priorità |
|---|---|---|---|
| Outliner (vista testo) | sì | **Rimosso dalla UI** (resta `export::to_outline`) | Media |
| Ricerca / filtro nell'albero | sì | **Fatto**: barra di ricerca + filtri per tipo nella colonna sinistra | Media |
| Apertura dal file manager | sì | **Fatto**: MIME `application/xmind` + `.desktop` con `Exec=… %f`, `HANDLES_OPEN`; una finestra per file | Media |
| Temi / custom theme | sì | Parziale (Fase 5): colore di ramo (`svg:fill`); l'editor di temi resta da fare | Bassa |
| ZEN mode (tutte le rese) | parziale | Solo UI | Bassa |
| Set Password | sì | **Fuori scope**: cifratura ZIP, rompe atomicità e validazione | — |

### 3.6 Trappole trasversali (valide per tutte le fasi)

1. **HTML escaping: all'opposto di come sembra.** XMind vuole `&`, `<`, `>`
   **letterali** dentro le stringhe JSON e `JSON.stringify` fa già la cosa giusta
   (escapa solo `"`, `\` e i caratteri di controllo, non `<`/`>`/`&`). Non
   introdurre quindi un encoder HTML: il rischio è doppio-escaping. L'unica
   attenzione vera è il contenuto di `realHTML`, che è XHTML e deve avere le
   proprie entità corrette *dentro* la stringa.
2. **Provider verificati nel binario.** L'insieme completo degli extension
   provider di `content.json` è quello dell'enum di XMind: `org.xmind.ui.mathJax`,
   `org.xmind.ui.audionotes`, `org.xmind.ui.webVideo`, `org.xmind.ui.spreadsheet`
   (Matrix), `org.xmind.ui.grid`, `org.xmind.ui.skeleton.structure.style`,
   `org.xmind.ui.numbering`, `org.xmind.ui.task`, `org.xmind.ui.extended-style`,
   `org.xmind.ui.working-day-settings`. Non esistono `org.xmind.ui.attachment` /
   `org.xmind.ui.equation`; `org.xmind.ui.taskInfo` è usato solo nel percorso di
   conversione cloud.
3. **Doppie rappresentazioni.** Notes (`plain` + `realHTML`), Summary
   (`topic.summaries` + `children.summary`), link (`href` + `attributedTitle`):
   se si scrive una sola metà, XMind può desincronizzarsi.
4. **`extra` è intoccabile.** Ogni nuovo campo passa da interfacce con firma
   d'indice `[key: string]: unknown` (`model/types.ts`), mai `null` aggiunti.

## 4. Roadmap proposta

Criterio di ordinamento: **valore per l'utente ÷ (rischio × sforzo × nuove
dipendenze)**. Ogni fase è spedibile da sola, su branch dedicato, MR verso
`main`, con verifica in XMind prima dell'unione.

| Fase | Obiettivo | Valore | Sforzo | Rischio formato | Dipendenze nuove |
|---|---|---|---|---|---|
| 1 | Contenuto ricco del topic | Alto | Basso | Basso (additivo) | No |
| 2 | Interoperabilità (export/import) | Alto | Basso | Nullo (nessuno schema) | No |
| 3 | Struttura visibile (relazioni) | Medio | Medio | Medio | No |
| 4 | Media (allegati, audio) | Medio | Medio/alto | Medio | Forse (codec audio) |
| 5 | Produttività (task, outliner, ricerca, temi) | Medio | Medio | Basso/medio | No |

### Fase 0 — Rebranding (fatto)
Rinomina token (§2), icona, docs, test string.
**Done:** nessun riferimento all'ex brand salvo le esclusioni legacy in
`safety/process.ts`; i file `.xmind` restano byte-compatibili.

### Fase 0.5 — Verifica dei lock e dei provider (fatta offline)
Campo e provider di §3 sono stati confermati **senza** dipendere da una licenza
Pro: estraendo il serializer di `content.json` e il catalogo marker dal binario
XMind 26.03.04129 e incrociandoli con le mappe reali salvate su disco (vedi
[`AGENTS.md`](../AGENTS.md) §"Verificare un campo di formato su XMind reale"). Resta da
confermare in UI solo cosa la versione Free blocca (colonna *Lock Free*).
**Done:** ogni riga di §3 è `Fatto`, `Confermato`, `Fattibile` con campo noto, o
esplicitamente `Fuori scope`.

### Fase 1 — Topic ricco (valore alto, rischio basso)
**Feature:** Notes, Labels, Markers (inclusi i marker di task), Href (web, file,
topic link).
**Perché prima:** sono additive, coprono i bisogni di studio/appunti, non
toccano l'archivio se non per nessuna risorsa, e sono le più probabili a essere
bloccate in Free. Riusano `extra` e la validazione esistenti.
**Dove:** `model/` (tipi + `edit.ts`), `markers/catalog.ts` (catalogo),
`controller.ts`, `state/types.ts` per il DTO, `Inspector` in `apps/web`.
**Done:** round-trip fedele con note/label/marker/href; apertura in XMind con i
valori visibili e modificabili; `pnpm build && pnpm test` verdi.
**Stato:** fatto. `model/`, `markers/` + pannello «Contenuto del
blocco» nell'`Inspector`; note scritte con entrambe le metà (plain + realHTML
escapato), catalogo marker di 173 id verificato dal binario.

### Fase 2 — Interoperabilità (nessuno schema, massimo distacco da Free)
**Feature:** export Markdown, OPML; import Markdown/OPML; merge di `.xmind`;
split per ramo principale.
**Perché seconda:** è il distacco più visibile da XMind Free e non tocca il
formato: si legge il modello in memoria.
**Dove:** `exporters/` (Markdown/OPML/outliner e import, parser senza
dipendenze), `ExportModal`/`ImportModal` in `apps/web`.
**Done:** export/import confrontati su mappe reali; nessuna dipendenza nuova.
**Stato:** **fatto**. Markdown/OPML (import che crea una nuova sheet, equazioni
`$…$` native), **merge** di file `.xmind` (sheet accodate con id e riferimenti
riassegnati, risorse e allegati copiati) e **split** di un ramo in una mappa
autonoma validata. L'**export SVG della mappa** e il **PNG senza watermark**
usano il layout della Fase 6 e restano da completare come export su file.

### Fase 3 — Struttura visibile
**Feature:** Relationship, Boundary, Summary, callout e floating topic con
`position`.
**Perché terza:** alto valore per mappe concettuali, ma richiede una vista
dedicata (le relazioni vivono a livello sheet, boundary/summary sui figli) e la
doppia rappresentazione va gestita con attenzione.
**Dove:** `model/types.ts` (`relationships`, `boundaries`, `summaries`),
`model/edit.ts`, rendering in `MapView`, editing nell'`Inspector`.
**Done:** relazioni e summary creati sopravvivono al round-trip e si vedono in
XMind; nessun riferimento orfano dopo l'eliminazione di un topic.
**Stato:** **fatto**. Tipi in `model/types.ts` (`Relationship`,
`Boundary`, `Summary`), operazioni in `model/edit.ts` con riallineamento dei range e
pulizia dei riferimenti orfani, sezione «Struttura» nel pannello del blocco
(collega a un altro blocco, cornice e sommario sui sotto-blocchi). Il callout e
il riposizionamento dei floating topic restano fuori da questa fase.

### Fase 4 — Media
**Feature:** Attachment (allegare file esistenti), poi Audio Notes solo in
modalità "allega file".
**Perché quarta:** richiede estensione di `archive/` e `safety/` per le entry
non-risorsa (`attachments/`) e una risorsa audio in `resources/`. L'audio con
registrazione/codec è probabile fuori scope.
**Dove:** `archive/` (entry `attachments/`), `safety/validate.ts` (manifest),
`AppController.attachFileToTopic`.
**Done:** allegato presente in `attachments/<id>.bin`, registrato nel manifest,
link `xap:attachments/…` sul topic, apribile da XMind; le risorse orfane restano
(scelta di sicurezza).
**Stato:** **fatto** per gli allegati generici (`AppController.attachFileToTopic`). Le Audio Notes restano fuori scope in questa fase: il provider è
confermato, ma servono codec/registrazione.

### Fase 5 — Produttività
**Feature:** Task tracking (marker `task-*` + extension `org.xmind.ui.task`),
Outliner, ricerca/filtro, temi/stili e colored branch.
**Perché ultima:** sono molto UI-heavy (temi, editor task, rich text) con valore
inferiore rispetto alle fasi precedenti; il formato è ormai confermato.
**Dove:** `TopicTree` (ricerca), `task/task.ts` (task),
`model/utils.ts` (colore).
**Stato:** **fatto** per task (`task/task.ts`: priorità, avanzamento, date; estensione
scritta con `dependencies` preservate), outliner (export; la vista in app è stata tolta), ricerca/filtro
(già presenti) e colore del ramo (`svg:fill`). L'editor dei temi e il rich text
restano da fare.

### Fase 6 — Anteprima grafica della mappa
**Idea:** accanto all'outliner testuale, una vista grafica della mappa — blocchi,
rami, marker, relazioni — disegnata come SVG in React a partire dal modello in memoria. Riusa i DTO già
esistenti; il costo vero è il layout dei rami e la resa del testo.
**Perché dopo:** è una feature di presentazione, non di formato: non sblocca
nulla in XMind e ha complessità di layout alta.
**Stato:** **fatto** in versione base: `layout/layout.ts` calcola il tidy tree
(orizzontale) in modo puro, `MapView` disegna nodi e connettori, colore del
ramo incluso. Restano marker,
relazioni/archi curvi e l'export SVG su file.

### Fase 7 — Vista mappa ad albero (la feature centrale)
**Idea:** promuovere la resa grafica a **vista primaria** dell'app: albero
orizzontale stile XMind (radice a sinistra, rami a destra), sempre aggiornato,
con selezione sincronizzata all'editor testuale, collapse/expand e pan/zoom.
L'editing **resta testuale**: la mappa orienta e seleziona, non edita.
**Perché ora:** è la feature che dà all'app la sua identità; la Fase 6 ne ha già
posto le basi (layout puro + canvas).
**Dove:** `packages/core/src/layout/` (input dai DTO, `NodeMetrics`, collapse,
bounds), `MapView` e `App` in `apps/web` (sincronia selezione).
**Stato:** **completata**. Dettagli in
[`MAP-VIEW.md`](MAP-VIEW.md). Decisioni: layout alimentato dai DTO, equazioni
renderizzate con cache, interazione v1 = selezione + collapse + zoom, nessuna
dipendenza nuova.

### Fase 8 — Feature parity con XMind (macro-obiettivo in corso)
**Idea:** la mappa non è più solo una vista: si edita **sulla mappa** come in
XMind, e tutto ciò che XMind mostra o permette di fare su un file locale deve
esistere anche qui — pareggiandolo, e superandolo dove Free è bloccato
(equazioni, export, task). Il riferimento è sempre il comportamento di XMind
26.x sullo stesso file, verificato col metodo di §3.
**Regola:** ogni voce della matrice passa per *render* (il file di XMind si vede
uguale) → *edit* (si modifica dall'app) → *round-trip* (XMind riapre il file
salvato e lo mostra uguale).

Legenda: ✅ fatto · 🟡 parziale · ⬜ da fare.

| Area | Feature XMind | Stato | Note |
|---|---|---|---|
| Editing sulla mappa | Drag & drop dei blocchi (riordino e riannidamento) | ✅ | `MapView`; stesse regole di `moveTopic` |
| | Modifica del titolo direttamente nel blocco (doppio clic / F2 / Spazio / digitando) | ✅ | `map/NodeEditor.tsx`; creazione + rinomina = un solo undo |
| | Tab = figlio, Invio = fratello, Canc = elimina sulla mappa | ✅ | anche Maiusc+Invio (fratello prima), frecce, Esc; eliminazione senza conferma |
| | Copia/incolla e duplica di sottoalberi | ✅ | `model/clone.ts` rigenera gli id; le risorse immagine viaggiano negli appunti; menu contestuale |
| | Selezione multipla e spostamento di gruppo | 🟡 | selezione con Maiusc/Ctrl+clic (usata dal sommario); spostamento di gruppo da fare |
| | Blocchi liberi (floating) trascinabili, `position` salvata | 🟡 | trascinabili, `position` = centro relativo alla radice (dal codice di XMind); round-trip in XMind da verificare |
| Testo | Grassetto/corsivo/sottolineato/barrato del blocco (`style.properties`) | ✅ | ispettore |
| | Formattazione parziale del titolo (`attributedTitle`) | ✅ | Ctrl+B/I/U sulla selezione nell'editor in place; round-trip in XMind da verificare |
| | Font, dimensione, colore, allineamento del testo | 🟡 | colore e dimensione letti |
| Relazioni | Forme curved/straight/angled/zigzag, tratteggio, frecce dal tema | ✅ | `layout/relationship.ts` |
| | Punti di controllo trascinabili (`controlPoints`) | ✅ | maniglie sulla relazione selezionata |
| | Creazione di una relazione trascinando dalla mappa | 🟡 | dal menu contestuale ("Collega con freccia…" + clic sul bersaglio); trascinamento da fare |
| | Titolo della relazione modificabile in place | ⬜ | |
| Struttura | Sommari (graffa + topic) e boundary | 🟡 | sommari resi e creabili su più fratelli (Ctrl+]); boundary da disegnare |
| | Logic Chart, Tree Chart | ✅ | |
| | Mind map bilanciata, org chart, fishbone, timeline, matrice | ⬜ | oggi rese come Logic Chart |
| Stile | Tema del foglio (colori, forme dei blocchi, linee dei rami) | 🟡 | colori dei rami; forme/linee dal tema da fare |
| | Forma, riempimento e bordo del singolo blocco | 🟡 | riempimento fatto |
| | Linee dei rami a gomito/curve come da tema | ⬜ | |
| Contenuto | Equazioni LaTeX native (MathJax) | ✅ | supera Free |
| | Formule `$…$` in linea nel testo del blocco | ✅ | solo resa nell'app: nel file resta testo, XMind mostra il sorgente |
| | Larghezza del blocco (`customWidth`) e dimensione delle immagini trascinabili | ✅ | maniglie sul blocco selezionato; round-trip in XMind da verificare |
| | Immagini incollate o trascinate sulla mappa | ✅ | risorsa SHA-256 in `resources/`, registrata nel manifest |
| | Note, etichette, marker, link, task, allegati, immagini | ✅ | |
| | Callout | 🟡 | letti, non disegnati come callout |
| Navigazione | Pan, zoom, fit, collapse, ricerca | ✅ | |
| | Outliner, presentazione (Pitch), focus su un ramo | 🟡 | outliner sì |
| Export | Markdown, OPML, testo | ✅ | |
| | PNG/SVG/PDF della mappa | ⬜ | |

**Ordine di attacco:** prima ciò che rende la mappa leggibile come in XMind
(stile testo, relazioni, boundary, linee del tema), poi l'editing diretto sulla
mappa (titolo in place, scorciatoie, copia/incolla, relazioni da mouse), poi le
strutture alternative e l'export grafico.

### Fuori scope (per scelta)
Cloud/account/collaborazione/AI; Set Password (cifratura ZIP); sticker e
IconFinder proprietari (asset XMind, licenza); export Word/Excel e PDF nativi
(dipendenze pesanti); registrazione audio con codec.

## 5. Invarianti (non negoziabili)

Valgono tutte quelle di [`AGENTS.md`](../AGENTS.md). In particolare, con
l'arrivo di nuove feature:

1. Ogni nuovo campo resta dentro interfacce con firma d'indice
   (`[key: string]: unknown`), e nessun
   campo sconosciuto si perde (§"Mai distruggere dati dell'utente").
2. Le nuove feature **non** introducono scritture dirette: si passa sempre da
   `atomicWrite` (`node/atomic.ts`) e da `validateArchiveBytes`
   (`safety/validate.ts`).
3. Il core resta senza dipendenze dalla UI (`controller.ts` testabile headless).
4. Nessuna nuova dipendenza se le API standard o una dipendenza esistente
   bastano.
5. Il processo principale Electron è l'unico a scrivere su disco; il renderer
   non ha accesso Node diretto.

## 6. Rischi

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Drift del formato tra versioni XMind | Feature scritte male = file rotto | Validazione + test E2E su XMind reale a ogni feature |
| Provider/campi non verificati | Implementazione inutile | Verifica offline dal binario XMind (§3, Fase 0.5); resta il solo lock Free |
| Doppie rappresentazioni (notes/summary/link) | XMind desincronizza o perde dati | Scrivere entrambe le metà, test E2E |
| Doppio escaping in `realHTML` (`&`/`<`/`>`) | Contenuto HTML corrotto | Lasciare `JSON.stringify` (scrive `<`/`>`/`&` letterali), nessun encoder HTML, test di round-trip |
| Confusione col marchio XMind | Legale | Nome proprio, solo "compatibile con" |
| Audio/cifratura/sticker | Complessità, dipendenze, licenza | Scope ridotto / fuori scope |
| Vecchi backup/percorsi | Perdita storico utente | Fallback in lettura, nessuna cancellazione |

## 7. Decisioni prese

1. **Nome**: `XMap Studio`.
2. **Repo**: rinominato su GitLab in `xmap-studio`; cartella locale `xmind-LaTeX`
   invariata.
3. **Icona**: ritocco della palette, simbolo attuale invariato.
4. **Roadmap**: ordine Fase 1 → 5 come in §4. Export/import promosso a Fase 2
   (nessuno schema, massimo distacco da Free). Notes/Labels/Markers/Href restano
   i primi perché additivi e ad alto bisogno.
5. **Fuori scope**: password ZIP, sticker/IconFinder proprietari, export
   Word/Excel e PDF nativi, registrazione audio con codec, cloud/AI/collaborazione.

## 8. Come si procede

1. **Fase 0 — rebranding**: fatto su `refactor/xmap-studio-rebrand`.
2. **Fase 0.5 — verifica di lock e provider**: fatta; campi e provider di §3
   sono confermati dal binario XMind 26.03.04129. Resta la sola conferma dei
   lock Free, da fare in UI quando serve.
3. **Fase 1 — topic ricco**: fatta (note, etichette, marker, link).
4. **Fase 2 — interoperabilità**: fatta (export/import Markdown/OPML, merge,
   split).
5. **Fase 3 — struttura**: fatta (relazioni, boundary, summary).
6. **Fase 4 — media**: fatta la parte allegati; Audio Notes fuori scope.
7. **Fase 5 — produttività**: fatto task, outliner, ricerca/filtro, colore del
   ramo; temi/rich text da fare.
8. **Fase 6 — anteprima grafica**: fatta in versione base; export SVG su file e
   resa di marker/relazioni da completare.
9. **Fase 7 — vista mappa ad albero**: completata! Piano in
   [`MAP-VIEW.md`](MAP-VIEW.md). Layout ad albero puro (`packages/core/src/layout/`), vista interattiva
   con pan/zoom/collapse (`MapView`) e integrazione primaria in UI.
10. **Fase 8 — feature parity**: in corso, matrice in §4 Fase 8. Primo
    blocco fatto: drag & drop sulla mappa, stile del testo, relazioni in stile
    XMind con punti di controllo.
11. **Ogni fase**: branch dedicato (`feat/<slug>`), MR verso `main`, test e
    verifica in XMind prima dell'unione.
