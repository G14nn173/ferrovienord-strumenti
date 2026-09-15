# FERROVIENORD — Mappa interattiva V1 portabile

La versione pronta all'uso si trova nella cartella `portable`.

## Avvio

Fare doppio clic su `portable\Avvia Mappa.cmd`.

Il launcher apre la web app nel browser predefinito e avvia un piccolo server
esclusivamente locale. La finestra del launcher deve restare aperta durante
l'utilizzo; per terminare basta chiuderla o premere `Ctrl+C`.

Non sono richiesti Node.js, npm, installazioni o accesso a Internet.

## Contenuto

- `index.html`: pagina della web app;
- `styles.css`: interfaccia e layout responsive;
- `app.js`: logica della mappa e delle interazioni;
- `network-data.json`: dati locali della rete;
- `server.ps1`: server HTTP confinato a `127.0.0.1`;
- `Avvia Mappa.cmd`: launcher Windows;
- `LEGGIMI.txt`: istruzioni per l'utente finale.

Il progetto React/TypeScript importato dallo ZIP è stato conservato nella
cartella principale come riferimento per gli sviluppi successivi.

## Anomalie da Excel

Il pulsante `Importa anomalie` accetta file `.xlsx` e `.xltx` senza richiedere
Excel o una connessione Internet. La colonna N identifica stazioni e tratte,
mentre la colonna B identifica univocamente gli avvisi. La modalità anomalie
colora gli elementi dal verde al porpora in base al numero di eventi e rende
disponibile un popup con il dettaglio di ogni avviso.
