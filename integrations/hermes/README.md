# XMap Studio in Hermes Agent

Plugin di [Hermes Agent](https://github.com/NousResearch/hermes-agent) che
permette all'agente, anche su un **gateway remoto**, di leggere e modificare la
mappa aperta in XMap Studio sul tuo computer. Il ponte è Hermes Desktop, che è
già collegato e autenticato con il gateway: niente tunnel, porte aperte o proxy.

```
gateway (server)  tool xmap_*  ──evento del gateway / long-poll──▶  Hermes Desktop (portatile)
                     ▲                                                plugin xmap-studio
                     └──────────── esito via ctx.rest ◀──────────── ws://127.0.0.1:47615 ── XMap Studio
```

| Cartella | Cosa |
|---|---|
| `xmap-studio/` | il plugin: metà agente (`__init__.py`, `bus.py`, `dashboard/`) e metà desktop (`desktop/plugin.js`) |
| `xmap-ping/` | lo spike che ha verificato i canali sul gateway remoto (esito nel suo README) |

Funziona con le chat di **Hermes Desktop**. Una richiesta da Telegram o
dall'API del gateway gira in un altro processo (`gateway run`), che non vede i
Desktop collegati: il tool risponde subito che XMap non è collegato.

## Installazione

### 1. Server: la metà agente

La cartella va in `$HERMES_HOME/plugins/xmap-studio/` sulla macchina del
gateway. Con Hermes in Docker (la home è il volume, es. `/opt/data`):

```bash
scp -r integrations/hermes/xmap-studio <server>:/tmp/xmap-studio
ssh <server>
docker cp /tmp/xmap-studio <container>:/opt/data/plugins/xmap-studio
docker exec <container> chown -R hermes:hermes /opt/data/plugins/xmap-studio
docker exec -u hermes <container> hermes plugins doctor xmap-studio     # "OK", 13 tool
docker exec -u hermes <container> hermes plugins enable xmap-studio
docker restart <container>      # le route /api/plugins/xmap-studio/ si montano all'avvio
```

Senza Docker: copia in `~/.hermes/plugins/xmap-studio`, `hermes plugins enable
xmap-studio`, riavvia il gateway.

I tool si chiamano `xmap_list_maps`, `xmap_read_map`, … (toolset
`xmap-studio`) e valgono dalla sessione successiva all'attivazione.

### 2. Portatile: la metà desktop

Con un gateway remoto Hermes Desktop non copia da solo la metà desktop:

```bash
mkdir -p ~/.hermes/desktop-plugins/xmap-studio
cp integrations/hermes/xmap-studio/desktop/plugin.js ~/.hermes/desktop-plugins/xmap-studio/plugin.js
```

In Hermes Desktop: **Capabilities → Plugins → XMap Studio**, attivalo (se non
compare: Ctrl+K → *Reload desktop plugins*). Con un gateway locale basta il
passo 1: Desktop copia `desktop/plugin.js` da solo.

## Accoppiamento

1. In XMap Studio: **Impostazioni › Hermes**, accendi **Collega a Hermes**.
   Compaiono porta (47615) e token.
2. Copia il token (pulsante *Copia*).
3. In Hermes Desktop: **Impostazioni → Plugin → XMap Studio**, inserisci porta
   e token, *Salva*. Lo stato diventa «Collegato a XMap Studio» e in XMap
   «Collegato (1 plugin)»; nella barra di stato di Hermes compare `XMap ●`.
4. Prova: *Prova* nella pagina del plugin elenca le mappe aperte; in chat,
   «leggi la mappa aperta in XMap».

*Rigenera* in XMap cambia il token e scollega i plugin: va reinserito in Hermes.

## Come si comporta

- Lettura prima di tutto: le istruzioni dei tool chiedono di partire da
  `xmap_read_map`; ogni modifica compare subito in XMap e si annulla con
  Ctrl+Z. Niente si scrive su disco finché l'utente non chiede di salvare
  (`xmap_save_map`).
- Più finestre di Hermes Desktop, o più computer collegati allo stesso gateway:
  la prima che prende la chiamata la esegue, le altre la lasciano. Una chiamata
  non si esegue mai due volte.
- Tempi: se nessun Desktop prende la chiamata entro 15 s, o XMap non risponde
  entro 130 s, il tool risponde con un errore.
- Il catalogo degli strumenti arriva da XMap a ogni collegamento e si conserva
  in `$HERMES_HOME/xmap-studio/catalog.json`: vale dal riavvio successivo del
  gateway. Fino ad allora si usa `xmap-studio/catalog.json` del pacchetto
  (rigenerato con `node scripts/hermes-catalog.mjs`; il test core
  `hermes-catalog.test.ts` segnala quando è vecchio).

## Diagnostica

| Sintomo | Causa e rimedio |
|---|---|
| Il tool dice «XMap non è collegato» | nessun Hermes Desktop ha fatto poll negli ultimi 45 s: apri Hermes Desktop, attiva il plugin; oppure la chat non è di Desktop (Telegram, API) |
| «Hermes Desktop è collegato ma XMap Studio no» | XMap chiuso o collegamento spento in Impostazioni › Hermes; controlla porta e token nel plugin |
| Plugin: «Token rifiutato da XMap Studio» | token vecchio o sbagliato: ricopialo da XMap, *Salva* |
| Plugin: «XMap Studio non raggiungibile» | XMap chiuso, collegamento spento, o porta diversa; in XMap lo stato dice se la porta è occupata |
| `ctx.rest` 404 nella pagina del plugin | metà agente non attiva: `hermes plugins enable xmap-studio` e riavvio del gateway |
| Il modello non vede i tool `xmap_*` | sessione aperta prima dell'attivazione: aprine una nuova; `hermes plugins list` sul server |

Stato lato server: `GET /api/plugins/xmap-studio/status` (Desktop collegati,
chiamate in attesa, catalogo). Log di Desktop: `hermes logs gui -f`. In XMap:
Impostazioni › Debug (con il menu sviluppatore) mostra i log del collegamento.

## Sicurezza

XMap ascolta solo su `127.0.0.1`, accetta solo l'origine `file://` di Hermes
Desktop e un Host di loopback, e richiede il token (32 byte casuali, in
`userData/hermes-link.json` con permessi `0600`). L'Origin tiene fuori i siti
web ma non i programmi locali: la protezione vera è il token. Il collegamento è
spento di default. Dettagli in [`docs/MCP.md`](../../docs/MCP.md).

## Test

```bash
pnpm test                                                        # core: WebSocket, server, catalogo
uvx --with fastapi --with httpx pytest -p no:cacheprovider integrations/hermes/xmap-studio/tests
```
