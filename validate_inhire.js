const fs = require('fs');
const path = require('path');

const {
  DIR,
  loadCompanies,
  compact,
  tokens,
  matchRole,
  slugify,
  pool,
  sleep,
  STOP
} = require('./lib.js');

// generic business words that must NOT alone justify a company match
const GENERIC = new Set([
  ...STOP,
  'consultoria',
  'consulting',
  'saude',
  'educacao',
  'educacional',
  'educacent',
  'servicos',
  'servico',
  'sistemas',
  'seguros',
  'seguro',
  'energia',
  'capital',
  'ventures',
  'labs',
  'lab',
  'data',
  'dados',
  'tech',
  'technology',
  'digital',
  'solutions',
  'solucoes',
  'engenharia',
  'industria',
  'industrial',
  'comercio',
  'comercial',
  'agro',
  'pay',
  'app',
  'software',
  'cloud',
  'global',
  'partners',
  'advogados',
  'advocacia',
  'corporate',
  'gov',
  'store',
  'saudavel',
  'nutricao',
  'alimentos',
  'recruitment',
  'rh',
  'consult',
  'it'
]);

const HB = {
  'X-Inhire-Client': 'web-inhire',
  'Content-Type': 'application/json'
};

const INFRA = new Set([
  'www',
  'api',
  'auth',
  'app',
  'status',
  'mcp',
  'mcp-dev',
  'inhub',
  'login',
  'admin',
  'inhire-admin',
  'saml-setup',
  'sso-setup',
  'preview',
  'senior',
  'files',
  'portal',
  'board',
  'people',
  'new',
  'novo',
  'conteudo',
  'docs',
  'email',
  'lp',
  'hub',
  'webinar',
  'analytics',
  'analytics-ss'
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function collectSlugs() {
  const s = new Set();

  const addHost = h => {
    const m = String(h || '')
      .toLowerCase()
      .match(/^([a-z0-9-]+).inhire.app$/);

    if (m) {
      s.add(m[1]);
    }
  };

  const addUrl = u => {
    const m = String(u || '')
      .match(/https?:\/\/([a-z0-9-]+).inhire.app/i);

    if (m) {
      s.add(m[1].toLowerCase());
    }
  };

  for (const f of ['us_app.json', 'us_app_paged.json']) {
    try {
      const a = JSON.parse(
        fs.readFileSync(path.join(DIR, f), 'utf8')
      );

      for (const r of (a.results || [])) {
        addHost(r.page && r.page.domain);
        addUrl(r.page && r.page.url);
        addUrl(r.task && r.task.url);
      }
    } catch {}
  }

  try {
    fs.readFileSync(
      path.join(DIR, 'cc_app.jsonl'),
      'utf8'
    )
      .split(/\n/)
      .forEach(l => {
        if (l.trim()) {
          try {
            addUrl(JSON.parse(l).url);
          } catch {}
        }
      });
  } catch {}

  try {
    fs.readFileSync(
      path.join(DIR, 'wb_app.txt'),
      'utf8'
    )
      .split(/\n/)
      .forEach(addUrl);
  } catch {}

  try {
    JSON.parse(
      fs.readFileSync(
        path.join(DIR, 'inhire_tenants.json'),
        'utf8'
      )
    ).forEach(t => s.add(t.slug));
  } catch {}

  return [...s].filter(
    x =>
      x &&
      !INFRA.has(x) &&
      x.length >= 2
  );
}

async function fetchTenant(slug) {
  try {
    const res = await fetch(
      'https://api.inhire.app/job-posts/public/pages',
      {
        headers: {
          ...HB,
          'X-Tenant': slug
        }
      }
    );

    if (!res.ok) {
      return null;
    }

    const j = await res.json();

    if (Array.isArray(j)) {
      return null;
    }

    return j;
  } catch {
    return null;
  }
}

function nameMatches(company, tenantName) {
  const ca = compact(company);
  const cb = compact(tenantName);

  if (!ca || !cb) {
    return false;
  }

  if (ca === cb) {
    return true;
  }

  if (
    ca.length >= 5 &&
    cb.includes(ca)
  ) {
    return true;
  }

  if (
    cb.length >= 5 &&
    ca.includes(cb)
  ) {
    return true;
  }

  const a = new Set(
    tokens(company)
      .filter(t => !GENERIC.has(t))
  );

  const b = new Set(
    tokens(tenantName)
      .filter(t => !GENERIC.has(t))
  );

  for (const t of a) {
    if (
      b.has(t) &&
      t.length >= 3
    ) {
      return true;
    }
  }

  return false;
}

// Regra:
// REMOTO = qualquer localização
// HÍBRIDO = somente São Paulo/SP
function isRemoteOrHybridSP(workplaceType, location) {
  const wp = normalize(workplaceType);
  const loc = normalize(location);

  const isRemote =
    wp.includes('remote') ||
    wp.includes('remoto');

  if (isRemote) {
    return {
      accepted: true,
      type: 'remote'
    };
  }

  const isHybrid =
    wp.includes('hybrid') ||
    wp.includes('hibrido');

  if (!isHybrid) {
    return {
      accepted: false,
      type: null
    };
  }

  // InHire normalmente concentra cidade/estado no campo location
  const isSaoPaulo =
    loc.includes('sao paulo') ||
    loc === 'sp' ||
    loc.includes('/ sp') ||
    loc.includes('- sp') ||
    loc.includes(', sp');

  return {
    accepted: isSaoPaulo,
    type: isSaoPaulo ? 'hybrid-sp' : null
  };
}

(async () => {
  const slugs = collectSlugs();

  console.log(
    `candidate slugs to validate: ${slugs.length}`
  );

  const companies = loadCompanies();

  const tenants = [];
  let done = 0;

  await pool(
    slugs,
    async slug => {
      let data = null;

      for (let a = 0; a < 2; a++) {
        data = await fetchTenant(slug);

        if (data) {
          break;
        }

        await sleep(300);
      }

      if (
        data &&
        data.tenantName !== undefined
      ) {
        const jobs =
          Array.isArray(data.jobsPage)
            ? data.jobsPage
            : [];

        tenants.push({
          slug,
          tenantName:
            data.tenantName || slug,
          jobsCount:
            jobs.length,
          jobs
        });
      }

      if (++done % 40 === 0) {
        process.stdout.write(
          `  validated ${done}/${slugs.length}, real tenants ${tenants.length}\n`
        );
      }
    },
    16
  );

  const bySlug = new Map();

  tenants.forEach(t => {
    bySlug.set(t.slug, t);
  });

  const all = [...bySlug.values()]
    .sort(
      (a, b) =>
        a.tenantName.localeCompare(
          b.tenantName
        )
    );

  for (const t of all) {
    const hit =
      companies.find(
        c =>
          nameMatches(
            c,
            t.tenantName
          )
      ) || null;

    t.listCompany = hit;
  }

  const inList =
    all.filter(t => t.listCompany);

  const outList =
    all.filter(t => !t.listCompany);

  const vagas = [];

  let roleCount = 0;
  let remoteCount = 0;
  let hybridSPCount = 0;

  for (const t of all) {
    for (const j of t.jobs) {
      if (
        j.status &&
        String(j.status).toLowerCase() !== 'published'
      ) {
        continue;
      }

      const role =
        matchRole(j.displayName);

      if (!role) {
        continue;
      }

      roleCount++;

      const filter =
        isRemoteOrHybridSP(
          j.workplaceType,
          j.location
        );

      if (!filter.accepted) {
        continue;
      }

      if (filter.type === 'remote') {
        remoteCount++;
      }

      if (filter.type === 'hybrid-sp') {
        hybridSPCount++;
      }

      vagas.push({
        platform: 'InHire',
        companyList:
          t.listCompany || '',
        companyInhire:
          t.tenantName,
        role,
        jobTitle:
          j.displayName,
        workplaceType:
          j.workplaceType,
        location:
          j.location || '',
        url:
          `https://${t.slug}.inhire.app/vagas/${j.jobId}/${slugify(j.displayName)}`,
        publishedDate: '',
        inUserList:
          !!t.listCompany
      });
    }
  }

  fs.writeFileSync(
    path.join(
      DIR,
      'inhire_all_tenants.json'
    ),
    JSON.stringify(
      all.map(
        ({ jobs, ...r }) => ({
          ...r,
          sampleJobs:
            jobs.length
        })
      ),
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(
      DIR,
      'inhire_all_vagas.json'
    ),
    JSON.stringify(
      vagas,
      null,
      2
    )
  );

  console.log(
    '\n=== INHIRE DISCOVERY ==='
  );

  console.log(
    `real InHire tenants confirmed: ${all.length}`
  );

  console.log(
    `matching your list: ${inList.length}`
  );

  console.log(
    `outside your list: ${outList.length}`
  );

  console.log(
    `titulos Analista encontrados: ${roleCount}`
  );

  console.log(
    `Remotas aceitas: ${remoteCount}`
  );

  console.log(
    `Hibridas Sao Paulo aceitas: ${hybridSPCount}`
  );

  console.log(
    `TOTAL FINAL INHIRE: ${vagas.length}`
  );
})();