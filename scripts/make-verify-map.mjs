#!/usr/bin/env node
// Genera una mappa .xmind che esercita i campi ancora da collaudare in XMind:
// blocco libero con `position` collegato da freccia, `customWidth`,
// `attributedTitle` (grassetto/corsivo parziale) e immagine ridimensionata.
// Si apre il file in XMind e si controlla che appaia come in XMap Studio.
//
// Uso (dopo `pnpm build`):  node scripts/make-verify-map.mjs [percorso.xmind]
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const core = await import(path.join(root, 'packages/core/dist/index.js'));
const { atomicWrite } = await import(path.join(root, 'packages/core/dist/node/index.js'));
const JSZip = (await import(path.join(root, 'packages/core/node_modules/jszip/lib/index.js'))).default;

const target = path.resolve(process.argv[2] ?? path.join(root, 'demo/Verifica-v1.xmap-studio.xmind'));

/** PNG RGB a righe orizzontali colorate, senza dipendenze. */
function stripedPng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profondità
  ihdr[9] = 2; // RGB
  const colors = [[0x4f, 0x8a, 0xf7], [0xf7, 0xb5, 0x4f], [0x4f, 0xc7, 0x8a]];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const [r, g, b] = colors[Math.floor((y / h) * colors.length)];
    for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

const zip = new JSZip();
zip.file('content.json', JSON.stringify([
  {
    id: 'sheet-verifica',
    class: 'sheet',
    title: 'Verifica v1',
    rootTopic: {
      id: 'root',
      class: 'topic',
      title: 'Verifica XMap Studio v1',
      structureClass: 'org.xmind.ui.map.unbalanced',
      children: {
        attached: [
          { id: 'larghezza', title: 'Blocco con larghezza manuale: questo testo deve andare a capo su più righe anche in XMind' },
          { id: 'formattato', title: 'Formattazione parziale' },
          { id: 'immagini', title: 'Immagine ridimensionata' },
        ],
        detached: [{ id: 'libero', title: 'Immagine libera', position: { x: 380, y: -220 } }],
      },
    },
  },
]));
zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
zip.file('metadata.json', '{}');

const controller = new core.AppController();
await controller.open(await zip.generateAsync({ type: 'uint8array' }), null, path.basename(target));

controller.setTopicCustomWidth('larghezza', 160);
controller.setTopicTitleRuns('formattato', [
  { text: 'Testo ' },
  { text: 'grassetto', bold: true },
  { text: ', ' },
  { text: 'corsivo', italic: true },
  { text: ' e normale' },
]);
const { newId: imageId } = controller.addImageTopic('immagini', stripedPng(120, 90), 'image/png', { width: 120, height: 90 });
controller.setTopicImageSize(imageId, { width: 240, height: 180 });
// Il blocco libero diventa un'immagine e si sposta come col trascinamento sulla mappa.
controller.setTopicImage('libero', stripedPng(90, 60), 'image/png', { width: 90, height: 60 });
controller.setTopicPosition('libero', { x: 420, y: -240 });
controller.addTopicRelationship('immagini', 'libero', 'freccia verso il blocco libero');

// prepareArchiveBytes valida in memoria e lancia se l'archivio non è coerente.
const { bytes } = await controller.prepareArchiveBytes();
await atomicWrite(target, bytes, { makeBackup: false });
console.log(`Scritto ${target} (${bytes.length} byte)`);
