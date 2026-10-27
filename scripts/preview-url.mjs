// Anteprima della PR pubblicata da Cloudflare Workers Builds.
//
// Workers Builds scrive l'URL dell'anteprima nel riepilogo del proprio check
// run, ma il commento che il bot Cloudflare lascia nel PR mostra «No Preview
// URL»: dal PR non c'è nessun link alle modifiche live. Questo script legge il
// riepilogo del check run e compone il commento che
// .github/workflows/preview.yml tiene aggiornato, provando prima gli URL: così
// si vede subito se l'anteprima risponde o se è dietro Cloudflare Access.
//
//   node scripts/preview-url.mjs parse --summary-file riepilogo.md
//       stampa {"versionUrl":…,"aliasUrl":…}
//   node scripts/preview-url.mjs comment --summary-file riepilogo.md \
//        --conclusion success --sha 69a5c34 --build-url https://dash.cloudflare.com/…
//       stampa il corpo del commento (Markdown)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- xmap-preview-urls -->';

const PROBE_TIMEOUT_MS = 20_000;

// Due URL per build: quello della versione (un solo commit) e l'alias del
// branch, che Workers Builds aggiorna a ogni push sullo stesso ramo. Il secondo
// è il più comodo: resta uguale per tutta la vita del PR.
const URL_PATTERNS = [
  ['versionUrl', /Preview URL:\s*(?:\[[^\]]*\]\()?(https?:\/\/[^\s)\]]+)/i],
  ['aliasUrl', /Preview Alias URL:\s*(?:\[[^\]]*\]\()?(https?:\/\/[^\s)\]]+)/i],
];

export function parsePreviewUrls(summary) {
  const text = typeof summary === 'string' ? summary : '';
  const urls = { versionUrl: null, aliasUrl: null };
  for (const [key, pattern] of URL_PATTERNS) {
    const match = pattern.exec(text);
    if (match) urls[key] = match[1];
  }
  return urls;
}

// Classifica la risposta senza seguire i redirect: quello di Cloudflare Access
// porta alla pagina di login, non all'app.
export function classifyProbe({ status, location }) {
  if (status === 200) return { state: 'ok' };
  if (status >= 300 && status < 400) {
    if (typeof location === 'string' && location.includes('cloudflareaccess.com')) {
      return { state: 'access', location };
    }
    return { state: 'redirect', location: location ?? '' };
  }
  return { state: 'error' };
}

export async function probeUrl(url, fetchImpl = fetch) {
  const target = url.endsWith('/') ? url : `${url}/`;
  try {
    const response = await fetchImpl(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { url, ...classifyProbe({ status: response.status, location: response.headers.get('location') }) };
  } catch (error) {
    return { url, state: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
}

const STATE_LABELS = {
  ok: '✅ risponde',
  access: '⚠️ dietro Cloudflare Access',
  redirect: '↪️ reindirizza altrove',
  error: '❌ non raggiungibile',
};

const ACCESS_NOTE = [
  '> **Cloudflare Access blocca l\'anteprima.** L\'URL risponde con un redirect a',
  '> `cloudflareaccess.com`, quindi nel browser si apre la pagina di login e non',
  '> l\'app. L\'account protegge le anteprime di tutti i Worker (*Workers & Pages* →',
  '> **Protect all Workers** → *Previews only*): si toglie da lì, oppure rendendo',
  '> pubblico questo Worker (scheda *Access*). Dettagli in `docs/DEPLOY.md`',
  '> §«Anteprime delle PR».',
];

export function buildComment({ urls, probes = {}, conclusion = 'success', sha = '', buildUrl = '' }) {
  const shortSha = sha.slice(0, 7);
  const lines = [MARKER, `### Anteprima Cloudflare · \`${shortSha}\``, ''];

  if (conclusion === 'success') {
    lines.push(buildUrl ? `✅ Build riuscita · [log della build](${buildUrl})` : '✅ Build riuscita', '');
    const rows = [
      ['aliasUrl', "l'ultimo commit del branch"],
      ['versionUrl', `il commit \`${shortSha}\``],
    ].filter(([key]) => urls[key]);

    if (rows.length === 0) {
      lines.push(
        'La build è riuscita ma non ha prodotto nessun URL di anteprima:',
        'controlla che le Preview URL siano attive per il Worker',
        '(`preview_urls` in `wrangler.jsonc`, `docs/DEPLOY.md`).',
        ''
      );
    } else {
      lines.push('| URL | Cosa mostra | Stato |', '| --- | --- | --- |');
      for (const [key, what] of rows) {
        lines.push(`| ${urls[key]} | ${what} | ${STATE_LABELS[probes[key]?.state] ?? '—'} |`);
      }
      lines.push('');
      if (rows.some(([key]) => probes[key]?.state === 'access')) lines.push(...ACCESS_NOTE, '');
    }
  } else if (conclusion === 'timed_out') {
    lines.push('⌛ **Build scaduta**: per questo commit non c\'è un\'anteprima.', '');
    if (buildUrl) lines.push(`Motivo nei [log della build](${buildUrl}).`, '');
  } else {
    lines.push('❌ **Build fallita**: per questo commit non c\'è un\'anteprima.', '');
    if (buildUrl) lines.push(`Motivo nei [log della build](${buildUrl}).`, '');
  }

  lines.push(
    '<sub>Lo scrive il workflow `Anteprima PR` a ogni build: il commento del bot',
    'Cloudflare non riporta l\'URL dell\'anteprima.</sub>'
  );
  return lines.join('\n');
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const command = process.argv[2];
  const summaryFile = option('summary-file');

  if (command === 'parse') {
    const summary = summaryFile ? readFileSync(summaryFile, 'utf8') : '';
    console.log(JSON.stringify(parsePreviewUrls(summary)));
    return;
  }

  if (command === 'comment') {
    const urls = parsePreviewUrls(summaryFile ? readFileSync(summaryFile, 'utf8') : '');
    const probes = {};
    for (const key of ['aliasUrl', 'versionUrl']) {
      if (urls[key]) probes[key] = await probeUrl(urls[key]);
    }
    console.log(
      buildComment({
        urls,
        probes,
        conclusion: option('conclusion') ?? 'success',
        sha: option('sha') ?? '',
        buildUrl: option('build-url') ?? '',
      })
    );
    return;
  }

  console.error('Uso: node scripts/preview-url.mjs parse|comment --summary-file FILE [--conclusion …] [--sha …] [--build-url …]');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
