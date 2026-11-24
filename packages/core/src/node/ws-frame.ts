/**
 * Il minimo di WebSocket (RFC 6455) che serve a un server locale che riceve
 * messaggi di testo: handshake, decodifica dei frame del client, codifica dei
 * frame del server. Niente estensioni (permessi di compressione rifiutati),
 * niente messaggi binari. Scritto qui per non aggiungere dipendenze.
 */
import { createHash } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODE_CONTINUATION = 0x0;
export const OPCODE_TEXT = 0x1;
export const OPCODE_BINARY = 0x2;
export const OPCODE_CLOSE = 0x8;
export const OPCODE_PING = 0x9;
export const OPCODE_PONG = 0xa;

/** Codici di chiusura usati dal server. */
export const CLOSE_NORMAL = 1000;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_INVALID_PAYLOAD = 1007;
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_TOO_BIG = 1009;

const MAX_CONTROL_PAYLOAD = 125;

/** Valore di `Sec-WebSocket-Accept` per la chiave mandata dal client. */
export function websocketAcceptKey(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

/** Chiave valida: 16 byte in base64. */
export function isValidWebsocketKey(key: string): boolean {
  return /^[A-Za-z0-9+/]{22}==$/.test(key);
}

export class WebsocketProtocolError extends Error {
  constructor(
    readonly closeCode: number,
    message: string
  ) {
    super(message);
  }
}

export type WebsocketEvent =
  | { type: 'text'; text: string }
  | { type: 'ping'; data: Buffer }
  | { type: 'pong' }
  | { type: 'close'; code: number | null };

/**
 * Decodifica il flusso del client un pezzo alla volta. `maxMessageBytes`
 * limita sia il singolo frame sia il messaggio ricomposto dai frammenti: chi
 * supera il limite riceve un errore prima che il server ne tenga in memoria
 * il contenuto.
 */
export class WebsocketDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentsBytes = 0;
  private inMessage = false;
  private readonly utf8 = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly maxMessageBytes: number) {}

  /** Aggiunge dati e restituisce gli eventi completi; lancia `WebsocketProtocolError` se il client sbaglia. */
  push(chunk: Buffer): WebsocketEvent[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const events: WebsocketEvent[] = [];
    for (;;) {
      const event = this.next();
      if (event === undefined) break;
      if (event !== null) events.push(event);
    }
    return events;
  }

  /** Un frame dal buffer: `undefined` se ne mancano dei pezzi, `null` se era un frammento intermedio. */
  private next(): WebsocketEvent | null | undefined {
    const buf = this.buffer;
    if (buf.length < 2) return undefined;
    const fin = (buf[0] & 0x80) !== 0;
    if ((buf[0] & 0x70) !== 0) throw new WebsocketProtocolError(CLOSE_PROTOCOL_ERROR, 'Bit riservati non ammessi.');
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    if (!masked) throw new WebsocketProtocolError(CLOSE_PROTOCOL_ERROR, 'Frame del client senza maschera.');
    let length = buf[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) return undefined;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return undefined;
      const high = buf.readUInt32BE(2);
      const low = buf.readUInt32BE(6);
      // Oltre 4 GiB è comunque fuori da ogni limite ragionevole.
      if (high !== 0) throw new WebsocketProtocolError(CLOSE_TOO_BIG, 'Messaggio troppo grande.');
      length = low;
      offset = 10;
    }

    const isControl = (opcode & 0x08) !== 0;
    if (isControl) {
      if (!fin || length > MAX_CONTROL_PAYLOAD) {
        throw new WebsocketProtocolError(CLOSE_PROTOCOL_ERROR, 'Frame di controllo non valido.');
      }
    } else if (length > this.maxMessageBytes || this.fragmentsBytes + length > this.maxMessageBytes) {
      throw new WebsocketProtocolError(CLOSE_TOO_BIG, 'Messaggio troppo grande.');
    }

    if (buf.length < offset + 4 + length) return undefined;
    const mask = buf.subarray(offset, offset + 4);
    const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buffer = buf.subarray(offset + 4 + length);

    switch (opcode) {
      case OPCODE_PING:
        return { type: 'ping', data: payload };
      case OPCODE_PONG:
        return { type: 'pong' };
      case OPCODE_CLOSE:
        return { type: 'close', code: payload.length >= 2 ? payload.readUInt16BE(0) : null };
      case OPCODE_TEXT:
        if (this.inMessage) throw new WebsocketProtocolError(CLOSE_PROTOCOL_ERROR, 'Nuovo messaggio prima della fine del precedente.');
        return this.collect(payload, fin);
      case OPCODE_CONTINUATION:
        if (!this.inMessage) throw new WebsocketProtocolError(CLOSE_PROTOCOL_ERROR, 'Frammento senza messaggio.');
        return this.collect(payload, fin);
      case OPCODE_BINARY:
        throw new WebsocketProtocolError(CLOSE_UNSUPPORTED_DATA, 'Sono ammessi solo messaggi di testo.');
      default:
        throw new WebsocketProtocolError(CLOSE_PROTOCOL_ERROR, 'Tipo di frame sconosciuto.');
    }
  }

  private collect(payload: Buffer, fin: boolean): WebsocketEvent | null {
    if (!fin) {
      this.inMessage = true;
      this.fragments.push(payload);
      this.fragmentsBytes += payload.length;
      return null;
    }
    const whole = this.fragments.length === 0 ? payload : Buffer.concat([...this.fragments, payload]);
    this.inMessage = false;
    this.fragments = [];
    this.fragmentsBytes = 0;
    try {
      return { type: 'text', text: this.utf8.decode(whole) };
    } catch {
      throw new WebsocketProtocolError(CLOSE_INVALID_PAYLOAD, 'Testo non valido (UTF-8).');
    }
  }
}

/** Frame del server (mai mascherato), in un solo pezzo. */
export function encodeFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const length = payload.length;
  let head: Buffer;
  if (length < 126) {
    head = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
    head.writeUInt32BE(length >>> 0, 6);
  }
  return Buffer.concat([head, payload]);
}

export function encodeText(text: string): Buffer {
  return encodeFrame(OPCODE_TEXT, Buffer.from(text, 'utf8'));
}

export function encodeClose(code: number, reason = ''): Buffer {
  // Il motivo si accorcia per caratteri, così il taglio non cade dentro un carattere UTF-8.
  let text = reason;
  while (Buffer.byteLength(text, 'utf8') > MAX_CONTROL_PAYLOAD - 2) text = text.slice(0, -1);
  const reasonBytes = Buffer.from(text, 'utf8');
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return encodeFrame(OPCODE_CLOSE, payload);
}
