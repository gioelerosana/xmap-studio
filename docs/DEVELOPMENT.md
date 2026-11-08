# Sviluppo

Il progetto è un workspace pnpm TypeScript.

## Prerequisiti

- Node.js 20 o superiore
- pnpm
- Linux desktop per eseguire Electron con i dialoghi nativi

## Installazione e comandi

```bash
pnpm install
pnpm dev:web        # Vite, interfaccia nel browser
pnpm dev:desktop    # Electron con la UI servita da Vite (avvia tutto da solo)
pnpm build          # core, ui-kit, web, desktop
pnpm build:desktop  # solo processo Electron (tsc)
pnpm test           # test del core TypeScript
```

`pnpm dev:desktop` (script `apps/desktop/scripts/dev.mjs`) avvia Vite su
`http://localhost:3000` se non è già attivo, compila il processo Electron e apre
la finestra; chiudendo Electron si ferma anche il Vite avviato dallo script. Se
il server di sviluppo non risponde, Electron ripiega su `apps/web/dist`.

Con Node ≥ 26 l'installer di `electron` può interrompersi a metà estrazione
(errore "Electron failed to install correctly"): lo zip scaricato resta in
`~/.cache/electron/`, va estratto in `node_modules/.pnpm/electron@*/node_modules/electron/dist`
scrivendo `electron` in `path.txt` accanto a `dist`. Con Node 22 LTS il problema
non si presenta.
`pnpm build` compila la web app nella cartella `apps/web/dist`, usata da
Electron in modalità normale.

## Workspace

```text
packages/core/      modello XMind, archivio, sicurezza, editing, MathJax
packages/ui-kit/    componenti condivisi
apps/web/           React + Vite, utilizzabile anche da browser
apps/desktop/       Electron main/preload, dialoghi e scrittura atomica
```

## File `.xmind` nell'app desktop

Il processo Electron accetta un percorso `.xmind` da riga di comando. Ogni
apertura esterna crea una finestra indipendente. Per l'associazione del file
manager, la registrazione del pacchetto Electron deve dichiarare l'estensione
`.xmind` per la piattaforma di distribuzione scelta.

Il processo principale gestisce dialoghi e scritture: il renderer non ha
accesso Node diretto. Prima di sovrascrivere, valida l'archivio, controlla
l'hash originale, crea un backup nascosto e usa rename atomico. Il browser usa
File System Access API quando disponibile; il fallback scarica i byte.

## Renderer e rasterizzazione

MathJax 4 (`@mathjax/src`, il font `@mathjax/mathjax-newcm-font` e
`@mathjax/mathjax-mhchem-font-extension` per le frecce di `\ce`, tutti alla stessa
versione) è dipendenza di `@xmap/core`, caricata con `import()` da `loadMathJax()`. `renderLatexToSvg`
va usata dopo il caricamento; i percorsi che producono dati (equazioni salvate,
export) usano `renderLatexToSvgAsync`, che attende anche i glifi. Dettagli sui
glifi caricati su richiesta in [`ARCHITECTURE.md`](ARCHITECTURE.md) §"Avvio e
caricamento su richiesta". La preview usa MathJax per produrre SVG; quando
disponibile `@resvg/resvg-js` produce PNG. Nel browser si usa il percorso Canvas
predisposto dal core.

## Menu Debug

Nascosto come le opzioni sviluppatore di Android: in **Impostazioni ›
Informazioni** si tocca 7 volte la versione e compare la sezione **Debug**
(preferenza `developerMode` in `settings.ts`; si spegne dalla sezione stessa).
Mostra:

- informazioni di ambiente (`apps/web/src/debugInfo.ts`): versione e commit
  della build (`__APP_COMMIT__`, da `vite.config.ts`), browser/Electron,
  schermo, MathJax, service worker, archiviazione, impostazioni;
- il log dell'interfaccia (`apps/web/src/debugLog.ts`): `console.*`, errori e
  promesse non gestiti, ogni toast con l'errore originale (stack, `code`,
  `details` di `XmapError`, catena di `cause`). Per questo nei `catch` si passa
  l'errore come terzo argomento: `addToast('error', messaggio, err)`;
- nell'app desktop, il log del main process (`apps/desktop/src/debug-log.ts`,
  IPC `debug:getInfo`): console, promesse rifiutate, renderer o processi figli
  terminati.

Tutto resta in memoria (1000 voci nel renderer, 500 nel main) e si perde alla
chiusura: niente disco, niente rete. «Copia rapporto» e «Salva .txt» producono
il testo da allegare a una segnalazione.

## Convenzioni

- Commenti in italiano, identificatori/API in inglese.
- Mantenere i campi non riconosciuti nei round-trip di `content.json`.
- Validare in memoria prima di scrivere un `.xmind`.
- Nel desktop, passare le scritture al solo adapter atomico nel processo
  principale.
- Non aggiungere dipendenze quando le API standard o quelle già presenti
  bastano.

La mappa dei moduli è in [`ARCHITECTURE.md`](ARCHITECTURE.md).
