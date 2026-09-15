param(
  [Parameter(Mandatory=$true)][string]$Pdf,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int]$First = 1,
  [int]$Last = 0,
  [int]$Width = 1700
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
  $m = $asTaskGeneric.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  return $t.Result
}

$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
})[0]

function AwaitAction($act) {
  $t = $asTaskAction.Invoke($null, @($act))
  $t.Wait(-1) | Out-Null
}

[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]      | Out-Null
[Windows.Storage.StorageFolder,Windows.Storage,ContentType=WindowsRuntime]    | Out-Null
[Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]    | Out-Null
[Windows.Data.Pdf.PdfPageRenderOptions,Windows.Data.Pdf,ContentType=WindowsRuntime] | Out-Null

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Pdf)) ([Windows.Storage.StorageFile])
$doc  = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
Write-Output ("PageCount: {0}" -f $doc.PageCount)

$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($OutDir)) ([Windows.Storage.StorageFolder])

if ($Last -le 0 -or $Last -gt $doc.PageCount) { $Last = $doc.PageCount }

for ($p = $First; $p -le $Last; $p++) {
  $page = $doc.GetPage($p - 1)
  $name = ("page_{0:D2}.png" -f $p)
  $newFile = Await ($folder.CreateFileAsync($name, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $stream  = Await ($newFile.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = [uint32]$Width
  AwaitAction ($page.RenderToStreamAsync($stream, $opts))
  $stream.Dispose()
  Write-Output ("rendered {0} ({1}x{2} pt)" -f $name, [int]$page.Size.Width, [int]$page.Size.Height)
}
