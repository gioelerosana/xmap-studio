# AGENTS.md — guida operativa per lo sviluppo

Istruzioni destinate agli agenti AI (e ai contributor) che lavorano su questo
repository. Leggi questa pagina prima di toccare il codice. Per il dettaglio
tecnico vedi [`docs/`](docs/README.md).

## Cos'è questo progetto

**XMap Studio** è un'app desktop Linux, companion di XMind gratuito.
Apre un file `.xmind`, mostra la mappa come lista di blocchi, permette di
**modificare il contenuto** dei blocchi — testo, aggiunta di sotto-blocchi,
eliminazione, spostamento con drag & drop — e di sostituire il contenuto di un
blocco con una formula **LaTeX nativa** (MathJax), salvando in modo sicuro.
Scrive nel formato nativo di XMind, quindi in XMind la formula appare
renderizzata e cliccandoci sopra si riapre l'editor equazioni con il LaTeX
corretto.

Obiettivo: fare ciò che XMind gratuito non consente, restando compatibili con il
formato. Posizionamento, inventario delle feature e roadmap in
[`docs/PRODUCT.md`](docs/PRODUCT.md).

Niente account, niente telemetria. Apre, mostra, modifica, salva.

- Stack: monorepo **TypeScript** gestito con **pnpm**:
  - `packages/core` — motore (modello, archivio, sicurezza, LaTeX/MathJax,
    export, layout). Non dipende dalla UI.
  - `packages/ui-kit` — design system (vedi
    [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md)).
  - `apps/web` — UI React.
  - `apps/desktop` — shell Electron (main process + preload).
- Documentazione: [`README.md`](README.md) (utente), [`docs/`](docs/README.md)
  (tecnica).
- Repository: privato su GitLab (`gitlab.com`).

## Regole non negoziabili

Queste sono le invarianti del progetto. Una modifica che le viola è un bug, non
una scelta di stile.

1. **Mai distruggere dati dell'utente.** In `content.json` ogni campo sconosciuto
   deve sopravvivere al round-trip. I tipi in `packages/core/src/model/types.ts`
   ammettono campi extra arbitrari: non ricostruire mai gli oggetti da zero
   scartando le chiavi che non conosci.
2. **Il disco si tocca solo in `atomicWrite`**
   (`packages/core/src/node/atomic.ts`): temp nella stessa directory →
   `fsync` → backup datato nella cartella nascosta `.xmap-studio/backups/`
   (ultimi 5 per file) → `rename` → `fsync` della directory. Non aggiungere
   altre scritture dirette sul file `.xmind`.
3. **Si valida prima di scrivere.** `validateArchiveBytes`
   (`packages/core/src/safety/validate.ts`) deve passare in memoria prima di
   sovrascrivere. Se fallisce, il file originale resta intatto.
4. **Il salvataggio è bloccato mentre XMind è aperto**
   (rilevamento in `packages/core/src/safety/process.ts` e
   `packages/core/src/node/process.ts`, controllo nel desktop in `guardedSave`,
   `packages/core/src/node/guarded-save.ts`), non semplicemente avvisato; la
   forzatura è sempre esplicita (`force`).
5. **Lo schema MathJax è sacro.** Rispetta le 12 regole in
   [`docs/XMIND-FORMAT.md`](docs/XMIND-FORMAT.md). In particolare: `image` è un
   oggetto annidato, `extensions` è un array, provider
   `org.xmind.ui.mathJax`, nome risorsa = SHA-256 del PNG, risorsa registrata
   nel manifest.
6. **La UI non fa lavoro pesante.** Apertura, rendering, applicazione,
   salvataggio ed esportazione non bloccano il thread della UI: sono asincroni
   e, nell'app desktop, l'I/O su file passa dal main process Electron via IPC
   (`apps/desktop/src/main.ts`, `preload.ts`).
7. **Il core non dipende dalla UI.** `packages/core` non importa React,
   Electron né `ui-kit`: resta testabile senza display. I moduli Node
   (`node:fs`, …) vi si caricano solo con `import()` dinamico, così il core
   resta importabile anche nel browser.
8. **Niente nuove dipendenze senza necessità.** Il punto di forza è la
   compattezza. Prima di aggiungere un pacchetto npm, chiediti se la piattaforma
   o una dipendenza esistente bastano.

## Modalità di lavoro: orchestratore e sotto-agenti

**L'agente principale è un orchestratore, non un esecutore.** L'utente parla
con un solo agente principale; quell'agente pianifica, scompone, delega e
integra, ma il grosso del lavoro sul codice lo svolgono **sotto-agenti con
modelli inferiori al suo**. Esempio: se l'agente principale è Claude Opus,
delega a **Sonnet** e **Haiku**, mai ad altre istanze di Opus.

### Scelta del modello per i sotto-agenti

| Modello | Quando usarlo |
|---|---|
| **Haiku** (preferito, costa meno) | lavoro meccanico e ben specificato: rinomini, restyle, migrazioni ripetitive, aggiornamento di import/doc, test su pattern esistenti, ricerche nella codebase |
| **Sonnet** | lavoro che richiede giudizio: componenti fondanti, logica nuova in `packages/core`, formato `.xmind`, debugging non banale, refactoring trasversali |
| Modello principale | **solo** orchestrazione: piano, contratti condivisi, revisione e integrazione finale |

Parti da Haiku; sali a Sonnet solo se il compito lo richiede davvero o se Haiku
ha fallito. Non delegare compiti banali (una modifica di poche righe): falli
direttamente, uno spawn costa più del lavoro.

### Responsabilità dell'orchestratore

1. **Contratto prima del fan-out.** Scrivi tu le parti condivise da cui
   dipendono gli altri (tipi, API, token del design system, firme delle
   funzioni) e committale o fissale prima di lanciare i sotto-agenti.
2. **Compiti a file disgiunti.** Ogni sotto-agente riceve un insieme esplicito
   di file/cartelle che può toccare; due agenti in parallelo non modificano lo
   stesso file. File condivisi "caldi" (`package.json`, `pnpm-lock.yaml`,
   `packages/core/src/index.ts`, `docs/`) li tocca solo l'orchestratore.
3. **Prompt autosufficienti.** Il sotto-agente parte senza contesto: indica
   obiettivo, file ammessi, contratto da rispettare, regole non negoziabili
   rilevanti e il comando di verifica da eseguire prima di chiudere.
4. **Parallelismo reale.** Lancia insieme (nello stesso turno) i compiti
   indipendenti; serializza solo quelli che dipendono da un risultato.
5. **Verifica a freddo.** Al rientro, l'orchestratore rilegge i diff, esegue
   `pnpm build` e `pnpm test` come li eseguirebbe l'utente e, per la UI,
   controlla l'app avviata. Il lavoro di un sotto-agente non è "fatto" finché
   l'orchestratore non l'ha verificato.

### Lavoro parallelo e isolamento

- Per modifiche concorrenti sostanziose usa **worktree git isolati** (un
  worktree per sotto-agente, sotto `.claude/worktrees/`, non versionato). In un
  worktree nuovo esegui `pnpm install --frozen-lockfile` prima di buildare.
- Ogni sotto-agente lavora su un branch proprio
  (`feat/<slug>-<parte>`); l'orchestratore integra i branch nel branch di
  lavoro e risolve i conflitti.
- Nessun sotto-agente aggiunge dipendenze, fa commit su `main`, push o apre MR:
  sono decisioni dell'orchestratore (e, per push/MR, dell'utente).
- I sotto-agenti rispettano le regole non negoziabili sotto: nel prompt di
  delega richiamale esplicitamente quando il compito tocca salvataggio,
  formato `.xmind` o MathJax.

## Ambiente e prerequisiti

- Node.js (LTS) e **pnpm**.
- Per l'app desktop: Electron, installato da `pnpm install`.

```bash
pnpm install
```

## Comandi essenziali

```bash
pnpm dev:web        # UI nel browser (Vite)
pnpm dev:desktop    # app Electron (avvia da solo il server web)
pnpm build          # core → ui-kit → web → desktop
pnpm test           # test di packages/core (Vitest)
```

### Definizione di "fatto"

Prima di considerare concluso un cambiamento:

1. `pnpm build` senza errori di tipo
2. `pnpm test` verde
3. per modifiche alla UI: app avviata e controllata (`pnpm dev:web` /
   `pnpm dev:desktop`)
4. se hai toccato il formato `.xmind` o il salvataggio: verifica manuale in
   XMind con un file salvato dall'app (vedi [`docs/TESTING.md`](docs/TESTING.md))

## Struttura del repository

```
xmap-studio/
├── package.json / pnpm-workspace.yaml / pnpm-lock.yaml
├── AGENTS.md                     # questo file
├── README.md                     # documentazione utente
├── assets/                       # icona e metadati desktop
├── demo/                         # mappa di prova con equazione applicata
├── docs/                         # documentazione tecnica
├── packages/
│   ├── core/                     # motore: src/{model,archive,safety,latex,…}, tests/
│   └── ui-kit/                   # design system
└── apps/
    ├── web/                      # UI React
    └── desktop/                  # Electron (main, preload, scripts/dev.mjs)
```

Mappa dei moduli e flusso dati: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Convenzioni di codice

- **Lingua:** commenti e doc-comment in **italiano**, identificatori e API in
  inglese. I messaggi di errore mostrati all'utente sono in italiano.
- **TypeScript strict:** niente `any` dove un tipo è esprimibile; niente
  asserzioni non-null (`!`) su input utente, I/O o parsing.
- **Errori:** lancia `Error` con messaggio comprensibile all'utente; non
  inghiottire eccezioni in silenzio.
- **Test:** aggiungi test (Vitest, `packages/core/tests/`) per nuova logica. I
  test che richiedono risorse esterne si saltano esplicitamente, non falliscono.
- **Niente commenti ovunque:** commenta il non-ovvio, non ripetere il codice.

## Cosa non committare mai

`.gitignore` copre già:

- `node_modules/`, `dist/` e `*.AppImage`
- cartella backup `.xmap-studio/`, `*.backup.*.xmind` e temp `.xmind-eq-*.tmp`
- worktree dei sotto-agenti `.claude/worktrees/`
- log e file editor/OS

`pnpm-lock.yaml` è **versionato** (è un'applicazione, non una libreria). Non
aggiungere file di build o cache al repository.

## Git e GitLab

- Repository remoto: `gitlab.com`, **privato**.
- Branch principale: **`main`**.
- Commit: [Conventional Commits](https://www.conventionalcommits.org/) con tipo
  in inglese e descrizione in italiano:

  ```
  feat(equation): supporta titolo personalizzato
  fix(save): evita backup duplicati nello stesso secondo
  docs(agents): aggiorna i comandi di test
  ```

- Branch di lavoro: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `refactor/<slug>`.
- Apri una Merge Request verso `main`; non fare push diretto su `main` per
  cambiamenti non banali.
- Non riscrivere la storia di `main`, non fare force-push su `main`.

### Comandi utili

```bash
glab auth status                       # verifica login GitLab
glab repo view --web                   # apri il repo nel browser
glab mr create --fill --target-branch main
```

## Ricette rapide

### Verificare un campo di formato su XMind reale

Non serve una licenza Pro né pilotare la GUI: il binario XMind installato
contiene il serializer di `content.json` e i cataloghi (marker, strutture), e le
mappe salvate sono su disco.

1. **Bundle XMind**: `app.asar` in
   `~/.local/share/flatpak/app/net.xmind.XMind/current/active/files/main/resources/`
   (build verificata: `buildVersion 26.03.04129`; per installazioni non Flatpak
   cercare `resources/app.asar` accanto all'eseguibile).
2. **Cerca il campo/provider**:
   `rg -a -o '.{80}NOME_CAMPO.{160}' .../app.asar`. Il serializer di un topic è
   la funzione che destruttura `{id, classes, title, notes, labels, imageSource,
   …, markers, structureClass}` e costruisce l'oggetto JSON (`j.notes`,
   `j.markers`, `j.boundaries`, `j.summaries`, …). L'enum dei provider
   (`AudioNotes:"org.xmind.ui.audionotes"`, `Equation`, `Numbering`, `Task`, …)
   è la fonte autorevole: un provider non presente lì **non esiste**.
3. **Incrocia con i file reali**: `~/.var/app/net.xmind.XMind/config/Xmind/Electron v3/vana/file-cache/**/*.xmind`
   e i backup nel Trash. Estrai `content.json` con `unzip -p FILE.xmind content.json`
   e controlla i campi osservati.
4. **Aggiorna la doc**: `docs/PRODUCT.md` §3 (stato/campi/provider) e, se cambia
   lo schema o una regola, `docs/XMIND-FORMAT.md`.

Un campo si dice **Confermato** solo se compare nel serializer o in un file
reale; il *lock* della versione Free, non deducibile offline, resta l'unico
punto da verificare in UI.

### Aggiungere una regola di formato

1. Leggi [`docs/XMIND-FORMAT.md`](docs/XMIND-FORMAT.md) e verifica il campo
   reale con la ricetta §"Verificare un campo di formato su XMind reale".
2. Implementa la modifica minima in `packages/core/src/model`,
   `packages/core/src/latex` o `packages/core/src/safety/validate.ts`.
3. Aggiungi un test che dimostri la regola.
4. Aggiorna `docs/XMIND-FORMAT.md` e, se serve, il `README.md`.
5. Verifica in XMind che il file si apra e l'equazione sia editabile.

## Limiti noti (non introdurre regressioni)

- Solo formato moderno (`content.json`); il legacy XMind 8 non è supportato.
- Editing: testo, note, marker e task dei blocchi, aggiunta di sotto-blocchi,
  eliminazione (con i figli) e spostamento (riordino/riannidamento) via drag &
  drop nell'albero. Restano fuori scope i temi. Inventario aggiornato in
  [`docs/PRODUCT.md`](docs/PRODUCT.md).
- Le risorse orfane non vengono rimosse dallo ZIP (scelta a favore della
  sicurezza dei dati e dell'undo).
