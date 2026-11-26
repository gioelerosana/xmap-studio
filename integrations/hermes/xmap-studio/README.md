# XMap Studio Hermes Connector

Plugin di [Hermes Agent](https://github.com/NousResearch/hermes-agent) che
permette all'agente di leggere e modificare la mappa mentale aperta in
[XMap Studio](https://github.com/gioelerosana/xmap-studio), anche quando il
gateway di Hermes gira su un server remoto. Il ponte è Hermes Desktop, già
collegato e autenticato con il gateway: niente tunnel né porte aperte.

> Questo repository è una copia generata: il codice vive in
> [`integrations/hermes/xmap-studio`](https://github.com/gioelerosana/xmap-studio/tree/main/integrations/hermes/xmap-studio)
> di XMap Studio e viene sincronizzato a ogni modifica. Issue e PR vanno lì.

## Installazione

Con Hermes Desktop aperto, usa il link (oppure il pulsante **Installa in Hermes
Desktop** in XMap Studio › Impostazioni › Integrazioni › Hermes):

```
hermes://plugin/install?repo=gioelerosana/xmap-studio-hermes-connector&enable=1
```

Hermes mostra una finestra di conferma e installa le due metà: quella agente sul
gateway (anche remoto) e quella desktop sul computer. In alternativa:
**Capabilities → Plugins → Install from Git** con questo repository.

## Accoppiamento

1. In XMap Studio: **Impostazioni › Integrazioni › Hermes**, accendi **Collega a Hermes** e copia il token.
2. In Hermes Desktop: **Impostazioni → Plugin → XMap Studio**, inserisci porta
   (47615) e token, **Salva**.
3. In una chat nuova: «leggi la mappa aperta in XMap».

I tool si chiamano `xmap_read_map`, `xmap_add_topics`, … e lavorano sulla mappa
aperta: ogni modifica si annulla con Ctrl+Z e niente viene salvato su disco
finché non lo chiedi. Funziona dalle chat di Hermes Desktop, non da Telegram o
dall'API del gateway.

Guida completa, diagnostica e sicurezza:
[`integrations/hermes/README.md`](https://github.com/gioelerosana/xmap-studio/blob/main/integrations/hermes/README.md).

Licenza MIT.
