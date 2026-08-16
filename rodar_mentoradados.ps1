# =====================================================================
# Pipeline simplificado para atualizar com Mentora Dados
# Reutiliza Gupy + InHire + Nerdin + Trampos existentes
#
# Uso:
# powershell -ExecutionPolicy Bypass -File rodar_mentoradados.ps1
#
# Este script executa apenas:
# 1. mentoradados.js (coleta nova)
# 2. merge.js (consolida com plataformas existentes)
# 3. stamp_dates.js (carimba datas)
# 4. presence.js (tabela de presença)
# 5. build_xlsx.ps1 (gera planilha Excel)
# =====================================================================

$ErrorActionPreference = 'Stop'

$dir = $PSScriptRoot

Set-Location $dir

# =====================================================================
# FUNCAO PARA EXECUTAR CADA ETAPA
# =====================================================================

function Step($n, $desc, $cmd) {

  Write-Host ""

  Write-Host "==== [$n] $desc ====" -ForegroundColor Cyan

  $global:LASTEXITCODE = 0

  & $cmd

  if ($LASTEXITCODE -ne 0) {

    throw "Falhou na etapa: $desc (exit $LASTEXITCODE)"

  }

}

# =====================================================================
# VERIFICA NODE
# =====================================================================

try {

  $null = (
    Get-Command node -ErrorAction Stop
  )

}
catch {

  throw "Node.js nao encontrado no PATH. Instale o Node (https://nodejs.org)."

}

# =====================================================================
# INICIO
# =====================================================================

$t0 = Get-Date

Write-Host ""

Write-Host "==========================================" -ForegroundColor Yellow
Write-Host " MENTORA DADOS - ATUALIZAR PIPELINE" -ForegroundColor Yellow
Write-Host " (reutiliza Gupy + InHire + Nerdin + Trampos)" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Yellow

# =====================================================================
# MENTORA DADOS
# =====================================================================

Step 1 `
  "Mentora Dados: buscar vagas agregadas com URLs externas" `
  {
    node "$dir\mentoradados.js"
  }

# =====================================================================
# CONSOLIDACAO
# =====================================================================

Step 2 `
  "Consolidar Gupy + InHire + Nerdin + Trampos + Mentora Dados e deduplicar" `
  {
    node "$dir\merge.js"
  }

# =====================================================================
# DATA DE DETECCAO
# =====================================================================

Step 3 `
  "Carimbar data de deteccao (novas = hoje)" `
  {
    node "$dir\stamp_dates.js"
  }

# =====================================================================
# PRESENCA DE EMPRESAS
# =====================================================================

Step 4 `
  "Montar tabela de presenca" `
  {
    node "$dir\presence.js"
  }

# =====================================================================
# EXCEL
# =====================================================================

Step 5 `
  "Gerar planilha final (Excel, 3 abas)" `
  {
    & "$dir\build_xlsx.ps1"
  }

# =====================================================================
# FINAL
# =====================================================================

$mins = [math]::Round(
  (
    (Get-Date) - $t0
  ).TotalMinutes,
  1
)

Write-Host ""

Write-Host "==========================================" -ForegroundColor Green
Write-Host " CONCLUIDO em $mins min" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

Write-Host ""

Write-Host "Plataformas utilizadas:" -ForegroundColor Green
Write-Host " - Gupy (reutilizado)" -ForegroundColor Green
Write-Host " - InHire (reutilizado)" -ForegroundColor Green
Write-Host " - Nerdin (reutilizado)" -ForegroundColor Green
Write-Host " - Trampos (reutilizado)" -ForegroundColor Green
Write-Host " - Mentora Dados (novo)" -ForegroundColor Green

Write-Host ""

Write-Host "Resultado JSON:" -ForegroundColor Green
Write-Host " $dir\vagas_final.json" -ForegroundColor Green

Write-Host ""

Write-Host "Planilha:" -ForegroundColor Green
Write-Host " ..\vagas_consolidadas.xlsx" -ForegroundColor Green

Write-Host ""
