# Word helpers for fidelity checks.
#   -Mode reflow : open each PDF with Word's own PDF converter and save it as .docx (benchmark)
#   -Mode topdf  : open each .docx in Word and export it as PDF. Prefer word-export.ps1, which avoids the hidden prompts (FIDELITY.md #15)
# Usage: powershell -File word-tools.ps1 -Mode reflow -In <dir of .pdf> -Out <dir>
#   -NewInstance : use a separate hidden Word instead of the one already open
param([string]$Mode, [string]$In, [string]$Out, [switch]$NewInstance)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$In = (Resolve-Path $In).Path
$Out = (Resolve-Path $Out).Path

$word = $null
$ownWord = $true
if (-not $NewInstance) {
  try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application"); $ownWord = $false } catch {}
}
if (-not $word) { $word = New-Object -ComObject Word.Application }
$alerts = $word.DisplayAlerts
# Word's PDF converter asks for confirmation; this check has no one to answer it.
# Only reflow needs this: with alerts off, exporting an opened .docx hangs.
if ($Mode -eq "reflow") { $word.DisplayAlerts = 0 }

try {
  $filter = $(if ($Mode -eq "reflow") { "*.pdf" } else { "*.docx" })
  foreach ($file in Get-ChildItem $In -Filter $filter) {
    $name = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    try {
      # Word cannot open two documents with the same name; close an earlier copy from this check.
      foreach ($open in @($word.Documents)) { if ($open.Name -eq $file.Name -and $open.FullName -like "*fidelity*") { $open.Close(0) } }
      # Opened normally: a read-only document hangs on export. Nothing is saved over the source.
      $doc = $(if ($Mode -eq "reflow") { $word.Documents.Open($file.FullName, $false) } else { $word.Documents.Open($file.FullName) })
      if ($Mode -eq "reflow") {
        $doc.SaveAs2((Join-Path $Out "$name.docx"), 16)
      } else {
        # Exporting over an existing file waits on a hidden overwrite prompt, so remove the old output first.
        $target = Join-Path $Out "$name.pdf"
        if (Test-Path $target) { Remove-Item $target }
        $doc.ExportAsFixedFormat($target, 17)
      }
      Write-Output "$name : opened, pages=$($doc.ComputeStatistics(2)) tables=$($doc.Tables.Count)"
      $doc.Close(0)
    } catch {
      Write-Output "$name : FAILED - $($_.Exception.Message)"
    }
  }
} finally {
  $word.DisplayAlerts = $alerts
  if ($ownWord) { $word.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
