# Strumenti di preparazione dei dati

## `Genera-DatiRete.ps1`

Rigenera `dati/rete.json` — tutti i percorsi (ramo Iseo + ramo Milano) in un
solo file — da tre fonti:

- le **progressive chilometriche** di ogni percorso (località, PL, deviatoi,
  punti di variazione della velocità), **trascritte a mano** dalle Fiancate
  di linea del Fascicolo dentro lo script stesso: FL pp. 100–105 per il ramo
  Iseo, FL pp. 85–99 per gli otto percorsi del ramo Milano. Vanno aggiornate a
  mano quando esce una Circolare Territoriale che tocca quelle pagine;
- i **cippi chilometrici georeferenziati**, due file separati: `fonti/ISEO-
  Georeferenziazione Cippi.csv` e `fonti/MILANO-Georeferenziazione Cippi.csv`;
- le **coordinate delle località** da `portable/network-data.json`,
  convertite da UTM 32N a WGS84 — copre l'intera rete FERROVIENORD, non solo
  Iseo.

```
powershell -ExecutionPolicy Bypass -File bordo-treno\strumenti\Genera-DatiRete.ps1
```

Lo script stampa, per ogni percorso, quanti punti e cippi ha prodotto e segnala
eventuali località senza coordinata — non vengono mai indovinate. Se aggiungi
un percorso e questo elenco riporta "localita senza coordinata", il nome
scritto nello script non corrisponde a quello nell'export PIC: controlla prima
lì (a volte con una piccola differenza di grafia, es. "Malpensa Aeroporto T2"
contro "MALPENSA AEROPORTO TERMINAL 2" — vedi la mappa `$alias` in cima allo
script).

### Come aggiungere un percorso nuovo

1. Trova la sua Fiancata di linea nel Fascicolo (vedi `Rendi-PdfInImmagini.ps1`
   sotto) e trascrivi località e progressive in un nuovo blocco dentro
   `$percorsiMilanoDef` (o una struttura analoga, se è un ramo diverso).
2. Se hai un censimento cippi per quel percorso, aggiungi la riga corrispondente
   alla mappa `$cippiPerPercorso` con il nome esatto della "Linea" così come
   scritta nel CSV della diagnostica.
3. Rilancia lo script e **valida subito** con il metodo descritto in
   `../AGENTS.md` (corda ≤ arco fra località consecutive, prima di qualunque
   altro controllo) — non fidarti delle coordinate PIC per un percorso nuovo
   finché non hai verificato che nessuna coppia superi un rapporto di ~1,30.

### Il CSV dei cippi Iseo arriva con le coordinate rovinate

Le coordinate hanno perso il separatore decimale e hanno acquisito i punti
delle migliaia: `1.020.061.159` sta per `10,20061159`. `Convert-
CoordinataGrezza` ricostruisce il numero e lo accetta solo se cade
nell'intervallo plausibile per la linea. Il CSV Milano invece arriva già in
decimale pulito — non tutti i censimenti della diagnostica hanno lo stesso
problema, verifica sempre le prime righe a occhio prima di scrivere un
decodificatore.

Il CSV Iseo contiene anche 5 cippi della **Rovato FN – Bornato-Calino**, che
hanno una progressiva propria: esclusi dalla generazione perché mescolarli
falserebbe il modello chilometrico della Brescia–Edolo (non ancora integrati
come percorso a sé — vedi "Cosa manca" in `../BORDO-TRENO.md`).

### Coordinate PIC da escludere manualmente

La lista `$coordEscluseManualmente` in cima allo script contiene i punti la
cui coordinata è risultata geometricamente impossibile (corda oltre l'arco
reale) ma non "tonda" — quindi non intercettati dal controllo automatico sui
numeri tondi che segue subito dopo nello stesso file. Se validando un
percorso nuovo trovi un altro punto così, aggiungilo lì con un commento che
spieghi come l'hai scoperto: il metodo completo (e perché conviene diffidare
di un rapporto corda/arco sopra ~1,40) è in `../AGENTS.md`.

Se in futuro arriva un censimento aggiornato, basta sostituire il file in
`fonti/` e rilanciare lo script.

## `Rendi-PdfInImmagini.ps1`

Rende le pagine di un PDF in PNG usando le API WinRT di Windows. Serve per
rileggere il Fascicolo quando esce un aggiornamento: il testo dei PDF del
Fascicolo usa font con encoding proprietario e non è estraibile come testo.

```
powershell -ExecutionPolicy Bypass -File bordo-treno\strumenti\Rendi-PdfInImmagini.ps1 -Pdf FL.pdf -OutDir pagine -First 96 -Last 112
```

Le Fiancate di linea ramo Milano stanno alle pagine FL 84–99, corrispondenti
alle pagine PDF 96–112 nell'edizione usata per questo aggiornamento (scarto di
+12). Le Fiancate di linea Brescia–Iseo–Edolo stanno alle pagine FL 100–105,
PDF 112–117. **Lo scarto fra numerazione FL e numerazione PDF non è garantito
stabile fra edizioni**: verifica sempre confrontando il numero di pagina
stampato in fondo alla pagina resa con quello che ti aspetti, prima di fidarti
del range usato l'ultima volta.

## Trappole di PowerShell incontrate scrivendo questi script

- le variabili **non distinguono maiuscole e minuscole**: `$R` e `$r` sono la
  stessa variabile, e un raggio terrestre sovrascritto dai radianti produce
  distanze pari a zero senza alcun errore;
- `[math]::Min(1, $x)` con `$x` double sceglie l'overload `Min(int,int)` e
  tronca il risultato a zero. Va scritto `[math]::Min(1.0, $x)`;
- `Measure-Object -Property nome` non legge le chiavi di una `Hashtable`
  (serve un `[pscustomobject]`, oppure estrarre prima il valore con
  `ForEach-Object { $_.nome }` e passare quello a `Measure-Object`);
- una funzione che fa `Write-Output` per loggare l'avanzamento e poi
  `return $valore` **non restituisce solo `$valore`** a chi la chiama con
  `$x = MiaFunzione`: PowerShell cattura nella variabile tutto ciò che la
  funzione scrive sulla pipeline, log compreso, mescolato con il valore di
  ritorno. Usa `Write-Host` per i messaggi di stato dentro una funzione che
  ha anche un valore di ritorno da assegnare.
