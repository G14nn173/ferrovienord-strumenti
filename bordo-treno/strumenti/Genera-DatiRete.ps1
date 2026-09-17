# Genera dati/rete.json: tutti i percorsi disponibili per l'app di bordo
# (ramo Iseo gia' in uso + ramo Milano, nuovo).
#
# Fonti:
#  - progressive chilometriche: Fascicolo Linee FERROVIENORD ed. 2020,
#    Fiancate di linea (FL pp. 84-105 per il ramo Milano, FL pp. 100-105 per
#    il ramo Iseo), trascritte a mano qui sotto.
#  - coordinate localita: portable/network-data.json (export PIC rete 64,
#    UTM 32N / EPSG:32632).
#  - cippi chilometrici: censimento georeferenziato della diagnostica FNM,
#    fonti/ISEO-Georeferenziazione Cippi.csv e fonti/MILANO-Georeferenziazione
#    Cippi.csv, in WGS84.
#
# Ogni "percorso" e' un tronco o una catena di tronchi consecutivi con
# progressiva continua, esattamente come stampata nella relativa Fiancata di
# linea del Fascicolo. Un manutentore sceglie il percorso su cui si trova
# prima di avviare il rilevamento (vedi bordo-treno/AGENTS.md).

$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$outFile = Join-Path $repo "bordo-treno\dati\rete.json"

# ---------- UTM 32N (WGS84) -> lat/lon ----------
function Convert-UtmToWgs84([double]$east, [double]$north, [int]$zone = 32) {
  $a = 6378137.0
  $f = 1.0 / 298.257223563
  $k0 = 0.9996
  $e2 = $f * (2.0 - $f)
  $e1 = (1.0 - [math]::Sqrt(1.0 - $e2)) / (1.0 + [math]::Sqrt(1.0 - $e2))
  $ep2 = $e2 / (1.0 - $e2)

  $x = $east - 500000.0
  $y = $north
  $M = $y / $k0
  $mu = $M / ($a * (1.0 - $e2/4.0 - 3.0*$e2*$e2/64.0 - 5.0*[math]::Pow($e2,3)/256.0))

  $phi1 = $mu `
    + (3.0*$e1/2.0 - 27.0*[math]::Pow($e1,3)/32.0) * [math]::Sin(2.0*$mu) `
    + (21.0*$e1*$e1/16.0 - 55.0*[math]::Pow($e1,4)/32.0) * [math]::Sin(4.0*$mu) `
    + (151.0*[math]::Pow($e1,3)/96.0) * [math]::Sin(6.0*$mu) `
    + (1097.0*[math]::Pow($e1,4)/512.0) * [math]::Sin(8.0*$mu)

  $sp = [math]::Sin($phi1); $cp = [math]::Cos($phi1); $tp = [math]::Tan($phi1)
  $C1 = $ep2 * $cp * $cp
  $T1 = $tp * $tp
  $N1 = $a / [math]::Sqrt(1.0 - $e2 * $sp * $sp)
  $R1 = $a * (1.0 - $e2) / [math]::Pow(1.0 - $e2 * $sp * $sp, 1.5)
  $D = $x / ($N1 * $k0)

  $lat = $phi1 - ($N1 * $tp / $R1) * ( `
      $D*$D/2.0 `
      - (5.0 + 3.0*$T1 + 10.0*$C1 - 4.0*$C1*$C1 - 9.0*$ep2) * [math]::Pow($D,4)/24.0 `
      + (61.0 + 90.0*$T1 + 298.0*$C1 + 45.0*$T1*$T1 - 252.0*$ep2 - 3.0*$C1*$C1) * [math]::Pow($D,6)/720.0 )

  $lon0 = ([double]$zone * 6.0 - 183.0) * [math]::PI / 180.0
  $lon = $lon0 + ( `
      $D `
      - (1.0 + 2.0*$T1 + $C1) * [math]::Pow($D,3)/6.0 `
      + (5.0 - 2.0*$C1 + 28.0*$T1 - 3.0*$C1*$C1 + 8.0*$ep2 + 24.0*$T1*$T1) * [math]::Pow($D,5)/120.0 ) / $cp

  return @{ lat = [math]::Round($lat * 180.0 / [math]::PI, 6); lon = [math]::Round($lon * 180.0 / [math]::PI, 6) }
}

function Distanza($lat1, $lon1, $lat2, $lon2) {
  $raggio = 6371000.0; $rad = [math]::PI / 180
  $dLat = ($lat2 - $lat1) * $rad; $dLon = ($lon2 - $lon1) * $rad
  $a = [math]::Sin($dLat/2) * [math]::Sin($dLat/2) +
       [math]::Cos($lat1*$rad) * [math]::Cos($lat2*$rad) * [math]::Sin($dLon/2) * [math]::Sin($dLon/2)
  return 2 * $raggio * [math]::Asin([math]::Min(1.0, [math]::Sqrt($a)))
}

function Normalizza([string]$s) {
  $s = $s.ToUpperInvariant()
  $s = $s -replace "['`’]", ' '
  $s = $s -replace '[\.\-]', ' '
  $s = $s -replace '\s+', ' '
  return $s.Trim()
}

# ---------- coordinate delle localita (export PIC, tutta la rete) ----------
$net = Get-Content (Join-Path $repo "portable\network-data.json") -Raw | ConvertFrom-Json
$byNorm = @{}
foreach ($n in $net.nodes) {
  $k = Normalizza $n.name
  if (-not $byNorm.ContainsKey($k)) { $byNorm[$k] = $n }
}
# Localita la cui coordinata PIC e' geometricamente impossibile ma non
# "tonda" (quindi non intercettata dal controllo sui numeri tondi qui sotto).
# Individuate confrontando corda diretta e lunghezza reale del binario fra
# localita consecutive (la corda non puo' mai superare l'arco): rapporti fino
# a 1,90 misurati, contro un massimo fisiologico di circa 1,30 osservato sulle
# curve piu' strette della rete (Vello-Toline, ramo Iseo). Quando due localita
# adiacenti risultano entrambe "impossibili", la condivisa fra le due e' la
# sospetta; altrimenti si esclude per eliminazione confrontando la stessa
# localita con un'altra coppia dove il rapporto torna normale (es. Cesano
# Maderno e' regolare nella coppia Bovisio Masciago-Cesano Maderno, quindi la
# colpa nella coppia Cesano Maderno-Seveso Baruccana ricade su quest'ultima).
$coordEscluseManualmente = @(
  'CASTELLANZA', 'SEVESO BARUCCANA', 'GALLARATE',
  # l'intera zona "Parco delle Groane": nell'export le tre fermate giacciono
  # quasi su una retta perfetta (x cresce regolarmente, y quasi costante),
  # mentre la linea reale curva sensibilmente - coordinate chiaramente
  # schematiche, non rilevate sul campo.
  'GROANE', 'CERIANO LAGHETTO SOLARO', 'CERIANO LAGHETTO PARCO DELLE GROANE'
)

# alias per le grafie che differiscono fra Fascicolo ed export PIC
$alias = @{
  'COMO CAMERLATA'        = 'COMO CAMERLATA (FNM)'
  'MALPENSA AEROPORTO T1' = 'MALPENSA AEROPORTO TERMINAL 1'
  'MALPENSA AEROPORTO T2' = 'MALPENSA AEROPORTO TERMINAL 2'
  'PONTE LAMBRO CASTELMARTE' = 'PONTELAMBRO CASTELMARTE'
}

function Get-Coord([string]$nome) {
  $k = Normalizza $nome
  if ($alias.ContainsKey($k)) { $k = Normalizza $alias[$k] }
  if ($byNorm.ContainsKey($k)) {
    $n = $byNorm[$k]
    $ll = Convert-UtmToWgs84 ([double]$n.x) ([double]$n.y)
    $risultato = [ordered]@{ lat = $ll.lat; lon = $ll.lon; sigla = $n.sigla }
    # coordinate palesemente convenzionali nella sorgente PIC (x e y tondi a
    # 100 m): confermato per Brescia Violino da due riscontri indipendenti
    # (vedi bordo-treno/AGENTS.md). Il controllo va sulle UTM grezze, non
    # sulle lat/lon convertite, che non sono mai tonde per costruzione.
    if ([math]::Abs([double]$n.x - [math]::Round([double]$n.x / 100.0) * 100.0) -lt 0.001 -and
        [math]::Abs([double]$n.y - [math]::Round([double]$n.y / 100.0) * 100.0) -lt 0.001) {
      $risultato.coordAffidabile = $false
    }
    if ($coordEscluseManualmente -contains $k) { $risultato.coordAffidabile = $false }
    return $risultato
  }
  return $null
}

# =====================================================================
# RAMO ISEO — Brescia - Iseo - Edolo (gia' in uso, invariato)
# =====================================================================

$locIseo = @(
  @{ km = 0.000;   nome = 'BRESCIA';                    tipo = 'capotronco' },
  @{ km = 2.087;   nome = 'BRESCIA BORGO SAN GIOVANNI'; tipo = 'stazione'   },
  @{ km = 3.952;   nome = 'BRESCIA VIOLINO';            tipo = 'fermata'    },
  @{ km = 5.148;   nome = 'MANDOLOSSA';                 tipo = 'fermata'    },
  @{ km = 8.695;   nome = 'CASTEGNATO';                 tipo = 'stazione'   },
  @{ km = 12.052;  nome = 'PADERNO FRANCIACORTA';       tipo = 'fermata'    },
  @{ km = 14.087;  nome = 'PASSIRANO';                  tipo = 'stazione'   },
  @{ km = 16.685;  nome = 'BORNATO - CALINO';           tipo = 'stazione'   },
  @{ km = 20.813;  nome = 'BORGONATO - ADRO';           tipo = 'stazione'   },
  @{ km = 22.716;  nome = 'PROVAGLIO - TIMOLINE';       tipo = 'fermata'    },
  @{ km = 25.713;  nome = 'ISEO';                       tipo = 'capotronco' },
  @{ km = 28.885;  nome = 'PILZONE';                    tipo = 'fermata'    },
  @{ km = 31.324;  nome = 'SULZANO';                    tipo = 'fermata'    },
  @{ km = 34.171;  nome = 'SALE MARASINO';              tipo = 'stazione'   },
  @{ km = 37.740;  nome = 'MARONE - ZONE';              tipo = 'stazione'   },
  @{ km = 39.670;  nome = 'VELLO';                      tipo = 'fermata'    },
  @{ km = 44.591;  nome = 'TOLINE';                     tipo = 'fermata'    },
  @{ km = 47.377;  nome = 'PISOGNE';                    tipo = 'stazione'   },
  @{ km = 52.090;  nome = 'PIAN CAMUNO - GRATACASOLO';  tipo = 'stazione'   },
  @{ km = 54.948;  nome = 'ARTOGNE - GIANICO';          tipo = 'fermata'    },
  @{ km = 58.452;  nome = 'DARFO - CORNA';              tipo = 'stazione'   },
  @{ km = 59.664;  nome = 'BOARIO TERME';               tipo = 'fermata'    },
  @{ km = 60.682;  nome = 'ERBANNO - ANGONE';           tipo = 'fermata'    },
  @{ km = 63.345;  nome = 'PIAN DI BORNO';              tipo = 'fermata'    },
  @{ km = 65.498;  nome = 'COGNO - ESINE';              tipo = 'stazione'   },
  @{ km = 68.226;  nome = 'CIVIDATE - MALEGNO';         tipo = 'stazione'   },
  @{ km = 72.047;  nome = 'BRENO';                      tipo = 'stazione'   },
  @{ km = 75.331;  nome = 'NIARDO - LOSINE';            tipo = 'fermata'    },
  @{ km = 77.494;  nome = 'CETO - CERVENO';             tipo = 'fermata'    },
  @{ km = 81.967;  nome = 'CAPO DI PONTE';              tipo = 'stazione'   },
  @{ km = 84.579;  nome = 'SELLERO';                    tipo = 'fermata'    },
  @{ km = 86.758;  nome = 'CEDEGOLO';                   tipo = 'stazione'   },
  @{ km = 90.745;  nome = 'FORNO ALLIONE';              tipo = 'fermata'    },
  @{ km = 94.247;  nome = 'MALONNO';                    tipo = 'stazione'   },
  @{ km = 100.140; nome = 'SONICO';                     tipo = 'fermata'    },
  @{ km = 102.709; nome = 'EDOLO';                      tipo = 'capotronco' }
)
$plaIseo = 4.666,5.160,6.174,9.974,18.085,28.559,28.878,29.386,29.778,30.943,31.227,
           31.474,31.941,32.766,39.708,44.661,46.039,50.161,50.673,51.216,54.246,
           54.907,55.251,56.282,57.310,60.813,61.641,63.048,63.609,63.916,73.647,
           73.826,74.720,76.273,76.680,76.964,77.463,79.142,79.966,84.652,90.721,
           96.498,100.778
$varvelIseo = 0.461,2.409,3.000,6.345,12.536,14.643,16.085,17.466,23.564,30.338,
              47.856,53.224,71.843,72.368,80.667,82.892,86.247,87.821,88.376,
              90.205,94.575
$altriIseo = @(
  @{ km = 25.934; nome = 'Deviatoio uscita Iseo';           tipo = 'deviatoio' },
  @{ km = 34.354; nome = 'Deviatoio uscita Sale Marasino';  tipo = 'deviatoio' },
  @{ km = 37.147; nome = 'Segnale di protezione Marone - Zone'; tipo = 'segnale' },
  @{ km = 25.395; nome = 'Deviatoio ingresso Iseo';          tipo = 'deviatoio' }
)

# =====================================================================
# RAMO MILANO — otto percorsi (FL pp. 85-99)
# =====================================================================

$percorsiMilanoDef = @(
  @{
    id = 'milano-saronno'; nome = 'Milano Cadorna - Saronno'
    fonteKm = 'Fiancata di linea tronco Milano Cadorna - Saronno (FL p. 85)'
    loc = @(
      @{ km = 0.000;  nome = 'MILANO CADORNA';           tipo = 'capotronco' }
      @{ km = 1.720;  nome = 'Milano Domodossola';       tipo = 'fermata' }
      @{ km = 4.165;  nome = 'MILANO BOVISA POLITECNICO';tipo = 'stazione' }
      @{ km = 6.339;  nome = 'Milano Quarto Oggiaro';    tipo = 'fermata' }
      @{ km = 8.162;  nome = 'NOVATE MILANESE';          tipo = 'stazione' }
      @{ km = 9.472;  nome = 'Bollate Centro';           tipo = 'fermata' }
      @{ km = 10.857; nome = 'Bollate Nord';             tipo = 'fermata' }
      @{ km = 13.496; nome = 'Garbagnate Parco delle Groane'; tipo = 'fermata' }
      @{ km = 14.788; nome = 'GARBAGNATE MILANESE';      tipo = 'stazione' }
      @{ km = 16.408; nome = 'Cesate';                   tipo = 'fermata' }
      @{ km = 17.448; nome = 'Caronno Pertusella';       tipo = 'fermata' }
      @{ km = 19.306; nome = 'Saronno Sud';              tipo = 'fermata' }
      @{ km = 21.157; nome = 'SARONNO';                  tipo = 'capotronco' }
    )
  },
  @{
    id = 'saronno-varese-laveno'; nome = 'Saronno - Varese Nord - Laveno Mombello Lago'
    fonteKm = 'Fiancate di linea tronchi Saronno-Varese Nord e Varese Nord-Laveno Mombello Lago (FL pp. 87-88)'
    loc = @(
      @{ km = 21.157; nome = 'SARONNO';                  tipo = 'capotronco' }
      @{ km = 24.364; nome = 'Gerenzano - Turate';       tipo = 'fermata' }
      @{ km = 26.894; nome = 'Cislago';                  tipo = 'fermata' }
      @{ km = 29.457; nome = 'Mozzate';                  tipo = 'fermata' }
      @{ km = 31.471; nome = 'Locate Varesino - Carbonate'; tipo = 'fermata' }
      @{ km = 33.375; nome = 'Abbiate Guazzone';         tipo = 'fermata' }
      @{ km = 34.719; nome = 'Tradate';                  tipo = 'stazione' }
      @{ km = 37.997; nome = 'Venegono Inferiore';       tipo = 'fermata' }
      @{ km = 40.424; nome = 'Venegono Superiore - Castiglione Olona'; tipo = 'fermata' }
      @{ km = 42.570; nome = 'Vedano Olona';             tipo = 'fermata' }
      @{ km = 45.079; nome = 'Malnate';                  tipo = 'stazione' }
      @{ km = 49.867; nome = 'VARESE NORD';              tipo = 'capotronco' }
      @{ km = 52.376; nome = 'Varese Casbeno';           tipo = 'stazione' }
      @{ km = 55.682; nome = 'Morosolo Casciago';        tipo = 'fermata' }
      @{ km = 57.973; nome = 'Barasso - Comerio';        tipo = 'stazione' }
      @{ km = 61.106; nome = 'Gavirate';                 tipo = 'fermata' }
      @{ km = 62.000; nome = 'Gavirate Verbano';         tipo = 'stazione' }
      @{ km = 63.625; nome = 'Cocquio Trevisago';        tipo = 'stazione' }
      @{ km = 66.052; nome = 'Gemonio';                  tipo = 'fermata' }
      @{ km = 67.778; nome = 'Cittiglio';                tipo = 'stazione' }
      @{ km = 72.152; nome = 'LAVENO MOMBELLO LAGO';     tipo = 'capotronco' }
    )
  },
  @{
    id = 'saronno-como'; nome = 'Saronno - Como Lago'
    fonteKm = 'Fiancata di linea tronco Saronno - Como Lago (FL p. 89)'
    loc = @(
      @{ km = 21.157; nome = 'SARONNO';                  tipo = 'capotronco' }
      @{ km = 24.738; nome = 'Rovello Porro';            tipo = 'fermata' }
      @{ km = 26.339; nome = 'Rovellasca - Manera';      tipo = 'fermata' }
      @{ km = 30.117; nome = 'Lomazzo';                  tipo = 'fermata' }
      @{ km = 31.547; nome = 'Caslino al Piano';         tipo = 'fermata' }
      @{ km = 33.748; nome = 'Cadorago';                 tipo = 'fermata' }
      @{ km = 35.833; nome = 'Fino Mornasco';            tipo = 'stazione' }
      @{ km = 37.325; nome = 'Portichetto - Luisago';    tipo = 'fermata' }
      @{ km = 39.998; nome = 'Grandate - Breccia';       tipo = 'fermata' }
      @{ km = 41.964; nome = 'Como Camerlata';           tipo = 'stazione' }
      @{ km = 44.935; nome = 'Como Borghi';              tipo = 'stazione' }
      @{ km = 46.088; nome = 'COMO LAGO';                tipo = 'capotronco' }
    )
  },
  @{
    id = 'saronno-busto-novara'; nome = 'Saronno - Busto Arsizio Nord - Novara Nord'
    fonteKm = 'Fiancate di linea tronchi Saronno-Busto Arsizio Nord e Busto Arsizio Nord-Novara Nord (FL pp. 91-92)'
    loc = @(
      @{ km = 21.157; nome = 'SARONNO';                  tipo = 'capotronco' }
      @{ km = 27.853; nome = 'Rescaldina';               tipo = 'stazione' }
      @{ km = 33.675; nome = 'CASTELLANZA';              tipo = 'stazione' }
      @{ km = 35.614; nome = 'BUSTO ARSIZIO NORD';       tipo = 'capotronco' }
      @{ km = 38.379; nome = 'SACCONAGO';                tipo = 'stazione' }
      @{ km = 41.627; nome = 'Vanzaghello - Magnago';    tipo = 'stazione' }
      @{ km = 44.281; nome = 'Castano Primo';            tipo = 'fermata' }
      @{ km = 48.474; nome = 'Turbigo';                  tipo = 'stazione' }
      @{ km = 50.971; nome = 'Lido di Turbigo';          tipo = 'fermata' }
      @{ km = 51.419; nome = 'Galliate Parco del Ticino';tipo = 'fermata' }
      @{ km = 54.972; nome = 'Galliate';                 tipo = 'stazione' }
      @{ km = 61.176; nome = 'NOVARA NORD';              tipo = 'capotronco' }
    )
  },
  @{
    id = 'busto-malpensa-gallarate'; nome = 'Busto Arsizio Nord - Malpensa Aeroporto - Gallarate'
    fonteKm = 'Fiancata di linea tronco Busto Arsizio Nord - Gallarate (FL p. 93)'
    note = 'A Gallarate la Fiancata riporta due progressive che si incontrano nello stesso punto: 56,753 (continuando la numerazione da Milano Cadorna) e 24,922 (riferimento proprio della stazione, usato quando la si raggiunge da altre direzioni). Verificato che il valore 56,753 non torna con la posizione reale di Gallarate rispetto agli ultimi cippi rilevati (corda 2.856 m contro un arco atteso di 753 m, fisicamente impossibile): oltre l''ultimo cippo (km 56) la posizione di Gallarate non e'' quindi affidabile per l''aggancio automatico su questo percorso, restano solo il km dichiarato e l''odometria.'
    loc = @(
      @{ km = 35.614; nome = 'BUSTO ARSIZIO NORD';       tipo = 'capotronco' }
      @{ km = 38.340; nome = 'SACCONAGO';                tipo = 'stazione' }
      @{ km = 43.566; nome = 'Ferno - Lonate Pozzolo';   tipo = 'stazione' }
      @{ km = 48.460; nome = 'Malpensa Aeroporto T1';    tipo = 'stazione' }
      @{ km = 51.925; nome = 'MALPENSA AEROPORTO T2';    tipo = 'capotronco' }
      @{ km = 55.443; nome = 'Bivio/PC Cardano';         tipo = 'fermata' }
      @{ km = 56.753; nome = 'GALLARATE';                tipo = 'capotronco' }
    )
  },
  @{
    id = 'saronno-seregno'; nome = 'Saronno - Seregno'
    fonteKm = 'Fiancata di linea tronco Saronno - Seregno (FL p. 94)'
    loc = @(
      @{ km = 21.157; nome = 'SARONNO';                  tipo = 'capotronco' }
      @{ km = 23.107; nome = 'Saronno Sud';              tipo = 'fermata' }
      @{ km = 26.164; nome = 'Ceriano Laghetto - Solaro';tipo = 'stazione' }
      @{ km = 27.739; nome = 'Ceriano Laghetto Parco delle Groane'; tipo = 'fermata' }
      @{ km = 29.147; nome = 'Groane';                   tipo = 'stazione' }
      @{ km = 29.829; nome = 'Cesano Maderno Parco delle Groane'; tipo = 'fermata' }
      @{ km = 31.259; nome = 'Cesano Maderno';           tipo = 'fermata' }
      @{ km = 32.828; nome = 'Seveso Baruccana';         tipo = 'fermata' }
      @{ km = 36.397; nome = 'SEREGNO';                  tipo = 'capotronco' }
    )
  },
  @{
    id = 'bovisa-asso'; nome = 'Milano Bovisa Politecnico - Seveso - Asso'
    fonteKm = 'Fiancate di linea tratta/tronco Milano Bovisa Politecnico-Seveso e Seveso-Asso (FL pp. 95, 97). Progressiva continua da Milano Cadorna: Bovisa e'' allo stesso km 4,165 del percorso Milano Cadorna-Saronno.'
    loc = @(
      @{ km = 4.165;  nome = 'MILANO BOVISA POLITECNICO';tipo = 'capotronco' }
      @{ km = 6.442;  nome = 'MILANO AFFORI';            tipo = 'stazione' }
      @{ km = 7.845;  nome = 'Milano Bruzzano Parco Nord'; tipo = 'fermata' }
      @{ km = 9.227;  nome = 'CORMANO - CUSANO MILANINO';tipo = 'stazione' }
      @{ km = 11.613; nome = 'Paderno Dugnano';          tipo = 'fermata' }
      @{ km = 13.467; nome = 'Palazzolo Milanese';       tipo = 'stazione' }
      @{ km = 15.094; nome = 'Varedo';                   tipo = 'fermata' }
      @{ km = 17.167; nome = 'Bovisio Masciago';         tipo = 'fermata' }
      @{ km = 19.244; nome = 'Cesano Maderno';           tipo = 'fermata' }
      @{ km = 21.208; nome = 'SEVESO';                   tipo = 'capotronco' }
      @{ km = 23.453; nome = 'Meda';                     tipo = 'stazione' }
      @{ km = 25.151; nome = 'Cabiate';                  tipo = 'fermata' }
      @{ km = 27.362; nome = 'Mariano Comense';          tipo = 'stazione' }
      @{ km = 29.279; nome = 'Carugo - Giussano';        tipo = 'fermata' }
      @{ km = 31.049; nome = 'Arosio';                   tipo = 'stazione' }
      @{ km = 34.011; nome = 'Inverigo';                 tipo = 'stazione' }
      @{ km = 36.905; nome = 'Lambrugo - Lurago d''Erba';tipo = 'fermata' }
      @{ km = 39.336; nome = 'MERONE';                   tipo = 'stazione' }
      @{ km = 43.332; nome = 'Erba';                     tipo = 'stazione' }
      @{ km = 44.336; nome = 'Lezza - Carpesino';        tipo = 'fermata' }
      @{ km = 45.188; nome = 'Ponte Lambro - Castelmarte'; tipo = 'fermata' }
      @{ km = 46.112; nome = 'Caslino d''Erba';          tipo = 'fermata' }
      @{ km = 49.679; nome = 'Canzo';                    tipo = 'fermata' }
      @{ km = 50.412; nome = 'ASSO';                     tipo = 'capotronco' }
    )
  },
  @{
    id = 'seveso-camnago'; nome = 'Seveso - Camnago-Lentate'
    fonteKm = 'Fiancata di linea tronco Seveso - Camnago-Lentate (FL p. 99)'
    loc = @(
      @{ km = 21.208; nome = 'SEVESO';                   tipo = 'capotronco' }
      @{ km = 23.501; nome = 'CAMNAGO - LENTATE';        tipo = 'capotronco' }
    )
  }
)

# ---------- cippi ramo Milano: censimento diagnostica ------------------
# Il CSV arriva con coordinate WGS84 gia' in decimale (diversamente dal
# censimento Iseo, che le aveva prive di separatore decimale).
$csvCippiMilano = Join-Path $PSScriptRoot 'fonti\MILANO-Georeferenziazione Cippi.csv'
$cippiMilanoGrezzi = New-Object System.Collections.ArrayList
foreach ($riga in (Get-Content $csvCippiMilano -Encoding UTF8 | Select-Object -Skip 1)) {
  if ([string]::IsNullOrWhiteSpace($riga)) { continue }
  $c = $riga.Split(';')
  if ($c.Count -lt 7) { continue }
  $linea = $c[2].Trim(); $prog = $c[3].Trim()
  $lon = $null; $lat = $null; [double]$tmp = 0
  if ([double]::TryParse($c[5].Trim(), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$tmp)) { $lon = $tmp }
  if ([double]::TryParse($c[6].Trim(), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$tmp)) { $lat = $tmp }
  $km = $null
  if ($prog -match '^(\d+)\+(\d+)$') { $km = [double]$Matches[1] + [double]$Matches[2] / 1000 }
  $plausibile = $lon -ge 8.0 -and $lon -le 9.6 -and $lat -ge 45.0 -and $lat -le 46.2
  if ($null -eq $lon -or $null -eq $lat -or $null -eq $km -or -not $plausibile) { continue }
  [void]$cippiMilanoGrezzi.Add([pscustomobject]@{ Linea = $linea; Km = $km; Lat = $lat; Lon = $lon })
}

# "Raccordo Z" e' un raccordo industriale, fuori dalla rete viaggiatori.
# Sulla Saronno-Como i cippi 40-44 hanno coordinate incoerenti fra loro
# (40 e 44 sono un doppione esatto, 41-43 non tornano): esclusi, la tratta
# resta coperta dalla sola odometria per quel tratto di circa 6 km.
$cippiEsclusi = @{
  'Saronno - Como' = 40,41,42,43,44
}

function Get-CippiPerLinea([string]$nomeLinea) {
  $esclusi = if ($cippiEsclusi.ContainsKey($nomeLinea)) { $cippiEsclusi[$nomeLinea] } else { @() }
  return $cippiMilanoGrezzi | Where-Object {
    $_.Linea -eq $nomeLinea -and -not ($esclusi -contains [int][math]::Round($_.Km))
  } | Sort-Object Km
}

# mappa percorso -> nome "Linea" nel CSV diagnostica dei cippi Milano
$cippiPerPercorso = @{
  'milano-saronno'            = 'Milano - Saronno'
  'saronno-varese-laveno'     = 'Saronno - Laveno'
  'saronno-como'              = 'Saronno - Como'
  'saronno-busto-novara'      = 'Saronno - Novara'
  'busto-malpensa-gallarate'  = 'Bivio - Malpensa'
  'saronno-seregno'           = 'Saronno - Seregno'
  'bovisa-asso'               = 'Bovisa - Asso'
  'seveso-camnago'            = 'Seveso - Camnago'
}

# =====================================================================
# assemblaggio
# =====================================================================

function Build-Percorso([string]$id, [string]$nome, [array]$localita, [double[]]$pla,
                        [double[]]$varvel, [array]$altri, [string]$origine,
                        [string]$fonteKm, [string]$nomeCippiCsv, [string]$nota) {
  $punti = New-Object System.Collections.ArrayList
  $mancanti = New-Object System.Collections.ArrayList

  foreach ($l in $localita) {
    $p = [ordered]@{ km = $l.km; tipo = $l.tipo; nome = $l.nome }
    $coord = Get-Coord $l.nome
    if ($coord) {
      $p.lat = $coord.lat; $p.lon = $coord.lon
      if ($coord.sigla) { $p.sigla = $coord.sigla }
      if ($coord.coordAffidabile -eq $false) { $p.coordAffidabile = $false }
    } else {
      [void]$mancanti.Add($l.nome)
    }
    [void]$punti.Add($p)
  }

  foreach ($k in $pla)    { [void]$punti.Add([ordered]@{ km = $k; tipo = 'pla';      nome = 'PL automatico' }) }
  foreach ($k in $varvel) { [void]$punti.Add([ordered]@{ km = $k; tipo = 'velocita'; nome = 'Variazione velocita / grado di frenatura' }) }
  foreach ($o in $altri)  { [void]$punti.Add([ordered]@{ km = $o.km; tipo = $o.tipo; nome = $o.nome }) }

  $cippiUsati = 0
  if ($nomeCippiCsv) {
    foreach ($c in (Get-CippiPerLinea $nomeCippiCsv)) {
      [void]$punti.Add([ordered]@{ km = $c.Km; tipo = 'cippo'; nome = ("Cippo {0}" -f [int]$c.Km); lat = $c.Lat; lon = $c.Lon })
      $cippiUsati++
    }
  }

  $punti = @($punti | Sort-Object { [double]$_.km })
  # Measure-Object -Property non legge le chiavi di una Hashtable: si estrae
  # prima il valore con ForEach-Object.
  $km0 = ($localita | ForEach-Object { [double]$_.km } | Measure-Object -Minimum).Minimum
  $km1 = ($localita | ForEach-Object { [double]$_.km } | Measure-Object -Maximum).Maximum

  $percorso = [ordered]@{
    id = $id; nome = $nome
    lunghezzaKm = [math]::Round($km1 - $km0, 3)
    origine = $origine; fonteKm = $fonteKm
    cippiDisponibili = ($cippiUsati -gt 0)
    punti = $punti
  }
  if ($nota) { $percorso.nota = $nota }

  if ($mancanti.Count) {
    Write-Host ("  [{0}] localita senza coordinata: {1}" -f $id, ($mancanti -join ', '))
  }
  Write-Host ("  [{0}] {1} punti totali, {2} cippi, {3:N3} km" -f $id, $punti.Count, $cippiUsati, $percorso.lunghezzaKm)
  return $percorso
}

Write-Output "=== Ramo Iseo ==="
$percorsoIseo = Build-Percorso -id 'brescia-edolo' -nome 'Brescia - Iseo - Edolo' `
  -localita $locIseo -pla $plaIseo -varvel $varvelIseo -altri $altriIseo `
  -origine 'km 0,000 = paraurti del I binario della stazione di Brescia' `
  -fonteKm 'Fascicolo Linee FERROVIENORD, ed. 2020, agg. CT n. 22/2026 - Fiancate di linea tronchi Brescia-Iseo e Iseo-Edolo (FL pp. 100-105)' `
  -nomeCippiCsv $null

# i cippi del ramo Iseo restano nel file CSV originale (decodifica diversa):
# li aggiungo qui separatamente per non duplicare la logica di conversione.
$csvCippiIseo = Join-Path $PSScriptRoot 'fonti\ISEO-Georeferenziazione Cippi.csv'
function Convert-CoordinataGrezza([string]$grezzo, [double]$min, [double]$max) {
  $cifre = ($grezzo -replace '[^\d]', '')
  if (-not $cifre) { return $null }
  for ($tagli = 2; $tagli -le 3; $tagli++) {
    if ($cifre.Length -le $tagli) { continue }
    $v = [double]::Parse($cifre.Substring(0, $tagli) + '.' + $cifre.Substring($tagli), [Globalization.CultureInfo]::InvariantCulture)
    if ($v -ge $min -and $v -le $max) { return $v }
  }
  return $null
}
$cippiIseo = New-Object System.Collections.ArrayList
foreach ($riga in (Get-Content $csvCippiIseo | Select-Object -Skip 1)) {
  if ([string]::IsNullOrWhiteSpace($riga)) { continue }
  $c = $riga.Split(';')
  if ($c.Count -lt 7) { continue }
  if ($c[2].Trim() -ne 'Brescia Edolo') { continue }
  $prog = $c[3].Trim()
  $lon = Convert-CoordinataGrezza $c[5] 9.5 10.9
  $lat = Convert-CoordinataGrezza $c[6] 45.0 46.6
  if ($prog -notmatch '^(\d+)\+(\d+)$' -or $null -eq $lon -or $null -eq $lat) { continue }
  $km = [double]$Matches[1] + [double]$Matches[2] / 1000
  [void]$cippiIseo.Add([ordered]@{ km = $km; tipo = 'cippo'; nome = ("Cippo {0}" -f [int]$km); lat = [math]::Round($lat,7); lon = [math]::Round($lon,7) })
}
$percorsoIseo.punti = @($percorsoIseo.punti + $cippiIseo | Sort-Object { [double]$_.km })
$percorsoIseo.cippiDisponibili = $true
Write-Output ("  [brescia-edolo] + {0} cippi ramo Iseo -> {1} punti totali" -f $cippiIseo.Count, $percorsoIseo.punti.Count)

Write-Output "`n=== Ramo Milano ==="
$percorsiMilano = New-Object System.Collections.ArrayList
foreach ($def in $percorsiMilanoDef) {
  $p = Build-Percorso -id $def.id -nome $def.nome -localita $def.loc -pla @() -varvel @() -altri @() `
    -origine 'Progressiva continua da Milano Cadorna (paraurti del V binario)' `
    -fonteKm $def.fonteKm -nomeCippiCsv $cippiPerPercorso[$def.id] -nota $def.note
  [void]$percorsiMilano.Add($p)
}

$doc = [ordered]@{
  meta = [ordered]@{
    titolo = 'Rete FERROVIENORD - rilievi di bordo'
    gestore = 'FERROVIENORD'
    fonteCoord = 'Export PIC rete 64 (UTM 32N / EPSG:32632) convertito in WGS84'
    fonteCippi = 'Censimento georeferenziato dei cippi chilometrici (diagnostica FERROVIENORD), coordinate WGS84'
    generato = (Get-Date -Format 'yyyy-MM-dd')
  }
  percorsi = @($percorsoIseo) + $percorsiMilano
}

$dir = Split-Path $outFile -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllText($outFile, ($doc | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))

Write-Output ("`nFile scritto: {0}" -f $outFile)
Write-Output ("Percorsi totali: {0}" -f $doc.percorsi.Count)
