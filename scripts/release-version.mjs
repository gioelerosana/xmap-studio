// Versioni di release nel formato vYY.MAJOR.MINOR (docs/RELEASE.md §Versioning).
//
//   node scripts/release-version.mjs check-title --title "feat(map): …"
//       verifica il titolo di un PR (Conventional Commits) e stampa
//       «tipo → major | minor | none»: come conterebbe in una release
//   node scripts/release-version.mjs commits
//       analizza i commit dall'ultimo tag v* a HEAD e stampa un JSON con
//       {lastTag, bump, included, ignored, nonConforming}
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

// Tipo Conventional Commits → peso nella prossima release (major, minor, nessuna).
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

const TITLE_RE = /^([a-z]+)(\([^)]+\))?(!)?: \S/;
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const MERGE_RE = /^Merge (pull request|branch|remote-tracking branch|tag) /;
const RELEASE_COMMIT_RE = /^chore\(release\)!?: /;
const BUMP_RANK = { none: 0, minor: 1, major: 2 };

/** Controlla un titolo (o subject) in Conventional Commits e dice quanto pesa in una release. */
export function checkTitle(title) {
  const match = TITLE_RE.exec(title);
  if (!match) {
    throw new Error(`Titolo "${title}" non in formato Conventional Commits: atteso "tipo(ambito): descrizione", es. "feat(map): …".`);
  }
  const [, type, , breaking] = match;
  const bump = BUMP_BY_TYPE[type];
  if (!bump) throw new Error(`Tipo "${type}" non ammesso nel titolo: usa ${Object.keys(BUMP_BY_TYPE).join(', ')}.`);
  return { type, bump: breaking ? 'major' : bump };
}

/**
 * Classifica i subject dei commit su main dall'ultimo tag. I merge commit e i
 * `chore(release): …` non contano; i subject non conformi a Conventional
 * Commits sono ignorati ma restituiti, perché il chiamante li segnali.
 */
export function analyzeCommits(subjects) {
  const included = [];
  const ignored = [];
  const nonConforming = [];
  let bump = 'none';
  for (const raw of subjects) {
    const subject = raw.trim();
    if (!subject) continue;
    if (MERGE_RE.test(subject) || RELEASE_COMMIT_RE.test(subject)) {
      ignored.push(subject);
      continue;
    }
    let result;
    try {
      result = checkTitle(subject);
    } catch {
      nonConforming.push(subject);
      continue;
    }
    included.push(subject);
    if (BUMP_RANK[result.bump] > BUMP_RANK[bump]) bump = result.bump;
  }
  return { bump, included, ignored, nonConforming };
}

/** Release che i commit giustificano: major | minor | none. */
export function bumpFromCommits(subjects) {
  return analyzeCommits(subjects).bump;
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
    case 'check-title': {
      const { type, bump } = checkTitle(option(rest, 'title') ?? '');
      return `${type} → ${bump}`;
    }
    case 'commits': {
      // Ultimo tag di versione raggiungibile da HEAD; senza tag, tutta la storia.
      let lastTag = null;
      try {
        lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD'], {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // nessun tag: si analizza tutto
      }
      const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
      const log = execFileSync('git', ['log', '--format=%s', range], { cwd: root, encoding: 'utf-8' });
      return JSON.stringify({ lastTag, ...analyzeCommits(log.split('\n')) });
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
      throw new Error('Uso: release-version.mjs check-title|commits|next|set (vedi l\'intestazione del file).');
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
