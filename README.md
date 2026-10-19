<p align="center">
  <img src="assets/icon-512.png" width="160" alt="Icona di XMap Studio">
</p>

<h1 align="center">XMap Studio</h1>

<p align="center">
  <strong>Le tue mappe XMind, senza i limiti di XMind gratuito.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licenza-MIT-3b6cf6" alt="Licenza MIT"></a>
  <img src="https://img.shields.io/badge/piattaforme-Linux%20%C2%B7%20Windows%20%C2%B7%20Web-24252b" alt="Linux, Windows, Web">
</p>

---

Apri un file `.xmind`, modificalo direttamente sulla mappa e salvalo:
**XMind lo riapre identico**. Niente account, niente telemetria.

- **Formule LaTeX native.** Trasformi un blocco in una formula: in XMind appare
  renderizzata e, cliccandoci sopra, si riapre il suo editor equazioni.
- **Modifichi sulla mappa, come in XMind.** Testo nel blocco, `Tab` e `Invio`
  per nuovi blocchi, trascinamento, relazioni, sommari, note e immagini.
- **Stampi su A4 e A3.** Su un foglio solo o su più fogli da affiancare, e nel
  desktop salvi anche in PDF.
- **Non perdi niente.** Ogni salvataggio viene controllato prima di scrivere su
  disco e lascia un backup; se XMind ha il file aperto, il salvataggio si ferma.

## Installa

Scarica l'**AppImage** (Linux) o l'**exe portable** (Windows) dalle
[Release](https://github.com/JoelShepard/xmap-studio/releases).

Su Arch Linux:

```bash
git clone https://github.com/JoelShepard/xmap-studio.git
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
