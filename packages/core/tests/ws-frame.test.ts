import { describe, expect, it } from 'vitest';
import {
  CLOSE_GOING_AWAY,
  CLOSE_INVALID_PAYLOAD,
  CLOSE_PROTOCOL_ERROR,
  CLOSE_TOO_BIG,
  CLOSE_UNSUPPORTED_DATA,
  OPCODE_BINARY,
  OPCODE_CLOSE,
  OPCODE_CONTINUATION,
  OPCODE_PING,
  OPCODE_PONG,
  OPCODE_TEXT,
  WebsocketDecoder,
  WebsocketProtocolError,
  encodeClose,
  encodeFrame,
  encodeText,
  isValidWebsocketKey,
  websocketAcceptKey,
  type WebsocketEvent,
} from '../src/node/ws-frame.js';

const MASK = Buffer.from([0x12, 0x34, 0x56, 0x78]);

/** Frame come lo manda un client WebSocket: mascherato, con la lunghezza nella forma corretta. */
function maskedFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const n = payload.length;
  let header: Buffer;
  if (n < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | n;
  } else if (n <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(n, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(n), 2);
  }
  header[0] = (fin ? 0x80 : 0) | opcode;
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= MASK[i & 3];
  return Buffer.concat([header, MASK, masked]);
}

/** Codice di chiusura lanciato da `action`; fallisce se non lancia un `WebsocketProtocolError`. */
function closeCodeOf(action: () => unknown): number {
  try {
    action();
  } catch (error) {
    if (error instanceof WebsocketProtocolError) return error.closeCode;
    throw error;
  }
  throw new Error('Doveva lanciare un errore di protocollo.');
}

function textEvents(events: WebsocketEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'text' ? [event.text] : []));
}

describe('websocketAcceptKey e isValidWebsocketKey', () => {
  it('calcola il Sec-WebSocket-Accept dell esempio della RFC 6455', () => {
    expect(websocketAcceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('accetta solo chiavi di 16 byte in base64', () => {
    expect(isValidWebsocketKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe(true);
    expect(isValidWebsocketKey('short')).toBe(false);
    expect(isValidWebsocketKey('dGhlIHNhbXBsZSBub25jZQ')).toBe(false);
    expect(isValidWebsocketKey('dGhlIHNhbXBsZSBub25jZQ=A')).toBe(false);
    expect(isValidWebsocketKey('')).toBe(false);
  });
});

describe('WebsocketDecoder: frame validi', () => {
  it('decodifica un testo mascherato in un solo pezzo', () => {
    const decoder = new WebsocketDecoder(1024);
    const events = decoder.push(maskedFrame(OPCODE_TEXT, Buffer.from('ciao', 'utf8')));
    expect(events).toEqual([{ type: 'text', text: 'ciao' }]);
  });

  it('decodifica un testo arrivato un byte alla volta', () => {
    const decoder = new WebsocketDecoder(1024);
    const frame = maskedFrame(OPCODE_TEXT, Buffer.from('mappa à è ì', 'utf8'));
    const events: WebsocketEvent[] = [];
    for (const byte of frame) events.push(...decoder.push(Buffer.from([byte])));
    expect(events).toEqual([{ type: 'text', text: 'mappa à è ì' }]);
  });

  it('decodifica più frame nello stesso pezzo di dati', () => {
    const decoder = new WebsocketDecoder(1024);
    const events = decoder.push(
      Buffer.concat([maskedFrame(OPCODE_TEXT, Buffer.from('uno')), maskedFrame(OPCODE_TEXT, Buffer.from('due'))])
    );
    expect(textEvents(events)).toEqual(['uno', 'due']);
  });

  it('decodifica una lunghezza a 16 bit (126 byte, lunghezza 126 nel frame)', () => {
    const decoder = new WebsocketDecoder(1024);
    const text = 'a'.repeat(300);
    const frame = maskedFrame(OPCODE_TEXT, Buffer.from(text));
    expect(frame[1] & 0x7f).toBe(126);
    expect(textEvents(decoder.push(frame))).toEqual([text]);
  });

  it('decodifica una lunghezza a 64 bit (oltre 65535 byte)', () => {
    const decoder = new WebsocketDecoder(100_000);
    const text = 'b'.repeat(70_000);
    const frame = maskedFrame(OPCODE_TEXT, Buffer.from(text));
    expect(frame[1] & 0x7f).toBe(127);
    expect(textEvents(decoder.push(frame))).toEqual([text]);
  });

  it('ricompone un messaggio frammentato (text fin=0 più continuation fin=1)', () => {
    const decoder = new WebsocketDecoder(1024);
    const first = decoder.push(maskedFrame(OPCODE_TEXT, Buffer.from('ciao '), false));
    expect(first).toEqual([]);
    const second = decoder.push(maskedFrame(OPCODE_CONTINUATION, Buffer.from('mondo')));
    expect(second).toEqual([{ type: 'text', text: 'ciao mondo' }]);
  });

  it('ricompone un messaggio UTF-8 spezzato tra due frammenti', () => {
    const decoder = new WebsocketDecoder(1024);
    const bytes = Buffer.from('è', 'utf8');
    decoder.push(maskedFrame(OPCODE_TEXT, bytes.subarray(0, 1), false));
    expect(textEvents(decoder.push(maskedFrame(OPCODE_CONTINUATION, bytes.subarray(1))))).toEqual(['è']);
  });

  it('restituisce un evento ping con il payload', () => {
    const decoder = new WebsocketDecoder(1024);
    const events = decoder.push(maskedFrame(OPCODE_PING, Buffer.from('p1')));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ping' });
    expect((events[0] as { data: Buffer }).data.toString()).toBe('p1');
  });

  it('restituisce un evento pong', () => {
    const decoder = new WebsocketDecoder(1024);
    expect(decoder.push(maskedFrame(OPCODE_PONG, Buffer.alloc(0)))).toEqual([{ type: 'pong' }]);
  });

  it('restituisce il codice di chiusura, o null se il frame non ne ha', () => {
    const decoder = new WebsocketDecoder(1024);
    const withCode = Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from('bye')]);
    expect(decoder.push(maskedFrame(OPCODE_CLOSE, withCode))).toEqual([{ type: 'close', code: 1000 }]);
    expect(decoder.push(maskedFrame(OPCODE_CLOSE, Buffer.alloc(0)))).toEqual([{ type: 'close', code: null }]);
  });
});

describe('WebsocketDecoder: errori di protocollo', () => {
  it('rifiuta un frame del client senza maschera (1002)', () => {
    const decoder = new WebsocketDecoder(1024);
    const unmasked = Buffer.concat([Buffer.from([0x81, 0x02]), Buffer.from('hi')]);
    expect(closeCodeOf(() => decoder.push(unmasked))).toBe(CLOSE_PROTOCOL_ERROR);
  });

  it('rifiuta i bit riservati RSV1-3 (1002)', () => {
    const decoder = new WebsocketDecoder(1024);
    const frame = maskedFrame(OPCODE_TEXT, Buffer.from('x'));
    frame[0] |= 0x40;
    expect(closeCodeOf(() => decoder.push(frame))).toBe(CLOSE_PROTOCOL_ERROR);
  });

  it('rifiuta i messaggi binari (1003)', () => {
    const decoder = new WebsocketDecoder(1024);
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_BINARY, Buffer.from([1, 2, 3]))))).toBe(
      CLOSE_UNSUPPORTED_DATA
    );
  });

  it('rifiuta un tipo di frame sconosciuto (1002)', () => {
    const decoder = new WebsocketDecoder(1024);
    expect(closeCodeOf(() => decoder.push(maskedFrame(0x3, Buffer.alloc(0))))).toBe(CLOSE_PROTOCOL_ERROR);
  });

  it('rifiuta un singolo frame oltre maxMessageBytes (1009)', () => {
    const decoder = new WebsocketDecoder(64);
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_TEXT, Buffer.alloc(100, 0x61))))).toBe(CLOSE_TOO_BIG);
  });

  it('rifiuta la somma dei frammenti oltre maxMessageBytes (1009)', () => {
    const decoder = new WebsocketDecoder(10);
    expect(decoder.push(maskedFrame(OPCODE_TEXT, Buffer.alloc(6, 0x61), false))).toEqual([]);
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_CONTINUATION, Buffer.alloc(6, 0x62))))).toBe(
      CLOSE_TOO_BIG
    );
  });

  it('rifiuta il testo che non è UTF-8 valido (1007)', () => {
    const decoder = new WebsocketDecoder(1024);
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_TEXT, Buffer.from([0xc3, 0x28]))))).toBe(
      CLOSE_INVALID_PAYLOAD
    );
  });

  it('rifiuta una continuation senza messaggio in corso (1002)', () => {
    const decoder = new WebsocketDecoder(1024);
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_CONTINUATION, Buffer.from('x'))))).toBe(
      CLOSE_PROTOCOL_ERROR
    );
  });

  it('rifiuta un nuovo messaggio di testo mentre un frammentato non è finito (1002)', () => {
    const decoder = new WebsocketDecoder(1024);
    decoder.push(maskedFrame(OPCODE_TEXT, Buffer.from('a'), false));
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_TEXT, Buffer.from('b'))))).toBe(CLOSE_PROTOCOL_ERROR);
  });

  it('rifiuta un frame di controllo oltre 125 byte (1002)', () => {
    const decoder = new WebsocketDecoder(1024);
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_PING, Buffer.alloc(126))))).toBe(CLOSE_PROTOCOL_ERROR);
  });

  it('rifiuta un frame di controllo frammentato (fin=0, 1002)', () => {
    const decoder = new WebsocketDecoder(1024);
    expect(closeCodeOf(() => decoder.push(maskedFrame(OPCODE_PING, Buffer.alloc(0), false)))).toBe(
      CLOSE_PROTOCOL_ERROR
    );
  });
});

describe('encodeFrame, encodeText, encodeClose', () => {
  it('usa la lunghezza a 7 bit sotto i 126 byte', () => {
    const frame = encodeFrame(OPCODE_TEXT, Buffer.alloc(5, 0x61));
    expect(frame.subarray(0, 2)).toEqual(Buffer.from([0x81, 5]));
    expect(frame.length).toBe(2 + 5);
  });

  it('usa la lunghezza a 16 bit tra 126 e 65535 byte', () => {
    const frame = encodeFrame(OPCODE_TEXT, Buffer.alloc(200, 0x61));
    expect(frame.subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 0x00, 0xc8]));
    expect(frame.length).toBe(4 + 200);
    const edge = encodeFrame(OPCODE_TEXT, Buffer.alloc(65535));
    expect(edge.subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 0xff, 0xff]));
  });

  it('usa la lunghezza a 64 bit oltre 65535 byte', () => {
    const frame = encodeFrame(OPCODE_TEXT, Buffer.alloc(70_000));
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(127);
    expect(frame.readUInt32BE(2)).toBe(0);
    expect(frame.readUInt32BE(6)).toBe(70_000);
    expect(frame.length).toBe(10 + 70_000);
  });

  it('imposta il bit FIN e l opcode del frame del server, senza maschera', () => {
    const frame = encodeFrame(OPCODE_PONG, Buffer.from('x'));
    expect(frame[0]).toBe(0x80 | OPCODE_PONG);
    expect(frame[1] & 0x80).toBe(0);
  });

  it('encodeText codifica il testo in UTF-8', () => {
    const frame = encodeText('è');
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(2);
    expect(frame.subarray(2).toString('utf8')).toBe('è');
  });

  it('encodeClose scrive il codice e il motivo', () => {
    const frame = encodeClose(1008, 'no');
    expect(frame[0]).toBe(0x80 | OPCODE_CLOSE);
    expect(frame.subarray(2)).toEqual(Buffer.from([0x03, 0xf0, 0x6e, 0x6f]));
  });

  it('encodeClose senza motivo manda solo il codice', () => {
    expect(encodeClose(CLOSE_GOING_AWAY).subarray(2)).toEqual(Buffer.from([0x03, 0xe9]));
  });
});
