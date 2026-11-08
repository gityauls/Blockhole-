# Opens each converted .docx in a fresh, hidden Word, exports it to PDF next to it, and closes that Word again.
# One Word per file: a reused Word piles up hidden prompts and hangs (see FIDELITY.md, problem 15).
# Usage: powershell -File scripts/fidelity/word-look.ps1 <dir with .docx files>
param([Parameter(Mandatory)][string]$Dir)

foreach ($file in Get-ChildItem -Path $Dir -Filter *.docx) {
  $pdf = [IO.Path]::ChangeExtension($file.FullName, ".pdf")
  if (Test-Path $pdf) { Remove-Item $pdf }
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  try {
    $doc = $word.Documents.Open($file.FullName, $false, $true)
    $doc.ExportAsFixedFormat($pdf, 17)
    $doc.Close([ref]0)
  } finally {
    $word.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  }
  "$($file.Name) -> $(Test-Path $pdf)"
}
