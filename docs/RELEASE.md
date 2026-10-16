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

## Pacchetto Arch Linux

[`packaging/arch/PKGBUILD`](../packaging/arch/PKGBUILD) costruisce un pacchetto
pacman dall'ultimo commit del branch corrente e lo installa:

```bash
cd packaging/arch && makepkg -si
```

Usa l'Electron di sistema (`electron43`), installa l'app in
`/usr/lib/xmap-studio`, il comando `xmap-studio`, la voce di menu, le icone
`hicolor` e il tipo MIME `application/xmind`. Le modifiche non committate non
entrano nel pacchetto. Non esistono ancora pacchetti per altre distribuzioni.
`dist/` è in `.gitignore`.
