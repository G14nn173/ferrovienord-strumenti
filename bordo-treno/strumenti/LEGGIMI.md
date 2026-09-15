# Strumenti di preparazione dei dati

## `Genera-DatiLinea.ps1`

Rigenera `dati/linea-bie.json` da tre fonti:

- le **progressive chilometriche** delle località, dei PL, dei deviatoi e dei
  punti di variazione della velocità, **trascritte a mano** dalle Fiancate di
  linea del Fascicolo (FL pp. 100–105) dentro lo script stesso. Vanno aggiornate
  a mano quando esce una Circolare Territoriale che tocca quelle pagine;
- i **cippi chilometrici georeferenziati** da `fonti/ISEO-Georeferenziazione
  Cippi.csv`;
- le **coordinate delle località** da `portable/network-data.json`, convertite
  da UTM 32N a WGS84.

```
powershell -ExecutionPolicy Bypass -File bordo-treno\strumenti\Genera-DatiLinea.ps1
```

Lo script stampa in coda un riscontro sulle coordinate convertite di Brescia,
Iseo ed Edolo: se quei valori si discostano da quelli attesi, la conversione è
sbagliata e il file non va usato. Segnala inoltre i cippi eventualmente
scartati, che vanno guardati a mano — non vengono mai indovinati.

### Il CSV dei cippi

Le coordinate arrivano senza separatore decimale e con i punti delle migliaia:
`1.020.061.159` sta per `10,20061159`. `Convert-CoordinataGrezza` ricostruisce
il numero e lo accetta solo se cade nell'intervallo plausibile per la linea.

Il CSV contiene anche 5 cippi della **Rovato FN – Bornato-Calino**, che hanno
una progressiva propria: lo script li esclude, perché mescolarli falserebbe il
modello chilometrico della Brescia–Edolo.

Se in futuro arriva un censimento aggiornato, basta sostituire il file in
`fonti/` e rilanciare lo script.

## `Rendi-PdfInImmagini.ps1`

Rende le pagine di un PDF in PNG usando le API WinRT di Windows. Serve per
rileggere il Fascicolo quando esce un aggiornamento: il testo dei PDF del
Fascicolo usa font con encoding proprietario e non è estraibile come testo.

```
powershell -ExecutionPolicy Bypass -File bordo-treno\strumenti\Rendi-PdfInImmagini.ps1 -Pdf FL.pdf -OutDir pagine -First 112 -Last 117
```

Le Fiancate di linea Brescia–Iseo–Edolo stanno alle pagine FL 100–105, che nel
PDF completo corrispondono alle pagine 112–117 (scarto di +12).

## Trappole di PowerShell incontrate scrivendo questi script

- le variabili **non distinguono maiuscole e minuscole**: `$R` e `$r` sono la
  stessa variabile, e un raggio terrestre sovrascritto dai radianti produce
  distanze pari a zero senza alcun errore;
- `[math]::Min(1, $x)` con `$x` double sceglie l'overload `Min(int,int)` e
  tronca il risultato a zero. Va scritto `[math]::Min(1.0, $x)`.
