# Test

## Workspace TypeScript

```bash
pnpm test
pnpm build
```

`pnpm test` esegue i test del core con Vitest. Al momento coprono round-trip su
`demo/Relazioni.xmap-studio.xmind`, applicazione/rimozione LaTeX, undo/redo,
export, layout, task, import e gli invarianti di parità elencati in
[`TS-MIGRATION-PARITY.md`](TS-MIGRATION-PARITY.md).

Le operazioni nuove o corrette vanno coperte in `packages/core/tests/` con
archivi creati in memoria. Per il formato `.xmind`, verificare almeno:

- round-trip senza modifiche con campi sconosciuti;
- `content.json`, `manifest.json`, risorse e allegati;
- errore prima della scrittura quando un riferimento manca;
- hash PNG uguale al nome `resources/<sha256>.png`;
- batch atomico e undo/redo;
- conflitto su file cambiato dall'apertura.

## Riferimento Rust

Il vecchio backend si verifica con:

```bash
cargo fmt --all -- --check
cargo test --workspace
```

I test E2E Rust usano le fixture incluse; i test che dipendono da risorse
esterne possono auto-saltarsi con un messaggio.

## Verifica in XMind

La validazione automatica non prova il parser XMind reale. Prima di dichiarare
conclusa una modifica allo schema, aprire in XMind un `.xmind` generato, provare
a modificare l'equazione e verificare note/allegati quando coinvolti. In
particolare, l'audit TS richiede ancora la verifica manuale di un file con
allegato e di un ramo ottenuto da split.
