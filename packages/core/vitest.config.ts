import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // MathJax si carica su richiesta (import dinamico): i test lo trovano già pronto.
    setupFiles: ['./tests/setup.ts'],
  },
});
