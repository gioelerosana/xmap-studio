# AGENTS.md — guida operativa per lo sviluppo

Istruzioni destinate agli agenti AI (e ai contributor) che lavorano su questo
repository. Leggi questa pagina prima di toccare il codice. Per il dettaglio
tecnico vedi [`docs/`](docs/README.md).

## Cos'è questo progetto

**XMap Studio** è un'app di mappe mentali **libera e open source** (MIT) per
desktop (Linux, Windows) e web. Non è più un companion di XMind gratuito né un
suo clone: vuole essere **l'alternativa a XMind più curata e più libera**, il
posto dove le mappe si creano e si modificano, sulla mappa stessa (editing in
place, drag & drop, scorciatoie), con formule **LaTeX native** (MathJax) e
salvataggio sicuro.

Niente account, niente telemetria. Apre, mostra, modifica, salva.

### Visione: mappe belle, accurate, affidabili

Il focus del progetto è **la qualità delle mappe create nell'app**:

- **belle**: resa grafica curata, tipografia, colori e temi gradevoli, layout
  ordinati; l'estetica è una feature, non una rifinitura;
- **accurate**: il contenuto è quello che l'utente ha scritto, formule
  comprese, senza approssimazioni;
- **affidabili**: nessun dato si perde, mai (vedi §"Regole non negoziabili").

Il formato resta quello di XMind (`.xmind`, `content.json`): è un formato
diffuso e documentabile, e usarlo tiene le mappe portabili. Ma la
**compatibilità con XMind è un mezzo, non l'obiettivo**:

- una mappa XMind dovrebbe aprirsi in XMap Studio, e una mappa salvata qui
  dovrebbe aprirsi in XMind; è il comportamento atteso, non una promessa di
  resa identica al 100%;
- **non si insegue la feature parity con XMind**: una feature si fa se rende
  le mappe migliori, non perché XMind ce l'ha; dove una scelta di XMind è
  peggiore, XMap Studio può fare diversamente;
- le estensioni proprie dell'app vanno scritte in modo che XMind le ignori senza
  rompersi (campi in più, mai campi esistenti con un significato diverso).

Quando una feature tocca il formato, il riscontro su XMind reale (ricetta
§"Verificare un campo di formato su XMind reale") resta il modo per scegliere i
campi giusti e non corrompere i file; non serve invece riprodurre ogni dettaglio
di come XMind li mostra.

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
  ([`gioelerosana/xmap-studio`](https://github.com/gioelerosana/xmap-studio)),
  licenza [MIT](LICENSE). GitLab (`gitlab.com/JoelShepard/xmap-studio`) è solo un
  mirror di sicurezza in sola lettura del solo `main`, aggiornato a ogni push su
  `main` da `.github/workflows/mirror.yml`: non si pusha lì.

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
modelli inferiori al suo**, e l'unico modello ammesso è **Claude Haiku** (vedi
sotto).

### Scelta del modello per i sotto-agenti

**Regola rigida: l'unico modello utilizzabile come sotto-agente è Claude Haiku,
con reasoning `medium` oppure `high`. Nient'altro.** Né Sonnet, né Opus (nemmeno
altre istanze del modello principale), né altri provider (Antigravity, Codex, …),
né Haiku con altri livelli di reasoning (`low`, `max`, …). Un'eccezione richiede
un'indicazione esplicita dell'utente nella sessione.

| Modello | Reasoning | Quando usarlo |
|---|---|---|
| **Claude Haiku** | `medium` | lavoro meccanico e ben specificato: rinomini, restyle, migrazioni ripetitive, aggiornamento di import/doc, test su pattern esistenti, ricerche nella codebase |
| **Claude Haiku** | `high` | lavoro che richiede più ragionamento ma resta ben delimitato: modifiche non banali a un modulo, test di logica nuova, indagini su un bug circoscritto |
| Modello principale | — | **solo** orchestrazione: piano, contratti condivisi, revisione e integrazione finale |

Se un compito sembra troppo difficile per Haiku `high`, non si passa a un modello
più grande: lo si scompone in compiti più piccoli e ben specificati, oppure lo
svolge direttamente l'orchestratore. Quando lanci un sotto-agente, imposta
esplicitamente modello (Haiku) e reasoning (`medium` o `high`); non lasciare
valori di default che potrebbero risolversi in un altro modello.

Niente commit/push da parte del sotto-agente: la verifica a freddo e il commit
restano all'orchestratore (vedi sotto).

### Responsabilità dell'orchestratore

1. **Contratto prima del fan-out.** Scrivi tu le parti condivise da cui
   dipendono gli altri (tipi, API, token del design system, firme delle
   funzioni) e committale o fissale prima di lanciare i sotto-agenti.
2. **Compiti a file disgiunti.** Ogni sotto-agente riceve un insieme esplicito
   di file/cartelle che può toccare; due agenti in parallelo non modificano lo
   stesso file. File condivisi "caldi" (`package.json`, `pnpm-lock.yaml`,
   `packages/core/src/index.ts`, `docs/`) li tocca solo
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
  sono decisioni dell'orchestratore. Commit, push del branch di lavoro e
  apertura della PR li fa l'orchestratore a fine task (vedi §"Chiusura di ogni
  task"); la PR non la unisce nessun agente.
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
pnpm dev:tailnet    # server di sviluppo (HMR) su https://xmap.<tailnet>.ts.net
pnpm build          # core → ui-kit → web → desktop
pnpm test           # test di packages/core (Vitest)
```

### Definizione di "fatto"

Prima di considerare concluso un cambiamento:

1. `pnpm build` senza errori di tipo
2. `pnpm test` verde
3. per modifiche alla UI: app avviata e controllata (`pnpm dev:web` /
   `pnpm dev:desktop`)
4. se hai toccato il formato `.xmind` o il salvataggio: verifica manuale che un
   file salvato dall'app si apra ancora in XMind senza errori (vedi
   [`docs/TESTING.md`](docs/TESTING.md)); non serve che appaia identico
5. commit, push del branch e PR aperta, come in §"Chiusura di ogni task"

### Chiusura di ogni task

Ogni task si chiude **sempre** così, senza aspettare che l'utente lo chieda:

1. se sei su `main`, crea prima un branch di lavoro (`feat/<slug>`, `fix/<slug>`, …);
2. committa **tutte** le modifiche del working tree (Conventional Commits, vedi
   §"Git e GitHub"), divise in più commit se toccano argomenti distinti;
3. `git push -u origin <branch>`;
4. **apri la PR** con `gh pr create --base main --title "<titolo>" --body-file
   <file>` (mai `--fill`), compilando le sezioni di
   [`.github/pull_request_template.md`](.github/pull_request_template.md). Se il
   task descrive una PR già esistente (o `gh pr view` ne trova una per il
   branch), il push la aggiorna: modifica titolo e descrizione con
   `gh pr edit` invece di aprirne un'altra;
5. nel riepilogo finale all'utente scrivi **URL della PR, titolo e branch**,
   il tipo (`fix`/`feat`/…) usato e, se non lo ha indicato l'utente, perché lo
   hai scelto (§"Versioni, tag e titolo dei PR").

**Non unire mai la PR**, non fare push su `main` né force-push, e non lanciare
release di tua iniziativa (§"Rilasciare"): unire e rilasciare sono decisioni
dell'utente.

### Mobile e PWA

La web app è usabile su smartphone e tablet e installabile come PWA
(`apps/web/public/manifest.webmanifest`, `sw.js`, registrato in `main.tsx` solo
nella build di produzione). Il service worker mette in cache **tutta** la build
all'installazione: l'elenco dei file e la versione li inietta `vite build`
(plugin `precacheManifest` in `apps/web/vite.config.ts`) al posto dei
segnaposto `__XMAP_PRECACHE__`/`__XMAP_BUILD__`; per provare l'offline, apri
`vite preview`, poi spegnilo e ricarica. Per una modifica alla UI controlla anche:

- larghezze strette (≈360–430 px) e testo di sistema ingrandito: l'header non
  usa breakpoint fissi ma misura l'overflow e sposta le azioni nel menu ⋮
  (`HEADER_LEVEL` in `App.tsx`); nessun pulsante deve sovrapporsi;
- gesti sulla mappa (`MapView.tsx`): pan con un dito, pinch a due dita, tap e
  doppio tap; il pinch da trackpad in Safari arriva come `GestureEvent`;
- non ci sono pannelli laterali: l'editing del blocco passa dalla barra flottante
  (`components/toolbar/`), agganciabile sul desktop in alto, in basso o in verticale su un
  lato (`useToolbarPosition.ts`, orientamento via `ToolbarOrientationContext`) e agganciata in basso sotto `sm`;
  i suoi popover devono restare visibili in tutte le posizioni;
- la variante Tailwind `coarse:` (touch) è un plugin `addVariant` in
  `apps/web/tailwind.config.js`, **non** uno `screen` raw: uno screen raw
  disattiva in silenzio tutte le varianti `max-sm:`/`max-lg:` (barra
  agganciata, editor LaTeX a foglio, toast). Dopo modifiche al config verifica che la CSS generata
  le contenga.

Per provarla su un dispositivo si serve **sempre via Tailscale**, da qualunque
PC si lavori, con `scripts/serve-tailnet.mjs` sulla porta dedicata 60417,
esposta in HTTPS con `tailscale serve`:

- `pnpm dev:tailnet` espone il **server di sviluppo** Vite: niente build, le
  modifiche arrivano subito sul dispositivo (HMR, via `wss` sullo stesso
  indirizzo). È il modo normale di provare l'app mentre la si sviluppa. Niente
  service worker: in sviluppo non si registra.
- `pnpm serve:tailnet` compila e avvia `vite preview` sulla build di
  produzione: serve per provare PWA, installazione e uso offline.

**A inizio sessione** che tocca la UI, sul PC che ospita `svc:xmap`
controlla che l'app risponda (`curl -sI http://127.0.0.1:60417/`); se non
risponde, avvia `pnpm dev:tailnet` staccato dalla sessione, così non si ferma
con lei: `setsid nohup pnpm dev:tailnet > /tmp/serve-tailnet.log 2>&1 < /dev/null &`.
I due comandi si escludono: la porta è riservata allo script, che all'avvio
ferma chiunque la occupi e le vecchie istanze di `serve:tailnet`/`vite preview`.
L'HTTPS è indispensabile: Safari registra il service worker (e quindi la PWA
funziona offline) solo in un contesto sicuro, non su `http://IP-LAN`. Niente
certificati locali: si usa quello `*.ts.net` di Tailscale. Il dispositivo deve
essere nella tailnet (app Tailscale, stesso account).

- Indirizzo stabile: con il Tailscale Service `svc:xmap` configurato è
  `https://xmap.<tailnet>.ts.net`, uguale da ogni PC che lo serve. Setup una
  tantum nella console admin: tag (es. `tag:xmap`) con `tagOwners` nella policy,
  PC che servono taggati (i service host devono essere nodi taggati), servizio
  `svc:xmap` con porta `tcp:443` e host approvati (o `autoApprovers`).
- Il servizio va **creato** nella pagina Services (`autoApprovers` approva solo
  gli host di un servizio esistente). Se l'host risulta "non connesso" dopo
  averlo creato: `tailscale serve drain svc:xmap`, poi di nuovo
  `pnpm serve:tailnet`. L'indirizzo del servizio non è raggiungibile dal PC che
  lo ospita: si prova da un altro dispositivo.
- Senza il servizio lo script ripiega sul nome della macchina
  (`https://<pc>.<tailnet>.ts.net`).
- Un PC che ha pubblicato `svc:xmap` una volta resta host anche a script
  chiuso (la preferenza `AdvertiseServices` resta salvata in `tailscaled`) e
  da lì `xmap.<tailnet>.ts.net` non si apre più. Su un PC da cui si vuole
  aprire l'indirizzo del servizio si usa `pnpm serve:tailnet --no-service`:
  serve solo sul nome della macchina e toglie il PC dagli host del servizio.
- Un nome fuori da `*.ts.net` (es. `xmap.net`) non è possibile con i certificati
  di Tailscale.
- Per spegnere: `tailscale serve --service=svc:xmap off` oppure
  `tailscale serve --https=443 off`.

## Struttura del repository

```
xmap-studio/
├── package.json / pnpm-workspace.yaml / pnpm-lock.yaml
├── AGENTS.md                     # questo file
├── .github/pull_request_template.md   # template delle PR
├── .github/workflows/
│   ├── release-manual.yml        # release a richiesta (workflow_dispatch): versione, tag
│   ├── pr-title.yml              # controllo del formato del titolo dei PR
│   ├── preview.yml               # commento col link all'anteprima Cloudflare del PR
│   ├── release.yml               # build e GitHub Release di un tag vYY.MAJOR.MINOR
│   └── mirror.yml                # copia di `main` su GitLab (mirror)
├── LICENSE                       # MIT
├── README.md                     # presentazione per l'utente (breve)
├── assets/                       # icona e metadati desktop
├── demo/                         # mappa di prova con equazione applicata
├── docs/                         # documentazione tecnica
├── packaging/arch/               # PKGBUILD (sviluppo `-git` e `release/`), bump-pkgver.sh
├── scripts/                      # strumenti di repo (release-version.mjs, check-release-version.mjs)
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

- Repository remoto: `github.com/gioelerosana/xmap-studio` (`origin`),
  **pubblico**: non committare dati personali, segreti o file di prova privati.
- Mirror: `gitlab.com/JoelShepard/xmap-studio` (remote `gitlab`, se presente),
  riceve solo `main`, da GitHub Actions con una deploy key (secret
  `GITLAB_MIRROR_SSH_KEY`); il suo `main` rifiuta ogni altro push. Gli altri
  branch e i tag restano solo su GitHub.
- Branch principale: **`main`**.
- Commit: [Conventional Commits](https://www.conventionalcommits.org/) con tipo
  in inglese e descrizione in italiano:

  ```
  feat(equation): supporta titolo personalizzato
  fix(save): evita backup duplicati nello stesso secondo
  docs(agents): aggiorna i comandi di test
  ```

- Branch di lavoro: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `refactor/<slug>`.
- Ogni task finisce in una Pull Request verso `main` (§"Chiusura di ogni
  task", §"Flusso delle PR"); niente push diretto su `main`.
- Non riscrivere la storia di `main`, non fare force-push su `main`.

### Versioni, tag e titolo dei PR

Le versioni sono **`vYY.MAJOR.MINOR`** (anno a due cifre, release di
funzionalità dell'anno, release di correzioni). **Una PR unita in `main` non
produce nessuna release**: la release è un passo separato, lanciato a mano su
richiesta dell'utente (§"Rilasciare"); versione, commit `chore(release): …`, tag
e GitHub Release li scrive solo `release-manual.yml`. Regole complete in
[`docs/RELEASE.md`](docs/RELEASE.md) §"Versioning".

Per l'agente questo vuol dire:

- **non toccare mai la versione** (`version` dei `package.json`, `pkgver`) né
  creare tag nei branch di lavoro: li scrive solo il workflow;
- il titolo della PR è in Conventional Commits (tipo in inglese, descrizione in
  italiano), e il tipo riassume **tutto** il PR. Con lo squash merge il titolo
  diventa il subject del commit su `main`, che il calcolo della release leggerà
  (con un merge commit contano i commit del branch: per questo anche quelli
  vanno in Conventional Commits);
- **il tipo lo indica l'utente nel task** (`fix`, `feat`, …). Se manca, lo scegli
  tu con la tabella e lo dichiari nel riepilogo:
  - `feat(...)` se contiene almeno una funzionalità nuova per l'utente;
  - `fix`, `perf`, `refactor`, `style`, `revert`, `build` se cambia solo cose
    esistenti dell'app;
  - `docs`, `ci`, `chore`, `test` se non tocca l'app distribuita (non
    finiscono in una release);
- la **descrizione è specifica e dice l'effetto per l'utente**:
  `fix(save): evita backup duplicati nello stesso secondo`. Un nome generico di
  area (`feat(editor): miglioramenti all'editing`) va bene solo per una PR di
  raccolta che contiene più cose;
- se nel corso del lavoro la PR cambia natura (un `fix` che diventa anche una
  funzionalità), aggiorna il titolo e dillo nel riepilogo.

### Comandi utili

```bash
gh auth status                         # verifica login GitHub
gh repo view --web                     # apri il repo nel browser
gh pr create --base main --title "feat(map): …" --body "…"
```

## Flusso delle PR

Modello: una PR = un problema = un commit logico su `main`, unita in fretta.

- **Un task, una PR.** Se il task ne contiene due indipendenti, sono due branch
  e due PR.
- **Draft finché si itera.** Apri la PR come bozza (`gh pr create --draft`) se
  l'utente deve ancora guardare l'anteprima e chiedere ritocchi. Cloudflare
  Workers Builds compila ogni branch e ogni PR; `preview.yml` aspetta la build
  del commit e tiene nella PR un commento con l'URL del branch (sempre l'ultimo
  commit) e quello della singola versione, dicendo se rispondono o sono dietro
  Cloudflare Access (`scripts/preview-url.mjs`, [`docs/DEPLOY.md`](docs/DEPLOY.md)
  §"Anteprime delle PR"). Per provare dal telefono resta `pnpm dev:tailnet`.
- **Pronta e unita lo stesso giorno.** Quando l'utente è soddisfatto la PR esce
  dalla bozza (`gh pr ready`) e la unisce lui. Una PR ancora aperta dopo 2–3
  giorni è troppo grossa: va spezzata.
- **Le correzioni dopo il feedback vanno nella stessa PR** (altri commit sullo
  stesso branch, o un `gh pr edit` se cambia il titolo), non in una PR nuova.
- **Ramo di integrazione di lunga durata** solo per riscritture non spezzabili
  in passi che lascino `main` funzionante; in quel caso va riallineato spesso a
  `main` (`git fetch && git rebase origin/main` o merge) per non accumulare
  conflitti.
- Lo squash merge è facoltativo e lo decide l'utente nelle impostazioni del
  repository: il flusso funziona con entrambe le strategie.

## Rilasciare

Si rilascia **solo se l'utente lo chiede esplicitamente** («rilascia», «fai una
release»), mai di propria iniziativa e mai come effetto collaterale di un merge
o di un task. A quel punto:

1. verifica che `main` locale sia aggiornato (`git fetch origin && git status`,
   `git log origin/main -1`) e che la CI di `main` sia verde
   (`gh run list --branch main --limit 5`);
2. avvia il workflow manuale: `gh workflow run release-manual.yml --ref main -f
   bump=auto` (`auto` calcola il tipo dai commit dall'ultimo tag; `major` o
   `minor` solo se l'utente indica il tipo o chiede di forzarlo). Parte solo da
   `main`;
3. segui il run: `gh run list --workflow release-manual.yml --limit 1`, poi
   `gh run watch <id>` / `gh run view <id>`. Se il riepilogo dice «niente da
   rilasciare» non è un errore: riportalo all'utente e non forzare;
4. riporta all'utente **versione, tag e link della GitHub Release**
   (`gh release view <tag> --json url`), oppure l'esito negativo con il log del
   passo fallito.

Dettagli e rimedi in [`docs/RELEASE.md`](docs/RELEASE.md).

## Ricette rapide

### Verificare un campo di formato su XMind reale

Serve a scegliere i campi giusti quando una feature tocca il formato (vedi
§"Visione"). Non serve una licenza Pro né pilotare la GUI: il binario XMind
installato contiene il serializer di `content.json` e i cataloghi (marker, strutture), e le
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
4. **Aggiorna la doc**: `docs/XMIND-FORMAT.md` (§"Campi verificati" e, se cambia
   lo schema o una regola, le regole).

Un campo si dice **Confermato** solo se compare nel serializer o in un file
reale.

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
- Editing: testo (anche in place sulla mappa), stile del testo, note, marker,
  etichette e link dei blocchi (dalla barra flottante), aggiunta di sotto-blocchi e fratelli (Tab/Invio), eliminazione
  (con i figli, senza conferma: si annulla), spostamento (riordino/riannidamento)
  via drag & drop sulla mappa, posizione dei blocchi liberi, punti di controllo
  delle relazioni, formattazione parziale (Ctrl+B/I/U), larghezza dei blocchi e
  dimensione delle immagini, copia/incolla/duplica dal menu contestuale.
  Il tema del foglio si modifica dall'editor "Tema del foglio…" (colori, font,
  forme, linee). Panoramica delle funzioni in
  [`docs/OVERVIEW.md`](docs/OVERVIEW.md).
- Le risorse orfane non vengono rimosse dallo ZIP (scelta a favore della
  sicurezza dei dati e dell'undo).
