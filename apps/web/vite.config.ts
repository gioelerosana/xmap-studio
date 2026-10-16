import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Percorsi relativi: in Electron la UI compilata si carica da file://.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@xmap/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@xmap/ui-kit/theme.css': path.resolve(__dirname, '../../packages/ui-kit/src/theme.css'),
      '@xmap/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/src/index.ts'),
      '@resvg/resvg-js': path.resolve(__dirname, './src/shims/resvg.ts'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
});
