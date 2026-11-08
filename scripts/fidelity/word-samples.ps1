# Builds the Word table samples in real Word and saves each as .docx (the answer key) and .pdf (Word's own export).
# Usage: powershell -File scripts/fidelity/word-samples.ps1 -Spec scripts/fidelity/word-samples.json -Out docs/research/fidelity/samples/word
param([string]$Spec, [string]$Out)
$ErrorActionPreference = "Stop"

$config = Get-Content -Raw -Encoding UTF8 $Spec | ConvertFrom-Json
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$CM = 28.3465
$HEADER_SHADE = 0xD9D9D9  # BGR, light grey

try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application"); $ownWord = $false }
catch { $word = New-Object -ComObject Word.Application; $ownWord = $true }

function Text($value) { ([string]$value) -replace "`n", "`r" }

function Fill-Table($doc, $t, $s) {
  $rows = $s.rows.Count
  $t.Borders.Enable = 1
  $t.Range.ParagraphFormat.SpaceAfter = 0
  $t.Range.ParagraphFormat.SpaceBefore = 0
  $t.Range.Font.Size = $(if ($s.size) { $s.size } else { 9 })
  $t.Range.Cells.VerticalAlignment = 1
  $t.Range.ParagraphFormat.Alignment = 1
  for ($c = 1; $c -le $s.widths.Count; $c++) { $t.Columns.Item($c).Width = [single]([double]$s.widths[$c - 1] * $CM) }

  for ($r = 1; $r -le $rows; $r++) {
    $cells = $s.rows[$r - 1]
    for ($c = 1; $c -le $cells.Count; $c++) {
      $t.Cell($r, $c).Range.Text = Text $cells[$c - 1]
      if ($s.leftBody -and $c -gt 1 -and $r -gt $s.header) { $t.Cell($r, $c).Range.ParagraphFormat.Alignment = 0 }
    }
  }
  # Row-wide formatting must come before merges: Word refuses row access once cells are merged vertically.
  for ($r = 1; $r -le $s.header; $r++) {
    $t.Rows.Item($r).Shading.BackgroundPatternColor = $HEADER_SHADE
    $t.Rows.Item($r).Range.Font.Bold = 1
    if ($s.repeatHeader) { $t.Rows.Item($r).HeadingFormat = -1 }
  }
  # Merges run bottom-right first so earlier cell numbers stay valid.
  foreach ($m in $s.merge) {
    $keep = Text $s.rows[$m[0] - 1][$m[1] - 1]
    $t.Cell($m[0], $m[1]).Merge($t.Cell($m[2], $m[3]))
    $t.Cell($m[0], $m[1]).Range.Text = $keep
  }
  if ($s.nested) {
    $cell = $t.Cell($s.nested.cell[0], $s.nested.cell[1])
    foreach ($p in $cell.Range.Paragraphs) {
      if ($p.Range.Text.Trim([char]13, [char]7, ' ') -eq "[NESTED]") {
        $spot = $p.Range
        $spot.MoveEnd(1, -1) | Out-Null
        $spot.Text = ""
        $inner = $doc.Tables.Add($spot, $s.nested.table.rows.Count, $s.nested.table.widths.Count)
        Fill-Table $doc $inner $s.nested.table
        break
      }
    }
  }
}

function End-Range($doc) { $r = $doc.Content; $r.Collapse(0); $r }

$alerts = $word.DisplayAlerts
try {
  foreach ($sample in $config.samples) {
    $doc = $word.Documents.Add()
    $doc.PageSetup.PageWidth = 595.3
    $doc.PageSetup.PageHeight = 841.9
    foreach ($side in "TopMargin", "BottomMargin", "LeftMargin", "RightMargin") { $doc.PageSetup.$side = 2 * $CM }
    $normal = $doc.Styles.Item(-1)
    $normal.Font.Name = $config.font
    $normal.Font.NameFarEast = $config.font
    $normal.Font.Size = 10
    $normal.ParagraphFormat.SpaceAfter = 4
    $normal.ParagraphFormat.LineSpacingRule = 0

    foreach ($block in $sample.blocks) {
      if ($block.table) {
        $s = $block.table
        $t = $doc.Tables.Add((End-Range $doc), $s.rows.Count, $s.widths.Count)
        Fill-Table $doc $t $s
      } else {
        $r = End-Range $doc
        $r.Text = Text $block.p
        $r.Font.Bold = [int][bool]$block.bold
        $r.Font.Size = $(if ($block.size) { $block.size } else { 10 })
        $r.ParagraphFormat.Alignment = $(if ($block.center) { 1 } else { 0 })
        $r.InsertParagraphAfter()
      }
    }

    $base = Join-Path $Out $sample.name
    $doc.SaveAs2("$base.docx", 16)
    $doc.SaveAs2("$base.pdf", 17)
    Write-Output "$($sample.name): pages=$($doc.ComputeStatistics(2)) tables=$($doc.Tables.Count)"
    $doc.Close(0)
  }
} finally {
  $word.DisplayAlerts = $alerts
  if ($ownWord) { $word.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
