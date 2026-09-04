// QA Fase 4.3 - Reativação direta (equivalente REST do botão "Reativar
// acesso"), com restauração OBRIGATÓRIA do baseline ao final.
//
// Contexto: o botão "Reativar acesso" (renderUsuariosEmpresa() em
// script.js) reutiliza o modal "Adicionar usuário" em modo reativação -
// e-mail e papel vêm travados no valor ANTERIOR do vínculo inativo clicado
// (nunca escolhidos livremente), e a chamada é feita à mesma RPC já
// publicada incluir_usuario_empresa (qa/fase-4/scripts/permissoes-11-
// bloquear-papel-proprietario-inclusao.sql, versão vigente). O teste visual
// desse fluxo (com o vínculo do LIVRE) foi aprovado manualmente em
// 03/09/2026 - ver qa/fase-4/STATUS.md. Este script cobre o mesmo caminho
// de forma automatizada, via chamada REST direta às RPCs (sem navegador),
// no mesmo padrão dos demais scripts desta fase (permissoes-06/07/08/10).
//
// Fluxo:
//   PRE-REACT-01   - confirma baseline: 4 vínculos na Empresa A (PROP_A,
//                    ADMIN_A, USUARIO_A ativos com os papéis esperados;
//                    LIVRE inativo/gerente). Aborta sem nenhuma mutação se
//                    o baseline não corresponder (ex.: execução anterior
//                    incompleta) - mesma cautela de PRE-DEL03-01
//                    (permissoes-08).
//   REACT-01       - PROP_A chama incluir_usuario_empresa para o e-mail do
//                    LIVRE com p_papel = papel ANTERIOR do vínculo (gerente
//                    - o mesmo valor que o modal envia travado, nunca um
//                    papel diferente). Confirma HTTP 200, reativado=true,
//                    papel=gerente, ativo=true, e vinculo_id retornado
//                    IDÊNTICO ao id capturado em PRE-REACT-01 (mesma
//                    verificação que script.js faz antes de considerar a
//                    reativação bem-sucedida).
//   CONF-REACT-01  - reconsulta direta à tabela: confirma id, papel, ativo
//                    e também criado_em idênticos ao baseline (prova que a
//                    RPC fez UPDATE, não INSERT de uma linha nova).
//   RESTORE-REACT-01 - LIVRE realiza autorremoção (remover_usuario_empresa),
//                    restaurando o estado inativo/gerente original. Esta
//                    etapa é OBRIGATÓRIA e também é acionada por
//                    restaurarLivre() em qualquer falha crítica a partir de
//                    REACT-01 (mesmo padrão de segurança de permissoes-08:
//                    lê o estado real do LIVRE, nunca presume, e decide a
//                    ação com base no que encontrar).
//   FINAL-REACT    - reconsulta final: exatamente 4 vínculos, os 3
//                    originais byte-a-byte idênticos ao baseline (id,
//                    usuario_id, papel, ativo, criado_em), LIVRE de volta a
//                    inativo/gerente com id e criado_em idênticos ao
//                    baseline.
//
// Restauração de segurança (mesmo contrato de permissoes-08): qualquer
// falha crítica a partir de REACT-01 aciona restaurarLivre(), que LÊ o
// estado real atual do LIVRE (nunca presume) e decide a ação:
//   1. inativo/gerente -> já é o estado seguro; nenhuma mutação adicional.
//   2. ativo/gerente   -> autorremove diretamente.
//   3. ativo/outro papel, inativo/outro papel, mais de uma linha, ou
//      nenhuma linha após mutação confirmada -> estado inesperado (este
//      script nunca envia um papel diferente de "gerente" para o LIVRE);
//      nenhuma correção automática é tentada, reporta necessidade de
//      intervenção manual.
// A falha original de um teste e o resultado da restauração são SEMPRE
// registrados como itens separados no resumo - a restauração bem-sucedida
// nunca transforma a falha original em aprovação, e o script sempre termina
// com código de saída != 0 quando isso acontece.
//
// Mesmo padrão de segurança dos demais scripts desta fase: login real por
// papel via /auth/v1/token, redigirSegredos() para nunca logar
// token/senha/chave, sem service_role, sem DELETE manual (as RPCs desta
// fase só fazem soft delete). Não altera nenhum outro script já publicado.
//
// Seguro contra execução repetida: PRE-REACT-01 confirma que o LIVRE já
// está inativo/gerente antes de qualquer mutação - se estiver ativo (ex.:
// execução anterior interrompida entre REACT-01 e RESTORE-REACT-01), aborta
// sem tentar corrigir automaticamente.
//
// AINDA NAO EXECUTADO. Rodar (a partir da raiz do repositório), sob
// autorização explícita do usuário:
//   node --env-file=qa/.env qa/fase-4/scripts/permissoes-12-qa-reativacao-direta.js

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SENHA_QA,
  EMAIL_PROPRIETARIO,
  EMAIL_ADMIN,
  EMAIL_USUARIO,
  EMAIL_PROPRIETARIO_ANTIGO,
} = require('../../fase-2.5/scripts/qa-env');

// LIVRE (EMAIL_PROPRIETARIO_ANTIGO) nao usa a senha compartilhada - mesma
// exigencia ja usada nos demais scripts desta fase.
if (!process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO) {
  console.error('Variável de ambiente obrigatória ausente: QA_PASSWORD_PROPRIETARIO_ANTIGO');
  console.error('Configure qa/.env (ver qa/.env.example) e rode novamente.');
  process.exit(1);
}
const SENHA_PROPRIETARIO_ANTIGO = process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO;

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

let resultados = []; // { id, status: 'APROVADO' | 'REPROVADO', detalhe }

function registrar(id, status, detalhe) {
  const icone = status === 'APROVADO' ? '✅' : '🚨';
  console.log(`${icone} ${id} [${status}]${detalhe ? ' - ' + detalhe : ''}`);
  resultados.push({ id, status, detalhe });
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

async function chamarRpc(accessToken, funcao, params) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const raw = await resp.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch (e) { data = raw; }
  }
  return { status: resp.status, data };
}

function incluirUsuario(token, empresaId, email, papel) {
  return chamarRpc(token, 'incluir_usuario_empresa', { p_empresa_id: empresaId, p_email: email, p_papel: papel });
}

function removerUsuario(token, vinculoId) {
  return chamarRpc(token, 'remover_usuario_empresa', { p_vinculo_id: vinculoId });
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

  console.log('\n===== RESUMO FINAL - REATIVAÇÃO DIRETA =====');
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
  registrar(id, 'REPROVADO', motivo);
  console.error(`\n🛑 ABORTADO ANTES DE QUALQUER MUTAÇÃO: ${motivo}`);
  console.error('Nenhuma chamada de escrita foi realizada. Nenhum estado foi corrigido ou retomado automaticamente.');
  imprimirResumoFinal(null);
  process.exit(1);
}

async function main() {
  console.log('== Login das contas necessárias ==');
  const prop = await login('PROP_A', EMAIL_PROPRIETARIO, SENHA_QA);
  const admin = await login('ADMIN_A', EMAIL_ADMIN, SENHA_QA);
  const usuario = await login('USUARIO_A', EMAIL_USUARIO, SENHA_QA);
  const livre = await login('LIVRE', EMAIL_PROPRIETARIO_ANTIGO, SENHA_PROPRIETARIO_ANTIGO);

  const logins = [
    ['PROP_A', prop],
    ['ADMIN_A', admin],
    ['USUARIO_A', usuario],
    ['LIVRE', livre],
  ];
  for (const [nomeLogin, dadosLogin] of logins) {
    if (dadosLogin._httpStatus !== 200) {
      abortarPreVoo('LOGIN', `login de ${nomeLogin} não retornou HTTP 200 (recebido ${dadosLogin._httpStatus}) - abortando antes de qualquer mutação`);
    }
  }
  console.log('== Confirmado: os 4 logins concluíram com HTTP 200 antes de qualquer chamada mutável ==');

  // Torna-se true assim que uma reconsulta confirmar que LIVRE está ativo
  // após REACT-01 - usado por restaurarLivre() para diferenciar "nenhuma
  // mutação ocorreu" de "estado inesperado após mutação confirmada".
  let mutacaoConfirmada = false;

  async function lerEstadoAtualLivre() {
    const sel = await selectVinculos(prop.access_token, EMPRESA_A);
    if (sel.status !== 200 || !Array.isArray(sel.data)) {
      return { erro: true, bruto: sel };
    }
    return { erro: false, linhas: sel.data.filter((r) => r.usuario_id === livre.user.id) };
  }

  async function restaurarLivre() {
    console.log('\n== RESTAURAÇÃO DE SEGURANÇA (LIVRE) ==');
    const estado = await lerEstadoAtualLivre();
    if (estado.erro) {
      registrar('RESTAURACAO-REACT', 'REPROVADO', `não foi possível ler o estado atual do LIVRE para restaurar (HTTP ${estado.bruto.status}) - intervenção manual pode ser necessária`);
      return;
    }
    const { linhas } = estado;
    console.log('Estado atual do LIVRE na Empresa A:', JSON.stringify(linhas));

    if (linhas.length === 0) {
      if (!mutacaoConfirmada) {
        registrar('RESTAURACAO-REACT', 'APROVADO', 'LIVRE sem nenhuma linha e nenhuma mutação havia sido confirmada - nada a restaurar');
      } else {
        registrar('RESTAURACAO-REACT', 'REPROVADO', 'LIVRE sem nenhuma linha, mas uma mutação já havia sido confirmada - estado inesperado (as RPCs desta fase nunca fazem DELETE). Intervenção manual necessária.');
      }
      return;
    }

    if (linhas.length > 1) {
      registrar('RESTAURACAO-REACT', 'REPROVADO', `LIVRE possui ${linhas.length} linhas na Empresa A - estado inesperado, nenhuma correção automática tentada. Intervenção manual necessária. Linhas: ${JSON.stringify(linhas)}`);
      return;
    }

    const linha = linhas[0];

    if (linha.papel !== 'gerente') {
      registrar('RESTAURACAO-REACT', 'REPROVADO', `LIVRE com papel inesperado (${linha.papel}) - este script nunca envia um papel diferente de gerente para o LIVRE; nenhuma correção automática tentada. Intervenção manual necessária. Linha: ${JSON.stringify(linha)}`);
      return;
    }

    if (linha.ativo === false) {
      registrar('RESTAURACAO-REACT', 'APROVADO', 'LIVRE já estava inativo/gerente - estado de restauração já alcançado, nenhuma mutação adicional executada');
      return;
    }

    try {
      const rem = await removerUsuario(livre.access_token, linha.id);
      console.log('HTTP', rem.status, JSON.stringify(rem.data));
      const remLinha = Array.isArray(rem.data) ? rem.data[0] : null;
      if (rem.status !== 200 || !remLinha || remLinha.ativo !== false) {
        registrar('RESTAURACAO-REACT', 'REPROVADO', `falha na autorremoção do LIVRE durante restauração: ${JSON.stringify(rem.data)}`);
        return;
      }
      const conf = await lerEstadoAtualLivre();
      const linhaConf = conf.linhas && conf.linhas[0];
      if (conf.erro || !linhaConf || linhaConf.ativo !== false || linhaConf.papel !== 'gerente') {
        registrar('RESTAURACAO-REACT', 'REPROVADO', `estado pós-restauração não confirma inativo/gerente: ${JSON.stringify(linhaConf)}`);
        return;
      }
      registrar('RESTAURACAO-REACT', 'APROVADO', 'LIVRE estava ativo/gerente - autorremovido; confirmado inativo/gerente');
    } catch (e) {
      registrar('RESTAURACAO-REACT', 'REPROVADO', `erro inesperado durante a restauração: ${e.message}`);
    }
  }

  async function falhaComRestauracao(idOriginal, motivo) {
    registrar(idOriginal, 'REPROVADO', motivo);
    console.error(`\n🛑 Falha crítica em ${idOriginal}. Iniciando restauração de segurança do LIVRE...`);
    await restaurarLivre();
    console.error('\n🛑 INTERROMPENDO com código de saída != 0 - a falha original nunca é convertida em aprovação, independentemente do resultado da restauração.');
    imprimirResumoFinal(null);
    process.exit(1);
  }

  // ===== PRE-REACT-01 =====
  console.log('\n== PRE-REACT-01 ==');
  const preSel = await selectVinculos(prop.access_token, EMPRESA_A);
  console.log('HTTP', preSel.status, JSON.stringify(preSel.data));
  if (preSel.status !== 200 || !Array.isArray(preSel.data)) {
    abortarPreVoo('PRE-REACT-01', `falha inesperada ao consultar a Empresa A (HTTP ${preSel.status})`);
  }

  if (preSel.data.length !== 4) {
    abortarPreVoo('PRE-REACT-01', `esperado exatamente 4 vínculos na Empresa A, encontrado ${preSel.data.length} - estado inesperado, nenhuma mutação será tentada`);
  }

  const linhaPropBaseline = encontrarLinha(preSel.data, prop.user.id);
  const linhaAdminBaseline = encontrarLinha(preSel.data, admin.user.id);
  const linhaUsuarioBaseline = encontrarLinha(preSel.data, usuario.user.id);
  const linhaLivreBaseline = encontrarLinha(preSel.data, livre.user.id);

  const baselineOk =
    linhaPropBaseline && linhaPropBaseline.papel === 'proprietario' && linhaPropBaseline.ativo === true &&
    linhaAdminBaseline && linhaAdminBaseline.papel === 'admin' && linhaAdminBaseline.ativo === true &&
    linhaUsuarioBaseline && linhaUsuarioBaseline.papel === 'usuario' && linhaUsuarioBaseline.ativo === true &&
    linhaLivreBaseline && linhaLivreBaseline.papel === 'gerente' && linhaLivreBaseline.ativo === false;

  if (!baselineOk) {
    abortarPreVoo('PRE-REACT-01', `baseline da Empresa A não corresponde ao esperado (PROP_A=proprietario/ativo, ADMIN_A=admin/ativo, USUARIO_A=usuario/ativo, LIVRE=gerente/inativo) - possível execução anterior incompleta. Abortando antes de qualquer mutação. Estado: ${JSON.stringify(preSel.data)}`);
  }

  registrar('PRE-REACT-01', 'APROVADO', 'baseline confirmado: 4 vínculos, LIVRE inativo/gerente, demais 3 ativos com os papéis esperados');

  // ===== REACT-01 =====
  // Mesma chamada que o botão "Reativar acesso" faz: p_papel É o papel
  // ANTERIOR do vínculo (travado no modal, nunca escolhido livremente).
  console.log('\n== REACT-01 ==');
  const react01 = await incluirUsuario(prop.access_token, EMPRESA_A, EMAIL_PROPRIETARIO_ANTIGO, linhaLivreBaseline.papel);
  console.log('HTTP', react01.status, JSON.stringify(react01.data));
  const react01Linha = Array.isArray(react01.data) ? react01.data[0] : null;

  const confReact01Rapida = await lerEstadoAtualLivre();
  const linhaConfReact01Rapida = confReact01Rapida.linhas && confReact01Rapida.linhas[0];
  if (linhaConfReact01Rapida && linhaConfReact01Rapida.ativo === true) {
    mutacaoConfirmada = true;
  }

  if (
    react01.status !== 200 ||
    !react01Linha ||
    react01Linha.reativado !== true ||
    react01Linha.papel !== 'gerente' ||
    react01Linha.ativo !== true ||
    react01Linha.vinculo_id !== linhaLivreBaseline.id
  ) {
    await falhaComRestauracao('REACT-01', `resultado da reativação não corresponde ao esperado (reativado=true, papel=gerente, ativo=true, vinculo_id=${linhaLivreBaseline.id}). Recebido: ${JSON.stringify(react01.data)}`);
    return;
  }
  registrar('REACT-01', 'APROVADO', `PROP_A reativou LIVRE (vinculo_id=${react01Linha.vinculo_id} idêntico ao baseline, papel mantido=gerente)`);

  // ===== CONF-REACT-01 =====
  console.log('\n== CONF-REACT-01 ==');
  const confReact01 = await lerEstadoAtualLivre();
  const linhaConfReact01 = confReact01.linhas && confReact01.linhas[0];
  console.log('Vínculo do LIVRE após a reativação:', JSON.stringify(linhaConfReact01));
  if (
    confReact01.erro ||
    !linhaConfReact01 ||
    linhaConfReact01.id !== linhaLivreBaseline.id ||
    linhaConfReact01.papel !== 'gerente' ||
    linhaConfReact01.ativo !== true ||
    linhaConfReact01.criado_em !== linhaLivreBaseline.criado_em
  ) {
    await falhaComRestauracao('CONF-REACT-01', `reconsulta não confirma id/papel/ativo/criado_em idênticos ao baseline (prova de UPDATE, não INSERT): ${JSON.stringify(linhaConfReact01)}`);
    return;
  }
  registrar('CONF-REACT-01', 'APROVADO', 'id, papel, ativo e criado_em idênticos ao baseline - confirma reativação por UPDATE, não recriação da linha');

  // ===== RESTORE-REACT-01 =====
  console.log('\n== RESTORE-REACT-01 ==');
  const restore01 = await removerUsuario(livre.access_token, linhaLivreBaseline.id);
  console.log('HTTP', restore01.status, JSON.stringify(restore01.data));
  const restore01Linha = Array.isArray(restore01.data) ? restore01.data[0] : null;
  if (restore01.status !== 200 || !restore01Linha || restore01Linha.ativo !== false) {
    await falhaComRestauracao('RESTORE-REACT-01', `falha na autorremoção do LIVRE (restauração obrigatória do baseline): ${JSON.stringify(restore01.data)}`);
    return;
  }
  registrar('RESTORE-REACT-01', 'APROVADO', 'LIVRE realizou autorremoção - baseline restaurado (inativo/gerente)');

  // ===== FINAL-REACT =====
  console.log('\n== FINAL-REACT ==');
  const finalSel = await selectVinculos(prop.access_token, EMPRESA_A);
  console.log('HTTP', finalSel.status, JSON.stringify(finalSel.data));
  if (finalSel.status !== 200 || !Array.isArray(finalSel.data)) {
    await falhaComRestauracao('FINAL-REACT', `falha inesperada ao consultar estado final (HTTP ${finalSel.status})`);
    return;
  }

  if (finalSel.data.length !== 4) {
    await falhaComRestauracao('FINAL-REACT', `esperado exatamente 4 vínculos na Empresa A, encontrado ${finalSel.data.length}: ${JSON.stringify(finalSel.data)}`);
    return;
  }

  const baselineNormalizado = ordenarPorId([linhaPropBaseline, linhaAdminBaseline, linhaUsuarioBaseline, linhaLivreBaseline].map(normalizarLinha));
  const finalNormalizado = ordenarPorId(finalSel.data.map(normalizarLinha));

  if (JSON.stringify(baselineNormalizado) !== JSON.stringify(finalNormalizado)) {
    await falhaComRestauracao('FINAL-REACT', `estado final não é byte-a-byte idêntico ao baseline capturado em PRE-REACT-01. baseline=${JSON.stringify(baselineNormalizado)} final=${JSON.stringify(finalNormalizado)}`);
    return;
  }

  registrar('FINAL-REACT', 'APROVADO', 'estado final byte-a-byte idêntico ao baseline (id, usuario_id, papel, ativo, criado_em) - reativação e restauração não deixaram nenhuma diferença residual');

  imprimirResumoFinal(finalSel.data);

  const houveReprovacao = resultados.some((r) => r.status === 'REPROVADO');
  if (houveReprovacao) process.exit(1);
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  imprimirResumoFinal(null);
  process.exit(1);
});
