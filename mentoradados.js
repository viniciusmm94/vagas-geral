const fs = require('fs');
const path = require('path');

const {
  DIR,
  loadCompanies,
  compact,
  matchRole,
  sleep
} = require('./lib.js');

const API_URL =
  'https://mentoradados.com/wp-admin/admin-ajax.php';

const MAX_AGE_DAYS = 20;

const CONCURRENCY = 4;

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

async function fetchPage(page) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const form =
        new FormData();

      form.append(
        'action',
        'mentora_get_vagas'
      );

      form.append(
        'paged',
        String(page)
      );

      form.append(
        'search',
        ''
      );

      const response =
        await fetch(
          API_URL,
          {
            method:
              'POST',

            body:
              form,

            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',

              Accept:
                'application/json'
            }
          }
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const text =
        await response.text();

      let json;

      try {
        json =
          JSON.parse(
            text
          );

      } catch {
        throw new Error(
          `resposta não JSON: ${text.slice(0, 150)}`
        );
      }

      if (
        !json ||
        json.success !== true
      ) {
        throw new Error(
          'endpoint retornou success=false'
        );
      }

      return json;

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
// COLETA PAGINADA
// ============================================================

async function fetchAllPages() {
  console.log(
    '[mentoradados] buscando página 1...'
  );

  const first =
    await fetchPage(1);

  const data =
    first.data ||
    {};

  const totalPages =
    Number(
      data.total_paginas ||
      1
    );

  const totalJobs =
    Number(
      data.total_vagas ||
      (
        data.vagas ||
        []
      ).length
    );

  console.log(
    `[mentoradados] total informado: ${totalJobs}`
  );

  console.log(
    `[mentoradados] páginas: ${totalPages}`
  );

  const byId =
    new Map();

  for (
    const job of
      data.vagas ||
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
    pages.push(
      page
    );
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
          json.data?.vagas ||
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
          `[mentoradados] página ${page}/${totalPages}: ${jobs.length} vagas`
        );

      } catch (error) {
        console.log(
          `[mentoradados] ERRO página ${page}: ${error.message}`
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
      totalJobs
  };
}

// ============================================================
// DATA
// ============================================================

function relativeAgeDays(job) {
  const relative =
    normalize(
      job.data_relativa
    );

  if (!relative) {
    return null;
  }

  if (
    relative.includes(
      'hora'
    ) ||
    relative === 'hoje'
  ) {
    return 0;
  }

  const daysMatch =
    relative.match(
      /ha\s+(\d+)\s+dias?/
    );

  if (daysMatch) {
    return Number(
      daysMatch[1]
    );
  }

  const weeksMatch =
    relative.match(
      /ha\s+(\d+)\s+semanas?/
    );

  if (weeksMatch) {
    return (
      Number(
        weeksMatch[1]
      ) * 7
    );
  }

  return null;
}

function parseShortDate(job) {
  /*
    A API entrega algo como:
    15/08

    Como estamos trabalhando com janela
    de 20 dias, podemos usar o ano atual.
  */

  const value =
    String(
      job.data ||
      ''
    ).trim();

  const match =
    value.match(
      /^(\d{1,2})\/(\d{1,2})$/
    );

  if (!match) {
    return '';
  }

  const now =
    new Date();

  let year =
    now.getFullYear();

  const day =
    Number(
      match[1]
    );

  const month =
    Number(
      match[2]
    );

  /*
    Segurança para virada de ano.
  */

  if (
    month >
    now.getMonth() + 1
  ) {
    year--;
  }

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  return formatDateISO(
    date
  );
}

function isWithinAge(job) {
  const age =
    relativeAgeDays(
      job
    );

  if (
    age !== null
  ) {
    return (
      age >= 0 &&
      age <= MAX_AGE_DAYS
    );
  }

  const iso =
    parseShortDate(
      job
    );

  if (!iso) {
    return false;
  }

  const published =
    new Date(
      `${iso}T00:00:00`
    );

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  const diff =
    Math.floor(
      (
        today -
        published
      ) /
      (
        1000 *
        60 *
        60 *
        24
      )
    );

  return (
    diff >= 0 &&
    diff <= MAX_AGE_DAYS
  );
}

// ============================================================
// CARGO
// ============================================================

function isGrowthJob(title) {
  return /\bgrowth\b/i.test(
    String(
      title ||
      ''
    )
  );
}

function getRole(title) {
  /*
    Growth fica explicitamente fora
    desta fonte.
  */

  if (
    isGrowthJob(
      title
    )
  ) {
    return null;
  }

  return matchRole(
    title
  );
}

// ============================================================
// MODALIDADE / LOCAL
// ============================================================

function getWorkplace(job) {
  const model =
    normalize(
      job.modelo
    );

  if (
    model.includes(
      'remoto'
    ) ||
    model.includes(
      'remote'
    )
  ) {
    return 'Home Office';
  }

  if (
    model.includes(
      'hibrido'
    ) ||
    model.includes(
      'hybrid'
    )
  ) {
    return 'Híbrido';
  }

  if (
    model.includes(
      'presencial'
    )
  ) {
    return 'Presencial';
  }

  return String(
    job.modelo ||
    ''
  ).trim();
}

function normalizeLocation(job, workplace) {
  if (
    workplace ===
    'Home Office'
  ) {
    return 'Home Office';
  }

  return String(
    job.cidade ||
    ''
  ).trim();
}

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

  /*
    Híbrido:
    somente São Paulo capital.

    Aceita:
    São Paulo (SP)
    São Paulo - SP
    São Paulo / SP
  */

  const isSaoPaulo =
    (
      l ===
      'sao paulo (sp)'
    ) ||
    (
      l ===
      'sao paulo - sp'
    ) ||
    (
      l ===
      'sao paulo / sp'
    ) ||
    (
      l.startsWith(
        'sao paulo - sp '
      )
    );

  return isSaoPaulo;
}

// ============================================================
// EMPRESA
// ============================================================

function extractCompany(job) {
  return String(
    job.empresa ||
    ''
  ).trim();
}

// ============================================================
// LINKS
// ============================================================

function normalizeApplyUrl(value) {
  let url =
    String(
      value ||
      ''
    ).trim();

  if (!url) {
    return '';
  }

  /*
    Corrige casos da fonte como:
    http://email@empresa.com.br
  */

  const malformedEmail =
    url.match(
      /^https?:\/\/([^/\s]+@[^/\s]+)$/i
    );

  if (malformedEmail) {
    return (
      `mailto:${malformedEmail[1]}`
    );
  }

  /*
    E-mail puro.
  */

  if (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(
      url
    )
  ) {
    return (
      `mailto:${url}`
    );
  }

  return url;
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
      `[mentoradados] vagas únicas coletadas: ${jobs.length}`
    );

    if (
      expectedTotal &&
      expectedTotal !==
      jobs.length
    ) {
      console.log(
        `[mentoradados] aviso: endpoint informou ${expectedTotal}, coletamos ${jobs.length}`
      );
    }

    // ========================================================
    // FILTROS
    // ========================================================

    const results = [];

    let oldCount = 0;
    let growthRejected = 0;
    let roleCount = 0;
    let remoteCount = 0;
    let hybridSPCount = 0;
    let workplaceRejected = 0;
    let blockedCount = 0;
    let emptyCompanyCount = 0;
    let inList = 0;
    let outList = 0;
    let externalApplyCount = 0;

    for (
      const job of jobs
    ) {
      // ------------------------------------------------------
      // VAGA BLOQUEADA / VIP
      // ------------------------------------------------------

      if (
        job.bloqueada === true
      ) {
        blockedCount++;
        continue;
      }

      // ------------------------------------------------------
      // DATA
      // ------------------------------------------------------

      if (
        !isWithinAge(
          job
        )
      ) {
        oldCount++;
        continue;
      }

      // ------------------------------------------------------
      // CARGO
      // ------------------------------------------------------

      const title =
        String(
          job.titulo ||
          ''
        ).trim();

      if (
        isGrowthJob(
          title
        )
      ) {
        growthRejected++;
        continue;
      }

      const role =
        getRole(
          title
        );

      if (!role) {
        continue;
      }

      roleCount++;

      // ------------------------------------------------------
      // MODALIDADE
      // ------------------------------------------------------

      const workplaceType =
        getWorkplace(
          job
        );

      const location =
        normalizeLocation(
          job,
          workplaceType
        );

      if (
        !isRemoteOrHybridSP(
          workplaceType,
          location
        )
      ) {
        workplaceRejected++;
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

      // ------------------------------------------------------
      // EMPRESA
      // ------------------------------------------------------

      const companyName =
        extractCompany(
          job
        );

      if (!companyName) {
        emptyCompanyCount++;
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

      // ------------------------------------------------------
      // LINKS
      // ------------------------------------------------------

      const pageUrl =
        String(
          job.permalink ||
          ''
        ).trim();

      const externalApplyUrl =
        normalizeApplyUrl(
          job.link_aplicacao
        );

      const originalUrl =
        String(
          job.link_original ||
          ''
        ).trim();

      if (
        externalApplyUrl
      ) {
        externalApplyCount++;
      }

      // ------------------------------------------------------
      // RESULTADO
      // ------------------------------------------------------

      results.push({
        platform:
          'Mentora Dados',

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

        role,

        jobTitle:
          title,

        workplaceType,

        location,

        /*
          Página da vaga na Mentora.
        */
        url:
          pageUrl,

        /*
          Link direto de candidatura.
        */
        externalApplyUrl,

        /*
          Fonte original da vaga,
          quando existir.
        */
        originalUrl,

        publishedDate:
          parseShortDate(
            job
          ),

        /*
          Informações adicionais úteis
          desta fonte.
        */
        seniority:
          Array.isArray(
            job.nivel
          )
            ? job.nivel.join(', ')
            : String(
                job.nivel ||
                ''
              ),

        area:
          Array.isArray(
            job.area
          )
            ? job.area.join(', ')
            : String(
                job.area ||
                ''
              )
      });
    }

    // ========================================================
    // ORDENAÇÃO
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
        'mentoradados_results.json'
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
      '[mentoradados] RESUMO FINAL'
    );

    console.log(
      `[mentoradados] vagas coletadas: ${jobs.length}`
    );

    console.log(
      `[mentoradados] limite de idade: ${MAX_AGE_DAYS} dias`
    );

    console.log(
      `[mentoradados] vagas antigas descartadas: ${oldCount}`
    );

    console.log(
      `[mentoradados] vagas Growth descartadas: ${growthRejected}`
    );

    console.log(
      `[mentoradados] vagas bloqueadas descartadas: ${blockedCount}`
    );

    console.log(
      `[mentoradados] títulos compatíveis dentro do período: ${roleCount}`
    );

    console.log(
      `[mentoradados] Remotas aceitas: ${remoteCount}`
    );

    console.log(
      `[mentoradados] Híbridas São Paulo aceitas: ${hybridSPCount}`
    );

    console.log(
      `[mentoradados] rejeitadas por modalidade/local: ${workplaceRejected}`
    );

    console.log(
      `[mentoradados] sem empresa detectada: ${emptyCompanyCount}`
    );

    console.log(
      `[mentoradados] com link externo de candidatura: ${externalApplyCount}`
    );

    console.log(
      `[mentoradados] TOTAL FINAL: ${results.length}`
    );

    console.log(
      `[mentoradados] empresas da lista=${inList} | fora da lista=${outList}`
    );

    console.log(
      `[mentoradados] wrote ${results.length} rows -> mentoradados_results.json`
    );

  } catch (error) {
    console.error(
      `[mentoradados] ERRO FATAL: ${error.message}`
    );

    process.exitCode = 1;
  }
})();