import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKER, buildComment, classifyProbe, parsePreviewUrls, probeUrl } from './preview-url.mjs';

// Riepilogo vero di un check run di Workers Builds su un PR.
const SUMMARY = `
Build ID: [7f0ac025-2f62-4315-ba7d-4e0d42ce20ef](https://dash.cloudflare.com/dd78de33/workers/services/view/xmap-studio/production/builds/7f0ac025)
Script: [xmap-studio](https://dash.cloudflare.com/dd78de33/workers/services/view/xmap-studio/production)
Version ID: c27eb1d9-17de-4a2c-a955-93b6eb281306
Preview URL: https://c27eb1d9-xmap-studio.gioelegr3.workers.dev
Preview Alias URL: https://feat-xmap-15-theme-editor-xmap-studio.gioelegr3.workers.dev
`;

const ALIAS = 'https://feat-xmap-15-theme-editor-xmap-studio.gioelegr3.workers.dev';
const VERSION = 'https://c27eb1d9-xmap-studio.gioelegr3.workers.dev';

test('legge l\'URL della versione e quello del branch dal riepilogo', () => {
  assert.deepEqual(parsePreviewUrls(SUMMARY), { versionUrl: VERSION, aliasUrl: ALIAS });
});

test('senza URL di anteprima restituisce null', () => {
  assert.deepEqual(parsePreviewUrls('Build failed: command exited with code 1'), {
    versionUrl: null,
    aliasUrl: null,
  });
});

test('regge un riepilogo vuoto o assente', () => {
  assert.deepEqual(parsePreviewUrls(undefined), { versionUrl: null, aliasUrl: null });
});

test('classifica il 200 come raggiungibile', () => {
  assert.deepEqual(classifyProbe({ status: 200, location: null }), { state: 'ok' });
});

test('classifica il redirect di Cloudflare Access', () => {
  const probe = classifyProbe({
    status: 302,
    location: 'https://joelshepinc.cloudflareaccess.com/cdn-cgi/access/login/x?kid=1',
  });
  assert.equal(probe.state, 'access');
});

test('classifica come redirect un 302 che non è Access', () => {
  assert.equal(classifyProbe({ status: 301, location: 'https://xmap.jshep.xyz/' }).state, 'redirect');
});

test('classifica gli altri stati come errore', () => {
  assert.equal(classifyProbe({ status: 404, location: null }).state, 'error');
  assert.equal(classifyProbe({ status: 0, location: null }).state, 'error');
});

test('probeUrl non segue i redirect', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, redirect: init.redirect });
    return new Response(null, {
      status: 302,
      headers: { location: 'https://joelshepinc.cloudflareaccess.com/cdn-cgi/access/login/x' },
    });
  };
  const probe = await probeUrl(ALIAS, fakeFetch);
  assert.equal(probe.state, 'access');
  assert.equal(seen[0].url, `${ALIAS}/`);
  assert.equal(seen[0].redirect, 'manual');
});

test('probeUrl riporta gli errori di rete invece di lanciare', async () => {
  const probe = await probeUrl(ALIAS, async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  });
  assert.equal(probe.state, 'error');
  assert.match(probe.detail, /ENOTFOUND/);
});

test('il commento contiene marcatore, URL e stato', () => {
  const body = buildComment({
    urls: { versionUrl: VERSION, aliasUrl: ALIAS },
    probes: { versionUrl: { state: 'ok' }, aliasUrl: { state: 'ok' } },
    conclusion: 'success',
    sha: '69a5c34472890580a5c256ab563814a610358e2d',
    buildUrl: 'https://dash.cloudflare.com/build',
  });
  assert.ok(body.startsWith(MARKER));
  assert.ok(body.includes(ALIAS));
  assert.ok(body.includes(VERSION));
  assert.ok(body.includes('`69a5c34`'));
  assert.ok(body.includes('https://dash.cloudflare.com/build'));
  assert.equal(body.match(/✅ risponde/g)?.length, 2);
  // Anteprima raggiungibile: nessun avviso su Cloudflare Access.
  assert.ok(!body.includes('Cloudflare Access blocca'));
});

test('anteprima dietro Access: il commento dice come toglierlo', () => {
  const body = buildComment({
    urls: { versionUrl: VERSION, aliasUrl: ALIAS },
    probes: { versionUrl: { state: 'access' }, aliasUrl: { state: 'ok' } },
    conclusion: 'success',
    sha: '69a5c34',
    buildUrl: 'https://dash.cloudflare.com/build',
  });
  assert.ok(body.includes('dietro Cloudflare Access'));
  assert.ok(body.includes('Protect all Workers'));
  assert.ok(body.includes('docs/DEPLOY.md'));
});

test('build fallita: nessuna tabella, rimando ai log', () => {
  const body = buildComment({
    urls: { versionUrl: null, aliasUrl: null },
    conclusion: 'failure',
    sha: '8c6f6e8',
    buildUrl: 'https://dash.cloudflare.com/build',
  });
  assert.ok(body.includes('Build fallita'));
  assert.ok(body.includes('https://dash.cloudflare.com/build'));
  assert.ok(!body.includes('| URL |'));
});

test('build riuscita senza URL: spiega cosa controllare', () => {
  const body = buildComment({ urls: { versionUrl: null, aliasUrl: null }, conclusion: 'success', sha: '8c6f6e8' });
  assert.ok(body.includes('nessun URL di anteprima'));
  assert.ok(body.includes('preview_urls'));
});
