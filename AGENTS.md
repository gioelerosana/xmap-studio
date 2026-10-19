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

### Macro-obiettivo: feature parity con XMind

La direzione del progetto è **pareggiare XMind, e superarlo dove Free è
bloccato**. Un file aperto qui deve apparire come in XMind (grassetti, forme
delle relazioni, sommari, colori del tema) e deve potersi modificare **sulla
mappa** con i gesti di XMind (drag & drop, editing in place, scorciatoie). La
matrice di parità con lo stato di ogni voce è in
[`docs/PRODUCT.md`](docs/PRODUCT.md) §4 "Fase 8"; ogni feature nuova:

1. parte dal riscontro su XMind reale (ricetta §"Verificare un campo di formato
   su XMind reale": il codice di rendering di XMind è nell'`app.asar`);
2. passa per *render* → *edit* → *round-trip* (XMind riapre il file salvato e lo
   mostra uguale);
3. aggiorna la riga corrispondente della matrice.

- Stack: monorepo **TypeScript** gestito con **pnpm**:
  - `packages/core` — motore (modello, archivio, sicurezza, LaTeX/MathJax,
    export, layout). Non dipende dalla UI.
  - `packages/ui-kit` — design system (vedi
    [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md)).
  - `apps/web` — UI React.
  - `apps/desktop` — shell Electron (main process + preload).
- Documentazione: [`README.md`](README.md) (utente), [`docs/`](docs/README.md)
  (tecnica).
- Repository: pubblico su GitHub
  ([`JoelShepard/xmap-studio`](https://github.com/JoelShepard/xmap-studio)),
  licenza [MIT](LICENSE).

## `TODO.md`: la direzione del lavoro

[`TODO.md`](TODO.md), nella root, è il **backlog scritto dall'utente**: le
feature, le correzioni e le idee che vuole nell'app, aggiunte man mano. È la
fonte primaria di direzione per ogni sessione, più di `docs/PRODUCT.md` (che
descrive lo stato e la roadmap di prodotto, non le priorità correnti).

**Leggilo sempre a inizio sessione**, prima di pianificare, qualunque sia la
richiesta.

### Sessione senza indicazioni precise

Se la sessione parte senza un compito specifico ("vai", "continua", "lavora
sull'app", "cosa facciamo?", un prompt generico o vuoto), **il compito è
`TODO.md`**:

1. prendi le voci aperte (`- [ ]`) **dall'alto verso il basso**: l'ordine è la
   priorità dell'utente. Salta una voce solo se dipende da un'altra ancora
   aperta o se è bloccata (vedi sotto), e dillo;
2. lavora su quante voci riesci a portare a "fatto" per davvero; meglio una
   voce chiusa e verificata che tre a metà;
3. non inventare lavoro fuori dalla lista: refactoring, pulizie o feature non
   richieste non sostituiscono una voce aperta. Se lo noti, segnalalo nel
   riepilogo;
4. se non ci sono voci aperte, dillo e proponi i prossimi passi (da
   `docs/PRODUCT.md` o da quanto osservato), ma **non** iniziarli senza un sì.

### Sessione con un compito specifico

Fai quello che chiede l'utente. Se corrisponde (anche in parte) a una voce di
`TODO.md`, trattalo come quella voce e aggiornala alla chiusura. Se il compito
contraddice una voce, segnalalo invece di scegliere da solo.

### Interpretare una voce

Le voci sono scritte di getto: leggile come intenzione, non come specifica.
Scegli l'interpretazione più ragionevole e coerente con il resto dell'app e
dichiarala nel riepilogo. **Chiedi prima** solo se la voce è davvero ambigua
(interpretazioni che portano a lavoro molto diverso) o se realizzarla
richiederebbe di violare una regola non negoziabile: le voci di `TODO.md` non
prevalgono mai su quelle regole.

### Come si aggiorna il file

`TODO.md` è dell'utente. L'agente:

- **spunta** una voce (`- [x]`) solo quando soddisfa la §"Definizione di
  "fatto"", nello stesso commit della modifica che la chiude;
- aggiunge in coda alla voce, tra parentesi, una nota breve su cosa è stato
  fatto, come nelle voci già chiuse;
- per una voce fatta solo in parte la lascia aperta, con una nota
  `(parziale: …)` su cosa manca;
- **non** riscrive, riordina né cancella le voci dell'utente e non ne aggiunge
  di nuove senza che l'utente lo chieda: i seguiti emersi vanno nel riepilogo.

È un file condiviso "caldo": lo tocca solo l'orchestratore, mai un
sotto-agente.

Nel riepilogo finale indica quali voci hai chiuso, quali restano aperte e
perché.

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
| Modello principale | **solo** orchestrazione: piano, contratti condivisi, revisione e integrazione finale |

#### Override temporaneo: Antigravity Sec (periodo di prova)

Finché l'utente ha attiva la prova di Google Antigravity, i sotto-agenti si
lanciano **su Antigravity Sec** invece che su Haiku/Sonnet: provider
`antigravity_sec`, modello **`gemini-3.8-flash-high`** (Gemini 3.8 Flash, High).
Dà buona qualità se ben orchestrato, quindi:

- si delega con `delegate_task` (T3 Code) con
  `target: {"providerInstanceId": "antigravity_sec", "model": "gemini-3.8-flash-high"}`;
  gli ID vivi si leggono da `orchestrator_capabilities`. Se `antigravity_sec`
  non compare o non è utilizzabile, si torna alla tabella sopra (Haiku/Sonnet);
- i prompt devono essere ancora più autosufficienti e precisi del solito: file
  ammessi, comportamento atteso, cosa NON toccare, comando di verifica
  (`pnpm build` e `pnpm test`) e richiesta di un riepilogo breve;
- niente commit/push da parte del sotto-agente; la verifica a freddo e il
  commit restano all'orchestratore (vedi sotto);
- l'override vale finché l'utente non dice che la prova è finita: a quel punto
  si rimuove questa sezione.

### Responsabilità dell'orchestratore

1. **Contratto prima del fan-out.** Scrivi tu le parti condivise da cui
   dipendono gli altri (tipi, API, token del design system, firme delle
   funzioni) e committale o fissale prima di lanciare i sotto-agenti.
2. **Compiti a file disgiunti.** Ogni sotto-agente riceve un insieme esplicito
   di file/cartelle che può toccare; due agenti in parallelo non modificano lo
   stesso file. File condivisi "caldi" (`package.json`, `pnpm-lock.yaml`,
   `packages/core/src/index.ts`, `docs/`, `TODO.md`) li tocca solo
   l'orchestratore.
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
- Nessun sotto-agente aggiunge dipendenze, fa commit su `main`, push o apre PR:
  sono decisioni dell'orchestratore. Commit e push del branch di lavoro li fa
  l'orchestratore a fine task (vedi §"Chiusura di ogni task"); la PR resta una
  decisione dell'utente.
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
5. voce corrispondente di `TODO.md` spuntata, con nota (vedi §"`TODO.md`: la
   direzione del lavoro")
6. commit e push del branch, come in §"Chiusura di ogni task"

### Chiusura di ogni task

Ogni task si chiude **sempre** così, senza aspettare che l'utente lo chieda:

1. se sei su `main`, crea prima un branch di lavoro (`feat/<slug>`, `fix/<slug>`, …);
2. committa **tutte** le modifiche del working tree (Conventional Commits, vedi
   §"Git e GitHub"), divise in più commit se toccano argomenti distinti;
3. `git push -u origin <branch>`;
4. nel riepilogo finale all'utente scrivi il **nome del branch** pushato e lo
   stato di `TODO.md` (voci chiuse, voci ancora aperte).

Non si fa push su `main` né force-push; la Pull Request la apre l'utente o la
si apre solo su sua richiesta.

### Mobile e PWA

La web app è usabile su smartphone e tablet e installabile come PWA
(`apps/web/public/manifest.webmanifest`, `sw.js`, registrato in `main.tsx` solo
nella build di produzione). Per una modifica alla UI controlla anche:

- larghezze strette (≈360–430 px) e testo di sistema ingrandito: l'header non
  usa breakpoint fissi ma misura l'overflow e sposta le azioni nel menu ⋮
  (`HEADER_LEVEL` in `App.tsx`); nessun pulsante deve sovrapporsi;
- gesti sulla mappa (`MapView.tsx`): pan con un dito, pinch a due dita, tap e
  doppio tap; il pinch da trackpad in Safari arriva come `GestureEvent`;
- sotto `lg` l'inspector è un pannello sovrapposto (bottom sheet su smartphone);
  non c'è più una barra laterale con l'elenco dei blocchi.
- la variante Tailwind `coarse:` (touch) è un plugin `addVariant` in
  `apps/web/tailwind.config.js`, **non** uno `screen` raw: uno screen raw
  disattiva in silenzio tutte le varianti `max-sm:`/`max-lg:` (drawer,
  bottom sheet, toast). Dopo modifiche al config verifica che la CSS generata
  le contenga.

Per provarla su un dispositivo: `pnpm build`, poi `cd apps/web && npx vite preview`
(porta 4173, host `.ts.net` ammessi in `vite.config.ts`).

## Struttura del repository

```
xmap-studio/
├── package.json / pnpm-workspace.yaml / pnpm-lock.yaml
├── AGENTS.md                     # questo file
├── .github/workflows/release.yml # workflow di release (solo sui tag vX.Y.Z)
├── LICENSE                       # MIT
├── TODO.md                       # backlog dell'utente: la direzione del lavoro
├── README.md                     # presentazione per l'utente (breve)
├── assets/                       # icona e metadati desktop
├── demo/                         # mappa di prova con equazione applicata
├── docs/                         # documentazione tecnica
├── packaging/arch/               # PKGBUILD (sviluppo `-git` e `release/`), bump-pkgver.sh
├── scripts/                      # strumenti di repo (check-release-version.mjs)
├── packages/
│   ├── core/                     # motore: src/{model,archive,safety,latex,…}, tests/
│   └── ui-kit/                   # design system
└── apps/
    ├── web/                      # UI React
    └── desktop/                  # Electron (main, preload, scripts/{dev,dist}.mjs, electron-builder.yml)
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

## Git e GitHub

- Repository remoto: `github.com/JoelShepard/xmap-studio`, **pubblico**: non
  committare dati personali, segreti o file di prova privati.
- Branch principale: **`main`**.
- Commit: [Conventional Commits](https://www.conventionalcommits.org/) con tipo
  in inglese e descrizione in italiano:

  ```
  feat(equation): supporta titolo personalizzato
  fix(save): evita backup duplicati nello stesso secondo
  docs(agents): aggiorna i comandi di test
  ```

- Branch di lavoro: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `refactor/<slug>`.
- Apri una Pull Request verso `main`; non fare push diretto su `main` per
  cambiamenti non banali.
- Non riscrivere la storia di `main`, non fare force-push su `main`.

### Comandi utili

```bash
gh auth status                         # verifica login GitHub
gh repo view --web                     # apri il repo nel browser
gh pr create --fill --base main
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
- Editing: testo (anche in place sulla mappa), stile del testo, note, marker e
  task dei blocchi, aggiunta di sotto-blocchi e fratelli (Tab/Invio), eliminazione
  (con i figli, senza conferma: si annulla), spostamento (riordino/riannidamento)
  via drag & drop sulla mappa, posizione dei blocchi liberi, punti di controllo
  delle relazioni, formattazione parziale (Ctrl+B/I/U), larghezza dei blocchi e
  dimensione delle immagini, copia/incolla/duplica dal menu contestuale.
  I temi non si modificano ancora (vedi matrice di parità). Inventario aggiornato in
  [`docs/PRODUCT.md`](docs/PRODUCT.md).
- Le risorse orfane non vengono rimosse dallo ZIP (scelta a favore della
  sicurezza dei dati e dell'undo).
