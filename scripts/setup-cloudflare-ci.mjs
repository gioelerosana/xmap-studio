import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const binDir = path.join(rootDir, 'node_modules', '.bin');

// In Cloudflare Workers Builds, non-production branch builds inject an ephemeral
// WRANGLER_CI_MATCH_TAG that does not match the Worker script tag, causing wrangler's
// verifyWorkerMatchesCITag check to reject deployments with a misleading error:
// "The name in your wrangler.jsonc file (xmap-studio) must match the name of your Worker"
// (see cloudflare/workers-sdk#15682).
//
// Placing a one-shot proxy at node_modules/.bin/wrangler intercepts the deploy command
// (e.g. `npx wrangler versions upload`), unsets WRANGLER_CI_MATCH_TAG, removes itself,
// and invokes wrangler cleanly.
if (process.env.WORKERS_CI || process.env.CI) {
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const shimPath = path.join(binDir, 'wrangler');
    const shimContent = '#!/bin/sh\nunset WRANGLER_CI_MATCH_TAG\nrm -f "$0"\nexec npx wrangler "$@"\n';
    fs.writeFileSync(shimPath, shimContent, { mode: 0o755 });
    console.log('[setup-cloudflare-ci] Wrangler CI proxy installed.');
  } catch (err) {
    console.warn('[setup-cloudflare-ci] Could not install wrangler CI proxy:', err);
  }
}
