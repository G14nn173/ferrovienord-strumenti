# Rilievi di bordo — Rete FERROVIENORD — guida per chi continua lo sviluppo (umano o IA)

Questo file va aggiornato a ogni modifica sostanziale della cartella
`bordo-treno/`. Se stai riprendendo questo progetto con un altro agente
(Codex, Copilot, Gemini, un'altra sessione Claude...), leggilo per primo: ti
dà il contesto che altrimenti è solo nella cronologia della chat originale.
Dettagli aggiuntivi e cronologia delle verifiche sono in
[`../BORDO-TRENO.md`](../BORDO-TRENO.md), alla radice del repo.

## Cos'è, e per chi

PWA installabile sul telefono per i manutentori FERROVIENORD a bordo treno.
Un tocco registra la progressiva chilometrica e il cippo km del punto
osservato, con nota libera; a fine giro si esporta in Excel, CSV e GeoJSON.
Deve funzionare **senza campo**: gallerie, tratte isolate, nessuna assunzione
di connettività dopo il primo caricamento.

**Copre più percorsi**, non una sola linea: il ramo Iseo (Brescia–Iseo–Edolo)
e otto percorsi del ramo Milano (Cadorna–Saronno e le sue diramazioni). Il
manutentore scegli quello su cui si trova prima di avviare il rilevamento, e
può cambiarlo in corsa nei punti dove la linea si dirama (es. Saronno) — vedi
"Architettura multi-percorso" più sotto.

Segue lo stesso pattern delle altre app del repo (`portable/`, `rds-308/`):
cartella a sé, HTML/CSS/JS puri, nessuna dipendenza, nessun passo di build.
In più, essendo pensata per il telefono e per l'uso offline, è una **PWA**
vera (manifest + service worker), non solo una pagina servita in locale.

## Struttura dei file

| File | Ruolo |
|---|---|
| `index.html` | Le quattro schermate (Rilievo, Rilievi, Linea, Dati) più il foglio di conferma dopo la registrazione. La schermata di avvio ha un selettore di percorso, e la scheda "Aggancio manuale" ne ha un secondo per cambiare percorso a treno in corsa. |
| `app.js` | Tutta la logica: motore di posizione, aggancio, registrazione, elenchi, export. Vedi sotto per l'architettura multi-percorso e il calcolo del km. |
| `styles.css` | Stile mobile-first, stessa palette di `portable/styles.css` per coerenza visiva fra le app. |
| `sw.js` | Service worker cache-first: mette in cache tutti gli asset all'install, serve dalla cache offline, aggiorna in sottofondo quando c'è rete. **Alzare `VERSIONE` a ogni rilascio** o il telefono resta sulla versione vecchia. |
| `manifest.webmanifest` | Manifest PWA: `start_url`/`scope` relativi (`"./"`) apposta, perché l'app può vivere in una sottocartella (es. GitHub Pages `.../bordo-treno/`). |
| `dati/rete.json` | Dati generati, **non scritti a mano**: vedi `strumenti/`. Un solo file per tutti i percorsi (`{ meta, percorsi: [...] }`). |
| `strumenti/Genera-DatiRete.ps1` | Rigenera `dati/rete.json` dalle fonti. Le progressive del Fascicolo sono trascritte a mano *dentro* questo script (non esiste un parser del PDF: vedi sotto perché). |
| `strumenti/Rendi-PdfInImmagini.ps1` | Rende pagine PDF in PNG via WinRT, per rileggere il Fascicolo quando cambia. |
| `strumenti/fonti/ISEO-Georeferenziazione Cippi.csv` | Censimento cippi km della diagnostica FNM per il ramo Iseo, così come ricevuto. |
| `strumenti/fonti/MILANO-Georeferenziazione Cippi.csv` | Censimento cippi km della diagnostica FNM per il ramo Milano, così come ricevuto. |
| `strumenti/LEGGIMI.md` | Istruzioni per rigenerare i dati, incluse le trappole di PowerShell incontrate. |
| `server.ps1` / launcher | Server locale solo per sviluppo/collaudo da PC. **In produzione l'app gira da GitHub Pages** (o altro host HTTPS): GPS, service worker e installazione richiedono un contesto sicuro (`https://` o `localhost`), `file://` non funziona. |
| `LEGGIMI.txt` | Istruzioni per l'utente finale (il manutentore), non tecniche. |

## Architettura multi-percorso

`dati/rete.json` ha la forma `{ meta, percorsi: [...] }`. Ogni percorso è un
tronco del Fascicolo o una catena di tronchi consecutivi con progressiva
continua (es. "Saronno - Varese Nord - Laveno Mombello Lago" unisce due
tronchi che condividono il confine a Varese Nord), esattamente come stampato
nella sua Fiancata di linea. **Non è un grafo**: ogni percorso è un segmento
lineare a sé, con la propria scala di km — scelta deliberata, vedi il
paragrafo su Gallarate più sotto per il perché.

**Punto cruciale**: la progressiva di un percorso **non parte quasi mai da
zero**. "Saronno - Como Lago" va da km 21,157 (Saronno) a 46,088 (Como Lago).
Per questo `S.kmMin`/`S.kmMax` (calcolati da `selezionaPercorso`, non
costanti) sostituiscono ogni vecchio `0` nei confronti e nei clamp — non
reintrodurre un limite inferiore fisso a 0 da qualche parte, romperebbe tutti
i percorsi tranne Milano Cadorna-Saronno e Brescia-Iseo-Edolo.

Stato in gioco:
- `S.rete` — l'intero `rete.json` caricato una volta all'avvio.
- `S.percorso` — il percorso attivo in questo momento.
- `S.punti`/`S.localita`/`S.cippi`/`S.polilinea`/`S.kmMin`/`S.kmMax` — derivati
  da `S.percorso` via `selezionaPercorso(percorso)`. Il motore di posizione
  (aggancio, odometria, proiezione) legge solo questi, mai `S.percorso`
  direttamente: per questo è rimasto quasi identico a quando gestiva una sola
  linea.

**Cambio percorso in corsa** (`agganciaManuale(percorso, punto)`): se il
percorso scelto nella scheda "Aggancio manuale" è diverso da quello attivo,
richiama `selezionaPercorso` prima di riposizionare il km. Il verso di marcia
**non** viene dedotto dall'ancora precedente in questo caso (le due scale di
km non sono confrontabili fra loro — km 21 esiste su più percorsi diversi, in
punti fisici diversi): resta quello attivo, correggibile al prossimo
aggancio.

**Ogni rilievo registra il proprio percorso** (`percorsoId`/`percorsoNome` in
`componiBozza`), ed è una colonna a sé nell'export — necessario perché i km
si sovrappongono fra percorsi diversi: senza quella colonna un rilievo a "km
21" sarebbe ambiguo fra almeno quattro percorsi del ramo Milano.

## Come si calcola il km: odometria ancorata ai cippi

**Non è geo-fencing puro e non è interpolazione lineare fra stazioni.** Il
meccanismo, e perché è fatto così:

1. **Aggancio ai cippi.** Un cippo ogni chilometro, censiti dalla diagnostica
   FNM (102 sul ramo Iseo, ~250 sul ramo Milano). Passando accanto a uno, il
   km viene riportato al suo valore esatto. Il traverso del cippo cade quasi
   sempre *fra* due fix GPS: prendere il campione più vicino quantizzerebbe
   l'aggancio alla distanza fra due fix (11 m a 80 km/h). Si cerca invece il
   **vertice della parabola** della distanza al quadrato sui tre fix centrali
   attorno al minimo (`kmAlTraverso`), che dà precisione di pochi metri.
2. **Odometria fra un cippo e l'altro.** Il km avanza integrando la velocità
   restituita dal GPS (`avanza`), che misura i metri realmente percorsi sul
   binario, curve comprese — non una proiezione su una retta fra due punti.
3. **Sosta in località come rete di sicurezza**, non come meccanismo
   principale. Cercata **solo fra le località** (mai fra i cippi) e solo se
   da oltre 3 km non si è agganciato più nulla: un treno fermo a Iseo
   (km 25,713) sta a 287 m dal cippo 26, e usarlo per l'aggancio
   introdurrebbe quell'errore (`verificaSosta`).

**Perché non l'interpolazione lineare fra le sole stazioni** (la prima idea
scartata): misurando l'export PIC, 20 tratte su 35 superano il 3% di scarto
fra binario reale e distanza in retta, e Vello–Toline arriva al +30%
(4.921 m di binario contro 3.794 m di corda). Con le sole stazioni
l'interpolazione sbaglierebbe fino a ~700 m su quella tratta. Con un cippo
ogni km l'errore residuo fra due agganci è sceso a una mediana di 10 m,
misurato in simulazione a 79 km/h.

## Le cinque difese, e perché servono

Verificate tutte in simulazione (vedi sezione successiva):

- **Percorso sbagliato selezionato** (`verificaPercorsoPlausibile`): se il GPS
  resta a più di 3 km dalla polilinea del percorso scelto per 3 fix di
  seguito, un avviso rosso lo dice esplicitamente invece di tacere. Scoperto
  da Gianni collaudando sul telefono vero (primo bug trovato fuori
  simulazione): con GPS a Iseo e percorso "Busto Arsizio Nord - Malpensa"
  selezionato per errore, l'app continuava a mostrare un km plausibile senza
  alcun avviso — `ricollocaSeNecessario` esce apposta quando la distanza dalla
  polilinea supera 1.500 m (per non "correggere" verso un punto assurdo), ma
  quell'uscita silenziosa lasciava anche il caso "percorso sbagliato" senza
  alcun segnale. Le due funzioni condividono ora lo stesso `stimaKmDaPosizione`
  calcolato una sola volta per fix, con soglie diverse e scopi opposti: una
  tenta la correzione (≤1.500 m), l'altra si limita ad avvisare (>3.000 m,
  mai a rischio di sovrapporsi).

- **Velocità GPS non credibile** (`velocitaCoerente`): se la strada integrata
  non è compatibile con lo spostamento osservato, si passa al calcolo dalla
  differenza fra posizioni consecutive.
- **Galleria**: senza fix la progressiva prosegue stimata per **al massimo
  90 s o 2.500 m**, poi si ferma invece di inventare oltre. Limite scelto
  guardando la sezione 26 del Fascicolo: **sulla Brescia–Edolo non esistono
  gallerie oltre i 1.000 m** (solo Malpensa T2, sul ramo Milano, ne ha —
  attraversata dal percorso "Busto Arsizio Nord - Malpensa Aeroporto -
  Gallarate").
- **Cippo superato al buio** (`ricollocaSeNecessario`): al ritorno del
  segnale, la progressiva viene ricollocata proiettando la posizione sulla
  spezzata dei cippi (`stimaKmDaPosizione`) **del percorso attivo**, e resta
  marcata come *ricostruita* — numero ambra, avviso a schermo, colonna
  dedicata nell'export — finché non si aggancia di nuovo a un cippo vero.
  **Prima di questa difesa**, in un test simulato l'app usciva da una
  galleria con 1.133 m di errore mostrando comunque "GPS ottimo": il bug era
  proprio l'assenza di un modo per dire "questo numero non è più affidabile".
- **Treno fermo che non aggancia mai**: la prima versione del riaggancio
  aspettava che la distanza dal punto tornasse a crescere per confermare il
  transito — ma un treno che *si ferma* non fa mai crescere quella distanza.
  Ora una sosta di 4+ secondi entro 250 m da una località conferma l'arrivo
  anche senza transito.

## Perché i dati non sono scritti a mano nell'app

`dati/rete.json` è generato da fonti indipendenti, riscontrate fra loro
(dettagli e numeri in `../BORDO-TRENO.md`):

- Fascicolo Linee FERROVIENORD (progressive, trascritte a mano nello script
  perché il PDF usa font con encoding proprietario, non estraibile come
  testo — va renderizzato in immagine e letto). Per il ramo Milano lette 10
  Fiancate di linea (FL pp. 85–99).
- export PIC rete 64 (coordinate delle località, UTM 32N → WGS84) — copre
  l'intera rete FERROVIENORD, non solo Iseo, quindi le 89 località del ramo
  Milano sono venute dallo stesso file già in uso.
- censimento cippi della diagnostica, due file separati (Iseo e Milano),
  entrambi validati contro un intervallo plausibile e contro le progressive
  del Fascicolo prima di essere accettati.

**Non modificare `rete.json` a mano.** Se una fonte cambia (nuova CT, nuovo
censimento), si aggiorna la fonte e si rilancia
`strumenti/Genera-DatiRete.ps1`.

## Come si valida un nuovo censimento di cippi (metodo, non solo risultato)

Ogni volta che arriva un nuovo file di cippi, prima di fidarsene:

1. **Distanza fra cippi consecutivi** (stessa "Linea" nel CSV): deve stare
   intorno ai 1.000 m, **mai sopra** (la corda è sempre ≤ arco). Valori sotto
   il chilometro sono curve, non errori.
2. **Corda ≤ arco fra ogni coppia di località consecutive** di un percorso:
   vincolo fisico assoluto, indipendente da qualunque cippo. Un rapporto
   corda/arco fino a ~1,30 è plausibile su una curva vera (visto su
   Vello–Toline, ramo Iseo); oltre ~1,40 è quasi certamente un dato sbagliato
   — coordinata PIC fasulla o progressiva trascritta male. **Non alzare la
   soglia per far sparire un allarme**: è così che sono stati trovati Malpensa
   T2 e Bivio/PC Cardano (coordinate segnaposto tonde), Castellanza (corda
   quasi doppia dell'arco) e il gruppo Groane/Ceriano Laghetto (tre fermate
   quasi in linea retta nell'export, mentre la linea vera curva).
3. **Cross-check per elimination**: se una località compare in più coppie e
   solo alcune sono "impossibili", la colpa è quasi sempre del punto
   condiviso da tutte quelle bad (es. Groane, condiviso da due coppie
   entrambe fuori soglia). Se invece la stessa località si comporta bene in
   un'ALTRA coppia altrove nel dataset, è innocente: la colpa è dell'altro
   estremo (così è stato scagionato Cesano Maderno e incriminata Seveso
   Baruccana).
4. **Incrocio con i cippi stessi**: interpolare la posizione di ogni località
   dai cippi più vicini e confrontarla con la sua coordinata PIC. Utile ma
   più debole del punto 2 — un'estrapolazione oltre il primo o l'ultimo
   cippo di un percorso gonfia l'errore anche quando i dati sono giusti (visto
   su Busto Arsizio Nord e Seregno: confermati corretti dal controllo 2, pur
   con un grande scarto nell'incrocio con i cippi).

Punti risultati inaffidabili si marcano `coordAffidabile: false` (lista
`$coordEscluseManualmente` in cima allo script, sopra il controllo
automatico sui numeri tondi) — km invariato, solo esclusi dall'aggancio
GPS. Non c'è un modo automatico di distinguere "coordinata fasulla" da
"progressiva trascritta male": va deciso caso per caso con il metodo sopra.

## Il caso Gallarate: due numerazioni nello stesso punto

Il Fascicolo stampa **due progressive diverse** per Gallarate a seconda del
percorso da cui si arriva: 56,753 (continuando la numerazione da Milano
Cadorna via Malpensa) e 24,922 (riferimento proprio della stazione). Il
percorso "Busto Arsizio Nord - Malpensa Aeroporto - Gallarate" usa 56,753 per
coerenza con gli altri punti transitati, ma verificato (metodo del paragrafo
precedente, punto 2) che quel valore **non torna** con la posizione reale di
Gallarate rispetto agli ultimi cippi rilevati (corda 2.856 m contro un arco
atteso di 753 m — fisicamente impossibile). Gallarate è quindi marcata
`coordAffidabile: false` **su questo percorso**: oltre l'ultimo cippo (km 56)
resta solo l'odometria. È il motivo per cui i percorsi sono modellati come
segmenti lineari indipendenti e non come un grafo con un'unica numerazione
globale — un grafo avrebbe dovuto scegliere UNA delle due progressive di
Gallarate come "quella vera", quando invece il Fascicolo stesso ne usa
legittimamente due.

## Come si è verificato (non c'è una suite automatica)

Nessun test automatico. Verificato iniettando un `navigator.geolocation.
watchPosition` finto via `javascript_tool` nel browser, che simula un treno
lungo la polilinea dei cippi con rumore e bias di velocità configurabili.
Scenari coperti: aggancio in marcia, sosta in stazione (verificando che *non*
agganci il cippo vicino), galleria oltre il limite con recupero, velocità GPS
deliberatamente sbagliata, partenza dichiarata errata di centinaia di metri,
cambio di percorso a un bivio (Saronno) con verifica che titolo, estremi ed
export si aggiornino. I numeri concreti (scarti misurati) sono in
`../BORDO-TRENO.md`.

**Non ancora verificato**: un GPS vero, dentro una carrozza reale, su
qualunque percorso. Il primo viaggio con un telefono è il collaudo che manca.
Se qualcosa non torna, la traccia GPS esportabile dalla scheda Dati
(registrata in sottofondo, IndexedDB, con il percorso attivo per ogni punto)
è il primo posto dove guardare.

## Limiti noti / cose da non dare per scontate

- Rilievi in `localStorage`, traccia in IndexedDB: legati al browser del
  telefono, non sincronizzati. Più persone possono usare l'app
  contemporaneamente (è statica, nessun server dietro), ma **ognuna vede solo
  i propri rilievi**: nessuna condivisione automatica, va fatta a mano via
  export.
- Nessuna geometria reale del binario su nessun percorso: la spezzata dei
  cippi è un'approssimazione a un vertice per chilometro. La traccia GPS
  registrata dall'app, una volta raccolta su un viaggio completo e calibrata
  sui km del Fascicolo, è il candidato naturale a sostituirla — non ancora
  fatto.
- Il ramo Milano ha meno cippi per km del ramo Iseo su alcuni percorsi (es.
  "Seveso - Camnago-Lentate" ne ha solo 2, ma il tronco è lungo appena 2,3 km
  quindi bastano). Se arrivano dalla diagnostica anche i **cippi
  ettometrici** o l'**asse del binario georeferenziato**, sono un
  miglioramento diretto ovunque.
- L'app richiede un contesto sicuro per funzionare (HTTPS o `localhost`).
  `file://` non basta: niente GPS, niente service worker, niente
  installazione.
- Non tutti i tronchi del Prospetto delle Linee del Fascicolo sono coperti:
  manca ad esempio "Rovato FN - Bornato-Calino" (5 cippi già presenti nel CSV
  Iseo ma non ancora integrati — costo di integrazione basso, non ancora
  fatto perché fuori dallo scopo della richiesta che ha originato questo
  aggiornamento).

---
*Ultimo aggiornamento: generalizzazione a più percorsi (ramo Milano, 8
percorsi nuovi oltre a Brescia-Iseo-Edolo), con selettore di percorso
all'avvio e cambio percorso a treno in corsa; validazione del censimento
cippi Milano con scoperta e correzione di 6 coordinate PIC inaffidabili
(Castellanza, Gallarate su questo percorso, Groane, Ceriano Laghetto-Solaro,
Ceriano Laghetto Parco delle Groane, Seveso Baruccana), oltre alle 3 già note
(Brescia Violino, Malpensa T2, Bivio/PC Cardano); colonna "Percorso" negli
export per disambiguare km che si sovrappongono fra percorsi diversi; quinta
difesa contro il percorso selezionato per errore, trovata nel primo collaudo
su telefono vero.*
