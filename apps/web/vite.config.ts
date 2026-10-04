import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@resvg/resvg-js': path.resolve(__dirname, './src/shims/resvg.ts'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
});
