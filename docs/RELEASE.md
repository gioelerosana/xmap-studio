# Release

## Versioning

Il progetto segue [SemVer](https://semver.org/lang/it/). La versione è
dichiarata nel campo `version` dei `package.json` del workspace (root,
`packages/core`, `packages/ui-kit`, `apps/web`, `apps/desktop`); vanno tenuti
allineati a ogni release.

## Checklist

1. Aggiorna `version` in tutti i `package.json` del workspace (root,
   `packages/core`, `packages/ui-kit`, `apps/web`, `apps/desktop`).
2. Allinea il pacchetto Arch: `packaging/arch/bump-pkgver.sh` (legge la versione
   da `apps/desktop/package.json`, azzera `pkgrel` e rigenera `.SRCINFO`).
3. Aggiorna il `README.md` se cambiano stack, architettura o limiti noti.
4. `pnpm install --frozen-lockfile`.
5. `pnpm build` — core, ui-kit, web ed Electron devono compilare senza errori.
6. `pnpm test` — tutti verdi.
7. Collauda l'app con `pnpm dev:desktop` e apri in XMind un file generato
   (vedi [`TESTING.md`](TESTING.md)).
8. Commit, tag annotato e push. **Il push del tag avvia la pipeline di release**:

   ```bash
   git add -A
   git commit -m "chore(release): v<versione>"
   git tag -a v<versione> -m "v<versione>"
   git push origin HEAD
   git push origin v<versione>
   ```

9. Attendi la pipeline del tag su GitLab (vedi sotto) e scarica gli artefatti.

## Pipeline di release (GitLab CI)

[`.gitlab-ci.yml`](../.gitlab-ci.yml) gira sui tag `vX.Y.Z` (SemVer puro) e
**a mano** da GitLab (Build › Pipelines › Run pipeline, scegliendo branch o
tag); niente pipeline per i push su branch o per le merge request. Tre job:

| Job | Stage | Cosa fa |
|---|---|---|
| `verify` | verify | `scripts/check-release-version.mjs`: il tag deve coincidere con la `version` di tutti i `package.json` e con `pkgver` del PKGBUILD di release; poi `pnpm build` e `pnpm test` |
| `build:windows` | build | `pnpm dist:win` → `XMap-Studio-<versione>-portable-x64.exe` (+ `SHA256SUMS-windows.txt`) |
| `build:linux-appimage` | build | `pnpm dist:linux` → `XMap-Studio-<versione>-x86_64.AppImage` (+ `SHA256SUMS-linux.txt`) |

In un lancio manuale su un branch non c'è un tag: il controllo tag/versione si
salta, build e test girano comunque (su un tag viene eseguito normalmente). I
due build partono solo se `verify` è verde. Tutti usano l'immagine
`electronuserland/builder:wine` (Node, Wine per icona e metadati dell'exe,
cross-build da Linux) e la versione di pnpm fissata nella variabile `PNPM_VERSION`
del `.gitlab-ci.yml` (da tenere allineata a quella che genera `pnpm-lock.yaml`). Gli artefatti (`expire_in: never`) si scaricano dalla
pipeline del tag. Non c'è firma del codice: Windows SmartScreen può mostrare un
avviso al primo avvio.

Se `verify` fallisce per versioni disallineate, correggi, poi sposta il tag:
`git tag -d v<v> && git push origin :refs/tags/v<v>` e ripeti dal punto 8.

### Build in locale

```bash
pnpm dist:linux     # apps/desktop/release/XMap-Studio-<v>-x86_64.AppImage
pnpm dist:win       # apps/desktop/release/XMap-Studio-<v>-portable-x64.exe
```

Entrambi eseguono `pnpm build`, preparano una cartella di staging con
`pnpm deploy --prod --legacy` (come il PKGBUILD) ed eseguono electron-builder
(`apps/desktop/electron-builder.yml`, risorse in `apps/desktop/build/`). Nel
pacchetto di ogni piattaforma finisce solo il binario nativo di `resvg` della
piattaforma giusta. `dist:win` da Linux senza Wine produce un exe senza icona
né metadati; per l'artefatto di release usa l'immagine Docker del CI:

```bash
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine \
  bash -c 'npm i -g pnpm@12.9.1 && pnpm install --frozen-lockfile && pnpm dist:win'
```

L'AppImage richiede FUSE 2 sull'host (limite di AppImage); altrimenti si avvia
con `--appimage-extract-and-run`. Il lancio aggiunge da sé `--no-sandbox` dove
i user namespace non privilegiati non sono disponibili.

## Artefatti

| Artefatto | Percorso | Distribuito |
|---|---|---|
| Web app (build Vite) | `apps/web/dist/` | no (inclusa nei pacchetti) |
| Processo Electron compilato | `apps/desktop/dist/` | no |
| AppImage Linux | `apps/desktop/release/` | sì (pipeline del tag) |
| Exe portable Windows | `apps/desktop/release/` | sì (pipeline del tag) |
| Pacchetto Arch | `packaging/arch/` | no (si compila in locale) |

## Pacchetto Arch Linux

Due PKGBUILD, con regole di manutenzione in
[`packaging/arch/README.md`](../packaging/arch/README.md):

- `packaging/arch/PKGBUILD` → `xmap-studio-git`: ultimo commit del branch
  corrente, per sviluppo (`cd packaging/arch && makepkg -si`);
- `packaging/arch/release/PKGBUILD` → `xmap-studio`: compila il tag `vX.Y.Z`
  (`cd packaging/arch/release && makepkg -si`).

Usano l'Electron di sistema (`electron43`) e installano l'app in
`/usr/lib/xmap-studio`, il comando `xmap-studio`, la voce di menu, le icone
`hicolor` e il tipo MIME `application/xmind`. Il PKGBUILD di release non è
compilato dalla pipeline: l'allineamento di `pkgver` è però verificato da
`verify`. `dist/` e `release/` degli artefatti sono in `.gitignore`.
