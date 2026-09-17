# FERROVIENORD — strumenti per la circolazione e la manutenzione

Applicazioni web indipendenti, senza dipendenze e senza passo di build:
HTML, CSS e JavaScript serviti così come sono.

## [`bordo-treno/`](bordo-treno/) — Rilievi di bordo, rete FERROVIENORD

App installabile sul telefono (PWA) per i manutentori a bordo treno. Un tocco
registra la progressiva chilometrica e il cippo km del punto osservato, con
ora, posizione e una nota; a fine giro si esporta in Excel, CSV e GeoJSON.
Copre **9 percorsi**: il ramo Iseo (Brescia–Iseo–Edolo) e otto percorsi del
ramo Milano (Cadorna–Saronno e le sue diramazioni), con cambio percorso in
corsa nei punti dove la linea si dirama.

Funziona senza campo. La progressiva si ancora ai **cippi chilometrici
georeferenziati** di ogni percorso e avanza per odometria sulla velocità del
GPS fra un cippo e l'altro, così le curve non falsano il calcolo. Misurato in
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

## [`rds-308/`](rds-308/) — Registro delle Disposizioni di Servizio (Mod. 0308)

Compilazione e modifica del RDS secondo l'Allegato 10 della normativa ISD,
con i due modelli osservati nella prassi (Stazione/Bivio con Parte Seconda
manovre, e Posto di servizio tipo DCO senza piazzale proprio). Importa RDS
già esistenti da Word (.docx) con riconoscimento automatico di sezioni e
tabelle, oltre alla creazione da zero. Salvataggio locale nel browser,
import/export in JSON, stampa/PDF con impaginazione fedele al layout
ufficiale. Avvio con `rds-308\Avvia RDS.cmd`, stesso meccanismo a server
locale delle altre app.

Istruzioni d'uso in [`rds-308/LEGGIMI.txt`](rds-308/LEGGIMI.txt); per chi
riprende lo sviluppo (con qualsiasi agente IA) la guida tecnica aggiornata è
in [`rds-308/AGENTS.md`](rds-308/AGENTS.md).

## Dati

Le progressive chilometriche vengono dal Fascicolo Linee FERROVIENORD
(ed. 2020), le coordinate delle località dall'export PIC della rete 64 e i
cippi dal censimento georeferenziato della diagnostica. I dati di tutti i
percorsi (rami Iseo e Milano) si rigenerano da quelle fonti con
`bordo-treno/strumenti/Genera-DatiRete.ps1`.

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
