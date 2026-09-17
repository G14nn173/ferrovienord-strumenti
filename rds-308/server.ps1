param(
  [int]$Port = 8766,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
}

function Test-Port([int]$Candidate) {
  try {
    $client = [Net.Sockets.TcpClient]::new()
    $result = $client.BeginConnect("127.0.0.1", $Candidate, $null, $null)
    $open = $result.AsyncWaitHandle.WaitOne(120)
    $client.Close()
    return -not $open
  } catch {
    return $true
  }
}

while (-not (Test-Port $Port)) { $Port++ }
$prefix = "http://127.0.0.1:$Port/"
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)

try {
  $listener.Start()
  if (-not $NoBrowser) { Start-Process $prefix }
  Write-Host ""
  Write-Host "FERROVIENORD - RDS Mod. 0308" -ForegroundColor Cyan
  Write-Host "Aperta nel browser: $prefix"
  Write-Host "Lascia aperta questa finestra. Premi Ctrl+C per chiudere l'app."
  Write-Host ""

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 3000
      $waitUntil = [DateTime]::UtcNow.AddMilliseconds(750)
      while (-not $stream.DataAvailable -and [DateTime]::UtcNow -lt $waitUntil) {
        Start-Sleep -Milliseconds 15
      }
      if (-not $stream.DataAvailable) { continue }
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
      $headerCount = 0
      while ($headerCount -lt 100 -and -not [string]::IsNullOrEmpty($reader.ReadLine())) {
        $headerCount++
      }
      $parts = $requestLine -split " "
      $requestPath = if ($parts.Count -ge 2) { $parts[1].Split("?")[0] } else { "/" }
      $relative = [Uri]::UnescapeDataString($requestPath.TrimStart("/")).Replace("/", [IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }
      $candidate = [IO.Path]::GetFullPath((Join-Path $root $relative))
      $rootFull = [IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar
      $valid = $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $candidate -PathType Leaf)
      if ($valid) {
        $bytes = [IO.File]::ReadAllBytes($candidate)
        $ext = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
        $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
        $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      } else {
        $bytes = [Text.Encoding]::UTF8.GetBytes("File non trovato")
        $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
      }
      $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush()
    } catch {
      # Browser e WebView possono aprire e chiudere connessioni preventive senza
      # inviare una richiesta. Una singola connessione interrotta non deve
      # arrestare il server dell'app.
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
