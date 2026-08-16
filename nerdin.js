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

const TEST_LIMIT = 20;

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
    .replace(/&ccedil;/gi, 'ç');
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
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} - ${url}`);
  }

  return res.text();
}

function getTotalPages(html) {
  const text = stripTags(html);

  const match =
    text.match(/Página\s+\d+\s+de\s+(\d+)/i);

  return match
    ? Number(match[1])
    : 1;
}

function parseJobs(html) {
  const jobs = [];

  const linkRegex =
    /href=["']([^"']*vaga_emprego\/vaga-[^"'?#]+\.php)["']/gi;

  let match;

  const seen = new Set();

  while (
    (match = linkRegex.exec(html)) !== null
  ) {
    let url = match[1];

    if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (url.startsWith('/')) {
      url = BASE_URL + url;
    } else if (
      !url.startsWith('http://') &&
      !url.startsWith('https://')
    ) {
      url =
        BASE_URL +
        '/' +
        url.replace(/^\/+/, '');
    }

    if (seen.has(url)) {
      continue;
    }

    seen.add(url);

    jobs.push({
      url
    });
  }

  return jobs;
}

/*
  IMPORTANTE:
  remove a parte "Vagas semelhantes para você".

  Assim empresa, modalidade e localização
  são extraídas somente da vaga atual.
*/
function getMainJobHtml(html) {
  const patterns = [
    /<h2[^>]*>\s*Vagas semelhantes para você\s*<\/h2>/i,
    /Vagas semelhantes para você/i
  ];

  let end = html.length;

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (
      match &&
      typeof match.index === 'number'
    ) {
      end = Math.min(
        end,
        match.index
      );
    }
  }

  return html.slice(0, end);
}

function extractTitle(mainHtml) {
  /*
    O H1 inclui modalidade:
    Analista X - Home Office

    O H2 é o cargo puro:
    Analista X
  */

  const h2Match =
    mainHtml.match(
      /<h2[^>]*>([\s\S]*?)<\/h2>/i
    );

  if (h2Match) {
    const title =
      stripTags(h2Match[1]);

    if (title) {
      return title;
    }
  }

  const h1Match =
    mainHtml.match(
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    );

  if (h1Match) {
    return stripTags(h1Match[1])
      .replace(
        /\s*-\s*(Home Office|Remoto|Híbrido|Hibrido|Presencial).*$/i,
        ''
      )
      .trim();
  }

  return '';
}

function extractHeaderText(mainHtml) {
  /*
    Pegamos somente uma pequena área depois do H2.
    É exatamente onde o Nerdin mostra:

    Título
    Empresa
    Home Office / Híbrido / Presencial
    Senioridade
    candidatos
  */

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

  const chunk =
    mainHtml.slice(
      start,
      start + 4000
    );

  return stripTags(chunk);
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

  const chunk =
    mainHtml.slice(
      start,
      start + 2500
    );

  /*
    Primeiro tentamos encontrar um link
    logo após o H2.

    Em várias vagas a empresa é clicável.
  */
  const anchorMatch =
    chunk.match(
      /<a[^>]*>([\s\S]*?)<\/a>/i
    );

  if (anchorMatch) {
    let company =
      stripTags(
        anchorMatch[1]
      );

    company =
      company
        .replace(
          /\s+\d+\s+Vagas?\s+Ativas?.*$/i,
          ''
        )
        .trim();

    if (
      company &&
      !/home office|híbrido|hibrido|presencial|enviar candidatura/i.test(
        company
      )
    ) {
      return company;
    }
  }

  /*
    Algumas empresas não são link.
    Então usamos o texto imediatamente
    depois do H2.
  */
  const text =
    stripTags(chunk);

  const lines =
    text
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean);

  for (const line of lines) {
    let candidate =
      line
        .replace(
          /\s+\d+\s+Vagas?\s+Ativas?.*$/i,
          ''
        )
        .trim();

    if (!candidate) {
      continue;
    }

    if (
      candidate === title ||
      /home office/i.test(candidate) ||
      /\bhíbrido\b/i.test(candidate) ||
      /\bhibrido\b/i.test(candidate) ||
      /\bpresencial\b/i.test(candidate) ||
      /\bremoto\b/i.test(candidate) ||
      /\bcandidatos?\b/i.test(candidate) ||
      /\benviar candidatura\b/i.test(candidate) ||
      /\bsalário\b/i.test(candidate) ||
      /\bsalario\b/i.test(candidate)
    ) {
      continue;
    }

    if (
      candidate.length >= 2 &&
      candidate.length <= 100
    ) {
      return candidate;
    }
  }

  return '';
}

function extractWorkplace(
  mainHtml,
  headerText
) {
  /*
    Usamos primeiro o cabeçalho próximo
    ao título/empresa.
  */

  const h1Match =
    mainHtml.match(
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    );

  const h1 =
    h1Match
      ? stripTags(h1Match[1])
      : '';

  const source =
    `${h1} ${headerText}`;

  if (
    /\bhome\s*office\b/i.test(source) ||
    /\bremoto\b/i.test(source) ||
    /\bremote\b/i.test(source)
  ) {
    return 'Home Office';
  }

  if (
    /\bhíbrido\b/i.test(source) ||
    /\bhibrido\b/i.test(source) ||
    /\bhybrid\b/i.test(source)
  ) {
    return 'Híbrido';
  }

  if (
    /\bpresencial\b/i.test(source)
  ) {
    return 'Presencial';
  }

  return '';
}

function extractLocation(
  mainHtml,
  headerText,
  workplace
) {
  const source =
    `${headerText} ${stripTags(mainHtml)}`;

  /*
    Procuramos Cidade/UF somente
    no conteúdo principal da vaga.
  */

  const labelled =
    source.match(
      /(?:Localização|Local|Cidade)\s*:?\s*([A-Za-zÀ-ÿ.'\- ]{2,50})\s*[\/-]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i
    );

  if (labelled) {
    return (
      `${labelled[1].trim()} / ` +
      labelled[2].toUpperCase()
    );
  }

  /*
    Caso não exista label, procuramos
    cidade/UF no cabeçalho da vaga.
  */

  const generic =
    headerText.match(
      /\b([A-Za-zÀ-ÿ.'\- ]{2,40})\s*[\/-]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i
    );

  if (generic) {
    return (
      `${generic[1].trim()} / ` +
      generic[2].toUpperCase()
    );
  }

  if (
    workplace === 'Home Office'
  ) {
    return 'Home Office';
  }

  return '';
}

function extractPublishedDate(
  headerText,
  mainText
) {
  /*
    Nerdin costuma mostrar "hoje",
    "há 1 dia", etc.

    Por enquanto guardamos o texto
    original em vez de inventar data.
  */

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

function isRemoteOrHybridSP(
  workplace,
  location
) {
  const w =
    normalize(workplace);

  const l =
    normalize(location);

  if (
    w.includes('home office') ||
    w.includes('remoto') ||
    w.includes('remote')
  ) {
    return true;
  }

  const hybrid =
    w.includes('hibrido') ||
    w.includes('hybrid');

  if (!hybrid) {
    return false;
  }

  /*
    Sua regra:
    híbrido somente São Paulo capital.

    Não basta ser SP.
  */

  return (
    l.includes('sao paulo')
  );
}

async function fetchJobDetails(job) {
  const html =
    await fetchHtml(job.url);

  const mainHtml =
    getMainJobHtml(html);

  const mainText =
    stripTags(mainHtml);

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

  const publishedDate =
    extractPublishedDate(
      headerText,
      mainText
    );

  return {
    title,
    company,
    workplaceType,
    location,
    url: job.url,
    publishedDate
  };
}

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
          x => x.c.length >= 2
        );

    function matchCompany(name) {
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
              cp.includes(x.c)
            ) ||
            (
              cp.length >= 5 &&
              x.c.includes(cp)
            )
        );

      return hit
        ? hit.orig
        : null;
    }

    console.log(
      '[nerdin] MODO TESTE'
    );

    console.log(
      '[nerdin] buscando somente a primeira página...'
    );

    /*
      Para o teste:
      NÃO percorremos as 32 páginas.

      A primeira já tem 20 vagas.
    */

    const html =
      await fetchHtml(
        LIST_URL
      );

    const jobs =
      parseJobs(html)
        .slice(
          0,
          TEST_LIMIT
        );

    console.log(
      `[nerdin] links encontrados para teste: ${jobs.length}`
    );

    const results = [];

    let roleCount = 0;
    let remoteCount = 0;
    let hybridSPCount = 0;
    let rejectedWorkplace = 0;
    let emptyTitleCount = 0;
    let inList = 0;
    let outList = 0;

    let current = 0;

    for (
      const job of jobs
    ) {
      current++;

      try {
        const detail =
          await fetchJobDetails(
            job
          );

        console.log(
          '\n=========================================='
        );

        console.log(
          `[nerdin] VAGA ${current}/${jobs.length}`
        );

        console.log(
          `Título: ${detail.title}`
        );

        console.log(
          `Empresa: ${detail.company}`
        );

        console.log(
          `Modalidade: ${detail.workplaceType}`
        );

        console.log(
          `Localização: ${detail.location}`
        );

        console.log(
          `Data: ${detail.publishedDate}`
        );

        console.log(
          `URL: ${detail.url}`
        );

        if (
          !detail.title
        ) {
          emptyTitleCount++;

          console.log(
            'Match de cargo: NÃO'
          );

          continue;
        }

        const role =
          matchRole(
            detail.title
          );

        console.log(
          `Match de cargo: ${role || 'NÃO'}`
        );

        if (!role) {
          continue;
        }

        roleCount++;

        const accepted =
          isRemoteOrHybridSP(
            detail.workplaceType,
            detail.location
          );

        console.log(
          `Aceita modalidade/local: ${accepted ? 'SIM' : 'NÃO'}`
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
          )
        ) {
          remoteCount++;
        } else {
          hybridSPCount++;
        }

        const company =
          matchCompany(
            detail.company
          );

        console.log(
          `Empresa na lista: ${company ? 'SIM' : 'NÃO'}`
        );

        if (company) {
          inList++;
        } else {
          outList++;
        }

        results.push({
          platform:
            'Nerdin',

          companyList:
            company ||
            detail.company ||
            '',

          /*
            Mantemos esse nome
            por compatibilidade
            com seu projeto atual.
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

          url:
            detail.url,

          publishedDate:
            detail.publishedDate ||
            ''
        });

      } catch (e) {
        console.log(
          `\n[nerdin] erro em ${job.url}: ${e.message}`
        );
      }

      await sleep(100);
    }

    console.log(
      '\n=========================================='
    );

    console.log(
      '[nerdin] RESUMO DO TESTE'
    );

    console.log(
      `[nerdin] vagas testadas: ${jobs.length}`
    );

    console.log(
      `[nerdin] títulos compatíveis: ${roleCount}`
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
      `[nerdin] TOTAL FINAL DO TESTE: ${results.length}`
    );

    console.log(
      `[nerdin] empresas da lista=${inList} | fora da lista=${outList}`
    );

    fs.writeFileSync(
      path.join(
        DIR,
        'nerdin_test_results.json'
      ),
      JSON.stringify(
        results,
        null,
        2
      )
    );

    console.log(
      `[nerdin] wrote ${results.length} rows -> nerdin_test_results.json`
    );

  } catch (e) {
    console.error(
      `[nerdin] ERRO FATAL: ${e.message}`
    );

    process.exitCode = 1;
  }
})();