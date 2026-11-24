// xmap-studio — metà desktop del plugin (Hermes Desktop, disk plugin: niente JSX, niente build).
//
// Ponte tra il gateway Hermes (anche remoto, raggiunto con ctx.rest) e XMap Studio aperto su
// questo computer (WebSocket su 127.0.0.1, protocollo in docs/MCP.md §"Secondo trasporto").
// Il server (dashboard/plugin_api.py) tiene la coda delle chiamate: /poll è anche la presenza
// del computer, /claim assegna una chiamata sola, /result ne riporta l'esito, /catalog
// trasmette gli strumenti di XMap. Niente ctx.socket e niente host.request('plugin.…'):
// con OAuth non funzionano (esito dello spike xmap-ping).
import { atom, useValue, STATUSBAR_AREAS, StatusDot } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const PLUGIN_ID = 'xmap-studio'
const DEFAULT_PORT = 47615
const CLIENT_ID = `desk-${Math.random().toString(36).slice(2, 8)}`
const REQUEST_TIMEOUT_MS = 125000
const SHORT_TIMEOUT_MS = 15000
const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 30000
const POLL_WAIT_S = 20
const POLL_TIMEOUT_MS = 30000
const EMPTY_POLL_PAUSE_MS = 10000
const SEEN_LIMIT = 500
const LOG_LIMIT = 50

const $log = atom([])
const $xmap = atom({ state: 'connecting', version: '', error: '' })
const $gateway = atom({ lastOk: 0, error: '' })
const $probe = atom({ busy: false, text: '', error: '' })

const STATES = {
  'token-missing': { label: 'Token mancante', dot: 'warn' },
  connecting: { label: 'Collegamento in corso…', dot: 'muted' },
  connected: { label: 'Collegato a XMap Studio', dot: 'good' },
  unreachable: {
    label: 'XMap Studio non raggiungibile (è aperto? il collegamento è acceso in Impostazioni › Hermes?)',
    dot: 'warn'
  },
  rejected: { label: 'Token rifiutato da XMap Studio', dot: 'bad' }
}

const TONE_TEXT = {
  good: 'text-(--ui-success)',
  warn: 'text-(--ui-warning)',
  bad: 'text-(--ui-danger)',
  muted: 'text-(--ui-text-tertiary)'
}

const BUTTON =
  'rounded-md border border-(--ui-border) px-2 py-1 text-xs text-(--ui-text-primary) hover:bg-(--ui-bg-tertiary)'
const INPUT = 'rounded-md border border-(--ui-border) bg-transparent px-2 py-1 text-sm text-(--ui-text-primary)'

function log(text) {
  const line = `${new Date().toLocaleTimeString()} ${text}`
  $log.set([line, ...$log.get()].slice(0, LOG_LIMIT))
}

function describe(err) {
  return err && err.message ? err.message : String(err)
}

function setXmap(patch) {
  $xmap.set({ ...$xmap.get(), ...patch })
}

function setGateway(patch) {
  $gateway.set({ ...$gateway.get(), ...patch })
}

function stateLabel(x) {
  if (x.state === 'connected') return x.version ? `Collegato a XMap Studio ${x.version}` : STATES.connected.label
  return STATES[x.state] ? STATES[x.state].label : x.state
}

function gatewayLine(g) {
  const ok = g.lastOk
    ? `ultimo poll riuscito alle ${new Date(g.lastOk).toLocaleTimeString()}`
    : 'nessun poll riuscito ancora'
  return g.error ? `gateway: ${ok} · ultimo errore: ${g.error}` : `gateway: ${ok}`
}

function button(label, onClick, disabled = false) {
  return jsx('button', { type: 'button', onClick, disabled, className: BUTTON, children: label })
}

function pre(text) {
  return jsx('pre', {
    className:
      'max-h-64 overflow-auto rounded-md border border-(--ui-border) p-2 text-[0.6875rem] text-(--ui-text-secondary) whitespace-pre-wrap',
    children: text
  })
}

export default {
  id: PLUGIN_ID,
  name: 'XMap Studio',
  register(ctx) {
    let disposed = false
    // Socket corrente: i callback di un socket già sostituito o chiuso non fanno nulla.
    let ws = null
    let authed = false
    let authRejected = false
    let nextId = 1
    const pending = new Map() // id richiesta → { cancel, done(err, msg) }
    const seen = new Set() // id delle chiamate già prese in carico (dedupe tra evento e poll)
    let retryCancel = null
    let retryDelay = BACKOFF_MIN_MS
    let wakeUp = null

    ctx.onDispose(() => {
      disposed = true
      clearRetry()
      closeSocket()
      wake()
    })

    function readPort() {
      const value = Number(ctx.storage.get('port', DEFAULT_PORT))
      return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : DEFAULT_PORT
    }

    function readToken() {
      const value = ctx.storage.get('token', '')
      return typeof value === 'string' ? value.trim() : ''
    }

    function clearRetry() {
      if (retryCancel) retryCancel()
      retryCancel = null
    }

    function scheduleRetry() {
      clearRetry()
      const delay = retryDelay
      retryDelay = Math.min(retryDelay * 2, BACKOFF_MAX_MS)
      retryCancel = ctx.setTimeout(() => {
        retryCancel = null
        connect()
      }, delay)
    }

    // Attesa interrompibile: wake() la chiude subito (XMap appena autenticato, o disposal).
    function pause(ms) {
      return new Promise(resolve => {
        const cancel = ctx.setTimeout(finish, ms)
        function finish() {
          wakeUp = null
          resolve()
        }
        wakeUp = () => {
          cancel()
          finish()
        }
      })
    }

    function wake() {
      if (wakeUp) wakeUp()
    }

    function settlePending(id, err, msg) {
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      entry.cancel()
      entry.done(err, msg)
    }

    function failPending(message) {
      for (const id of [...pending.keys()]) settlePending(id, new Error(message))
    }

    function closeSocket() {
      const socket = ws
      ws = null
      authed = false
      failPending('Collegamento con XMap Studio interrotto.')
      if (socket) {
        try {
          socket.close()
        } catch {}
      }
    }

    function connect() {
      clearRetry()
      closeSocket()
      authRejected = false
      if (disposed) return
      const token = readToken()
      if (!token) {
        setXmap({ state: 'token-missing', version: '', error: '' })
        return
      }
      const port = readPort()
      setXmap({ state: 'connecting', version: '', error: '' })
      let socket
      try {
        socket = new WebSocket(`ws://127.0.0.1:${port}/`)
      } catch (err) {
        setXmap({ state: 'unreachable', version: '', error: describe(err) })
        scheduleRetry()
        return
      }
      ws = socket
      socket.onopen = () => {
        if (ws !== socket) return
        try {
          socket.send(JSON.stringify({ type: 'auth', token }))
        } catch {
          socket.close()
        }
      }
      socket.onmessage = ev => {
        if (ws === socket) onMessage(socket, ev.data)
      }
      socket.onclose = ev => {
        if (ws === socket) onClose(socket, ev)
      }
    }

    function reconnect() {
      retryDelay = BACKOFF_MIN_MS
      connect()
    }

    function onMessage(socket, data) {
      let msg
      try {
        msg = JSON.parse(String(data))
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'auth') {
        onAuth(socket, msg)
        return
      }
      if (authed && typeof msg.id === 'number') settlePending(msg.id, null, msg)
    }

    function onAuth(socket, msg) {
      if (msg.ok === true) {
        if (authed) return
        authed = true
        retryDelay = BACKOFF_MIN_MS
        const version = typeof msg.version === 'string' ? msg.version : ''
        setXmap({ state: 'connected', version, error: '' })
        log(`collegato a XMap Studio ${version}`.trim())
        wake()
        void postCatalog()
        return
      }
      authRejected = true
      const error = typeof msg.error === 'string' ? msg.error : 'Token rifiutato.'
      setXmap({ state: 'rejected', version: '', error })
      log(`auth rifiutata: ${error}`)
      socket.close()
    }

    function onClose(socket, ev) {
      ws = null
      const wasAuthed = authed
      authed = false
      failPending('Collegamento con XMap Studio interrotto.')
      if (disposed) return
      const code = ev && typeof ev.code === 'number' ? ev.code : 0
      // Dopo un rifiuto (o una chiusura 1008 prima dell'auth) non si riprova in loop.
      if (authRejected || (!wasAuthed && code === 1008)) {
        authRejected = true
        setXmap({ state: 'rejected', version: '', error: $xmap.get().error || 'Chiuso da XMap Studio.' })
        return
      }
      setXmap({ state: 'unreachable', version: '', error: `collegamento chiuso (codice ${code})` })
      if (wasAuthed) log('collegamento con XMap Studio interrotto')
      scheduleRetry()
    }

    function callXmap(body) {
      return new Promise((resolve, reject) => {
        const socket = ws
        if (!socket || !authed) {
          reject(new Error('Non collegato a XMap Studio.'))
          return
        }
        const id = nextId++
        const cancel = ctx.setTimeout(
          () => settlePending(id, new Error('XMap Studio non ha risposto in tempo.')),
          REQUEST_TIMEOUT_MS
        )
        pending.set(id, {
          cancel,
          done: (err, msg) => (err ? reject(err) : resolve(msg))
        })
        try {
          socket.send(JSON.stringify({ id, ...body }))
        } catch (err) {
          settlePending(id, err)
        }
      })
    }

    async function postCatalog() {
      try {
        const res = await callXmap({ op: 'catalog' })
        if (!res || !res.catalog) {
          log(`catalogo non ricevuto: ${res && res.error ? res.error : 'risposta vuota'}`)
          return
        }
        await ctx.rest('/catalog', {
          method: 'POST',
          body: { client: CLIENT_ID, catalog: res.catalog },
          timeoutMs: SHORT_TIMEOUT_MS
        })
        const tools = Array.isArray(res.catalog.tools) ? res.catalog.tools.length : 0
        log(`catalogo inviato al gateway (${tools} strumenti)`)
      } catch (err) {
        log(`catalogo non inviato: ${describe(err)}`)
      }
    }

    async function runCall(call) {
      if (typeof call.tool !== 'string' || !call.tool) {
        return { ok: false, error: 'Chiamata senza nome di strumento.' }
      }
      const args = call.args && typeof call.args === 'object' ? call.args : {}
      try {
        const res = await callXmap({ op: 'call', tool: call.tool, args })
        if (res && res.ok === true) return { ok: true, text: typeof res.text === 'string' ? res.text : '' }
        const error = res && typeof res.error === 'string' && res.error ? res.error : 'XMap Studio non ha eseguito lo strumento.'
        return { ok: false, error }
      } catch (err) {
        return { ok: false, error: describe(err) }
      }
    }

    async function handleCall(call, via) {
      if (disposed || !call || typeof call.id !== 'string' || !call.id) return
      // Senza XMap autenticato non si reclama: il server ripropone la chiamata col prossimo poll.
      if (!authed) return
      if (seen.has(call.id)) return
      seen.add(call.id)
      if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value)
      const short = call.id.slice(0, 8)
      const tool = typeof call.tool === 'string' ? call.tool : '?'
      log(`chiamata ${tool} ${short} via ${via}`)
      let claim
      try {
        claim = await ctx.rest('/claim', {
          method: 'POST',
          body: { id: call.id, client: CLIENT_ID },
          timeoutMs: SHORT_TIMEOUT_MS
        })
      } catch (err) {
        seen.delete(call.id)
        log(`claim fallito: ${describe(err)}`)
        return
      }
      if (!claim || !claim.ok) {
        log(`non reclamata: ${claim && claim.reason ? claim.reason : 'motivo sconosciuto'}`)
        return
      }
      const result = await runCall(call)
      try {
        const done = await ctx.rest('/result', {
          method: 'POST',
          body: { id: call.id, client: CLIENT_ID, ...result },
          timeoutMs: SHORT_TIMEOUT_MS
        })
        log(`risposta ${short}: ${done && done.ok ? (result.ok ? 'consegnata' : 'errore consegnato') : done && done.reason}`)
      } catch (err) {
        log(`risposta non consegnata: ${describe(err)}`)
      }
    }

    // Long-poll: con XMap autenticato (xmap=1) il server trattiene la richiesta fino a POLL_WAIT_S.
    // Senza XMap risponde subito con calls vuote: si aspetta un po' prima del giro successivo.
    async function pollLoop() {
      let backoff = BACKOFF_MIN_MS
      while (!disposed) {
        const online = authed
        try {
          const version = online ? $xmap.get().version || '' : ''
          const query =
            `/poll?client=${CLIENT_ID}&xmap=${online ? 1 : 0}` +
            `&version=${encodeURIComponent(version)}&wait=${POLL_WAIT_S}`
          const res = await ctx.rest(query, { timeoutMs: POLL_TIMEOUT_MS })
          if (disposed) break
          backoff = BACKOFF_MIN_MS
          setGateway({ lastOk: Date.now(), error: '' })
          const calls = res && Array.isArray(res.calls) ? res.calls : []
          for (const call of calls) void handleCall(call, 'poll')
          if (!online) await pause(EMPTY_POLL_PAUSE_MS)
        } catch (err) {
          if (disposed) break
          const message = describe(err)
          if ($gateway.get().error !== message) log(`poll: ${message}`)
          setGateway({ error: message })
          await pause(backoff)
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
        }
      }
    }

    function saveConnection(portText, tokenText) {
      const port = Number(portText)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Porta non valida: da 1 a 65535.'
      const token = String(tokenText || '').trim()
      if (port === readPort() && token === readToken()) return ''
      ctx.storage.set('port', port)
      ctx.storage.set('token', token)
      log(`impostazioni salvate: porta ${port}${token ? '' : ', token vuoto'}`)
      reconnect()
      return ''
    }

    async function probeXmap() {
      $probe.set({ busy: true, text: '', error: '' })
      try {
        const res = await callXmap({ op: 'call', tool: 'list_maps', args: {} })
        if (res && res.ok === true) {
          $probe.set({ busy: false, text: String(res.text || ''), error: '' })
        } else {
          $probe.set({ busy: false, text: '', error: res && res.error ? res.error : 'Risposta non valida.' })
        }
      } catch (err) {
        $probe.set({ busy: false, text: '', error: describe(err) })
      }
    }

    function Page() {
      const x = useValue($xmap)
      const gateway = useValue($gateway)
      const lines = useValue($log)
      const probe = useValue($probe)
      const [port, setPort] = useState(() => String(readPort()))
      const [token, setToken] = useState(() => readToken())
      const [showToken, setShowToken] = useState(false)
      const [portError, setPortError] = useState('')

      function save() {
        setPortError(saveConnection(port, token))
      }

      function onEnter(e) {
        if (e.key === 'Enter') save()
      }

      const tone = STATES[x.state] ? STATES[x.state].dot : 'muted'

      return jsxs('div', {
        className: 'flex flex-col gap-3 p-4 text-sm text-(--ui-text-primary)',
        children: [
          jsx('div', { className: 'font-medium', children: 'XMap Studio' }),
          jsx('div', {
            className: 'text-xs text-(--ui-text-tertiary)',
            children: 'In XMap Studio: Impostazioni › Hermes → accendi «Collega a Hermes», poi copia qui porta e token.'
          }),
          jsxs('div', {
            className: 'flex flex-wrap items-end gap-3',
            children: [
              jsxs('label', {
                className: 'flex flex-col gap-1 text-xs',
                children: [
                  'Porta',
                  jsx('input', {
                    type: 'number',
                    min: 1,
                    max: 65535,
                    value: port,
                    className: `${INPUT} w-24`,
                    onChange: e => setPort(e.target.value),
                    onBlur: save,
                    onKeyDown: onEnter
                  })
                ]
              }),
              jsxs('label', {
                className: 'flex min-w-56 flex-1 flex-col gap-1 text-xs',
                children: [
                  'Token',
                  jsxs('span', {
                    className: 'flex gap-1',
                    children: [
                      jsx('input', {
                        type: showToken ? 'text' : 'password',
                        autoComplete: 'off',
                        spellCheck: false,
                        value: token,
                        className: `${INPUT} min-w-0 flex-1`,
                        onChange: e => setToken(e.target.value),
                        onBlur: save,
                        onKeyDown: onEnter
                      }),
                      button(showToken ? 'Nascondi' : 'Mostra', () => setShowToken(!showToken))
                    ]
                  })
                ]
              })
            ]
          }),
          portError ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: portError }) : null,
          jsxs('div', {
            className: 'flex flex-wrap gap-2',
            children: [
              button('Salva', save),
              button('Riconnetti', reconnect),
              button(probe.busy ? 'Prova in corso…' : 'Prova', () => void probeXmap(), probe.busy)
            ]
          }),
          jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [jsx(StatusDot, { tone }), jsx('span', { className: TONE_TEXT[tone], children: stateLabel(x) })]
              }),
              x.error ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `Dettaglio: ${x.error}` }) : null,
              jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: gatewayLine(gateway) })
            ]
          }),
          probe.error ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: probe.error }) : null,
          probe.text ? pre(probe.text) : null,
          jsx('div', { className: 'text-xs font-medium', children: 'Registro' }),
          pre(lines.length ? lines.join('\n') : '(vuoto)')
        ]
      })
    }

    function Chip() {
      const x = useValue($xmap)
      const gateway = useValue($gateway)
      const info = STATES[x.state] || STATES.connecting
      return jsxs('span', {
        className: 'flex items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
        title: `XMap Studio: ${stateLabel(x)}${x.error ? ` (${x.error})` : ''}\n${gatewayLine(gateway)}`,
        children: ['XMap', jsx(StatusDot, { tone: info.dot })]
      })
    }

    ctx.registerSettingsPage?.({ id: 'settings', title: 'XMap Studio', icon: 'plug', render: () => jsx(Page, {}) })
    ctx.register({ id: 'chip', area: STATUSBAR_AREAS.right, order: 140, render: () => jsx(Chip, {}) })

    ctx.onEvent(`plugin.${PLUGIN_ID}.call`, ev => {
      void handleCall(ev && ev.payload, 'event')
    })

    connect()
    void pollLoop()
  }
}
