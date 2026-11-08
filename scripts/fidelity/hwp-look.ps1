# Opens each .docx in 한글 (Hancom Office) and saves it as PDF next to it, to see how 한글 lays out our output.
# 한글 asks to approve file access unless an automation security module is registered, so its window is shown:
# approve the prompt ("모두 허용") once and the rest run on their own.
# Usage: powershell -File scripts/fidelity/hwp-look.ps1 <dir with .docx files>
param([Parameter(Mandatory)][string]$Dir)

$hwp = New-Object -ComObject HWPFrame.HwpObject
$hwp.XHwpWindows.Item(0).Visible = $true
try {
  foreach ($file in Get-ChildItem -Path $Dir -Filter *.docx) {
    $pdf = [IO.Path]::ChangeExtension($file.FullName, ".hwp.pdf")
    if (Test-Path $pdf) { Remove-Item $pdf }
    $started = Get-Date
    $opened = $hwp.Open($file.FullName, "", "forceopen:true")
    "$($file.Name): open=$opened after $([int]((Get-Date) - $started).TotalSeconds)s"
    if (-not $opened) { "$($file.Name): open failed"; continue }
    $saved = $hwp.SaveAs($pdf, "PDF", "")
    "$($file.Name) -> $saved"
    $hwp.Clear(1) | Out-Null
  }
} finally {
  $hwp.Quit()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($hwp) | Out-Null
}
