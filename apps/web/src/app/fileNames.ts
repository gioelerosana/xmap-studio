/** Nome provvisorio di una mappa nuova, mai salvata: al primo salvataggio si propone il titolo della radice. */
export const UNTITLED_FILE_NAME = 'senza_titolo.xmind';

export function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\\/]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80) || 'mappa'
  );
}
