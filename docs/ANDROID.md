# App Android

`apps/android` è un wrapper nativo **sottile**, gemello di quello iOS
([`IOS.md`](IOS.md)): una sola `Activity` Java con un `WebView` a tutto schermo che
mostra la stessa UI di `apps/web`. La build web è negli asset dell'APK e si serve
sotto `https://appassets.androidplatform.net/` (dominio riservato da Android a
questo uso) da `shouldInterceptRequest`: niente rete, niente permessi, niente
telemetria, niente dipendenze AndroidX.

## Compilare

Non serve Gradle né Android Studio: `apps/android/scripts/build-apk.sh` chiama
direttamente i build-tools (aapt2 → javac → d8 → zipalign → apksigner).

Prerequisiti:

- JDK 17 o più recente (`javac`, `keytool`), `zip`, Node e pnpm;
- SDK Android in `$ANDROID_HOME` (default `~/Android/Sdk`) con
  `platforms/android-35` e un `build-tools/` recente (testato con 35.0.1).
  Bastano gli zip di `https://dl.google.com/android/repository/`
  (`platform-35_r02.zip`, `build-tools_r35.0.1_linux.zip`) scompattati in
  `platforms/android-35` e `build-tools/35.0.1`;
- su **aarch64** i binari nativi dei build-tools (aapt2, zipalign) sono solo
  x86_64: servono **box64** (`apt install box64`, che registra anche il binfmt) o
  le variabili `AAPT2`/`ZIPALIGN`. L'aapt2 delle distro (Debian/Ubuntu 2.19) non
  legge l'`android.jar` 35.

```bash
ANDROID_HOME=~/android-sdk apps/android/scripts/build-apk.sh             # pnpm build + APK
ANDROID_HOME=~/android-sdk apps/android/scripts/build-apk.sh --skip-web  # riusa apps/web/dist
```

L'APK esce in `apps/android/build/xmap-studio-<versione>-<n>.apk`:
`versionName` dal `package.json` della radice, `versionCode` = numero di commit.

Firma: senza variabili si crea (una volta) una chiave di debug in
`~/.android/xmap-studio-debug.keystore`; tenerla uguale permette di aggiornare
l'app installata senza disinstallarla. Per un'altra chiave: `ANDROID_KEYSTORE`,
`ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`.

## Installare

Copia l'APK sul telefono e aprilo (consenti «installa app sconosciute» all'app
con cui lo apri), oppure `adb install -r <apk>`. Android ≥ 8 (minSdk 26).

## Come funziona

- **Apri**: l'`<input type=file>` della pagina apre il selettore di sistema
  (`ACTION_OPEN_DOCUMENT`, filtro `*/*` perché `.xmind` non ha un tipo MIME
  noto ad Android).
- **Salva / Esporta**: nel WebView un download da `blob:` non arriva a nessuno,
  quindi `downloadBlob` (`apps/web/src/adapters/fileSystem.ts`) passa i byte in
  base64 a `window.xmapAndroid.saveFile` (`apps/web/src/app/androidBridge.ts`);
  l'app apre «Salva come» (`ACTION_CREATE_DOCUMENT`) e scrive il file. La
  validazione dell'archivio avviene prima, nella pagina, come sul web.
- Barre di sistema: con targetSdk 35 l'app è edge-to-edge; il contenuto è tenuto
  fuori da status bar, barra di navigazione e tastiera con un padding.
- Indietro: torna nella cronologia del WebView; senza cronologia chiede
  conferma prima di uscire.
- Il service worker non si registra (`main.tsx`): le risorse sono già nell'APK.
- I link esterni si aprono nel browser.

## Limiti attuali

- Come su iOS, «Salva» non riscrive il file aperto: apre sempre «Salva come»
  (niente scrittura in-place sull'URI del documento). La mappa risulta salvata
  anche se poi si annulla il selettore.
- Non si apre un `.xmind` da un file manager («Apri con»): si parte dall'app.
- Il cambio tema chiaro/scuro di sistema con l'app aperta si applica al
  riavvio (l'Activity non viene ricreata, per non perdere la mappa aperta).
- Prima build non ancora provata su dispositivo né in emulatore (host aarch64
  senza KVM): verificati solo l'APK (firma v2/v3, manifest, asset) e il ponte di
  salvataggio nel browser con un `xmapAndroid` simulato.
