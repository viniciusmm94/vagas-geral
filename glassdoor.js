const fs = require('fs');
const path = require('path');

const {
  DIR,
  matchRole
} = require('./lib.js');

const ENDPOINT =
  'https://www.glassdoor.com.br/job-search-next/bff/jobSearchResultsQuery';

const BASE_URL = 'https://www.glassdoor.com.br';

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const KEYWORDS = [
  'Analista de Dados',
  'Data Analyst',
  'Analista de BI',
  'Business Intelligence',
  'Business Analyst',
  'Analista de Negócios',
  'Inteligência de Negócios',
  'Growth',
  'Revenue Operations',
  'RevOps',
  'Analista de Insights',
  'Inteligência de Mercado',
  'Market Intelligence'
];

const MAX_AGE_DAYS = 20;
const MAX_PAGES = 10;
const JOBS_PER_PAGE = 30;

const LOCATION_ID = 2479061;
const LOCATION_TYPE = 'CITY';

// ============================================================
// UTILITÁRIOS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getAttributes(header) {
  return (
    header?.indeedJobAttribute?.extractedJobAttributes ||
    []
  );
}

// ============================================================
// CARGO
// ============================================================

function getRole(title) {
  return matchRole(
    String(title || '').trim()
  );
}

// ============================================================
// MODALIDADE
// ============================================================

function detectWorkplace(header, job) {
  const attrs = getAttributes(header);

  const attributeText = attrs
    .map(x => String(x?.value || ''))
    .join(' ');

  const title =
    header?.jobTitleText ||
    job?.jobTitleText ||
    '';

  const location =
    header?.locationName ||
    '';

  const description =
    Array.isArray(job?.descriptionFragmentsText)
      ? job.descriptionFragmentsText.join(' ')
      : String(job?.descriptionFragmentsText || '');

  /*
    Primeiro damos prioridade aos atributos estruturados
    fornecidos pelo próprio Glassdoor/Indeed.
  */

  const attr =
    normalize(attributeText);

  if (
    /\bremot[oa]\b/.test(attr) ||
    attr.includes('home office') ||
    attr.includes('home-office') ||
    attr.includes('trabalho remoto')
  ) {
    return 'Remoto';
  }

  if (
    attr.includes('hibrido') ||
    attr.includes('trabalho hibrido')
  ) {
    return 'Híbrido';
  }

  if (
    attr.includes('presencial') ||
    attr.includes('on-site') ||
    attr.includes('onsite')
  ) {
    return 'Presencial';
  }

  /*
    Fallback.

    Quando o atributo estruturado não existe,
    procuramos indicações explícitas no título,
    localização e trecho da descrição.

    Não inferimos modalidade apenas porque a vaga
    está localizada em São Paulo.
  */

  const fallback =
    normalize(
      `${title} ${location} ${description}`
    );

  if (
    /\b100%\s*remot[oa]\b/.test(fallback) ||
    /\bremot[oa]\b/.test(fallback) ||
    fallback.includes('home office') ||
    fallback.includes('home-office') ||
    fallback.includes('trabalho remoto')
  ) {
    return 'Remoto';
  }

  if (
    fallback.includes('hibrido') ||
    fallback.includes('modelo hibrido') ||
    fallback.includes('trabalho hibrido')
  ) {
    return 'Híbrido';
  }

  if (
    fallback.includes('presencial') ||
    fallback.includes('100% presencial') ||
    fallback.includes('trabalho presencial')
  ) {
    return 'Presencial';
  }

  return '';
}

// ============================================================
// SÃO PAULO
// ============================================================

function isSaoPauloCity(location) {
  const loc =
    normalize(location);

  /*
    Os retornos observados usam algo como:
    "São Paulo, São Paulo".
  */

  if (!loc.includes('sao paulo')) {
    return false;
  }

  /*
    Evita cidades da região metropolitana que
    eventualmente apareçam no raio da busca.
  */

  const outsideCities = [
    'santo andre',
    'sao bernardo',
    'sao caetano',
    'guarulhos',
    'barueri',
    'osasco',
    'taboao da serra',
    'carapicuiba',
    'cotia',
    'diadema',
    'maua',
    'embu das artes'
  ];

  return !outsideCities.some(city =>
    loc.includes(city)
  );
}

// ============================================================
// SALÁRIO
// ============================================================

function getSalary(header) {
  const pay =
    header?.payPeriodAdjustedPay;

  if (!pay) {
    return '';
  }

  const min = pay.p10;
  const median = pay.p50;
  const max = pay.p90;

  if (
    min == null &&
    median == null &&
    max == null
  ) {
    return '';
  }

  return {
    min: min ?? '',
    median: median ?? '',
    max: max ?? '',
    currency:
      header?.payCurrency || '',
    period:
      header?.payPeriod || ''
  };
}

// ============================================================
// REQUEST
// ============================================================

async function requestJobs(
  keyword,
  pageNumber,
  pageCursor = null
) {
  const body = {
    excludeJobListingIds: [],
    filterParams: [],
    includeIndeedJobAttributes: true,

    keyword,

    locationId: LOCATION_ID,
    locationType: LOCATION_TYPE,

    numJobsToShow: JOBS_PER_PAGE,

    originalPageUrl:
      'https://www.glassdoor.com.br/Vaga/s%C3%A3o-paulo-analista-vagas-SRCH_IL.0,9_IC2479061_KO10,18.htm',

    pageNumber,

    pageType: 'SERP',

    parameterUrlInput:
      'IL.0,9_IC2479061_KO10,18',

    queryString: '',

    seoFriendlyUrlInput:
      'são-paulo-analista-vagas',

    seoUrl: true
  };

  if (pageCursor) {
    body.pageCursor =
      pageCursor;
  }

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    const res =
      await fetch(
        ENDPOINT,
        {
          method: 'POST',

          headers: {
            Accept: '*/*',

            'Content-Type':
              'application/json',

            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
              'AppleWebKit/537.36 Chrome/151 Safari/537.36',

            Origin:
              BASE_URL,

            Referer:
              BASE_URL + '/'
          },

          body:
            JSON.stringify(body)
        }
      );

    if (res.ok) {
      return res.json();
    }

    if (
      res.status === 403 &&
      attempt < 3
    ) {
      const wait =
        3000 * attempt +
        Math.floor(
          Math.random() * 2000
        );

      console.log(
        `[glassdoor] 403 temporário — ` +
        `tentativa ${attempt}/3. ` +
        `Aguardando ${wait}ms...`
      );

      await sleep(wait);

      continue;
    }

    throw new Error(
      `Glassdoor HTTP ` +
      `${res.status} ` +
      `${res.statusText}`
    );
  }

  throw new Error(
    'Glassdoor: máximo de tentativas atingido.'
  );
}

// ============================================================
// PAGINAÇÃO
// ============================================================

function findCursorForPage(
  json,
  targetPage
) {
  const cursors =
    json?.data
      ?.jobListings
      ?.paginationCursors ||
    [];

  const found =
    cursors.find(
      item =>
        Number(item.pageNumber) ===
        Number(targetPage)
    );

  return found?.cursor || null;
}

// ============================================================
// EXECUÇÃO
// ============================================================

(async () => {
  try {
    console.log('');
    console.log(
      '=========================================='
    );
    console.log(
      'GLASSDOOR'
    );
    console.log(
      '=========================================='
    );

    const results = [];
    const seen = new Set();

    let collectedCount = 0;
    let oldCount = 0;
    let expiredCount = 0;
    let roleRejected = 0;

    let roleCount = 0;

    let remoteCount = 0;
    let hybridSPCount = 0;

    let presencialRejected = 0;
    let unknownWorkplaceRejected = 0;
    let hybridOutsideSPRejected = 0;

    let duplicateCount = 0;

    // ========================================================
    // PALAVRAS-CHAVE
    // ========================================================

    for (
      const keyword of KEYWORDS
    ) {
      console.log('');

      console.log(
        `[glassdoor] buscando: ${keyword}`
      );

      let cursor = null;

      // ======================================================
      // PÁGINAS
      // ======================================================

      for (
        let page = 1;
        page <= MAX_PAGES;
        page++
      ) {
        try {
          console.log(
            `[glassdoor] ${keyword} | ` +
            `página ${page}`
          );

          const json =
            await requestJobs(
              keyword,
              page,
              cursor
            );

          const listings =
            json?.data
              ?.jobListings
              ?.jobListings ||
            [];

          console.log(
            `[glassdoor] recebidas: ` +
            `${listings.length}`
          );

          if (!listings.length) {
            break;
          }

          collectedCount +=
            listings.length;

          // ==================================================
          // VAGAS DA PÁGINA
          // ==================================================

          for (
            const item of listings
          ) {
            const view =
              item?.jobview;

            if (!view) {
              continue;
            }

            const header =
              view.header || {};

            const job =
              view.job || {};

            // -----------------------------------------------
            // IDADE
            // -----------------------------------------------

            const age =
              Number(
                header.ageInDays
              );

            if (
              Number.isFinite(age) &&
              age > MAX_AGE_DAYS
            ) {
              oldCount++;
              continue;
            }

            // -----------------------------------------------
            // EXPIRADA
            // -----------------------------------------------

            if (
              header.expired === true
            ) {
              expiredCount++;
              continue;
            }

            // -----------------------------------------------
            // TÍTULO
            // -----------------------------------------------

            const title =
              String(
                header.jobTitleText ||
                job.jobTitleText ||
                ''
              ).trim();

            const role =
              getRole(title);

            if (!role) {
              roleRejected++;
              continue;
            }

            roleCount++;

            // -----------------------------------------------
            // MODALIDADE
            // -----------------------------------------------

            const workplaceType =
              detectWorkplace(
                header,
                job
              );

            const location =
              String(
                header.locationName ||
                ''
              ).trim();

            if (
              workplaceType ===
              'Presencial'
            ) {
              presencialRejected++;
              continue;
            }

            if (
              !workplaceType
            ) {
              unknownWorkplaceRejected++;
              continue;
            }

            if (
              workplaceType ===
              'Híbrido'
            ) {
              if (
                !isSaoPauloCity(
                  location
                )
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

            // -----------------------------------------------
            // ID
            // -----------------------------------------------

            const listingId =
              job.listingId ||
              header.jobListingId ||
              '';

            // -----------------------------------------------
            // EMPRESA
            // -----------------------------------------------

            const company =
              String(
                header.employerNameFromSearch ||
                header.employer?.shortName ||
                header.employer?.name ||
                ''
              ).trim();

            // -----------------------------------------------
            // DESCRIÇÃO
            // -----------------------------------------------

            const description =
              (
                Array.isArray(
                  job.descriptionFragmentsText
                )
                  ? job.descriptionFragmentsText
                  : [
                      job.descriptionFragmentsText ||
                      ''
                    ]
              )
                .join(' ')
                .trim();

            // -----------------------------------------------
            // URL
            // -----------------------------------------------

            let url = '';

            if (
              header.seoJobLink
            ) {
              url =
                header.seoJobLink;
            } else if (
              header.jobLink
            ) {
              url =
                String(
                  header.jobLink
                ).startsWith('http')
                  ? header.jobLink
                  : BASE_URL +
                    header.jobLink;
            }

            // -----------------------------------------------
            // DEDUPLICAÇÃO
            // -----------------------------------------------

            const key =
              listingId
                ? `id:${listingId}`
                : (
                    `${normalize(title)}|` +
                    `${normalize(company)}|` +
                    `${normalize(location)}`
                  );

            if (
              seen.has(key)
            ) {
              duplicateCount++;
              continue;
            }

            seen.add(key);

            // -----------------------------------------------
            // RESULTADO
            // -----------------------------------------------

            results.push({
              id:
                String(
                  listingId
                ),

              source:
                'Glassdoor',

              keyword,

              role,

              jobTitle:
                title,

              company,

              workplaceType,

              location,

              ageDays:
                Number.isFinite(age)
                  ? age
                  : '',

              salary:
                getSalary(header),

              easyApply:
                header.easyApply === true
                  ? 'Sim'
                  : 'Não',

              description,

              url
            });
          }

          // ==================================================
          // PRÓXIMA PÁGINA
          // ==================================================

          const nextPage =
            page + 1;

          const nextCursor =
            findCursorForPage(
              json,
              nextPage
            );

          if (!nextCursor) {
            console.log(
              `[glassdoor] sem cursor ` +
              `para página ${nextPage}.`
            );

            break;
          }

          cursor =
            nextCursor;

          await sleep(
            1500 +
            Math.floor(
              Math.random() * 1000
            )
          );

        } catch (error) {
          console.error(
            `[glassdoor] erro em ` +
            `${keyword}, página ${page}: ` +
            `${error.message}`
          );

          break;
        }
      }

      await sleep(
        1500 +
        Math.floor(
          Math.random() * 1000
        )
      );
    }

    // ========================================================
    // SALVAR
    // ========================================================

    const output =
      path.join(
        DIR,
        'glassdoor_results.json'
      );

    fs.writeFileSync(
      output,
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
      '[glassdoor] RESUMO FINAL'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `[glassdoor] vagas recebidas: ${collectedCount}`
    );

    console.log(
      `[glassdoor] limite de idade: ${MAX_AGE_DAYS} dias`
    );

    console.log(
      `[glassdoor] vagas antigas descartadas: ${oldCount}`
    );

    console.log(
      `[glassdoor] vagas expiradas descartadas: ${expiredCount}`
    );

    console.log(
      `[glassdoor] títulos incompatíveis descartados: ${roleRejected}`
    );

    console.log(
      `[glassdoor] títulos compatíveis dentro do período: ${roleCount}`
    );

    console.log(
      `[glassdoor] presenciais descartadas: ${presencialRejected}`
    );

    console.log(
      `[glassdoor] modalidade não identificada descartada: ${unknownWorkplaceRejected}`
    );

    console.log(
      `[glassdoor] híbridas fora de São Paulo descartadas: ${hybridOutsideSPRejected}`
    );

    console.log(
      `[glassdoor] Remotas aceitas: ${remoteCount}`
    );

    console.log(
      `[glassdoor] Híbridas São Paulo aceitas: ${hybridSPCount}`
    );

    console.log(
      `[glassdoor] duplicadas descartadas: ${duplicateCount}`
    );

    console.log(
      `[glassdoor] TOTAL FINAL: ${results.length}`
    );

    console.log(
      `[glassdoor] wrote ${results.length} rows -> glassdoor_results.json`
    );

  } catch (error) {
    console.error(
      `[glassdoor] ERRO FATAL: ${error.message}`
    );

    process.exitCode = 1;
  }
})();