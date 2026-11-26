# Claude accanto alla mappa (MCP)

L'app desktop espone le mappe aperte a Claude con il
[Model Context Protocol](https://modelcontextprotocol.io): mentre lavori su una
mappa, Claude la legge e la modifica **nella finestra aperta**, non sul file. Ogni
modifica compare subito, seleziona il blocco toccato e si annulla con Ctrl+Z come
quelle fatte a mano. Su disco si scrive solo con `save_map`, che passa dallo
stesso salvataggio dell'app (validazione, backup, blocco con XMind aperto).

Solo desktop: la web app non può ospitare il collegamento.

## Configurazione

Tutto parte da **Impostazioni › Integrazioni › Claude**, che mostra anche lo
stato del collegamento.

**Claude Desktop**: *Aggiungi a Claude Desktop* genera l'estensione
`xmap-studio.mcpb` (in `userData/claude/`) e la apre con Claude Desktop, che
chiede conferma e la installa. Se il sistema non associa i `.mcpb` a Claude,
la si installa a mano da Claude › Impostazioni › Estensioni › Impostazioni
avanzate › *Installa estensione…* (il pulsante *Mostra il file* apre la
cartella). L'estensione gira sul Node incluso in Claude Desktop: non serve
installare altro.

**Claude Code**: il comando da copiare avvia lo stesso eseguibile dell'app in
modalità ponte, per esempio

```bash
claude mcp add xmap-studio -- /percorso/XMap-Studio.AppImage --mcp
```

(AppImage ed `.exe` portable usano il percorso del file originale; in sviluppo e
nel pacchetto Arch è `electron <app> --mcp`). È un server MCP **stdio** standard.

In entrambi i casi XMap Studio deve essere aperto quando Claude usa gli
strumenti; ad app chiusa il client vede comunque gli strumenti e riceve
«XMap Studio non è aperto…».

## Perché non come Claude in Chrome

Il riferimento è il collegamento di Claude in Chrome con Claude Desktop, letto
nel codice di Claude Desktop (build Linux 45.3.3):

```text
Claude Desktop ──socket Unix──▶ chrome-native-host ◀──stdio (native messaging)── Chrome ◀── estensione
  /tmp/claude-mcp-browser-bridge-<utente>/<pid>.sock
```

- il socket sta in una cartella `0700`; Claude Desktop rifiuta link simbolici,
  permessi diversi da 700 e proprietari diversi dall'utente;
- le due parti si accoppiano con `claude-local-pairing/v1`: entrambe con
  l'accesso a claude.ai, attestazioni firmate da
  `claude.ai/api/oauth/local_pairing/attest` e verificate con le JWKS di
  Anthropic (tipo di client `desktop`/`extension`, stessa organizzazione, chiave
  legata al canale);
- ID dell'estensione, nome dell'host e server `claude-in-chrome` sono scritti nel
  codice di Claude Desktop.

È un'integrazione interna di Anthropic: le attestazioni le firma solo claude.ai
per i propri client, e non c'è un'API per terze parti. La strada documentata per
un server MCP locale di terzi sono le **Desktop Extensions** (`.mcpb`). XMap
Studio ne riprende la struttura (ponte locale + socket in una cartella `0700`
verificata dal client) e sostituisce l'attestazione con una chiave di
accoppiamento generata dall'app e messa dentro l'estensione, così l'utente non
copia nessun token.

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
Claude Desktop ──stdio── estensione .mcpb (mcp-bridge.mjs) ─┐
                                                            ├─socket locale── agent-socket.ts (main) ── dispatchAgentRequest ── mcp-host.ts ──IPC── useMcpBridge (renderer)
Claude Code ──stdio── xmap-studio --mcp (mcp-bridge.ts) ────┘                                                                                    runAgentTool(controller)
```

- `packages/core/src/agent/`: definizioni degli strumenti, esecuzione sul
  `AppController` (`tools.ts`), protocollo MCP (`mcp.ts`), richieste comuni ai
  trasporti e catalogo (`link.ts`), estensione `.mcpb` (`mcpb.ts`, manifest 0.3,
  `server.type: node`). Testati in `tests/agent-*.test.ts` e `tests/mcpb.test.ts`.
  Nessuna dipendenza nuova: il protocollo è scritto a mano.
- `packages/core/src/node/mcp-bridge.ts`: il ponte. MCP su stdio (una riga
  JSON-RPC per messaggio); `initialize`, `ping` e `tools/list` rispondono anche ad
  app chiusa (catalogo del ponte), con l'app aperta il catalogo lo dà l'app;
  `tools/call` va all'app. Deve restare **autosufficiente** (solo moduli `node:`):
  il JavaScript compilato si copia così com'è nell'estensione. Testato in
  `tests/mcp-bridge.test.ts`.
- `packages/core/src/node/agent-socket.ts`: il server del socket, testato in
  `tests/agent-socket.test.ts`.
- `apps/desktop/src/claude-link.ts`: chiave in `userData/claude-link.json`
  (`0600`), avvio del server, generazione e apertura del `.mcpb`, comando per
  Claude Code, modalità `--mcp` (`runClaudeCodeBridge`, senza finestre e senza
  blocco di istanza singola). Se un'altra istanza ha già il socket (versione
  installata e versione di sviluppo aperte insieme) la seconda non si collega a
  Claude e lo dice in Impostazioni. `XMAP_MCP_SOCKET` cambia il percorso
  (sviluppo, due istanze).
- `apps/desktop/src/mcp-host.ts`: `dispatchAgentRequest`, punto comune a Claude
  e Hermes: sceglie la finestra e gira la chiamata (`mcp:request` /
  `mcp:response`) con timeout.
- `apps/web/src/app/useMcpBridge.ts`: nel renderer esegue gli strumenti in coda,
  uno alla volta, dopo aver confermato un titolo in corso di modifica; aggiorna la
  vista e seleziona il blocco toccato.

Il ponte si ricollega da solo: chiudere e riaprire l'app non richiede di
riavviare Claude.

### Socket e chiave

- Percorso: `$XDG_RUNTIME_DIR/xmap-studio-<uid>/mcp.sock` (senza
  `XDG_RUNTIME_DIR`, sotto la cartella temporanea); su Windows
  `\\.\pipe\xmap-studio-mcp-<utente>`. L'estensione ne porta il percorso
  assoluto.
- L'app crea la cartella `0700` (rifiuta link simbolici e cartelle di altri
  utenti), toglie un socket rimasto da un'app chiusa male, rifiuta di partire se
  il socket risponde (un'altra istanza) e mette il socket a `0600`.
- Prima di collegarsi il ponte controlla, come Claude Desktop con Chrome, che
  cartella e socket siano dell'utente, che la cartella sia `0700` e che non ci
  siano link simbolici.
- Protocollo: una riga JSON per messaggio. Il primo è
  `{"type":"auth","token":"…"}` (entro 5 s, confronto a tempo costante); l'app
  risponde `{"type":"auth","ok":true,"app":"xmap-studio","protocol":1,"version":…}`
  oppure `ok:false` con il motivo, e chiude. Poi le richieste di `link.ts`
  (`{"id":1,"op":"call","tool":"read_map","args":{}}`, `op: "catalog"`,
  `op: "maps"`), anche in parallelo.
- Limiti: 8 client, 16 richieste in corso per client, messaggi fino a 4 MiB.
- *Rigenera* la chiave: i ponti collegati con la vecchia cadono, il `.mcpb`
  generato si cancella e l'estensione installata va aggiunta di nuovo; Claude
  Code legge la chiave dal file a ogni collegamento e non richiede niente.

Cosa protegge: niente porte di rete, quindi nessun sito web e nessun altro
computer; su Unix nessun altro utente (cartella `0700`); su Windows, dove la
named pipe non ha permessi restrittivi, la chiave. Limite accettato: un
programma dello stesso utente può leggere la chiave come la legge Claude. Su
disco si scrive comunque solo con `save_map`, che passa dalle stesse protezioni
del salvataggio dell'app.

Il vecchio server MCP HTTP su `127.0.0.1:47616` non c'è più: chi lo aveva
configurato in Claude Code lo sostituisce con il comando stdio di Impostazioni.

## Secondo trasporto: Hermes Desktop (WebSocket)

Per un agente che non gira sulla stessa macchina (un gateway Hermes remoto) c'è
un secondo trasporto per le stesse richieste, con token: un WebSocket su `127.0.0.1`, che
usa il plugin "xmap-studio" di Hermes Desktop sul computer dell'utente
(`integrations/hermes/`, pubblicato come `gioelerosana/xmap-studio-hermes-connector`).
È spento di default: si accende in Impostazioni › Integrazioni › Hermes, che mostra porta,
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
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_map","arguments":{}}}' \
  | pnpm --filter @xmap/desktop exec electron . --mcp
```
