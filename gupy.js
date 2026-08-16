const fs = require('fs');
const path = require('path');

const {
  DIR,
  loadCompanies,
  compact,
  matchRole,
  sleep
} = require('./lib.js');

// Busca ampla por vagas com "Analista"
const QUERIES = [
  'Analista'
];

const API = 'https://employability-portal.gupy.io/api/v1/jobs';

// REGRA:
// 1. Remoto = qualquer localização
// 2. Híbrido = somente São Paulo/SP
function isRemoteOrHybridSP(workplaceType, isRemoteWork, city, state) {
  const normalize = value =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const w = normalize(workplaceType);
  const c = normalize(city);
  const s = normalize(state);

  // REMOTO: aceita independentemente da localização
  if (
    isRemoteWork === true ||
    w.includes('remote') ||
    w.includes('remoto')
  ) {
    return true;
  }

  // Verifica se é híbrido
  const isHybrid =
    w.includes('hybrid') ||
    w.includes('hibrido');

  if (!isHybrid) {
    return false;
  }

  // HÍBRIDO: somente cidade de São Paulo/SP
  const isSaoPaulo =
    c === 'sao paulo' ||
    c.includes('sao paulo') ||
    s === 'sp' ||
    s === 'sao paulo';

  return isSaoPaulo;
}

async function fetchPage(q, offset, limit) {
  const url =
    `${API}?jobName=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${q}@${offset}`);
  }

  return res.json();
}

async function fetchAll(q) {
  const limit = 100;
  const MAX_OFFSET = 3000;

  let offset = 0;
  let out = [];

  while (offset <= MAX_OFFSET) {
    let json;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        json = await fetchPage(q, offset, limit);
        break;
      } catch (e) {
        if (attempt === 2) {
          throw e;
        }

        await sleep(800);
      }
    }

    const data = json.data || [];

    out.push(...data);

    if (data.length < limit) {
      break;
    }

    offset += limit;

    await sleep(120);
  }

  return {
    total: out.length,
    jobs: out
  };
}

(async () => {
  const companies = loadCompanies();

  const listCompact = companies
    .map(c => ({
      orig: c,
      c: compact(c)
    }))
    .filter(x => x.c.length >= 2);

  function matchCompany(careerPageName) {
    const cp = compact(careerPageName);

    if (!cp) {
      return null;
    }

    // Correspondência exata
    let hit = listCompact.find(
      x => x.c === cp
    );

    if (hit) {
      return hit.orig;
    }

    // Correspondência parcial
    hit = listCompact.find(
      x =>
        (x.c.length >= 5 && cp.includes(x.c)) ||
        (cp.length >= 5 && x.c.includes(cp))
    );

    return hit ? hit.orig : null;
  }

  const byId = new Map();
  const wpValues = new Set();

  // BUSCA
  for (const q of QUERIES) {
    process.stdout.write(
      ` [gupy] "${q}" ...`
    );

    const { total, jobs } =
      await fetchAll(q);

    for (const j of jobs) {
      // Remove vagas duplicadas
      byId.set(j.id, j);
    }

    console.log(
      `total=${total} fetched=${jobs.length}`
    );
  }

  console.log(
    `[gupy] unique jobs pooled: ${byId.size}`
  );

  const results = [];

  let roleCount = 0;
  let remoteCount = 0;
  let hybridSPCount = 0;
  let inList = 0;
  let outList = 0;

  for (const j of byId.values()) {
    wpValues.add(j.workplaceType);

    // O lib.js verifica se "Analista" está no título
    const role = matchRole(j.name);

    if (!role) {
      continue;
    }

    roleCount++;

    const normalize = value =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const workplace =
      normalize(j.workplaceType);

    const isRemote =
      j.isRemoteWork === true ||
      workplace.includes('remote') ||
      workplace.includes('remoto');

    const accepted =
      isRemoteOrHybridSP(
        j.workplaceType,
        j.isRemoteWork,
        j.city,
        j.state
      );

    if (!accepted) {
      continue;
    }

    if (isRemote) {
      remoteCount++;
    } else {
      hybridSPCount++;
    }

    const company =
      matchCompany(j.careerPageName);

    if (company) {
      inList++;
    } else {
      outList++;
    }

    results.push({
      platform: 'Gupy',

      companyList:
        company || j.careerPageName,

      companyGupy:
        j.careerPageName,

      na_lista:
        company ? 'Sim' : 'Não',

      role,

      jobTitle:
        j.name,

      workplaceType:
        j.workplaceType,

      location:
        [
          j.city,
          j.state,
          j.country
        ]
          .filter(Boolean)
          .join(' / '),

      url:
        j.jobUrl ||
        j.careerPageUrl ||
        '',

      publishedDate:
        j.publishedDate || ''
    });
  }

  console.log(
    `[gupy] workplaceType encontrados: ${[...wpValues].join(', ')}`
  );

  console.log(
    `[gupy] títulos Analista: ${roleCount}`
  );

  console.log(
    `[gupy] Remotas aceitas: ${remoteCount}`
  );

  console.log(
    `[gupy] Híbridas São Paulo aceitas: ${hybridSPCount}`
  );

  console.log(
    `[gupy] TOTAL FINAL: ${results.length}`
  );

  console.log(
    `[gupy] empresas da lista=${inList} | fora da lista=${outList}`
  );

  fs.writeFileSync(
    path.join(
      DIR,
      'gupy_results.json'
    ),
    JSON.stringify(
      results,
      null,
      2
    )
  );

  console.log(
    `[gupy] wrote ${results.length} rows -> gupy_results.json`
  );

  // Presença das empresas
  const presence = new Map();

  for (const j of byId.values()) {
    const company =
      matchCompany(j.careerPageName);

    if (!company) {
      continue;
    }

    if (!presence.has(company)) {
      presence.set(
        company,
        {
          empresa: company,
          nome_na_plataforma:
            j.careerPageName,
          vagas_no_pool: 0
        }
      );
    }

    presence.get(company)
      .vagas_no_pool++;
  }

  const presenceArr =
    [...presence.values()]
      .sort(
        (a, b) =>
          a.empresa.localeCompare(
            b.empresa
          )
      );

  fs.writeFileSync(
    path.join(
      DIR,
      'gupy_presence.json'
    ),
    JSON.stringify(
      presenceArr,
      null,
      2
    )
  );

  console.log(
    `[gupy] in-list companies present in Gupy search pool: ${presenceArr.length}`
  );
})();