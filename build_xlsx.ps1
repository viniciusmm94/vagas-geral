$ErrorActionPreference = 'Stop'

$dir = $PSScriptRoot
$outPath = Join-Path (Split-Path -Parent $dir) 'vagas_consolidadas.xlsx'

# =====================================================================
# ARQUIVOS
# =====================================================================

$vagas = Get-Content "$dir\vagas_merged.json" -Raw -Encoding UTF8 |
  ConvertFrom-Json

$presenca = Get-Content "$dir\presence_combined.json" -Raw -Encoding UTF8 |
  ConvertFrom-Json

$novas = Get-Content "$dir\inhire_new_companies.json" -Raw -Encoding UTF8 |
  ConvertFrom-Json

# =====================================================================
# PREPARA VAGAS PARA EXCEL
# =====================================================================

$vagasExcel = foreach ($v in $vagas) {

  # ---------------------------------------------------------------
  # FONTES
  # ---------------------------------------------------------------

  $fontes = ''

  if (
    $null -ne $v.sources -and
    @($v.sources).Count -gt 0
  ) {

    $fontes = (
      @($v.sources) |
      Where-Object {
        $_
      }
    ) -join ', '

  }
  elseif ($v.source) {

    $fontes = [string]$v.source

  }

  # ---------------------------------------------------------------
  # CATEGORIA
  # ---------------------------------------------------------------

  $categoria = ''

  if ($v.role) {

    $categoria = [string]$v.role

  }

  # ---------------------------------------------------------------
  # DATA
  # ---------------------------------------------------------------

  $publicado = ''

  if ($v.publishedDate) {

    $publicado = [string]$v.publishedDate

  }

  # ---------------------------------------------------------------
  # DETECTADA EM
  # ---------------------------------------------------------------

  $detectado = ''

  if ($v.detectado_em) {

    $detectado = [string]$v.detectado_em

  }

  # ---------------------------------------------------------------
  # RESULTADO
  # ---------------------------------------------------------------

  [PSCustomObject]@{

    empresa =
      [string]$v.company

    plataforma =
      $fontes

    categoria =
      $categoria

    titulo =
      [string]$v.jobTitle

    tipo =
      [string]$v.workplaceType

    local =
      [string]$v.location

    publicado =
      $publicado

    dias =
      [string]$v.ageDays

    senioridade =
      [string]$v.seniority

    link =
      [string]$v.url

    link_original =
      [string]$v.originalUrl

    detectado_em =
      $detectado

  }

}

# =====================================================================
# FUNCAO PARA ESCREVER ABA
# =====================================================================

function Write-Sheet(
  $ws,
  $name,
  $headers,
  $props,
  $rows,
  $linkCols,
  $widths,
  $wrapCols
) {

  $ws.Name = $name

  # ---------------------------------------------------------------
  # CABECALHO
  # ---------------------------------------------------------------

  for (
    $c = 0;
    $c -lt $headers.Count;
    $c++
  ) {

    $ws.Cells.Item(
      1,
      $c + 1
    ) = $headers[$c]

  }

  # ---------------------------------------------------------------
  # DADOS
  # ---------------------------------------------------------------

  $r = 2

  foreach ($row in $rows) {

    for (
      $c = 0;
      $c -lt $props.Count;
      $c++
    ) {

      $prop = $props[$c]

      $val =
        [string]$row.$prop

      $cell =
        $ws.Cells.Item(
          $r,
          $c + 1
        )

      if (
        ($linkCols -contains $prop) -and
        $val
      ) {

        $ws.Hyperlinks.Add(
          $cell,
          $val,
          [System.Reflection.Missing]::Value,
          'Abrir',
          'Abrir'
        ) | Out-Null

      }
      else {

        $cell.Value2 =
          $val

      }

    }

    $r++

  }

  # ---------------------------------------------------------------
  # FORMATACAO
  # ---------------------------------------------------------------

  $lastRow =
    [Math]::Max(
      $r - 1,
      1
    )

  $lastCol =
    $headers.Count

  $hdr =
    $ws.Range(
      $ws.Cells.Item(1, 1),
      $ws.Cells.Item(1, $lastCol)
    )

  $hdr.Font.Bold =
    $true

  $hdr.Interior.Color =
    8210719

  $hdr.Font.Color =
    16777215

  $hdr.HorizontalAlignment =
    -4108

  $ws.Rows.Item(1).RowHeight =
    26

  if (
    $lastRow -ge 1
  ) {

    $ws.Range(
      $ws.Cells.Item(1, 1),
      $ws.Cells.Item(
        $lastRow,
        $lastCol
      )
    ).AutoFilter() |
      Out-Null

  }

  # ---------------------------------------------------------------
  # CONGELAR CABECALHO
  # ---------------------------------------------------------------

  $ws.Activate()

  $excel.ActiveWindow.SplitRow =
    1

  $excel.ActiveWindow.FreezePanes =
    $true

  # ---------------------------------------------------------------
  # LARGURAS
  # ---------------------------------------------------------------

  for (
    $c = 0;
    $c -lt $widths.Count;
    $c++
  ) {

    $ws.Columns.Item(
      $c + 1
    ).ColumnWidth =
      $widths[$c]

  }

  foreach ($wc in $wrapCols) {

    $ws.Columns.Item(
      $wc
    ).WrapText =
      $true

  }

}

# =====================================================================
# VERIFICA LOCK DO EXCEL
# =====================================================================

$lockFile =
  Join-Path (
    Split-Path $outPath
  ) (
    "~`$" +
    (
      Split-Path $outPath -Leaf
    )
  )

if (
  Test-Path -LiteralPath $lockFile
) {

  throw "O arquivo '$outPath' parece estar ABERTO no Excel. Feche-o e rode novamente."

}

# =====================================================================
# EXCEL
# =====================================================================

$excel =
  New-Object -ComObject Excel.Application

$excel.Visible =
  $false

$excel.DisplayAlerts =
  $false

$wb = $null

try {

  $wb =
    $excel.Workbooks.Add()

  while (
    $wb.Worksheets.Count -lt 3
  ) {

    $wb.Worksheets.Add() |
      Out-Null

  }

  # ===================================================================
  # ABA 1 - VAGAS
  # ===================================================================

  $ws1 =
    $wb.Worksheets.Item(1)

  Write-Sheet `
    $ws1 `
    'Vagas' `
    @(
      'Empresa',
      'Plataforma(s)',
      'Categoria',
      'Titulo da Vaga',
      'Tipo',
      'Local',
      'Publicado',
      'Dias',
      'Senioridade',
      'Link para Candidatura',
      'Link Original',
      'Detectada em'
    ) `
    @(
      'empresa',
      'plataforma',
      'categoria',
      'titulo',
      'tipo',
      'local',
      'publicado',
      'dias',
      'senioridade',
      'link',
      'link_original',
      'detectado_em'
    ) `
    $vagasExcel `
    @(
      'link',
      'link_original'
    ) `
    @(
      28,
      20,
      20,
      48,
      12,
      24,
      13,
      8,
      14,
      22,
      20,
      14
    ) `
    @(
      4
    )

  # ===================================================================
  # ABA 2 - PRESENCA
  # ===================================================================

  $ws2 =
    $wb.Worksheets.Item(2)

  Write-Sheet `
    $ws2 `
    'Presenca por Empresa' `
    @(
      'Empresa',
      'Tem Gupy?',
      'Pagina Gupy',
      'Tem InHire?',
      'Pagina InHire',
      'Total Vagas InHire'
    ) `
    @(
      'empresa',
      'gupy',
      'gupy_url',
      'inhire',
      'inhire_url',
      'inhire_vagas_total'
    ) `
    $presenca `
    @(
      'gupy_url',
      'inhire_url'
    ) `
    @(
      30,
      10,
      44,
      11,
      44,
      16
    ) `
    @()

  # ===================================================================
  # ABA 3 - INHIRE NOVAS
  # ===================================================================

  $ws3 =
    $wb.Worksheets.Item(3)

  Write-Sheet `
    $ws3 `
    'InHire novas (fora da lista)' `
    @(
      'Empresa',
      'Total de Vagas Abertas',
      'Pagina de Carreiras'
    ) `
    @(
      'empresa',
      'vagas_total',
      'url'
    ) `
    $novas `
    @(
      'url'
    ) `
    @(
      38,
      20,
      46
    ) `
    @()

  # ===================================================================
  # SALVAR
  # ===================================================================

  $ws1.Activate()

  $wb.SaveAs(
    $outPath,
    51
  )

  Write-Output ""

  Write-Output "=========================================="
  Write-Output "EXCEL GERADO"
  Write-Output "=========================================="

  Write-Output "Vagas: $($vagasExcel.Count)"
  Write-Output "Presenca: $($presenca.Count)"
  Write-Output "InHire novas: $($novas.Count)"

  Write-Output ""

  Write-Output "Arquivo:"
  Write-Output "$outPath"

  Write-Output "=========================================="

}
finally {

  if ($wb) {

    try {

      $wb.Close(
        $false
      )

    }
    catch {}

  }

  try {

    $excel.Quit()

  }
  catch {}

  [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
    $excel
  ) |
    Out-Null

  [GC]::Collect()

  [GC]::WaitForPendingFinalizers()

}