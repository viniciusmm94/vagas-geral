const fs = require('fs');
const path = require('path');

const {
  DIR
} = require('./lib.js');

// ============================================================
// LEITURA DOS RESULTADOS
// ============================================================

const gupy = JSON.parse(
  fs.readFileSync(
    path.join(
      DIR,
      'gupy_results.json'
    ),
    'utf8'
  )
);

const inhire = JSON.parse(
  fs.readFileSync(
    path.join(
      DIR,
      'inhire_results.json'
    ),
    'utf8'
  )
);

const nerdin = JSON.parse(
  fs.readFileSync(
    path.join(
      DIR,
      'nerdin_results.json'
    ),
    'utf8'
  )
);

const trampos = JSON.parse(
  fs.readFileSync(
    path.join(
      DIR,
      'trampos_results.json'
    ),
    'utf8'
  )
);

const mentoradados = JSON.parse(
  fs.readFileSync(
    path.join(
      DIR,
      'mentoradados_results.json'
    ),
    'utf8'
  )
);

// ============================================================
// NORMALIZAÇÃO
// ============================================================
function norm(value) {
  return String(
    value || ''
  )
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .trim();
}

// ============================================================
// ALERTAS
// ============================================================

function alerta(row) {
  const title =
    norm(
      row.jobTitle
    );

  const notes = [];

  /*
    Se o título mencionar presencial/híbrido,
    deixamos alerta para conferência.

    Híbrido pode ser válido porque aceitamos
    São Paulo capital.
  */
  if (
    /hibrid|presencial|on-?site/.test(
      title
    )
  ) {
    notes.push(
      'título menciona híbrido/presencial — conferir'
    );
  }

  const location =
    norm(
      row.location
    );

  /*
    Home Office e vazio são tratados
    normalmente.
  */
  const brOk =
    location === '' ||
    location === 'home office' ||
    location === 'remoto' ||
    /\bbr\b|brasil|brazil/.test(
      location
    ) ||
    /\bsp\b|sao paulo/.test(
      location
    );

  const foreign =
    /\b(us|usa|eua|singapore|sg|portugal|pt|mexico|argentina|spain|espanha|uk|remote latam|north america)\b/.test(
      location
    );

  if (
    !brOk &&
    foreign
  ) {
    notes.push(
      'local fora do BR — pode exigir inglês'
    );
  }

  return notes.join(
    '; '
  );
}

// ============================================================
// NORMALIZAÇÃO DAS 5 FONTES
// ============================================================

const all =
  [
    ...gupy,
    ...inhire,
    ...nerdin,
    ...trampos,
    ...mentoradados
  ]
    .map(row => {
      /*
        Nerdin pode possuir:

        url
        -> página da vaga no Nerdin

        externalApplyUrl
        -> site direto da empresa / ATS

        Quando houver link direto,
        usamos ele como link principal.
      */

      const sourceUrl =
        row.url || '';

      const externalUrl =
        row.externalApplyUrl ||
        '';

      const primaryUrl =
        externalUrl ||
        sourceUrl;

      return {
        empresa:
          row.companyList ||
          row.companyGupy ||
          row.companyInhire ||
          '',

        plataforma:
          row.platform ||
          '',

        na_lista:
          row.na_lista ||
          'Sim',

        cargo_categoria:
          row.role ||
          '',

        titulo_vaga:
          String(
            row.jobTitle ||
            ''
          ).trim(),

        tipo:
          row.workplaceType ||
          '',

        local:
          row.location ||
          '',

        /*
          Link preferencial:
          candidatura direta quando existir.
        */
        link:
          primaryUrl,

        /*
          Página original da fonte.
          No Nerdin será a página do Nerdin.
        */
        link_fonte:
          sourceUrl,

        /*
          Fica preenchido apenas quando
          existe candidatura externa.
        */
        link_candidatura:
          externalUrl,

        nome_na_plataforma:
          row.companyGupy ||
          row.companyInhire ||
          row.companyNerdin ||
          '',

        publicado:
          row.publishedDate ||
          '',

        alerta:
          alerta(row)
      };
    });

// ============================================================
// DEDUPLICAÇÃO
// ============================================================

const seenLinks =
  new Set();

const seenJobs =
  new Set();

const deduped =
  [];

let duplicateByLink = 0;
let duplicateByJob = 0;

for (
  const row of all
) {
  /*
    Se Nerdin apontar diretamente para uma vaga
    da Gupy, o link externo poderá coincidir com
    o link que já veio da própria Gupy.

    Isso permite remover a duplicidade.
  */

  const normalizedLink =
    norm(
      row.link
    );

  const normalizedSourceLink =
    norm(
      row.link_fonte
    );

  /*
    Empresa + título permite detectar a mesma
    vaga mesmo quando os links são diferentes.

    NÃO usamos plataforma aqui de propósito,
    pois queremos deduplicar também entre
    Gupy / InHire / Nerdin.
  */

  const jobKey =
    norm(
      row.empresa
    ) +
    '|' +
    norm(
      row.titulo_vaga
    );

  let isDuplicate =
    false;

  // ----------------------------------------------------------
  // DEDUPE POR LINK PRINCIPAL
  // ----------------------------------------------------------

  if (
    normalizedLink &&
    seenLinks.has(
      normalizedLink
    )
  ) {
    duplicateByLink++;

    isDuplicate =
      true;
  }

  // ----------------------------------------------------------
  // DEDUPE POR EMPRESA + TÍTULO
  // ----------------------------------------------------------

  if (
    !isDuplicate &&
    jobKey !== '|' &&
    seenJobs.has(
      jobKey
    )
  ) {
    duplicateByJob++;

    isDuplicate =
      true;
  }

  if (
    isDuplicate
  ) {
    continue;
  }

  // ----------------------------------------------------------
  // REGISTRA
  // ----------------------------------------------------------

  if (
    normalizedLink
  ) {
    seenLinks.add(
      normalizedLink
    );
  }

  /*
    Também registramos a URL da página-fonte.
  */
  if (
    normalizedSourceLink
  ) {
    seenLinks.add(
      normalizedSourceLink
    );
  }

  if (
    jobKey !== '|'
  ) {
    seenJobs.add(
      jobKey
    );
  }

  deduped.push(
    row
  );
}

// ============================================================
// ORDENAÇÃO
// ============================================================

deduped.sort(
  (a, b) => {
    /*
      1. Empresas da lista primeiro
    */

    const listOrder =
      (
        a.na_lista ===
        b.na_lista
      )
        ? 0
        : (
            a.na_lista ===
            'Sim'
          )
            ? -1
            : 1;

    if (
      listOrder !== 0
    ) {
      return listOrder;
    }

    /*
      2. Mais recentes primeiro
    */

    const dateA =
      a.publicado ||
      '';

    const dateB =
      b.publicado ||
      '';

    if (
      dateA !== dateB
    ) {
      return dateB.localeCompare(
        dateA
      );
    }

    /*
      3. Plataforma
    */

    const platformOrder =
      String(
        a.plataforma
      ).localeCompare(
        String(
          b.plataforma
        )
      );

    if (
      platformOrder !== 0
    ) {
      return platformOrder;
    }

    /*
      4. Empresa
    */

    const companyOrder =
      String(
        a.empresa
      ).localeCompare(
        String(
          b.empresa
        )
      );

    if (
      companyOrder !== 0
    ) {
      return companyOrder;
    }

    /*
      5. Cargo
    */

    return String(
      a.titulo_vaga
    ).localeCompare(
      String(
        b.titulo_vaga
      )
    );
  }
);

// ============================================================
// SALVA RESULTADO FINAL
// ============================================================

fs.writeFileSync(
  path.join(
    DIR,
    'vagas_final.json'
  ),
  JSON.stringify(
    deduped,
    null,
    2
  )
);

// ============================================================
// LOGS
// ============================================================

const finalGupy =
  deduped.filter(
    row =>
      row.plataforma ===
      'Gupy'
  ).length;

const finalInHire =
  deduped.filter(
    row =>
      row.plataforma ===
      'InHire'
  ).length;

const finalNerdin =
  deduped.filter(
    row =>
      row.plataforma ===
      'Nerdin'
  ).length;

const finalTrampos =
  deduped.filter(
    row =>
      row.plataforma ===
      'Trampos'
  ).length;

const finalMentoraDados =
  deduped.filter(
    row =>
      row.plataforma ===
      'Mentora Dados'
  ).length;

const withAlert =
  deduped.filter(
    row =>
      row.alerta
  ).length;

const withExternalApply =
  deduped.filter(
    row =>
      row.link_candidatura
  ).length;

console.log(
  ''
);

console.log(
  '=========================================='
);

console.log(
  '[merge] RESUMO FINAL'
);

console.log(
  `[merge] Gupy recebidas: ${gupy.length}`
);

console.log(
  `[merge] InHire recebidas: ${inhire.length}`
);

console.log(
  `[merge] Nerdin recebidas: ${nerdin.length}`
);

console.log(
  `[merge] Trampos recebidas: ${trampos.length}`
);

console.log(
  `[merge] Mentora Dados recebidas: ${mentoradados.length}`
);

console.log(
  `[merge] Total antes do dedupe: ${all.length}`
);

console.log(
  `[merge] duplicadas por link: ${duplicateByLink}`
);

console.log(
  `[merge] duplicadas por empresa+título: ${duplicateByJob}`
);

console.log(
  `[merge] TOTAL FINAL: ${deduped.length}`
);

console.log(
  ''
);

console.log(
  `[merge] Gupy finais: ${finalGupy}`
);

console.log(
  `[merge] InHire finais: ${finalInHire}`
);

console.log(
  `[merge] Nerdin finais: ${finalNerdin}`
);

console.log(
  `[merge] Trampos finais: ${finalTrampos}`
);

console.log(
  `[merge] Mentora Dados finais: ${finalMentoraDados}`
);

console.log(
  `[merge] vagas com link direto de candidatura: ${withExternalApply}`
);

console.log(
  `[merge] vagas com alerta: ${withAlert}`
);

console.log(
  ''
);

console.log(
  '[merge] wrote -> vagas_final.json'
);