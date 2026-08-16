const fs = require('fs');
const path = require('path');

const {
  DIR,
  loadCompanies,
  compact,
  matchRole,
  sleep
} = require('./lib.js');

const BASE_URL = 'https://www.nerdin.com.br';
const LIST_URL = `${BASE_URL}/vagas.php`;

// Quantidade de vagas abertas simultaneamente
const CONCURRENCY = 8;

// Somente vagas publicadas nos últimos 20 dias
const MAX_AGE_DAYS = 20;

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

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&atilde;/gi, 'ã')
    .replace(/&otilde;/gi, 'õ')
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&Atilde;/g, 'Ã')
    .replace(/&Otilde;/g, 'Õ')
    .replace(/&Ccedil;/g, 'Ç');
}

function stripTags(value) {
  return decodeHtml(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/section>/gi, '\n')
      .replace(/<\/article>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function absoluteUrl(url) {
  url = decodeHtml(
    String(url || '').trim()
  );

  if (!url) {
    return '';
  }

  if (url.startsWith('//')) {
    return 'https:' + url;
  }

  if (url.startsWith('/')) {
    return BASE_URL + url;
  }

  if (
    url.startsWith('http://') ||
    url.startsWith('https://')
  ) {
    return url;
  }

  return (
    BASE_URL +
    '/' +
    url.replace(/^\/+/, '')
  );
}

// ============================================================
// HTTP
// ============================================================

async function fetchHtml(url) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml'
        }
      });

      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status} - ${url}`
        );
      }

      return await res.text();

    } catch (e) {
      lastError = e;

      if (attempt < 3) {
        await sleep(
          500 * attempt
        );
      }
    }
  }

  throw lastError;
}

// ============================================================
// LISTAGEM
// ============================================================

function getTotalPages(html) {
  const text =
    stripTags(html);

  const match =
    text.match(
      /Página\s+\d+\s+de\s+(\d+)/i
    );

  return match
    ? Number(match[1])
    : 1;
}

function parseJobs(html) {
  const jobs = [];
  const seen = new Set();

  const linkRegex =
    /href=["']([^"']*vaga_emprego\/vaga-[^"'?#]+\.php)["']/gi;

  let match;

  while (
    (match = linkRegex.exec(html)) !== null
  ) {
    const url =
      absoluteUrl(
        match[1]
      );

    if (
      !url ||
      seen.has(url)
    ) {
      continue;
    }

    seen.add(url);

    jobs.push({
      url
    });
  }

  return jobs;
}

// ============================================================
// CONTEÚDO PRINCIPAL
// ============================================================

function getMainJobHtml(html) {
  /*
    Remove a área de vagas semelhantes.

    Assim dados de outras vagas não entram
    na empresa, modalidade ou localização.
  */

  const patterns = [
    /<h2[^>]*>\s*Vagas semelhantes para você\s*<\/h2>/i,
    /Vagas semelhantes para você/i
  ];

  let end =
    html.length;

  for (
    const pattern of patterns
  ) {
    const match =
      html.match(pattern);

    if (
      match &&
      typeof match.index === 'number'
    ) {
      end =
        Math.min(
          end,
          match.index
        );
    }
  }

  return html.slice(
    0,
    end
  );
}

// ============================================================
// TÍTULO
// ============================================================

function extractTitle(mainHtml) {
  const h2Match =
    mainHtml.match(
      /<h2[^>]*>([\s\S]*?)<\/h2>/i
    );

  if (h2Match) {
    const title =
      stripTags(
        h2Match[1]
      );

    if (title) {
      return title;
    }
  }

  const h1Match =
    mainHtml.match(
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    );

  if (h1Match) {
    return stripTags(
      h1Match[1]
    )
      .replace(
        /\s*-\s*(Home Office|Remoto|Híbrido|Hibrido|Presencial).*$/i,
        ''
      )
      .trim();
  }

  return '';
}

// ============================================================
// CABEÇALHO
// ============================================================

function getHeaderChunk(mainHtml) {
  const h2Match =
    mainHtml.match(
      /<h2[^>]*>[\s\S]*?<\/h2>/i
    );

  if (!h2Match) {
    return '';
  }

  const start =
    h2Match.index +
    h2Match[0].length;

  return mainHtml.slice(
    start,
    start + 5000
  );
}

function extractHeaderText(mainHtml) {
  return stripTags(
    getHeaderChunk(
      mainHtml
    )
  );
}

// ============================================================
// LINK EXTERNO DE CANDIDATURA
// ============================================================

function extractExternalApplyUrl(
  mainHtml
) {
  const anchorRegex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match =
      anchorRegex.exec(
        mainHtml
      )) !== null
  ) {
    const href =
      String(
        match[1] || ''
      ).trim();

    const text =
      normalize(
        stripTags(
          match[2]
        )
      );

    if (
      text.includes(
        'candidatar no site da empresa'
      ) ||
      text.includes(
        'candidatar-se no site da empresa'
      )
    ) {
      return absoluteUrl(
        href
      );
    }
  }

  return '';
}

// ============================================================
// EMPRESA
// ============================================================

function isInvalidCompanyText(value) {
  const text =
    normalize(value);

  if (!text) {
    return true;
  }

  const invalidExact = [
    'whatsapp',
    'whats',
    'whatsapp web',
    'email',
    'e-mail',
    'telefone',
    'celular',
    'contato',
    'candidatar no site da empresa',
    'candidatar-se no site da empresa',
    'enviar candidatura',
    'quero essa vaga',
    'ver vaga',
    'ver vagas',
    'home office',
    'remoto',
    'remote',
    'hibrido',
    'hybrid',
    'presencial',
    'salario',
    'candidatos',
    'candidato',
    'login',
    'cadastre-se',
    'incluir vaga',
    'compartilhar',
    'facebook',
    'linkedin',
    'instagram'
  ];

  if (
    invalidExact.includes(text)
  ) {
    return true;
  }

  const invalidContains = [
    'candidatar no site',
    'candidatar-se no site',
    'enviar candidatura',
    'quando disponibilizado pela empresa',
    'contato podera ser visualizado',
    'contato poderá ser visualizado',
    'vagas semelhantes',
    'ver todas as vagas',
    'compartilhe esta vaga',
    'compartilhar esta vaga',
    'candidatos nesta vaga',
    'candidatos para esta vaga',
    'clique para candidatar',
    'vaga publicada',
    'vagas ativas',
    'vaga ativa',
    'whatsapp:',
    'whats:',
    'e-mail:',
    'email:',
    'telefone:',
    'celular:'
  ];

  return invalidContains.some(
    item =>
      text.includes(
        normalize(item)
      )
  );
}

function looksLikeLocation(value) {
  return /\b[A-Za-zÀ-ÿ.' -]+\s*[\/-]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i.test(
    String(value || '')
  );
}

function looksLikeContact(value) {
  const text =
    String(value || '');

  if (
    text.includes('@')
  ) {
    return true;
  }

  if (
    /https?:\/\//i.test(text)
  ) {
    return true;
  }

  if (
    /www\./i.test(text)
  ) {
    return true;
  }

  if (
    /\(\d{2}\)\s*\d/.test(text)
  ) {
    return true;
  }

  if (
    /\b\d{4,5}[-\s]?\d{4}\b/.test(text)
  ) {
    return true;
  }

  return false;
}

function looksLikeJobMetadata(value) {
  return /\b(home\s*office|remoto|remote|híbrido|hibrido|hybrid|presencial|junior|júnior|pleno|senior|sênior|estágio|estagio|trainee|clt|pj|cooperado|candidatos?|salário|salario)\b/i.test(
    String(value || '')
  );
}

function cleanCompany(value) {
  let company =
    stripTags(value)
      .replace(
        /\s+\d+\s+Vagas?\s+Ativas?.*$/i,
        ''
      )
      .replace(
        /\s+\d+\s+Vagas?.*$/i,
        ''
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  if (!company) {
    return '';
  }

  if (
    isInvalidCompanyText(
      company
    )
  ) {
    return '';
  }

  if (
    looksLikeLocation(
      company
    )
  ) {
    return '';
  }

  if (
    looksLikeContact(
      company
    )
  ) {
    return '';
  }

  if (
    looksLikeJobMetadata(
      company
    )
  ) {
    return '';
  }

  if (
    company.length < 2 ||
    company.length > 120
  ) {
    return '';
  }

  return company;
}

function extractCompany(
  mainHtml,
  title
) {
  const h2Match =
    mainHtml.match(
      /<h2[^>]*>[\s\S]*?<\/h2>/i
    );

  if (!h2Match) {
    return '';
  }

  const start =
    h2Match.index +
    h2Match[0].length;

  /*
    Área pequena imediatamente após o título.
    Isso evita WhatsApp, candidatura e rodapé.
  */

  const chunk =
    mainHtml.slice(
      start,
      start + 2200
    );

  const text =
    decodeHtml(
      chunk
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          ''
        )
        .replace(
          /<style[\s\S]*?<\/style>/gi,
          ''
        )
        .replace(
          /<br\s*\/?>/gi,
          '\n'
        )
        .replace(
          /<\/(?:div|p|span|a|strong|b|li|small|section)>/gi,
          '\n'
        )
        .replace(
          /<[^>]+>/g,
          ' '
        )
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

  for (
    const line of lines
  ) {
    const candidate =
      cleanCompany(
        line
      );

    if (!candidate) {
      continue;
    }

    const candidateNormalized =
      normalize(
        candidate
      );

    if (
      candidateNormalized ===
      normalizedTitle
    ) {
      continue;
    }

    if (
      normalizedTitle &&
      candidateNormalized.startsWith(
        normalizedTitle + ' '
      )
    ) {
      continue;
    }

    if (
      /^(empresa|vaga|detalhes|descricao|descrição|requisitos|beneficios|benefícios)$/i.test(
        candidate
      )
    ) {
      continue;
    }

    return candidate;
  }

  return '';
}

// ============================================================
// MODALIDADE
// ============================================================

function extractWorkplace(
  mainHtml,
  headerText
) {
  const h1Match =
    mainHtml.match(
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    );

  const h1 =
    h1Match
      ? stripTags(
          h1Match[1]
        )
      : '';

  const source =
    `${h1} ${headerText}`;

  if (
    /\bhome\s*office\b/i.test(
      source
    ) ||
    /\b100%\s*remot/i.test(
      source
    ) ||
    /\bremoto\b/i.test(
      source
    ) ||
    /\bremote\b/i.test(
      source
    )
  ) {
    return 'Home Office';
  }

  if (
    /\bhíbrido\b/i.test(
      source
    ) ||
    /\bhibrido\b/i.test(
      source
    ) ||
    /\bhybrid\b/i.test(
      source
    )
  ) {
    return 'Híbrido';
  }

  if (
    /\bpresencial\b/i.test(
      source
    )
  ) {
    return 'Presencial';
  }

  return '';
}

// ============================================================
// LOCALIZAÇÃO
// ============================================================

function extractLocation(
  mainHtml,
  headerText,
  workplace
) {
  const labelled =
    headerText.match(
      /(?:Localização|Local|Cidade)\s*:?\s*([A-Za-zÀ-ÿ.'\- ]{2,50})\s*[\/-]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i
    );

  if (labelled) {
    return (
      `${labelled[1].trim()} / ` +
      labelled[2].toUpperCase()
    );
  }

  const generic =
    headerText.match(
      /\b([A-Za-zÀ-ÿ.'\- ]{2,40})\s*\/\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i
    );

  if (generic) {
    return (
      `${generic[1].trim()} / ` +
      generic[2].toUpperCase()
    );
  }

  if (
    workplace ===
    'Home Office'
  ) {
    return 'Home Office';
  }

  const mainText =
    stripTags(
      mainHtml
    );

  const fallback =
    mainText.match(
      /(?:Localização|Local|Cidade)\s*:?\s*([A-Za-zÀ-ÿ.'\- ]{2,50})\s*[\/-]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i
    );

  if (fallback) {
    return (
      `${fallback[1].trim()} / ` +
      fallback[2].toUpperCase()
    );
  }

  return '';
}

// ============================================================
// DATA
// ============================================================

function extractRelativeDate(
  headerText,
  mainText
) {
  const source =
    `${headerText} ${mainText}`;

  const relative =
    source.match(
      /\b(hoje|há\s+\d+\s+dias?|há\s+\d+\s+horas?)\b/i
    );

  if (relative) {
    return relative[1];
  }

  const exact =
    source.match(
      /\b(\d{2}\/\d{2}\/\d{4})\b/
    );

  return exact
    ? exact[1]
    : '';
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

  return (
    `${year}-${month}-${day}`
  );
}

function convertPublishedDate(
  value
) {
  const text =
    normalize(value);

  if (!text) {
    return '';
  }

  const now =
    new Date();

  if (
    text === 'hoje'
  ) {
    return formatDateISO(
      now
    );
  }

  const daysMatch =
    text.match(
      /ha\s+(\d+)\s+dias?/
    );

  if (daysMatch) {
    const days =
      Number(
        daysMatch[1]
      );

    const date =
      new Date(now);

    date.setDate(
      date.getDate() -
      days
    );

    return formatDateISO(
      date
    );
  }

  const hoursMatch =
    text.match(
      /ha\s+(\d+)\s+horas?/
    );

  if (hoursMatch) {
    return formatDateISO(
      now
    );
  }

  const exactBR =
    String(value).match(
      /(\d{2})\/(\d{2})\/(\d{4})/
    );

  if (exactBR) {
    return (
      `${exactBR[3]}-` +
      `${exactBR[2]}-` +
      `${exactBR[1]}`
    );
  }

  return value;
}

// ============================================================
// FILTRO DE IDADE DA VAGA
// ============================================================

function getAgeInDays(
  publishedDate
) {
  if (!publishedDate) {
    return null;
  }

  const published =
    new Date(
      `${publishedDate}T00:00:00`
    );

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

  const diffMs =
    today.getTime() -
    published.getTime();

  return Math.floor(
    diffMs /
    (
      1000 *
      60 *
      60 *
      24
    )
  );
}

function isWithinMaxAge(
  publishedDate
) {
  const age =
    getAgeInDays(
      publishedDate
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
// REGRA DE MODALIDADE
// ============================================================

/*
  REGRAS:

  Home Office / Remoto:
  aceita em qualquer lugar.

  Híbrido:
  somente São Paulo capital.

  Presencial:
  descartado.
*/

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

  const hybrid =
    w.includes(
      'hibrido'
    ) ||
    w.includes(
      'hybrid'
    );

  if (!hybrid) {
    return false;
  }

  return (
    l.includes(
      'sao paulo'
    )
  );
}

// ============================================================
// DETALHES DA VAGA
// ============================================================

async function fetchJobDetails(
  job
) {
  const html =
    await fetchHtml(
      job.url
    );

  const mainHtml =
    getMainJobHtml(
      html
    );

  const mainText =
    stripTags(
      mainHtml
    );

  const title =
    extractTitle(
      mainHtml
    );

  const headerText =
    extractHeaderText(
      mainHtml
    );

  const company =
    extractCompany(
      mainHtml,
      title
    );

  const workplaceType =
    extractWorkplace(
      mainHtml,
      headerText
    );

  const location =
    extractLocation(
      mainHtml,
      headerText,
      workplaceType
    );

  const rawPublishedDate =
    extractRelativeDate(
      headerText,
      mainText
    );

  const publishedDate =
    convertPublishedDate(
      rawPublishedDate
    );

  const externalApplyUrl =
    extractExternalApplyUrl(
      mainHtml
    );

  return {
    title,
    company,
    workplaceType,
    location,
    url:
      job.url,
    externalApplyUrl,
    publishedDate
  };
}

// ============================================================
// CONCORRÊNCIA
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
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index
          );

      } catch (e) {
        results[index] = {
          error:
            e,
          item:
            items[index]
        };
      }
    }
  }

  const workers = [];

  const workerCount =
    Math.min(
      limit,
      items.length
    );

  for (
    let i = 0;
    i < workerCount;
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
          orig: c,
          c: compact(c)
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
    // COLETA DAS PÁGINAS
    // ========================================================

    console.log(
      '[nerdin] buscando primeira página...'
    );

    const firstHtml =
      await fetchHtml(
        LIST_URL
      );

    const totalPages =
      getTotalPages(
        firstHtml
      );

    console.log(
      `[nerdin] páginas encontradas: ${totalPages}`
    );

    const pooled =
      new Map();

    for (
      let page = 1;
      page <= totalPages;
      page++
    ) {
      const url =
        page === 1
          ? LIST_URL
          : `${LIST_URL}?pagina=${page}`;

      process.stdout.write(
        `[nerdin] página ${page}/${totalPages} ... `
      );

      try {
        const html =
          page === 1
            ? firstHtml
            : await fetchHtml(
                url
              );

        const jobs =
          parseJobs(
            html
          );

        for (
          const job of jobs
        ) {
          pooled.set(
            job.url,
            job
          );
        }

        console.log(
          `${jobs.length} links`
        );

      } catch (e) {
        console.log(
          `ERRO: ${e.message}`
        );
      }

      await sleep(100);
    }

    const jobs =
      [...pooled.values()];

    console.log(
      `[nerdin] unique jobs pooled: ${jobs.length}`
    );

    console.log(
      `[nerdin] processando com concorrência=${CONCURRENCY}`
    );

    // ========================================================
    // ABERTURA DAS VAGAS
    // ========================================================

    let processed = 0;

    const details =
      await mapLimit(
        jobs,
        CONCURRENCY,

        async job => {
          const detail =
            await fetchJobDetails(
              job
            );

          processed++;

          if (
            processed % 25 === 0 ||
            processed ===
              jobs.length
          ) {
            console.log(
              `[nerdin] processadas ${processed}/${jobs.length}`
            );
          }

          return detail;
        }
      );

    // ========================================================
    // FILTROS
    // ========================================================

    const results = [];

    let roleCount = 0;

    let remoteCount = 0;

    let hybridSPCount = 0;

    let rejectedWorkplace = 0;

    let rejectedByAge = 0;

    let missingDateCount = 0;

    let emptyTitleCount = 0;

    let errors = 0;

    let inList = 0;

    let outList = 0;

    let externalApplyCount = 0;

    let noExternalApplyCount = 0;

    let emptyCompanyCount = 0;

    let suspiciousCompanyCount = 0;

    for (
      const item of details
    ) {
      if (!item) {
        continue;
      }

      if (
        item.error
      ) {
        errors++;

        console.log(
          `[nerdin] erro em ${item.item?.url || ''}: ${item.error.message}`
        );

        continue;
      }

      const detail =
        item;

      // ======================================================
      // DATA - ATÉ 20 DIAS
      // ======================================================

      if (
        !detail.publishedDate
      ) {
        missingDateCount++;
        continue;
      }

      if (
        !isWithinMaxAge(
          detail.publishedDate
        )
      ) {
        rejectedByAge++;
        continue;
      }

      // ======================================================
      // TÍTULO
      // ======================================================

      if (
        !detail.title
      ) {
        emptyTitleCount++;
        continue;
      }

      const role =
        matchRole(
          detail.title
        );

      if (!role) {
        continue;
      }

      roleCount++;

      // ======================================================
      // MODALIDADE
      // ======================================================

      const accepted =
        isRemoteOrHybridSP(
          detail.workplaceType,
          detail.location
        );

      if (!accepted) {
        rejectedWorkplace++;
        continue;
      }

      const wp =
        normalize(
          detail.workplaceType
        );

      if (
        wp.includes(
          'home office'
        ) ||
        wp.includes(
          'remoto'
        ) ||
        wp.includes(
          'remote'
        )
      ) {
        remoteCount++;

      } else {
        hybridSPCount++;
      }

      // ======================================================
      // EMPRESA
      // ======================================================

      if (
        !detail.company
      ) {
        emptyCompanyCount++;
      }

      if (
        detail.company &&
        (
          isInvalidCompanyText(
            detail.company
          ) ||
          looksLikeContact(
            detail.company
          ) ||
          looksLikeLocation(
            detail.company
          )
        )
      ) {
        suspiciousCompanyCount++;

        detail.company = '';
      }

      const company =
        matchCompany(
          detail.company
        );

      if (company) {
        inList++;

      } else {
        outList++;
      }

      // ======================================================
      // LINK EXTERNO
      // ======================================================

      if (
        detail.externalApplyUrl
      ) {
        externalApplyCount++;

      } else {
        noExternalApplyCount++;
      }

      // ======================================================
      // RESULTADO
      // ======================================================

      results.push({
        platform:
          'Nerdin',

        companyList:
          company ||
          detail.company ||
          '',

        /*
          Mantido por compatibilidade
          com o fluxo atual.
        */
        companyGupy:
          detail.company ||
          '',

        na_lista:
          company
            ? 'Sim'
            : 'Não',

        role,

        jobTitle:
          detail.title,

        workplaceType:
          detail.workplaceType,

        location:
          detail.location,

        // Página da vaga no Nerdin
        url:
          detail.url,

        // Link direto de candidatura
        externalApplyUrl:
          detail.externalApplyUrl ||
          '',

        publishedDate:
          detail.publishedDate ||
          ''
      });
    }

    // ========================================================
    // RESUMO
    // ========================================================

    console.log(
      '\n=========================================='
    );

    console.log(
      '[nerdin] RESUMO FINAL'
    );

    console.log(
      `[nerdin] vagas coletadas: ${jobs.length}`
    );

    console.log(
      `[nerdin] limite de idade: ${MAX_AGE_DAYS} dias`
    );

    console.log(
      `[nerdin] vagas antigas descartadas: ${rejectedByAge}`
    );

    console.log(
      `[nerdin] vagas sem data descartadas: ${missingDateCount}`
    );

    console.log(
      `[nerdin] títulos compatíveis dentro do período: ${roleCount}`
    );

    console.log(
      `[nerdin] Remotas aceitas: ${remoteCount}`
    );

    console.log(
      `[nerdin] Híbridas São Paulo aceitas: ${hybridSPCount}`
    );

    console.log(
      `[nerdin] rejeitadas por modalidade/local: ${rejectedWorkplace}`
    );

    console.log(
      `[nerdin] sem título detectado: ${emptyTitleCount}`
    );

    console.log(
      `[nerdin] sem empresa detectada: ${emptyCompanyCount}`
    );

    console.log(
      `[nerdin] empresas suspeitas descartadas: ${suspiciousCompanyCount}`
    );

    console.log(
      `[nerdin] erros de leitura: ${errors}`
    );

    console.log(
      `[nerdin] com link externo de candidatura: ${externalApplyCount}`
    );

    console.log(
      `[nerdin] sem link externo de candidatura: ${noExternalApplyCount}`
    );

    console.log(
      `[nerdin] TOTAL FINAL: ${results.length}`
    );

    console.log(
      `[nerdin] empresas da lista=${inList} | fora da lista=${outList}`
    );

    // ========================================================
    // SALVA
    // ========================================================

    fs.writeFileSync(
      path.join(
        DIR,
        'nerdin_results.json'
      ),
      JSON.stringify(
        results,
        null,
        2
      )
    );

    console.log(
      `[nerdin] wrote ${results.length} rows -> nerdin_results.json`
    );

  } catch (e) {
    console.error(
      `[nerdin] ERRO FATAL: ${e.message}`
    );

    process.exitCode = 1;
  }
})();