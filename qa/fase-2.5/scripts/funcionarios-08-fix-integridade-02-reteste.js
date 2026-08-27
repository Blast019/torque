// QA Fase 2.5.4 (funcionarios) - reteste do vínculo cruzado APÓS a criação da FK
// composta (funcionarios-07-fix-integridade-01-add-constraint.sql).
// PREPARADO, AINDA NÃO EXECUTADO (ver STATUS.md).
//
// Objetivo: confirmar que, com a FK composta
// ordens_servico_funcionario_mesma_empresa_fkey já criada (ainda que NOT VALID), uma
// NOVA tentativa de vínculo cruzado (OS na Empresa A com funcionario_id de um
// funcionário da Empresa B) passa a ser BLOQUEADA pelo banco (esperado: HTTP 409,
// código 23503 - violação de foreign key).
//
// Reutiliza o funcionário de teste já existente na Empresa B (criado no
// funcionarios-06-vinculo-cruzado.js, 25/08/2026):
//   1d39ca25-eb60-4e87-a6a0-441d0e4d0475
//
// NÃO cria nenhum funcionário novo. NÃO altera a OS cruzada de teste já existente
// (4db4b201-a169-4a28-8da8-3b2139b0cf6b) - essa é resolvida separadamente, no passo 3
// do plano de correção (setar funcionario_id = NULL). NÃO toca na OS protegida da
// Fase 2.5.1 (97c2709a-8678-4322-a00c-d15129cd0708). NÃO faz nenhuma limpeza de dados.
//
// Pré-requisito: rodar antes o script
// funcionarios-07-fix-integridade-01-add-constraint.sql no SQL Editor do Supabase -
// sem a FK composta criada, este reteste vai reproduzir o mesmo resultado do teste 06
// (vínculo aceito), não o bloqueio esperado aqui.
//
// Rodar (exemplo, papel admin):
//   SUPABASE_TEST_EMAIL=<e-mail do admin> node --env-file=qa/.env qa/fase-2.5/scripts/funcionarios-08-fix-integridade-02-reteste.js
//
// Variável opcional: FUNCIONARIO_B_ID=<uuid> para usar outro funcionário da Empresa B
// em vez do criado no teste 06.

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const CLIENTE_TESTE_A = 'c38d48b5-5ec8-4a31-8bf4-407bb6187155'; // [TESTE] Cliente QA Fase 2.5 (Empresa A)
const FUNCIONARIO_B_PADRAO = '1d39ca25-eb60-4e87-a6a0-441d0e4d0475'; // funcionário de teste na Empresa B (criado no teste 06)
const DESCRICAO_MARCADORA = '[TESTE] QA Fase 2.5.4 - reteste FK composta apos passo 1 (deve ser bloqueado)';

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

async function main() {
  const email = process.env.SUPABASE_TEST_EMAIL;
  const password = process.env.SUPABASE_TEST_PASSWORD;
  const funcionarioBId = process.env.FUNCIONARIO_B_ID || FUNCIONARIO_B_PADRAO;

  if (!email || !password) {
    console.error('Defina SUPABASE_TEST_EMAIL e SUPABASE_TEST_PASSWORD (papel da Empresa A a testar).');
    process.exit(1);
  }

  console.log(`\n== Login: ${email} (Empresa A) ==`);
  const loginData = await login(email, password);
  console.log('Login OK. user_id =', loginData.user?.id);

  console.log(`\n== Tentando criar OS NOVA na Empresa A com funcionario_id da Empresa B (${funcionarioBId}) ==`);
  const insResp = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginData.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_A,
      cliente_id: CLIENTE_TESTE_A,
      veiculo_id: null,
      descricao: DESCRICAO_MARCADORA,
      mao_de_obra: 0,
      status: 'pendente',
      pago: false,
      funcionario_id: funcionarioBId,
    }),
  });
  const insData = await insResp.json();
  console.log('HTTP status:', insResp.status);
  console.log('Resposta:', JSON.stringify(insData, null, 2));

  const criouOs = insResp.ok && Array.isArray(insData) && insData.length > 0;

  const erroMencionaFkComposta = String(insData?.message || '').includes(
    'ordens_servico_funcionario_mesma_empresa_fkey'
  );

  const bloqueadoPelaFkComposta =
    !criouOs &&
    insResp.status === 409 &&
    insData?.code === '23503' &&
    erroMencionaFkComposta;

  if (criouOs) {
    console.log('\n🚨 FALHA: a OS foi criada mesmo com funcionario_id de outra empresa. id =', insData[0].id);
    console.log('   A FK composta NÃO bloqueou o vínculo cruzado - parar e investigar antes de prosseguir com o plano de correção.');
  } else if (bloqueadoPelaFkComposta) {
    console.log('\n✅ Vínculo cruzado bloqueado pela FK composta ordens_servico_funcionario_mesma_empresa_fkey (HTTP 409, código 23503), como esperado.');
  } else {
    console.log('\n⚠️ INCONCLUSIVO: a OS não foi criada, mas o bloqueio NÃO foi confirmado como vindo especificamente da FK composta ordens_servico_funcionario_mesma_empresa_fkey (HTTP', insResp.status, ', código', insData && insData.code, ', mensagem sem o nome da constraint esperada). Pode ser outra referência (ex.: cliente_id) ou outra causa - a causa real precisa ser investigada antes de considerar o passo 2 do plano validado.');
  }

  // Confirmação independente: nenhuma OS com a descrição marcadora deve existir.
  console.log('\n== Verificação (via admin): nenhuma OS com a descrição marcadora deve existir na Empresa A ==');
  const adminLogin = await login(EMAIL_ADMIN, SENHA_QA);
  const checkResp = await fetch(
    `${SUPABASE_URL}/rest/v1/ordens_servico?empresa_id=eq.${EMPRESA_A}&descricao=eq.${encodeURIComponent(DESCRICAO_MARCADORA)}&select=id,empresa_id,funcionario_id,descricao`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${adminLogin.access_token}` } }
  );
  const checkData = await checkResp.json();
  console.log('HTTP status:', checkResp.status, '| registros encontrados:', Array.isArray(checkData) ? checkData.length : checkData);
  if (Array.isArray(checkData) && checkData.length === 0) {
    console.log('✅ Confirmado: nenhuma OS nova foi criada com o vínculo cruzado.');
  } else {
    console.log('⚠️ ATENÇÃO: encontrada(s) OS com a descrição marcadora - revisar manualmente:');
    console.log(JSON.stringify(checkData, null, 2));
  }

  console.log('\nNOTA: este script não altera a OS cruzada de teste 4db4b201-a169-4a28-8da8-3b2139b0cf6b (resolvida separadamente no passo 3 do plano) nem a OS protegida 97c2709a-8678-4322-a00c-d15129cd0708 (Fase 2.5.1). Nenhuma limpeza de dados é feita por este script.');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
