<!--
Una PR = un problema = un commit logico su `main`. Se la descrizione ha bisogno
di due paragrafi di "e inoltre", spezza la PR. Titolo in Conventional Commits,
tipo in inglese e descrizione in italiano che dice l'effetto per l'utente:
`fix(save): evita backup duplicati nello stesso secondo`.
Il merge non rilascia nulla: la release la lancia l'utente a mano.
-->

## Problema

<!-- Cosa non va o cosa manca, visto dall'utente. Una o due frasi; link a issue o task se esistono. -->

## Cambiamento

<!--
Cosa fa questa PR e perché la soluzione è questa. Non rielencare i file: dillo
a parole, e segnala le scelte non ovvie e le alternative scartate.
-->

## Verifica

<!--
Comandi eseguiti e risultato (`pnpm build`, `pnpm test`, ...).
Per modifiche alla UI: screenshot o video prima/dopo e quale anteprima hai
guardato (link dell'anteprima Cloudflare nel commento della PR, `pnpm dev:web`,
`pnpm dev:desktop`, `pnpm dev:tailnet` da telefono).
Scrivi anche cosa NON hai verificato: meglio un limite dichiarato che uno nascosto.
-->

## Tipo e note per la release

<!--
- Tipo scelto dall'utente: `fix` o `feat` (o altro). Se non indicato, quello che
  hai usato nel titolo e perché.
- Se tocca il formato `.xmind` o il salvataggio: dillo qui e indica se hai
  verificato in XMind che un file salvato dall'app si apre senza errori
  (AGENTS.md › "Definizione di fatto", punto 4).
-->

- Tipo: 
- Tocca formato `.xmind` o salvataggio: no / sì (verificato in XMind: sì / no)

<!-- Solo se un agente AI ha scritto la PR: modello e harness, ad es. "Claude Sonnet 5.5 · Claude Code". -->
Scritta con: 
