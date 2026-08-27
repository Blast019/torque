// QA Fase 2.5.3 (fornecedores) - teste funcional de DELETE.
// PREPARADO, AINDA NÃO EXECUTADO (ver STATUS.md).
// Testa DELETE em fornecedores e depois verifica (com a conta admin) se o
// registro ainda existe, confirmando exclusão real ou bloqueio.
//
// Rodar:
//   SUPABASE_TEST_EMAIL=<e-mail do usuario> \
//   TARGET_FORNECEDOR_ID=<uuid> node --env-file=qa/.env qa/fase-2.5/scripts/fornecedores-04-delete.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

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
  const targetId = process.env.TARGET_FORNECEDOR_ID;

  if (!email || !password || !targetId) {
    console.error('Defina SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD e TARGET_FORNECEDOR_ID.');
    process.exit(1);
  }

  console.log(`\n== Login: ${email} ==`);
  const loginData = await login(email, password);
  console.log('Login OK. user_id =', loginData.user?.id);

  console.log(`\n== DELETE fornecedores id=${targetId} ==`);
  const delResp = await fetch(`${SUPABASE_URL}/rest/v1/fornecedores?id=eq.${targetId}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginData.access_token}`,
      Prefer: 'return=representation',
    },
  });
  let delData = null;
  try { delData = await delResp.json(); } catch (e) { /* corpo vazio */ }
  console.log('HTTP status:', delResp.status);
  console.log('Resposta:', JSON.stringify(delData, null, 2));

  const adminLogin = await login(EMAIL_ADMIN, SENHA_QA);
  const checkResp = await fetch(`${SUPABASE_URL}/rest/v1/fornecedores?id=eq.${targetId}&select=id,nome`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${adminLogin.access_token}` },
  });
  const checkData = await checkResp.json();

  console.log('\n== Verificação (via admin) ==');
  if (checkData.length === 0) {
    console.log('✅ Registro NÃO existe mais -> exclusão efetivada.');
  } else {
    console.log('⚠️ Registro AINDA existe -> exclusão não ocorreu.');
    console.log(JSON.stringify(checkData, null, 2));
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
