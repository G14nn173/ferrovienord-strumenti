# FERROVIENORD — strumenti per la circolazione e la manutenzione

Due applicazioni web indipendenti, senza dipendenze e senza passo di build:
HTML, CSS e JavaScript serviti così come sono.

## [`bordo-treno/`](bordo-treno/) — Rilievi di bordo, Brescia · Iseo · Edolo

App installabile sul telefono (PWA) per i manutentori a bordo treno. Un tocco
registra la progressiva chilometrica e il cippo km del punto osservato, con
ora, posizione e una nota; a fine giro si esporta in Excel, CSV e GeoJSON.

Funziona senza campo. La progressiva si ancora ai **102 cippi chilometrici
georeferenziati** della linea e avanza per odometria sulla velocità del GPS fra
un cippo e l'altro, così le curve non falsano il calcolo. Misurato in
simulazione a 79 km/h: scarto di 0–2 m all'aggancio sui cippi, mediana 10 m fra
un cippo e l'altro.

Dettagli tecnici, fonti dei dati e verifiche in **[BORDO-TRENO.md](BORDO-TRENO.md)**;
istruzioni per chi la usa in [`bordo-treno/LEGGIMI.txt`](bordo-treno/LEGGIMI.txt).

## [`portable/`](portable/) — Mappa interattiva della rete

Località e tratte della rete FERROVIENORD, con importazione delle anomalie da
file Excel ed evidenziazione degli elementi interessati. Pensata per l'uso da
PC, con un piccolo server locale (`Avvia Mappa.cmd`) che non richiede né
Node.js né connessione.

Dettagli in **[V1-PORTABLE.md](V1-PORTABLE.md)**.

## Dati

Le progressive chilometriche vengono dal Fascicolo Linee FERROVIENORD
(ed. 2020, agg. CT n. 22/2026), le coordinate delle località dall'export PIC
della rete 64 e i cippi dal censimento georeferenziato della diagnostica.
I dati della linea Brescia–Iseo–Edolo si rigenerano da quelle fonti con
`bordo-treno/strumenti/Genera-DatiLinea.ps1`.

## Avvio in locale

```
powershell -ExecutionPolicy Bypass -File bordo-treno\server.ps1
```

L'app di bordo richiede un contesto sicuro (`https://` o `localhost`) per GPS,
funzionamento offline e installazione sul telefono: aprire i file con un doppio
clic non basta.

## Nota sulla cartella `app/`

`app/` contiene una versione React/TypeScript della mappa, rimasta indietro
rispetto a `portable/` e conservata solo come riferimento storico. Insieme a
essa restano i file dello starter da cui il progetto era partito
(`package.json`, `vite.config.ts` e simili), che nessuna delle due applicazioni
attualmente usa.
