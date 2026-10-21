# Deploy della web app su Cloudflare

La web app è una SPA tutta lato client (il core gira nel browser, i file
`.xmind` restano sul dispositivo): non c'è backend. Su Cloudflare si pubblica
quindi come **Workers con Static Assets**, senza codice Worker: i file della
build stanno sulla rete Cloudflare e non esiste un origin che possa cadere.
Il service worker della PWA aggiunge l'uso offline.

File coinvolti:

- [`wrangler.jsonc`](../wrangler.jsonc): nome del Worker (`xmap-studio`) e cartella
  degli asset (`apps/web/dist`);
- [`apps/web/public/_headers`](../apps/web/public/_headers): cache immutabile per
  `/assets/*`, rivalidazione per `index.html`, `sw.js` e `manifest.webmanifest`
  (altrimenti i dispositivi con la PWA installata non vedono le versioni nuove),
  più intestazioni di sicurezza. `vite.config.ts` lo esclude dal precache del
  service worker: non viene servito e farebbe fallire l'installazione.

## Prerequisiti

`wrangler` installato e autenticato (`wrangler login`, verifica con
`wrangler whoami`). Non è una dipendenza del repo.

## Comandi

```bash
pnpm preview:cloudflare   # build + runtime Workers in locale (http://localhost:8787)
pnpm deploy:cloudflare    # build + pubblicazione su https://xmap.jshep.xyz
wrangler versions list    # versioni pubblicate
wrangler rollback         # torna alla versione precedente
```

Ogni `deploy` è atomico: finché non termina si serve la versione precedente.

## Dominio

L'app è servita da **https://xmap.jshep.xyz**: `routes` in `wrangler.jsonc` con
`custom_domain: true`, e la zona `jshep.xyz` sullo stesso account Cloudflare. Al
deploy Cloudflare crea da solo record DNS e certificato. `workers.dev` e i
Preview URL sono spenti. Per un altro dominio serve che la sua zona sia attiva
sull'account (nameserver di Cloudflare presso il registrar).

La PWA usa percorsi assoluti (`start_url: "/"`) e va quindi servita dalla radice
del dominio, come fa il Worker.

## Deploy automatico da GitHub

Due strade, entrambe senza toccare il codice:

- **Workers Builds** (consigliata): dalla dashboard, Workers → `xmap-studio` →
  Settings → Build → collega il repo GitHub. Build command
  `pnpm install --frozen-lockfile && pnpm build:web`, deploy command
  `npx wrangler deploy`, branch `main`. Nessun segreto su GitHub.
- **GitHub Actions** con `cloudflare/wrangler-action` e un API token
  (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) tra i secret del repo.
