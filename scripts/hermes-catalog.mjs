#!/usr/bin/env node
// Rigenera la copia del catalogo degli strumenti usata dal plugin di Hermes
// (integrations/hermes/xmap-studio/catalog.json) a partire dal core compilato.
// Serve solo finché nessun XMap Studio si è collegato: poi il plugin usa il
// catalogo che gli manda l'app. Il test core `hermes-catalog.test.ts` segnala
// quando la copia è vecchia.
//
//   pnpm --filter @xmap/core build && node scripts/hermes-catalog.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { agentCatalog } from '../packages/core/dist/agent/index.js';

const target = fileURLToPath(new URL('../integrations/hermes/xmap-studio/catalog.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(agentCatalog(), null, 2)}\n`);
console.log(`Catalogo scritto in ${target}`);
