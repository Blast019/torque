// QA Fase 4.3 - 6o incremento (frontend "Sair da empresa"): valida a
// autorremocao via a RPC ja existente remover_usuario_empresa (nenhuma
// alteracao de banco neste incremento), com escrita controlada e
// restauracao obrigatoria do baseline.
//
// Contexto: o botao "Sair" (abrirConfirmacaoSairEmpresa() /
// remover_usuario_empresa em script.js) chama exclusivamente a RPC ja
// publicada na Fase 4.2, com o vinculo_id do PROPRIO usuario logado -
// autorremocao, sem checar hierarquia. O teste visual desse fluxo ainda
// esta pendente (nao aprovado ate a criacao deste script) - ver
// qa/fase-4/STATUS.md.
//
// NAO testa TRQ49 (protecao do ultimo proprietario ativo em autorremocao)
// nesta rodada - essa protecao ja foi aprovada no teste PROT-01 da Fase
// 4.2 (ver qa/fase-4/STATUS.md), a RPC remover_usuario_empresa nao mudou
// desde entao, e testa-la de novo aqui exigiria que PROP_A (unico
// proprietario ativo da Empresa A) chamasse a RPC sobre o proprio
// vinculo - se houvesse uma regressao nao detectada, essa chamada
// poderia desativar o unico proprietario ativo, sem existir hoje nenhum
// caminho seguro de restauracao automatica (nao ha fluxo de transferencia
// de propriedade, nem forma de reativar um vinculo proprietario, ja que
// incluir_usuario_empresa/TRQ28 e alterar_papel_usuario_empresa/TRQ40
// bloqueiam incondicionalmente atribuir esse papel). O risco de testar
// supera o beneficio de reconfirmar uma protecao ja validada e inalterada.
//
// Fluxo:
//   BASELINE-01   - confirma os 4 vinculos da Empresa A no estado
//                   esperado (PROP_A proprietario/ativo, ADMIN_A
//                   admin/ativo, USUARIO_A usuario/ativo, LIVRE
//                   gerente/inativo). Aborta sem nenhuma mutacao se nao
//                   corresponder. Este e o baseline inicial - o script
//                   NUNCA reinclui o LIVRE depois: a propria autorremocao
//                   (RESTORE-01) ja restaura este mesmo estado.
//   REATIVAR-01   - PROP_A reativa o LIVRE como gerente (preparacao -
//                   via incluir_usuario_empresa, ja usada em rodadas
//                   anteriores - unico vinculo mutado por este script).
//   SAIR-LIVRE-01 - o proprio LIVRE chama remover_usuario_empresa sobre
//                   o proprio vinculo (autorremocao) -> HTTP 200,
//                   ativo=false confirmado na PROPRIA resposta da RPC.
//   CONF-01       - reconsulta independente (SELECT direto): mesmo
//                   vinculo_id e criado_em do baseline, papel=gerente,
//                   ativo=false.
//   FINAL-01      - reconsulta final dos 4 vinculos da Empresa A,
//                   comparacao byte a byte (id/usuario_id/papel/ativo/
//                   criado_em) contra o baseline capturado em
//                   BASELINE-01 (nao contra um estado intermediario).
//
// Restauracao de seguranca (mesmo contrato de permissoes-08/12/14):
// qualquer falha critica a partir de REATIVAR-01 aciona restaurarLivre(),
// que LE o estado real atual do LIVRE (nunca presume) e decide a acao:
//   1. inativo/gerente -> ja e o estado seguro (o proprio RESTORE
//      planejado); nenhuma mutacao adicional.
//   2. ativo/gerente   -> autorremove diretamente (este script nunca
//      envia nenhum outro papel para o LIVRE - nao chama
//      alterar_papel_usuario_empresa em nenhum momento).
//   3. qualquer outro estado (papel diferente de gerente, mais de uma
//      linha, ou nenhuma linha apos mutacao confirmada) -> nenhuma
//      correcao automatica, reporta necessidade de intervencao manual.
// A falha original de um teste e o resultado da restauracao sao SEMPRE
// registrados como itens separados no resumo - a restauracao bem-sucedida
// nunca transforma a falha original em aprovacao, e o script sempre
// termina com codigo de saida != 0 quando isso acontece.
//
// Mesmo padrao de seguranca dos demais scripts desta fase: login real por
// papel via /auth/v1/token, sem service_role, sem DELETE manual (a RPC
// desta fase so faz soft delete), sem nenhuma credencial logada (so HTTP
// status e user_id). Usa exclusivamente variaveis de qa/.env (via
// qa-env.js) - nenhum valor hardcoded.
//
// Seguro contra execucao repetida: BASELINE-01 confirma que o LIVRE ja
// esta inativo/gerente antes de qualquer mutacao - se estiver ativo (ex.:
// execucao anterior interrompida), aborta sem tentar corrigir
// automaticamente.
//
// EXECUTADO E APROVADO em 05/09/2026 - 5/5 testes aprovados (ver
// qa/fase-4/STATUS.md, secao "6o incremento"). Rodar (a partir da raiz do
// repositorio):
//   node --env-file=qa/.env qa/fase-4/scripts/permissoes-15-qa-sair-empresa.js

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SENHA_QA,
  EMAIL_PROPRIETARIO,
  EMAIL_ADMIN,
  EMAIL_USUARIO,
  EMAIL_PROPRIETARIO_ANTIGO,
} = require('../../fase-2.5/scripts/qa-env');

if (!process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO) {
  console.error('Variável de ambiente obrigatória ausente: QA_PASSWORD_PROPRIETARIO_ANTIGO');
  console.error('Configure qa/.env (ver qa/.env.example) e rode novamente.');
  process.exit(1);
}
const SENHA_PROPRIETARIO_ANTIGO = process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO;

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

let resultados = []; // { id, status: 'APROVADO' | 'REPROVADO', detalhe }

function registrar(id, ok, detalhe) {
  console.log(`${ok ? '✅' : '🚨'} ${id}${detalhe ? ' - ' + detalhe : ''}`);
  resultados.push({ id, status: ok ? 'APROVADO' : 'REPROVADO', detalhe });
}

function redigirSegredos(texto) {
  if (!texto) return texto;
  return texto
    .replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDIGIDO:jwt]')
    .replace(/"(access_token|refresh_token)"\s*:\s*"[^"]*"/g, '"$1":"[REDIGIDO]"');
}

async function login(nomeLogico, email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const raw = await resp.text();
  let data = null;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Falha no login de ${nomeLogico}: corpo da resposta não é JSON válido (HTTP ${resp.status}).`);
    }
  }
  if (!resp.ok || !data) {
    console.error(`[login:${nomeLogico}] falha no login. Corpo (redigido): ${data ? redigirSegredos(JSON.stringify(data)) : '(corpo vazio)'}`);
    throw new Error(`Falha no login de ${nomeLogico} (HTTP ${resp.status}).`);
  }
  console.log(`[login:${nomeLogico}] HTTP ${resp.status} OK, user_id=${data.user?.id}`);
  return { ...data, _httpStatus: resp.status };
}

async function selectVinculos(accessToken, empresaId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios_empresas?empresa_id=eq.${empresaId}&select=*`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } }
  );
  const data = await resp.json();
  return { status: resp.status, data };
}

async function chamarRpc(accessTokenOuNull, funcao, params) {
  const headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (accessTokenOuNull) headers.Authorization = `Bearer ${accessTokenOuNull}`;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const raw = await resp.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch (e) { data = raw; }
  }
  return { status: resp.status, data };
}

function removerUsuario(token, vinculoId) {
  return chamarRpc(token, 'remover_usuario_empresa', { p_vinculo_id: vinculoId });
}
function incluirUsuario(token, empresaId, email, papel) {
  return chamarRpc(token, 'incluir_usuario_empresa', { p_empresa_id: empresaId, p_email: email, p_papel: papel });
}

function encontrarLinha(lista, usuarioId) {
  return Array.isArray(lista) ? lista.find((r) => r.usuario_id === usuarioId) : undefined;
}
function normalizarLinha(r) {
  return { id: r.id, empresa_id: r.empresa_id, usuario_id: r.usuario_id, papel: r.papel, ativo: r.ativo, criado_em: r.criado_em };
}
function ordenarPorId(lista) {
  return [...lista].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function imprimirResumoFinal(estadoFinalEmpresaA) {
  const aprovados = resultados.filter((r) => r.status === 'APROVADO');
  const reprovados = resultados.filter((r) => r.status === 'REPROVADO');

  console.log('\n===== RESUMO FINAL - SAIR DA EMPRESA (6º incremento) =====');
  console.log(`Aprovados (${aprovados.length}): ${aprovados.map((r) => r.id).join(', ') || '(nenhum)'}`);
  console.log(`Reprovados (${reprovados.length}): ${reprovados.map((r) => r.id).join(', ') || '(nenhum)'}`);

  if (estadoFinalEmpresaA) {
    console.log('\nEstado final da Empresa A:');
    console.log(JSON.stringify(estadoFinalEmpresaA, null, 2));
  } else {
    console.log('\nEstado final da Empresa A: não coletado (execução interrompida).');
  }

  if (reprovados.length > 0) {
    console.log('\n🚨 RESULTADO: HÁ TESTE(S) REPROVADO(S).');
  } else {
    console.log('\n✅ RESULTADO: todos os testes executados foram aprovados.');
  }
}

function abortarPreVoo(id, motivo) {
  registrar(id, false, motivo);
  console.error(`\n🛑 ABORTADO ANTES DE QUALQUER MUTAÇÃO: ${motivo}`);
  console.error('Nenhuma chamada de escrita foi realizada. Nenhum estado foi corrigido ou retomado automaticamente.');
  imprimirResumoFinal(null);
  process.exit(1);
}

async function main() {
  console.log('== Login das 4 contas necessárias ==');
  const prop = await login('PROP_A', EMAIL_PROPRIETARIO, SENHA_QA);
  const admin = await login('ADMIN_A', EMAIL_ADMIN, SENHA_QA);
  const usuario = await login('USUARIO_A', EMAIL_USUARIO, SENHA_QA);
  const livre = await login('LIVRE', EMAIL_PROPRIETARIO_ANTIGO, SENHA_PROPRIETARIO_ANTIGO);

  for (const [nomeLogin, dadosLogin] of [['PROP_A', prop], ['ADMIN_A', admin], ['USUARIO_A', usuario], ['LIVRE', livre]]) {
    if (dadosLogin._httpStatus !== 200) {
      abortarPreVoo('LOGIN', `login de ${nomeLogin} não retornou HTTP 200 (recebido ${dadosLogin._httpStatus}) - abortando antes de qualquer mutação`);
    }
  }
  console.log('== Confirmado: os 4 logins concluíram com HTTP 200 antes de qualquer chamada mutável ==');

  let mutacaoConfirmada = false;

  async function lerEstadoAtualLivre() {
    const sel = await selectVinculos(prop.access_token, EMPRESA_A);
    if (sel.status !== 200 || !Array.isArray(sel.data)) return { erro: true, bruto: sel };
    return { erro: false, linhas: sel.data.filter((r) => r.usuario_id === livre.user.id) };
  }

  async function restaurarLivre() {
    console.log('\n== RESTAURAÇÃO DE SEGURANÇA (LIVRE) ==');
    const estado = await lerEstadoAtualLivre();
    if (estado.erro) {
      registrar('RESTAURACAO', false, `não foi possível ler o estado atual do LIVRE para restaurar (HTTP ${estado.bruto.status}) - intervenção manual pode ser necessária`);
      return;
    }
    const { linhas } = estado;
    console.log('Estado atual do LIVRE na Empresa A:', JSON.stringify(linhas));

    if (linhas.length === 0) {
      if (!mutacaoConfirmada) {
        registrar('RESTAURACAO', true, 'LIVRE sem nenhuma linha e nenhuma mutação havia sido confirmada - nada a restaurar');
      } else {
        registrar('RESTAURACAO', false, 'LIVRE sem nenhuma linha, mas uma mutação já havia sido confirmada - estado inesperado (a RPC desta fase nunca faz DELETE). Intervenção manual necessária.');
      }
      return;
    }
    if (linhas.length > 1) {
      registrar('RESTAURACAO', false, `LIVRE possui ${linhas.length} linhas na Empresa A - estado inesperado, nenhuma correção automática tentada. Intervenção manual necessária. Linhas: ${JSON.stringify(linhas)}`);
      return;
    }

    const linha = linhas[0];

    if (linha.ativo === false && linha.papel === 'gerente') {
      registrar('RESTAURACAO', true, 'LIVRE já estava inativo/gerente - estado de restauração já alcançado, nenhuma mutação adicional executada');
      return;
    }
    if (linha.papel !== 'gerente') {
      registrar('RESTAURACAO', false, `LIVRE com papel inesperado (${linha.papel}) - este script nunca chama alterar_papel_usuario_empresa; nenhuma correção automática tentada. Intervenção manual necessária.`);
      return;
    }

    try {
      const rem = await removerUsuario(livre.access_token, linha.id);
      console.log('HTTP', rem.status, JSON.stringify(rem.data));
      const remLinha = Array.isArray(rem.data) ? rem.data[0] : null;
      if (rem.status !== 200 || !remLinha || remLinha.ativo !== false) {
        registrar('RESTAURACAO', false, `falha na autorremoção do LIVRE durante restauração: ${JSON.stringify(rem.data)}`);
        return;
      }
      const conf = await lerEstadoAtualLivre();
      const linhaConf = conf.linhas && conf.linhas[0];
      if (conf.erro || !linhaConf || linhaConf.ativo !== false || linhaConf.papel !== 'gerente') {
        registrar('RESTAURACAO', false, `estado pós-restauração não confirma inativo/gerente: ${JSON.stringify(linhaConf)}`);
        return;
      }
      registrar('RESTAURACAO', true, 'LIVRE restaurado a inativo/gerente');
    } catch (e) {
      registrar('RESTAURACAO', false, `erro inesperado durante a restauração: ${e.message}`);
    }
  }

  async function falhaComRestauracao(idOriginal, motivo) {
    registrar(idOriginal, false, motivo);
    console.error(`\n🛑 Falha crítica em ${idOriginal}. Iniciando restauração de segurança do LIVRE...`);
    await restaurarLivre();
    console.error('\n🛑 INTERROMPENDO com código de saída != 0 - a falha original nunca é convertida em aprovação, independentemente do resultado da restauração.');
    imprimirResumoFinal(null);
    process.exit(1);
  }

  // ===== BASELINE-01 (baseline inicial obrigatório) =====
  console.log('\n== BASELINE-01 ==');
  const pre = await selectVinculos(prop.access_token, EMPRESA_A);
  console.log('HTTP', pre.status, JSON.stringify(pre.data));
  if (pre.status !== 200 || !Array.isArray(pre.data) || pre.data.length !== 4) {
    abortarPreVoo('BASELINE-01', `esperado exatamente 4 vínculos na Empresa A, HTTP ${pre.status} - abortando antes de qualquer mutação`);
  }
  const baseProp = encontrarLinha(pre.data, prop.user.id);
  const baseAdmin = encontrarLinha(pre.data, admin.user.id);
  const baseUsuario = encontrarLinha(pre.data, usuario.user.id);
  const baseLivre = encontrarLinha(pre.data, livre.user.id);
  const baselineOk =
    baseProp?.papel === 'proprietario' && baseProp.ativo === true &&
    baseAdmin?.papel === 'admin' && baseAdmin.ativo === true &&
    baseUsuario?.papel === 'usuario' && baseUsuario.ativo === true &&
    baseLivre?.papel === 'gerente' && baseLivre.ativo === false;
  if (!baselineOk) {
    abortarPreVoo('BASELINE-01', `baseline da Empresa A não corresponde ao esperado (PROP_A=proprietario/ativo, ADMIN_A=admin/ativo, USUARIO_A=usuario/ativo, LIVRE=gerente/inativo) - possível execução anterior incompleta. Estado: ${JSON.stringify(pre.data)}`);
  }
  registrar('BASELINE-01', true, 'baseline inicial confirmado: 4 vínculos no estado esperado (LIVRE gerente/inativo)');

  // TRQ49 (proteção do último proprietário ativo em autorremoção) NÃO é
  // testado aqui - já aprovado no teste histórico PROT-01 (Fase 4.2), RPC
  // inalterada desde então. Ver nota no cabeçalho deste arquivo.

  // A partir daqui a fase mutável começa (REATIVAR-01 até FINAL-01) - todo
  // este bloco é envolvido por um try/catch cujo catch trata qualquer
  // exceção inesperada (ex.: falha de rede depois de o servidor já ter
  // processado a chamada) chamando falhaComRestauracao(), que sempre relê
  // o estado real do LIVRE antes de decidir a ação.
  try {
    // ===== REATIVAR-01 =====
    console.log('\n== REATIVAR-01 (preparação - único vínculo mutado neste script) ==');
    const react = await incluirUsuario(prop.access_token, EMPRESA_A, EMAIL_PROPRIETARIO_ANTIGO, 'gerente');
    console.log('HTTP', react.status, JSON.stringify(react.data));
    const reactLinha = Array.isArray(react.data) ? react.data[0] : null;

    const confReact = await lerEstadoAtualLivre();
    if (confReact.linhas?.[0]?.ativo === true) mutacaoConfirmada = true;

    if (react.status !== 200 || !reactLinha || reactLinha.reativado !== true || reactLinha.vinculo_id !== baseLivre.id || reactLinha.papel !== 'gerente') {
      await falhaComRestauracao('REATIVAR-01', `falha ao reativar LIVRE: ${JSON.stringify(react.data)}`);
      return;
    }
    registrar('REATIVAR-01', true, 'LIVRE reativado como gerente (mesmo vinculo_id do baseline)');

    // ===== SAIR-LIVRE-01 =====
    console.log('\n== SAIR-LIVRE-01 (o próprio LIVRE se autorremove) ==');
    const sair = await removerUsuario(livre.access_token, baseLivre.id);
    console.log('HTTP', sair.status, JSON.stringify(sair.data));
    const sairLinha = Array.isArray(sair.data) ? sair.data[0] : null;
    if (sair.status !== 200 || !sairLinha || sairLinha.vinculo_id !== baseLivre.id || sairLinha.ativo !== false) {
      await falhaComRestauracao('SAIR-LIVRE-01', `resultado inesperado (esperado ativo=false no retorno da RPC): ${JSON.stringify(sair.data)}`);
      return;
    }
    registrar('SAIR-LIVRE-01', true, 'LIVRE saiu da empresa (autorremoção) - ativo=false confirmado na própria resposta da RPC');

    // ===== CONF-01 =====
    console.log('\n== CONF-01 (reconsulta independente: mesmo vinculo_id/criado_em, papel=gerente, ativo=false) ==');
    const conf01 = await lerEstadoAtualLivre();
    const linhaConf01 = conf01.linhas?.[0];
    const conf01Ok = !conf01.erro && linhaConf01 &&
      linhaConf01.id === baseLivre.id &&
      linhaConf01.criado_em === baseLivre.criado_em &&
      linhaConf01.papel === 'gerente' &&
      linhaConf01.ativo === false;
    if (!conf01Ok) {
      await falhaComRestauracao('CONF-01', `reconsulta não confirma gerente/inativo com id/criado_em preservados: ${JSON.stringify(linhaConf01)}`);
      return;
    }
    registrar('CONF-01', true, 'LIVRE confirmado gerente/inativo, id e criado_em preservados');

    // ===== FINAL-01 (compara contra o BASELINE INICIAL - nenhuma reinclusão) =====
    console.log('\n== FINAL-01 (comparação byte a byte contra o baseline inicial de BASELINE-01) ==');
    const fin = await selectVinculos(prop.access_token, EMPRESA_A);
    console.log('HTTP', fin.status, JSON.stringify(fin.data));
    if (fin.status !== 200 || !Array.isArray(fin.data) || fin.data.length !== 4) {
      await falhaComRestauracao('FINAL-01', `esperado exatamente 4 vínculos, HTTP ${fin.status}: ${JSON.stringify(fin.data)}`);
      return;
    }
    const baselineNorm = ordenarPorId([baseProp, baseAdmin, baseUsuario, baseLivre].map(normalizarLinha));
    const finalNorm = ordenarPorId(fin.data.map(normalizarLinha));
    const finalOk = JSON.stringify(baselineNorm) === JSON.stringify(finalNorm);
    if (!finalOk) {
      await falhaComRestauracao('FINAL-01', `estado final não é byte a byte idêntico ao baseline inicial. baseline=${JSON.stringify(baselineNorm)} final=${JSON.stringify(finalNorm)}`);
      return;
    }
    registrar('FINAL-01', true, 'estado final byte a byte idêntico ao baseline inicial (id/usuario_id/papel/ativo/criado_em) - nenhuma reinclusão foi necessária');

    imprimirResumoFinal(fin.data);
    const houveReprovacao = resultados.some((r) => r.status === 'REPROVADO');
    if (houveReprovacao) process.exit(1);
  } catch (erroInesperado) {
    await falhaComRestauracao('EXCECAO-FASE-MUTAVEL', `exceção inesperada durante a fase mutável (entre REATIVAR-01 e FINAL-01): ${erroInesperado.message}`);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', redigirSegredos(err.message));
  imprimirResumoFinal(null);
  process.exit(1);
});
