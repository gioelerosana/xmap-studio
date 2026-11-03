# Sito di presentazione

Il sito del progetto è **https://xmap-studio.jshep.xyz**: una landing page
statica (italiano in `/`, inglese in `/en/`) che presenta l'app e rimanda
all'app web (`xmap.jshep.xyz`), alle release e ad AUR. Non è l'app: quella resta
su Cloudflare ([`DEPLOY.md`](DEPLOY.md)).

## File

Tutto in [`site/`](../site), HTML e CSS scritti a mano, senza build né
dipendenze:

| File | Ruolo |
|---|---|
| `index.html`, `en/index.html` | pagine italiana e inglese (stessa struttura: modificale insieme) |
| `style.css` | stili; token copiati da `packages/ui-kit/src/theme.css`, tema chiaro/scuro da `prefers-color-scheme` |
| `img/` | icona, screenshot della mappa demo (`.webp` chiaro/scuro, `.jpg` di ripiego), anteprima social `og.jpg` 1200×630 |
| `robots.txt`, `sitemap.xml` | indicizzazione |
| `CNAME` | dominio personalizzato di GitHub Pages |
| `404.html` | pagina di errore (`noindex`) |

## Pubblicazione

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) pubblica la
cartella `site/` su GitHub Pages a ogni push su `main` che tocca `site/` (o a
mano con `workflow_dispatch`).

Setup una tantum:

1. **GitHub** → Settings → Pages → Source: **GitHub Actions**; poi in Custom
   domain `xmap-studio.jshep.xyz` e, quando il certificato è pronto,
   **Enforce HTTPS**.
2. **Cloudflare** (zona `jshep.xyz`) → DNS: record `CNAME` `xmap-studio` →
   `gioelerosana.github.io`, **solo DNS** (nuvola grigia). Con il proxy attivo
   GitHub non riesce a emettere il certificato.
3. Facoltativo: verificare il dominio su GitHub (Settings → Pages → Add a
   verified domain, record `TXT`) per impedire che un altro account lo usi.

## Indicizzazione

Ogni pagina ha `title` e `description` propri, `canonical`, `hreflang`
(it/en, `x-default` sull'inglese), Open Graph, dati strutturati JSON-LD
`SoftwareApplication` e immagini con `alt` e dimensioni. Dopo il primo deploy:

- [Google Search Console](https://search.google.com/search-console): aggiungere
  la proprietà di dominio `jshep.xyz` (record `TXT` su Cloudflare) o il prefisso
  `https://xmap-studio.jshep.xyz/`, inviare `sitemap.xml` e chiedere
  l'indicizzazione delle due pagine;
- [Bing Webmaster Tools](https://www.bing.com/webmasters): importare la
  proprietà da Search Console (copre anche DuckDuckGo ed Ecosia);
- controllare i dati strutturati con il
  [Rich Results Test](https://search.google.com/test/rich-results).

Aggiungendo una pagina, aggiornare `sitemap.xml` e i link `hreflang`.

## Screenshot

Gli screenshot vengono dall'app web con la mappa demo (pulsante «Demo»), a
1440×900 con fattore 2, in tema chiaro e scuro; poi ridotti a 1600 px di
larghezza (`magick … -resize 1600x -quality 82 …webp`).
