#!/usr/bin/env node
// Finto XMap per lo spike: HTTP + WebSocket su 127.0.0.1, senza dipendenze.
// Stampa l'header Origin di ogni richiesta e lo rimanda nella risposta, così si
// vede quale origine dovrà accettare il vero canale di XMap Studio.
//
//   node local-echo.mjs [porta]      (default 47615)
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

const port = Number(process.argv[2]) || 47615
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function stamp() {
  return new Date().toLocaleTimeString()
}

const server = createServer((req, res) => {
  const origin = req.headers.origin
  console.log(`${stamp()} HTTP ${req.method} ${req.url} Origin=${origin ?? '(assente)'}`)
  // Solo per lo spike: qualunque origine. Il canale vero confronterà l'Origin con quella rilevata qui.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, origin: origin ?? null, method: req.method, url: req.url, body }))
  })
})

// Frame di testo non frammentato (sufficiente per lo spike).
function encodeText(text) {
  const payload = Buffer.from(text)
  const len = payload.length
  const head = len < 126 ? Buffer.from([0x81, len]) : Buffer.from([0x81, 126, len >> 8, len & 0xff])
  return Buffer.concat([head, payload])
}

function decodeFrame(buf) {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    return { opcode: -1 }
  }
  const mask = masked ? buf.subarray(offset, offset + 4) : null
  offset += masked ? 4 : 0
  const data = Buffer.from(buf.subarray(offset, offset + len))
  if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]
  return { opcode, text: data.toString('utf8') }
}

server.on('upgrade', (req, socket) => {
  const origin = req.headers.origin
  console.log(`${stamp()} WS ${req.url} Origin=${origin ?? '(assente)'}`)
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.destroy()
    return
  }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  )
  socket.on('data', buf => {
    const frame = decodeFrame(buf)
    if (!frame) return
    if (frame.opcode === 0x8) {
      socket.end(Buffer.from([0x88, 0]))
      return
    }
    if (frame.opcode === 0x1) {
      socket.write(encodeText(JSON.stringify({ ok: true, origin: origin ?? null, echo: frame.text })))
    }
  })
  socket.on('error', () => socket.destroy())
})

server.listen(port, '127.0.0.1', () => {
  console.log(`${stamp()} finto XMap in ascolto su http://127.0.0.1:${port} (ws://127.0.0.1:${port}/ws)`)
})
