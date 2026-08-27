// QA Fase 2.5.3 (fornecedores) - teste dedicado de isolamento entre empresas.
// PREPARADO, AINDA NÃO EXECUTADO (ver STATUS.md).
// Login como admin da Empresa A e tenta:
//  1) SELECT nos fornecedores da Empresa B (esperado: 0 linhas)
//  2) INSERT de um fornecedor com empresa_id = Empresa B (esperado: bloqueado pelo WITH CHECK)
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/fornecedores-05-isolamento.js  (usa a conta admin fixa, já conhecida)

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B

async function main() {
  const email = EMAIL_ADMIN;
  const password = SENHA_QA;

  console.log(`\n== Login: ${email} (admin, vinculado só à Empresa A) ==`);
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
  const accessToken = loginData.access_token;
  console.log('Login OK. user_id =', loginData.user?.id);

  console.log('\n== 1) SELECT fornecedores da Empresa B (deve retornar 0 linhas) ==');
  const selResp = await fetch(`${SUPABASE_URL}/rest/v1/fornecedores?empresa_id=eq.${EMPRESA_B}&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const selData = await selResp.json();
  console.log('HTTP status:', selResp.status, '| registros:', Array.isArray(selData) ? selData.length : selData);

  console.log('\n== 2) INSERT de fornecedor com empresa_id = Empresa B (deve ser bloqueado pelo WITH CHECK) ==');
  const insResp = await fetch(`${SUPABASE_URL}/rest/v1/fornecedores`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_B,
      nome: '[TESTE] QA Fase 2.5.3 - isolamento (não deveria ser criado)',
      telefone: '11900000000',
      ganha_margem: true,
    }),
  });
  const insData = await insResp.json();
  console.log('HTTP status:', insResp.status);
  console.log('Resposta:', JSON.stringify(insData, null, 2));

  if (insResp.ok && Array.isArray(insData) && insData.length > 0) {
    console.log('\n🚨 FALHA DE ISOLAMENTO: admin da Empresa A conseguiu inserir fornecedor na Empresa B!');
  } else {
    console.log('\n✅ Isolamento confirmado: INSERT na Empresa B foi bloqueado.');
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
