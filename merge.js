const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// ============================================================
// FONTES OFICIAIS DO MERGE
// ============================================================

const FILES = [
  'gupy_results.json',
  'inhire_results.json',
  'nerdin_results.json',
  'trampos_results.json',
  'mentoradados_results.json',
  'radarvagas_results.json',
  'glassdoor_results.json',
  'vagas_results.json',
  'solides_results.json'
];

const OUTPUT = path.join(
  DIR,
  'vagas_merged.json'
);

// ============================================================
// UTILITÁRIOS
// ============================================================

function clean(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

  return String(value).trim();
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWorkplace(value) {
  const text = normalize(value);

  if (
    text.includes('remot') ||
    text.includes('home office') ||
    text.includes('home-office')
  ) {
    return 'Remoto';
  }

  if (
    text.includes('hibrid') ||
    text === 'hybrid'
  ) {
    return 'Híbrido';
  }

  if (
    text.includes('presencial') ||
    text.includes('onsite') ||
    text.includes('on-site')
  ) {
    return 'Presencial';
  }

  return clean(value);
}

function firstValue(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      clean(value) !== ''
    ) {
      return value;
    }
  }

  return '';
}

function getSourceFromFile(filename) {
  const map = {
    'gupy_results.json': 'Gupy',
    'inhire_results.json': 'InHire',
    'nerdin_results.json': 'Nerdin',
    'trampos_results.json': 'Trampos.co',
    'mentoradados_results.json': 'Mentora Dados',
    'radarvagas_results.json': 'Radar Vagas',
    'glassdoor_results.json': 'Glassdoor',
    'vagas_results.json': 'Vagas.com',
    'solides_results.json': 'Sólides'
  };

  return map[filename] || filename;
}

// ============================================================
// NORMALIZAÇÃO
// ============================================================

function normalizeJob(job, filename) {
  const source =
    firstValue(
      job.source,
      job.platform,
      job.plataforma,
      getSourceFromFile(filename)
    );

  const jobTitle =
    firstValue(
      job.jobTitle,
      job.title,
      job.titulo_vaga,
      job.titulo,
      job.cargo
    );

  const company =
    firstValue(
      job.company,
      job.companyName,
      job.companyList,
      job.companyGupy,
      job.empresa,
      job.nome_na_plataforma
    );

  const workplaceRaw =
    firstValue(
      job.workplaceType,
      job.tipo,
      job.jobType,
      job.modalidade,
      job.modelo
    );

  const workplaceType =
    normalizeWorkplace(
      workplaceRaw
    );

  const location =
    firstValue(
      job.location,
      job.local,
      job.localidade
    );

  const url =
    firstValue(
      job.externalApplyUrl,
      job.link_candidatura,
      job.url,
      job.link,
      job.redirectLink,
      job.originalUrl,
      job.link_fonte
    );

  const originalUrl =
    firstValue(
      job.originalUrl,
      job.link_fonte,
      job.url,
      job.link
    );

  const publishedDate =
    firstValue(
      job.publishedDate,
      job.createdAt,
      job.publicado,
      job.date,
      job.dataPublicacao
    );

  const description =
    firstValue(
      job.description,
      job.descricao
    );

  const seniority =
    firstValue(
      job.seniority,
      job.senioridade
    );

  const role =
    firstValue(
      job.role,
      job.cargo_categoria,
      job.area
    );

  const id =
    firstValue(
      job.id,
      job.jobId,
      job.jobIdEncoded,
      job.jobkey,
      job.referenceId
    );

  let ageDays = '';

  if (
    job.ageDays !== undefined &&
    job.ageDays !== null &&
    job.ageDays !== ''
  ) {
    ageDays =
      Number(job.ageDays);
  }

  return {
    source:
      clean(source),

    id:
      clean(id),

    role:
      clean(role),

    jobTitle:
      clean(jobTitle),

    company:
      clean(company),

    workplaceType:
      workplaceType,

    location:
      clean(location),

    publishedDate:
      clean(publishedDate),

    ageDays,

    seniority:
      clean(seniority),

    url:
      clean(url),

    originalUrl:
      clean(originalUrl),

    description:
      clean(description),

    sourceFile:
      filename
  };
}

// ============================================================
// CHAVES DE DUPLICIDADE
// ============================================================

function cleanUrl(url) {
  if (!url) {
    return '';
  }

  try {
    const parsed =
      new URL(url);

    /*
      Remove parâmetros normalmente usados
      apenas para rastreamento.
    */

    const removeParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'origem',
      'source',
      'ref',
      'rcm'
    ];

    for (
      const param of removeParams
    ) {
      parsed.searchParams.delete(
        param
      );
    }

    return (
      parsed.origin +
      parsed.pathname +
      (
        parsed.searchParams.toString()
          ? '?' +
            parsed.searchParams.toString()
          : ''
      )
    )
      .replace(/\/+$/, '')
      .toLowerCase();

  } catch {
    return normalize(url);
  }
}

function getUrlKeys(job) {
  const keys = [];

  const url =
    cleanUrl(
      job.url
    );

  const original =
    cleanUrl(
      job.originalUrl
    );

  if (url) {
    keys.push(
      `url:${url}`
    );
  }

  if (
    original &&
    original !== url
  ) {
    keys.push(
      `url:${original}`
    );
  }

  return keys;
}

function getIdentityKey(job) {
  const title =
    normalize(
      job.jobTitle
    );

  const company =
    normalize(
      job.company
    );

  const workplace =
    normalize(
      job.workplaceType
    );

  if (
    !title ||
    !company
  ) {
    return '';
  }

  return [
    'job',
    title,
    company,
    workplace
  ].join('|');
}

// ============================================================
// ESCOLHER MELHOR REGISTRO QUANDO DUPLICADO
// ============================================================

function score(job) {
  let points = 0;

  if (job.jobTitle) points += 10;
  if (job.company) points += 8;
  if (job.url) points += 8;
  if (job.location) points += 4;
  if (job.publishedDate) points += 4;
  if (job.description) points += 3;
  if (job.seniority) points += 2;
  if (job.role) points += 2;

  return points;
}

function mergeDuplicate(
  current,
  incoming
) {
  let primary =
    current;

  let secondary =
    incoming;

  if (
    score(incoming) >
    score(current)
  ) {
    primary = incoming;
    secondary = current;
  }

  const sources =
    new Set([
      ...(primary.sources || [
        primary.source
      ]),

      ...(secondary.sources || [
        secondary.source
      ])
    ]);

  const sourceFiles =
    new Set([
      ...(primary.sourceFiles || [
        primary.sourceFile
      ]),

      ...(secondary.sourceFiles || [
        secondary.sourceFile
      ])
    ]);

  return {
    ...primary,

    id:
      firstValue(
        primary.id,
        secondary.id
      ),

    role:
      firstValue(
        primary.role,
        secondary.role
      ),

    company:
      firstValue(
        primary.company,
        secondary.company
      ),

    workplaceType:
      firstValue(
        primary.workplaceType,
        secondary.workplaceType
      ),

    location:
      firstValue(
        primary.location,
        secondary.location
      ),

    publishedDate:
      firstValue(
        primary.publishedDate,
        secondary.publishedDate
      ),

    ageDays:
      firstValue(
        primary.ageDays,
        secondary.ageDays
      ),

    seniority:
      firstValue(
        primary.seniority,
        secondary.seniority
      ),

    url:
      firstValue(
        primary.url,
        secondary.url
      ),

    originalUrl:
      firstValue(
        primary.originalUrl,
        secondary.originalUrl
      ),

    description:
      firstValue(
        primary.description,
        secondary.description
      ),

    sources:
      [...sources],

    sourceFiles:
      [...sourceFiles]
  };
}

// ============================================================
// MAIN
// ============================================================

function main() {
  console.log('');
  console.log(
    '=========================================='
  );
  console.log(
    'MERGE DE VAGAS'
  );
  console.log(
    '=========================================='
  );
  console.log('');

  const allJobs = [];

  const stats = {};

  // ==========================================================
  // CARREGAR FONTES
  // ==========================================================

  for (
    const filename of FILES
  ) {
    const filepath =
      path.join(
        DIR,
        filename
      );

    if (
      !fs.existsSync(filepath)
    ) {
      console.log(
        `[merge] AUSENTE: ${filename}`
      );

      stats[filename] = {
        received: 0,
        error: 'arquivo não encontrado'
      };

      continue;
    }

    try {
      const text =
        fs.readFileSync(
          filepath,
          'utf8'
        );

      const parsed =
        JSON.parse(text);

      const jobs =
        Array.isArray(parsed)
          ? parsed
          : [];

      stats[filename] = {
        received:
          jobs.length
      };

      console.log(
        `[merge] ${filename}: ${jobs.length}`
      );

      for (
        const job of jobs
      ) {
        const normalized =
          normalizeJob(
            job,
            filename
          );

        /*
          Não inclui registros completamente
          vazios ou sem título.
        */

        if (
          !normalized.jobTitle
        ) {
          continue;
        }

        allJobs.push(
          normalized
        );
      }

    } catch (
      error
    ) {
      console.log(
        `[merge] ERRO ${filename}: ${error.message}`
      );

      stats[filename] = {
        received: 0,
        error:
          error.message
      };
    }
  }

  // ==========================================================
  // DEDUPLICAÇÃO
  // ==========================================================

  const merged = [];

  const urlIndex =
    new Map();

  const identityIndex =
    new Map();

  let duplicates = 0;

  for (
    const job of allJobs
  ) {
    const urlKeys =
      getUrlKeys(job);

    const identityKey =
      getIdentityKey(job);

    let existingIndex = -1;

    // --------------------------------------------------------
    // PRIMEIRO: MESMA URL
    // --------------------------------------------------------

    for (
      const key of urlKeys
    ) {
      if (
        urlIndex.has(key)
      ) {
        existingIndex =
          urlIndex.get(key);

        break;
      }
    }

    // --------------------------------------------------------
    // SEGUNDO: MESMO TÍTULO + EMPRESA + MODALIDADE
    // --------------------------------------------------------

    if (
      existingIndex === -1 &&
      identityKey &&
      identityIndex.has(
        identityKey
      )
    ) {
      existingIndex =
        identityIndex.get(
          identityKey
        );
    }

    // --------------------------------------------------------
    // NOVA VAGA
    // --------------------------------------------------------

    if (
      existingIndex === -1
    ) {
      const index =
        merged.length;

      const newJob = {
        ...job,

        sources: [
          job.source
        ],

        sourceFiles: [
          job.sourceFile
        ]
      };

      merged.push(
        newJob
      );

      for (
        const key of urlKeys
      ) {
        urlIndex.set(
          key,
          index
        );
      }

      if (
        identityKey
      ) {
        identityIndex.set(
          identityKey,
          index
        );
      }

      continue;
    }

    // --------------------------------------------------------
    // DUPLICADA
    // --------------------------------------------------------

    duplicates++;

    const combined =
      mergeDuplicate(
        merged[
          existingIndex
        ],
        job
      );

    merged[
      existingIndex
    ] =
      combined;

    /*
      Registra também URLs descobertas
      no registro duplicado.
    */

    for (
      const key of getUrlKeys(
        combined
      )
    ) {
      urlIndex.set(
        key,
        existingIndex
      );
    }

    if (
      identityKey
    ) {
      identityIndex.set(
        identityKey,
        existingIndex
      );
    }
  }

  // ==========================================================
  // LIMPEZA DE CAMPOS INTERNOS
  // ==========================================================

  const finalJobs =
    merged.map(
      job => {
        const {
          sourceFile,
          ...cleanJob
        } = job;

        return cleanJob;
      }
    );

  // ==========================================================
  // ORDENAÇÃO
  // ==========================================================

  finalJobs.sort(
    (a, b) => {
      /*
        Se ambos tiverem ageDays,
        mais nova primeiro.
      */

      const ageA =
        Number.isFinite(
          Number(a.ageDays)
        )
          ? Number(a.ageDays)
          : 9999;

      const ageB =
        Number.isFinite(
          Number(b.ageDays)
        )
          ? Number(b.ageDays)
          : 9999;

      if (
        ageA !== ageB
      ) {
        return (
          ageA -
          ageB
        );
      }

      return (
        a.jobTitle ||
        ''
      ).localeCompare(
        b.jobTitle ||
        '',
        'pt-BR'
      );
    }
  );

  // ==========================================================
  // SALVAR
  // ==========================================================

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      finalJobs,
      null,
      2
    ),
    'utf8'
  );

  // ==========================================================
  // CONTAGEM POR FONTE
  // ==========================================================

  const bySource = {};

  for (
    const job of finalJobs
  ) {
    for (
      const source of (
        job.sources ||
        [job.source]
      )
    ) {
      if (!source) {
        continue;
      }

      bySource[source] =
        (
          bySource[source] ||
          0
        ) +
        1;
    }
  }

  // ==========================================================
  // RESUMO
  // ==========================================================

  console.log('');
  console.log(
    '=========================================='
  );
  console.log(
    '[merge] RESUMO FINAL'
  );
  console.log(
    '=========================================='
  );

  console.log(
    `[merge] arquivos configurados: ${FILES.length}`
  );

  console.log(
    `[merge] vagas recebidas: ${allJobs.length}`
  );

  console.log(
    `[merge] duplicadas encontradas: ${duplicates}`
  );

  console.log(
    `[merge] TOTAL FINAL ÚNICO: ${finalJobs.length}`
  );

  console.log('');
  console.log(
    '[merge] POR FONTE:'
  );

  for (
    const filename of FILES
  ) {
    const source =
      getSourceFromFile(
        filename
      );

    const received =
      stats[filename]
        ?.received ||
      0;

    console.log(
      `[merge] ${source}: ${received}`
    );
  }

  console.log('');
  console.log(
    `[merge] arquivo: ${OUTPUT}`
  );

  console.log(
    '=========================================='
  );
  console.log('');
}

main();