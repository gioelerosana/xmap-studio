import JSZip from 'jszip';
import { collectResourceRefs } from '../model/utils.js';

export interface ValidationReport {
  entries: number;
  resources: number;
  resourceRefs: number;
}

const ZIP_RESOURCE_DIR = 'resources/';

/**
 * Valida i byte dell'archivio PRIMA di toccare il disco:
 * 1. Lo ZIP si riapre ed ogni entry è leggibile.
 * 2. content.json è un array JSON; manifest.json e metadata.json (se presente) sono JSON validi.
 * 3. Ogni riferimento xap:resources/X ha il corrispondente file resources/X nello ZIP.
 * 4. Ogni resources/X presente nello ZIP è registrato nel manifest.
 * 5. content.json e metadata.json sono registrati nel manifest.
 */
export async function validateArchiveBytes(bytes: Uint8Array): Promise<ValidationReport> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new Error(`Lo ZIP prodotto non si riapre: ${err}`);
  }

  const names = new Set<string>();
  const contents = new Map<string, string>();

  const readPromises: Promise<void>[] = [];

  zip.forEach((path, file) => {
    if (file.dir) return;
    names.add(path);
    if (['content.json', 'manifest.json', 'metadata.json'].includes(path)) {
      readPromises.push(
        file.async('string').then((text) => {
          contents.set(path, text);
        })
      );
    }
  });

  await Promise.all(readPromises);

  const contentStr = contents.get('content.json');
  if (!contentStr) {
    throw new Error('content.json assente nell\'output');
  }

  let contentObj: unknown;
  try {
    contentObj = JSON.parse(contentStr);
  } catch (err) {
    throw new Error(`content.json non è JSON valido: ${err}`);
  }

  if (!Array.isArray(contentObj)) {
    throw new Error('content.json non è un array di sheet');
  }

  const manifestStr = contents.get('manifest.json');
  if (!manifestStr) {
    throw new Error('manifest.json assente nell\'output');
  }

  let manifestObj: any;
  try {
    manifestObj = JSON.parse(manifestStr);
  } catch (err) {
    throw new Error(`manifest.json non è JSON valido: ${err}`);
  }

  const metadataStr = contents.get('metadata.json');
  if (metadataStr) {
    try {
      JSON.parse(metadataStr);
    } catch (err) {
      throw new Error(`metadata.json non è JSON valido: ${err}`);
    }
  }

  const fileEntries =
    manifestObj && typeof manifestObj === 'object' && manifestObj['file-entries']
      ? manifestObj['file-entries']
      : {};

  // Verifica riferimenti a risorse
  const refs = new Set<string>();
  collectResourceRefs(contentObj, refs);

  for (const r of refs) {
    const path = `${ZIP_RESOURCE_DIR}${r}`;
    if (!names.has(path)) {
      throw new Error(`Riferimento ${path} senza risorsa nello ZIP`);
    }
    if (!(path in fileEntries)) {
      throw new Error(`Riferimento ${path} non registrato nel manifest`);
    }
  }

  // Verifica che ogni risorsa nello zip sia registrata nel manifest
  let resourceCount = 0;
  for (const name of names) {
    if (name.startsWith('resources/') && !name.endsWith('/')) {
      resourceCount++;
      if (!(name in fileEntries)) {
        throw new Error(`Risorsa ${name} presente nello ZIP ma assente dal manifest`);
      }
    }
  }

  for (const required of ['content.json', 'metadata.json']) {
    if (contents.has(required) && !(required in fileEntries)) {
      throw new Error(`${required} non registrato nel manifest`);
    }
  }

  return {
    entries: names.size,
    resources: resourceCount,
    resourceRefs: refs.size,
  };
}
