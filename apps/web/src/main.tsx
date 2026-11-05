/// <reference types="vite/client" />
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installTextMeasurer } from './textMeasure';
import { preloadMathJax } from './mathReady';
import { installIncomingFiles } from './app/incomingFiles';
import './index.css';

installTextMeasurer();
installIncomingFiles();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

preloadMathJax();

// PWA: solo nella build web servita via http(s); in sviluppo (HMR) e in Electron no.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http') && !window.electronAPI) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('Service worker non registrato:', err);
    });
  });
}
