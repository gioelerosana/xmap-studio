# XMap Studio — posizionamento e roadmap

> Documento di progettazione del rebranding. **Non** descrive codice già
> esistente: fissa nome, posizionamento, inventario delle feature precluse a
> XMind Free e la roadmap. Il codice si tocca solo dopo l'ok su questo
> documento.

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
| Repo / cartella | `xmind-LaTeX` | invariata (opzionale) |
| `APP_ID` | `org.joel.xmind_equation_studio` | `org.joel.xmap_studio` |
| Crate / binario | `xmind-equation-studio` | `xmap-studio` |
| Lib | `xmind_equation_studio_lib` | `xmap_studio_lib` |
| AppImage | `XMind_Equation_Studio-*` | `XMap_Studio-*` |
| `.desktop` Name | XMind Equation Studio | XMap Studio |
| Cartella backup | `.xmind-equation-studio/` | `.xmap-studio/` |
| Cache renderer/appimagetool | `~/.cache/xmind-equation-studio/` | `~/.cache/xmap-studio/` |

Note di attuazione:

- **`safety.rs`**: il rilevamento dei processi XMind *non va indebolito*. Il
  filtro che esclude la nostra app oggi cerca `xmind-equation-studio` e
  `xmind-latex`; va aggiornato con `xmap-studio` **mantenendo** i pattern
  vecchi, così un'AppImage/branch precedente non viene scambiata per XMind.
  Aggiornare i test in `safety.rs:92` e `safety.rs:117`.
- **Compatibilità di percorso**: i vecchi backup in
  `.xmind-equation-studio/` non vanno cancellati; il nuovo nome convive, o si
  fa migrazione/fallback in lettura.
- **Trademark**: usiamo "compatibile con XMind" come descrizione, mai il
  marchio nel nome. `XMap` è un nome proprio.
- **Icona**: `assets/icon.svg` + PNG 256/512 vanno ridisegnati (richiede
  decisione grafica; nessun impatto tecnico).

## 3. Inventario: cosa XMind Free blocca

Legenda stato: **Fatto** = già in questa app · **Fattibile** = campo noto del
formato, implementazione stimata · **Da verificare** = va confermato sul campo
su XMind 26.03.04129 prima di stimare.

> Metodo di verifica (Fase 0.5): in XMind Free provare la feature, poi
> estrarre `content.json` dal file salvato (rename `.zip`) e confrontare con un
> file Pro. Nessuna feature entra in roadmap senza questo riscontro.

### 3.1 Equazioni e contenuto del topic

| Feature (Pro) | Lock Free | Su disco (`content.json`) | Stato | Priorità |
|---|---|---|---|---|
| Math Equation (LaTeX) | sì (noto) | `extensions[org.xmind.ui.mathJax]` + `image.isMathJaxImage` + PNG in `resources/` | **Fatto** | — |
| Notes | da verificare | `topic.notes.plain.content` + `topic.notes.realHTML.content` | Fattibile | Alta |
| Labels | da verificare | `topic.labels: [string]` | Fattibile | Alta |
| Markers / icone | da verificare | `topic.markers: [{markerId}]` (serve catalogo `markerId`) | Fattibile | Alta |
| Task tracking | da verificare | marker di task/priorità (`task-done`, `priority-1..7`…) + eventuale extension | Da verificare | Media |
| Topic Link (ipertesto) | da verificare | `topic.href` (+ `attributedTitle`, solo display) | Fattibile | Alta |
| Link a file/cartella locali | da verificare | `topic.href` con `file://…` | Da verificare | Media |

### 3.2 Struttura e relazioni

| Feature (Pro) | Lock Free | Su disco | Stato | Priorità |
|---|---|---|---|---|
| Relationship | da verificare | `sheet.relationships[] = {id, end1Id, end2Id, title?}` | Fattibile | Alta |
| Boundary | da verificare | `topic.boundaries[] = {id, range, title?}` | Fattibile | Media |
| Summary | da verificare | `topic.children.summary[]` + `topic.summaries[] = {id, range, topicId}` | Fattibile | Media |
| Strutture (Fishbone/Org/Timeline/Matrix) | no/parziale | `topic.structureClass`, `sheet.extensions` | Da verificare | Bassa |
| Align floating topic | da verificare | `topic.position {x,y}` per i `detached` | Fattibile | Bassa |
| Colored branch | **limitato** in Free | stile/tema del ramo | Da verificare | Media |

### 3.3 Allegati e media

| Feature (Pro) | Lock Free | Su disco | Stato | Priorità |
|---|---|---|---|---|
| Attachment | sì (noto) | `resources/` + extension di attachment sul topic | Da verificare | Media |
| Audio Notes | sì (noto) | `resources/` + extension audio (`resourceRefs`) | Da verificare | Bassa |

Audio e allegati richiedono di scoprire provider esatti e `content`: vanno
verificati prima di stimare. L'audio in più richiede registrazione/codec:
probabile scope ridotto ad **allegare** un file esistente.

### 3.4 Export / import (lato app, nessun lock di formato)

XMind Free esporta PNG/PDF con watermark, una mappa alla volta, e **blocca**
SVG/Markdown/OPML/Textbundle/Excel/Word. Sono vittorie a basso rischio perché
non toccano lo schema: leggiamo il modello già in memoria.

| Feature | Lock Free | Stato | Priorità |
|---|---|---|---|
| Export SVG | sì | Fattibile (abbiamo già `raster.rs`/SVG) | Alta |
| Export Markdown / OPML | sì | Fattibile | Alta |
| Import Markdown / OPML → mappa | sì | Fattibile | Media |
| Export PNG senza watermark | watermark in Free | Fattibile (serve layout) | Media |
| Export PDF senza watermark | watermark in Free | Fattibile (serve libreria PDF) | Bassa |
| Split mappa per ramo principale | sì | Fattibile | Bassa |
| Merge di file `.xmind` | sì | Fattibile (operazione sul modello) | Media |
| Export Excel / Word | sì | Non prioritario | — |

### 3.5 Presentazione e UI

| Feature | Lock Free | Note | Priorità |
|---|---|---|---|
| Outliner (vista testo) | sì | Solo UI, il modello c'è già | Media |
| ZEN mode (tutte le rese) | parziale | Solo UI | Bassa |
| Temi / custom theme | sì | `sheet.theme` / `topic.style`: la parte difficile è l'editor | Bassa |
| Rich text / numbering | sì | Probabile `attributedTitle`; da verificare | Bassa |
| Set Password | sì | **Fuori scope**: cifratura ZIP, rischio alto | — |

## 4. Roadmap proposta

### Fase 0 — Rebranding (nessun cambio di comportamento)
Rinomina token (§2), aggiorna icona, docs (`README`, `AGENTS`, `docs/*`),
`.desktop`, AppImage, test string. `cargo fmt && clippy && test` verdi.
**Criterio di done**: nessun riferimento a "Equation Studio" nel codice
prodotto; i file `.xmind` restano byte-compatibili.

### Fase 0.5 — Verifica dei lock
Su XMind 26.03.04129 Free: provare ogni feature "da verificare" e ispezionare
`content.json`. Output: tabella aggiornata con provider/campi reali.

### Fase 1 — Topic ricchi (alto valore, basso rischio)
Notes, Labels, Markers, Href. Campi additivi, tutti coperte da `extra`, nessuna
interazione con l'archivio se non per i media. Prima UI: pannello laterale del
topic selezionato.

### Fase 2 — Struttura visibile
Relationship, Boundary, Summary. Riguardano `sheet.relationships` e
`topic.boundaries/summaries`; serve una vista che mostri/editi le relazioni.

### Fase 3 — Interoperabilità
Export SVG/Markdown/OPML e import Markdown/OPML; merge di mappe; split per ramo.
Massimizza il distacco da XMind Free senza toccare lo schema.

### Fase 4 — Media
Attachment e audio (almeno allegare file esistenti), dopo aver confermato i
provider.

### Fase 5 — Presentazione
Outliner view, temi/stili, colored branch.

## 5. Invarianti (non negoziabili)

Valgono tutte quelle di [`AGENTS.md`](../AGENTS.md). In particolare, con
l'arrivo di nuove feature:

1. Ogni nuovo campo resta dentro struct con `#[serde(flatten)] extra`, e nessun
   campo sconosciuto si perde (§"Mai distruggere dati dell'utente").
2. Le nuove feature **non** introducono scritture dirette: si passa sempre da
   `archive::atomic_write` e da `validate::validate_archive_bytes`.
3. Il backend resta senza GTK (`controller.rs` testabile headless).
4. Nessuna nuova dipendenza se std o un crate esistente bastano.

## 6. Rischi

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Drift del formato tra versioni XMind | Feature scritte male = file rotto | Validazione + test E2E su XMind reale a ogni feature |
| Provider/campi non verificati | Implementazione inutile | Fase 0.5 obbligatoria |
| Confusione col marchio XMind | Legale | Nome proprio, solo "compatibile con" |
| Audio/cifratura | Complessità, dipendenze | Scope ridotto / fuori scope |
| Vecchi backup/percorsi | Perdita storico utente | Fallback in lettura, nessuna cancellazione |

## 7. Decisioni aperte (servono prima del codice)

1. **Nome definitivo**: `XMap Studio` confermato? In alternativa `Mappa
   Studio` se si vuole zero assonanza col marchio.
2. **Repo**: rinominare `xmind-LaTeX` (e il remote GitLab) o lasciarlo?
3. **Icona**: la ridisegno io via SVG o fornirai un asset?
4. **Ambito Fase 1**: quali tra Note / Label / Marker / Href sono davvero
   importanti per il tuo uso quotidiano?
5. **Export**: Markdown o OPML per primo? Serve anche l'import?
6. **Priorità**: confermi l'ordine di roadmap o sposti qualche fase?

## 8. Come si procede

1. Ok su questo documento (e risposte a §7).
2. Fase 0.5 di verifica su XMind Free reale.
3. Fase 0 (rebranding) su branch `refactor/xmap-studio-rebranding`, MR verso
   `main`, senza mescolare feature.
4. Le fasi successive, ognuna su branch `feat/<slug>` con test e verifica in
   XMind prima della MR.
