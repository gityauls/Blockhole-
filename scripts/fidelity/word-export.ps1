# Opens each .docx in the running Word, exports it as PDF and reports pages and tables.
# Close earlier copies in a separate step first: reopening a file Word has just closed, or one it still
# holds open, makes Word wait on a hidden prompt.
# Usage: powershell -File scripts/fidelity/word-export.ps1 <out dir> <file.docx> [file.docx...]
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $args[0] | Out-Null
$outDir = (Resolve-Path $args[0]).Path
$w = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
foreach ($file in $args[1..($args.Count - 1)]) {
  $path = (Resolve-Path $file).Path
  $name = [IO.Path]::GetFileNameWithoutExtension($path)
  $target = Join-Path $outDir "$name.pdf"
  try {
    $doc = $w.Documents.Open($path)
    $doc.ExportAsFixedFormat($target, 17)
    "$name : opened, pages=$($doc.ComputeStatistics(2)) tables=$($doc.Tables.Count)"
    $doc.Close(0)
  } catch {
    "$name : FAILED - $($_.Exception.Message)"
  }
}
