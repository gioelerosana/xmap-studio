# Packaging Arch Linux per XMap Studio

Due pacchetti:

- **`xmap-studio-bin`** su [AUR](https://aur.archlinux.org/packages/xmap-studio-bin):
  quello per gli utenti. **Non compila nulla**: scarica dalla GitHub Release il
  tarball precompilato dal CI e lo installa. Sorgente in `aur/`.
- **`xmap-studio-git`** (`PKGBUILD` in questa cartella): sviluppo locale,
  compila l'ultimo commit di `main` su GitHub.

| File | Ruolo |
|---|---|
| `aur/PKGBUILD`, `aur/xmap-studio.sh` | sorgente del repository AUR `xmap-studio-bin` |
| `build-tarball.sh` | produce `xmap-studio-<v>-linux-x86_64.tar.gz` (`pnpm dist:arch`) |
| `aur-publish.sh` | pubblica `aur/` su AUR con i checksum del tarball rilasciato |
| `bump-pkgver.sh` | allinea/verifica `pkgver` di `aur/PKGBUILD` |
| `PKGBUILD`, `xmap-studio.sh`, `org.joel.xmap_studio.desktop` | pacchetto `-git` (il `.desktop` finisce anche nel tarball) |

## Installare

```bash
yay -S xmap-studio-bin          # o paru, o a mano:
git clone https://aur.archlinux.org/xmap-studio-bin.git && cd xmap-studio-bin && makepkg -si
```

Build di sviluppo dell'ultimo `main` su GitHub:

```bash
cd packaging/arch && makepkg -si
```

A ogni build il `PKGBUILD` aggiorna da GitHub il clone di cache
`packaging/arch/xmap-studio/` e compila l'ultimo commit di `main`: branch,
modifiche non committate e commit non pushati del clone locale non entrano nel
pacchetto. La versione installata dice il commit: `pacman -Q xmap-studio-git` →
`r<numero di commit>.g<hash>`, dove l'hash è quello di `main`
(`git log -1 origin/main`). Il `PKGBUILD` non viene modificato dalla build,
quindi i `git pull` restano puliti.

## Come arriva una release su AUR

1. `release-manual.yml` porta `pkgver` di `aur/PKGBUILD` alla nuova versione
   (`scripts/release-version.mjs set` → `bump-pkgver.sh`, `pkgrel=1`); `verify`
   controlla che coincida col tag.
2. `release.yml`, job `build (arch)`: `pnpm dist:arch` compila l'app, prepara
   le dipendenze di produzione (`pnpm deploy --prod`, solo il binario resvg
   linux-x64) e crea il tarball, allegato alla GitHub Release con
   `SHA256SUMS-arch.txt`.
3. Job `aur` (container `archlinux:base-devel`): `aur-publish.sh` riscarica il
   tarball dall'URL pubblico della Release, scrive i `sha256sums` veri, prova
   `makepkg` (senza installare), rigenera `.SRCINFO`, committa e fa push su
   `ssh://aur@aur.archlinux.org/xmap-studio-bin.git`.

Nel repository `aur/PKGBUILD` ha `sha256sums=('SKIP' 'SKIP')`: i checksum veri
esistono solo dopo la build, e li scrive lo script nella copia pubblicata.
`.SRCINFO` non è versionato qui: lo genera lo script.

### Chiave SSH del CI

Il job `aur` usa il secret di repository **`AUR_SSH_PRIVATE_KEY`**: una chiave
ed25519 dedicata al CI, la cui parte pubblica è registrata nell'account AUR del
maintainer (*My Account › SSH Public Key*, una chiave per riga). Senza il
secret il job emette un warning e non pubblica; la Release resta valida.

Per sostituirla:

```bash
ssh-keygen -t ed25519 -N '' -C 'xmap-studio CI → AUR' -f /tmp/aur-ci
gh secret set AUR_SSH_PRIVATE_KEY < /tmp/aur-ci
cat /tmp/aur-ci.pub     # da aggiungere su https://aur.archlinux.org/account/
rm /tmp/aur-ci /tmp/aur-ci.pub
```

### Pubblicare a mano

Se il job `aur` fallisce, o per cambi di solo packaging, da una macchina Arch
con la propria chiave registrata su AUR:

```bash
packaging/arch/aur-publish.sh --dry-run   # prepara e mostra, senza push
packaging/arch/aur-publish.sh
```

Lo script pubblica la versione scritta in `aur/PKGBUILD` (il tarball di quella
versione deve essere già sulla Release) e non fa nulla se AUR è già allineato.

## `pkgver` e `pkgrel`

- `pkgver` di `aur/PKGBUILD` lo scrive solo il workflow di release: non toccarlo
  nei branch di lavoro. `bump-pkgver.sh --check` verifica l'allineamento con
  `apps/desktop/package.json`.
- `pkgrel` torna a `1` a ogni nuova versione. Per un cambio di solo packaging
  (dipendenze, launcher, `package()`) sulla stessa versione: incrementalo in
  `aur/PKGBUILD` con una PR e, dopo il merge, lancia `aur-publish.sh` a mano.
  Se il cambio riguarda il contenuto del tarball serve invece una nuova release.
- Il `-git` non ha versione propria: la ricava solo dal commit di `main` che
  compila (`r<numero di commit>.g<hash>`), senza leggere i `package.json`,
  quindi non segue le release né `xmap-studio-bin`. Non usa una funzione
  `pkgver()`, che farebbe riscrivere a makepkg la riga `pkgver` nel file: il
  commit si calcola quando makepkg legge il `PKGBUILD` (fetch nella cache,
  `refs/heads/main`) e la sorgente è fissata a quel commit (`#commit=`).
  Una cache che non punta a GitHub viene ricreata da sola.

## Electron di sistema

I pacchetti dipendono da `electron44` dei repository Arch e non includono
Electron: il tarball pesa ~15 MB invece dei ~100 MB dell'AppImage, e Electron
riceve gli aggiornamenti di sicurezza di Arch. Il launcher `/usr/bin/xmap-studio`
esegue `electron44 /usr/lib/xmap-studio/apps/desktop`.

Quando Arch passa a una nuova major (es. `electron45`):

1. aggiorna `_electron` in `aur/PKGBUILD` e in `PKGBUILD`;
2. verifica `apps/desktop/src/main.ts` con la nuova major (`makepkg -si` del `-git`);
3. pubblica: con la prossima release, o subito con `pkgrel` + `aur-publish.sh`.

Il `-git` ha `git` e `nodejs` come `makedepends` e vuole `pnpm` nel `PATH`
(anche installato fuori da pacman, es. con corepack).
