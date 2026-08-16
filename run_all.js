const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// ============================================================
// COLETORES
// ============================================================

const COLLECTORS = [
  {
    name: 'Gupy',
    script: 'gupy.js',
    output: 'gupy_results.json'
  },
  {
    name: 'InHire',
    script: 'inhire.js',
    output: 'inhire_results.json'
  },
  {
    name: 'Nerdin',
    script: 'nerdin.js',
    output: 'nerdin_results.json'
  },
  {
    name: 'Trampos.co',
    script: 'trampos.js',
    output: 'trampos_results.json'
  },
  {
    name: 'Mentora Dados',
    script: 'mentoradados.js',
    output: 'mentoradados_results.json'
  },
  {
    name: 'Radar Vagas',
    script: 'radarvagas.js',
    output: 'radarvagas_results.json'
  },
  {
    name: 'Glassdoor',
    script: 'glassdoor.js',
    output: 'glassdoor_results.json'
  },
  {
    name: 'Vagas.com',
    script: 'vagas.js',
    output: 'vagas_results.json'
  },
  {
    name: 'Sólides',
    script: 'solides.js',
    output: 'solides_results.json'
  }
];

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const MERGE_SCRIPT = 'merge.js';
const MERGED_OUTPUT = 'vagas_merged.json';

// ============================================================
// UTILITÁRIOS
// ============================================================

function separator() {
  console.log('');
  console.log(
    '=========================================='
  );
}

function formatDuration(milliseconds) {
  const seconds =
    Math.round(
      milliseconds / 1000
    );

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  const remainingSeconds =
    seconds % 60;

  return (
    `${minutes}m ${remainingSeconds}s`
  );
}

function countJsonRows(filename) {
  const filepath =
    path.join(
      DIR,
      filename
    );

  if (
    !fs.existsSync(filepath)
  ) {
    return null;
  }

  try {
    const content =
      fs.readFileSync(
        filepath,
        'utf8'
      );

    const parsed =
      JSON.parse(content);

    if (
      Array.isArray(parsed)
    ) {
      return parsed.length;
    }

    return null;

  } catch {
    return null;
  }
}

// ============================================================
// EXECUTAR SCRIPT
// ============================================================

function runScript(script) {
  return new Promise(
    resolve => {
      const filepath =
        path.join(
          DIR,
          script
        );

      if (
        !fs.existsSync(filepath)
      ) {
        resolve({
          success: false,
          code: null,
          error:
            `Arquivo não encontrado: ${script}`
        });

        return;
      }

      const startedAt =
        Date.now();

      /*
        process.execPath usa exatamente
        o Node que está executando run_all.js.

        Isso evita problemas com PATH,
        PowerShell, npm.ps1 etc.
      */

      const child =
        spawn(
          process.execPath,
          [filepath],
          {
            cwd: DIR,
            stdio: 'inherit',
            windowsHide: false
          }
        );

      child.on(
        'error',
        error => {
          resolve({
            success: false,
            code: null,
            error:
              error.message,
            duration:
              Date.now() -
              startedAt
          });
        }
      );

      child.on(
        'close',
        code => {
          resolve({
            success:
              code === 0,

            code,

            duration:
              Date.now() -
              startedAt
          });
        }
      );
    }
  );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const pipelineStartedAt =
    Date.now();

  const status = [];

  separator();

  console.log(
    'PIPELINE GERAL DE VAGAS'
  );

  separator();

  console.log(
    `[pipeline] coletores: ${COLLECTORS.length}`
  );

  console.log(
    `[pipeline] início: ${new Date().toLocaleString('pt-BR')}`
  );

  console.log('');

  // ==========================================================
  // RODAR COLETORES
  // ==========================================================

  for (
    let i = 0;
    i < COLLECTORS.length;
    i++
  ) {
    const collector =
      COLLECTORS[i];

    separator();

    console.log(
      `[pipeline] ${i + 1}/${COLLECTORS.length} - ${collector.name}`
    );

    console.log(
      `[pipeline] executando: ${collector.script}`
    );

    separator();

    const beforeCount =
      countJsonRows(
        collector.output
      );

    const result =
      await runScript(
        collector.script
      );

    const afterCount =
      countJsonRows(
        collector.output
      );

    if (
      result.success
    ) {
      console.log('');
      console.log(
        `[pipeline] ✅ ${collector.name} concluído`
      );

      console.log(
        `[pipeline] tempo: ${formatDuration(result.duration)}`
      );

      if (
        afterCount !== null
      ) {
        console.log(
          `[pipeline] resultado: ${afterCount} vagas`
        );
      }

      status.push({
        name:
          collector.name,

        script:
          collector.script,

        success:
          true,

        count:
          afterCount,

        duration:
          result.duration
      });

      continue;
    }

    // ========================================================
    // FALHA
    // ========================================================

    console.log('');
    console.log(
      `[pipeline] ❌ ${collector.name} falhou`
    );

    if (
      result.code !== null
    ) {
      console.log(
        `[pipeline] exit code: ${result.code}`
      );
    }

    if (
      result.error
    ) {
      console.log(
        `[pipeline] erro: ${result.error}`
      );
    }

    /*
      IMPORTANTE:

      Se já havia um JSON antigo dessa fonte,
      não o apagamos automaticamente.

      Mas também registramos que a execução
      atual falhou, para não fingirmos que
      aquela fonte foi atualizada.
    */

    if (
      beforeCount !== null
    ) {
      console.log(
        `[pipeline] ⚠ existe resultado anterior com ${beforeCount} vagas`
      );
    }

    status.push({
      name:
        collector.name,

      script:
        collector.script,

      success:
        false,

      count:
        beforeCount,

      duration:
        result.duration || 0,

      error:
        result.error || ''
    });

    console.log(
      '[pipeline] continuando para a próxima fonte...'
    );
  }

  // ==========================================================
  // MERGE
  // ==========================================================

  separator();

  console.log(
    '[pipeline] COLETORES FINALIZADOS'
  );

  console.log(
    '[pipeline] iniciando merge...'
  );

  separator();

  const mergeResult =
    await runScript(
      MERGE_SCRIPT
    );

  const mergedCount =
    countJsonRows(
      MERGED_OUTPUT
    );

  // ==========================================================
  // RESUMO FINAL
  // ==========================================================

  separator();

  console.log(
    'PIPELINE - RESUMO FINAL'
  );

  separator();

  for (
    const item of status
  ) {
    const icon =
      item.success
        ? '✅'
        : '❌';

    const countText =
      item.count !== null &&
      item.count !== undefined
        ? `${item.count} vagas`
        : 'sem contagem';

    console.log(
      `${icon} ${item.name.padEnd(15)} ${countText.padEnd(14)} ${formatDuration(item.duration)}`
    );
  }

  console.log('');

  if (
    mergeResult.success
  ) {
    console.log(
      '✅ Merge concluído'
    );

    if (
      mergedCount !== null
    ) {
      console.log(
        `✅ TOTAL DE VAGAS ÚNICAS: ${mergedCount}`
      );
    }

    console.log(
      `✅ Arquivo final: ${MERGED_OUTPUT}`
    );
  } else {
    console.log(
      '❌ Merge falhou'
    );

    if (
      mergeResult.error
    ) {
      console.log(
        `[pipeline] ${mergeResult.error}`
      );
    }
  }

  const successCount =
    status.filter(
      item =>
        item.success
    ).length;

  const failedCount =
    status.length -
    successCount;

  console.log('');

  console.log(
    `[pipeline] fontes OK: ${successCount}`
  );

  console.log(
    `[pipeline] fontes com erro: ${failedCount}`
  );

  console.log(
    `[pipeline] tempo total: ${formatDuration(
      Date.now() -
      pipelineStartedAt
    )}`
  );

  console.log(
    `[pipeline] término: ${new Date().toLocaleString('pt-BR')}`
  );

  separator();

  /*
    Só retorna erro para o terminal
    se o próprio merge falhar.

    Uma fonte individual pode falhar
    e ainda assim teremos os demais
    resultados disponíveis.
  */

  if (
    !mergeResult.success
  ) {
    process.exitCode = 1;
  }
}

main().catch(
  error => {
    console.error('');
    console.error(
      '[pipeline] ERRO FATAL:'
    );

    console.error(
      error
    );

    process.exitCode = 1;
  }
);