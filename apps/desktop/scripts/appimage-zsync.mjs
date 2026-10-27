#!/usr/bin/env node

/**
 * Rende un'AppImage aggiornabile con zsync (AppImageUpdate, Gear Lever, Ouch, …).
 *
 * electron-builder non lo fa da solo: qui si fa quello che farebbe
 * `appimagetool -u`:
 *   1. scrive la stringa di update information nella sezione ELF `.upd_info`
 *      del runtime, che i gestori leggono per sapere dove cercare gli
 *      aggiornamenti (`gh-releases-zsync|owner|repo|latest|pattern`);
 *   2. genera `<AppImage>.zsync` con `zsyncmake`, da allegare alla release.
 *
 * Uso: node apps/desktop/scripts/appimage-zsync.mjs <file.AppImage> [owner/repo]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_REPO = 'gioelerosana/xmap-studio';
const UPDATE_PATTERN = 'XMap-Studio-*-x86_64.AppImage.zsync';
const UPD_INFO_SECTION = '.upd_info';

/** Sezione `name` di un ELF64 little-endian: { offset, size }. */
function findSection(fd, name) {
  const header = Buffer.alloc(64);
  fs.readSync(fd, header, 0, 64, 0);
  if (header.readUInt32BE(0) !== 0x7f454c46 || header[4] !== 2 || header[5] !== 1) {
    throw new Error('Non è un ELF64 little-endian: impossibile leggere le sezioni.');
  }
  const shoff = Number(header.readBigUInt64LE(0x28));
  const shentsize = header.readUInt16LE(0x3a);
  const shnum = header.readUInt16LE(0x3c);
  const shstrndx = header.readUInt16LE(0x3e);

  const table = Buffer.alloc(shentsize * shnum);
  fs.readSync(fd, table, 0, table.length, shoff);
  const sectionAt = (index) => {
    const base = index * shentsize;
    return {
      nameOffset: table.readUInt32LE(base),
      offset: Number(table.readBigUInt64LE(base + 0x18)),
      size: Number(table.readBigUInt64LE(base + 0x20)),
    };
  };

  const strings = sectionAt(shstrndx);
  const names = Buffer.alloc(strings.size);
  fs.readSync(fd, names, 0, names.length, strings.offset);
  for (let index = 0; index < shnum; index++) {
    const section = sectionAt(index);
    const end = names.indexOf(0, section.nameOffset);
    if (names.toString('utf8', section.nameOffset, end) === name) return section;
  }
  return null;
}

const [appImagePath, repo = DEFAULT_REPO] = process.argv.slice(2);
if (!appImagePath || !fs.existsSync(appImagePath) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('Uso: node appimage-zsync.mjs <file.AppImage> [owner/repo]');
  process.exit(1);
}

const [owner, name] = repo.split('/');
const updateInfo = `gh-releases-zsync|${owner}|${name}|latest|${UPDATE_PATTERN}`;

const fd = fs.openSync(appImagePath, 'r+');
try {
  const section = findSection(fd, UPD_INFO_SECTION);
  if (!section) throw new Error(`L'AppImage non ha la sezione ${UPD_INFO_SECTION}: runtime non supportato.`);
  const payload = Buffer.alloc(section.size);
  if (Buffer.byteLength(updateInfo) >= section.size) throw new Error('Update information troppo lunga.');
  payload.write(updateInfo);
  fs.writeSync(fd, payload, 0, payload.length, section.offset);
} finally {
  fs.closeSync(fd);
}
console.log(`[zsync] update information: ${updateInfo}`);

// -u: nome del file dati, relativo alla posizione del .zsync sulla release.
const zsyncPath = `${appImagePath}.zsync`;
execFileSync(
  'zsyncmake',
  ['-u', path.basename(appImagePath), '-o', zsyncPath, appImagePath],
  { stdio: 'inherit' },
);
console.log(`[zsync] generato ${zsyncPath}`);
