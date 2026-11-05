# Deploy della web app su Cloudflare

La web app è una SPA tutta lato client (il core gira nel browser, i file
`.xmind` restano sul dispositivo): non c'è backend. Su Cloudflare si pubblica
quindi come **Workers con Static Assets**: i file della build stanno sulla rete
Cloudflare e non esiste un origin che possa cadere. Il codice del Worker
(`worker/index.ts`) gira solo per `/nc/*`, il proxy dell'integrazione Nextcloud
opt-in ([`NEXTCLOUD.md`](NEXTCLOUD.md)); tutto il resto lo servono direttamente
gli asset.
Il service worker della PWA aggiunge l'uso offline.

File coinvolti:

- [`wrangler.jsonc`](../wrangler.jsonc): nome del Worker (`xmap-studio`), script
  (`worker/index.ts`) e cartella degli asset (`apps/web/dist`, binding `ASSETS`,
  `run_worker_first` solo per `/nc/*`);
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
spento; le anteprime delle PR (Worker Previews) e i Version URL
(`preview_urls`) sono accesi. Come funzionano e cosa fare se Cloudflare Access
le blocca: §[Anteprime delle PR](#anteprime-delle-pr).
Per un altro dominio serve che la sua zona sia attiva sull'account (nameserver di Cloudflare presso il registrar).

La PWA usa percorsi assoluti (`start_url: "/"`) e va quindi servita dalla radice
del dominio, come fa il Worker.

## Deploy automatico da GitHub

Due strade, entrambe senza toccare il codice:

- **Workers Builds** (consigliata): dalla dashboard, Workers → `xmap-studio` →
  Settings → Build → collega il repo GitHub.
  - Build command: `pnpm install --frozen-lockfile && pnpm build:web`
  - Deploy command (produzione): `npx wrangler deploy` (default).
  - Preview command (gli altri branch): `npx wrangler preview` (default). **Non**
    `npx wrangler versions upload`: crea solo una versione con il suo Version URL,
    il bot Cloudflare nella PR scrive «No Preview URL» e wrangler si ferma sul
    controllo di `WRANGLER_CI_MATCH_TAG` (`The name in your wrangler.jsonc file
    must match the name of your Worker`).
  - Branch di produzione: `main`. Nessun segreto su GitHub.
  - Versione di Node: la fissa `.node-version` nella radice (24, come la CI). Senza,
    l'immagine di build può usare Node 18, su cui TypeScript 7 e Vite 8 non partono.
  - Per le PR, la configurazione richiede il blocco `"previews": {}` in `wrangler.jsonc`.
- **GitHub Actions** con `cloudflare/wrangler-action` e un API token
  (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) tra i secret del repo.

## Anteprime delle PR

Workers Builds compila ogni branch e ogni PR con `npx wrangler preview` e
pubblica una **Worker Preview** per branch (blocco `previews` di
`wrangler.jsonc`):

- **URL della Preview** — `<branch>-xmap-studio.<sottodominio>.workers.dev`:
  sempre l'ultimo deploy del branch, da tenere aperto per tutta la vita del PR;
- **URL del deploy** — `<id>-xmap-studio.<sottodominio>.workers.dev`: quella
  singola build.

Il bot Cloudflare (`cloudflare-workers-and-pages`) li scrive nel suo commento
della PR e li aggiorna a ogni push; si trovano anche in *Workers & Pages* →
`xmap-studio` → **Previews**. Se il commento dice «No Preview URL», il Preview
command dei branch non è `npx wrangler preview` (§"Deploy automatico da GitHub").

### Se il commento del bot non ha l'URL della Preview

Il commento distingue tre casi:

| Nel commento | Significato | Cosa fare |
|---|---|---|
| `Preview URL: https://<branch>-xmap-studio…` | build e deploy della Preview riusciti | niente |
| «No Preview URL. Enable ↗», build ✅ | la build ha girato con `wrangler versions upload`, non con `wrangler preview` | correggere il comando dei branch non di produzione nella dashboard (§"Deploy automatico da GitHub") |
| riga senza URL, «Build: Failed ❌» | la build è fallita prima della Preview | aprire «View logs ↗» nel commento e leggere il passo fallito |

`wrangler preview` non esegue il controllo di `WRANGLER_CI_MATCH_TAG` (lo fanno
solo `deploy` e `versions upload`, cloudflare/workers-sdk#15682): non serve
nessuno shim nel `build:web` che tolga la variabile. Verificato con wrangler
4.157 e un `WRANGLER_CI_MATCH_TAG` volutamente sbagliato:

```bash
CLOUDFLARE_ACCOUNT_ID=<account> WORKERS_CI=1 WRANGLER_CI_MATCH_TAG=000… \
  npx wrangler preview --name prova-ci     # deve stampare «Preview URL: …»
npx wrangler preview delete --name prova-ci -y
```

### Se la build resta in «Initializing build environment»

È coda, non un errore del repository. Sul piano Free, Workers Builds esegue
**una build alla volta per tutto l'account**: dopo più merge di fila, o push su
più PR, le build aspettano il proprio turno, e il bot aggiorna il commento solo a
build finita. Nei momenti di disservizio di Cloudflare la coda si allunga
parecchio: guardare https://www.cloudflarestatus.com (componente *Workers
Builds*) prima di cercare cause nel codice. Se più commit dello stesso branch
sono in coda, a volte si compila solo l'ultimo.

Se poi la build muore con «failed to initialize … timed out» dopo alcuni minuti
di «Initializing build environment», l'ambiente di build non è mai partito: il
comando del repository non è stato eseguito (nemmeno il clone), quindi non è un
problema del codice. È provisioning lato Cloudflare, tipico dei disservizi in
corso: si riprova (push di un commit vuoto, o «Retry build» nella dashboard)
quando lo status page torna verde.

Per sapere cosa serve la produzione senza aspettare il bot:

```bash
curl -s https://xmap.jshep.xyz/ | sha256sum   # confronta con apps/web/dist/index.html
sha256sum apps/web/dist/index.html            # dopo `pnpm build:web` su main
```

I log delle build si leggono dalla dashboard («View logs ↗» nel commento o nel
check run «Workers Builds: xmap-studio» della PR). Il token OAuth di `wrangler
login` non dà accesso all'API `/builds` (manca lo scope: risponde 403).

### Se l'anteprima chiede il login di Cloudflare Access

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
