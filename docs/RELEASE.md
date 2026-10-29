# Release

## Versioning

Le versioni sono nel formato **`vYY.MAJOR.MINOR`** (calendario + contatori),
per esempio `v26.1.0`, `v26.1.1`, `v26.2.0`:

| Parte | Significato |
|---|---|
| `YY` | anno del rilascio a due cifre (data del lancio della release, UTC) |
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

### Release a richiesta

Un merge in `main` **non** rilascia nulla. Il flusso delle PR (una per task,
unite in fretta) è separato dalla release, che si lancia a mano quando l'utente
decide di pubblicare ([`release-manual.yml`](../.github/workflows/release-manual.yml)).

Il tipo di release si ricava dai **subject dei commit su `main` dall'ultimo tag
`v*`**, in [Conventional Commits](https://www.conventionalcommits.org/) (`tipo(ambito):
descrizione`, descrizione in italiano). Con lo squash merge il subject è il
titolo della PR; con un merge commit contano i commit del branch.

| Commit dall'ultimo tag | Release |
|---|---|
| almeno un `feat(...)`, o qualunque tipo con `!` (`fix(core)!: …`) | `MAJOR`: `v26.2.0` → `v26.3.0` |
| altrimenti almeno un `fix`, `perf`, `refactor`, `style`, `revert`, `build` | `MINOR`: `v26.2.0` → `v26.2.1` |
| solo `docs`, `ci`, `chore`, `test`, o nessun commit | niente da rilasciare |

Non contano i merge commit (`Merge pull request …`, `Merge branch …`) e i
`chore(release): …`. I subject non conformi a Conventional Commits sono
ignorati, ma il riepilogo del run li elenca. Il controllo
[`pr-title.yml`](../.github/workflows/pr-title.yml) verifica solo il formato del
titolo della PR, perché è quello che il calcolo leggerà; il suo riepilogo dice
anche che il merge non rilascia.

Per lanciare la release:

```bash
gh workflow run release-manual.yml --ref main -f bump=auto   # auto | major | minor
gh run list --workflow release-manual.yml --limit 1
gh run watch <id>
```

Oppure da GitHub: Actions › Release manuale › Run workflow, branch `main`. Il
workflow rifiuta qualunque altro branch. L'input `bump` è `auto` (default: dai
commit) oppure `major`/`minor` per forzare il tipo; con `auto` e solo commit
`docs`/`ci`/`chore`/`test` il run termina con «niente da rilasciare», senza
errore. Se serve, `bump` = `major`/`minor` pubblica comunque.

Il workflow:

1. calcola il tipo e la versione dai tag esistenti
   (`scripts/release-version.mjs commits` e `next`) e li scrive nel riepilogo
   del run, insieme all'elenco dei commit inclusi;
2. aggiorna `package.json` e PKGBUILD con un commit
   `chore(release): vYY.MAJOR.MINOR` su `main`, il cui corpo elenca i commit
   inclusi;
3. crea il tag annotato e lo pusha insieme al commit (push atomico);
4. richiama il workflow di release (build, test, artefatti, GitHub Release) e
   il mirror GitLab.

Le release sono serializzate (un solo `release-manual` alla volta). Nei branch
di lavoro **non** si tocca la versione: la scrive solo il workflow.

## Checklist

Per ogni PR:

1. Titolo in Conventional Commits con il tipo giusto (tabella sopra); il check
   "Titolo PR" deve essere verde.
2. Aggiorna `README.md` (cosa fa l'app) e `docs/OVERVIEW.md` (stack,
   architettura, limiti noti) se cambiano.
3. `pnpm build` e `pnpm test` verdi;
   `node --test scripts/*.test.mjs` se tocchi gli script di repo o di release.
4. Collauda l'app con `pnpm dev:desktop` e apri in XMind un file generato
   (vedi [`TESTING.md`](TESTING.md)) se hai toccato formato o salvataggio.

Per rilasciare, quando l'utente lo chiede:

1. `git fetch origin`: `main` locale allineato, CI di `main` verde.
2. `gh workflow run release-manual.yml --ref main -f bump=auto`.
3. Segui il run (`gh run watch`): il riepilogo mostra i commit inclusi e la
   versione calcolata; a fine run gli artefatti sono allegati alla GitHub
   Release del tag.
4. `git pull` su `main` in locale: il commit di release è del bot.

### Release a mano

Serve solo per casi eccezionali (ripubblicare una versione, `release-manual.yml`
fallito a metà). Stesse regole di numerazione:

```bash
node scripts/release-version.mjs next --bump minor   # stampa la prossima, es. 26.2.1
node scripts/release-version.mjs set 26.2.1
git commit -am "chore(release): v26.2.1"
git tag -a v26.2.1 -m "v26.2.1"
git push origin HEAD v26.2.1                           # il push del tag avvia release.yml
```

## Workflow di release (GitHub Actions)

[`.github/workflows/release.yml`](../.github/workflows/release.yml) gira quando
lo richiama `release-manual.yml` dopo che l'utente l'ha lanciato, sul push
manuale di un tag `vYY.MAJOR.MINOR` e **a mano** da GitHub (Actions › Release ›
Run workflow, scegliendo branch o tag, per provare la build senza pubblicare).
Sulle pull request girano solo il controllo del titolo (`pr-title.yml`) e il
commento con l'anteprima (`preview.yml`). I passi comuni (pnpm, cache dello store, `pnpm install`) sono
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
`release-manual.yml` ha già creato commit e tag, correggi con una nuova PR e
rilancia la release: uscirà la versione successiva.

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
