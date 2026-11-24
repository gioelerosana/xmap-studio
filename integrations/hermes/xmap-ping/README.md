# xmap-ping — spike del ponte Hermes ↔ XMap Studio

Plugin Hermes **di prova**, non la feature. Serve a verificare, con Hermes
Desktop collegato al gateway **remoto** con OAuth, quali canali tra server e
portatile funzionano davvero, prima di costruire il plugin `xmap-studio`.

```
SERVER  tool xmap_ping ──annuncia──▶ ① evento gateway (broadcast_plugin_event / emit_to_session)
                                     ② ctx.socket  (WebSocket /events)
                                     ③ long-poll   (GET /pending)
PORTATILE  desktop/plugin.js ──reclama (POST /claim, oppure RPC)──▶ server: vince il primo
           └─ fetch + WebSocket su 127.0.0.1 ──▶ local-echo.mjs (finto XMap, stampa l'Origin)
           └─ risultato (POST /result, oppure RPC) ──▶ il tool risponde al modello
```

| File | Dove va | Cosa fa |
|---|---|---|
| `plugin.yaml`, `__init__.py`, `bus.py` | server | tool `xmap_ping`, metodi RPC `plugin.xmap-ping.{ping,claim,result}` |
| `dashboard/manifest.json`, `dashboard/plugin_api.py` | server | route `/api/plugins/xmap-ping/*` |
| `desktop/plugin.js` | portatile | pagina in Impostazioni → Plugin, chip nella barra di stato |
| `local-echo.mjs` | portatile | finto XMap su `127.0.0.1:47615` |

Cosa si sa già dal sorgente di Hermes (`/opt/hermes-agent`, v0.23.4):

- **`ctx.socket` è un no-op con OAuth** (`apps/desktop/src/api/plugins.ts`,
  `connection.authMode === 'oauth'` → nessun WebSocket). Il canale ② dovrebbe
  quindi restare a zero: lo spike lo misura comunque.
- Il renderer di Desktop impacchettato si carica da `file://` e non ha una CSP
  propria: fetch e WebSocket verso `127.0.0.1` dovrebbero partire, ma va visto.
  In una prova con Node, il finto XMap riceve `Origin: file://` per la fetch;
  quale Origin manda Chromium per il WebSocket da `file://` lo dirà la prova vera.
- `broadcast_plugin_event` arriva ai Desktop solo se il processo che lo chiama
  è quello a cui Desktop è collegato (`hermes serve`); con `hermes gateway run`
  senza Desktop collegato è un no-op. Da qui la domanda su come gira il container.

## Installazione

### 1. Server (dentro il container)

Trova la home di Hermes nel container (di solito `/root/.hermes` o quella in
`HERMES_HOME`):

```bash
docker exec <container> sh -c 'echo ${HERMES_HOME:-$HOME/.hermes}'
```

Porta la cartella sul server (dal portatile, nella root del repo), poi dal
server copiala nel container:

```bash
scp -r integrations/hermes/xmap-ping <server>:/tmp/xmap-ping   # dal portatile
ssh <server>
docker cp /tmp/xmap-ping <container>:<HERMES_HOME>/plugins/xmap-ping
docker exec -u 0 <container> chown -R "$(docker exec <container> id -u):$(docker exec <container> id -g)" <HERMES_HOME>/plugins/xmap-ping
docker exec <container> hermes plugins doctor xmap-ping
docker exec <container> hermes plugins enable xmap-ping
docker restart <container>          # le route di plugin_api.py si montano all'avvio
```

`desktop/` e `local-echo.mjs` dentro il container non fanno danni: con un
backend remoto Desktop non copia da lì la metà desktop.

Controlla che il caricamento non abbia lasciato errori (nessuna riga = bene):

```bash
docker exec <container> sh -c 'grep -n "xmap-ping" ${HERMES_HOME:-$HOME/.hermes}/logs/errors.log | tail'
```

### 2. Portatile

```bash
mkdir -p ~/.hermes/desktop-plugins/xmap-ping
cp integrations/hermes/xmap-ping/desktop/plugin.js ~/.hermes/desktop-plugins/xmap-ping/plugin.js
node integrations/hermes/xmap-ping/local-echo.mjs     # lascialo aperto: stampa gli Origin
```

In Hermes Desktop: **Capabilities → Plugins**, attiva `xmap-ping (spike)`
(se non compare: ⌘K/Ctrl+K → *Reload desktop plugins*). Poi
**Impostazioni → Plugin → xmap-ping**.

## Prove (in ordine)

Nella pagina xmap-ping:

1. **REST /hello** → in *Ultimi esiti* `rest` deve avere `ok: true` e un `pid`.
   Verifica il punto 1 (desktop → `plugin_api.py` sul server via `ctx.rest`).
2. **RPC ping** → `rpc` con `pong: true`. È il ripiego desktop → server sul
   socket principale del gateway. Annota se il `pid` è uguale a quello di REST.
3. **127.0.0.1 (fetch + WS)** → `local.fetch.status: 200` e `local.ws.ok: true`.
   Verifica il punto 3. Annota `renderer_origin` e, dal terminale di
   `local-echo.mjs`, le due righe `Origin=…` (HTTP e WS).
4. **Giro completo (trigger)** → dopo 4 s `trigger.status` deve avere
   `done: true`, `claimed_via` e `seen_via` (i canali che l'hanno consegnata).
   Verifica il punto 2 senza passare dal modello.
5. **Dal modello**: in una chat scrivi *«usa il tool xmap_ping con il messaggio
   ciao»*. Il tool risponde con `answered`, `announced`, `request.seen_via` e
   `bus.pids_by_part`. È la prova vera: il tool gira dove gira il turno
   dell'agente, che può essere un processo diverso dalle route.
6. **Diagnostica server** → `pids_by_part`, ultime richieste ed eventi.

Nella barra di stato il chip `xmap-ping N✓ M✗` conta le richieste completate.

## Cosa riportarmi

- gli esiti JSON delle prove 1–6 (basta copiare *Ultimi esiti* e *Richieste
  ricevute per canale*) e la risposta del tool alla prova 5;
- le righe `Origin=…` stampate da `local-echo.mjs`;
- come gira il container: comando di avvio (`hermes serve`, `hermes gateway run`,
  `hermes dashboard`, …) e il valore di `plugins.isolation` e
  `dashboard.turn_isolation` in `config.yaml`, se presenti.

## Diagnostica

- `rest` → 404: route non montate. Controlla `plugins.enabled`, riavvia il
  container, cerca `Failed to load plugin xmap-ping API routes` in `errors.log`.
- Il modello non vede `xmap_ping`: `hermes plugins list` nel container; il
  toolset del plugin è `xmap-ping` (`hermes tools` per abilitarlo, se serve).
- Prova 4 ok ma prova 5 in timeout con `pids_by_part.tool ≠ pids_by_part.api`:
  tool e route girano in processi diversi e non condividono la memoria. È un
  risultato utile, non un errore dello spike: serve un'altra strada (vedi
  sotto).
- Log del Desktop: `hermes logs gui -f` sul portatile.

## Se un punto cade

- **② `ctx.socket`** (atteso): si usano ① e ③, con ③ come rete di sicurezza.
- **① eventi non arrivano**: resta il long-poll ③, latenza ≤ 1 giro di poll.
- **`ctx.rest` non arriva**: si passa tutto su RPC (`host.request`), che viaggia
  sul socket principale del gateway già autenticato.
- **tool e route in processi diversi**: la coda passa su disco nella home del
  profilo (file per richiesta, con `rename` atomico per il claim) oppure si
  usano solo i metodi RPC, se girano nel processo del tool.
- **127.0.0.1 bloccato dal renderer**: il plugin desktop passa dal bridge
  nativo di Desktop o XMap espone il canale su un'origine diversa; da decidere
  con l'errore preciso in mano.
