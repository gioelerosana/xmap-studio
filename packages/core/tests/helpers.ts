import JSZip from 'jszip';

/** .xmind minimo in memoria; `sheets` sostituisce il contenuto di content.json. */
export async function minimalXmind(sheets?: unknown[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'content.json',
    JSON.stringify(
      sheets ?? [
        {
          id: 's1',
          class: 'sheet',
          title: 'Foglio',
          rootTopic: {
            id: 'r',
            class: 'topic',
            title: 'Radice',
            children: { attached: [{ id: 'a', title: 'A' }] },
          },
        },
      ],
    ),
  );
  zip.file(
    'manifest.json',
    JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }),
  );
  zip.file('metadata.json', '{}');
  return zip.generateAsync({ type: 'uint8array' });
}
