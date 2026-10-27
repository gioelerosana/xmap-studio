# Formato `.xmind` e schema MathJax

Riferimento verificato su **XMind 26.03.04129**. Le regole di questa pagina non
sono opzionali: ognuna corrisponde a una trappola già incontrata. Romperne una
produce un file che XMind apre male o non riapre l'editor equazioni corretto.

## Struttura dell'archivio

Un `.xmind` moderno (Vana, XMind 2020+) è uno ZIP contenente:

| Entry | Ruolo |
|---|---|
| `content.json` | contenuto delle mappe: **array di sheet**, ognuno con `rootTopic` |
| `metadata.json` | metadati (versione struttura dati) |
| `manifest.json` | indice `file-entries` di tutte le entry |
| `content.xml` | residuo del formato legacy, non toccato |
| `resources/*` | immagini, incluse le PNG delle equazioni |
| `Thumbnails/thumbnail.png` | anteprima della mappa, **non** da preservare |

Il formato legacy XMind 8 (`content.xml` come sorgente) **non è supportato**: se
manca `content.json`, `readArchive` (`packages/core/src/archive/archive.ts`) restituisce errore.

### Come lo trattiamo

- Tutte le entry sono lette integralmente (verifica CRC implicita) e conservate
  **byte per byte**, comprese quelle sconosciute.
- Le entry `resources/*` sono tenute separate per aggiornare il manifest in modo
  affidabile (`RawArchive` in `archive/types.ts`).
- In scrittura le entry non-risorsa precedono le risorse (`buildArchiveBytes`).
- La scrittura è atomica con backup datato in una cartella nascosta
  (`.xmap-studio/backups/`, ultimi 5 per file) (`atomicWrite` in `node/atomic.ts`).

## Modello di `content.json`

`content.json` è un array di `Sheet`. Le interfacce di
`packages/core/src/model/types.ts` sono "aperte": campi noti tipizzati più una
firma d'indice `[key: string]: unknown` che cattura il resto, così le chiavi
sconosciute sopravvivono al round-trip.

```ts
interface Sheet {
  id, class, title, revisionId, rootTopic,
  topicOverlapping, arrangeableLayerOrder, zones, extensions, theme,
  relationships: Relationship[],
  [key: string]: unknown,            // ← obbligatorio
}

interface Topic {
  id, class, title, children, image, notes, notesDisplay, labels, markers,
  href, extensions, summaries: Summary[], boundaries: Boundary[],
  titleUnedited, structureClass,
  [key: string]: unknown,            // ← obbligatorio
}
```

Gruppi di figli percorsi (`CHILD_GROUPS` in `model/types.ts`): `attached`,
`detached`, `summary`, `callout`. Eventuali gruppi sconosciuti sono preservati.

Regole di serializzazione:

- Un campo assente resta assente: non si scrive mai `null` al suo posto.
- `image.width` / `image.height` restano numeri JSON, così interi e decimali
  sono preservati esattamente.
- L'ordine delle chiavi non è semanticamente rilevante per XMind; `JSON.stringify`
  mantiene l'ordine di inserimento, quindi l'output è deterministico (utile ai test).

## Campi verificati (Fase 0.5)

Estratti dal serializer di XMind 26.03.04129 (vedi
[`AGENTS.md`](../AGENTS.md) §"Verificare un campo di formato"); qui solo i nomi
e le forme.

**Topic** (oltre a quelli della struct sopra):

| Campo | Forma |
|---|---|
| `titleUnedited` | `bool` |
| `attributedTitle` | `[{ text, "fo:font-family"?, "fo:font-style"?, "fo:font-weight"?, "fo:font-size"?, "fo:color"?, "fo:text-decoration"?, "fo:text-transform"? }]` |
| `notes` | `{ plain:{content}, realHTML:{content} }` (XMind scrive entrambe; `notesDisplay` = `"icon"`/`"block"`) |
| `labels` | `[string]` |
| `image` | `{ src, width, height, align?, lockRatio?, borderColor?, borderWidth?, shadowVisible?, opacity?, isMathJaxImage? }` |
| `customWidth` | numero (larghezza manuale del blocco) |
| `href` | web `http(s)://…`/`mailto:…`, file `file:…`, topic `xmind:#<topicId>` |
| `markers` | `[{ markerId }]` |
| `position` | `{ x, y }` (topic staccati) |
| `branch` | `"folded"` o assente |
| `boundaries` | `[{ id, class:"boundary", range:"(start,end)" \| "master", title?, attributedTitle?, style? }]` |
| `summaries` | `[{ id, class:"summary", range:"(start,end)", topicId, style? }]` **+** topic in `children.summary` |
| `style` | `{ id, properties:{ "svg:fill"?, "svg:opacity"?, "fill-pattern"?, "line-color/-width/-pattern"?, "border-line-*"?, "shape-class"?, "line-class"?, "arrow-*-class"?, "fo:*"? } }` |

**Note.** Nel binario `Converter.notesDataToHTML` restituisce `realHTML.content`
così com'è (è XHTML caricato via `innerHTML`); `plainText` preferisce
`plain.content`. Il serializer di `content.json` scrive `plain` solo se
`text !== null` e `realHTML` solo se `html !== null`: vanno quindi scritte
**entrambe** le metà. `realHTML` deve avere le entità corrette *dentro* la
stringa (`&amp;`, `&lt;`, `&gt;`), mentre `JSON.stringify` lascia `<`/`>`/`&`
letterali nel JSON (nessun doppio escaping). `notesDisplay` è `"icon"`
(predefinito) o `"block"`.

**Marker.** Gli id validi sono i nomi file senza estensione sotto
`static/snowbird/resource/markers/**` (173 id unici in 26.03.04129, in 15
gruppi); `crate::markers` li espone. Su disco sono `[{ "markerId": "<id>" }]`.

**Sheet**: `id, class, title, revisionId, rootTopic, topicOverlapping,
arrangeableLayerOrder, zones, extensions, theme, relationships`.
`sheet.relationships[]` = `{ id, class:"relationship", end1Id, end2Id, title?,
attributedTitle?, controlPoints?{"0","1"}, lineEndPoints?{"0","1"},
flexibleControlPoints?, style? }` (riferimenti per id a livello sheet).

**Tema del foglio** (`sheet.theme`, osservato nei file salvati da XMind 26.x):
oggetto di sezioni `{ id, properties }` (`map`, `centralTopic`, `mainTopic`,
`subTopic`, `floatingTopic`, `summaryTopic`, `calloutTopic`, `importantTopic`,
`minorTopic`, `expiredTopic`, `boundary`, `summary`, `relationship`, `zone`,
`level3`, …) più chiavi scalari (`colorThemeId`, `skeletonThemeId`). Le
proprietà usano le chiavi di `style.properties`; `"inherited"` vuol dire "lo
decide il livello sopra". `map.properties` porta lo sfondo (`svg:fill`) e i
colori dei rami principali in `multi-line-colors` (stessa lista in
`color-list`), separati da spazi. Un riempimento c'è solo se `svg:fill` è un
colore e `fill-pattern` non è `none`. Forme: `shape-class` =
`org.xmind.topicShape.<nome>`; linee verso i figli: `line-class` =
`org.xmind.branchConnection.<nome>`. L'editor dei temi
(`packages/core/src/model/theme.ts`) scrive solo le chiavi che cambia, nelle
sezioni `map`, `centralTopic`, `mainTopic`, `subTopic` (creandole con un `id`
se mancano): tutto il resto del tema resta com'è.

**Extension provider** (enum autorevole nel binario):
`org.xmind.ui.mathJax`, `org.xmind.ui.audionotes`, `org.xmind.ui.webVideo`,
`org.xmind.ui.spreadsheet` (Matrix), `org.xmind.ui.grid`,
`org.xmind.ui.skeleton.structure.style`, `org.xmind.ui.numbering` (content
`{pattern, tiered, fixedIndex}`), `org.xmind.ui.task` (content `{priority,
progress, startDate, dueDate, assignees, dependencies, creator}`),
`org.xmind.ui.extended-style`, `org.xmind.ui.working-day-settings`.
Non esistono `org.xmind.ui.attachment` né `org.xmind.ui.equation`.

**Struttura (Fase 3).** `sheet.relationships[]` riferisce per id (`end1Id` =
sorgente, `end2Id` = destinazione); su `Topic` `boundaries[]` e `summaries[]`
usano `range:"(start,end)"` con indici **inclusivi** sui figli `attached`
(`"master"` per un boundary sull'intero ramo). Il sommario ha **doppia
rappresentazione obbligatoria**: descrittore `{id, class:"summary", range,
topicId}` + topic reale in `children.summary` con `id == topicId`. L'`id` del
descrittore è un UUID nuovo (non un hash: la nota "hash del topicId" è
superata). Alla rimozione di un figlio i range vengono riallineati e le
relazioni/descrittori orfani rimossi (`edit::remove_topic`).

**Task (Fase 5).** L'extension `org.xmind.ui.task` è gestita per le sole chiavi
scalari `priority` (1–9), `progress` (0–100), `startDate`, `dueDate` (ISO 8601);
`dependencies` e le altre chiavi restano intatte. I marker `priority-*`/`task-*`
non vengono riscritti automaticamente: restano gestibili dal pannello Marker.

**Allegati**: entry ZIP `attachments/<id>.bin` (fuori da `resources/`) +
registrazione nel `manifest.json` + link `xap:attachments/<id>.bin` sul topic.

**Marker**: il catalogo è nei file `markers/**` del binario; gli id coincidono
con il nome file senza estensione (`priority-1`, `task-half`, `flag-red`,
`star-yellow`, `smiley-smile`, `people-green`, `symbol-plus`, `tag-red`, …).

## Un topic con equazione, su disco

```json
{
  "id": "…",
  "title": "",
  "image": {
    "src": "xap:resources/<sha256>.png",
    "width": 246,
    "height": 20,
    "isMathJaxImage": true
  },
  "extensions": [
    {
      "provider": "org.xmind.ui.mathJax",
      "content": { "content": "A \\cup B = B \\iff A \\subseteq B" }
    }
  ]
}
```

## Le 12 regole

1. `image` è un **oggetto annidato**, non `imageSource`/`imageIsMathJaxImage`
   flat. Una chiave flat come `imageSource` è un errore classico: il test E2E la
   verifica esplicitamente (`packages/core/tests/e2e.test.ts`).
2. `extensions` è un **array** di `{provider, content}`.
3. Provider esatto: `org.xmind.ui.mathJax` (`MATHJAX_PROVIDER` in `model/types.ts`).
4. Il riferimento usa `xap:resources/…`; la entry nello ZIP è `resources/…`
   (senza prefisso `xap:`). Vedi `RESOURCE_PREFIX` in `model/types.ts`.
5. La PNG è **registrata in `manifest.json` → `file-entries`**.
6. `title: ""` nasconde la vista testo → l'equazione è centrata da sola.
7. `titleUnedited` va **rimosso** quando si scrive un titolo/equazione
   (`applyEquation` in `latex/equation.ts`).
8. Nessun clamp 200×200 sulle equazioni: le dimensioni reali dell'SVG.
9. `em = 1.25 × fontSizePx` (default `23.33px = 1.25 × 14pt`). Vedi
   `AppController.apply` (`controller.ts`) e `fontSizePx` (`model/utils.ts`).
10. Nome file risorsa = **SHA-256 dei byte del PNG** (`applyEquation` in `latex/equation.ts`).
11. `Thumbnails/thumbnail.png` viene rimossa (e la sua entry dal manifest) →
    rigenerata da XMind al prossimo salvataggio (`AppController.prepareArchiveBytes` e `refreshManifest` in `safety/manifest.ts`).
12. `content.xml`, `metadata.json`, `revisionId` **non vengono toccati**.

## Rendering MathJax

`renderLatexToSvg` (`packages/core/src/latex/mathjax.ts`) usa `mathjax-full` con la
stessa configurazione di XMind (input TeX con `AllPackages`, output SVG,
`display: true`). Produce un SVG standalone con dimensioni in px esplicite e
restituisce:

```json
{ "width": 112.54, "height": 19.92, "error": null }
```

- Gli errori TeX recuperabili sono letti da `data-mjx-error` sul nodo `<merror>`
  e restituiti in `error`, senza lanciare eccezioni.
- `currentColor` viene sostituito in fase di rasterizzazione (`svgToPng` in
  `latex/raster.ts`), così il PNG fallback segue il tema chiaro/scuro.
- Le unità `viewBox` di MathJax sono 1/1000 em: `px = viewBox / 1000 × emPx`.

## Validazione prima della scrittura

`validateArchiveBytes` (`packages/core/src/safety/validate.ts`) esegue, in memoria:

1. lo ZIP si riapre e ogni entry ha CRC valido;
2. `content.json` è un array JSON; `manifest.json`/`metadata.json` sono JSON validi;
3. ogni riferimento `xap:resources/X` ha la entry `resources/X` nello ZIP;
4. ogni `resources/X` presente nello ZIP è registrata nel manifest;
5. `content.json` e `metadata.json` sono nel manifest.

Se una sola fallisce, il file di destinazione non viene toccato.

## Riferimenti nel codice

- Modello: `packages/core/src/model/` (`types.ts`, `utils.ts`, `edit.ts`, tema in `theme.ts`)
- Applicazione equazione: `packages/core/src/latex/equation.ts`
- Manifest e validazione: `packages/core/src/safety/` (`manifest.ts`, `validate.ts`)
- Archivio e scrittura atomica: `packages/core/src/archive/` (`archive.ts`, `atomic.ts`)
- Renderer MathJax e rasterizzazione: `packages/core/src/latex/` (`mathjax.ts`, `raster.ts`)
