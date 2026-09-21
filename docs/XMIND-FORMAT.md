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
manca `content.json`, `archive::read_archive` restituisce errore
(`archive.rs:85`).

### Come lo trattiamo

- Tutte le entry sono lette integralmente (verifica CRC implicita) e conservate
  **byte per byte**, comprese quelle sconosciute.
- Le entry `resources/*` sono tenute separate per aggiornare il manifest in modo
  affidabile (`archive.rs:59`).
- In scrittura le entry non-risorsa precedono le risorse (`archive.rs:92`).
- La scrittura è atomica con backup datato in una cartella nascosta
  (`.xmind-equation-studio/backups/`, ultimi 5 per file) (`archive.rs:209`).

## Modello di `content.json`

`content.json` è `Vec<Sheet>`. Ogni struct è "aperta": campi noti tipizzati +
`#[serde(flatten)] extra` che cattura il resto (`model.rs`).

```rust
struct Sheet {
    id, class, title, revisionId, rootTopic,
    topicOverlapping, arrangeableLayerOrder, zones, extensions, theme,
    #[serde(flatten)] extra,           // ← obbligatorio
}

struct Topic {
    id, class, title, children, image, extensions, summaries,
    titleUnedited, structureClass,
    #[serde(flatten)] extra,           // ← obbligatorio
}
```

Gruppi di figli percorsi (`model.rs:16`): `attached`, `detached`, `summary`,
`callout`. Eventuali gruppi sconosciuti sono preservati in `Children::extra`.

Regole di serializzazione:

- `skip_serializing_if = "is_none"`: un campo assente resta assente, non diventa
  `null`.
- `image.width` / `image.height` usano `serde_json::Number`, non `f64`, per
  preservare esattamente interi vs decimali (`model.rs:122`).
- L'ordine delle chiavi non è semanticamente rilevante per XMind; `serde_json`
  senza `preserve_order` produce un output deterministico (utile ai test).

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
   verifica esplicitamente (`e2e_real_map.rs:170`).
2. `extensions` è un **array** di `{provider, content}`.
3. Provider esatto: `org.xmind.ui.mathJax` (`model.rs:18`).
4. Il riferimento usa `xap:resources/…`; la entry nello ZIP è `resources/…`
   (senza prefisso `xap:`). Vedi `RESOURCE_PREFIX` in `model.rs:19`.
5. La PNG è **registrata in `manifest.json` → `file-entries`**.
6. `title: ""` nasconde la vista testo → l'equazione è centrata da sola.
7. `titleUnedited` va **rimosso** quando si scrive un titolo/equazione
   (`equation.rs:117`).
8. Nessun clamp 200×200 sulle equazioni: le dimensioni reali dell'SVG.
9. `em = 1.25 × fontSizePx` (default `23.33px = 1.25 × 14pt`). Vedi
   `controller.rs:83` e `model::font_size_px` (`model.rs:235`).
10. Nome file risorsa = **SHA-256 dei byte del PNG** (`equation.rs:91`).
11. `Thumbnails/thumbnail.png` viene rimossa (e la sua entry dal manifest) →
    rigenerata da XMind al prossimo salvataggio (`state.rs:158`).
12. `content.xml`, `metadata.json`, `revisionId` **non vengono toccati**.

## Rendering MathJax

`src-tauri/resources/renderer/gen_equation.mjs` usa `mathjax-full` con la stessa
configurazione di XMind (input TeX con `AllPackages`, output SVG, `display: true`).
Produce un SVG standalone con dimensioni in px esplicite e riporta su stdout:

```json
{ "width": 112.54, "height": 19.92, "error": null }
```

- Gli errori TeX recuperabili sono letti da `data-mjx-error` sul nodo `<merror>`
  e restituiti in `error`, senza far fallire il processo.
- `currentColor` viene sostituito in fase di rasterizzazione (`raster.rs:19`),
  così il PNG fallback segue il tema chiaro/scuro.
- Le unità `viewBox` di MathJax sono 1/1000 em: `px = viewBox / 1000 × em_px`.

## Validazione prima della scrittura

`validate::validate_archive_bytes` (`validate.rs:28`) esegue, in memoria:

1. lo ZIP si riapre e ogni entry ha CRC valido;
2. `content.json` è un array JSON; `manifest.json`/`metadata.json` sono JSON validi;
3. ogni riferimento `xap:resources/X` ha la entry `resources/X` nello ZIP;
4. ogni `resources/X` presente nello ZIP è registrata nel manifest;
5. `content.json` e `metadata.json` sono nel manifest.

Se una sola fallisce, il file di destinazione non viene toccato.

## Riferimenti nel codice

- Modello: `src-tauri/src/model.rs`
- Applicazione equazione: `src-tauri/src/equation.rs`
- Manifest e validazione: `src-tauri/src/validate.rs`
- Archivio e scrittura atomica: `src-tauri/src/archive.rs`
- Renderer Node: `src-tauri/resources/renderer/gen_equation.mjs`
