import { Topic } from './types.js';
import { newTopicId, walkTopic } from './utils.js';

export const XMAP_CLIPBOARD_VERSION = 1;

export interface XmapClipboardPayload {
  xmapStudioClipboard: number;
  topic: Topic;
  /** Risorse del sottoalbero (`resources/<nome>` → base64), per incollare in un altro file. */
  resources?: Record<string, string>;
}

/** Nomi `resources/…` referenziati dalle immagini del sottoalbero. */
export function subtreeResourceNames(topic: Topic): string[] {
  const names = new Set<string>();
  walkTopic(topic, (t) => {
    const src = t.image && typeof t.image === 'object' ? t.image.src : undefined;
    if (typeof src === 'string' && src.startsWith('xap:resources/')) names.add(src.slice('xap:'.length));
  });
  return [...names];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Clona in profondità un sottoalbero di topic rigenerando tutti gli ID
 * e aggiornando i riferimenti interni (es. summaries[].topicId, collegamenti xmind:#id).
 *
 * Preserva al 100% tutti i campi personalizzati o sconosciuti per il round-trip lossless.
 * Le risorse referenziate (image.src xap:resources/…) viaggiano nel payload
 * (`resources`) e si aggiungono al file di destinazione se mancano.
 * Le relazioni di foglio che puntavano al topic originale non vengono duplicate.
 */
export function cloneTopicSubtree(topic: Topic): Topic {
  // Copia profonda completa via JSON per preservare ogni proprietà nota e sconosciuta
  const cloned: Topic = JSON.parse(JSON.stringify(topic));

  // Mappa di riassegnazione dei vecchi ID a nuovi UUID
  const idMap = new Map<string, string>();

  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj['id'] === 'string' && obj['id'].length > 0 && !idMap.has(obj['id'])) {
        idMap.set(obj['id'], newTopicId());
      }
      for (const val of Object.values(obj)) {
        collect(val);
      }
    }
  };
  collect(cloned);

  // Se per qualsiasi ragione il topic radice clonato non aveva un ID valido, gliene assegniamo uno
  if (!cloned.id || !idMap.has(cloned.id)) {
    const freshId = newTopicId();
    idMap.set(cloned.id ?? '', freshId);
    cloned.id = freshId;
  }

  const rewrite = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) rewrite(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;

    const obj = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (
        (key === 'id' || key === 'topicId' || key === 'end1Id' || key === 'end2Id') &&
        typeof val === 'string' &&
        idMap.has(val)
      ) {
        obj[key] = idMap.get(val);
      } else if (typeof val === 'string' && val.startsWith('xmind:#')) {
        const oldId = val.slice('xmind:#'.length);
        if (idMap.has(oldId)) {
          obj[key] = `xmind:#${idMap.get(oldId)}`;
        }
      } else {
        rewrite(val);
      }
    }
  };
  rewrite(cloned);

  return cloned;
}
