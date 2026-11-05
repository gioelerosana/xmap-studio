# Integrazione Nextcloud

Integrazione **opt-in** della web app: l'utente collega il proprio account
Nextcloud e apre e salva le mappe `.xmind` direttamente lì. «Salva» riscrive lo
stesso file su Nextcloud, senza download né «Salva in File». È la risposta
all'assenza della File System Access API su iOS/iPadOS, dove la web app non può
riscrivere un file locale aperto.

Disponibile solo nella web app servita via `http(s)`. Nell'app desktop c'è già il
file system, e nel wrapper iOS (`app://`) il proxy non esiste.

## Perché un proxy

Nextcloud non invia intestazioni CORS né su WebDAV (`remote.php/dav`) né sugli
endpoint del login: il browser non può chiamarlo direttamente. Il supporto CORS
configurabile ([nextcloud/server#40537](https://github.com/nextcloud/server/pull/40537))
non è ancora entrato in Nextcloud. Le richieste passano quindi da un proxy sullo
stesso sito dell'app:

```text
browser ──/nc/<percorso>──▶ Worker xmap.jshep.xyz ──https──▶ server Nextcloud
          X-Nextcloud-Server: https://cloud.example.com
```

- Codice unico: `packages/core/src/cloud/proxy.ts` (`handleNextcloudProxy`),
  usato dal Worker (`worker/index.ts`, solo su `/nc/*` grazie a
  `run_worker_first` in `wrangler.jsonc`) e da `vite dev`/`vite preview`
  (plugin `nextcloudProxy` in `apps/web/vite.config.ts`).
- Non salva né registra nulla: inoltra e basta. Credenziali e file transitano
  dal Worker, cifrati in HTTPS su entrambi i lati.
- Per non diventare un relay aperto inoltra solo verso server `https://` con nome
  di dominio pubblico (niente IP, `localhost`, `.local`, `.lan`, …), solo i
  percorsi e i metodi di `ALLOWED_ROUTES`, solo le intestazioni elencate (niente
  cookie, `Set-Cookie` scartato) e senza seguire i redirect.
- Il service worker non mette mai in cache `/nc/`.

Conseguenza: un Nextcloud raggiungibile solo in LAN o in tailnet non funziona
dalla web app pubblicata, perché il Worker gira sulla rete Cloudflare. Funziona
invece da `pnpm dev:tailnet` / `serve:tailnet`, dove il proxy è il processo
locale; resta però il filtro sui nomi (niente IP o `.lan`).

## Login: Login Flow v2

Non si usa l'OAuth2 di Nextcloud: richiederebbe che l'amministratore di ogni
istanza registri un client. Il
[Login Flow v2](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/LoginFlow/index.html)
è quello delle app ufficiali:

1. `POST index.php/login/v2` → URL di login e token di poll;
2. l'app apre la pagina di Nextcloud (la finestra si apre prima della richiesta,
   altrimenti iOS la blocca), l'utente accede (anche con 2FA) e autorizza;
3. l'app interroga `index.php/login/v2/poll` ogni 2 s (al massimo 20 minuti) e
   riceve una **app password** dedicata;
4. `ocs/v2.php/cloud/user` fornisce l'id utente per i percorsi WebDAV.

Le credenziali stanno in `localStorage` (`xmap-studio.nextcloud`) di quel
browser. «Scollega» revoca l'app password (`DELETE ocs/v2.php/core/apppassword`)
e la cancella; la si può revocare anche da Nextcloud › Impostazioni › Sicurezza.

## Apertura e salvataggio

- **Apri da Nextcloud…**: elenco delle cartelle (PROPFIND, `Depth: 1`) con le
  sole mappe `.xmind`. Il file scaricato ricorda percorso ed ETag (`cloudFile`
  in `App.tsx`).
- **Salva** su una mappa aperta da Nextcloud: `PUT` con `If-Match: <ETag>`. Se il
  file è cambiato altrove, Nextcloud risponde 412 e nulla viene sovrascritto
  (errore `conflict`). A salvataggio riuscito si tiene il nuovo ETag.
- **Salva su Nextcloud…**: sceglie cartella e nome. Un file nuovo si crea con
  `If-None-Match: *`, così non sovrascrive un file comparso nel frattempo. La
  sostituzione di un file esistente va confermata e usa `If-Match`.
- I byte sono quelli di `prepareArchiveBytes()`, già validati
  (`validateArchiveBytes`) prima della scrittura, come per ogni altro
  salvataggio. Nextcloud tiene le proprie versioni del file. I backup in
  `.xmap-studio/backups/` restano una funzione del desktop.
- «Salva con nome» locale, o l'apertura di un file locale, tolgono il legame con
  Nextcloud.

## File

| File | Ruolo |
|---|---|
| `packages/core/src/cloud/nextcloud.ts` | client: login flow, PROPFIND, GET/PUT, errori `NextcloudError` |
| `packages/core/src/cloud/proxy.ts` | proxy (regole e handler) |
| `worker/index.ts` | Worker: asset + `/nc/*` |
| `apps/web/src/adapters/nextcloud.ts` | account in `localStorage`, transport, hook |
| `apps/web/src/components/NextcloudSection.tsx` | Impostazioni › Nextcloud (collega / scollega) |
| `apps/web/src/components/NextcloudBrowserModal.tsx` | finestra Apri da / Salva su Nextcloud |
| `packages/core/tests/nextcloud-*.test.ts` | test di client e proxy |
