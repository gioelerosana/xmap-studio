# Test

## Workspace TypeScript

```bash
pnpm test
pnpm build
```

`pnpm test` esegue i test del core con Vitest. Al momento coprono round-trip su
`demo/Relazioni.xmap-studio.xmind`, applicazione/rimozione LaTeX, undo/redo,
export, layout, task, import e gli invarianti dell'archivio
(`archive-invariants.test.ts`: allegati, split, relazioni, marker, batch
atomico, conflitto su file modificato).

Le operazioni nuove o corrette vanno coperte in `packages/core/tests/` con
archivi creati in memoria. Per il formato `.xmind`, verificare almeno:

- round-trip senza modifiche con campi sconosciuti;
- `content.json`, `manifest.json`, risorse e allegati;
- errore prima della scrittura quando un riferimento manca;
- hash PNG uguale al nome `resources/<sha256>.png`;
- batch atomico e undo/redo;
- conflitto su file cambiato dall'apertura.

## Verifica in XMind

La validazione automatica non prova il parser XMind reale. Prima di dichiarare
conclusa una modifica allo schema, aprire in XMind un `.xmind` generato, provare
a modificare l'equazione e verificare note/allegati quando coinvolti. In
particolare, resta da verificare a mano un file con allegato e un ramo
ottenuto da split.

## Limiti noti della verifica

- Il browser non può rilevare i processi XMind del sistema: il blocco del
  salvataggio e la forzatura esplicita esistono solo nell'app Electron.
- Non ci sono test automatizzati di interazione UI.
