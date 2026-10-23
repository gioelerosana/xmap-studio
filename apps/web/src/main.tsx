/// <reference types="vite/client" />
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installTextMeasurer } from './textMeasure';
import './index.css';

installTextMeasurer();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA: solo nella build web servita via http(s); in sviluppo (HMR), in Electron e nell'app Android
// (risorse già nell'APK) no.
if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator &&
  location.protocol.startsWith('http') &&
  !window.electronAPI &&
  !window.xmapAndroid
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('Service worker non registrato:', err);
    });
  });
}
