import { CODE_VALIDATION, XmapError } from '../errors.js';
import JSZip from 'jszip';
import { collectAttachmentRefs, collectResourceRefs } from '../model/utils.js';

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
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch (err) {
    throw new XmapError(CODE_VALIDATION, `Lo ZIP prodotto non si riapre: ${err}`);
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
    throw new XmapError(CODE_VALIDATION, 'content.json assente nell\'output');
  }

  let contentObj: unknown;
  try {
    contentObj = JSON.parse(contentStr);
  } catch (err) {
    throw new XmapError(CODE_VALIDATION, `content.json non è JSON valido: ${err}`);
  }

  if (!Array.isArray(contentObj)) {
    throw new XmapError(CODE_VALIDATION, 'content.json non è un array di sheet');
  }

  const manifestStr = contents.get('manifest.json');
  if (!manifestStr) {
    throw new XmapError(CODE_VALIDATION, 'manifest.json assente nell\'output');
  }

  let manifestObj: any;
  try {
    manifestObj = JSON.parse(manifestStr);
  } catch (err) {
    throw new XmapError(CODE_VALIDATION, `manifest.json non è JSON valido: ${err}`);
  }

  const metadataStr = contents.get('metadata.json');
  if (metadataStr) {
    try {
      JSON.parse(metadataStr);
    } catch (err) {
      throw new XmapError(CODE_VALIDATION, `metadata.json non è JSON valido: ${err}`);
    }
  }

  const candidateEntries =
    manifestObj && typeof manifestObj === 'object' ? manifestObj['file-entries'] : undefined;
  const fileEntries =
    candidateEntries && typeof candidateEntries === 'object' && !Array.isArray(candidateEntries)
      ? (candidateEntries as Record<string, unknown>)
      : {};

  // Verifica riferimenti a risorse
  const refs = new Set<string>();
  collectResourceRefs(contentObj, refs);

  for (const r of refs) {
    const path = `${ZIP_RESOURCE_DIR}${r}`;
    if (!names.has(path)) {
      throw new XmapError(CODE_VALIDATION, `Riferimento ${path} senza risorsa nello ZIP`);
    }
    if (!(path in fileEntries)) {
      throw new XmapError(CODE_VALIDATION, `Riferimento ${path} non registrato nel manifest`);
    }
  }

  const attachments = new Set<string>();
  collectAttachmentRefs(contentObj, attachments);
  for (const attachment of attachments) {
    if (!names.has(attachment)) {
      throw new XmapError(CODE_VALIDATION, `Riferimento ${attachment} senza allegato nello ZIP`);
    }
    if (!(attachment in fileEntries)) {
      throw new XmapError(CODE_VALIDATION, `Riferimento ${attachment} non registrato nel manifest`);
    }
  }

  // Verifica che ogni risorsa nello zip sia registrata nel manifest
  let resourceCount = 0;
  for (const name of names) {
    if (name.startsWith('resources/') && !name.endsWith('/')) {
      resourceCount++;
      if (!(name in fileEntries)) {
        throw new XmapError(CODE_VALIDATION, `Risorsa ${name} presente nello ZIP ma assente dal manifest`);
      }
    }
    if (name.startsWith('attachments/') && !name.endsWith('/') && !(name in fileEntries)) {
      throw new XmapError(CODE_VALIDATION, `Allegato ${name} presente nello ZIP ma assente dal manifest`);
    }
  }

  for (const required of ['content.json', 'metadata.json']) {
    if (contents.has(required) && !(required in fileEntries)) {
      throw new XmapError(CODE_VALIDATION, `${required} non registrato nel manifest`);
    }
  }

  return {
    entries: names.size,
    resources: resourceCount,
    resourceRefs: refs.size,
  };
}
