# Genera linea-bie.json per la web app di bordo.
# Fonti:
#  - progressive chilometriche ufficiali: Fascicolo Linee FERROVIENORD ed. 2020,
#    agg. CT n. 22/2026, "Fiancate di linea" tronchi Brescia-Iseo e Iseo-Edolo (FL pp. 100-105)
#  - coordinate localita: portable/network-data.json (export PIC, UTM 32N / EPSG:32632)

$ErrorActionPreference = 'Stop'
# .../bordo-treno/strumenti  ->  radice del progetto
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$outFile = Join-Path $repo "bordo-treno\dati\linea-bie.json"

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

  return @{
    lat = [math]::Round($lat * 180.0 / [math]::PI, 6)
    lon = [math]::Round($lon * 180.0 / [math]::PI, 6)
  }
}

# ---------- localita della linea, in ordine, con km ufficiale dal Fascicolo ----------
# tipo: capotronco | stazione | fermata   (bold sottolineato / bold / corsivo nella fiancata)
$loc = @(
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

# ---------- punti singolari dal Fascicolo (senza coordinata propria) ----------
# PLA = passaggio a livello automatico dotato di protezione propria
$pla = 4.666,5.160,6.174,9.974,18.085,28.559,28.878,29.386,29.778,30.943,31.227,
       31.474,31.941,32.766,39.708,44.661,46.039,50.161,50.673,51.216,54.246,
       54.907,55.251,56.282,57.310,60.813,61.641,63.048,63.609,63.916,73.647,
       73.826,74.720,76.273,76.680,76.964,77.463,79.142,79.966,84.652,90.721,
       96.498,100.778

# punti di variazione delle velocita massime / gradi di frenatura
$varvel = 0.461,2.409,3.000,6.345,12.536,14.643,16.085,17.466,23.564,30.338,
          47.856,53.224,71.843,72.368,80.667,82.892,86.247,87.821,88.376,
          90.205,94.575

# deviatoi e segnali citati in fiancata (senso Brescia -> Edolo)
$altri = @(
  @{ km = 25.934; nome = 'Deviatoio uscita Iseo';           tipo = 'deviatoio' },
  @{ km = 34.354; nome = 'Deviatoio uscita Sale Marasino';  tipo = 'deviatoio' },
  @{ km = 37.147; nome = 'Segnale di protezione Marone - Zone'; tipo = 'segnale' },
  @{ km = 25.395; nome = 'Deviatoio ingresso Iseo';          tipo = 'deviatoio' }
)

# ---------- cippi chilometrici georeferenziati (censimento diagnostica) ------
# Il CSV arriva con le coordinate prive di separatore decimale e con i punti
# delle migliaia: "1.020.061.159" e' in realta' 10,20061159. Si ricostruisce il
# numero inserendo la virgola dopo le prime cifre e accettandolo solo se cade
# nell'intervallo plausibile per questa linea.
function Convert-CoordinataGrezza([string]$grezzo, [double]$min, [double]$max) {
  $cifre = ($grezzo -replace '[^\d]', '')
  if (-not $cifre) { return $null }
  for ($tagli = 2; $tagli -le 3; $tagli++) {
    if ($cifre.Length -le $tagli) { continue }
    $v = [double]::Parse($cifre.Substring(0, $tagli) + '.' + $cifre.Substring($tagli),
                         [Globalization.CultureInfo]::InvariantCulture)
    if ($v -ge $min -and $v -le $max) { return $v }
  }
  return $null
}

$csvCippi = Join-Path $PSScriptRoot 'fonti\ISEO-Georeferenziazione Cippi.csv'
$cippi = New-Object System.Collections.ArrayList
$cippiScartati = New-Object System.Collections.ArrayList

foreach ($riga in (Get-Content $csvCippi | Select-Object -Skip 1)) {
  if ([string]::IsNullOrWhiteSpace($riga)) { continue }
  $c = $riga.Split(';')
  if ($c.Count -lt 7) { continue }
  # la Rovato FN - Bornato-Calino ha una progressiva propria: va tenuta fuori
  if ($c[2].Trim() -ne 'Brescia Edolo') { continue }
  $prog = $c[3].Trim()
  $lon = Convert-CoordinataGrezza $c[5] 9.5 10.9
  $lat = Convert-CoordinataGrezza $c[6] 45.0 46.6
  if ($prog -notmatch '^(\d+)\+(\d+)$' -or $null -eq $lon -or $null -eq $lat) {
    [void]$cippiScartati.Add("$prog  X='$($c[5])' Y='$($c[6])'")
    continue
  }
  $km = [double]$Matches[1] + [double]$Matches[2] / 1000
  [void]$cippi.Add([ordered]@{
    km = $km; tipo = 'cippo'; nome = ("Cippo {0}" -f [int]$km)
    lat = [math]::Round($lat, 7); lon = [math]::Round($lon, 7)
  })
}

# ---------- coordinate dalle localita di network-data.json ----------
$net = Get-Content (Join-Path $repo "portable\network-data.json") -Raw | ConvertFrom-Json
$byName = @{}
foreach ($n in $net.nodes) { $byName[($n.name -replace '\s+',' ').Trim().ToUpper()] = $n }

$punti = New-Object System.Collections.ArrayList
$mancanti = New-Object System.Collections.ArrayList

foreach ($l in $loc) {
  $key = ($l.nome -replace '\s+',' ').Trim().ToUpper()
  $n = $byName[$key]
  $p = [ordered]@{ km = $l.km; tipo = $l.tipo; nome = $l.nome }
  if ($n) {
    $ll = Convert-UtmToWgs84 ([double]$n.x) ([double]$n.y)
    $p.lat = $ll.lat
    $p.lon = $ll.lon
    if ($n.sigla) { $p.sigla = $n.sigla }
    # Brescia Violino: coordinate palesemente convenzionali nella sorgente PIC
    if ([math]::Abs([double]$n.x - [math]::Round([double]$n.x / 100.0) * 100.0) -lt 0.001 -and
        [math]::Abs([double]$n.y - [math]::Round([double]$n.y / 100.0) * 100.0) -lt 0.001) {
      $p.coordAffidabile = $false
    }
  } else {
    [void]$mancanti.Add($l.nome)
  }
  [void]$punti.Add($p)
}

foreach ($c in $cippi)  { [void]$punti.Add($c) }
foreach ($k in $pla)    { [void]$punti.Add([ordered]@{ km = $k; tipo = 'pla';      nome = 'PL automatico' }) }
foreach ($k in $varvel) { [void]$punti.Add([ordered]@{ km = $k; tipo = 'velocita'; nome = 'Variazione velocita / grado di frenatura' }) }
foreach ($o in $altri)  { [void]$punti.Add([ordered]@{ km = $o.km; tipo = $o.tipo; nome = $o.nome }) }

$punti = $punti | Sort-Object { [double]$_.km }

$doc = [ordered]@{
  meta = [ordered]@{
    linea         = 'Brescia - Iseo - Edolo'
    gestore       = 'FERROVIENORD'
    origine       = 'km 0,000 = paraurti del I binario della stazione di Brescia'
    riferimentoKm = 'Progressive delle localita riferite all asse del Fabbricato Viaggiatori'
    verso         = 'Progressive crescenti da Brescia verso Edolo (senso dei treni pari)'
    lunghezzaKm   = 102.709
    fonteKm       = 'Fascicolo Linee FERROVIENORD, ed. 2020, agg. CT n. 22/2026 - Fiancate di linea tronchi Brescia-Iseo e Iseo-Edolo (FL pp. 100-105)'
    fonteCoord    = 'Export PIC rete 64 (UTM 32N / EPSG:32632) convertito in WGS84'
    fonteCippi    = 'Censimento georeferenziato dei cippi chilometrici (diagnostica FERROVIENORD), coordinate WGS84'
    generato      = (Get-Date -Format 'yyyy-MM-dd')
  }
  punti = $punti
}

$dir = Split-Path $outFile -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$json = $doc | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($outFile, $json, [System.Text.UTF8Encoding]::new($false))

Write-Output ("Punti totali: {0}  (localita {1}, cippi {2}, PLA {3}, var.velocita {4}, altri {5})" -f $punti.Count, $loc.Count, $cippi.Count, $pla.Count, $varvel.Count, $altri.Count)
if ($mancanti.Count) { Write-Output ("Localita senza coordinata: {0}" -f ($mancanti -join ', ')) }
if ($cippiScartati.Count) {
  Write-Output ("Cippi scartati: {0}" -f $cippiScartati.Count)
  foreach ($s in $cippiScartati) { Write-Output ("  {0}" -f $s) }
}
Write-Output "--- verifica conversione ---"
$bs = $punti | Where-Object { $_.nome -eq 'BRESCIA' }
$ed = $punti | Where-Object { $_.nome -eq 'EDOLO' }
$is = $punti | Where-Object { $_.nome -eq 'ISEO' }
Write-Output ("BRESCIA  lat={0} lon={1}   (atteso ~45.533 / ~10.212)" -f $bs.lat, $bs.lon)
Write-Output ("ISEO     lat={0} lon={1}   (atteso ~45.659 / ~10.050)" -f $is.lat, $is.lon)
Write-Output ("EDOLO    lat={0} lon={1}   (atteso ~46.178 / ~10.331)" -f $ed.lat, $ed.lon)
Write-Output ("File: {0}" -f $outFile)
