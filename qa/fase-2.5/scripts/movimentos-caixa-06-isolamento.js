// QA Fase 2.5.5 (movimentos_caixa) - teste dedicado de isolamento entre empresas.
// EXECUTADO E APROVADO EM 26/08/2026 (ver STATUS.md).
//
// Diferente das fases anteriores (onde o teste de isolamento usava a conta admin),
// aqui só proprietario tem qualquer policy de SELECT/INSERT irrestrito por tipo, então
// o teste roda com a conta proprietario da Empresa A.
//
// 0) Pré-condições (validadas por consulta autenticada a usuarios_empresas).
//    Observação: proprietarios podem visualizar outros vínculos da própria empresa;
//    por isso a consulta precisa filtrar explicitamente usuario_id e empresa_id -
//    não basta filtrar só por empresa_id, senão a resposta pode incluir vínculos de
//    outras contas da mesma empresa, não só o próprio.
//    - <e-mail do proprietario> tem vínculo ativo como proprietario na Empresa A;
//    - <e-mail do proprietario> NÃO tem vínculo nenhum na Empresa B;
//    - <e-mail do sem_vinculo> tem vínculo ativo como proprietario na Empresa B.
//    Se qualquer uma falhar, o script aborta antes do SELECT e do INSERT do teste.
//
// 1) SELECT nos movimentos_caixa da Empresa B (esperado: 0 linhas - proprietario da A
//    não é proprietario da B, então a policy caixa_select_proprietario não valida).
// 2) INSERT de uma movimentação com empresa_id = Empresa B (esperado: bloqueado pelo
//    WITH CHECK de caixa_insert_proprietario - HTTP 403, código 42501).
// 3) Confirmação independente via sem_vinculo (proprietario real da Empresa B) de que
//    nada foi criado com a descrição marcadora deste teste - feita SEMPRE, independente
//    do HTTP do INSERT. Se encontrar algo, o script NÃO exclui nada automaticamente -
//    só reporta o id e encerra com erro para análise manual.
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-06-isolamento.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B
const DESCRICAO_MARCADORA = '[TESTE] QA Fase 2.5.5 - isolamento (nao deveria ser criado)';

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function login(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error('Falha no login:', data);
    process.exit(1);
  }
  return data;
}

// Proprietarios podem visualizar outros vínculos da própria empresa via RLS - por
// isso é preciso filtrar explicitamente por usuario_id E empresa_id, não só por
// empresa_id, para isolar a linha do próprio usuário autenticado. Coluna confirmada:
// usuarios_empresas.usuario_id.
async function vinculoEm(accessToken, usuarioId, empresaId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios_empresas?usuario_id=eq.${usuarioId}&empresa_id=eq.${empresaId}&select=usuario_id,empresa_id,papel,ativo`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } }
  );
  const data = await resp.json();
  return { status: resp.status, data };
}

async function main() {
  console.log('\n== Login: <e-mail do proprietario> (proprietario, esperado só na Empresa A) ==');
  const loginProp = await login(EMAIL_PROPRIETARIO, SENHA_QA);
  console.log('Login OK. user_id =', loginProp.user?.id);

  console.log('\n== Login: <e-mail do sem_vinculo> (esperado proprietario real da Empresa B) ==');
  const loginB = await login(EMAIL_SEM_VINCULO, SENHA_QA);
  console.log('Login OK. user_id =', loginB.user?.id);

  console.log('\n== 0) Pré-condições (usuarios_empresas, filtradas por usuario_id + empresa_id) ==');

  const vinculoPropA = await vinculoEm(loginProp.access_token, loginProp.user.id, EMPRESA_A);
  console.log('proprietario x Empresa A:', vinculoPropA.status, JSON.stringify(vinculoPropA.data));
  const propAOk = vinculoPropA.status === 200
    && Array.isArray(vinculoPropA.data)
    && vinculoPropA.data.length === 1
    && vinculoPropA.data[0].papel === 'proprietario'
    && vinculoPropA.data[0].ativo === true;

  const vinculoPropB = await vinculoEm(loginProp.access_token, loginProp.user.id, EMPRESA_B);
  console.log('proprietario x Empresa B:', vinculoPropB.status, JSON.stringify(vinculoPropB.data));
  const propBOk = vinculoPropB.status === 200
    && Array.isArray(vinculoPropB.data)
    && vinculoPropB.data.length === 0;

  const vinculoBEmB = await vinculoEm(loginB.access_token, loginB.user.id, EMPRESA_B);
  console.log('sem_vinculo x Empresa B:', vinculoBEmB.status, JSON.stringify(vinculoBEmB.data));
  const bEmBOk = vinculoBEmB.status === 200
    && Array.isArray(vinculoBEmB.data)
    && vinculoBEmB.data.length === 1
    && vinculoBEmB.data[0].papel === 'proprietario'
    && vinculoBEmB.data[0].ativo === true;

  console.log(propAOk ? '✅ proprietario é proprietario ativo da Empresa A.' : '🚨 FALHA: proprietario NÃO confere como proprietario ativo da Empresa A.');
  console.log(propBOk ? '✅ proprietario não tem nenhum vínculo com a Empresa B.' : '🚨 FALHA: proprietario tem vínculo inesperado com a Empresa B.');
  console.log(bEmBOk ? '✅ sem_vinculo é proprietario ativo da Empresa B.' : '🚨 FALHA: sem_vinculo NÃO confere como proprietario ativo da Empresa B.');

  if (!propAOk || !propBOk || !bEmBOk) {
    console.error('\nAbortando antes do SELECT e do INSERT - pré-condição(ões) não confirmada(s).');
    process.exit(1);
  }

  console.log('\n== 1) SELECT movimentos_caixa da Empresa B como proprietario da A (deve retornar 0 linhas) ==');
  const selResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?empresa_id=eq.${EMPRESA_B}&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${loginProp.access_token}` },
  });
  const selData = await selResp.json();
  console.log('HTTP status:', selResp.status);
  console.log('Resposta:', JSON.stringify(selData, null, 2));
  const selOk = selResp.status === 200 && Array.isArray(selData) && selData.length === 0;
  console.log(selOk ? '✅ SELECT confirma isolamento: 0 registros visíveis na Empresa B.' : '🚨 FALHA: resposta inesperada no SELECT cruzado.');
  if (!selOk) {
    console.error('Encerrando com erro - SELECT cruzado não retornou exatamente 0 registros via HTTP 200.');
    process.exit(1);
  }

  console.log('\n== 2) INSERT de movimentação com empresa_id = Empresa B (deve ser bloqueado pelo WITH CHECK) ==');
  const insResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginProp.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_B,
      tipo: 'saida',
      categoria: 'outro',
      descricao: DESCRICAO_MARCADORA,
      valor: 1,
      data: hojeLocal(),
    }),
  });
  // return=minimal não devolve corpo em sucesso (201 vazio) - ler como texto e só
  // tentar JSON.parse se houver conteúdo (ex.: corpo de erro em bloqueio).
  const insRaw = await insResp.text();
  let insData = null;
  if (insRaw) {
    try { insData = JSON.parse(insRaw); } catch (e) { insData = insRaw; }
  }
  const insCodigo = insData && typeof insData === 'object' ? insData.code : undefined;
  console.log('HTTP status:', insResp.status);
  console.log('Código Postgres:', insCodigo || '(nenhum)');
  console.log('Resposta:', insRaw ? JSON.stringify(insData, null, 2) : '(corpo vazio)');
  const insBloqueado = insResp.status === 403 && insCodigo === '42501';
  console.log(insBloqueado
    ? '✅ Isolamento confirmado: INSERT na Empresa B bloqueado com HTTP 403/42501.'
    : '🚨 ATENÇÃO: INSERT na Empresa B não retornou o bloqueio esperado (HTTP 403/42501) - ver confirmação final abaixo.');

  console.log('\n== 3) Confirmação final via sem_vinculo (proprietario real da Empresa B) - sempre executada ==');
  const checkResp = await fetch(
    `${SUPABASE_URL}/rest/v1/movimentos_caixa?empresa_id=eq.${EMPRESA_B}&descricao=eq.${encodeURIComponent(DESCRICAO_MARCADORA)}&select=*`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${loginB.access_token}` } }
  );
  const checkData = await checkResp.json();
  console.log('HTTP status:', checkResp.status);
  console.log('Resposta:', JSON.stringify(checkData, null, 2));
  const confirmacaoOk = checkResp.status === 200 && Array.isArray(checkData) && checkData.length === 0;

  if (confirmacaoOk) {
    console.log('✅ Confirmado (via dona real da Empresa B): nenhuma movimentação com a descrição marcadora existe na Empresa B.');
  } else if (checkResp.status === 200 && Array.isArray(checkData) && checkData.length > 0) {
    console.error('\n🚨 REGISTRO INDEVIDO ENCONTRADO na Empresa B - NÃO excluído automaticamente. ID(s) para análise manual:');
    for (const r of checkData) { console.error(`- ${r.id}`); }
    process.exit(1);
  } else {
    console.error('\n🚨 Erro ao confirmar o estado da Empresa B (HTTP inesperado ou resposta fora do padrão) - encerrando com erro.');
    process.exit(1);
  }

  // O teste só passa se AMBAS as condições forem verdadeiras: o INSERT cruzado foi
  // bloqueado exatamente como esperado (403/42501) E a confirmação final (sempre
  // executada acima, independente do resultado do INSERT) não encontrou nada e não
  // teve erro de leitura.
  if (!insBloqueado || !confirmacaoOk) {
    console.error('🚨 Teste de isolamento não atendeu a todos os critérios esperados.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
