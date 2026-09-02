// QA Fase 4.2 - Conclusão do teste pendente DEL-03 (matriz do Bloco 2)
//
// No Bloco 2 (permissoes-07), DEL-03 (ADMIN_A tenta remover outro vínculo
// admin) ficou registrado como PENDENTE, porque nas fixtures usadas ali só
// existia 1 vínculo admin (o próprio ADMIN_A), e usá-lo alteraria uma conta
// essencial do QA. Este script conclui DEL-03 criando um segundo admin
// TEMPORÁRIO (reaproveitando LIVRE) só para esse teste, e desfazendo essa
// alteração ao final - sem tocar em PROP_A, ADMIN_A ou USUARIO_A.
//
// Fluxo (plano aprovado):
//   PRE-DEL03-01 - confirma baseline (3 vínculos originais ativos corretos)
//                  e detecta o estado atual do LIVRE (modo inserir/reativar).
//   PREP-01      - PROP_A reativa/inclui LIVRE como 'admin' (temporário).
//   DEL-03       - ADMIN_A tenta remover o vínculo do LIVRE (agora admin).
//                  Esperado: bloqueio TRQ45 (admin só remove gerente/usuario).
//   CONF-DEL03-01- confirma que LIVRE continua ativo/admin após o bloqueio.
//   RESTORE-01   - PROP_A rebaixa LIVRE de admin para gerente.
//   RESTORE-02   - LIVRE realiza autorremoção (fica inativo/gerente).
//   FINAL-DEL03  - confirma estado final: 3 originais ativos inalterados +
//                  LIVRE inativo/gerente, nenhuma linha adicional (mesmo
//                  rigor de comparação usado em FINAL-01 do Bloco 2).
//
// Restauração de segurança (requisito explícito): qualquer falha crítica a
// partir de PREP-01 (inclusive DEL-03 retornando sucesso indevido, o que
// deixaria LIVRE inativo/admin OU ativo/admin conforme o ponto da falha)
// aciona restaurarLivre(), que LÊ o estado real atual do LIVRE (nunca
// presume) e decide a ação com base em 6 casos:
//   1. ativo/admin   -> rebaixa para gerente, depois autorremove.
//   2. ativo/gerente -> autorremove diretamente.
//   3. inativo/admin -> reativa como gerente (incluir_usuario_empresa),
//                        confirma ativo/gerente, depois autorremove.
//   4. inativo/gerente -> já é o estado seguro; nenhuma mutação adicional.
//   5. sem linha     -> se nenhuma mutação havia sido confirmada após
//                        PREP-01, não faz nada; se uma mutação já havia sido
//                        confirmada, é estado inesperado (as RPCs desta fase
//                        nunca fazem DELETE) - interrompe sem tentar corrigir.
//   6. mais de uma linha, ou papel fora de {admin, gerente} - nenhuma
//                        correção automática; reporta necessidade de
//                        intervenção manual.
// A falha original de um teste (ex.: DEL-03) e o resultado da restauração
// são SEMPRE registrados como itens separados no resumo (ex.: 'DEL-03' e
// 'RESTAURACAO-DEL03') - a restauração bem-sucedida nunca transforma a
// falha original em aprovação, e o script sempre termina com código de
// saída != 0 quando isso acontece, mesmo que a restauração tenha funcionado.
// O retorno bruto de qualquer RPC é sempre logado antes de qualquer
// decisão - nunca é ocultado.
//
// Mesmo padrão de segurança dos Blocos 1 e 2: login real por papel via
// /auth/v1/token, redigirSegredos() para nunca logar token/senha/chave, sem
// service_role, sem DELETE manual (as RPCs desta fase só fazem soft delete).
// Este script não altera permissoes-06 nem permissoes-07.
//
// Seguro contra execução repetida: PRE-DEL03-01 detecta o estado real do
// LIVRE antes de qualquer mutação (mesmo padrão de PRE-01 do Bloco 2) - se
// LIVRE já estiver ativo, aborta sem alterar nada, presumindo execução
// anterior incompleta, sem tentar retomar ou corrigir automaticamente.
//
// AINDA NAO EXECUTADO.
// Rodar (a partir da raiz do repositorio), sob autorizacao explicita do
// usuario:
//   node --env-file=qa/.env qa/fase-4/scripts/permissoes-08-qa-del03.js

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
// exigencia ja usada nos Blocos 1 e 2.
if (!process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO) {
  console.error('Variável de ambiente obrigatória ausente: QA_PASSWORD_PROPRIETARIO_ANTIGO');
  console.error('Configure qa/.env (ver qa/.env.example) e rode novamente.');
  process.exit(1);
}
const SENHA_PROPRIETARIO_ANTIGO = process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO;

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

let resultados = []; // { id, status: 'APROVADO' | 'REPROVADO' | 'PENDENTE', detalhe }

function registrar(id, status, detalhe) {
  const icone = status === 'APROVADO' ? '✅' : status === 'REPROVADO' ? '🚨' : '⏭️';
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

  const contentType = resp.headers.get('content-type') || '(nenhum)';
  const raw = await resp.text();
  console.log(`[login:${nomeLogico}] HTTP ${resp.status} | content-type: ${contentType} | tamanho do corpo: ${raw.length} bytes`);

  let data = null;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error(`[login:${nomeLogico}] corpo recebido não é JSON válido (redigido, 300 chars): ${redigirSegredos(raw.slice(0, 300))}`);
      throw new Error(`Falha no login de ${nomeLogico}: corpo da resposta não é JSON válido (HTTP ${resp.status}).`);
    }
  }

  if (!resp.ok || !data) {
    console.error(`[login:${nomeLogico}] falha no login. Corpo (redigido): ${data ? redigirSegredos(JSON.stringify(data)) : '(corpo vazio)'}`);
    throw new Error(`Falha no login de ${nomeLogico} (HTTP ${resp.status}).`);
  }

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

function alterarPapel(token, vinculoId, novoPapel) {
  return chamarRpc(token, 'alterar_papel_usuario_empresa', { p_vinculo_id: vinculoId, p_novo_papel: novoPapel });
}

function removerUsuario(token, vinculoId) {
  return chamarRpc(token, 'remover_usuario_empresa', { p_vinculo_id: vinculoId });
}

function encontrarLinha(lista, usuarioId) {
  return Array.isArray(lista) ? lista.find((r) => r.usuario_id === usuarioId) : undefined;
}

function normalizarLinha(r) {
  return { id: r.id, empresa_id: r.empresa_id, usuario_id: r.usuario_id, papel: r.papel, ativo: r.ativo };
}

function ordenarPorId(lista) {
  return [...lista].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function imprimirResumoFinal(estadoFinalEmpresaA) {
  const aprovados = resultados.filter((r) => r.status === 'APROVADO');
  const reprovados = resultados.filter((r) => r.status === 'REPROVADO');
  const pendentes = resultados.filter((r) => r.status === 'PENDENTE');

  console.log('\n===== RESUMO FINAL - DEL-03 =====');
  console.log(`Aprovados (${aprovados.length}): ${aprovados.map((r) => r.id).join(', ') || '(nenhum)'}`);
  console.log(`Reprovados (${reprovados.length}): ${reprovados.map((r) => r.id).join(', ') || '(nenhum)'}`);
  console.log(`Pendentes/Ignorados (${pendentes.length}): ${pendentes.map((r) => r.id).join(', ') || '(nenhum)'}`);

  if (estadoFinalEmpresaA) {
    console.log('\nEstado final da Empresa A:');
    console.log(JSON.stringify(estadoFinalEmpresaA, null, 2));
  } else {
    console.log('\nEstado final da Empresa A: não coletado (execução interrompida).');
  }

  if (reprovados.length > 0) {
    console.log('\n🚨 RESULTADO: HÁ TESTE(S) REPROVADO(S).');
  } else if (pendentes.length > 0) {
    console.log('\n⚠️ RESULTADO: sem reprovações, mas há teste(s) PENDENTE(S).');
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
  console.log('== Login das 4 contas necessárias para concluir DEL-03 ==');
  const prop = await login('PROP_A', EMAIL_PROPRIETARIO, SENHA_QA);
  console.log('PROP_A logado. user_id =', prop.user?.id);
  const admin = await login('ADMIN_A', EMAIL_ADMIN, SENHA_QA);
  console.log('ADMIN_A logado. user_id =', admin.user?.id);
  const usuario = await login('USUARIO_A', EMAIL_USUARIO, SENHA_QA);
  console.log('USUARIO_A logado. user_id =', usuario.user?.id);
  const livre = await login('LIVRE', EMAIL_PROPRIETARIO_ANTIGO, SENHA_PROPRIETARIO_ANTIGO);
  console.log('LIVRE logado. user_id =', livre.user?.id);

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
  // após PREP-01 - usado por restaurarLivre() para diferenciar "nenhuma
  // mutação ocorreu" de "estado inesperado após mutação confirmada".
  let mutacaoConfirmadaAposPrep = false;

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
      registrar('RESTAURACAO-DEL03', 'REPROVADO', `não foi possível ler o estado atual do LIVRE para restaurar (HTTP ${estado.bruto.status}) - intervenção manual pode ser necessária`);
      return;
    }
    const { linhas } = estado;
    console.log('Estado atual do LIVRE na Empresa A:', JSON.stringify(linhas));

    if (linhas.length === 0) {
      if (!mutacaoConfirmadaAposPrep) {
        registrar('RESTAURACAO-DEL03', 'APROVADO', 'LIVRE sem nenhuma linha e nenhuma mutação havia sido confirmada após PREP-01 - nada a restaurar');
      } else {
        registrar('RESTAURACAO-DEL03', 'REPROVADO', 'LIVRE sem nenhuma linha, mas uma mutação já havia sido confirmada após PREP-01 - estado inesperado (as RPCs desta fase nunca fazem DELETE). Intervenção manual necessária.');
      }
      return;
    }

    if (linhas.length > 1) {
      registrar('RESTAURACAO-DEL03', 'REPROVADO', `LIVRE possui ${linhas.length} linhas na Empresa A - estado inesperado, nenhuma correção automática tentada. Intervenção manual necessária. Linhas: ${JSON.stringify(linhas)}`);
      return;
    }

    const linha = linhas[0];
    if (linha.papel !== 'admin' && linha.papel !== 'gerente') {
      registrar('RESTAURACAO-DEL03', 'REPROVADO', `LIVRE com papel inesperado (${linha.papel}) - nenhuma correção automática tentada. Intervenção manual necessária. Linha: ${JSON.stringify(linha)}`);
      return;
    }

    try {
      if (linha.ativo === true && linha.papel === 'admin') {
        const alt = await alterarPapel(prop.access_token, linha.id, 'gerente');
        console.log('HTTP', alt.status, JSON.stringify(alt.data));
        const altLinha = Array.isArray(alt.data) ? alt.data[0] : null;
        if (alt.status !== 200 || !altLinha || altLinha.papel_novo !== 'gerente') {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `falha ao rebaixar LIVRE de admin para gerente durante restauração: ${JSON.stringify(alt.data)}`);
          return;
        }
        const rem = await removerUsuario(livre.access_token, linha.id);
        console.log('HTTP', rem.status, JSON.stringify(rem.data));
        const remLinha = Array.isArray(rem.data) ? rem.data[0] : null;
        if (rem.status !== 200 || !remLinha || remLinha.ativo !== false) {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `falha na autorremoção do LIVRE durante restauração: ${JSON.stringify(rem.data)}`);
          return;
        }
        const conf = await lerEstadoAtualLivre();
        const linhaConf = conf.linhas && conf.linhas[0];
        if (conf.erro || !linhaConf || linhaConf.ativo !== false || linhaConf.papel !== 'gerente') {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `estado pós-restauração não confirma inativo/gerente: ${JSON.stringify(linhaConf)}`);
          return;
        }
        registrar('RESTAURACAO-DEL03', 'APROVADO', 'LIVRE estava ativo/admin - rebaixado a gerente e autorremovido; confirmado inativo/gerente');
        return;
      }

      if (linha.ativo === true && linha.papel === 'gerente') {
        const rem = await removerUsuario(livre.access_token, linha.id);
        console.log('HTTP', rem.status, JSON.stringify(rem.data));
        const remLinha = Array.isArray(rem.data) ? rem.data[0] : null;
        if (rem.status !== 200 || !remLinha || remLinha.ativo !== false) {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `falha na autorremoção do LIVRE durante restauração: ${JSON.stringify(rem.data)}`);
          return;
        }
        const conf = await lerEstadoAtualLivre();
        const linhaConf = conf.linhas && conf.linhas[0];
        if (conf.erro || !linhaConf || linhaConf.ativo !== false || linhaConf.papel !== 'gerente') {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `estado pós-restauração não confirma inativo/gerente: ${JSON.stringify(linhaConf)}`);
          return;
        }
        registrar('RESTAURACAO-DEL03', 'APROVADO', 'LIVRE estava ativo/gerente - autorremovido; confirmado inativo/gerente');
        return;
      }

      if (linha.ativo === false && linha.papel === 'admin') {
        const inc = await incluirUsuario(prop.access_token, EMPRESA_A, EMAIL_PROPRIETARIO_ANTIGO, 'gerente');
        console.log('HTTP', inc.status, JSON.stringify(inc.data));
        const incLinha = Array.isArray(inc.data) ? inc.data[0] : null;
        if (inc.status !== 200 || !incLinha || incLinha.papel !== 'gerente' || incLinha.ativo !== true) {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `falha ao reativar LIVRE como gerente durante restauração: ${JSON.stringify(inc.data)}`);
          return;
        }
        const confReativacao = await lerEstadoAtualLivre();
        const linhaReativacao = confReativacao.linhas && confReativacao.linhas[0];
        if (confReativacao.erro || !linhaReativacao || linhaReativacao.ativo !== true || linhaReativacao.papel !== 'gerente') {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `reconsulta não confirma ativo/gerente após reativação durante restauração: ${JSON.stringify(linhaReativacao)}`);
          return;
        }
        const rem = await removerUsuario(livre.access_token, incLinha.vinculo_id);
        console.log('HTTP', rem.status, JSON.stringify(rem.data));
        const remLinha = Array.isArray(rem.data) ? rem.data[0] : null;
        if (rem.status !== 200 || !remLinha || remLinha.ativo !== false) {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `falha na autorremoção do LIVRE durante restauração: ${JSON.stringify(rem.data)}`);
          return;
        }
        const conf = await lerEstadoAtualLivre();
        const linhaConf = conf.linhas && conf.linhas[0];
        if (conf.erro || !linhaConf || linhaConf.ativo !== false || linhaConf.papel !== 'gerente') {
          registrar('RESTAURACAO-DEL03', 'REPROVADO', `estado pós-restauração não confirma inativo/gerente: ${JSON.stringify(linhaConf)}`);
          return;
        }
        registrar('RESTAURACAO-DEL03', 'APROVADO', 'LIVRE estava inativo/admin - reativado como gerente, confirmado ativo/gerente e então autorremovido; confirmado inativo/gerente');
        return;
      }

      // linha.ativo === false && linha.papel === 'gerente'
      registrar('RESTAURACAO-DEL03', 'APROVADO', 'LIVRE já estava inativo/gerente - estado de restauração já alcançado, nenhuma mutação adicional executada');
    } catch (e) {
      registrar('RESTAURACAO-DEL03', 'REPROVADO', `erro inesperado durante a restauração: ${e.message}`);
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

  // ===== PRE-DEL03-01 =====
  console.log('\n== PRE-DEL03-01 ==');
  const preSel = await selectVinculos(prop.access_token, EMPRESA_A);
  console.log('HTTP', preSel.status, JSON.stringify(preSel.data));
  if (preSel.status !== 200 || !Array.isArray(preSel.data)) {
    abortarPreVoo('PRE-DEL03-01', `falha inesperada ao consultar a Empresa A (HTTP ${preSel.status})`);
  }

  const esperadoBaseline = {
    [prop.user.id]: 'proprietario',
    [admin.user.id]: 'admin',
    [usuario.user.id]: 'usuario',
  };
  const linhasAtivasBaseline = preSel.data.filter((r) => r.ativo === true && r.usuario_id in esperadoBaseline);
  const baselineOk =
    linhasAtivasBaseline.length === 3 &&
    Object.entries(esperadoBaseline).every(([uid, papelEsperado]) => {
      const linha = linhasAtivasBaseline.find((r) => r.usuario_id === uid);
      return linha && linha.papel === papelEsperado;
    }) &&
    preSel.data.filter((r) => r.ativo === true && r.usuario_id !== livre.user.id).length === 3;

  if (!baselineOk) {
    abortarPreVoo('PRE-DEL03-01', 'baseline da Empresa A não corresponde ao esperado (3 vínculos ativos com usuario_id/papel/ativo exatos de PROP_A=proprietario, ADMIN_A=admin, USUARIO_A=usuario) - estado inesperado, nenhuma mutação será tentada');
  }

  const linhaLivreInicial = encontrarLinha(preSel.data, livre.user.id);
  let modoLivre;
  if (!linhaLivreInicial) {
    modoLivre = 'inserir';
  } else if (linhaLivreInicial.ativo === true) {
    abortarPreVoo('PRE-DEL03-01', 'LIVRE possui vínculo ATIVO na Empresa A - possível execução anterior incompleta. Abortando antes de qualquer mutação (sem correção automática).');
  } else if (linhaLivreInicial.ativo === false) {
    const outrasLinhasLivre = preSel.data.filter((r) => r.usuario_id === livre.user.id);
    if (outrasLinhasLivre.length > 1) {
      abortarPreVoo('PRE-DEL03-01', `LIVRE possui mais de uma linha na Empresa A (${outrasLinhasLivre.length}) - estado inesperado. Abortando sem alterar nada.`);
    }
    modoLivre = 'reativar';
  } else {
    abortarPreVoo('PRE-DEL03-01', `LIVRE possui linha em estado inesperado: ${JSON.stringify(linhaLivreInicial)}. Abortando sem alterar nada.`);
  }

  registrar('PRE-DEL03-01', 'APROVADO', `baseline confirmado (3 vínculos ativos originais corretos); LIVRE em modo "${modoLivre}"`);

  // ===== PREP-01 =====
  console.log('\n== PREP-01 ==');
  const prep01 = await incluirUsuario(prop.access_token, EMPRESA_A, EMAIL_PROPRIETARIO_ANTIGO, 'admin');
  console.log('HTTP', prep01.status, JSON.stringify(prep01.data));
  const prep01Linha = Array.isArray(prep01.data) ? prep01.data[0] : null;

  const confPrep01 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linhaPrep01 = encontrarLinha(confPrep01.data, livre.user.id);
  if (linhaPrep01 && linhaPrep01.ativo === true) {
    mutacaoConfirmadaAposPrep = true;
  }

  const reativadoEsperado = modoLivre === 'reativar';
  if (
    prep01.status !== 200 ||
    !prep01Linha ||
    prep01Linha.papel !== 'admin' ||
    prep01Linha.ativo !== true ||
    prep01Linha.reativado !== reativadoEsperado ||
    !linhaPrep01 ||
    linhaPrep01.papel !== 'admin' ||
    linhaPrep01.ativo !== true
  ) {
    await falhaComRestauracao('PREP-01', `transição não corresponde ao esperado (modo=${modoLivre}, reativado esperado=${reativadoEsperado}). RPC=${JSON.stringify(prep01.data)} reconsulta=${JSON.stringify(linhaPrep01)}`);
    return;
  }
  const livreVinculoId = linhaPrep01.id;
  registrar('PREP-01', 'APROVADO', `LIVRE incluído/reativado como admin (modo=${modoLivre}) - preparação temporária para DEL-03`);

  // ===== DEL-03 =====
  console.log('\n== DEL-03 ==');
  const del03 = await removerUsuario(admin.access_token, livreVinculoId);
  console.log('HTTP', del03.status, JSON.stringify(del03.data));
  if (del03.status >= 400 && del03.data && del03.data.code === 'TRQ45') {
    registrar('DEL-03', 'APROVADO', 'ADMIN_A bloqueado (TRQ45) ao tentar remover outro vínculo admin (LIVRE) - conclui o teste que ficou pendente no Bloco 2');
  } else {
    await falhaComRestauracao('DEL-03', `resultado inesperado - esperado bloqueio TRQ45, recebido HTTP ${del03.status}: ${JSON.stringify(del03.data)}`);
    return;
  }

  // ===== CONF-DEL03-01 =====
  console.log('\n== CONF-DEL03-01 ==');
  const confDel03 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linhaConfDel03 = encontrarLinha(confDel03.data, livre.user.id);
  console.log('Vínculo do LIVRE após a tentativa bloqueada:', JSON.stringify(linhaConfDel03));
  if (!linhaConfDel03 || linhaConfDel03.papel !== 'admin' || linhaConfDel03.ativo !== true) {
    await falhaComRestauracao('CONF-DEL03-01', `vínculo do LIVRE mudou inesperadamente após a tentativa bloqueada: ${JSON.stringify(linhaConfDel03)}`);
    return;
  }
  registrar('CONF-DEL03-01', 'APROVADO', 'LIVRE permanece ativo/admin após o bloqueio confirmado em DEL-03');

  // ===== RESTORE-01 =====
  console.log('\n== RESTORE-01 ==');
  const restore01 = await alterarPapel(prop.access_token, livreVinculoId, 'gerente');
  console.log('HTTP', restore01.status, JSON.stringify(restore01.data));
  const restore01Linha = Array.isArray(restore01.data) ? restore01.data[0] : null;
  if (restore01.status !== 200 || !restore01Linha || restore01Linha.papel_novo !== 'gerente') {
    await falhaComRestauracao('RESTORE-01', `falha ao alterar papel de LIVRE de admin para gerente: ${JSON.stringify(restore01.data)}`);
    return;
  }
  const confRestore01 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linhaRestore01 = encontrarLinha(confRestore01.data, livre.user.id);
  if (!linhaRestore01 || linhaRestore01.papel !== 'gerente' || linhaRestore01.ativo !== true) {
    await falhaComRestauracao('RESTORE-01', `reconsulta não confirma papel=gerente/ativo=true: ${JSON.stringify(linhaRestore01)}`);
    return;
  }
  registrar('RESTORE-01', 'APROVADO', 'PROP_A alterou papel de LIVRE de admin para gerente');

  // ===== RESTORE-02 =====
  console.log('\n== RESTORE-02 ==');
  const restore02 = await removerUsuario(livre.access_token, livreVinculoId);
  console.log('HTTP', restore02.status, JSON.stringify(restore02.data));
  const restore02Linha = Array.isArray(restore02.data) ? restore02.data[0] : null;
  if (restore02.status !== 200 || !restore02Linha || restore02Linha.ativo !== false) {
    await falhaComRestauracao('RESTORE-02', `falha na autorremoção do LIVRE: ${JSON.stringify(restore02.data)}`);
    return;
  }
  const confRestore02 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linhaRestore02 = encontrarLinha(confRestore02.data, livre.user.id);
  if (!linhaRestore02 || linhaRestore02.papel !== 'gerente' || linhaRestore02.ativo !== false) {
    await falhaComRestauracao('RESTORE-02', `reconsulta não confirma inativo/gerente: ${JSON.stringify(linhaRestore02)}`);
    return;
  }
  registrar('RESTORE-02', 'APROVADO', 'LIVRE realizou autorremoção (autorremoção permitida sem checar hierarquia); estado inativo/gerente');

  // ===== FINAL-DEL03 =====
  console.log('\n== FINAL-DEL03 ==');
  const finalProp = await selectVinculos(prop.access_token, EMPRESA_A);
  const finalAdmin = await selectVinculos(admin.access_token, EMPRESA_A);
  console.log('HTTP (PROP_A)', finalProp.status, JSON.stringify(finalProp.data));
  console.log('HTTP (ADMIN_A)', finalAdmin.status, JSON.stringify(finalAdmin.data));

  if (
    finalProp.status !== 200 ||
    finalAdmin.status !== 200 ||
    !Array.isArray(finalProp.data) ||
    !Array.isArray(finalAdmin.data)
  ) {
    await falhaComRestauracao('FINAL-DEL03', `falha inesperada ao consultar estado final (HTTP PROP_A=${finalProp.status}, HTTP ADMIN_A=${finalAdmin.status})`);
    return;
  }

  const propNormalizado = ordenarPorId(finalProp.data.map(normalizarLinha));
  const adminNormalizado = ordenarPorId(finalAdmin.data.map(normalizarLinha));

  if (JSON.stringify(propNormalizado) !== JSON.stringify(adminNormalizado)) {
    await falhaComRestauracao('FINAL-DEL03', `PROP_A e ADMIN_A não enxergam exatamente o mesmo conjunto de linhas na Empresa A. PROP_A=${JSON.stringify(propNormalizado)} ADMIN_A=${JSON.stringify(adminNormalizado)}`);
    return;
  }

  if (propNormalizado.length !== 4) {
    await falhaComRestauracao('FINAL-DEL03', `esperado exatamente 4 linhas na Empresa A, recebido ${propNormalizado.length}: ${JSON.stringify(propNormalizado)}`);
    return;
  }

  const linhaPropFinal = propNormalizado.find((r) => r.usuario_id === prop.user.id);
  const linhaAdminFinal = propNormalizado.find((r) => r.usuario_id === admin.user.id);
  const linhaUsuarioFinal = propNormalizado.find((r) => r.usuario_id === usuario.user.id);
  const linhaLivreFinal = propNormalizado.find((r) => r.usuario_id === livre.user.id);

  const nominaisOk =
    linhaPropFinal && linhaPropFinal.papel === 'proprietario' && linhaPropFinal.ativo === true &&
    linhaAdminFinal && linhaAdminFinal.papel === 'admin' && linhaAdminFinal.ativo === true &&
    linhaUsuarioFinal && linhaUsuarioFinal.papel === 'usuario' && linhaUsuarioFinal.ativo === true &&
    linhaLivreFinal && linhaLivreFinal.papel === 'gerente' && linhaLivreFinal.ativo === false;

  const usuariosConhecidos = new Set([prop.user.id, admin.user.id, usuario.user.id, livre.user.id]);
  const linhaInesperada = propNormalizado.find((r) => !usuariosConhecidos.has(r.usuario_id));

  if (!nominaisOk || linhaInesperada) {
    await falhaComRestauracao('FINAL-DEL03', `estado final não corresponde ao esperado nominalmente. PROP_A=${JSON.stringify(linhaPropFinal)} ADMIN_A=${JSON.stringify(linhaAdminFinal)} USUARIO_A=${JSON.stringify(linhaUsuarioFinal)} LIVRE=${JSON.stringify(linhaLivreFinal)} linha_inesperada=${JSON.stringify(linhaInesperada)}`);
    return;
  }

  registrar(
    'FINAL-DEL03',
    'APROVADO',
    'DEL-03 concluído: 3 vínculos ativos originais inalterados (PROP_A=proprietario, ADMIN_A=admin, USUARIO_A=usuario); LIVRE inativo/gerente; nenhuma linha adicional'
  );

  imprimirResumoFinal(finalProp.data);

  const houveReprovacao = resultados.some((r) => r.status === 'REPROVADO');
  if (houveReprovacao) process.exit(1);
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  imprimirResumoFinal(null);
  process.exit(1);
});
