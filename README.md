<p align="center">
  <img src="assets/icon-512.png" width="160" alt="Icona di XMap Studio">
</p>

<h1 align="center">XMap Studio</h1>

<p align="center">
  <strong>Mappe mentali belle, accurate e libere. Open source, compatibili con XMind.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licenza-MIT-3b6cf6" alt="Licenza MIT"></a>
  <img src="https://img.shields.io/badge/piattaforme-Linux%20%C2%B7%20Windows%20%C2%B7%20Web-24252b" alt="Linux, Windows, Web">
</p>

---

XMap Studio è un'alternativa libera e open source a XMind, pensata per creare
mappe curate: belle da vedere, precise nel contenuto, sicure da salvare. Usa il
formato `.xmind`, quindi le tue mappe XMind si aprono qui e quelle create qui si
aprono anche in XMind. Niente account, niente telemetria.

- **Mappe curate.** Temi, colori, forme e tipografia per mappe gradevoli, con
  un layout ordinato.
- **Formule LaTeX native.** Trasformi un blocco in una formula, resa con
  MathJax; anche in XMind appare renderizzata e resta modificabile.
- **Modifichi sulla mappa.** Testo nel blocco, `Tab` e `Invio` per nuovi
  blocchi, trascinamento, relazioni, sommari, note e immagini.
- **Mappe a più fogli.** Una mappa può avere fogli extra, come le linguette di un
  foglio di calcolo: li aggiungi, rinomini, duplichi, sposti ed elimini dalla
  barra in basso.
- **Stampi su A4 e A3.** Su un foglio solo o su più fogli da affiancare, e nel
  desktop salvi anche in PDF.
- **Non perdi niente.** Ogni salvataggio viene controllato prima di scrivere su
  disco e lascia un backup; se XMind ha il file aperto, il salvataggio si ferma.

## Provala online

La versione web è su **[xmap.jshep.xyz](https://xmap.jshep.xyz)**: gira tutta nel
browser, i file restano sul tuo dispositivo, e si può installare come app (PWA) e
usare offline.

## Installa

Per il desktop scarica l'**AppImage** (Linux) o l'**exe portable** (Windows) dalle
[Release](https://github.com/gioelerosana/xmap-studio/releases).

Su Arch Linux:

```bash
git clone https://github.com/gioelerosana/xmap-studio.git
cd xmap-studio/packaging/arch/release && makepkg -si
```

## Sviluppo

```bash
pnpm install
pnpm dev:desktop    # app desktop
pnpm dev:web        # versione web su http://localhost:3000
pnpm test
```

Documentazione tecnica in [`docs/`](docs/README.md), regole per chi contribuisce
in [`AGENTS.md`](AGENTS.md).

## Licenza

[MIT](LICENSE)
