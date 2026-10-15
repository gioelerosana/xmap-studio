# Sviluppo

L'implementazione attiva è un workspace pnpm TypeScript; `src-tauri/` è il
backend Rust di riferimento.

## Prerequisiti

- Node.js 20 o superiore
- pnpm
- Linux desktop per eseguire Electron con i dialoghi nativi

## Installazione e comandi

```bash
pnpm install
pnpm dev:web        # Vite, interfaccia nel browser
pnpm dev:desktop    # Electron; avvia la UI già compilata
pnpm build          # core, ui-kit, web, desktop
pnpm test           # test del core TypeScript
```

`pnpm dev:desktop` compila il processo Electron e carica il server web su
`http://localhost:3000`; avvia prima `pnpm dev:web` in un altro terminale.
`pnpm build` compila la web app nella cartella `apps/web/dist`, usata da
Electron in modalità normale.

## Workspace

```text
packages/core/      modello XMind, archivio, sicurezza, editing, MathJax
packages/ui-kit/    componenti condivisi
apps/web/           React + Vite, utilizzabile anche da browser
apps/desktop/       Electron main/preload, dialoghi e scrittura atomica
src-tauri/          implementazione Rust precedente, usata come riferimento
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

`mathjax-full` è dipendenza di `@xmap/core`. La preview usa MathJax per produrre
SVG; quando disponibile `@resvg/resvg-js` produce PNG. Nel browser si usa il
percorso Canvas predisposto dal core. Non serve il vecchio renderer Node
incorporato della versione Rust.

## Convenzioni

- Commenti in italiano, identificatori/API in inglese.
- Mantenere i campi non riconosciuti nei round-trip di `content.json`.
- Validare in memoria prima di scrivere un `.xmind`.
- Nel desktop, passare le scritture al solo adapter atomico nel processo
  principale.
- Non aggiungere dipendenze quando le API standard o quelle già presenti
  bastano.

La mappa dei moduli e le differenze dalla versione Rust sono in
[`ARCHITECTURE.md`](ARCHITECTURE.md) e
[`TS-MIGRATION-PARITY.md`](TS-MIGRATION-PARITY.md).
