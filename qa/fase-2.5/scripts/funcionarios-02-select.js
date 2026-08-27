// QA Fase 2.5.4 (funcionarios) - teste funcional de SELECT + isolamento.
// PREPARADO, AINDA NÃO EXECUTADO (ver STATUS.md).
// Faz login real via Supabase Auth e consulta funcionarios tanto na Empresa A
// quanto na Empresa B, validando a policy de SELECT e o isolamento entre empresas.
//
// Rodar (exemplo, papel usuario):
//   SUPABASE_TEST_EMAIL=<e-mail do usuario> node --env-file=qa/.env qa/fase-2.5/scripts/funcionarios-02-select.js
//
// Esperado (matriz definida pelo usuário): proprietario / admin / usuario -> veem os
//   funcionários da Empresa A, e 0 linhas da Empresa B. sem_vinculo -> 0 linhas em ambas.
// (SELECT segue o mesmo padrão de ordens_servico/pecas/fornecedores: usuario TAMBÉM lê,
// mesmo não podendo escrever - diferente do padrão de INSERT/UPDATE/DELETE desta tabela.)

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B

async function main() {
  const email = process.env.SUPABASE_TEST_EMAIL;
  const password = process.env.SUPABASE_TEST_PASSWORD;

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
  const accessToken = loginData.access_token;
  console.log('Login OK. user_id =', loginData.user?.id);

  for (const [label, empresaId] of [['Empresa A', EMPRESA_A], ['Empresa B', EMPRESA_B]]) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/funcionarios?empresa_id=eq.${empresaId}&select=*`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } }
    );
    const respData = await resp.json();
    console.log(`\n== SELECT funcionarios - ${label} (HTTP ${resp.status}) ==`);
    if (resp.ok) {
      console.log(`Registros retornados: ${respData.length}`);
      console.log(JSON.stringify(respData, null, 2));
    } else {
      console.log('Resposta:', JSON.stringify(respData, null, 2));
    }
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
