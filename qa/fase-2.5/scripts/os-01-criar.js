// QA Fase 2.5.1 (Ordens de Serviço) - teste funcional de INSERT.
// Faz login real via Supabase Auth e tenta criar uma OS na Empresa A,
// validando a policy "os_insert_usuario_operador" (WITH CHECK usuario_pode_operar_empresa).
//
// Payload igual ao que o app real envia (script.js, handler #salvarOSBtn).
// Credenciais lidas de variáveis de ambiente.
//
// Rodar (exemplo, papel proprietario):
//   SUPABASE_TEST_EMAIL=<e-mail do proprietario antigo> node --env-file=qa/.env qa/fase-2.5/scripts/os-01-criar.js
//
// Esperado: proprietario / admin / usuario -> sucesso (201, linha retornada).
//           sem_vinculo -> bloqueado (erro RLS, nenhuma linha).

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_ID = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const CLIENTE_ID = 'c38d48b5-5ec8-4a31-8bf4-407bb6187155'; // [TESTE] Cliente QA Fase 2.5

async function main() {
  const email = process.env.SUPABASE_TEST_EMAIL;
  const password = process.env.SUPABASE_TEST_PASSWORD;
  const descricao = process.env.DESCRICAO || '[TESTE] QA Fase 2.5.1 - OS';

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

  console.log('\n== INSERT em ordens_servico (Empresa A) ==');
  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginData.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_ID,
      cliente_id: CLIENTE_ID,
      veiculo_id: null,
      descricao,
      mao_de_obra: 0,
      garantia_maodeobra_dias: null,
      garantia_pecas_dias: null,
      funcionario_id: null,
      status: 'pendente',
      pago: false,
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
