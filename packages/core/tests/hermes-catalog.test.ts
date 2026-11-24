import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentCatalog } from '../src/agent/link.js';

// La copia del catalogo nel plugin di Hermes deve restare uguale agli strumenti
// del core: se cambia uno strumento, rigenerala con `node scripts/hermes-catalog.mjs`.
describe('catalogo del plugin di Hermes', () => {
  it('è aggiornato rispetto agli strumenti del core', () => {
    const file = new URL('../../../integrations/hermes/xmap-studio/catalog.json', import.meta.url);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(agentCatalog())));
  });
});
