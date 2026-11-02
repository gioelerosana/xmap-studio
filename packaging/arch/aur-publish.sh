#!/usr/bin/env bash
#
# packaging/arch/aur-publish.sh
#
# Pubblica packaging/arch/aur/ su AUR come xmap-studio-bin. Lo esegue il job
# `aur` di release.yml dopo la GitHub Release; a mano serve per ripubblicare
# (es. dopo un bump di pkgrel) o se il job è fallito.
#
# Uso:
#   packaging/arch/aur-publish.sh [--dry-run] [--no-build] [--tarball FILE]
#
#   --dry-run       prepara e committa nel clone temporaneo, ma non fa push
#   --no-build      salta la prova di makepkg (solo per diagnosi)
#   --tarball FILE  usa questo tarball invece di scaricarlo dalla GitHub Release
#                   (i checksum devono poi coincidere con l'asset pubblicato!)
#
# Passi: scarica il tarball di `pkgver` dalla GitHub Release, scrive i checksum
# veri nel PKGBUILD, prova `makepkg` (senza installare: dipendenze saltate),
# rigenera .SRCINFO, committa nel repository AUR e fa push. Se nel repository
# AUR c'è già lo stesso contenuto non fa nulla.
#
# Serve Arch Linux (makepkg) e una chiave SSH registrata sull'account AUR del
# maintainer (`ssh aur@aur.archlinux.org help` deve rispondere). makepkg non
# gira da root.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SRC_DIR="${SCRIPT_DIR}/aur"
AUR_REPO="${AUR_REPO:-ssh://aur@aur.archlinux.org/xmap-studio-bin.git}"

DRY_RUN=0
BUILD=1
TARBALL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-build) BUILD=0 ;;
    --tarball) TARBALL="$(realpath "${2:?--tarball vuole un file}")"; shift ;;
    *) echo "ERRORE: argomento sconosciuto: $1" >&2; exit 1 ;;
  esac
  shift
done

for cmd in git makepkg sha256sum curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERRORE: serve '$cmd' nel PATH." >&2; exit 1; }
done
if [[ "$(id -u)" -eq 0 ]]; then
  echo "ERRORE: makepkg non gira da root: esegui lo script da un utente normale." >&2
  exit 1
fi

field() { grep -m1 -E "^$1=" "${SRC_DIR}/PKGBUILD" | cut -d= -f2- | tr -d "\"' "; }
PKGVER="$(field pkgver)"
PKGREL="$(field pkgrel)"
URL="$(field url)"
NAME="xmap-studio-${PKGVER}-linux-x86_64.tar.gz"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BUILD_DIR="$WORK/build"
REPO_DIR="$WORK/repo"
mkdir -p "$BUILD_DIR"
cp "${SRC_DIR}/PKGBUILD" "${SRC_DIR}/xmap-studio.sh" "$BUILD_DIR/"

if [[ -n "$TARBALL" ]]; then
  cp "$TARBALL" "$BUILD_DIR/$NAME"
else
  echo "Scarico ${URL}/releases/download/v${PKGVER}/${NAME}"
  curl -fsSL --retry 5 --retry-all-errors -o "$BUILD_DIR/$NAME" \
    "${URL}/releases/download/v${PKGVER}/${NAME}"
fi

SUM_TARBALL="$(sha256sum "$BUILD_DIR/$NAME" | cut -d' ' -f1)"
SUM_LAUNCHER="$(sha256sum "$BUILD_DIR/xmap-studio.sh" | cut -d' ' -f1)"
sed -i -E "s/^sha256sums=.*/sha256sums=('${SUM_TARBALL}'\n            '${SUM_LAUNCHER}')/" "$BUILD_DIR/PKGBUILD"

if [[ "$BUILD" -eq 1 ]]; then
  echo "Prova di makepkg (pacchetto non installato)…"
  (cd "$BUILD_DIR" && makepkg --force --nodeps --noconfirm)
fi
(cd "$BUILD_DIR" && makepkg --printsrcinfo > .SRCINFO)

git -c init.defaultBranch=master clone -q "$AUR_REPO" "$REPO_DIR"
cp "$BUILD_DIR/PKGBUILD" "$BUILD_DIR/.SRCINFO" "$BUILD_DIR/xmap-studio.sh" "$REPO_DIR/"
cd "$REPO_DIR"
git add PKGBUILD .SRCINFO xmap-studio.sh
if git diff --cached --quiet; then
  echo "AUR è già aggiornato a ${PKGVER}-${PKGREL}: niente da pubblicare."
  exit 0
fi
git commit -q -m "Update to ${PKGVER}-${PKGREL}"
git --no-pager show --stat HEAD

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "--dry-run: niente push. PKGBUILD generato:"
  cat PKGBUILD
  exit 0
fi
git push origin HEAD:master
echo "Pubblicato xmap-studio-bin ${PKGVER}-${PKGREL}: https://aur.archlinux.org/packages/xmap-studio-bin"
