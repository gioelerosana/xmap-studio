#!/usr/bin/env bash
# Compila la UI web e ne copia la build in apps/ios/web, da cui xtool la include nel bundle.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"

(cd "$root" && pnpm build)
rm -rf "$here/web"
cp -r "$root/apps/web/dist" "$here/web"
echo "Build web copiata in $here/web"
