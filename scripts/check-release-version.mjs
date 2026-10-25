// Verifica che il tag di release e le versioni dichiarate nel repository
// coincidano, prima di compilare artefatti con un nome sbagliato.
//
//   node scripts/check-release-version.mjs v26.1.0
//
// Il tag deve essere vYY.MAJOR.MINOR (docs/RELEASE.md), la `version` di tutti i package.json
// del workspace deve essere X.Y.Z e `pkgver` del PKGBUILD di release allineato.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? '';
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
if (!match) {
  console.error(`Tag "${tag}" non valido: atteso vYY.MAJOR.MINOR (es. v26.1.0).`);
  process.exit(1);
}
const expected = match[1];

const manifests = [
  'package.json',
  'packages/core/package.json',
  'packages/ui-kit/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
];
const errors = [];
for (const file of manifests) {
  const { version } = JSON.parse(readFileSync(resolve(root, file), 'utf-8'));
  if (version !== expected) errors.push(`${file}: version ${version}, atteso ${expected}`);
}

try {
  execFileSync('bash', [resolve(root, 'packaging/arch/bump-pkgver.sh'), '--check'], { stdio: 'pipe' });
} catch (err) {
  errors.push(`packaging/arch/release/PKGBUILD disallineato: ${String(err.stderr ?? err.message).trim()}`);
}
// bump-pkgver.sh confronta con apps/desktop: se questa coincide col tag, vale per il tag.

if (errors.length > 0) {
  console.error(`La versione non coincide con il tag ${tag}:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('Allinea le versioni (docs/RELEASE.md) e rifai il tag.');
  process.exit(1);
}
console.log(`OK: tag ${tag} coerente con package.json e PKGBUILD (${expected}).`);
