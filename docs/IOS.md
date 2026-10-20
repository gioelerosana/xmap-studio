# App iOS / iPadOS

`apps/ios` è un wrapper nativo **sottile**: un'app SwiftUI con un `WKWebView` che
mostra la stessa UI web di `apps/web`, servita dal bundle con uno scheme handler
(`app://localhost/`, `AppSchemeHandler.swift`). Niente rete, niente telemetria.

Si compila **da Linux** con [xtool](https://github.com/xtool-org/xtool) (nessun Mac),
firmando con un Apple ID gratuito: l'app installata scade dopo **7 giorni** e va
reinstallata; max 3 app per dispositivo. TestFlight/App Store richiedono invece un
Apple Developer Program a pagamento (e un runner macOS o un Mac per l'archivio).

## Prerequisiti (una tantum)

1. **Swift 6.4** (`swiftly install 6.4.1`). Su Arch servono `libncurses.so.6` e
   `libxml2.so.2`, che la distro non fornisce: link simbolici in una cartella
   utente + `LD_LIBRARY_PATH` (vedi sotto).
2. **usbmuxd** attivo e iPad collegato, con *Modalità sviluppatore* acceso
   (Impostazioni → Privacy e sicurezza).
3. **xtool** (AppImage in `~/.local/bin/xtool`).
4. **Xcode 27 `.xip`** da <https://developer.apple.com/download/all/?q=Xcode>
   (login Apple ID nel browser + licenza): xtool ne ricava l'SDK iOS.
5. `xtool setup`: login (modalità *Password* per Apple ID gratuito, con 2FA) e
   percorso dell'`.xip`.

```bash
. ~/.local/share/swiftly/env.sh
export LD_LIBRARY_PATH=$HOME/.local/lib/swift-shim   # libncurses.so.6, libxml2.so.2
```

## Compilare e installare

```bash
apps/ios/scripts/prepare-web.sh   # pnpm build + copia dist in apps/ios/web
cd apps/ios
xtool dev                         # build, firma, installa sull'iPad collegato
```

Al primo avvio: Impostazioni → Generali → Gestione VPN e dispositivo → fidati del
tuo Apple ID.

## Limiti attuali

- Il salvataggio passa dal ripiego web: ogni «Salva» scarica un nuovo file e apre
  «Salva in File» (`WebCoordinator.swift`); non c'è scrittura in-place.
- Nessun service worker (non serve: le risorse sono nel bundle).
- Non verificato su dispositivo finché l'SDK iOS non è installato con `xtool setup`.
