# Release

## Versioning

Il progetto segue [SemVer](https://semver.org/lang/it/). La versione è
dichiarata nel campo `version` dei `package.json` del workspace (root,
`packages/core`, `packages/ui-kit`, `apps/web`, `apps/desktop`); vanno tenuti
allineati a ogni release.

## Checklist

1. Aggiorna `version` in tutti i `package.json` del workspace.
2. Aggiorna il `README.md` se cambiano stack, architettura o limiti noti.
3. `pnpm install --frozen-lockfile`.
4. `pnpm build` — core, ui-kit, web ed Electron devono compilare senza errori.
5. `pnpm test` — tutti verdi.
6. Collauda l'app con `pnpm dev:desktop` e apri in XMind un file generato
   (vedi [`TESTING.md`](TESTING.md)).
7. Commit, tag annotato e push:

   ```bash
   git add -A
   git commit -m "Release v<versione>"
   git tag -a v<versione> -m "v<versione>"
   git push origin HEAD
   git push origin v<versione>
   ```

8. Crea la release sul repository GitLab.

## Artefatti

| Artefatto | Percorso | Distribuito |
|---|---|---|
| Web app (build Vite) | `apps/web/dist/` | no (usata da Electron) |
| Processo Electron compilato | `apps/desktop/dist/` | no |

Al momento non esiste uno script che produca un pacchetto installabile
(AppImage, deb o simili): `pnpm build:desktop` compila solo il processo
Electron. Per distribuire un pacchetto occorre aggiungere un packager
(ad esempio `electron-builder`) e dichiarare l'estensione `.xmind` per la
piattaforma scelta. `dist/` è in `.gitignore`.
