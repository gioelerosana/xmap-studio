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
deploy Cloudflare crea da solo record DNS e certificato. `workers.dev` è
spento; i Preview URL (`preview_urls`) sono accesi e servono a provare le PR
(hash casuale, `noindex` automatico). Come ottenerli nel PR e cosa fare se
Cloudflare Access li blocca: §[Anteprime delle PR](#anteprime-delle-pr).
Per un altro dominio serve che la sua zona sia attiva sull'account (nameserver di Cloudflare presso il registrar).

La PWA usa percorsi assoluti (`start_url: "/"`) e va quindi servita dalla radice
del dominio, come fa il Worker.

## Deploy automatico da GitHub

Due strade, entrambe senza toccare il codice:

- **Workers Builds** (consigliata): dalla dashboard, Workers → `xmap-studio` →
  Settings → Build → collega il repo GitHub. Build command
  `pnpm install --frozen-lockfile && pnpm build:web`, deploy command
  `npx wrangler deploy`, branch `main`. Nessun segreto su GitHub. Per le PR
  la scheda "Base delle anteprime" usa lo stesso build command e
  `npx wrangler preview`, che richiede il blocco `"previews": {}` in
  `wrangler.jsonc` (senza, la build della PR fallisce).
- **GitHub Actions** con `cloudflare/wrangler-action` e un API token
  (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) tra i secret del repo.

## Anteprime delle PR

Workers Builds compila ogni branch e ogni PR, e pubblica l'anteprima su due URL
`workers.dev`:

- **URL del branch** — `<branch>-xmap-studio.<sottodominio>.workers.dev`:
  sempre l'ultimo commit del branch, da tenere aperto per tutta la vita del PR;
- **URL della versione** — `<hash>-xmap-studio.<sottodominio>.workers.dev`:
  quella singola build.

`preview_urls: true` in `wrangler.jsonc` conta dal deploy di produzione: il solo
upload di una versione non cambia l'impostazione del Worker. Se una build non
produce anteprime si controlla da *Workers & Pages* → `xmap-studio` → Settings →
Domains & Routes → Preview URLs.

### Il link nel PR

Il commento che il bot Cloudflare lascia nel PR mostra «No Preview URL» e non
contiene nessun link: la modifica live non è raggiungibile da lì, anche quando
l'URL esiste e compare nel check run di Workers Builds. Il workflow
[`preview.yml`](../.github/workflows/preview.yml) legge gli URL dal riepilogo del
check run e tiene aggiornato nel PR un commento «Anteprima Cloudflare», con lo
stato di ogni URL (logica in `scripts/preview-url.mjs`, test in
`scripts/preview-url.test.mjs`).

Il trigger `check_run` vale solo per i workflow presenti su `main`: dopo il merge
del PR che lo introduce, ogni PR successivo riceve il commento.

### Se il commento dice «dietro Cloudflare Access»

L'anteprima risponde con un redirect a `<team>.cloudflareaccess.com` e nel
browser si apre la pagina di login invece dell'app: delle modifiche non si vede
niente. Succede quando Cloudflare Access copre le anteprime — di norma
l'opzione a un clic *Workers & Pages* → **Protect all Workers** con
*Previews only*, oppure un'applicazione Access su misura in *Zero Trust* →
Access → Applications — e non c'è un metodo di accesso usabile da browser
(l'applicazione elenca solo `cloudflared`).

Due modi per riaprirle:

- togliere Access dalle anteprime: *Workers & Pages* → **Protect all Workers** →
disattivare *Previews only*;
- rendere pubblico questo Worker: *Workers & Pages* → `xmap-studio` → scheda
  **Access** → Worker pubblico (bypass).

La produzione (https://xmap.jshep.xyz) non è protetta: solo le anteprime lo sono.
Lo stato si verifica in un comando:

```bash
curl -sI https://<branch>-xmap-studio.<sottodominio>.workers.dev/ | grep -i '^location'
# niente output            → l'anteprima si apre nel browser
# → …cloudflareaccess.com  → c'è il login di Access davanti
```
