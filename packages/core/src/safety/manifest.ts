export interface Manifest {
  'file-entries': Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Aggiorna il manifest: registra tutte le risorse, garantisce content.json e metadata.json,
 * ed elimina la thumbnail obsoleta se richiesto.
 */
export function refreshManifest(
  manifest: Record<string, unknown>,
  resourceNames: Iterable<string>,
  dropThumbnail: boolean = true
): Manifest {
  if (!manifest || typeof manifest !== 'object') {
    manifest = {};
  }
  if (
    !manifest['file-entries'] ||
    typeof manifest['file-entries'] !== 'object' ||
    Array.isArray(manifest['file-entries'])
  ) {
    manifest['file-entries'] = {};
  }
  const fileEntries = manifest['file-entries'] as Record<string, Record<string, unknown>>;

  fileEntries['content.json'] = fileEntries['content.json'] || {};
  fileEntries['metadata.json'] = fileEntries['metadata.json'] || {};

  if (dropThumbnail) {
    delete fileEntries['Thumbnails/thumbnail.png'];
  }

  for (const name of resourceNames) {
    fileEntries[name] = fileEntries[name] || {};
  }

  return manifest as Manifest;
}

/**
 * Registra nel manifest entry generiche (come attachments/...).
 */
export function registerEntries(
  manifest: Record<string, unknown>,
  names: Iterable<string>
): Manifest {
  if (!manifest || typeof manifest !== 'object') {
    manifest = {};
  }
  if (
    !manifest['file-entries'] ||
    typeof manifest['file-entries'] !== 'object' ||
    Array.isArray(manifest['file-entries'])
  ) {
    manifest['file-entries'] = {};
  }
  const fileEntries = manifest['file-entries'] as Record<string, Record<string, unknown>>;

  for (const name of names) {
    fileEntries[name] = fileEntries[name] || {};
  }

  return manifest as Manifest;
}
