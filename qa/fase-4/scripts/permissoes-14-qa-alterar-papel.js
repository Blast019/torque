// QA Fase 4.3 - 5o incremento (frontend "Alterar papel"): validacao da RPC
// alterar_papel_usuario_empresa apos a migracao permissoes-13 (bloqueio
// TRQ40), com escrita controlada e restauracao obrigatoria do baseline.
//
// Contexto: o botao "Alterar papel" (abrirModalAlterarPapel() /
// enviarAlteracaoPapel() em script.js) chama esta RPC diretamente, com o
// vinculo_id da linha clicada e o novo papel escolhido no <select>
// (nunca o papel atual, nunca 'proprietario'). O teste visual desse fluxo
// (PROP_A e ADMIN_A, opcoes corretas, Cancelar, duplo clique, sucesso,
// responsividade) foi aprovado manualmente em 03/09/2026 - ver
// qa/fase-4/STATUS.md. Este script cobre o mesmo caminho de forma
// automatizada, via chamada REST direta, no mesmo padrao dos demais
// scripts desta fase (permissoes-07/08/12).
//
// Fluxo:
//   BASELINE-01   - confirma os 4 vinculos da Empresa A no estado
//                   esperado (PROP_A proprietario/ativo, ADMIN_A
//                   admin/ativo, USUARIO_A usuario/ativo, LIVRE
//                   gerente/inativo). Aborta sem nenhuma mutacao se nao
//                   corresponder.
//   TRQ34-01      - PROP_A chama com p_vinculo_id VALIDO (ADMIN_A) e
//                   p_novo_papel='papel_invalido' -> TRQ34, antes de
//                   localizar o vinculo. Alvo seguro mesmo em regressao
//                   hipotetica: 'papel_invalido' violaria a CHECK
//                   constraint de `usuarios_empresas.papel` (Fase 4.1) se
//                   chegasse ao UPDATE - a RPC nunca conseguiria escrever
//                   esse valor em ADMIN_A de forma alguma.
//   TRQ37-01      - PROP_A chama com UUID inexistente -> TRQ37. Alvo
//                   seguro por definicao: nenhuma linha real corresponde
//                   a esse UUID.
//   TRQ36-01      - USUARIO_A tenta alterar o proprio vinculo (para
//                   'gerente', papel valido) -> TRQ36. Prova que a
//                   checagem de autoalteracao dispara ANTES da checagem
//                   de permissao do chamador (TRQ35) - USUARIO_A nem
//                   teria permissao para chamar esta RPC sobre outra
//                   pessoa, mas o bloqueio por ser a propria linha vem
//                   primeiro mesmo assim.
//   TRQ38-01      - PROP_A tenta alterar o vinculo do LIVRE (ainda
//                   inativo neste ponto) -> TRQ38, antes de qualquer
//                   checagem de hierarquia.
//   TRQ40-01      - PROP_A tenta promover o LIVRE (ainda INATIVO) a
//                   proprietario -> TRQ40. Alvo e o LIVRE (nao ADMIN_A)
//                   deliberadamente: mesmo que a checagem TRQ40 regredisse,
//                   o LIVRE continua inativo neste ponto - a checagem
//                   TRQ38 (vinculo inativo) atuaria como segunda barreira
//                   independente antes do UPDATE.
//   TRQ40-02      - ADMIN_A tenta promover o LIVRE (ainda INATIVO) a
//                   proprietario -> TRQ40. Mesma logica de defesa em
//                   profundidade do TRQ40-01, com uma terceira barreira
//                   independente possivel (TRQ35, hierarquia do admin,
//                   ja que 'proprietario' tambem nao esta em
//                   gerente/usuario).
//   CONF-BLOQUEIOS-01 - confirma que PROP_A, ADMIN_A, USUARIO_A e LIVRE
//                   (ainda inativo/gerente) permanecem byte a byte
//                   identicos ao baseline apos as 5 tentativas bloqueadas
//                   acima.
//   ANON-01       - chamada anonima, sem token -> bloqueada (401/42501).
//   REATIVAR-01   - PROP_A reativa o LIVRE como gerente (preparacao -
//                   a partir daqui o LIVRE e o UNICO vinculo que pode
//                   legitimamente ser alterado por uma chamada bem-
//                   sucedida neste script).
//   TRQ35-01      - com o LIVRE ja ativo/gerente, ADMIN_A tenta defini-lo
//                   como 'admin' -> TRQ35 (admin so define gerente ou
//                   usuario). Unico teste negativo cujo alvo e um vinculo
//                   ATIVO com um papel valido - por isso, qualquer falha
//                   aqui aciona IMEDIATAMENTE falhaComRestauracao(), sem
//                   esperar chegar ao final do script.
//   CONF-TRQ35-01 - confirma que o LIVRE permanece ativo/gerente (id e
//                   criado_em preservados) apos o bloqueio.
//   ALTERAR-PROP-01  - PROP_A altera LIVRE de gerente para usuario.
//   CONF-PROP-01     - reconsulta direta: id/criado_em/ativo do LIVRE
//                      preservados, papel=usuario.
//   ALTERAR-ADMIN-01 - ADMIN_A altera LIVRE de usuario para gerente
//                      (dentro do que admin pode fazer - gerente/usuario).
//   CONF-ADMIN-01    - reconsulta direta: id/criado_em/ativo do LIVRE
//                      preservados, papel=gerente (volta ao papel do
//                      baseline).
//   RESTORE-01    - LIVRE realiza autorremocao (fica inativo/gerente -
//                   baseline restaurado).
//   FINAL-01      - reconsulta final: 4 vinculos, comparacao byte a byte
//                   (id/usuario_id/papel/ativo/criado_em) contra o
//                   snapshot capturado em BASELINE-01.
//
// Garantia central desta rodada: o UNICO vinculo que pode ser alvo de uma
// chamada capaz de chegar ao UPDATE e o LIVRE - PROP_A, ADMIN_A e
// USUARIO_A so aparecem como alvo de tentativas com pelo menos uma
// barreira independente que as bloqueia antes do UPDATE (CHECK constraint
// de banco para TRQ34, UUID inexistente para TRQ37, autoalteracao TRQ36
// restrita ao proprio USUARIO_A). Todos os testes que usam um papel VALIDO
// contra um vinculo que poderia realmente ser escrito (TRQ35, TRQ40-01,
// TRQ40-02) usam o LIVRE como alvo, nunca uma conta essencial - mesmo que
// a checagem principal de cada um regredisse, o pior caso possivel e uma
// escrita no LIVRE, que e restaurado ao final de qualquer forma.
//
// Restauracao de seguranca (mesmo contrato de permissoes-08/12): qualquer
// falha critica a partir de REATIVAR-01 aciona restaurarLivre(), que LE o
// estado real atual do LIVRE (nunca presume) e decide a acao:
//   1. inativo/gerente -> ja e o estado seguro; nenhuma mutacao adicional.
//   2. ativo/gerente   -> apenas autorremove.
//   3. ativo/usuario   -> PROP_A restaura o papel para gerente
//                         (alterar_papel_usuario_empresa), confirma, e
//                         entao o LIVRE autorremove.
//   4. ativo/admin     -> mesmo tratamento do caso anterior: PROP_A
//                         restaura o papel para gerente, confirma, e
//                         entao o LIVRE autorremove. Estado previsivel se
//                         o teste TRQ35-01 falhar e alcancar o UPDATE
//                         (unico teste negativo que tenta definir o LIVRE,
//                         ja ativo, como 'admin').
//   5. qualquer outro estado (ativo com papel 'proprietario', mais de uma
//      linha, ou nenhuma linha apos mutacao confirmada) -> nenhuma
//      correcao automatica, reporta necessidade de intervencao manual.
//      admin/gerente/usuario sao os unicos papeis ativos tratados como
//      recuperaveis automaticamente.
// A falha original de um teste e o resultado da restauracao sao SEMPRE
// registrados como itens separados no resumo - a restauracao bem-sucedida
// nunca transforma a falha original em aprovacao, e o script sempre
// termina com codigo de saida != 0 quando isso acontece.
//
// Mesmo padrao de seguranca dos demais scripts desta fase: login real por
// papel via /auth/v1/token, sem service_role, sem DELETE manual (as RPCs
// desta fase so fazem soft delete), sem nenhuma credencial logada (so
// HTTP status e user_id). Usa exclusivamente variaveis de qa/.env (via
// qa-env.js) - nenhum valor hardcoded.
//
// Seguro contra execucao repetida: BASELINE-01 confirma que o LIVRE ja
// esta inativo/gerente antes de qualquer mutacao - se estiver ativo (ex.:
// execucao anterior interrompida), aborta sem tentar corrigir
// automaticamente.
//
// EXECUTADO E APROVADO em 03/09/2026 - 18/18 testes aprovados
// (BASELINE-01, TRQ34-01, TRQ37-01, TRQ36-01, TRQ38-01, TRQ40-01,
// TRQ40-02, CONF-BLOQUEIOS-01, ANON-01, REATIVAR-01, TRQ35-01,
// CONF-TRQ35-01, ALTERAR-PROP-01, CONF-PROP-01, ALTERAR-ADMIN-01,
// CONF-ADMIN-01, RESTORE-01, FINAL-01), 0 reprovados. Baseline restaurado
// e confirmado byte a byte ao final; PROP_A/ADMIN_A/USUARIO_A
// inalterados. Nenhuma restauracao de emergencia foi acionada (todas as
// mutacoes seguiram o fluxo planejado do proprio script).
//
// Comando executado (a partir da raiz do repositorio):
//   node --env-file=qa/.env qa/fase-4/scripts/permissoes-14-qa-alterar-papel.js

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

function alterarPapel(token, vinculoId, novoPapel) {
  return chamarRpc(token, 'alterar_papel_usuario_empresa', { p_vinculo_id: vinculoId, p_novo_papel: novoPapel });
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

  console.log('\n===== RESUMO FINAL - ALTERAR PAPEL (5º incremento) =====');
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

  // Torna-se true assim que uma reconsulta confirmar que LIVRE está ativo
  // após REATIVAR-01 - usado por restaurarLivre() para diferenciar
  // "nenhuma mutação ocorreu" de "estado inesperado após mutação
  // confirmada".
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
        registrar('RESTAURACAO', false, 'LIVRE sem nenhuma linha, mas uma mutação já havia sido confirmada - estado inesperado (as RPCs desta fase nunca fazem DELETE). Intervenção manual necessária.');
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
    if (linha.ativo === false) {
      registrar('RESTAURACAO', false, `LIVRE inativo mas com papel inesperado (${linha.papel}) - nenhuma correção automática tentada. Intervenção manual necessária.`);
      return;
    }
    const PAPEIS_RECUPERAVEIS = ['admin', 'gerente', 'usuario'];
    if (!PAPEIS_RECUPERAVEIS.includes(linha.papel)) {
      registrar('RESTAURACAO', false, `LIVRE ativo com papel inesperado (${linha.papel}) - só admin/gerente/usuario são recuperáveis automaticamente (nunca proprietario); nenhuma correção automática tentada. Intervenção manual necessária.`);
      return;
    }

    try {
      if (linha.papel !== 'gerente') {
        const alt = await alterarPapel(prop.access_token, linha.id, 'gerente');
        console.log('HTTP', alt.status, JSON.stringify(alt.data));
        const altLinha = Array.isArray(alt.data) ? alt.data[0] : null;
        if (alt.status !== 200 || !altLinha || altLinha.papel_novo !== 'gerente') {
          registrar('RESTAURACAO', false, `falha ao restaurar papel do LIVRE para gerente: ${JSON.stringify(alt.data)}`);
          return;
        }
      }

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

  // ===== BASELINE-01 =====
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
  registrar('BASELINE-01', true, 'baseline confirmado: 4 vínculos no estado esperado');

  // ===== TRQ34-01 =====
  console.log('\n== TRQ34-01 (PROP_A, p_vinculo_id válido = ADMIN_A, p_novo_papel inválido) ==');
  const t34 = await alterarPapel(prop.access_token, baseAdmin.id, 'papel_invalido');
  console.log('HTTP', t34.status, JSON.stringify(t34.data));
  registrar('TRQ34-01', t34.status === 400 && t34.data?.code === 'TRQ34', `code=${t34.data?.code}`);

  // ===== TRQ37-01 =====
  console.log('\n== TRQ37-01 (PROP_A, UUID inexistente) ==');
  const t37 = await alterarPapel(prop.access_token, '00000000-0000-0000-0000-000000000000', 'gerente');
  console.log('HTTP', t37.status, JSON.stringify(t37.data));
  registrar('TRQ37-01', t37.status === 400 && t37.data?.code === 'TRQ37', `code=${t37.data?.code}`);

  // ===== TRQ36-01 =====
  // USUARIO_A (não PROP_A) tentando alterar o próprio vínculo: prova que
  // TRQ36 dispara antes até da checagem de permissão do chamador (TRQ35)
  // - USUARIO_A não teria permissão para chamar esta RPC sobre ninguém,
  // mas o bloqueio por autoalteração intercepta primeiro mesmo assim.
  console.log('\n== TRQ36-01 (USUARIO_A tenta alterar o próprio papel) ==');
  const t36 = await alterarPapel(usuario.access_token, baseUsuario.id, 'gerente');
  console.log('HTTP', t36.status, JSON.stringify(t36.data));
  registrar('TRQ36-01', t36.status === 400 && t36.data?.code === 'TRQ36', `code=${t36.data?.code}`);

  // ===== TRQ38-01 =====
  console.log('\n== TRQ38-01 (PROP_A tenta alterar o LIVRE, inativo) ==');
  const t38 = await alterarPapel(prop.access_token, baseLivre.id, 'usuario');
  console.log('HTTP', t38.status, JSON.stringify(t38.data));
  registrar('TRQ38-01', t38.status === 400 && t38.data?.code === 'TRQ38', `code=${t38.data?.code}`);

  // ===== TRQ40-01 =====
  // Alvo é o LIVRE (ainda INATIVO), não ADMIN_A: mesmo que a checagem
  // TRQ40 regredisse, o LIVRE segue inativo aqui - TRQ38 seria uma
  // segunda barreira independente antes do UPDATE.
  console.log('\n== TRQ40-01 (PROP_A tenta promover o LIVRE, ainda inativo, a proprietario) ==');
  const t40a = await alterarPapel(prop.access_token, baseLivre.id, 'proprietario');
  console.log('HTTP', t40a.status, JSON.stringify(t40a.data));
  registrar('TRQ40-01', t40a.status === 400 && t40a.data?.code === 'TRQ40', `code=${t40a.data?.code}`);

  // ===== TRQ40-02 =====
  // Mesma lógica de defesa em profundidade: alvo é o LIVRE (ainda
  // inativo), com TRQ38 e TRQ35 como barreiras adicionais independentes.
  console.log('\n== TRQ40-02 (ADMIN_A tenta promover o LIVRE, ainda inativo, a proprietario) ==');
  const t40b = await alterarPapel(admin.access_token, baseLivre.id, 'proprietario');
  console.log('HTTP', t40b.status, JSON.stringify(t40b.data));
  registrar('TRQ40-02', t40b.status === 400 && t40b.data?.code === 'TRQ40', `code=${t40b.data?.code}`);

  // ===== Integridade após todas as tentativas bloqueadas =====
  console.log('\n== CONF-BLOQUEIOS-01 (PROP_A, ADMIN_A, USUARIO_A e LIVRE inalterados) ==');
  const confBloq = await selectVinculos(prop.access_token, EMPRESA_A);
  const admInalterado = JSON.stringify(normalizarLinha(encontrarLinha(confBloq.data, admin.user.id))) === JSON.stringify(normalizarLinha(baseAdmin));
  const usrInalterado = JSON.stringify(normalizarLinha(encontrarLinha(confBloq.data, usuario.user.id))) === JSON.stringify(normalizarLinha(baseUsuario));
  const propInalterado = JSON.stringify(normalizarLinha(encontrarLinha(confBloq.data, prop.user.id))) === JSON.stringify(normalizarLinha(baseProp));
  const livreInalterado = JSON.stringify(normalizarLinha(encontrarLinha(confBloq.data, livre.user.id))) === JSON.stringify(normalizarLinha(baseLivre));
  registrar('CONF-BLOQUEIOS-01', admInalterado && usrInalterado && propInalterado && livreInalterado,
    `ADMIN_A=${admInalterado}, USUARIO_A=${usrInalterado}, PROP_A=${propInalterado}, LIVRE=${livreInalterado}`);

  // ===== ANON-01 =====
  console.log('\n== ANON-01 ==');
  const anon = await alterarPapel(null, baseAdmin.id, 'gerente');
  console.log('HTTP', anon.status, JSON.stringify(anon.data));
  registrar('ANON-01', anon.status === 401, `HTTP ${anon.status}, code=${anon.data?.code}`);

  // A partir daqui a fase mutável começa (REATIVAR-01 até FINAL-01) - todo
  // este bloco é envolvido por um try/catch cujo catch trata qualquer
  // exceção inesperada (ex.: falha de rede depois de o servidor já ter
  // processado a chamada, resposta perdida, timeout) chamando
  // falhaComRestauracao(), que sempre relê o estado real do LIVRE antes
  // de decidir a ação - não depende só de mutacaoConfirmada, que é usada
  // apenas como sinal auxiliar dentro de restaurarLivre() para o caso
  // específico de nenhuma linha ser encontrada.
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

  // ===== TRQ35-01 =====
  // Único teste negativo cujo alvo é um vínculo ATIVO com um papel válido
  // ('admin') - por isso, diferente dos testes anteriores, uma falha
  // aqui aciona IMEDIATAMENTE falhaComRestauracao(), sem esperar mais
  // nenhum passo.
  console.log('\n== TRQ35-01 (LIVRE já ativo/gerente; ADMIN_A tenta defini-lo como admin) ==');
  const t35 = await alterarPapel(admin.access_token, baseLivre.id, 'admin');
  console.log('HTTP', t35.status, JSON.stringify(t35.data));
  if (!(t35.status === 400 && t35.data?.code === 'TRQ35')) {
    await falhaComRestauracao('TRQ35-01', `esperado bloqueio TRQ35, recebido: ${JSON.stringify(t35.data)}`);
    return;
  }
  registrar('TRQ35-01', true, 'ADMIN_A bloqueado (TRQ35) ao tentar definir o LIVRE como admin');

  // ===== CONF-TRQ35-01 =====
  console.log('\n== CONF-TRQ35-01 (LIVRE permanece ativo/gerente, id/criado_em preservados) ==');
  const confT35 = await lerEstadoAtualLivre();
  const linhaConfT35 = confT35.linhas?.[0];
  const confT35Ok = !confT35.erro && linhaConfT35 &&
    linhaConfT35.id === baseLivre.id &&
    linhaConfT35.criado_em === baseLivre.criado_em &&
    linhaConfT35.ativo === true &&
    linhaConfT35.papel === 'gerente';
  if (!confT35Ok) {
    await falhaComRestauracao('CONF-TRQ35-01', `estado do LIVRE após o bloqueio não confere: ${JSON.stringify(linhaConfT35)}`);
    return;
  }
  registrar('CONF-TRQ35-01', true, 'LIVRE permanece ativo/gerente após o bloqueio TRQ35; id e criado_em preservados');

  // ===== ALTERAR-PROP-01 =====
  console.log('\n== ALTERAR-PROP-01 (PROP_A altera LIVRE gerente -> usuario) ==');
  const altProp = await alterarPapel(prop.access_token, baseLivre.id, 'usuario');
  console.log('HTTP', altProp.status, JSON.stringify(altProp.data));
  const altPropLinha = Array.isArray(altProp.data) ? altProp.data[0] : null;
  if (altProp.status !== 200 || !altPropLinha || altPropLinha.papel_anterior !== 'gerente' || altPropLinha.papel_novo !== 'usuario' || altPropLinha.vinculo_id !== baseLivre.id) {
    await falhaComRestauracao('ALTERAR-PROP-01', `resultado inesperado: ${JSON.stringify(altProp.data)}`);
    return;
  }
  registrar('ALTERAR-PROP-01', true, 'PROP_A alterou LIVRE de gerente para usuario');

  // ===== CONF-PROP-01 =====
  console.log('\n== CONF-PROP-01 (id/criado_em/ativo preservados) ==');
  const confProp = await lerEstadoAtualLivre();
  const linhaConfProp = confProp.linhas?.[0];
  const confPropOk = !confProp.erro && linhaConfProp &&
    linhaConfProp.id === baseLivre.id &&
    linhaConfProp.criado_em === baseLivre.criado_em &&
    linhaConfProp.ativo === true &&
    linhaConfProp.papel === 'usuario';
  if (!confPropOk) {
    await falhaComRestauracao('CONF-PROP-01', `id/criado_em/ativo/papel não conferem: ${JSON.stringify(linhaConfProp)}`);
    return;
  }
  registrar('CONF-PROP-01', true, 'id, criado_em e ativo preservados; papel=usuario confirmado');

  // ===== ALTERAR-ADMIN-01 =====
  console.log('\n== ALTERAR-ADMIN-01 (ADMIN_A altera LIVRE usuario -> gerente) ==');
  const altAdmin = await alterarPapel(admin.access_token, baseLivre.id, 'gerente');
  console.log('HTTP', altAdmin.status, JSON.stringify(altAdmin.data));
  const altAdminLinha = Array.isArray(altAdmin.data) ? altAdmin.data[0] : null;
  if (altAdmin.status !== 200 || !altAdminLinha || altAdminLinha.papel_anterior !== 'usuario' || altAdminLinha.papel_novo !== 'gerente' || altAdminLinha.vinculo_id !== baseLivre.id) {
    await falhaComRestauracao('ALTERAR-ADMIN-01', `resultado inesperado: ${JSON.stringify(altAdmin.data)}`);
    return;
  }
  registrar('ALTERAR-ADMIN-01', true, 'ADMIN_A alterou LIVRE de usuario para gerente');

  // ===== CONF-ADMIN-01 =====
  console.log('\n== CONF-ADMIN-01 (id/criado_em/ativo preservados) ==');
  const confAdmin = await lerEstadoAtualLivre();
  const linhaConfAdmin = confAdmin.linhas?.[0];
  const confAdminOk = !confAdmin.erro && linhaConfAdmin &&
    linhaConfAdmin.id === baseLivre.id &&
    linhaConfAdmin.criado_em === baseLivre.criado_em &&
    linhaConfAdmin.ativo === true &&
    linhaConfAdmin.papel === 'gerente';
  if (!confAdminOk) {
    await falhaComRestauracao('CONF-ADMIN-01', `id/criado_em/ativo/papel não conferem: ${JSON.stringify(linhaConfAdmin)}`);
    return;
  }
  registrar('CONF-ADMIN-01', true, 'id, criado_em e ativo preservados; papel=gerente confirmado (de volta ao papel do baseline)');

  // ===== RESTORE-01 =====
  console.log('\n== RESTORE-01 (autorremoção obrigatória do LIVRE) ==');
  const rest = await removerUsuario(livre.access_token, baseLivre.id);
  console.log('HTTP', rest.status, JSON.stringify(rest.data));
  const restLinha = Array.isArray(rest.data) ? rest.data[0] : null;
  if (rest.status !== 200 || !restLinha || restLinha.ativo !== false) {
    await falhaComRestauracao('RESTORE-01', `falha na autorremoção do LIVRE: ${JSON.stringify(rest.data)}`);
    return;
  }
  registrar('RESTORE-01', true, 'LIVRE realizou autorremoção - baseline restaurado (inativo/gerente)');

  // ===== FINAL-01 =====
  console.log('\n== FINAL-01 (comparação byte a byte contra o baseline) ==');
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
    await falhaComRestauracao('FINAL-01', `estado final não é byte a byte idêntico ao baseline. baseline=${JSON.stringify(baselineNorm)} final=${JSON.stringify(finalNorm)}`);
    return;
  }
  registrar('FINAL-01', true, 'estado final byte a byte idêntico ao baseline (id/usuario_id/papel/ativo/criado_em)');

  imprimirResumoFinal(fin.data);
  const houveReprovacao = resultados.some((r) => r.status === 'REPROVADO');
  if (houveReprovacao) process.exit(1);
  } catch (erroInesperado) {
    // Exceção inesperada em qualquer ponto entre REATIVAR-01 e FINAL-01
    // (ex.: falha de rede depois de o servidor já ter processado a
    // chamada, timeout, resposta perdida) - trata como falha crítica e
    // aciona a restauração de segurança, que relê o estado real do LIVRE
    // antes de decidir a ação, em vez de presumir que nada foi escrito.
    await falhaComRestauracao('EXCECAO-FASE-MUTAVEL', `exceção inesperada durante a fase mutável (entre REATIVAR-01 e FINAL-01): ${erroInesperado.message}`);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', redigirSegredos(err.message));
  imprimirResumoFinal(null);
  process.exit(1);
});
