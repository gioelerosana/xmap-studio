// node --test scripts/release-version.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bumpFromPr, nextVersion } from './release-version.mjs';

test('il tipo del titolo decide la release', () => {
  assert.equal(bumpFromPr('feat(map): nuova barra'), 'major');
  assert.equal(bumpFromPr('feat: senza ambito'), 'major');
  assert.equal(bumpFromPr('fix(save): backup duplicati'), 'minor');
  assert.equal(bumpFromPr('perf(layout): stima più rapida'), 'minor');
  assert.equal(bumpFromPr('docs(agents): regole dei tag'), 'none');
  assert.equal(bumpFromPr('ci: cache pnpm'), 'none');
  assert.equal(bumpFromPr('fix(core)!: cambia il formato'), 'major');
});

test("l'etichetta release:* vince sul titolo", () => {
  assert.equal(bumpFromPr('docs: guida', ['release:minor']), 'minor');
  assert.equal(bumpFromPr('feat: x', ['bug', 'release:none']), 'none');
  assert.throws(() => bumpFromPr('feat: x', ['release:major', 'release:minor']), /Più etichette/);
  assert.throws(() => bumpFromPr('feat: x', ['release:patch']), /sconosciuta/);
});

test('titoli non validi sono rifiutati', () => {
  assert.throws(() => bumpFromPr('Aggiunge la barra'), /Conventional Commits/);
  assert.throws(() => bumpFromPr('feat:senza spazio'), /Conventional Commits/);
  assert.throws(() => bumpFromPr('feature(map): x'), /non ammesso/);
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
