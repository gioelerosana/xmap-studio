// Versioni di release nel formato vYY.MAJOR.MINOR (docs/RELEASE.md §Versioning).
//
//   node scripts/release-version.mjs bump --title "feat(map): …" [--labels "a,b"]
//       stampa major | minor | none: il tipo di release che il PR produce
//   node scripts/release-version.mjs next --bump major|minor [--date 2026-10-25T…]
//       stampa la versione successiva (senza «v») a partire dai tag git esistenti
//   node scripts/release-version.mjs set 26.1.0
//       scrive la versione in tutti i package.json e nel PKGBUILD di release
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MANIFESTS = [
  'package.json',
  'packages/core/package.json',
  'packages/ui-kit/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
];

// Tipo Conventional Commits del titolo del PR → release prodotta al merge.
const BUMP_BY_TYPE = {
  feat: 'major',
  fix: 'minor',
  perf: 'minor',
  refactor: 'minor',
  style: 'minor',
  revert: 'minor',
  build: 'minor',
  docs: 'none',
  ci: 'none',
  chore: 'none',
  test: 'none',
};

const LABEL_PREFIX = 'release:';
const BUMPS = ['major', 'minor', 'none'];
const TITLE_RE = /^([a-z]+)(\([^)]+\))?(!)?: \S/;
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Release prodotta da un PR: l'etichetta `release:*` vince sul titolo. */
export function bumpFromPr(title, labels = []) {
  const forced = labels.filter((l) => l.startsWith(LABEL_PREFIX)).map((l) => l.slice(LABEL_PREFIX.length));
  if (forced.length > 1) throw new Error(`Più etichette di release sul PR: ${forced.join(', ')}. Lasciane una.`);
  if (forced.length === 1) {
    if (!BUMPS.includes(forced[0])) throw new Error(`Etichetta "${LABEL_PREFIX}${forced[0]}" sconosciuta: usa ${BUMPS.map((b) => LABEL_PREFIX + b).join(', ')}.`);
    return forced[0];
  }
  const match = TITLE_RE.exec(title);
  if (!match) {
    throw new Error(`Titolo "${title}" non in formato Conventional Commits: atteso "tipo(ambito): descrizione", es. "feat(map): …".`);
  }
  const [, type, , breaking] = match;
  const bump = BUMP_BY_TYPE[type];
  if (!bump) throw new Error(`Tipo "${type}" non ammesso nel titolo: usa ${Object.keys(BUMP_BY_TYPE).join(', ')}.`);
  return breaking ? 'major' : bump;
}

/** Versione successiva: YY dall'anno della data, contatori dai tag dello stesso anno. */
export function nextVersion(tags, bump, date = new Date()) {
  if (bump !== 'major' && bump !== 'minor') throw new Error(`Bump "${bump}" non valido: atteso major o minor.`);
  const yy = date.getUTCFullYear() % 100;
  let latest = null;
  for (const tag of tags) {
    const m = TAG_RE.exec(tag.trim());
    if (!m || Number(m[1]) !== yy) continue;
    const v = [Number(m[2]), Number(m[3])];
    if (!latest || v[0] > latest[0] || (v[0] === latest[0] && v[1] > latest[1])) latest = v;
  }
  // La prima release dell'anno è sempre YY.1.0, qualunque sia il tipo.
  if (!latest) return `${yy}.1.0`;
  return bump === 'major' ? `${yy}.${latest[0] + 1}.0` : `${yy}.${latest[0]}.${latest[1] + 1}`;
}

function setVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versione "${version}" non valida: attesa YY.MAJOR.MINOR senza «v».`);
  for (const file of MANIFESTS) {
    const path = resolve(root, file);
    const text = readFileSync(path, 'utf-8');
    // Sostituzione testuale: il resto del file (ordine, formattazione) resta com'è.
    const updated = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
    if (updated === text && !text.includes(`"version": "${version}"`)) throw new Error(`${file}: campo "version" non trovato.`);
    writeFileSync(path, updated);
  }
  execFileSync('bash', [resolve(root, 'packaging/arch/bump-pkgver.sh'), version], { stdio: 'inherit' });
}

function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args) {
  const [command, ...rest] = args;
  switch (command) {
    case 'bump': {
      const labels = (option(rest, 'labels') ?? '').split(',').map((l) => l.trim()).filter(Boolean);
      return bumpFromPr(option(rest, 'title') ?? '', labels);
    }
    case 'next': {
      const raw = option(rest, 'date');
      const date = raw ? new Date(raw) : new Date();
      if (Number.isNaN(date.getTime())) throw new Error(`Data "${raw}" non valida.`);
      const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf-8' }).split('\n');
      return nextVersion(tags, option(rest, 'bump'), date);
    }
    case 'set':
      setVersion(rest[0] ?? '');
      return `Versione impostata: ${rest[0]}`;
    default:
      throw new Error('Uso: release-version.mjs bump|next|set (vedi l\'intestazione del file).');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
