const fs = require('fs');
const path = require('path');

const lib = require('./lib.js');

const DIR = lib.DIR || __dirname;
const loadCompanies = lib.loadCompanies;
const matchRole = lib.matchRole;

const API_URL = 'https://www.radarvagas.site/api/jobs';
const MAX_DAYS = 20;

// --------------------------------------------------
// UTILITÁRIOS
// --------------------------------------------------

function norm(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatDate(value) {
  if (!value) return '';

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return '';

  return d.toISOString().slice(0, 10);
}

function ageInDays(value) {
  if (!value) return Infinity;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return Infinity;

  const now = new Date();

  return Math.floor(
    (now.getTime() - d.getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

function uniqueById(rows) {
  const seen = new Set();

  return rows.filter(job => {
    const id =
      job.id ||
      job.public_number ||
      `${job.title}|${job.company_name}`;

    if (seen.has(id)) return false;

    seen.add(id);
    return true;
  });
}

// --------------------------------------------------
// VAGA REAL
// --------------------------------------------------

// O Radar Vagas também gera vagas sintéticas no frontend.
// Aqui aceitamos SOMENTE registros explicitamente provenientes
// do banco/API real.

function isRealJob(job) {
  return (
    job &&
    (
      job.is_from_db === true ||
      job.isRealJob === true
    )
  );
}

// --------------------------------------------------
// GROWTH
// --------------------------------------------------

function isGrowth(job) {
  return /\bgrowth\b/i.test(job.title || '');
}

// --------------------------------------------------
// CARGO
// --------------------------------------------------

function detectRole(title) {
  if (!title) return null;

  // Usa a mesma lógica central do projeto, se disponível.
  if (typeof matchRole === 'function') {
    try {
      return matchRole(title);
    } catch (_) {}
  }

  // Fallback caso lib.js não exponha matchRole.
  const t = norm(title);

  const patterns = [
    /analista de dados/,
    /data analyst/,
    /analista de bi/,
    /business intelligence/,
    /business analyst/,
    /analista de negocios/,
    /inteligencia de negocios/,
    /revenue operations/,
    /\brevops\b/,
    /analista de insights/,
    /inteligencia de mercado/,
    /market intelligence/,
    /analista de planejamento/,
    /analista de estrategia/,
    /analista de operacoes/,
    /analista de performance/,
    /analista de crm/
  ];

  if (patterns.some(rx => rx.test(t))) {
    return 'Analista';
  }

  return null;
}

// --------------------------------------------------
// MODALIDADE / LOCAL
// --------------------------------------------------

function detectWorkplace(job) {
  const type = norm(job.type);
  const modalidade = norm(job.modalidade);
  const location = norm(job.location);

  const remote =
    type === 'remote' ||
    modalidade === 'remoto' ||
    location === 'remoto' ||
    location.includes('home office');

  if (remote) {
    return {
      accepted: true,
      workplaceType: 'Home Office',
      location: 'Home Office',
      reason: 'remote'
    };
  }

  const hybrid =
    type === 'hybrid' ||
    modalidade === 'hibrido' ||
    modalidade === 'híbrido' ||
    location.includes('hibrid') ||
    location.includes('híbr');

  const saoPaulo =
    location.includes('sao paulo') ||
    location === 'sp' ||
    location.includes('/ sp') ||
    location.includes('- sp');

  if (hybrid && saoPaulo) {
    return {
      accepted: true,
      workplaceType: 'Híbrido',
      location: job.location || 'São Paulo / SP',
      reason: 'hybrid_sp'
    };
  }

  return {
    accepted: false,
    workplaceType: '',
    location: job.location || '',
    reason: 'location'
  };
}

// --------------------------------------------------
// EMPRESA
// --------------------------------------------------

function getCompany(job) {
  return String(
    job.company_display_name ||
    job.company_name ||
    job.company ||
    ''
  ).trim();
}

function loadCompanyNames() {
  if (typeof loadCompanies !== 'function') {
    return [];
  }

  try {
    const rows = loadCompanies();

    if (!Array.isArray(rows)) return [];

    return rows
      .map(row => {
        if (typeof row === 'string') return row;

        return (
          row.company ||
          row.companyName ||
          row.name ||
          row.empresa ||
          ''
        );
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function companyIsListed(company, companies) {
  const target = norm(company);

  if (!target) return false;

  return companies.some(name => {
    const n = norm(name);

    return (
      n === target ||
      (n.length >= 5 && target.includes(n)) ||
      (target.length >= 5 && n.includes(target))
    );
  });
}

// --------------------------------------------------
// URL
// --------------------------------------------------

function getJobUrl(job) {
  const identifier =
    job.public_number ||
    job.id;

  return identifier
    ? `https://www.radarvagas.site/vaga/${identifier}`
    : 'https://www.radarvagas.site/';
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------

(async () => {
  const stats = {
    collected: 0,
    fakeDiscarded: 0,
    oldDiscarded: 0,
    noDateDiscarded: 0,
    growthDiscarded: 0,
    compatibleTitles: 0,
    remoteAccepted: 0,
    hybridAccepted: 0,
    locationRejected: 0,
    noCompany: 0,
    listed: 0,
    notListed: 0
  };

  try {
    console.log('[radarvagas] buscando API real...');

    const response = await fetch(API_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} - ${API_URL}`
      );
    }

    const data = await response.json();

    let jobs = Array.isArray(data.jobs)
      ? data.jobs
      : [];

    jobs = uniqueById(jobs);

    stats.collected = jobs.length;

    console.log(
      `[radarvagas] vagas recebidas da API: ${jobs.length}`
    );

    const companies = loadCompanyNames();

    const results = [];

    for (const job of jobs) {

      // 1. SOMENTE VAGA REAL
      if (!isRealJob(job)) {
        stats.fakeDiscarded++;
        continue;
      }

      // 2. DATA
      if (!job.created_at) {
        stats.noDateDiscarded++;
        continue;
      }

      const age = ageInDays(job.created_at);

      if (age < 0 || age > MAX_DAYS) {
        stats.oldDiscarded++;
        continue;
      }

      // 3. GROWTH FORA
      if (isGrowth(job)) {
        stats.growthDiscarded++;
        continue;
      }

      // 4. CARGO
      const role = detectRole(job.title);

      if (!role) {
        continue;
      }

      stats.compatibleTitles++;

      // 5. MODALIDADE
      const workplace = detectWorkplace(job);

      if (!workplace.accepted) {
        stats.locationRejected++;
        continue;
      }

      if (workplace.reason === 'remote') {
        stats.remoteAccepted++;
      }

      if (workplace.reason === 'hybrid_sp') {
        stats.hybridAccepted++;
      }

      // 6. EMPRESA
      const company = getCompany(job);

      if (!company) {
        stats.noCompany++;
      }

      const listed = companyIsListed(
        company,
        companies
      );

      if (listed) {
        stats.listed++;
      } else {
        stats.notListed++;
      }

      results.push({
        platform: 'Radar Vagas',

        companyList: company,
        companyGupy: company,

        na_lista: listed ? 'Sim' : 'Não',

        role,

        jobTitle: job.title || '',

        workplaceType:
          workplace.workplaceType,

        location:
          workplace.location,

        url: getJobUrl(job),

        externalApplyUrl: '',

        publishedDate:
          formatDate(job.created_at)
      });
    }

    results.sort((a, b) =>
      String(b.publishedDate)
        .localeCompare(String(a.publishedDate))
    );

    const output = path.join(
      DIR,
      'radarvagas_results.json'
    );

    fs.writeFileSync(
      output,
      JSON.stringify(results, null, 2),
      'utf8'
    );

    console.log('');
    console.log('==========================================');
    console.log('[radarvagas] RESUMO FINAL');
    console.log('==========================================');

    console.log(
      `[radarvagas] vagas coletadas: ${stats.collected}`
    );

    console.log(
      `[radarvagas] limite de idade: ${MAX_DAYS} dias`
    );

    console.log(
      `[radarvagas] vagas sintéticas descartadas: ${stats.fakeDiscarded}`
    );

    console.log(
      `[radarvagas] vagas antigas descartadas: ${stats.oldDiscarded}`
    );

    console.log(
      `[radarvagas] vagas sem data descartadas: ${stats.noDateDiscarded}`
    );

    console.log(
      `[radarvagas] vagas Growth descartadas: ${stats.growthDiscarded}`
    );

    console.log(
      `[radarvagas] títulos compatíveis dentro do período: ${stats.compatibleTitles}`
    );

    console.log(
      `[radarvagas] Remotas aceitas: ${stats.remoteAccepted}`
    );

    console.log(
      `[radarvagas] Híbridas São Paulo aceitas: ${stats.hybridAccepted}`
    );

    console.log(
      `[radarvagas] rejeitadas por modalidade/local: ${stats.locationRejected}`
    );

    console.log(
      `[radarvagas] sem empresa detectada: ${stats.noCompany}`
    );

    console.log(
      `[radarvagas] TOTAL FINAL: ${results.length}`
    );

    console.log(
      `[radarvagas] empresas da lista=${stats.listed} | fora da lista=${stats.notListed}`
    );

    console.log(
      `[radarvagas] wrote ${results.length} rows -> radarvagas_results.json`
    );

  } catch (error) {
    console.error(
      `[radarvagas] ERRO FATAL: ${error.message}`
    );

    process.exitCode = 1;
  }
})();