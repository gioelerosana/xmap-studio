/** Testi della pagina "Informazioni", condivisi tra menu e impostazioni. */
export const APP_NAME = 'XMap Studio';
export const APP_DESCRIPTION =
  'Editor per mappe XMind con equazioni LaTeX native. Lossless, offline, scrittura atomica e validata.';
/** Iniettata da Vite (`define` in vite.config.ts) dalla `version` di package.json. */
declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;
export const APP_VERSION_LABEL = `Versione ${APP_VERSION}`;
