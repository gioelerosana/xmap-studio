# Release

## Versioning

Il progetto segue [SemVer](https://semver.org/lang/it/). La versione vive in un
unico punto:

- `src-tauri/Cargo.toml` → campo `version` del package `xmind-equation-studio`.

Da lì viene letta da `xtask` per il nome dell'AppImage
(`XMind_Equation_Studio-<versione>-x86_64.AppImage`) e compilata in
`env!("CARGO_PKG_VERSION")` (usata nella finestra "Informazioni" e nella cache
del renderer). Non duplicare la versione altrove.

## Checklist

1. Aggiorna `version` in `src-tauri/Cargo.toml` (e `Cargo.lock` di conseguenza:
   `cargo update -p xmind-equation-studio --precise <versione>` oppure build).
2. Aggiorna il `README.md` se cambiano stack, architettura o limiti noti.
3. `cargo fmt && cargo clippy --all-targets` — deve essere pulito.
4. `cargo test` — tutti verdi (o skip correttamente motivati).
5. `cargo xtask appimage` — produce l'AppImage in `dist/`.
6. Collauda l'AppImage su una macchina con GTK4/libadwaita e `node`.
7. Commit, tag annotato e push:

   ```bash
   git add -A
   git commit -m "Release v<versione>"
   git tag -a v<versione> -m "v<versione>"
   git push origin HEAD
   git push origin v<versione>
   ```

8. Crea la release sul repository GitLab e allega l'AppImage da `dist/`.

## Artefatti

| Artefatto | Percorso | Distribuito |
|---|---|---|
| Binario di release | `target/release/xmind-equation-studio` | no |
| AppImage | `dist/XMind_Equation_Studio-<versione>-x86_64.AppImage` | sì |

`dist/` è in `.gitignore`: gli artefatti **non** finiscono nel repository, ma
vanno allegati alla release GitLab.

## Nota sulle dipendenze dell'AppImage

L'AppImage non include GTK4/libadwaita né Node: vanno presenti sul sistema
dell'utente. Per un bundle autosufficiente si può aggiungere `linuxdeploy` con il
plugin GTK/doc, valutando l'aumento di dimensione.
