// QA Fase 2.5.2 (pecas/estoque) - teste funcional de UPDATE (USING + WITH CHECK).
// Faz login real via Supabase Auth e tenta atualizar uma peça específica,
// validando "pecas_update_usuario_operador".
//
// Serve tanto para o teste normal de UPDATE (papel x pode/não pode alterar campos)
// quanto para o teste do WITH CHECK: passar PATCH_JSON='{"empresa_id":"<EMPRESA_B>"}'
// deve ser bloqueado para todo mundo (ninguém do teste tem vínculo operador na B
// a partir de uma peça que já é da A).
//
// Rodar (exemplo):
//   SUPABASE_TEST_EMAIL=<e-mail do usuario> \
//   TARGET_PECA_ID=<uuid> PATCH_JSON='{"qtd":20}' node --env-file=qa/.env qa/fase-2.5/scripts/pecas-04-update.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

async function main() {
  const email = process.env.SUPABASE_TEST_EMAIL;
  const password = process.env.SUPABASE_TEST_PASSWORD;
  const targetId = process.env.TARGET_PECA_ID;
  const patchJson = process.env.PATCH_JSON;

  if (!email || !password || !targetId || !patchJson) {
    console.error('Defina SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD, TARGET_PECA_ID e PATCH_JSON.');
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

  console.log(`\n== UPDATE pecas id=${targetId} com patch=${patchJson} ==`);
  const updateResp = await fetch(`${SUPABASE_URL}/rest/v1/pecas?id=eq.${targetId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginData.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: patchJson,
  });

  const updateData = await updateResp.json();
  console.log('HTTP status:', updateResp.status);
  console.log('Resposta:', JSON.stringify(updateData, null, 2));

  if (updateResp.ok && Array.isArray(updateData) && updateData.length > 0) {
    console.log('\n✅ UPDATE aplicado (linha afetada e retornada).');
  } else if (updateResp.ok && Array.isArray(updateData) && updateData.length === 0) {
    console.log('\n❌ UPDATE não afetou nenhuma linha (bloqueado pela policy USING/WITH CHECK, sem erro explícito).');
  } else {
    console.log('\n❌ UPDATE bloqueado (ver mensagem de erro acima).');
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
