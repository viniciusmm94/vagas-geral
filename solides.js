const fs = require('fs');

const API =
  'https://apigw.solides.com.br/jobs/v3/portal-vacancies-new';

const MAX_AGE_DAYS = 20;
const TAKE = 10;

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

function ageDays(dateString) {
  if (!dateString) {
    return null;
  }

  const date =
    new Date(
      `${dateString}T00:00:00`
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return Math.floor(
    (
      Date.now() -
      date.getTime()
    ) /
    86400000
  );
}

function getCity(job) {
  if (
    job.city &&
    typeof job.city === 'object'
  ) {
    return String(
      job.city.name ||
      ''
    ).trim();
  }

  return String(
    job.city ||
    ''
  ).trim();
}

function getState(job) {
  if (
    job.state &&
    typeof job.state === 'object'
  ) {
    return String(
      job.state.code ||
      job.state.name ||
      ''
    ).trim();
  }

  return String(
    job.state ||
    ''
  ).trim();
}

function isSaoPauloCapital(job) {
  const city =
    normalize(
      getCity(job)
    );

  const state =
    normalize(
      getState(job)
    );

  return (
    city === 'sao paulo' &&
    (
      state === 'sp' ||
      state === 'sao paulo'
    )
  );
}

// ============================================================
// API
// ============================================================

async function getPage(page) {
  const params =
    new URLSearchParams({
      jobsType:
        'remoto,hibrido',

      salary:
        '4000',

      page:
        String(page),

      title:
        'analista',

      take:
        String(TAKE),

      minSalary:
        '4000'
    });

  const url =
    `${API}?${params.toString()}`;

  const response =
    await fetch(
      url,
      {
        headers: {
          Accept:
            'application/json',

          Origin:
            'https://vagas.solides.com.br',

          Referer:
            'https://vagas.solides.com.br/',

          'User-Agent':
            'Mozilla/5.0'
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Sólides HTTP ${response.status}`
    );
  }

  return response.json();
}

// ============================================================
// MAIN
// ============================================================

(async () => {
  console.log('');
  console.log(
    '=========================================='
  );
  console.log(
    'SÓLIDES'
  );
  console.log(
    '=========================================='
  );
  console.log('');

  let page = 1;
  let totalPages = 1;

  let received = 0;

  let old = 0;
  let invalidDate = 0;

  let remote = 0;
  let hybridSP = 0;

  let hybridOutsideSP = 0;
  let workplaceRejected = 0;

  let duplicateCount = 0;

  const results = [];

  const seen =
    new Set();

  try {
    // ========================================================
    // PAGINAÇÃO
    // ========================================================

    do {
      console.log(
        `[solides] página ${page}`
      );

      const response =
        await getPage(
          page
        );

      if (
        !response ||
        response.success !== true
      ) {
        throw new Error(
          `API retornou success=false: ${JSON.stringify(response?.errors || '')}`
        );
      }

      const container =
        response.data ||
        {};

      totalPages =
        Number(
          container.totalPages
        ) ||
        1;

      const jobs =
        Array.isArray(
          container.data
        )
          ? container.data
          : [];

      console.log(
        `[solides] recebidas: ${jobs.length} | página ${page}/${totalPages}`
      );

      // ======================================================
      // PROCESSAR VAGAS
      // ======================================================

      for (
        const job of jobs
      ) {
        received++;

        // ----------------------------------------------------
        // DATA
        // ----------------------------------------------------

        const age =
          ageDays(
            job.createdAt
          );

        if (
          age === null
        ) {
          invalidDate++;
          continue;
        }

        if (
          age < 0 ||
          age > MAX_AGE_DAYS
        ) {
          old++;
          continue;
        }

        // ----------------------------------------------------
        // MODALIDADE
        // ----------------------------------------------------

        const type =
          normalize(
            job.jobType
          );

        if (
          type !== 'remoto' &&
          type !== 'hibrido'
        ) {
          workplaceRejected++;
          continue;
        }

        // ----------------------------------------------------
        // HÍBRIDO = SOMENTE SÃO PAULO CAPITAL
        // ----------------------------------------------------

        if (
          type === 'hibrido'
        ) {
          if (
            !isSaoPauloCapital(
              job
            )
          ) {
            hybridOutsideSP++;
            continue;
          }
        }

        // ----------------------------------------------------
        // DEDUPLICAÇÃO
        // ----------------------------------------------------

        const key =
          String(
            job.id ||
            job.redirectLink ||
            ''
          );

        if (!key) {
          continue;
        }

        if (
          seen.has(
            key
          )
        ) {
          duplicateCount++;
          continue;
        }

        seen.add(
          key
        );

        // ----------------------------------------------------
        // LOCALIDADE
        // ----------------------------------------------------

        const city =
          getCity(
            job
          );

        const state =
          getState(
            job
          );

        let location =
          [
            city,
            state
          ]
            .filter(Boolean)
            .join(', ');

        if (
          !location &&
          type === 'remoto'
        ) {
          location =
            'Remoto';
        }

        if (
          !location &&
          type === 'hibrido'
        ) {
          location =
            'São Paulo, SP';
        }

        // ----------------------------------------------------
        // CONTADORES
        // ----------------------------------------------------

        if (
          type === 'remoto'
        ) {
          remote++;
        }

        if (
          type === 'hibrido'
        ) {
          hybridSP++;
        }

        // ----------------------------------------------------
        // RESULTADO
        // ----------------------------------------------------

        results.push({
          source:
            'solides',

          id:
            job.id,

          jobTitle:
            job.title ||
            '',

          company:
            job.companyName ||
            '',

          workplaceType:
            type === 'remoto'
              ? 'Remoto'
              : 'Híbrido',

          location,

          createdAt:
            job.createdAt ||
            '',

          ageDays:
            age,

          url:
            job.redirectLink ||
            '',

          description:
            job.description ||
            ''
        });
      }

      page++;

    } while (
      page <= totalPages
    );

    // ========================================================
    // ORDENAÇÃO
    // ========================================================

    results.sort(
      (
        a,
        b
      ) => {
        if (
          a.ageDays !==
          b.ageDays
        ) {
          return (
            a.ageDays -
            b.ageDays
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

    // ========================================================
    // SALVAR
    // ========================================================

    fs.writeFileSync(
      'solides_results.json',
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
      '[solides] RESUMO FINAL'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `[solides] páginas processadas: ${totalPages}`
    );

    console.log(
      `[solides] vagas recebidas: ${received}`
    );

    console.log(
      `[solides] limite de idade: ${MAX_AGE_DAYS} dias`
    );

    console.log(
      `[solides] vagas antigas descartadas: ${old}`
    );

    console.log(
      `[solides] datas inválidas descartadas: ${invalidDate}`
    );

    console.log(
      `[solides] modalidade inválida descartada: ${workplaceRejected}`
    );

    console.log(
      `[solides] híbridas fora de São Paulo descartadas: ${hybridOutsideSP}`
    );

    console.log(
      `[solides] Remotas aceitas: ${remote}`
    );

    console.log(
      `[solides] Híbridas São Paulo aceitas: ${hybridSP}`
    );

    console.log(
      `[solides] duplicadas descartadas: ${duplicateCount}`
    );

    console.log(
      `[solides] TOTAL FINAL: ${results.length}`
    );

    console.log(
      `[solides] wrote ${results.length} rows -> solides_results.json`
    );

    console.log(
      '=========================================='
    );
    console.log('');

  } catch (
    error
  ) {
    console.error('');
    console.error(
      '[solides] ERRO:'
    );

    console.error(
      error.message
    );

    process.exitCode = 1;
  }
})();