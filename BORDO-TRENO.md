# Rilievi di bordo — Rete FERROVIENORD

Web app (PWA) per i manutentori a bordo treno: un tocco registra la progressiva
chilometrica e il cippo km del punto osservato. Sta in `bordo-treno/`.

È un'applicazione separata dalla Mappa interattiva (`portable/`): stessa palette
e stessa filosofia — HTML/CSS/JS puri, nessuna dipendenza, nessun passo di build
— ma destinazione diversa (telefono, in movimento, offline).

Copre **9 percorsi**: il ramo Iseo (Brescia–Iseo–Edolo) e otto percorsi del
ramo Milano (Cadorna–Saronno e le sue diramazioni verso Laveno, Como, Novara,
Gallarate via Malpensa, Seregno, Asso e Camnago-Lentate). Il manutentore
scegli il proprio percorso all'avvio e può cambiarlo in corsa nei punti dove
la linea si dirama. Dettagli tecnici completi (architettura, decisioni,
metodo di validazione dei cippi) in **[`bordo-treno/AGENTS.md`](bordo-treno/AGENTS.md)**;
questa pagina resta un riassunto per chi non deve toccare il codice.

## Avvio in locale

```
powershell -ExecutionPolicy Bypass -File bordo-treno\server.ps1
```

Oppure dal launcher del progetto: configurazione `bordo-treno` in
`.claude/launch.json`, porta 8790.

## Messa in esercizio

GPS, service worker e installazione della PWA richiedono un **contesto sicuro**:
`https://` oppure `localhost`. Aprire i file con un doppio clic (`file://`) non
funziona. Serve quindi pubblicare la cartella `bordo-treno/` su un host HTTPS
raggiungibile dai telefoni aziendali; da lì l'utente apre il link una volta,
sceglie "Aggiungi a schermata Home" e l'app resta installata e utilizzabile
senza campo.

## Come viene calcolata la progressiva

Odometria ancorata ai cippi chilometrici, identica su ogni percorso:

1. **Aggancio** — passando accanto a un cippo censito, il km viene riportato al
   suo valore esatto. I cippi stanno a un chilometro l'uno dall'altro, quindi a
   80 km/h si riaggancia ogni ~45 secondi (`verificaAggancio`).
2. **Avanzamento** — fra un cippo e l'altro il km avanza integrando la velocità
   restituita dal GPS, che misura i metri realmente percorsi sul binario, curve
   comprese (`avanza`).

Il traverso del cippo cade quasi sempre *fra* due fix GPS: prendere il campione
più vicino quantizzerebbe l'aggancio alla distanza fra due fix (11 m a 80 km/h,
molto di più in accelerazione). Attorno al minimo la distanza al quadrato varia
come una parabola, quindi se ne cerca il vertice sui tre campioni centrali
(`kmAlTraverso`).

Misurato in simulazione a 79 km/h, con rumore GPS di 6 m e una velocità
dichiarata volutamente sbagliata del 2%:

| | |
|---|---|
| scarto all'aggancio sui cippi | 0, +1, 0, +2 m |
| errore fra un cippo e l'altro | mediana 10 m, massimo 20 m |
| recupero da una partenza sbagliata di 330 m | rientrato entro il primo cippo |

L'errore residuo fra due cippi è quasi tutto il 2% iniettato nel GPS; con la
velocità Doppler reale di un telefono è di pochi metri.

Quattro difese contro i casi in cui il metodo cede, tutte verificate in
simulazione (dettagli e numeri in `AGENTS.md`): velocità GPS non credibile,
galleria (nessuna oltre i 1.000 m sul ramo Iseo; una sul ramo Milano, verso
Malpensa), cippo superato al buio, sosta in località come rete di sicurezza.

## Percorsi e cambio percorso

Ogni percorso è un tronco del Fascicolo (o una catena di tronchi con
progressiva continua), **non** un grafo dell'intera rete: ognuno ha una
propria scala di km, quasi sempre senza partire da zero (es. Saronno-Como va
da 21,157 a 46,088). Alla schermata "Prima di partire" si scelgono percorso,
località di partenza e verso; nella scheda "Aggancio manuale" si può cambiare
percorso in corsa, per i punti dove la linea si dirama (es. Saronno). Ogni
rilievo salvato registra il proprio percorso, perché i valori di km si
sovrappongono fra percorsi diversi — km 21 esiste su almeno quattro percorsi
del ramo Milano, in luoghi fisici diversi.

## Dati

`bordo-treno/dati/rete.json` — un file per tutti i percorsi, rigenerabile con
`strumenti\Genera-DatiRete.ps1`:

| ramo | percorsi | località | cippi |
|---|---|---|---|
| Iseo (Brescia–Edolo) | 1 | 36 | 102 |
| Milano (Cadorna e diramazioni) | 8 | 89 | ~245 |

Fonti:

- **progressive chilometriche**: Fascicolo Linee FERROVIENORD, ed. 2020,
  Fiancate di linea (FL pp. 85–99 per il ramo Milano, FL pp. 100–105 per il
  ramo Iseo), trascritte a mano dentro lo script di generazione;
- **cippi**: `strumenti/fonti/ISEO-Georeferenziazione Cippi.csv` e
  `MILANO-Georeferenziazione Cippi.csv`, coordinate WGS84;
- **coordinate delle località**: `portable/network-data.json` (export PIC rete
  64, UTM 32N / EPSG:32632) — copre l'intera rete FERROVIENORD, quindi la
  stessa fonte già in uso per il ramo Iseo ha dato anche le 89 località del
  ramo Milano, tutte trovate.

Le fonti sono state riscontrate fra loro con lo stesso metodo su entrambi i
rami: le progressive ricavate sommando le lunghezze delle tratte dell'export
PIC coincidono **al metro** con quelle del Fascicolo.

### Le coordinate PIC non sono tutte affidabili — 9 in tutto escluse

Il vincolo usato per scovarle: **la corda in linea retta fra due località non
può mai superare la lunghezza reale del binario fra loro**. Un rapporto fino a
~1,30 è una curva vera (misurato su Vello–Toline, ramo Iseo); oltre ~1,40 è
quasi certamente un dato sbagliato. Metodo completo, incluso come distinguere
il punto colpevole da quello innocente quando compaiono insieme, in
`AGENTS.md`.

Trovate e marcate `coordAffidabile: false` (km invariato, solo escluse
dall'aggancio GPS):

| punto | come è stato scoperto |
|---|---|
| Brescia Violino | coordinate PIC tonde (valori esatti a 100 m) |
| Malpensa Aeroporto T2 | coordinate PIC tonde |
| Bivio/PC Cardano | coordinate PIC tonde |
| Castellanza | corda quasi doppia dell'arco reale |
| Gallarate *(solo sul percorso via Malpensa)* | il Fascicolo stampa due progressive diverse per questa stazione (56,753 e 24,922); verificato che la prima non torna con la posizione reale rispetto agli ultimi cippi |
| Groane, Ceriano Laghetto-Solaro, Ceriano Laghetto Parco delle Groane | le tre fermate giacciono quasi su una retta perfetta nell'export, mentre la linea vera curva |
| Seveso Baruccana | scagionata Cesano Maderno perché corretta altrove nel dataset; per eliminazione la colpa è di questo punto |

Anche il CSV dei cippi Iseo è arrivato con le coordinate corrotte (numeri
senza separatore decimale) e con 5 cippi di un tronco diverso
(Rovato FN–Bornato-Calino, esclusi perché su una progressiva propria); il CSV
Milano aveva 5 cippi consecutivi (Saronno-Como, km 40–44) con coordinate
mescolate fra loro. Dettagli di ogni caso in `AGENTS.md`.

## Cosa manca

- **Cippi ettometrici**: se la diagnostica li ha censiti, un punto ogni 100 m
  porterebbe l'aggancio da uno ogni 45 secondi a uno ogni 4.
- **Asse del binario georeferenziato**: chi ha censito i cippi probabilmente ce
  l'ha. Sostituirebbe la spezzata dei cippi nella ricollocazione e abiliterebbe
  una vista cartografica.
- **Vista su mappa**: oggi non c'è; con i cippi la geometria è sufficiente per
  disegnarla.
- **Tronco Rovato FN–Bornato-Calino**: i suoi 5 cippi sono già nel CSV Iseo ma
  non ancora integrati come percorso a sé.
- I rilievi stanno in `localStorage`, la traccia GPS in IndexedDB: sono legati
  al browser del telefono e non sono sincronizzati da nessuna parte. L'export è
  l'unico modo di metterli al sicuro.
- Nessun test automatico: le verifiche sono state fatte in simulazione,
  iniettando un `watchPosition` finto — mai ancora con un GPS vero.
