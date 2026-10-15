import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../src');
const NODE_DIR = path.join(SRC, 'node');
// Import statici, dinamici e require di moduli `node:`.
const NODE_IMPORT = /['"]node:[a-z_/]+['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (full === NODE_DIR) return [];
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('indipendenza dalla piattaforma', () => {
  it('nessun file di core/src fuori da src/node importa moduli node:', () => {
    const offenders = sourceFiles(SRC).filter((file) => NODE_IMPORT.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
