# Release

## Versioning

Le versioni sono nel formato **`vYY.MAJOR.MINOR`** (calendario + contatori),
per esempio `v26.1.0`, `v26.1.1`, `v26.2.0`:

| Parte | Significato |
|---|---|
| `YY` | anno del rilascio a due cifre (data del merge, UTC) |
| `MAJOR` | numero della release di funzionalità nell'anno; riparte da 1 a ogni anno nuovo |
| `MINOR` | numero della release di sole correzioni dopo l'ultima `MAJOR`; riparte da 0 a ogni `MAJOR` |

La prima release di un anno è sempre `vYY.1.0`, di qualunque tipo sia. `MAJOR`
qui non vuol dire "rompe la compatibilità" come in SemVer: è una release che
porta funzionalità nuove. La sintassi resta però quella di SemVer (`X.Y.Z`),
quindi `package.json`, electron-builder e `pkgver` di Arch la accettano senza
adattamenti, e `26.1.0` è più recente di `0.0.x`.

La versione è scritta nel campo `version` di tutti i `package.json` del
workspace (root, `packages/core`, `packages/ui-kit`, `apps/web`,
`apps/desktop`) e in `pkgver` di `packaging/arch/release/PKGBUILD`; li allinea
`node scripts/release-version.mjs set <versione>`.
Nessun altro punto la ripete a mano: la pagina "Informazioni" dell'app la legge
da `apps/web/package.json` al build (`__APP_VERSION__` in
`apps/web/vite.config.ts`), Electron da `apps/desktop/package.json`, i nomi
degli artefatti da electron-builder.

### Una release per ogni PR

Ogni PR unito in `main` produce da solo la sua release
([`auto-release.yml`](../.github/workflows/auto-release.yml)). Il tipo lo decide
il **titolo del PR**, in [Conventional Commits](https://www.conventionalcommits.org/)
come i commit (`tipo(ambito): descrizione`, descrizione in italiano):

| Titolo del PR | Release al merge |
|---|---|
| `feat(...)`, o qualunque tipo con `!` (`fix(core)!: …`) | `MAJOR`: `v26.2.0` → `v26.3.0` |
| `fix`, `perf`, `refactor`, `style`, `revert`, `build` | `MINOR`: `v26.2.0` → `v26.2.1` |
| `docs`, `ci`, `chore`, `test` | nessuna release |

Il tipo si sceglie guardando **tutto** il PR, non il primo commit: se contiene
anche una sola funzionalità nuova per l'utente è `feat`; se cambia solo il
comportamento di cose esistenti (correzioni, prestazioni, ritocchi) è `fix` o
simili; se non tocca l'app distribuita (doc, CI, strumenti di repo) è `docs`,
`ci` o `chore`.

Un'etichetta sul PR vince sul titolo: `release:major`, `release:minor` o
`release:none` (per esempio un `docs` che va comunque pubblicato, o un `fix`
che non deve uscire da solo). Al massimo una per PR.

Il workflow [`pr-title.yml`](../.github/workflows/pr-title.yml) controlla il
titolo e le etichette a ogni modifica del PR e scrive nel riepilogo del job la
versione che il merge produrrebbe. Al merge, `auto-release.yml`:

1. calcola la versione dai tag esistenti (`scripts/release-version.mjs`);
2. aggiorna `package.json` e PKGBUILD con un commit
   `chore(release): vYY.MAJOR.MINOR` su `main`;
3. crea il tag annotato e lo pusha insieme al commit;
4. richiama il workflow di release (build, test, artefatti, GitHub Release) e
   il mirror GitLab.

I merge vengono serializzati (un solo `auto-release` alla volta), quindi due PR
uniti di seguito ricevono versioni consecutive. Nei branch di lavoro **non** si
tocca la versione: la scrive solo il workflow.

## Checklist

Prima del merge di un PR che produce una release:

1. Titolo del PR in Conventional Commits con il tipo giusto (tabella sopra), o
   etichetta `release:*`; il check "Titolo PR" deve essere verde.
2. Aggiorna `README.md` (cosa fa l'app) e `docs/OVERVIEW.md` (stack,
   architettura, limiti noti) se cambiano.
3. `pnpm build` e `pnpm test` verdi;
   `node --test scripts/release-version.test.mjs` se tocchi gli script di
   release.
4. Collauda l'app con `pnpm dev:desktop` e apri in XMind un file generato
   (vedi [`TESTING.md`](TESTING.md)).
5. Dopo il merge segui il workflow "Auto release" su GitHub Actions: a fine run
   gli artefatti sono allegati alla GitHub Release del tag.
6. Fai `git pull` su `main` in locale: il commit di release è del bot.

### Release a mano

Serve solo per casi eccezionali (ripubblicare una versione, workflow
automatico fallito a metà). Stesse regole di numerazione:

```bash
node scripts/release-version.mjs next --bump minor   # stampa la prossima, es. 26.2.1
node scripts/release-version.mjs set 26.2.1
git commit -am "chore(release): v26.2.1"
git tag -a v26.2.1 -m "v26.2.1"
git push origin HEAD v26.2.1                           # il push del tag avvia release.yml
```

## Workflow di release (GitHub Actions)

[`.github/workflows/release.yml`](../.github/workflows/release.yml) gira quando
lo richiama `auto-release.yml` dopo un merge, sul push manuale di un tag
`vYY.MAJOR.MINOR` e **a mano** da GitHub (Actions › Release › Run workflow,
scegliendo branch o tag). Sulle pull request gira solo il controllo del titolo
(`pr-title.yml`). I passi comuni (pnpm, cache dello store, `pnpm install`) sono
nell'azione locale [`.github/actions/setup`](../.github/actions/setup/action.yml).
Job:

| Job | Stage | Cosa fa |
|---|---|---|
| `verify` | verify | `scripts/check-release-version.mjs`: il tag deve coincidere con la `version` di tutti i `package.json` e con `pkgver` del PKGBUILD di release; poi `pnpm build` e `pnpm test` |
| `build (windows)` | build | `pnpm dist:win` → `XMap-Studio-<versione>-portable-x64.exe` (+ `SHA256SUMS-windows.txt`) |
| `build (linux)` | build | `pnpm dist:linux` → `XMap-Studio-<versione>-x86_64.AppImage`, poi `appimage-zsync.mjs` (update information + `.AppImage.zsync`) (+ `SHA256SUMS-linux.txt`) |
| `release` | release | solo sui tag: crea la GitHub Release del tag (note generate dai commit) e allega i due artefatti e i checksum |

In un lancio manuale su un branch non c'è un tag: il controllo tag/versione si
salta, build e test girano comunque (su un tag viene eseguito normalmente). I
due build partono solo se `verify` è verde. `verify` e i build girano nel
container `electronuserland/builder:wine` (Node, Wine per icona e metadati
dell'exe, cross-build da Linux) con la versione di pnpm fissata nella variabile
`PNPM_VERSION` del workflow (da tenere allineata a quella che genera
`pnpm-lock.yaml`). Gli artefatti restano per sempre nella GitHub Release del
tag; nei lanci manuali si scaricano dalla pagina del run (scadono dopo 90
giorni). Non c'è firma del codice: Windows SmartScreen può mostrare un
avviso al primo avvio.

Se `verify` fallisce per versioni disallineate, correggi, poi sposta il tag:
`git tag -d v<v> && git push origin :refs/tags/v<v>` e ripeti come in
§"Release a mano". Se la Release del tag era già stata creata, cancellala prima
(`gh release delete v<v>`). Se invece fallisce la build dopo che
`auto-release.yml` ha già creato commit e tag, correggi con un nuovo PR: ne
uscirà la versione successiva.

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

Le icone dei pacchetti in `apps/desktop/build/` (`icon.svg`, `icon.png`,
`icon.ico`, `icons/<n>x<n>.png`) sono copie derivate da `assets/icon.svg`:
quando cambia l'icona vanno rigenerate, altrimenti AppImage ed exe escono con
quella vecchia:

```bash
B=apps/desktop/build
cp assets/icon.svg $B/icon.svg
rsvg-convert -w 512 -h 512 assets/icon.svg -o $B/icon.png
for s in 16 32 48 64 128 256 512; do
  rsvg-convert -w $s -h $s assets/icon.svg -o $B/icons/${s}x${s}.png
done
magick $B/icons/{16x16,32x32,48x48,64x64,128x128,256x256}.png $B/icon.ico
```

L'AppImage richiede FUSE 2 sull'host (limite di AppImage); altrimenti si avvia
con `--appimage-extract-and-run`. Il lancio aggiunge da sé `--no-sandbox` dove
i user namespace non privilegiati non sono disponibili.

## Aggiornamenti automatici

- **Linux (AppImage):** `apps/desktop/scripts/appimage-zsync.mjs` scrive nella
  sezione ELF `.upd_info` la stringa `gh-releases-zsync|gioelerosana|xmap-studio|latest|XMap-Studio-*-x86_64.AppImage.zsync`
  e genera `<AppImage>.zsync` con `zsyncmake` (pacchetto `zsync`, installato nel
  job). I gestori di AppImage (AppImageUpdate, Gear Lever, …) cercano il `.zsync`
  nell'ultima release e scaricano solo i blocchi cambiati. Va eseguito prima del
  checksum, perché modifica l'AppImage.
- **Windows (exe portable):** in Impostazioni › Informazioni il pulsante
  "Controlla aggiornamenti" (`apps/desktop/src/updater.ts`) legge l'ultima
  release su GitHub; se è più recente scarica l'exe nei Download verificando lo
  SHA-256 di `SHA256SUMS-windows.txt` e lo mostra in Esplora file. Non sostituisce
  l'exe in esecuzione: l'utente lo avvia dopo aver chiuso l'app.

## Artefatti

| Artefatto | Percorso | Distribuito |
|---|---|---|
| Web app (build Vite) | `apps/web/dist/` | no (inclusa nei pacchetti) |
| Processo Electron compilato | `apps/desktop/dist/` | no |
| AppImage Linux (+ `.zsync`) | `apps/desktop/release/` | sì (GitHub Release del tag) |
| Exe portable Windows | `apps/desktop/release/` | sì (GitHub Release del tag) |
| Pacchetto Arch | `packaging/arch/` | no (si compila in locale) |

## Pacchetto Arch Linux

Due PKGBUILD, con regole di manutenzione in
[`packaging/arch/README.md`](../packaging/arch/README.md):

- `packaging/arch/PKGBUILD` → `xmap-studio-git`: ultimo commit del branch
  corrente, per sviluppo (`cd packaging/arch && makepkg -si`);
- `packaging/arch/release/PKGBUILD` → `xmap-studio`: compila il tag `vYY.MAJOR.MINOR`
  (`cd packaging/arch/release && makepkg -si`).

Usano l'Electron di sistema (`electron43`) e installano l'app in
`/usr/lib/xmap-studio`, il comando `xmap-studio`, la voce di menu, le icone
`hicolor` e il tipo MIME `application/xmind`. Il PKGBUILD di release non è
compilato dal workflow: l'allineamento di `pkgver` è però verificato da
`verify`. `dist/` e `release/` degli artefatti sono in `.gitignore`.
