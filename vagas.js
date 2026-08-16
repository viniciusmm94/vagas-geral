const fs = require('fs');
const path = require('path');

const {
  DIR,
  matchRole
} = require('./lib.js');

const API =
  'https://api-candidato.vagas.com.br/v2/vagas/recomendacao_ia/pt-BR';

const MAX_AGE_DAYS = 20;
const PER_PAGE = 24;
const CITY_SP = '88412';

const TOKEN = process.env.VAGAS_TOKEN;

if (!TOKEN) {
  console.error(
    '\n[vagas] ERRO: variável VAGAS_TOKEN não definida.\n'
  );

  console.error(
    'PowerShell:\n' +
    '$env:VAGAS_TOKEN="SEU_TOKEN"\n' +
    'node vagas.js\n'
  );

  process.exit(1);
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseBrazilianDate(value) {
  if (!value) return null;

  const parts = String(value).split('/');

  if (parts.length !== 3) {
    return null;
  }

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);

  if (!day || !month || !year) {
    return null;
  }

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0
  );
}

function ageInDays(value) {
  const date = parseBrazilianDate(value);

  if (!date) {
    return null;
  }

  const now = new Date();

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0
  );

  return Math.floor(
    (today - date) /
    (1000 * 60 * 60 * 24)
  );
}

// ============================================================
// CARGO
// ============================================================

function getRole(title) {
  return matchRole(title);
}

// ============================================================
// MODALIDADE
// ============================================================

function getWorkplace(job) {
  const type = normalize(
    job.type_of_workplace
  );

  const location = normalize(
    job.location
  );

  const title = normalize(
    job.vacancy_title
  );

  const accepts = normalize(
    job.accepts_candidates_from
  );

  const combined = [
    type,
    location,
    title,
    accepts
  ].join(' ');

  // Remoto explícito
  if (
    job.remote === true ||
    /\bremoto\b/.test(combined) ||
    /\bremote\b/.test(combined) ||
    /\b100% home office\b/.test(combined) ||
    /\b100% remoto\b/.test(combined)
  ) {
    return 'Remoto';
  }

  // Empresa + Home Office = híbrido
  if (
    type.includes('empresa e home office') ||
    type.includes('hibrido') ||
    type.includes('hybrid')
  ) {
    return 'Híbrido';
  }

  // Apenas empresa
  if (
    type === 'empresa' ||
    type.includes('presencial')
  ) {
    return 'Presencial';
  }

  return 'Não identificado';
}

function isSaoPaulo(job) {
  const location = normalize(
    job.location
  );

  return (
    location.includes('sao paulo') ||
    location.includes('sp - br')
  );
}

// ============================================================
// API
// ============================================================

function buildUrl(page) {
  const params = new URLSearchParams();

  params.append('page', String(page));
  params.append('per_page', String(PER_PAGE));

  /*
    Usamos "analista" como busca ampla.

    Depois o matchRole() do lib.js decide
    quais cargos realmente interessam.
  */
  params.append(
    'termos[]',
    'analista'
  );

  params.append(
    'cidades[]',
    CITY_SP
  );

  /*
    Mantemos os mesmos parâmetros observados
    na chamada real do Vagas.com.
  */
  params.append(
    'modelos_trabalho[]',
    '2'
  );

  params.append(
    'contratos[]',
    '1'
  );

  params.append(
    'contratos[]',
    '4'
  );

  return `${API}?${params.toString()}`;
}

async function fetchPage(page) {
  const url = buildUrl(page);

  console.log(
    `[vagas] página ${page}`
  );

  const response = await fetch(
    url,
    {
      method: 'GET',

      headers: {
        Accept:
          'application/json, text/plain, */*',

        Authorization:
          `Bearer ${TOKEN}`,

        Origin:
          'https://www.vagas.com.br',

        Referer:
          'https://www.vagas.com.br/',

        'User-Agent':
          'Mozilla/5.0'
      }
    }
  );

  if (response.status === 401) {
    throw new Error(
      'Token expirado ou inválido (HTTP 401).'
    );
  }

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `HTTP ${response.status} ${response.statusText}\n` +
      text.slice(0, 500)
    );
  }

  return response.json();
}

// ============================================================
// NORMALIZAÇÃO DA VAGA
// ============================================================

function normalizeJob(job, role, workplaceType) {
  const company =
    job.company_name ||
    (
      job.confidential
        ? 'Confidencial'
        : ''
    );

  return {
    source: 'Vagas.com',

    id:
      job.cod_vaga || null,

    company,

    jobTitle:
      job.vacancy_title || '',

    role,

    level:
      job.level || '',

    workplaceType,

    location:
      job.location || '',

    openingDate:
      job.opening_date || '',

    contractualModel:
      job.contractual_model || '',

    salaryMin:
      job.minSalary || null,

    salaryMax:
      job.maxSalary || null,

    url:
      job.url || '',

    externalApplyUrl:
      job.external_url || null,

    alreadyApplied:
      job.already_applied === true,

    pcd:
      job.pcd === true
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log(
    '\n=========================================='
  );

  console.log(
    'VAGAS.COM'
  );

  console.log(
    '==========================================\n'
  );

  let page = 1;
  let totalPages = 1;

  let receivedCount = 0;
  let oldCount = 0;
  let invalidDateCount = 0;
  let roleRejectedCount = 0;
  let roleAcceptedCount = 0;

  let remoteCount = 0;
  let hybridSPCount = 0;

  let presencialRejected = 0;
  let unidentifiedRejected = 0;
  let hybridOutsideSPRejected = 0;

  let duplicateCount = 0;

  const results = [];
  const seen = new Set();

  while (
    page <= totalPages
  ) {
    const data =
      await fetchPage(page);

    const jobs =
      Array.isArray(
        data.candidato_versus_vaga
      )
        ? data.candidato_versus_vaga
        : [];

    receivedCount +=
      jobs.length;

    if (
      data.meta &&
      Number(data.meta.total_pages)
    ) {
      totalPages =
        Number(
          data.meta.total_pages
        );
    }

    console.log(
      `[vagas] recebidas: ${jobs.length}`
    );

    console.log(
      `[vagas] páginas: ${page}/${totalPages}`
    );

    for (
      const job of jobs
    ) {
      // ------------------------------------------------------
      // DATA
      // ------------------------------------------------------

      const age =
        ageInDays(
          job.opening_date
        );

      if (age === null) {
        invalidDateCount++;
        continue;
      }

      if (
        age < 0 ||
        age > MAX_AGE_DAYS
      ) {
        oldCount++;
        continue;
      }

      // ------------------------------------------------------
      // CARGO
      // ------------------------------------------------------

      const title =
        String(
          job.vacancy_title ||
          ''
        ).trim();

      const role =
        getRole(title);

      if (!role) {
        roleRejectedCount++;
        continue;
      }

      roleAcceptedCount++;

      // ------------------------------------------------------
      // MODALIDADE
      // ------------------------------------------------------

      const workplaceType =
        getWorkplace(job);

      if (
        workplaceType ===
        'Presencial'
      ) {
        presencialRejected++;
        continue;
      }

      if (
        workplaceType ===
        'Não identificado'
      ) {
        unidentifiedRejected++;
        continue;
      }

      if (
        workplaceType ===
        'Híbrido'
      ) {
        if (
          !isSaoPaulo(job)
        ) {
          hybridOutsideSPRejected++;
          continue;
        }

        hybridSPCount++;
      }

      if (
        workplaceType ===
        'Remoto'
      ) {
        remoteCount++;
      }

      // ------------------------------------------------------
      // DEDUP
      // ------------------------------------------------------

      const key =
        job.cod_vaga
          ? String(job.cod_vaga)
          : normalize(
              `${title}|${job.company_name}|${job.location}`
            );

      if (
        seen.has(key)
      ) {
        duplicateCount++;
        continue;
      }

      seen.add(key);

      results.push(
        normalizeJob(
          job,
          role,
          workplaceType
        )
      );
    }

    page++;

    if (
      page <= totalPages
    ) {
      await sleep(500);
    }
  }

  // ==========================================================
  // ARQUIVO
  // ==========================================================

  const outputFile =
    path.join(
      DIR,
      'vagas_results.json'
    );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      results,
      null,
      2
    ),
    'utf8'
  );

  // ==========================================================
  // RESUMO
  // ==========================================================

  console.log(
    '\n=========================================='
  );

  console.log(
    '[vagas] RESUMO FINAL'
  );

  console.log(
    '=========================================='
  );

  console.log(
    `[vagas] vagas recebidas: ${receivedCount}`
  );

  console.log(
    `[vagas] limite de idade: ${MAX_AGE_DAYS} dias`
  );

  console.log(
    `[vagas] vagas antigas descartadas: ${oldCount}`
  );

  console.log(
    `[vagas] datas inválidas descartadas: ${invalidDateCount}`
  );

  console.log(
    `[vagas] títulos incompatíveis descartados: ${roleRejectedCount}`
  );

  console.log(
    `[vagas] títulos compatíveis dentro do período: ${roleAcceptedCount}`
  );

  console.log(
    `[vagas] presenciais descartadas: ${presencialRejected}`
  );

  console.log(
    `[vagas] modalidade não identificada descartada: ${unidentifiedRejected}`
  );

  console.log(
    `[vagas] híbridas fora de São Paulo descartadas: ${hybridOutsideSPRejected}`
  );

  console.log(
    `[vagas] Remotas aceitas: ${remoteCount}`
  );

  console.log(
    `[vagas] Híbridas São Paulo aceitas: ${hybridSPCount}`
  );

  console.log(
    `[vagas] duplicadas descartadas: ${duplicateCount}`
  );

  console.log(
    `[vagas] TOTAL FINAL: ${results.length}`
  );

  console.log(
    `[vagas] wrote ${results.length} rows -> vagas_results.json`
  );

  console.log(
    '==========================================\n'
  );
}

main().catch(error => {
  console.error(
    '\n[vagas] ERRO:'
  );

  console.error(
    error.message ||
    error
  );

  process.exit(1);
});