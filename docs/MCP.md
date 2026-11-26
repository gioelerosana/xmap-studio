# Claude accanto alla mappa (server MCP)

L'app desktop espone le mappe aperte a Claude con il
[Model Context Protocol](https://modelcontextprotocol.io): mentre lavori su una
mappa, Claude la legge e la modifica **nella finestra aperta**, non sul file. Ogni
modifica compare subito, seleziona il blocco toccato e si annulla con Ctrl+Z come
quelle fatte a mano. Su disco si scrive solo con `save_map`, che passa dallo
stesso salvataggio dell'app (validazione, backup, blocco con XMind aperto).

Solo desktop: la web app non può ospitare un server MCP.

## Configurazione

Il server è dentro l'app: con XMap Studio aperto risponde su

```text
http://127.0.0.1:47616/mcp
```

con il trasporto **Streamable HTTP** di MCP, **senza autenticazione**. Non c'è
niente da avviare a parte l'app; Impostazioni › Claude mostra stato, indirizzo e
comandi da copiare.

Claude Code:

```bash
claude mcp add --transport http xmap-studio http://127.0.0.1:47616/mcp
```

Altri client che accettano server HTTP in una configurazione `mcpServers`:

```json
{
  "mcpServers": {
    "xmap-studio": { "type": "http", "url": "http://127.0.0.1:47616/mcp" }
  }
}
```

Il vecchio server su stdio (`xmap-studio --mcp`, `mcp-bridge.js`) non esiste più:
era fragile (un processo ponte per client, socket da ripulire, stdout da tenere
pulito). Con `--mcp` l'eseguibile ora scrive su stderr l'indirizzo nuovo ed esce
con codice 1, senza aprire finestre. `XMAP_MCP_PORT` cambia la porta (sviluppo,
due istanze sulla stessa macchina).

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
client di Claude ──HTTP POST /mcp (JSON-RPC)── mcp-http.ts (main) ── createMcpServer ── mcp-host.ts ──IPC── useMcpBridge (renderer)
                                                                                         sceglie la finestra   runAgentTool(controller)
```

- `packages/core/src/agent/`: definizioni degli strumenti, esecuzione sul
  `AppController` (`tools.ts`) e protocollo MCP senza I/O (`mcp.ts`), testati in
  `tests/agent-*.test.ts`. Nessuna dipendenza nuova: il protocollo (initialize,
  ping, tools/list, tools/call) è scritto a mano.
- `packages/core/src/node/mcp-http.ts`: trasporto Streamable HTTP, testato in
  `tests/mcp-http.test.ts`. Senza stato: ogni POST porta un messaggio JSON-RPC
  (o un array) e riceve la risposta in `application/json`; una notifica riceve
  `202`. Niente SSE, niente `Mcp-Session-Id`; GET e DELETE rispondono `405`, come
  ammette la specifica per un server che non apre stream.
- `apps/desktop/src/mcp-host.ts`: nel main process avvia il server, gira la
  chiamata alla finestra (`mcp:request` / `mcp:response`) con timeout ed espone
  lo stato alla UI (`mcpServer:get`). Se la porta è occupata (es. versione
  installata e versione di sviluppo aperte insieme) la seconda istanza non serve
  MCP e lo dice in Impostazioni › Claude.
- `apps/web/src/app/useMcpBridge.ts`: nel renderer esegue gli strumenti in coda,
  uno alla volta, dopo aver confermato un titolo in corso di modifica; aggiorna la
  vista e seleziona il blocco toccato.

Chiudere e riaprire l'app non richiede di riavviare il client: ogni richiesta è
indipendente.

### Sicurezza senza autenticazione

Il server è pensato per il client di Claude sulla stessa macchina, quindi non
chiede token. Al loro posto:

- ascolta solo su `127.0.0.1` e rifiuta connessioni da altri indirizzi;
- header `Host` uguale a `127.0.0.1:<porta>` o `localhost:<porta>` (contro il DNS
  rebinding), altrimenti `403`;
- header `Origin`, se presente, solo di loopback (`http(s)://localhost`,
  `127.0.0.1`, `[::1]`), altrimenti `403` come impone la specifica;
- `Content-Type: application/json` obbligatorio (`415`) e nessun header CORS:
  una pagina web non può mandare una richiesta "semplice" né leggere le risposte;
- `MCP-Protocol-Version`, se presente, fra quelle supportate (`400`);
- corpo fino a 4 MiB (`413`), 30 s per ricevere la richiesta.

Limite accettato: qualunque programma dell'utente (o di un altro account della
stessa macchina) che apre `127.0.0.1:47616` può usare gli strumenti, come farebbe
il client di Claude. Su disco si scrive comunque solo con `save_map`, che passa
dalle stesse protezioni del salvataggio dell'app.

## Secondo trasporto: Hermes Desktop (WebSocket)

Per un agente che non gira sulla stessa macchina (un gateway Hermes remoto) c'è
un secondo trasporto per le stesse richieste, con token: un WebSocket su `127.0.0.1`, che
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
pnpm dev:desktop    # app con una mappa aperta
curl -s http://127.0.0.1:47616/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_map","arguments":{}}}'
```
