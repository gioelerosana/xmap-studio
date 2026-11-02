#!/usr/bin/env bash
#
# packaging/arch/build-tarball.sh
#
# Produce il tarball precompilato per Arch Linux, scaricato da xmap-studio-bin
# su AUR (packaging/arch/aur/PKGBUILD): l'utente non compila nulla.
#
# Uso:
#   pnpm dist:arch                                   # → apps/desktop/release/
#   packaging/arch/build-tarball.sh [cartella] [--skip-build]
#
# Contenuto di xmap-studio-<versione>-linux-x86_64.tar.gz:
#   xmap-studio-<versione>-linux-x86_64/
#     lib/xmap-studio/apps/desktop/   main process + node_modules di produzione
#     lib/xmap-studio/apps/web/dist/  UI (main.js la cerca in ../../web/dist)
#     share/{applications,mime,icons}/
#     LICENSE
# Electron non c'è: il pacchetto usa quello di sistema (electron44), e il
# launcher /usr/bin/xmap-studio lo scrive il PKGBUILD. I moduli nativi
# (@resvg/resvg-js) sono quelli linux-x64 installati da pnpm sulla macchina di
# build: va eseguito su Linux x86_64 (glibc).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/../.." &>/dev/null && pwd)"

OUT_DIR="${ROOT}/apps/desktop/release"
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -*) echo "ERRORE: opzione sconosciuta: $arg" >&2; exit 1 ;;
    *) OUT_DIR="$(realpath -m "$arg")" ;;
  esac
done

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
  echo "ERRORE: il tarball contiene moduli nativi linux-x64: compila su Linux x86_64." >&2
  exit 1
fi

cd "$ROOT"
VERSION="$(node -p "require('./apps/desktop/package.json').version")"
NAME="xmap-studio-${VERSION}-linux-x86_64"

# Electron arriva dal pacchetto di sistema: niente download del binario npm.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  pnpm build
fi
for f in apps/desktop/dist/main.js apps/desktop/dist/preload.js apps/web/dist/index.html; do
  [[ -f "$f" ]] || { echo "ERRORE: manca $f: esegui prima pnpm build." >&2; exit 1; }
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

pnpm --filter @xmap/desktop deploy --prod --legacy "$STAGE/deploy"

TREE="$STAGE/$NAME"
APP="$TREE/lib/xmap-studio"
install -d "$APP/apps/desktop" "$APP/apps/web"
cp -a "$STAGE/deploy/." "$APP/apps/desktop/"
cp -a apps/web/dist "$APP/apps/web/dist"

# Il workspace installa anche il binario resvg di Windows (serve a dist:win):
# qui resta solo quello linux-x64-gnu, e si tolgono i symlink rimasti appesi.
find "$APP/apps/desktop/node_modules/.pnpm" -maxdepth 1 -name '@resvg+resvg-js-*' \
  ! -name '@resvg+resvg-js-linux-x64-gnu@*' -exec rm -rf {} +
find "$APP" -xtype l -delete

install -Dm644 packaging/arch/org.joel.xmap_studio.desktop \
  "$TREE/share/applications/org.joel.xmap_studio.desktop"
install -Dm644 assets/org.joel.xmap_studio.xml \
  "$TREE/share/mime/packages/org.joel.xmap_studio.xml"
install -Dm644 assets/icon.svg \
  "$TREE/share/icons/hicolor/scalable/apps/org.joel.xmap_studio.svg"
install -Dm644 assets/icon-256.png \
  "$TREE/share/icons/hicolor/256x256/apps/org.joel.xmap_studio.png"
install -Dm644 assets/icon-512.png \
  "$TREE/share/icons/hicolor/512x512/apps/org.joel.xmap_studio.png"
install -Dm644 LICENSE "$TREE/LICENSE"

# Permessi normalizzati: il tarball non deve dipendere dall'umask del runner.
chmod -R u+rwX,go+rX,go-w "$TREE"

mkdir -p "$OUT_DIR"
tar -C "$STAGE" --sort=name --owner=0 --group=0 --numeric-owner \
  -czf "$OUT_DIR/$NAME.tar.gz" "$NAME"
echo "Creato $OUT_DIR/$NAME.tar.gz"
