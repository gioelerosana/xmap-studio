# Test

## Comandi

```bash
cargo test                    # tutto: 30 unit + 2 end-to-end
cargo test --lib              # solo i test unitari (dentro src/)
cargo test --test e2e_real_map
cargo test <nome_test>        # un singolo test
```

I test che richiedono risorse esterne si **auto-saltano** con un messaggio
(`eprintln!`) quando la risorsa non c'è, così la suite resta verde su qualsiasi
macchina. Non usare `#[ignore]`: il pattern del progetto è lo skip esplicito.

## Test unitari

Vivono in `#[cfg(test)] mod tests` negli stessi file che testano. Coprono le
invarianti che non possono rompersi.

| Area | File | Cosa garantisce |
|---|---|---|
| Round-trip del modello | `model.rs` | campo sconosciuti preservati, interi restano interi, traversal e lookup LaTeX |
| Archivio | `archive.rs` | SHA-256 noto, scrittura atomica + backup, round-trip delle entry ZIP |
| Validazione | `validate.rs` | risorsa mancante rifiutata, risorsa fuori manifest rifiutata, JSON invalido rifiutato, `refresh_manifest` |
| Equazione | `equation.rs` | rimozione pulita di extension/immagine, immagini normali intatte, LaTeX vuoto rifiutato prima del render |
| Stato/undo | `state.rs` | DTO con breadcrumb e kind, undo/redo, salvataggio che valida e preserva l'ignoto, conflitto vs `force` |
| Sicurezza | `safety.rs` | XMind Flatpak riconosciuto, la nostra app no, processo estraneo ignorato, conflitto su modifica file |
| Rendering | `mathjax.rs` | LaTeX valido → SVG con dimensioni attese; LaTeX invalido → `error`, non panic |
| Raster | `raster.rs` | dimensioni pixel = logiche × scala, `currentColor` risolto, SVG invalido → errore |
| Renderer incorporato | `renderer_assets.rs` | estrazione dell'archivio in cache |

`mathjax.rs` e `renderer_assets.rs` richiedono `resources/renderer` installato:
se manca, il test viene saltato.

## Test end-to-end

`src-tauri/tests/e2e_real_map.rs` usa una mappa **reale** (default:
`~/Nextcloud/Polimi/Logica e Algebra/Relazioni.xmind`, sovrascrivibile con
`XMIND_TEST_MAP`).

1. `round_trip_of_real_map_preserves_every_field` — deserializza e riserializza
   `content.json` di una mappa reale e verifica l'identità semantica.
2. `e2e_apply_save_validate_reopen` — apre una **copia** in una temp dir, applica
   un'equazione a una foglia di testo, salva con backup, valida, riapre e verifica:
   - la forma JSON esatta (`image` annidata, `isMathJaxImage`, extension MathJax);
   - che il nome risorsa sia lo SHA-256 del PNG, presente nello ZIP e nel manifest;
   - che la thumbnail sia stata rimossa;
   - che **tutti gli altri topic** e i campi sconosciuti (`revisionId`, `theme`, …)
     siano invariati;
   - che non compaiano chiavi flat (es. `imageSource`).

Il test copia sempre il file: non modifica mai la mappa originale.

## Verifica manuale in XMind

Il collaudo definitivo è aprire il file prodotto in XMind:

```bash
cargo run --example inject -- \
  "$XMIND_TEST_MAP" \
  demo/Relazioni.equation-studio.xmind \
  "Unione" 'A \cup B = B \iff A \subseteq B'
```

In XMind l'equazione deve apparire renderizzata; cliccandoci sopra si deve
riaprire l'editor equazioni nativo con il LaTeX corretto.

## Quando aggiungere un test

- Nuova regola di formato → test in `model.rs` o `validate.rs`.
- Nuovo percorso di errore → test che l'errore sia restituito, non un panic.
- Nuova operazione sul workbook → test in `state.rs` con un archivio fixture in
  memoria (vedi `fixture_bytes()` in `state.rs`).
- Modifica al salvataggio → il test E2E su mappa reale è la rete di sicurezza.
