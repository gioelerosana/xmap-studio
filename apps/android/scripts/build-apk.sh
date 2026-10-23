#!/usr/bin/env bash
# Compila l'APK Android senza Gradle: aapt2 (risorse) → javac → d8 (dex) → zipalign → apksigner.
# Uso: apps/android/scripts/build-apk.sh [--skip-web]
#   --skip-web  riusa apps/web/dist invece di rieseguire `pnpm build`
# Variabili: ANDROID_HOME (SDK con platforms/android-35 e build-tools), AAPT2 e ZIPALIGN
#   (binari alternativi: quelli di Google sono solo x86_64), ANDROID_KEYSTORE,
#   ANDROID_KEYSTORE_PASS, ANDROID_KEY_ALIAS (firma; di default una chiave di debug locale).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$here/build"

platform=35
min_sdk=26

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
android_jar="$sdk/platforms/android-$platform/android.jar"
[[ -f "$android_jar" ]] || { echo "Manca $android_jar (installa platforms;android-$platform)" >&2; exit 1; }
build_tools="$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)"
[[ -n "$build_tools" && -f "$build_tools/lib/d8.jar" ]] || { echo "Mancano i build-tools in $sdk" >&2; exit 1; }

# I binari dei build-tools di Google sono solo x86_64: altrove si eseguono con box64
# (l'aapt2 delle distro è spesso troppo vecchio per l'android.jar recente).
# Imposta nell'array $2 il comando da usare.
native_tool() {
  local name="$1" override="$2" rc=0
  local -n cmd="$3"
  if [[ -n "$override" ]]; then cmd=("$override"); return; fi
  "$build_tools/$name" >/dev/null 2>&1 || rc=$?
  # 126/127: architettura sbagliata o binario assente; ogni altro codice è un'uscita del tool.
  if [[ $rc -ne 126 && $rc -ne 127 ]]; then cmd=("$build_tools/$name"); return; fi
  if command -v box64 >/dev/null; then cmd=(box64 "$build_tools/$name"); return; fi
  echo "$name dei build-tools non eseguibile su $(uname -m): installa box64 o imposta ${name^^}" >&2
  exit 1
}
native_tool aapt2 "${AAPT2:-}" aapt2
native_tool zipalign "${ZIPALIGN:-}" zipalign

version_name="$(node -p "require('$root/package.json').version")"
version_code="$(git -C "$root" rev-list --count HEAD)"

if [[ "${1:-}" != "--skip-web" ]]; then
  (cd "$root" && pnpm build)
fi
[[ -f "$root/apps/web/dist/index.html" ]] || { echo "Build web mancante: esegui pnpm build" >&2; exit 1; }

rm -rf "$out"
mkdir -p "$out/assets" "$out/classes" "$out/dex"
cp -r "$root/apps/web/dist" "$out/assets/web"

echo "→ risorse (${aapt2[*]})"
"${aapt2[@]}" compile --dir "$here/src/main/res" -o "$out/res.zip"
"${aapt2[@]}" link -o "$out/unsigned.apk" \
  -I "$android_jar" \
  --manifest "$here/src/main/AndroidManifest.xml" \
  --min-sdk-version "$min_sdk" --target-sdk-version "$platform" \
  --version-code "$version_code" --version-name "$version_name" \
  -A "$out/assets" \
  "$out/res.zip"

echo "→ java"
find "$here/src/main/java" -name '*.java' > "$out/sources.txt"
javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 \
  -bootclasspath "$android_jar:$build_tools/core-lambda-stubs.jar" -d "$out/classes" @"$out/sources.txt"

echo "→ dex"
find "$out/classes" -name '*.class' > "$out/classes.txt"
java -cp "$build_tools/lib/d8.jar" com.android.tools.r8.D8 --release \
  --min-api "$min_sdk" --lib "$android_jar" --output "$out/dex" @"$out/classes.txt"
(cd "$out/dex" && zip -q "$out/unsigned.apk" classes.dex)

"${zipalign[@]}" -f -p 4 "$out/unsigned.apk" "$out/aligned.apk"

keystore="${ANDROID_KEYSTORE:-$HOME/.android/xmap-studio-debug.keystore}"
pass="${ANDROID_KEYSTORE_PASS:-android}"
alias="${ANDROID_KEY_ALIAS:-xmapdebug}"
if [[ ! -f "$keystore" ]]; then
  echo "→ creo la chiave di debug $keystore"
  mkdir -p "$(dirname "$keystore")"
  keytool -genkeypair -keystore "$keystore" -storepass "$pass" -keypass "$pass" -alias "$alias" \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=XMap Studio Debug" >/dev/null
fi

apk="$out/xmap-studio-$version_name-$version_code.apk"
java -jar "$build_tools/lib/apksigner.jar" sign --ks "$keystore" --ks-pass "pass:$pass" \
  --ks-key-alias "$alias" --out "$apk" "$out/aligned.apk"
java -jar "$build_tools/lib/apksigner.jar" verify "$apk"
echo "APK: $apk"
