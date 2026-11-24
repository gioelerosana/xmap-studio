// xmap-ping — metà desktop dello spike (Hermes Desktop, disk plugin: niente JSX, niente build).
//
// Ascolta le richieste del server su tre canali (evento del gateway, ctx.socket, long-poll
// ctx.rest), reclama ogni richiesta una sola volta, la "esegue" contro il finto XMap
// locale (fetch + WebSocket su 127.0.0.1) e restituisce il risultato via ctx.rest
// (o via RPC se ctx.rest fallisce). La pagina in Impostazioni → Plugin mostra tutto.
import { host, atom, useValue, STATUSBAR_AREAS } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const PLUGIN_ID = 'xmap-ping'
const DEFAULT_PORT = 47615
const clientId = `desk-${Math.random().toString(36).slice(2, 8)}`

const $log = atom([])
const $stats = atom({ event: 0, session: 0, socket: 0, poll: 0, done: 0, failed: 0, pollErrors: 0 })
const $last = atom({})

function log(text) {
  const line = `${new Date().toLocaleTimeString()} ${text}`
  $log.set([line, ...$log.get()].slice(0, 80))
}

function bump(key) {
  $stats.set({ ...$stats.get(), [key]: ($stats.get()[key] || 0) + 1 })
}

function setLast(key, value) {
  $last.set({ ...$last.get(), [key]: value })
}

function describe(err) {
  return err && err.message ? err.message : String(err)
}

// Il finto XMap: fetch HTTP e un WebSocket su loopback. Il server locale risponde con
// l'header Origin che ha visto, così sappiamo cosa dovrà accettare XMap.
async function probeLocal(port, message) {
  const out = { renderer_origin: location.origin, renderer_href: location.href.split('?')[0] }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ message })
    })
    out.fetch = { status: res.status, body: await res.json() }
  } catch (err) {
    out.fetch = { error: describe(err) }
  }
  out.ws = await new Promise(resolve => {
    let ws
    const timer = setTimeout(() => {
      try { ws && ws.close() } catch {}
      resolve({ error: 'timeout 5 s' })
    }, 5000)
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
      ws.onopen = () => ws.send(JSON.stringify({ message }))
      ws.onmessage = ev => {
        clearTimeout(timer)
        let body = ev.data
        try { body = JSON.parse(ev.data) } catch {}
        ws.close()
        resolve({ ok: true, body })
      }
      ws.onerror = () => { clearTimeout(timer); resolve({ error: 'errore WebSocket (vedi console)' }) }
    } catch (err) {
      clearTimeout(timer)
      resolve({ error: describe(err) })
    }
  })
  return out
}

export default {
  id: PLUGIN_ID,
  name: 'xmap-ping (spike)',
  register(ctx) {
    const seen = new Set()
    let disposed = false
    ctx.onDispose(() => { disposed = true })

    const port = () => Number(ctx.storage.get('port', DEFAULT_PORT)) || DEFAULT_PORT

    async function claim(req, via) {
      try {
        return await ctx.rest('/claim', { method: 'POST', body: { id: req.id, client: clientId, via } })
      } catch (err) {
        log(`claim REST fallito (${describe(err)}), provo RPC`)
        return host.request(`plugin.${PLUGIN_ID}.claim`, { id: req.id, client: clientId, via })
      }
    }

    async function complete(req, result) {
      try {
        return await ctx.rest('/result', { method: 'POST', body: { id: req.id, client: clientId, result } })
      } catch (err) {
        log(`result REST fallito (${describe(err)}), provo RPC`)
        return host.request(`plugin.${PLUGIN_ID}.result`, { id: req.id, client: clientId, result })
      }
    }

    // Un canale che consegna una richiesta già vista viene comunque contato e
    // segnalato al server (claim con un altro via), ma l'esecuzione resta una.
    async function handle(req, via) {
      if (!req || typeof req.id !== 'string') return
      bump(via)
      const first = !seen.has(req.id)
      seen.add(req.id)
      log(`richiesta ${req.id.slice(0, 8)} via ${via}${first ? '' : ' (doppione)'}`)
      let claimed
      try {
        claimed = await claim(req, via)
      } catch (err) {
        log(`claim fallito: ${describe(err)}`)
        bump('failed')
        return
      }
      if (!claimed || !claimed.ok) {
        if (first) log(`non reclamata: ${claimed && claimed.reason}`)
        return
      }
      const started = performance.now()
      const local = await probeLocal(port(), (req.args && req.args.message) || 'ping')
      const result = { via, client: clientId, ms_local: Math.round(performance.now() - started), local }
      try {
        const done = await complete(req, result)
        log(`risposta ${req.id.slice(0, 8)}: ${done && done.ok ? 'consegnata' : done && done.reason}`)
        bump(done && done.ok ? 'done' : 'failed')
      } catch (err) {
        log(`risposta non consegnata: ${describe(err)}`)
        bump('failed')
      }
    }

    // Canale 1: evento globale del gateway (broadcast_plugin_event) e di sessione (emit_to_session).
    // Stesso nome di evento: li distinguiamo da session_id.
    ctx.onEvent(`plugin.${PLUGIN_ID}.request`, ev => {
      handle(ev && ev.payload, ev && ev.session_id ? 'session' : 'event')
    })

    // Canale 2: ctx.socket (atteso no-op su remote OAuth).
    ctx.socket('/events', frame => {
      setLast('socket', 'frame ricevuto')
      if (frame && frame.type === 'request') handle(frame.request, 'socket')
    })

    // Canale 3: long-poll su ctx.rest.
    async function pollLoop() {
      let backoff = 1000
      while (!disposed) {
        try {
          const res = await ctx.rest(`/pending?wait=20&client=${clientId}`, { timeoutMs: 30000 })
          backoff = 1000
          for (const req of (res && res.requests) || []) {
            if (!seen.has(req.id)) handle(req, 'poll')
          }
        } catch (err) {
          bump('pollErrors')
          setLast('poll', describe(err))
          await new Promise(r => ctx.setTimeout(r, backoff))
          backoff = Math.min(backoff * 2, 30000)
        }
      }
    }
    pollLoop()

    async function run(label, fn) {
      try {
        const value = await fn()
        setLast(label, value)
        log(`${label}: ok`)
      } catch (err) {
        setLast(label, { error: describe(err) })
        log(`${label}: ${describe(err)}`)
      }
    }

    const actions = {
      rest: () => run('rest', () => ctx.rest('/hello')),
      rpc: () => run('rpc', () => host.request(`plugin.${PLUGIN_ID}.ping`, {})),
      local: () => run('local', () => probeLocal(port(), 'prova manuale')),
      trigger: () =>
        run('trigger', async () => {
          const t = await ctx.rest('/trigger', { method: 'POST', body: { message: 'dal pulsante' } })
          // Aspetta qualche secondo e rilegge lo stato: deve risultare reclamata e completata.
          await new Promise(r => ctx.setTimeout(r, 4000))
          return { trigger: t, status: await ctx.rest(`/request/${t.id}`) }
        }),
      diag: () => run('diag', () => ctx.rest('/diag'))
    }

    function button(label, onClick) {
      return jsx('button', {
        type: 'button',
        onClick,
        className:
          'rounded-md border border-(--ui-border) px-2 py-1 text-xs text-(--ui-text-primary) hover:bg-(--ui-bg-tertiary)',
        children: label
      })
    }

    function pre(value) {
      return jsx('pre', {
        className: 'max-h-64 overflow-auto rounded-md border border-(--ui-border) p-2 text-[0.6875rem] text-(--ui-text-secondary) whitespace-pre-wrap',
        children: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      })
    }

    function Page() {
      const lines = useValue($log)
      const stats = useValue($stats)
      const last = useValue($last)
      const gateway = useValue(host.state.gateway)
      return jsxs('div', {
        className: 'flex flex-col gap-3 p-4 text-sm text-(--ui-text-primary)',
        children: [
          jsx('div', { className: 'font-medium', children: 'xmap-ping — spike del ponte XMap Studio' }),
          jsx('div', {
            className: 'text-xs text-(--ui-text-tertiary)',
            children: `client ${clientId} · gateway ${String(gateway)} · origine renderer ${location.origin} · porta locale ${port()}`
          }),
          jsxs('label', {
            className: 'flex items-center gap-2 text-xs',
            children: [
              'Porta del finto XMap',
              jsx('input', {
                type: 'number',
                defaultValue: port(),
                className: 'w-24 rounded-md border border-(--ui-border) bg-transparent px-1 py-0.5',
                onChange: e => ctx.storage.set('port', Number(e.target.value) || DEFAULT_PORT)
              })
            ]
          }),
          jsxs('div', {
            className: 'flex flex-wrap gap-2',
            children: [
              button('1. REST /hello', actions.rest),
              button('2. RPC ping', actions.rpc),
              button('3. 127.0.0.1 (fetch + WS)', actions.local),
              button('4. Giro completo (trigger)', actions.trigger),
              button('Diagnostica server', actions.diag)
            ]
          }),
          jsx('div', { className: 'text-xs font-medium', children: 'Richieste ricevute per canale' }),
          pre(stats),
          jsx('div', { className: 'text-xs font-medium', children: 'Ultimi esiti' }),
          pre(last),
          jsx('div', { className: 'text-xs font-medium', children: 'Registro' }),
          pre(lines.join('\n'))
        ]
      })
    }

    ctx.registerSettingsPage?.({ id: 'spike', title: 'xmap-ping', icon: 'debug', render: () => jsx(Page, {}) })

    function Chip() {
      const stats = useValue($stats)
      return jsx('span', {
        className: 'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
        title: 'xmap-ping: richieste completate / fallite',
        children: `xmap-ping ${stats.done}✓ ${stats.failed}✗`
      })
    }

    ctx.register({ id: 'chip', area: STATUSBAR_AREAS.right, order: 140, render: () => jsx(Chip, {}) })
    log(`caricato (${clientId})`)
  }
}
