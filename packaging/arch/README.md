# Packaging Arch Linux per XMap Studio

Questa cartella contiene i file di packaging per costruire e installare **XMap Studio** su Arch Linux.

La configurazione adotta la convenzione Arch con due package build distinti:
- **`packaging/arch/PKGBUILD`**: pacchetto `xmap-studio-git` (sviluppo locale). Compila dall'ultimo commit del branch corrente del repository locale.
- **`packaging/arch/release/PKGBUILD`**: pacchetto `xmap-studio` (release). Compila da un tag di versione git (`vYY.MAJOR.MINOR`, vedi `docs/RELEASE.md`).

---

## 1. Come installare

### Build di sviluppo (`xmap-studio-git`)
Compila l'ultimo commit del branch corrente dal clone locale. Utile per testare rapidamente modifiche committate in locale:
```bash
cd packaging/arch
makepkg -si
```
*(Nota: le modifiche nel working tree non committate non vengono incluse nella build).*

### Build di release (`xmap-studio`)
Compila il tag di versione ufficiale (es. `v26.1.0`) dal repository pubblico su GitHub (HTTPS, senza credenziali):
```bash
cd packaging/arch/release
makepkg -si
```
*(Nota: per testare localmente prima del push o senza connessione internet, è possibile decommentare nel PKGBUILD la sorgente `git+file://` verso il repository locale).*

---

## 2. Regole di manutenzione: `pkgver` e `pkgrel`

- **`pkgver`**:
  - In `packaging/arch/PKGBUILD` (`-git`): calcolato dinamicamente tramite la funzione `pkgver()` nel formato `<version>.r<commit_count>.g<hash>`. Non va modificato a mano.
  - In `packaging/arch/release/PKGBUILD`: stringa statica `YY.MAJOR.MINOR` (es. `26.1.0`), priva del prefisso `v`; la aggiorna `release-manual.yml` a ogni release.
- **`pkgrel`**:
  - Viene azzerato a `1` a ogni cambio di `pkgver`.
  - Va incrementato manualmente (`2`, `3`, ...) quando si modificano solo file di packaging o metadati (launcher shell, dipendenze, file `.desktop`, icone) mantenendo inalterata la versione applicativa upstream.

### Script `bump-pkgver.sh`
Per automatizzare l'aggiornamento e la verifica della versione del pacchetto di release:
```bash
# Allinea automaticamente pkgver alla versione in apps/desktop/package.json e imposta pkgrel=1
./packaging/arch/bump-pkgver.sh

# Oppure imposta una versione esplicita (rifiuta formati non SemVer)
./packaging/arch/bump-pkgver.sh 26.1.0

# Verifica allineamento (esce con 0 se allineato, 1 se disallineato; utile in CI)
./packaging/arch/bump-pkgver.sh --check
```

---

## 3. Dipendenze e runtime

### Electron di sistema (`_electron=electron43`)
Il pacchetto dipende dalla versione di Electron fornita da Arch Linux (`depends=("$_electron")`, attualmente `electron43`):
- Durante la compilazione viene impostato `export ELECTRON_SKIP_BINARY_DOWNLOAD=1`: questo impedisce a pnpm di scaricare i binari Electron precompilati per npm (risparmiando centinaia di megabyte di download e spazio).
- L'app viene avviata dal wrapper `/usr/bin/xmap-studio` tramite `exec electron43 /usr/lib/xmap-studio/apps/desktop "$@"`, beneficiando delle librerie di sistema condivise e dei cicli di patch di sicurezza di Arch.

#### Quando Arch aggiorna Electron a una nuova major
Quando nei repository ufficiali di Arch viene rilasciata una nuova major di Electron (es. `electron44`):
1. Aggiornare la variabile `_electron=electron44` in entrambi i `PKGBUILD`.
2. Verificare che `apps/desktop/src/main.ts` e le API Electron impiegate siano pienamente compatibili con la nuova major.
3. Eseguire `makepkg -si` e testare l'avvio e le funzionalità desktop prima del rilascio.

### `makedepends` e `pnpm`
Nei `PKGBUILD` i `makedepends` dichiarati via pacman sono `git` e `nodejs`.
- **Perché `pnpm` non è in `makedepends`**: molti sviluppatori installano e gestiscono `pnpm` tramite `corepack`, `standalone-script` o `npm -g` fuori dal gestore di pacchetti pacman. Il build richiede semplicemente che il comando `pnpm` sia raggiungibile nel `PATH`. Chi preferisce gestirlo con pacman può installare il pacchetto ufficiale Arch `pnpm`.

---

## 4. Generazione `.SRCINFO`

Nei repository AUR o per strumenti pacman esterni, i metadati vengono letti da `.SRCINFO`:
```bash
cd packaging/arch/release
makepkg --printsrcinfo > .SRCINFO
```
`release/.SRCINFO` è versionato e `bump-pkgver.sh` lo rigenera da solo; rigeneralo a mano se modifichi il PKGBUILD (anche solo `pkgrel`).

---

## 5. Checklist per eventuale pubblicazione futura su AUR

Qualora si decida in futuro di rendere pubblico il pacchetto su AUR (`xmap-studio` o `xmap-studio-git`):
- [x] **Accessibilità sorgenti**: AUR richiede sorgenti pubblicamente accessibili senza credenziali. Il PKGBUILD di release scarica già il tag dal repo pubblico `git+https://github.com/gioelerosana/xmap-studio.git`.
- [ ] **Checksum reali**: Nel pacchetto release con tarball sorgente, sostituire `'SKIP'` con gli hash SHA256 effettivi (`sha256sums=('...')` o tramite `updpkgsums`).
- [ ] **Autosufficienza directory**: AUR non ammette riferimenti esterni o symlink a directory genitore. Copiare fisicamente `xmap-studio.sh` e `org.joel.xmap_studio.desktop` nel repository del pacchetto AUR.
- [ ] **Verifica con namcap**: Eseguire `namcap PKGBUILD` e `namcap xmap-studio-*.pkg.tar.zst` per accertarsi dell'assenza di warning su permessi, dipendenze mancanti o file non standard.
- [ ] **Rigenerare `.SRCINFO`**: Eseguire `makepkg --printsrcinfo > .SRCINFO` e committarlo nel repo AUR.
- [ ] **Nessun dato privato**: Assicurarsi che nel PKGBUILD e nei metadati non siano presenti token privati o chiavi SSH.
