# Rilievi di bordo — Brescia · Iseo · Edolo

Web app (PWA) per i manutentori a bordo treno: un tocco registra la progressiva
chilometrica e il cippo km del punto osservato. Sta in `bordo-treno/`.

È un'applicazione separata dalla Mappa interattiva (`portable/`): stessa palette
e stessa filosofia — HTML/CSS/JS puri, nessuna dipendenza, nessun passo di build
— ma destinazione diversa (telefono, in movimento, offline).

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

Odometria ancorata ai cippi chilometrici:

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
simulazione:

- **velocità GPS non credibile** — se la strada integrata non è compatibile con
  lo spostamento osservato, si passa al calcolo sulle posizioni
  (`velocitaCoerente`);
- **galleria** — senza fix la progressiva prosegue stimata per al massimo 90 s o
  2.500 m, poi si ferma invece di inventare. Il limite è dimensionato sulla
  sezione 26 del Fascicolo: sulla Brescia–Edolo non esistono gallerie oltre i
  1.000 m;
- **cippo superato al buio** — al ritorno del segnale la progressiva viene
  ricollocata proiettando la posizione sulla spezzata dei cippi, e resta marcata
  come *ricostruita* (numero ambra, avviso a schermo, colonna dedicata
  nell'export) finché non si aggancia a un cippo vero (`ricollocaSeNecessario`);
- **sosta in località** — rete di sicurezza che interviene solo se da oltre 3 km
  non si aggancia più nulla. È cercata **solo fra le località**, mai fra i
  cippi: un treno fermo a Iseo (km 25,713) si trova a 287 m dal cippo 26, e
  agganciare lì introdurrebbe quell'errore (`verificaSosta`).

## Dati

`bordo-treno/dati/linea-bie.json` — 206 punti, rigenerabile con
`strumenti\Genera-DatiLinea.ps1`:

| | |
|---|---|
| 36 località | progressive dal Fascicolo, coordinate dall'export PIC |
| 102 cippi chilometrici | censimento georeferenziato della diagnostica |
| 43 PL automatici | Fascicolo |
| 21 punti di variazione velocità | Fascicolo |
| 4 deviatoi e segnali | Fascicolo |

Fonti:

- **progressive chilometriche**: Fascicolo Linee FERROVIENORD, ed. 2020, agg.
  CT n. 22/2026, *Fiancate di linea* tronchi Brescia–Iseo e Iseo–Edolo
  (FL pp. 100–105), trascritte a mano dentro lo script di generazione;
- **cippi**: `strumenti/fonti/ISEO-Georeferenziazione Cippi.csv`, coordinate
  WGS84;
- **coordinate delle località**: `portable/network-data.json` (export PIC rete
  64, UTM 32N / EPSG:32632), convertite in WGS84.

Le fonti sono state riscontrate fra loro: le progressive ricavate sommando le
lunghezze delle tratte dell'export PIC coincidono **al metro** con quelle del
Fascicolo su tutta la linea (Edolo 102,709 km).

Origine: km 0,000 al paraurti del I binario della stazione di Brescia;
progressive delle località riferite all'asse del Fabbricato Viaggiatori.

### Il CSV dei cippi arriva con le coordinate rovinate

Nel file di origine le coordinate hanno perso il separatore decimale e hanno
acquisito i punti delle migliaia: `1.020.061.159` sta per `10,20061159`. Lo
script le ricostruisce inserendo la virgola dopo le prime cifre e accettando il
risultato **solo se cade nell'intervallo plausibile per questa linea**
(`Convert-CoordinataGrezza`); una riga che non rientra viene scartata e
segnalata, non indovinata.

Verifiche eseguite sul censimento, tutte superate:

- distanza fra cippi consecutivi: media 965 m, minima 805 m, **nessuna oltre i
  1.000 m** — la corda è sempre più corta dell'arco, quindi valori sotto il
  chilometro sono curve, non errori. Le sei più corte (805–887 m) cadono dove ci
  si aspetta: Vello–Toline, Ceto-Cerveno–Capo di Ponte, la Valcamonica alta;
- riscontro con le 36 località del Fascicolo: scostamento medio 66 m, con valori
  di 1–6 m su Paderno, Vello, Castegnato, Capo di Ponte e Borgo San Giovanni.
  L'assenza di uno scostamento sistematico esclude un disallineamento di datum.
  I valori maggiori (100–150 m) cadono tutti su curve strette, dove
  l'interpolazione lineare fra due cippi taglia l'arco.

### Anomalie note nelle sorgenti

**Brescia Violino** ha in `network-data.json` coordinate palesemente
convenzionali (590500 / 5044800, valori tondi). Due riscontri indipendenti lo
confermano: la sua distanza in retta da Brescia Borgo San Giovanni risulta
maggiore della lunghezza reale del binario (impossibile), e dista 904 m dalla
posizione interpolata fra i cippi, contro una media di 66 m. Il punto è marcato
`coordAffidabile: false` e non viene usato per l'aggancio. Il suo km (3,952)
resta corretto, perché viene dal Fascicolo.

**Cippi della Rovato FN – Bornato-Calino**: il CSV ne contiene 5, ma su una
progressiva propria (origine alla mezzeria del FV di Bornato-Calino). Sono
esclusi dalla generazione: mescolarli falserebbe il modello chilometrico.

## Cosa manca

- **Cippi ettometrici**: se la diagnostica li ha censiti, un punto ogni 100 m
  porterebbe l'aggancio da uno ogni 45 secondi a uno ogni 4.
- **Asse del binario georeferenziato**: chi ha censito i cippi probabilmente ce
  l'ha. Sostituirebbe la spezzata dei cippi nella ricollocazione e abiliterebbe
  una vista cartografica.
- **Vista su mappa**: oggi non c'è; con i cippi la geometria è sufficiente per
  disegnarla.
- I rilievi stanno in `localStorage`, la traccia GPS in IndexedDB: sono legati
  al browser del telefono e non sono sincronizzati da nessuna parte. L'export è
  l'unico modo di metterli al sicuro.
- Nessun test automatico: le verifiche sono state fatte in simulazione,
  iniettando un `watchPosition` finto.
