#!/usr/bin/env node

/**
 * Script di distribuzione per XMap Studio.
 * Impacchetta l'applicazione desktop con electron-builder per Linux (.AppImage)
 * o Windows (.exe portable), predisponendo un layout di staging compatibile con
 * la struttura del monorepo e isolando i binari nativi (@resvg/resvg-js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Percorsi chiave del repository
const desktopDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(desktopDir, '../..');
const webDir = path.resolve(rootDir, 'apps/web');
const releaseDir = path.resolve(desktopDir, 'release');
const configPath = path.resolve(desktopDir, 'electron-builder.yml');

// Parsing degli argomenti CLI
const args = process.argv.slice(2);
const target = args.find((arg) => arg === 'linux' || arg === 'win');
const skipBuild = args.includes('--skip-build');

if (!target) {
  console.error('Uso: node apps/desktop/scripts/dist.mjs <linux|win> [--skip-build]');
  process.exit(1);
}

console.log(`[dist] Avvio packaging di XMap Studio per target: ${target}`);

// 1. Compilazione dei pacchetti (se non saltata via --skip-build)
if (!skipBuild) {
  console.log('[dist] Compilazione dei package del monorepo (pnpm build)...');
  execSync('pnpm build', { cwd: rootDir, stdio: 'inherit' });
} else {
  console.log('[dist] Flag --skip-build presente: salto pnpm build.');
}

// Verifica che i file compilati indispensabili siano presenti
const desktopMainJs = path.resolve(desktopDir, 'dist/main.js');
const desktopPreloadJs = path.resolve(desktopDir, 'dist/preload.js');
const webIndexHtml = path.resolve(webDir, 'dist/index.html');

if (!fs.existsSync(desktopMainJs) || !fs.existsSync(desktopPreloadJs)) {
  console.error(`[dist] ERRORE: File compilati di apps/desktop mancanti in ${path.resolve(desktopDir, 'dist')}. Esegui prima pnpm build.`);
  process.exit(1);
}
if (!fs.existsSync(webIndexHtml)) {
  console.error(`[dist] ERRORE: File compilati di apps/web mancanti in ${path.resolve(webDir, 'dist')}. Esegui prima pnpm build.`);
  process.exit(1);
}

// 2. Lettura versioni da package.json
const desktopPkg = JSON.parse(fs.readFileSync(path.resolve(desktopDir, 'package.json'), 'utf-8'));
const version = desktopPkg.version;
if (!version) {
  console.error('[dist] ERRORE: Versione non specificata in apps/desktop/package.json');
  process.exit(1);
}

// Lettura della versione di Electron utilizzata
let electronVersion = null;
const electronPkgPaths = [
  path.resolve(desktopDir, 'node_modules/electron/package.json'),
  path.resolve(rootDir, 'node_modules/electron/package.json'),
];
for (const p of electronPkgPaths) {
  if (fs.existsSync(p)) {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
    electronVersion = pkg.version;
    break;
  }
}
if (!electronVersion) {
  console.error('[dist] ERRORE: Impossibile determinare la versione di electron da node_modules/electron');
  process.exit(1);
}
console.log(`[dist] Versione applicazione: ${version}, Versione Electron: ${electronVersion}`);

// 3. Preparazione directory di staging
const stageDir = path.resolve(releaseDir, `.stage-${target}`);
const deployDir = path.resolve(stageDir, 'deploy');

fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

console.log(`[dist] Deploy delle dipendenze di produzione con pnpm deploy su ${deployDir}...`);
execSync(`pnpm --filter @xmap/desktop deploy --prod --legacy "${deployDir}"`, {
  cwd: rootDir,
  stdio: 'inherit',
});

// 4. Creazione della gerarchia della stage attesa da main.ts e electron-builder:
//    stage/
//      package.json
//      node_modules/
//      apps/
//        desktop/
//          dist/ (main.js, preload.js)
//          node_modules -> symlink a ../../node_modules
//        web/
//          dist/ (index.html e assets)
const stageAppsDesktop = path.resolve(stageDir, 'apps/desktop');
const stageAppsWeb = path.resolve(stageDir, 'apps/web');
fs.mkdirSync(stageAppsDesktop, { recursive: true });
fs.mkdirSync(stageAppsWeb, { recursive: true });

// Copia di apps/desktop/dist
fs.cpSync(path.resolve(deployDir, 'dist'), path.resolve(stageAppsDesktop, 'dist'), { recursive: true });

// Copia di apps/web/dist
fs.cpSync(path.resolve(webDir, 'dist'), path.resolve(stageAppsWeb, 'dist'), { recursive: true });

// Sposta node_modules al root della stage
fs.renameSync(path.resolve(deployDir, 'node_modules'), path.resolve(stageDir, 'node_modules'));

// Symlink da apps/desktop/node_modules a ../../node_modules per risoluzione diretta se necessaria
try {
  fs.symlinkSync('../../node_modules', path.resolve(stageAppsDesktop, 'node_modules'), 'junction');
} catch (e) {
  // Ignora se la creazione del symlink fallisce su alcuni filesystem non privilegiati
}

// Generazione di package.json per la stage
const stagePackageJson = {
  name: 'xmap-studio',
  productName: desktopPkg.productName || 'XMap Studio',
  version: version,
  description: 'Companion desktop per mappe XMind: equazioni LaTeX ed editing avanzato',
  desktopName: desktopPkg.desktopName,
  main: 'apps/desktop/dist/main.js',
  dependencies: {
    '@xmap/core': '*',
  },
};
fs.writeFileSync(path.resolve(stageDir, 'package.json'), JSON.stringify(stagePackageJson, null, 2), 'utf-8');

// Pulizia della cartella deploy temporanea
fs.rmSync(deployDir, { recursive: true, force: true });

// 5. Isolamento e filtraggio dei binari nativi (@resvg/resvg-js)
console.log(`[dist] Configurazione e verifica binari nativi resvg per target ${target}...`);
const stageNodeModules = path.resolve(stageDir, 'node_modules');

function walkAndFilterNative(dir, targetPlatform) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndFilterNative(fullPath, targetPlatform);
    }
    
    // Rimuovi binari e pacchetti della piattaforma non richiesta
    if (targetPlatform === 'linux') {
      if (entry.name.includes('win32-x64-msvc') || entry.name.endsWith('.win32-x64-msvc.node')) {
        console.log(`[dist] Rimozione binario Windows non necessario: ${path.relative(stageDir, fullPath)}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } else if (targetPlatform === 'win') {
      if (entry.name.includes('linux-x64-gnu') || entry.name.endsWith('.linux-x64-gnu.node')) {
        console.log(`[dist] Rimozione binario Linux non necessario: ${path.relative(stageDir, fullPath)}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }
}

// Esegui la rimozione dei binari della piattaforma opposta
walkAndFilterNative(stageNodeModules, target);

// Se per Windows il binario resvgjs.win32-x64-msvc.node non fosse presente nella stage,
// copialo in modo riproducibile da rootDir/node_modules/.pnpm
if (target === 'win') {
  let hasWinBinary = false;
  function checkForWinBinary(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'resvgjs.win32-x64-msvc.node') {
        hasWinBinary = true;
        return;
      }
      if (entry.isDirectory()) checkForWinBinary(path.join(dir, entry.name));
    }
  }
  checkForWinBinary(stageNodeModules);

  if (!hasWinBinary) {
    console.log('[dist] Binario win32 resvg non trovato nella stage: ricerca in root node_modules/.pnpm...');
    // Cerca il package sorgente
    const pnpmDir = path.resolve(rootDir, 'node_modules/.pnpm');
    let sourceWinPkg = null;
    if (fs.existsSync(pnpmDir)) {
      const pnpmEntries = fs.readdirSync(pnpmDir);
      for (const e of pnpmEntries) {
        if (e.startsWith('@resvg+resvg-js-win32-x64-msvc@')) {
          const candidate = path.join(pnpmDir, e, 'node_modules/@resvg/resvg-js-win32-x64-msvc');
          if (fs.existsSync(candidate)) {
            sourceWinPkg = candidate;
            break;
          }
        }
      }
    }
    if (sourceWinPkg) {
      const targetWinPkg = path.resolve(stageNodeModules, '@resvg/resvg-js-win32-x64-msvc');
      console.log(`[dist] Copia binario win32 da ${sourceWinPkg} a ${targetWinPkg}`);
      fs.cpSync(sourceWinPkg, targetWinPkg, { recursive: true });
    } else {
      console.warn('[dist] ATTENZIONE: Impossibile trovare il binario @resvg/resvg-js-win32-x64-msvc nel workspace pnpm!');
    }
  }
}

// Verifica finale di assenza di binari non corretti
let foundWrongBinary = false;
function verifyNoWrongBinaries(dir, targetPlatform) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (targetPlatform === 'linux' && (entry.name.includes('win32-x64') || entry.name.endsWith('.win32-x64-msvc.node'))) {
      console.error(`[dist] ERRORE: Binario win32 residuo rilevato in: ${fullPath}`);
      foundWrongBinary = true;
    }
    if (targetPlatform === 'win' && (entry.name.includes('linux-x64') || entry.name.endsWith('.linux-x64-gnu.node'))) {
      console.error(`[dist] ERRORE: Binario linux residuo rilevato in: ${fullPath}`);
      foundWrongBinary = true;
    }
    if (entry.isDirectory()) verifyNoWrongBinaries(fullPath, targetPlatform);
  }
}
verifyNoWrongBinaries(stageNodeModules, target);
if (foundWrongBinary) {
  process.exit(1);
}

// 6. Esecuzione di electron-builder
const builderBin = path.resolve(desktopDir, 'node_modules/.bin/electron-builder');
if (!fs.existsSync(builderBin)) {
  console.error(`[dist] ERRORE: Eseguibile electron-builder non trovato in ${builderBin}`);
  process.exit(1);
}

// Costruzione degli argomenti CLI per electron-builder
const builderArgs = [
  'build',
  '--config', configPath,
  '--projectDir', stageDir,
  '--publish', 'never',
  `-c.directories.output=${releaseDir}`,
  `-c.directories.buildResources=${path.resolve(desktopDir, 'build')}`,
  `-c.electronVersion=${electronVersion}`,
];

if (target === 'linux') {
  builderArgs.push('--linux', 'appimage', '--x64');
} else if (target === 'win') {
  builderArgs.push('--win', 'portable', '--x64');
  // Se wine non è installato nell'ambiente corrente, disabilita signAndEditExecutable per evitare fallimenti
  let hasWine = false;
  try {
    execSync('which wine', { stdio: 'ignore' });
    hasWine = true;
  } catch {
    hasWine = false;
  }
  if (!hasWine) {
    console.log('[dist] Wine non rilevato nel sistema: disabilito win.signAndEditExecutable');
    builderArgs.push('-c.win.signAndEditExecutable=false');
  } else {
    console.log('[dist] Wine rilevato: signAndEditExecutable attivo');
  }
}

console.log(`[dist] Invocazione electron-builder: ${builderBin} ${builderArgs.join(' ')}`);

// Rimuovi ELECTRON_RUN_AS_NODE dall'ambiente per non interferire con il processo di packaging
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

try {
  execSync(`"${builderBin}" ${builderArgs.join(' ')}`, {
    cwd: desktopDir,
    stdio: 'inherit',
    env,
  });
} finally {
  // Pulizia della cartella stage per non lasciare residui temporanei
  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

// 7. Verifica finale dell'artefatto generato
const expectedArtifact = target === 'linux'
  ? path.resolve(releaseDir, `XMap-Studio-${version}-x86_64.AppImage`)
  : path.resolve(releaseDir, `XMap-Studio-${version}-portable-x64.exe`);

if (!fs.existsSync(expectedArtifact)) {
  console.error(`[dist] ERRORE: L'artefatto previsto non è stato trovato: ${expectedArtifact}`);
  process.exit(1);
}

const stats = fs.statSync(expectedArtifact);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`\n======================================================`);
console.log(`[dist] Build completata con successo!`);
console.log(`[dist] Artefatto: ${expectedArtifact}`);
console.log(`[dist] Dimensione: ${sizeMb} MB (${stats.size} byte)`);
console.log(`======================================================\n`);
