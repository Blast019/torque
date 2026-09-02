// QA Fase 4.3 - Validacao da nova regra de criar_nova_empresa_com_vinculo
// (5 parametros, aplicada por empresas-04-restringir-nova-empresa-a-
// proprietario.sql): "somente vinculo ativo proprietario na empresa de
// origem pode criar outra empresa".
//
// ESTE SCRIPT NAO TESTA O BLOCO DE INSERT (criacao real de empresa nova).
// Cobre apenas:
//   (a) os 7 testes NEGATIVOS que devem ser bloqueados ANTES de qualquer
//       leitura/escrita de negocio (autenticacao, entrada invalida ou
//       permissao) - nenhum deles chega perto do bloco de INSERT;
//   (b) 1 teste POSITIVO que usa exclusivamente o caminho de REPLAY
//       IDEMPOTENTE de uma empresa PROPRIA e JA EXISTENTE (Empresa A) -
//       tambem nao entra no bloco de INSERT, so no bloco de retorno do
//       registro ja existente (criada_agora=false).
//
// Nenhum teste deste arquivo cria empresa nova, usuario novo ou vinculo
// novo. Nao usa service_role em nenhum momento.
//
// Testes negativos (#1-#7):
//   #1 CRIA-NEG-01 - ADMIN_A, origem = Empresa A (TRQ15).
//   #2 CRIA-NEG-02 - USUARIO_A, origem = Empresa A (TRQ15).
//   #3 CRIA-NEG-03 - LIVRE (papel gerente, vinculo INATIVO), origem =
//      Empresa A (TRQ15). Nao existe hoje, nas fixtures de QA, nenhuma
//      conta com papel gerente e vinculo ATIVO - valida o bloqueio por
//      vinculo inativo (a mesma checagem cobre os 3 casos: vinculo
//      inexistente, inativo ou com papel diferente de proprietario).
//   #4 CRIA-NEG-04 (isolamento) - PROP_A, origem = Empresa B, onde nao e
//      proprietario (TRQ15).
//   #5 CRIA-NEG-05 - PROP_A, p_empresa_origem_id = null explicito
//      (TRQ14).
//   #6 CRIA-NEG-06 - PROP_A, omitindo p_empresa_origem_id (simula uma
//      chamada com o formato da assinatura antiga de 4 parametros -
//      TRQ14, nao "funcao nao encontrada", porque p_empresa_origem_id
//      tem DEFAULT NULL e o PostgREST resolve por parametros nomeados).
//      Este resultado tambem e evidencia funcional de que a assinatura
//      antiga (sem esse parametro) nao existe mais: se existisse, essa
//      mesma chamada seria uma correspondencia EXATA para ela (sem usar
//      nenhum DEFAULT) e o Postgres prioriza a correspondencia exata -
//      a chamada teria criado uma empresa de verdade em vez de retornar
//      TRQ14.
//   #7 CRIA-NEG-07 - chamada anonima, sem token (HTTP 401 / 42501).
//
// Cada teste negativo usa um p_empresa_id NOVO (crypto.randomUUID()),
// nunca reaproveitado entre testes, com nome claramente descartavel. Como
// todos os 7 sao bloqueados antes do bloco de INSERT, nenhum desses ids
// chega a ser gravado - o script confirma isso lendo `empresas` (com o
// token da propria conta que tentou) antes e depois de cada bateria de
// testes.
//
// Teste positivo (#8):
//   #8 CRIA-REPLAY-01 - PROP_A chama a RPC com p_empresa_id = Empresa A
//      (empresa propria, ja existente, com vinculo proprietario ativo
//      confirmado) e p_empresa_origem_id = Empresa A. Envia nome/CNPJ/
//      telefone DIFERENTES dos reais, para confirmar que o replay
//      idempotente os ignora. Espera HTTP 200, mesmo empresa_id, mesmo
//      vinculo_id, criada_agora=false, e os dados retornados sendo os
//      REAIS (nao os enviados). Compara contagem de empresas/vinculos
//      visiveis a PROP_A e os registros da Empresa A/vinculo proprietario
//      antes e depois - devem ser identicos.
//
// JA EXECUTADO manualmente (fora deste arquivo versionado, via dois
// scripts equivalentes) em 02/09/2026, com os 7 testes negativos + o
// replay aprovados (8/8) - ver qa/fase-3/STATUS.md (seção 10) e
// qa/fase-4/STATUS.md para o resultado documentado. Este arquivo é a
// versão final, versionada e consolidada do mesmo teste, adaptada ao
// padrão do projeto - não foi reexecutada a partir daqui.
//
// Rodar (a partir da raiz do repositorio), sob autorizacao explicita do
// usuario:
//   node --env-file=qa/.env qa/fase-3/scripts/empresas-05-qa-restricao-nova-empresa.js

const crypto = require('crypto');

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
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B
const NOME_DESCARTAVEL = '[TESTE-DESCARTAVEL] QA Fase 4.3 - negativo';

let falhas = 0;
function reportar(id, ok, detalhe) {
  console.log(`${ok ? '✅' : '🚨'} ${id}${detalhe ? ' - ' + detalhe : ''}`);
  if (!ok) falhas++;
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
    try { data = JSON.parse(raw); } catch (e) {
      throw new Error(`Falha no login de ${nomeLogico}: corpo da resposta não é JSON válido (HTTP ${resp.status}).`);
    }
  }
  if (!resp.ok || !data) {
    console.error(`[login:${nomeLogico}] falha no login. Corpo (redigido): ${data ? redigirSegredos(JSON.stringify(data)) : '(corpo vazio)'}`);
    throw new Error(`Falha no login de ${nomeLogico} (HTTP ${resp.status}).`);
  }
  console.log(`[login:${nomeLogico}] HTTP ${resp.status} OK, user_id=${data.user?.id}`);
  return data;
}

async function chamarCriarNovaEmpresa(accessTokenOuNull, params) {
  const headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (accessTokenOuNull) headers.Authorization = `Bearer ${accessTokenOuNull}`;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/criar_nova_empresa_com_vinculo`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const raw = await resp.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch (e) { data = raw; } }
  return { status: resp.status, data };
}

async function empresaVisivelPara(accessTokenOuNull, empresaId) {
  const headers = { apikey: SUPABASE_ANON_KEY };
  if (accessTokenOuNull) headers.Authorization = `Bearer ${accessTokenOuNull}`;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/empresas?id=eq.${empresaId}&select=id`, { headers });
  const raw = await resp.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch (e) { data = raw; } }
  return { status: resp.status, data };
}

async function verificarAusencia(rotulo, accessTokenOuNull, empresaId) {
  const r = await empresaVisivelPara(accessTokenOuNull, empresaId);
  const vazio = r.status === 200 && Array.isArray(r.data) && r.data.length === 0;
  console.log(`   [verificação ${rotulo}] HTTP ${r.status} ${JSON.stringify(r.data)}`);
  reportar(`VERIF-${rotulo}`, vazio, vazio ? 'nada visível (esperado)' : `resposta inesperada: ${JSON.stringify(r.data)}`);
}

async function lerEstadoEmpresaA(accessToken, usuarioId) {
  const headersCount = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, Prefer: 'count=exact' };
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` };

  const respEmpresasCount = await fetch(`${SUPABASE_URL}/rest/v1/empresas?select=id`, { headers: headersCount });
  const totalEmpresas = respEmpresasCount.headers.get('content-range');

  const respVinculosCount = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_empresas?select=id`, { headers: headersCount });
  const totalVinculos = respVinculosCount.headers.get('content-range');

  const respEmpresaA = await fetch(`${SUPABASE_URL}/rest/v1/empresas?id=eq.${EMPRESA_A}&select=id,nome,cnpj,telefone,owner_id,plano,status_assinatura`, { headers });
  const empresaA = await respEmpresaA.json();

  const respVinculoProp = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios_empresas?empresa_id=eq.${EMPRESA_A}&usuario_id=eq.${usuarioId}&papel=eq.proprietario&select=id,empresa_id,usuario_id,papel,ativo,criado_em`,
    { headers }
  );
  const vinculoProp = await respVinculoProp.json();

  return {
    totalEmpresasContentRange: totalEmpresas,
    totalVinculosContentRange: totalVinculos,
    empresaA: empresaA[0] || null,
    vinculoProp: vinculoProp[0] || null,
  };
}

async function main() {
  console.log('== Login das contas necessárias ==');
  const prop = await login('PROP_A (proprietario)', EMAIL_PROPRIETARIO, SENHA_QA);
  const admin = await login('ADMIN_A (admin)', EMAIL_ADMIN, SENHA_QA);
  const usuario = await login('USUARIO_A (usuario)', EMAIL_USUARIO, SENHA_QA);
  const livre = await login('LIVRE (gerente, vínculo inativo)', EMAIL_PROPRIETARIO_ANTIGO, SENHA_PROPRIETARIO_ANTIGO);

  // ---------- Bloco A: 7 testes negativos ----------

  const uuid1 = crypto.randomUUID();
  const uuid2 = crypto.randomUUID();
  const uuid3 = crypto.randomUUID();
  const uuid4 = crypto.randomUUID();
  const uuid5 = crypto.randomUUID();
  const uuid6 = crypto.randomUUID();
  const uuid7 = crypto.randomUUID();
  const todosUuids = [
    ['ADMIN', admin.access_token, uuid1],
    ['USUARIO', usuario.access_token, uuid2],
    ['LIVRE', livre.access_token, uuid3],
    ['PROP-ISO', prop.access_token, uuid4],
    ['PROP-NULL', prop.access_token, uuid5],
    ['PROP-OMIT', prop.access_token, uuid6],
    ['ANON', null, uuid7],
  ];

  console.log('\n== Verificação "antes" — nenhum dos 7 UUIDs novos deve ser visível para ninguém ==');
  for (const [rotulo, token, id] of todosUuids) {
    await verificarAusencia('ANTES-' + rotulo, token, id);
  }

  console.log('\n== #1 CRIA-NEG-01: ADMIN_A, origem = Empresa A (esperado: TRQ15) ==');
  const t1 = await chamarCriarNovaEmpresa(admin.access_token, {
    p_empresa_id: uuid1, p_nome_empresa: NOME_DESCARTAVEL + ' 1', p_cnpj_empresa: null, p_telefone_empresa: null,
    p_empresa_origem_id: EMPRESA_A,
  });
  console.log('HTTP', t1.status, JSON.stringify(t1.data));
  reportar('CRIA-NEG-01', t1.status >= 400 && t1.data && t1.data.code === 'TRQ15', `code=${t1.data && t1.data.code}`);

  console.log('\n== #2 CRIA-NEG-02: USUARIO_A, origem = Empresa A (esperado: TRQ15) ==');
  const t2 = await chamarCriarNovaEmpresa(usuario.access_token, {
    p_empresa_id: uuid2, p_nome_empresa: NOME_DESCARTAVEL + ' 2', p_cnpj_empresa: null, p_telefone_empresa: null,
    p_empresa_origem_id: EMPRESA_A,
  });
  console.log('HTTP', t2.status, JSON.stringify(t2.data));
  reportar('CRIA-NEG-02', t2.status >= 400 && t2.data && t2.data.code === 'TRQ15', `code=${t2.data && t2.data.code}`);

  console.log('\n== #3 CRIA-NEG-03: LIVRE (gerente, vínculo INATIVO), origem = Empresa A (esperado: TRQ15) ==');
  const t3 = await chamarCriarNovaEmpresa(livre.access_token, {
    p_empresa_id: uuid3, p_nome_empresa: NOME_DESCARTAVEL + ' 3', p_cnpj_empresa: null, p_telefone_empresa: null,
    p_empresa_origem_id: EMPRESA_A,
  });
  console.log('HTTP', t3.status, JSON.stringify(t3.data));
  reportar('CRIA-NEG-03', t3.status >= 400 && t3.data && t3.data.code === 'TRQ15', `code=${t3.data && t3.data.code}`);

  console.log('\n== #4 CRIA-NEG-04 (isolamento): PROP_A, origem = Empresa B — onde não é proprietário (esperado: TRQ15) ==');
  const t4 = await chamarCriarNovaEmpresa(prop.access_token, {
    p_empresa_id: uuid4, p_nome_empresa: NOME_DESCARTAVEL + ' 4', p_cnpj_empresa: null, p_telefone_empresa: null,
    p_empresa_origem_id: EMPRESA_B,
  });
  console.log('HTTP', t4.status, JSON.stringify(t4.data));
  reportar('CRIA-NEG-04', t4.status >= 400 && t4.data && t4.data.code === 'TRQ15', `code=${t4.data && t4.data.code}`);

  console.log('\n== #5 CRIA-NEG-05: PROP_A, p_empresa_origem_id = null explícito (esperado: TRQ14) ==');
  const t5 = await chamarCriarNovaEmpresa(prop.access_token, {
    p_empresa_id: uuid5, p_nome_empresa: NOME_DESCARTAVEL + ' 5', p_cnpj_empresa: null, p_telefone_empresa: null,
    p_empresa_origem_id: null,
  });
  console.log('HTTP', t5.status, JSON.stringify(t5.data));
  reportar('CRIA-NEG-05', t5.status >= 400 && t5.data && t5.data.code === 'TRQ14', `code=${t5.data && t5.data.code}`);

  console.log('\n== #6 CRIA-NEG-06: PROP_A, omitindo p_empresa_origem_id (simula assinatura antiga, esperado: TRQ14) ==');
  const t6 = await chamarCriarNovaEmpresa(prop.access_token, {
    p_empresa_id: uuid6, p_nome_empresa: NOME_DESCARTAVEL + ' 6', p_cnpj_empresa: null, p_telefone_empresa: null,
    // p_empresa_origem_id OMITIDO de propósito
  });
  console.log('HTTP', t6.status, JSON.stringify(t6.data));
  reportar('CRIA-NEG-06', t6.status >= 400 && t6.data && t6.data.code === 'TRQ14', `code=${t6.data && t6.data.code}`);

  console.log('\n== #7 CRIA-NEG-07: chamada anônima, origem = Empresa A (esperado: HTTP 401/42501) ==');
  const t7 = await chamarCriarNovaEmpresa(null, {
    p_empresa_id: uuid7, p_nome_empresa: NOME_DESCARTAVEL + ' 7', p_cnpj_empresa: null, p_telefone_empresa: null,
    p_empresa_origem_id: EMPRESA_A,
  });
  console.log('HTTP', t7.status, JSON.stringify(t7.data));
  reportar('CRIA-NEG-07', t7.status === 401 && t7.data && t7.data.code === '42501', `HTTP ${t7.status}, code=${t7.data && t7.data.code}`);

  console.log('\n== Verificação "depois" — nenhum dos 7 UUIDs deve ter sido criado ==');
  for (const [rotulo, token, id] of todosUuids) {
    await verificarAusencia('DEPOIS-' + rotulo, token, id);
  }

  // ---------- Bloco B: teste positivo (replay idempotente) ----------

  console.log('\n== #8 CRIA-REPLAY-01: PROP_A, replay idempotente com Empresa A (própria, existente) ==');
  const estadoAntes = await lerEstadoEmpresaA(prop.access_token, prop.user.id);
  console.log('Estado antes:', JSON.stringify(estadoAntes));

  if (!estadoAntes.empresaA) throw new Error('Empresa A não encontrada/visível para PROP_A - abortando sem chamar a RPC.');
  if (!estadoAntes.vinculoProp || estadoAntes.vinculoProp.ativo !== true) {
    throw new Error('PROP_A não tem vínculo proprietario ATIVO confirmado na Empresa A - abortando sem chamar a RPC.');
  }

  const paramsReplay = {
    p_empresa_id: EMPRESA_A,
    p_nome_empresa: 'NOME DIFERENTE - NAO DEVE SER GRAVADO (teste replay)',
    p_cnpj_empresa: '00.000.000/0000-00',
    p_telefone_empresa: '(00) 00000-0000',
    p_empresa_origem_id: EMPRESA_A,
  };
  const t8 = await chamarCriarNovaEmpresa(prop.access_token, paramsReplay);
  console.log('HTTP', t8.status, JSON.stringify(t8.data));
  const resultado8 = Array.isArray(t8.data) ? t8.data[0] : t8.data;

  reportar('CRIA-REPLAY-01-HTTP200', t8.status === 200, `HTTP ${t8.status}`);
  reportar('CRIA-REPLAY-01-MESMA-EMPRESA', resultado8 && resultado8.empresa_id === EMPRESA_A, `empresa_id=${resultado8 && resultado8.empresa_id}`);
  reportar('CRIA-REPLAY-01-MESMO-VINCULO', resultado8 && resultado8.vinculo_id === estadoAntes.vinculoProp.id, `vinculo_id=${resultado8 && resultado8.vinculo_id}`);
  reportar('CRIA-REPLAY-01-CRIADA-AGORA-FALSE', resultado8 && resultado8.criada_agora === false, `criada_agora=${resultado8 && resultado8.criada_agora}`);
  reportar('CRIA-REPLAY-01-NOME-NAO-SUBSTITUIDO', resultado8 && resultado8.empresa_nome === estadoAntes.empresaA.nome, `retornado="${resultado8 && resultado8.empresa_nome}"`);
  reportar('CRIA-REPLAY-01-CNPJ-NAO-SUBSTITUIDO', resultado8 && resultado8.empresa_cnpj === estadoAntes.empresaA.cnpj, `retornado="${resultado8 && resultado8.empresa_cnpj}"`);
  reportar('CRIA-REPLAY-01-TELEFONE-NAO-SUBSTITUIDO', resultado8 && resultado8.empresa_telefone === estadoAntes.empresaA.telefone, `retornado="${resultado8 && resultado8.empresa_telefone}"`);

  const estadoDepois = await lerEstadoEmpresaA(prop.access_token, prop.user.id);
  console.log('Estado depois:', JSON.stringify(estadoDepois));

  reportar('CRIA-REPLAY-01-TOTAL-EMPRESAS-IGUAL', estadoAntes.totalEmpresasContentRange === estadoDepois.totalEmpresasContentRange, `antes=${estadoAntes.totalEmpresasContentRange} depois=${estadoDepois.totalEmpresasContentRange}`);
  reportar('CRIA-REPLAY-01-TOTAL-VINCULOS-IGUAL', estadoAntes.totalVinculosContentRange === estadoDepois.totalVinculosContentRange, `antes=${estadoAntes.totalVinculosContentRange} depois=${estadoDepois.totalVinculosContentRange}`);
  reportar('CRIA-REPLAY-01-EMPRESA-A-INALTERADA', JSON.stringify(estadoAntes.empresaA) === JSON.stringify(estadoDepois.empresaA), 'nome/cnpj/telefone/owner/plano/status idênticos');
  reportar('CRIA-REPLAY-01-VINCULO-INALTERADO', JSON.stringify(estadoAntes.vinculoProp) === JSON.stringify(estadoDepois.vinculoProp), 'vínculo proprietário idêntico (mesmo id, mesmo criado_em)');

  console.log(`\n== RESULTADO: ${falhas === 0 ? 'TODOS OS 8 TESTES PASSARAM' : falhas + ' TESTE(S)/VERIFICAÇÃO(ÕES) FALHARAM'} ==`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Erro inesperado:', redigirSegredos(e.message));
  process.exit(1);
});
