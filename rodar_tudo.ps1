# =====================================================================
# Pipeline completo de busca de vagas
# Gupy + InHire + Nerdin
#
# Uso:
# powershell -ExecutionPolicy Bypass -File rodar_tudo.ps1
#
# (opcional) atualize antes o arquivo empresas.xlsx com sua lista.
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

  # Reset do exit code.
  #
  # Etapas PowerShell / Excel podem nao alterar $LASTEXITCODE.
  # Sem isso, um valor herdado de uma etapa anterior poderia
  # gerar falso erro.
  #
  # Node retorna exit code diferente de 0 quando ocorre falha.

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
Write-Host " BUSCA DE VAGAS - PIPELINE COMPLETO" -ForegroundColor Yellow
Write-Host " Gupy + InHire + Nerdin + Trampos" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Yellow

# =====================================================================
# EMPRESAS
# =====================================================================

Step 1 `
  "Extrair empresas do xlsx -> companies.json" `
  {
    & "$dir\extrair_empresas.ps1"
  }

# =====================================================================
# GUPY
# =====================================================================

Step 2 `
  "Gupy: buscar vagas (API global) + presenca pool" `
  {
    node "$dir\gupy.js"
  }

Step 3 `
  "Gupy: presenca real por subdominio" `
  {
    node "$dir\gupy_presence_full.js"
  }

# =====================================================================
# INHIRE
# =====================================================================

Step 4 `
  "InHire: chute de slug a partir da sua lista" `
  {
    node "$dir\inhire.js"
  }

Step 5 `
  "InHire: coletar slugs da web (Wayback/urlscan/CC)" `
  {
    node "$dir\harvest_inhire.js"
  }

Step 6 `
  "InHire: validar todos os slugs na API" `
  {
    node "$dir\validate_inhire.js"
  }

Step 7 `
  "InHire: gerar saidas (vagas + empresas novas)" `
  {
    node "$dir\inhire_saida.js"
  }

# =====================================================================
# NERDIN
# =====================================================================

Step 8 `
  "Nerdin: buscar vagas Home Office + Hibrido SP (ate 20 dias)" `
  {
    node "$dir\nerdin.js"
  }

# =====================================================================
# TRAMPOS
# =====================================================================

Step 9 `
  "Trampos: buscar vagas com link direto de candidatura" `
  {
    node "$dir\trampos.js"
  }

# =====================================================================
# CONSOLIDACAO
# =====================================================================

Step 10 `
  "Consolidar Gupy + InHire + Nerdin + Trampos e deduplicar -> vagas_final.json" `
  {
    node "$dir\merge.js"
  }

# =====================================================================
# DATA DE DETECCAO
# =====================================================================

Step 11 `
  "Carimbar data de deteccao (novas = hoje)" `
  {
    node "$dir\stamp_dates.js"
  }

# =====================================================================
# PRESENCA DE EMPRESAS
# =====================================================================

Step 12 `
  "Montar tabela de presenca" `
  {
    node "$dir\presence.js"
  }

# =====================================================================
# EXCEL
# =====================================================================

Step 13 `
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

Write-Host "Fontes processadas:" -ForegroundColor Green
Write-Host " - Gupy" -ForegroundColor Green
Write-Host " - InHire" -ForegroundColor Green
Write-Host " - Nerdin" -ForegroundColor Green
Write-Host " - Trampos" -ForegroundColor Green

Write-Host ""

Write-Host "Resultado JSON:" -ForegroundColor Green
Write-Host " $dir\vagas_final.json" -ForegroundColor Green

Write-Host ""

Write-Host "Planilha:" -ForegroundColor Green
Write-Host " ..\vagas_gupy_inhire.xlsx" -ForegroundColor Green

Write-Host ""