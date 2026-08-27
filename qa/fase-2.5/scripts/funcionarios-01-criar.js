// QA Fase 2.5.4 (funcionarios) - teste funcional de INSERT.
// PREPARADO, AINDA NÃO EXECUTADO (ver STATUS.md).
// Faz login real via Supabase Auth e tenta criar um funcionário na Empresa A,
// validando a policy de INSERT de "funcionarios" (nomes exatos ainda não
// confirmados via SQL - ver investigação da Fase 2.5.4 no STATUS.md).
//
// Payload igual ao que o app real envia (script.js, handler #salvarFuncionarioBtn).
//
// Rodar (exemplo, papel proprietario):
//   SUPABASE_TEST_EMAIL=<e-mail do proprietario> node --env-file=qa/.env qa/fase-2.5/scripts/funcionarios-01-criar.js
//
// Esperado (matriz definida pelo usuário): proprietario / admin -> sucesso (201).
//                                            usuario / sem_vinculo -> bloqueado (RLS).
// Diferente de ordens_servico/pecas/fornecedores: aqui "usuario" NÃO pode inserir.

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_ID = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

async function main() {
  const email = process.env.SUPABASE_TEST_EMAIL;
  const password = process.env.SUPABASE_TEST_PASSWORD;
  const nome = process.env.NOME || '[TESTE] QA Fase 2.5.4 - Funcionário';

  if (!email || !password) {
    console.error('Defina SUPABASE_TEST_EMAIL e SUPABASE_TEST_PASSWORD antes de rodar.');
    process.exit(1);
  }

  console.log(`\n== Login: ${email} ==`);
  const loginResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginData = await loginResp.json();
  if (!loginResp.ok) {
    console.error('Falha no login:', loginData);
    process.exit(1);
  }
  console.log('Login OK. user_id =', loginData.user?.id);

  console.log('\n== INSERT em funcionarios (Empresa A) ==');
  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/funcionarios`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginData.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_ID,
      nome,
      cargo: 'Mecânico',
      telefone: '11977770000',
    }),
  });
  const insertData = await insertResp.json();
  console.log('HTTP status:', insertResp.status);
  console.log('Resposta:', JSON.stringify(insertData, null, 2));

  if (insertResp.ok && Array.isArray(insertData) && insertData.length > 0) {
    console.log('\n✅ INSERT aplicado. id =', insertData[0].id);
  } else {
    console.log('\n❌ INSERT bloqueado (ver mensagem de erro acima).');
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
