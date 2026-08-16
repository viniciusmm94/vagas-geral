const fs = require('fs');
const path = require('path');

const {
  DIR,
  loadCompanies,
  compact,
  matchRole,
  sleep
} = require('./lib.js');

const BASE_URL =
  'https://trampos.co';

const API_URL =
  `${BASE_URL}/api/v2/opportunities/`;

const MAX_AGE_DAYS = 20;

const CONCURRENCY = 5;

const FALLBACK_CONCURRENCY = 3;

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

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function stripTags(value) {
  return decodeHtml(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|span|li|section|article|h1|h2|h3|h4)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function formatDateISO(date) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      '0'
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      '0'
    );

  return `${year}-${month}-${day}`;
}

// ============================================================
// HTTP
// ============================================================

async function fetchJson(url) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const response =
        await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',

            Accept:
              'application/json'
          }
        });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} - ${url}`
        );
      }

      return await response.json();

    } catch (error) {
      lastError =
        error;

      if (attempt < 3) {
        await sleep(
          attempt * 500
        );
      }
    }
  }

  throw lastError;
}

async function fetchHtml(url) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const response =
        await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',

            Accept:
              'text/html,application/xhtml+xml'
          }
        });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} - ${url}`
        );
      }

      return await response.text();

    } catch (error) {
      lastError =
        error;

      if (attempt < 3) {
        await sleep(
          attempt * 500
        );
      }
    }
  }

  throw lastError;
}

// ============================================================
// DATA
// ============================================================

function publishedDateISO(value) {
  if (!value) {
    return '';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return '';
  }

  return formatDateISO(
    date
  );
}

function getAgeInDays(value) {
  if (!value) {
    return null;
  }

  const published =
    new Date(value);

  if (
    Number.isNaN(
      published.getTime()
    )
  ) {
    return null;
  }

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  published.setHours(
    0,
    0,
    0,
    0
  );

  const diff =
    today.getTime() -
    published.getTime();

  return Math.floor(
    diff /
    (
      1000 *
      60 *
      60 *
      24
    )
  );
}

function isWithinAge(value) {
  const age =
    getAgeInDays(
      value
    );

  if (age === null) {
    return false;
  }

  return (
    age >= 0 &&
    age <= MAX_AGE_DAYS
  );
}

// ============================================================
// EMPRESA
// ============================================================

function extractCompany(job) {
  const custom =
    String(
      job.custom_company_name ||
      ''
    ).trim();

  if (custom) {
    return custom;
  }

  if (
    job.company &&
    job.company.name
  ) {
    return String(
      job.company.name
    ).trim();
  }

  return '';
}

function isSuspiciousCompany(name) {
  const n =
    normalize(name);

  if (!n) {
    return true;
  }

  const suspicious = [
    'trampos',
    'trampos.co',
    'confidencial'
  ];

  return suspicious.includes(
    n
  );
}

// ============================================================
// MODALIDADE
// ============================================================

function getWorkplaceType(job) {
  if (
    job.home_office === true
  ) {
    return 'Home Office';
  }

  if (
    job.hybrid === true
  ) {
    return 'Híbrido';
  }

  return 'Presencial';
}

function getLocation(
  job,
  workplaceType
) {
  if (
    workplaceType ===
    'Home Office'
  ) {
    return 'Home Office';
  }

  const city =
    String(
      job.city ||
      ''
    ).trim();

  const state =
    String(
      job.state ||
      ''
    ).trim();

  if (
    city &&
    state
  ) {
    return (
      `${city} / ${state}`
    );
  }

  if (city) {
    return city;
  }

  if (state) {
    return state;
  }

  return '';
}

// ============================================================
// FILTRO MODALIDADE / LOCAL
// ============================================================

function isRemoteOrHybridSP(
  workplace,
  location
) {
  const w =
    normalize(
      workplace
    );

  const l =
    normalize(
      location
    );

  if (
    w.includes(
      'home office'
    ) ||
    w.includes(
      'remoto'
    ) ||
    w.includes(
      'remote'
    )
  ) {
    return true;
  }

  if (
    !w.includes(
      'hibrido'
    )
  ) {
    return false;
  }

  return (
    l.includes(
      'sao paulo'
    )
  );
}

// ============================================================
// URL DA VAGA
// ============================================================

function buildJobUrl(job) {
  const id =
    job.id;

  const slug =
    slugify(
      job.name
    );

  if (
    id &&
    slug
  ) {
    return (
      `${BASE_URL}/oportunidades/${id}-${slug}`
    );
  }

  if (id) {
    return (
      `${BASE_URL}/oportunidades/${id}`
    );
  }

  return '';
}

// ============================================================
// FALLBACK DE EMPRESA PELA PÁGINA INDIVIDUAL
// ============================================================

function extractCompanyFromPage(
  html,
  title
) {
  const text =
    stripTags(
      html
    );

  const lines =
    text
      .split('\n')
      .map(
        line =>
          line
            .replace(
              /\s+/g,
              ' '
            )
            .trim()
      )
      .filter(Boolean);

  const normalizedTitle =
    normalize(title);

  const titleIndex =
    lines.findIndex(
      line =>
        normalize(line) ===
        normalizedTitle
    );

  if (titleIndex < 0) {
    return '';
  }

  const candidates =
    lines.slice(
      titleIndex + 1,
      titleIndex + 20
    );

  for (
    const candidate of candidates
  ) {
    const n =
      normalize(candidate);

    if (!n) {
      continue;
    }

    if (
      n === normalizedTitle
    ) {
      continue;
    }

    if (
      n === 'trampos' ||
      n === 'trampos.co'
    ) {
      continue;
    }

    if (
      /^(home office|remoto|hibrido|híbrido|presencial)$/i.test(
        candidate
      )
    ) {
      continue;
    }

    if (
      /^(emprego|estagio|estágio|freela|trainee)$/i.test(
        candidate
      )
    ) {
      continue;
    }

    if (
      /^(sao paulo|rio de janeiro|porto alegre|curitiba|brasilia)\s*\/\s*[A-Z]{2}$/i.test(
        candidate
      )
    ) {
      continue;
    }

    if (
      /salario|salário|beneficios|benefícios|requisitos|descricao|descrição|candidatar/i.test(
        candidate
      )
    ) {
      continue;
    }

    if (
      candidate.length < 2 ||
      candidate.length > 120
    ) {
      continue;
    }

    return candidate;
  }

  return '';
}

async function fixCompanyFromPage(
  row
) {
  try {
    const html =
      await fetchHtml(
        row.url
      );

    const pageCompany =
      extractCompanyFromPage(
        html,
        row.jobTitle
      );

    if (
      pageCompany &&
      !isSuspiciousCompany(
        pageCompany
      )
    ) {
      row.companyRaw =
        pageCompany;

      row.companyFixed =
        true;
    }

  } catch (error) {
    console.log(
      `[trampos] fallback empresa falhou em ${row.url}: ${error.message}`
    );
  }

  return row;
}

// ============================================================
// PAGINAÇÃO
// ============================================================

async function fetchPage(page) {
  const url =
    new URL(
      API_URL
    );

  url.searchParams.set(
    'page',
    String(page)
  );

  return fetchJson(
    url.href
  );
}

async function fetchAllPages() {
  console.log(
    '[trampos] buscando página 1...'
  );

  const first =
    await fetchPage(1);

  const pagination =
    first.pagination ||
    {};

  const totalPages =
    Number(
      pagination.total_pages ||
      1
    );

  const total =
    Number(
      pagination.total ||
      (
        first.opportunities ||
        []
      ).length
    );

  const perPage =
    Number(
      pagination.per_page ||
      0
    );

  console.log(
    `[trampos] total informado pela API: ${total}`
  );

  console.log(
    `[trampos] páginas: ${totalPages}`
  );

  console.log(
    `[trampos] vagas por página: ${perPage}`
  );

  const byId =
    new Map();

  for (
    const job of
      first.opportunities ||
      []
  ) {
    if (job.id) {
      byId.set(
        String(job.id),
        job
      );
    }
  }

  const pages = [];

  for (
    let page = 2;
    page <= totalPages;
    page++
  ) {
    pages.push(page);
  }

  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        pages.length
      ) {
        return;
      }

      const page =
        pages[index];

      try {
        const json =
          await fetchPage(
            page
          );

        const jobs =
          json.opportunities ||
          [];

        for (
          const job of jobs
        ) {
          if (!job.id) {
            continue;
          }

          byId.set(
            String(job.id),
            job
          );
        }

        console.log(
          `[trampos] página ${page}/${totalPages}: ${jobs.length} vagas`
        );

      } catch (error) {
        console.log(
          `[trampos] ERRO página ${page}: ${error.message}`
        );
      }

      await sleep(100);
    }
  }

  const workers = [];

  for (
    let i = 0;
    i <
    Math.min(
      CONCURRENCY,
      pages.length
    );
    i++
  ) {
    workers.push(
      worker()
    );
  }

  await Promise.all(
    workers
  );

  return {
    jobs:
      [...byId.values()],

    expectedTotal:
      total
  };
}

// ============================================================
// CONCORRÊNCIA GENERICA
// ============================================================

async function mapLimit(
  items,
  limit,
  worker
) {
  const results =
    new Array(
      items.length
    );

  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >= items.length
      ) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index
          );

      } catch (error) {
        results[index] =
          items[index];
      }
    }
  }

  const workers = [];

  for (
    let i = 0;
    i <
    Math.min(
      limit,
      items.length
    );
    i++
  ) {
    workers.push(
      runWorker()
    );
  }

  await Promise.all(
    workers
  );

  return results;
}

// ============================================================
// EXECUÇÃO
// ============================================================

(async () => {
  try {
    const companies =
      loadCompanies();

    const listCompact =
      companies
        .map(c => ({
          orig:
            c,

          c:
            compact(c)
        }))
        .filter(
          x =>
            x.c.length >= 2
        );

    function matchCompany(
      name
    ) {
      const cp =
        compact(name);

      if (!cp) {
        return null;
      }

      let hit =
        listCompact.find(
          x =>
            x.c === cp
        );

      if (hit) {
        return hit.orig;
      }

      hit =
        listCompact.find(
          x =>
            (
              x.c.length >= 5 &&
              cp.includes(
                x.c
              )
            ) ||
            (
              cp.length >= 5 &&
              x.c.includes(
                cp
              )
            )
        );

      return hit
        ? hit.orig
        : null;
    }

    // ========================================================
    // COLETA
    // ========================================================

    const {
      jobs,
      expectedTotal
    } =
      await fetchAllPages();

    console.log(
      `[trampos] vagas únicas coletadas: ${jobs.length}`
    );

    if (
      expectedTotal &&
      jobs.length !== expectedTotal
    ) {
      console.log(
        `[trampos] aviso: API informou ${expectedTotal}, coletamos ${jobs.length}`
      );
    }

    // ========================================================
    // FILTROS INICIAIS
    // ========================================================

    const prelim = [];

    let oldCount = 0;
    let missingDate = 0;
    let roleCount = 0;
    let remoteCount = 0;
    let hybridSPCount = 0;
    let rejectedWorkplace = 0;

    for (
      const job of jobs
    ) {
      if (
        !job.published_at
      ) {
        missingDate++;
        continue;
      }

      if (
        !isWithinAge(
          job.published_at
        )
      ) {
        oldCount++;
        continue;
      }

      const title =
        String(
          job.name ||
          ''
        ).trim();

      const role =
        matchRole(
          title
        );

      if (!role) {
        continue;
      }

      roleCount++;

      const workplaceType =
        getWorkplaceType(
          job
        );

      const location =
        getLocation(
          job,
          workplaceType
        );

      if (
        !isRemoteOrHybridSP(
          workplaceType,
          location
        )
      ) {
        rejectedWorkplace++;
        continue;
      }

      if (
        workplaceType ===
        'Home Office'
      ) {
        remoteCount++;
      }

      if (
        workplaceType ===
        'Híbrido'
      ) {
        hybridSPCount++;
      }

      const companyRaw =
        extractCompany(
          job
        );

      const url =
        buildJobUrl(
          job
        );

      prelim.push({
        job,
        role,
        jobTitle:
          title,
        workplaceType,
        location,
        url,
        companyRaw,
        companyFixed:
          false
      });
    }

    // ========================================================
    // FALLBACK DE EMPRESA
    // ========================================================

    const needsFallback =
      prelim.filter(
        row =>
          isSuspiciousCompany(
            row.companyRaw
          )
      );

    console.log(
      `[trampos] empresas que precisam de fallback: ${needsFallback.length}`
    );

    if (
      needsFallback.length > 0
    ) {
      await mapLimit(
        needsFallback,
        FALLBACK_CONCURRENCY,
        async row => {
          await fixCompanyFromPage(
            row
          );

          return row;
        }
      );
    }

    // ========================================================
    // RESULTADO FINAL
    // ========================================================

    const results = [];

    let emptyCompany = 0;
    let inList = 0;
    let outList = 0;
    let externalApplyCount = 0;
    let companyFixedCount = 0;

    for (
      const row of prelim
    ) {
      const job =
        row.job;

      let companyName =
        String(
          row.companyRaw ||
          ''
        ).trim();

      if (
        isSuspiciousCompany(
          companyName
        )
      ) {
        companyName = '';
      }

      if (!companyName) {
        emptyCompany++;
      }

      if (
        row.companyFixed
      ) {
        companyFixedCount++;
      }

      const company =
        matchCompany(
          companyName
        );

      if (company) {
        inList++;
      } else {
        outList++;
      }

      const externalApplyUrl =
        String(
          job.apply_url ||
          ''
        ).trim();

      if (
        externalApplyUrl
      ) {
        externalApplyCount++;
      }

      results.push({
        platform:
          'Trampos',

        companyList:
          company ||
          companyName ||
          '',

        companyGupy:
          companyName ||
          '',

        na_lista:
          company
            ? 'Sim'
            : 'Não',

        role:
          row.role,

        jobTitle:
          row.jobTitle,

        workplaceType:
          row.workplaceType,

        location:
          row.location,

        url:
          row.url,

        externalApplyUrl,

        publishedDate:
          publishedDateISO(
            job.published_at
          )
      });
    }

    // ========================================================
    // ORDENA
    // ========================================================

    results.sort(
      (a, b) =>
        String(
          b.publishedDate
        ).localeCompare(
          String(
            a.publishedDate
          )
        )
    );

    // ========================================================
    // SALVA
    // ========================================================

    fs.writeFileSync(
      path.join(
        DIR,
        'trampos_results.json'
      ),
      JSON.stringify(
        results,
        null,
        2
      ),
      'utf8'
    );

    // ========================================================
    // RESUMO
    // ========================================================

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      '[trampos] RESUMO FINAL'
    );

    console.log(
      `[trampos] vagas coletadas: ${jobs.length}`
    );

    console.log(
      `[trampos] limite de idade: ${MAX_AGE_DAYS} dias`
    );

    console.log(
      `[trampos] vagas antigas descartadas: ${oldCount}`
    );

    console.log(
      `[trampos] vagas sem data descartadas: ${missingDate}`
    );

    console.log(
      `[trampos] títulos compatíveis dentro do período: ${roleCount}`
    );

    console.log(
      `[trampos] Remotas aceitas: ${remoteCount}`
    );

    console.log(
      `[trampos] Híbridas São Paulo aceitas: ${hybridSPCount}`
    );

    console.log(
      `[trampos] rejeitadas por modalidade/local: ${rejectedWorkplace}`
    );

    console.log(
      `[trampos] empresas corrigidas via página: ${companyFixedCount}`
    );

    console.log(
      `[trampos] sem empresa detectada: ${emptyCompany}`
    );

    console.log(
      `[trampos] com link externo de candidatura: ${externalApplyCount}`
    );

    console.log(
      `[trampos] TOTAL FINAL: ${results.length}`
    );

    console.log(
      `[trampos] empresas da lista=${inList} | fora da lista=${outList}`
    );

    console.log(
      `[trampos] wrote ${results.length} rows -> trampos_results.json`
    );

  } catch (error) {
    console.error(
      `[trampos] ERRO FATAL: ${error.message}`
    );

    process.exitCode = 1;
  }
})();