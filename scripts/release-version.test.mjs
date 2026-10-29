// node --test scripts/release-version.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeCommits, bumpFromCommits, checkTitle, nextVersion } from './release-version.mjs';

test('il tipo del titolo decide quanto pesa in una release', () => {
  assert.deepEqual(checkTitle('feat(map): nuova barra'), { type: 'feat', bump: 'major' });
  assert.equal(checkTitle('feat: senza ambito').bump, 'major');
  assert.equal(checkTitle('fix(save): backup duplicati').bump, 'minor');
  assert.equal(checkTitle('perf(layout): stima più rapida').bump, 'minor');
  assert.equal(checkTitle('docs(agents): regole dei tag').bump, 'none');
  assert.equal(checkTitle('ci: cache pnpm').bump, 'none');
  assert.equal(checkTitle('fix(core)!: cambia il formato').bump, 'major');
});

test('titoli non validi sono rifiutati', () => {
  assert.throws(() => checkTitle('Aggiunge la barra'), /Conventional Commits/);
  assert.throws(() => checkTitle('feat:senza spazio'), /Conventional Commits/);
  assert.throws(() => checkTitle('feature(map): x'), /non ammesso/);
});

test('almeno un feat tra i commit → major', () => {
  assert.equal(bumpFromCommits(['fix(save): a', 'feat(map): b', 'docs: c']), 'major');
});

test('solo correzioni e simili → minor', () => {
  assert.equal(bumpFromCommits(['fix(save): a', 'docs: c']), 'minor');
  assert.equal(bumpFromCommits(['refactor(core): a']), 'minor');
  assert.equal(bumpFromCommits(['perf: a', 'ci: b']), 'minor');
});

test('solo docs/ci/chore/test o nessun commit → none', () => {
  assert.equal(bumpFromCommits(['docs(agents): a', 'ci: b', 'chore(deps): c', 'test(core): d']), 'none');
  assert.equal(bumpFromCommits([]), 'none');
});

test('un tipo con «!» → major', () => {
  assert.equal(bumpFromCommits(['fix(core)!: cambia il formato']), 'major');
  assert.equal(bumpFromCommits(['docs!: x', 'fix: y']), 'major');
});

test('merge commit e chore(release) sono ignorati', () => {
  const subjects = [
    'Merge pull request #7 from gioelerosana/feat/x',
    "Merge branch 'main' into feat/y",
    'chore(release): v26.2.1',
    'docs: guida',
  ];
  const result = analyzeCommits(subjects);
  assert.equal(result.bump, 'none');
  assert.deepEqual(result.included, ['docs: guida']);
  assert.equal(result.ignored.length, 3);
  assert.deepEqual(result.nonConforming, []);
});

test('un chore(release) con «!» o un merge che cita feat non pesano', () => {
  assert.equal(bumpFromCommits(['chore(release)!: v27', 'Merge pull request #1 from a/feat: x']), 'none');
});

test('subject non conformi sono ignorati e restituiti', () => {
  const result = analyzeCommits(['Aggiunge la barra', 'feature(map): x', 'fix(save): a', '']);
  assert.equal(result.bump, 'minor');
  assert.deepEqual(result.included, ['fix(save): a']);
  assert.deepEqual(result.nonConforming, ['Aggiunge la barra', 'feature(map): x']);
});

test('un subject da squash merge con (#NN) conta', () => {
  assert.equal(bumpFromCommits(['feat(editor): barra flottante (#12)']), 'major');
});

test('versione successiva nello stesso anno', () => {
  const date = new Date('2026-10-25T12:00:00Z');
  const tags = ['v0.0.1', 'v0.0.2', 'v26.1.0', 'v26.2.0', 'v26.2.1', 'v26.10.0'];
  assert.equal(nextVersion(tags, 'major', date), '26.11.0');
  assert.equal(nextVersion(tags, 'minor', date), '26.10.1');
  assert.equal(nextVersion(['v26.3.4'], 'minor', date), '26.3.5');
});

test("la prima release dell'anno è YY.1.0", () => {
  const tags = ['v0.0.1', 'v0.0.2', 'v26.4.2'];
  assert.equal(nextVersion(tags, 'major', new Date('2026-01-01T00:00:00Z')), '26.5.0');
  assert.equal(nextVersion(tags, 'minor', new Date('2027-01-02T00:00:00Z')), '27.1.0');
  assert.equal(nextVersion(['v0.0.2'], 'major', new Date('2026-10-25T00:00:00Z')), '26.1.0');
  assert.equal(nextVersion([], 'minor', new Date('2026-10-25T00:00:00Z')), '26.1.0');
});

test('bump none non produce una versione', () => {
  assert.throws(() => nextVersion([], 'none'), /non valido/);
});
