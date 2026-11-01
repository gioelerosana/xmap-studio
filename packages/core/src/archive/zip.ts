import type JSZip from 'jszip';

let jszip: Promise<typeof JSZip> | null = null;

/**
 * JSZip con import dinamico: serve solo ad aprire, salvare e validare, non per
 * mostrare l'app. Il chunk si scarica alla prima operazione su un archivio.
 */
export function loadJSZip(): Promise<typeof JSZip> {
  jszip ??= import('jszip').then(
    (m) => m.default,
    (err: unknown) => {
      jszip = null;
      throw err;
    }
  );
  return jszip;
}
