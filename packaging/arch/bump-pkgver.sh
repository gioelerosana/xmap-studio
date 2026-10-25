#!/usr/bin/env bash
#
# packaging/arch/bump-pkgver.sh
#
# Gestisce e verifica la versione (pkgver) di packaging/arch/release/PKGBUILD.
#
# Uso:
#   ./bump-pkgver.sh          # Allinea pkgver alla versione in apps/desktop/package.json e imposta pkgrel=1
#   ./bump-pkgver.sh X.Y.Z    # Imposta pkgver=X.Y.Z e azzera pkgrel=1 (rigenera anche .SRCINFO)
#   ./bump-pkgver.sh --check  # Verifica che pkgver corrisponda alla versione di apps/desktop/package.json (esce con 0 o 1)
#
# Manutenzione pkgrel:
#   Se si apportano modifiche esclusivamente ai file di packaging (es. launcher, dipendenze,
#   desktop entry) per la medesima versione di rilascio, incrementare a mano pkgrel in
#   packaging/arch/release/PKGBUILD (es. pkgrel=2) senza modificare pkgver.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." &>/dev/null && pwd)"
RELEASE_PKGBUILD="${SCRIPT_DIR}/release/PKGBUILD"
DESKTOP_PKG_JSON="${REPO_ROOT}/apps/desktop/package.json"

SEMVER_REGEX='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

if [[ ! -f "${RELEASE_PKGBUILD}" ]]; then
  echo "ERRORE: File non trovato: ${RELEASE_PKGBUILD}" >&2
  exit 1
fi

get_desktop_version() {
  if [[ ! -f "${DESKTOP_PKG_JSON}" ]]; then
    echo "ERRORE: File non trovato: ${DESKTOP_PKG_JSON}" >&2
    exit 1
  fi
  if command -v node >/dev/null 2>&1; then
    node -p "require('${DESKTOP_PKG_JSON}').version"
  else
    grep -m1 '"version":' "${DESKTOP_PKG_JSON}" | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/'
  fi
}

get_pkgbuild_pkgver() {
  grep -E '^pkgver=' "${RELEASE_PKGBUILD}" | head -n1 | cut -d= -f2- | tr -d ' "'"' "
}

get_pkgbuild_pkgrel() {
  grep -E '^pkgrel=' "${RELEASE_PKGBUILD}" | head -n1 | cut -d= -f2- | tr -d ' "'"' "
}

# Modalità --check
if [[ "${1:-}" == "--check" ]]; then
  CURRENT_PKGVER="$(get_pkgbuild_pkgver)"
  DESKTOP_VER="$(get_desktop_version)"

  if [[ "${CURRENT_PKGVER}" != "${DESKTOP_VER}" ]]; then
    echo "ERRORE: disallineamento versione!" >&2
    echo "  packaging/arch/release/PKGBUILD (pkgver): ${CURRENT_PKGVER}" >&2
    echo "  apps/desktop/package.json (version):      ${DESKTOP_VER}" >&2
    echo "Eseguire 'packaging/arch/bump-pkgver.sh' per allineare il release PKGBUILD." >&2
    exit 1
  fi

  echo "OK: packaging/arch/release/PKGBUILD (pkgver=${CURRENT_PKGVER}) è allineato con apps/desktop/package.json (${DESKTOP_VER})."
  exit 0
fi

# Modalità aggiornamento: versione specificata o letta da package.json
if [[ $# -ge 1 ]]; then
  TARGET_VER="$1"
else
  TARGET_VER="$(get_desktop_version)"
fi

# Validazione SemVer
if [[ ! "${TARGET_VER}" =~ ${SEMVER_REGEX} ]]; then
  echo "ERRORE: Versione non valida: '${TARGET_VER}'." >&2
  echo "La versione deve essere in formato SemVer X.Y.Z (es. 0.1.0, 1.2.3, senza prefisso 'v')." >&2
  exit 1
fi

OLD_PKGVER="$(get_pkgbuild_pkgver)"
OLD_PKGREL="$(get_pkgbuild_pkgrel)"

# Sostituzione in packaging/arch/release/PKGBUILD
sed -i -E "s/^pkgver=.*/pkgver=${TARGET_VER}/" "${RELEASE_PKGBUILD}"
sed -i -E "s/^pkgrel=.*/pkgrel=1/" "${RELEASE_PKGBUILD}"

echo "Aggiornato ${RELEASE_PKGBUILD}:"
echo "  pkgver: ${OLD_PKGVER} -> ${TARGET_VER}"
echo "  pkgrel: 1 (precedente: ${OLD_PKGREL})"

# .SRCINFO è versionato accanto al PKGBUILD: va rigenerato a ogni modifica.
if command -v makepkg >/dev/null 2>&1; then
  (cd "${SCRIPT_DIR}/release" && makepkg --printsrcinfo > .SRCINFO)
  echo "Rigenerato ${SCRIPT_DIR}/release/.SRCINFO"
else
  # Senza makepkg (es. runner CI Ubuntu) si aggiornano a testo i soli campi che
  # dipendono dalla versione: pkgver, pkgrel e il tag nella source git.
  SRCINFO="${SCRIPT_DIR}/release/.SRCINFO"
  sed -i -E \
    -e "s/^(\tpkgver = ).*/\1${TARGET_VER}/" \
    -e "s/^(\tpkgrel = ).*/\11/" \
    -e "s/(#tag=v)[0-9]+\.[0-9]+\.[0-9]+/\1${TARGET_VER}/" \
    "${SRCINFO}"
  echo "Aggiornato ${SRCINFO} (makepkg non trovato: solo pkgver, pkgrel e tag)"
fi
