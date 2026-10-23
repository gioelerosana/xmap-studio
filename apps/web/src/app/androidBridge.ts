// Ponte dell'app Android (apps/android, MainActivity.Bridge): presente solo nel WebView nativo.
declare global {
  interface Window {
    xmapAndroid?: {
      /** Apre il selettore «Salva» di Android e scrive i byte (in base64). */
      saveFile: (base64: string, name: string, mimeType: string) => void;
    };
  }
}

export {};
