# Claude accanto alla mappa (server MCP)

L'app desktop espone le mappe aperte a Claude con il
[Model Context Protocol](https://modelcontextprotocol.io): mentre lavori su una
mappa, Claude la legge e la modifica **nella finestra aperta**, non sul file. Ogni
modifica compare subito, seleziona il blocco toccato e si annulla con Ctrl+Z come
quelle fatte a mano. Su disco si scrive solo con `save_map`, che passa dallo
stesso salvataggio dell'app (validazione, backup, blocco con XMind aperto).

Solo desktop: la web app non può ospitare un server MCP.

## Configurazione

Il client di Claude avvia il server su stdio; XMap Studio deve essere aperto.

| Installazione | Comando |
|---|---|
| AppImage | `/percorso/XMap-Studio-….AppImage --mcp` |
| AUR / pacchetto Arch | `xmap-studio --mcp` |
| exe portable (Windows) | `C:\…\XMap-Studio-…-portable-x64.exe --mcp` |
| Sviluppo (repo compilato) | `node /percorso/xmap-studio/apps/desktop/dist/mcp-bridge.js` |

Claude Code:

```bash
claude mcp add xmap-studio -- xmap-studio --mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "xmap-studio": { "command": "xmap-studio", "args": ["--mcp"] }
  }
}
```

Con `--mcp` l'eseguibile non apre finestre e non prende il blocco di istanza
singola: fa solo da ponte verso l'istanza normale dell'app.

## Strumenti

| Strumento | Cosa fa |
|---|---|
| `list_maps` | Mappe aperte (una per finestra) e quella predefinita (finestra in primo piano) |
| `read_map` | Struttura indentata con `[id]`, note abbreviate, etichette, marker, formule, relazioni; foglio mostrato e selezione dell'utente |
| `get_topic` | Contenuto completo di un blocco, percorso e figli |
| `find_topics` | Ricerca in titoli, note, etichette e formule |
| `list_markers` | Id dei marker del catalogo |
| `add_topics` | Sottoalberi sotto un blocco, in un solo passo di undo (le formule `latex` in un secondo passo) |
| `update_topic` | Titolo, note, etichette, link, colore e marker in un solo passo di undo |
| `set_equation` | Formula MathJax nativa (schema di [`XMIND-FORMAT.md`](XMIND-FORMAT.md)); `latex` vuoto la toglie |
| `move_topic` | Prima/dopo un blocco o dentro un blocco |
| `delete_topic` | Elimina il ramo, o solo il blocco con `keepChildren` |
| `add_relationship` | Relazione tra due blocchi dello stesso foglio |
| `select_topic` | Seleziona un blocco nell'app, senza modificare |
| `save_map` | Salva nel file della mappa; rifiuta senza file o con XMind aperto, mai dialoghi |

Tutti tranne `list_maps` accettano `map` (numero da `list_maps`); senza, si usa la
finestra in primo piano o l'ultima usata.

## Architettura

```text
client di Claude ──stdio (JSON-RPC)── mcp-bridge.ts ──socket locale── mcp-host.ts (main) ──IPC── useMcpBridge (renderer)
                                       createMcpServer                  sceglie la finestra        runAgentTool(controller)
```

- `packages/core/src/agent/`: definizioni degli strumenti, esecuzione sul
  `AppController` (`tools.ts`) e protocollo MCP senza I/O (`mcp.ts`), testati in
  `tests/agent-*.test.ts`. Nessuna dipendenza nuova: il protocollo (initialize,
  ping, tools/list, tools/call) è scritto a mano.
- `apps/desktop/src/mcp-socket.ts`: percorso del canale e lettura a righe.
  Socket Unix in `$XDG_RUNTIME_DIR` (o nella cartella temporanea), permessi
  `0600`; named pipe dell'utente su Windows. `XMAP_MCP_SOCKET` lo sostituisce
  (sviluppo, test). Se il socket è già servito da un'altra istanza (es. app
  installata e versione di sviluppo) la seconda non lo usa.
- `apps/desktop/src/mcp-host.ts`: nel main process ascolta il canale e gira la
  chiamata alla finestra (`mcp:request` / `mcp:response`), con timeout.
- `apps/web/src/app/useMcpBridge.ts`: nel renderer esegue gli strumenti in coda,
  uno alla volta, dopo aver confermato un titolo in corso di modifica; aggiorna la
  vista e seleziona il blocco toccato.

Il bridge non tocca file e non ha stato: apre una connessione per chiamata, così
chiudere e riaprire l'app non richiede di riavviare il client. Su stdout passano
solo messaggi del protocollo.

## Secondo trasporto: Hermes Desktop (WebSocket)

Per un agente che non gira sulla stessa macchina (un gateway Hermes remoto) c'è
un secondo trasporto per le stesse richieste: un WebSocket su `127.0.0.1`, che
usa il plugin "xmap-studio" di Hermes Desktop sul computer dell'utente
(`integrations/hermes/`, pubblicato come `gioelerosana/xmap-studio-hermes-connector`).
È spento di default: si accende in Impostazioni › Hermes, che mostra porta,
token di accoppiamento e stato, e ha il pulsante che installa il plugin in
Hermes Desktop (link `hermes://plugin/install?repo=…`).

```text
gateway Hermes (remoto) ──evento / ctx.rest── Hermes Desktop: plugin xmap-studio ──ws://127.0.0.1:47615── hermes-link.ts (main) ── dispatchAgentRequest ── finestra
```

- `packages/core/src/agent/link.ts`: messaggi (`AgentLinkRequest` /
  `AgentLinkResponse`, operazioni `maps`, `call`, `catalog`) e catalogo degli
  strumenti (`agentCatalog()`: nomi, descrizioni, schemi e istruzioni), così il
  plugin non ne tiene una copia.
- `packages/core/src/node/ws-frame.ts` e `agent-link.ts`: WebSocket minimo
  (RFC 6455, solo testo, senza dipendenze) e server del collegamento, testati in
  `tests/ws-frame.test.ts` e `tests/agent-link.test.ts`.
- `apps/desktop/src/hermes-link.ts`: preferenze in `userData/hermes-link.json`
  (permessi `0600`), avvio e arresto del server, stato per la UI. La porta è
  47615; `XMAP_HERMES_PORT` la sostituisce (sviluppo).
- `apps/desktop/src/mcp-host.ts`: `dispatchAgentRequest` è il punto comune ai
  due trasporti.

Protocollo: il primo messaggio è `{"type":"auth","token":"…"}`, a cui l'app
risponde `{"type":"auth","ok":true,"app":"xmap-studio","protocol":1,…}`; poi
`{"id":1,"op":"catalog"}`, `{"id":2,"op":"call","tool":"read_map","args":{}}`,
`{"id":3,"op":"maps"}`, con risposte `{"id":…,"ok":true,"text":…}` (o
`"catalog"`) oppure `{"id":…,"ok":false,"error":…}`.

Controlli, in ordine: solo `127.0.0.1`; header `Host` di loopback (contro il DNS
rebinding); `Origin` uguale a `file://`, l'origine del renderer di Hermes Desktop
impacchettato (verificata con lo spike `integrations/hermes/xmap-ping`); token
nel primo messaggio entro 5 s, confrontato a tempo costante. L'Origin tiene fuori
i siti web ma non le pagine locali: la protezione vera è il token. Limiti:
messaggi fino a 4 MiB, 16 richieste in corso per client, 8 client, 130 s per
richiesta; il server manda un ping ogni 30 s e chiude chi non risponde.

## Prova manuale

```bash
pnpm build
XMAP_MCP_SOCKET=/tmp/xmap.sock pnpm dev:desktop    # app con una mappa aperta
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_map","arguments":{}}}' \
  | XMAP_MCP_SOCKET=/tmp/xmap.sock node apps/desktop/dist/mcp-bridge.js
```
