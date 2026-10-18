import { sha256Hex } from '../archive/archive.js';
import { Image, MATHJAX_PROVIDER, Topic } from './types.js';
import { newTopicId } from './utils.js';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface AddImageTopicOptions {
  title?: string;
  maxDimension?: number;
}

/**
 * Deduce l'estensione del file a partire dal tipo MIME o dai magic bytes del contenuto.
 * Supporta i formati immagine comuni (.png, .jpg, .gif, .webp, .svg, .bmp, .ico, .tiff, .avif).
 */
export function mimeToExtension(mimeType?: string, bytes?: Uint8Array): string {
  // Sniffing dei magic bytes se presenti
  if (bytes && bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return '.png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return '.jpg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return '.gif';
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return '.webp';
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return '.bmp';
    }
  }

  if (!mimeType) return '.png';
  const clean = mimeType.split(';')[0].trim().toLowerCase();
  switch (clean) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    case 'image/bmp':
      return '.bmp';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return '.ico';
    case 'image/tiff':
      return '.tiff';
    case 'image/avif':
      return '.avif';
    default:
      if (clean.startsWith('image/')) {
        const sub = clean.slice(6);
        if (/^[a-z0-9]+$/.test(sub)) return `.${sub}`;
      }
      return '.png';
  }
}

/**
 * Calcola il nome canonico della risorsa immagine in formato XMind:
 * "resources/<sha256-hex>.<ext>"
 */
export function computeImageResourceName(bytes: Uint8Array, mimeType?: string): string {
  const hash = sha256Hex(bytes);
  const ext = mimeToExtension(mimeType, bytes);
  return `resources/${hash}${ext}`;
}

/**
 * Scala le dimensioni naturali dell'immagine in modo che il lato più lungo
 * sia al massimo maxDimension (default: 400 px), preservando le proporzioni.
 * Se entrambi i lati sono <= maxDimension, le dimensioni originali vengono mantenute.
 */
export function scaleImageSize(size: ImageDimensions, maxDimension: number = 400): ImageDimensions {
  const w = Number.isFinite(size.width) && size.width > 0 ? size.width : maxDimension;
  const h = Number.isFinite(size.height) && size.height > 0 ? size.height : maxDimension;
  const longest = Math.max(w, h);

  if (longest > maxDimension) {
    const factor = maxDimension / longest;
    return {
      width: Math.max(1, Math.round(w * factor)),
      height: Math.max(1, Math.round(h * factor)),
    };
  }

  return {
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h)),
  };
}

/**
 * Funzione pura per aggiungere un nuovo sotto-blocco immagine come figlio attached del genitore.
 * Modifica `parent` in place, preservando tutti i campi esistenti.
 */
export function addImageChild(
  parent: Topic,
  resourceNameOrSrc: string,
  size: ImageDimensions,
  opts?: AddImageTopicOptions
): { newId: string; topic: Topic } {
  const id = newTopicId();
  const scaled = scaleImageSize(size, opts?.maxDimension ?? 400);
  const src = resourceNameOrSrc.startsWith('xap:') ? resourceNameOrSrc : `xap:${resourceNameOrSrc}`;

  const child: Topic = {
    id,
    title: opts?.title ?? '',
    image: {
      src,
      width: scaled.width,
      height: scaled.height,
    },
  };

  if (!parent.children) {
    parent.children = {};
  }
  if (!parent.children.attached) {
    parent.children.attached = [];
  }
  parent.children.attached.push(child);

  return { newId: id, topic: child };
}

/**
 * Funzione pura per impostare o sostituire l'immagine su un topic esistente.
 * Modifica `topic` in place, preservando le altre chiavi di `topic.image`
 * e assicurando che `isMathJaxImage` ed eventuali estensioni MathJax non siano presenti.
 */
export function setTopicImage(
  topic: Topic,
  resourceNameOrSrc: string,
  size: ImageDimensions,
  opts?: { maxDimension?: number }
): void {
  const scaled = scaleImageSize(size, opts?.maxDimension ?? 400);
  const src = resourceNameOrSrc.startsWith('xap:') ? resourceNameOrSrc : `xap:${resourceNameOrSrc}`;

  const existingImage = topic.image && typeof topic.image === 'object' ? topic.image : {};
  const updatedImage: Image = {
    ...existingImage,
    src,
    width: scaled.width,
    height: scaled.height,
  };
  delete updatedImage.isMathJaxImage;
  topic.image = updatedImage;

  // Le immagini ordinarie non usano estensioni MathJax
  if (topic.extensions) {
    topic.extensions = topic.extensions.filter((e) => e.provider !== MATHJAX_PROVIDER);
    if (topic.extensions.length === 0) {
      delete topic.extensions;
    }
  }
}
