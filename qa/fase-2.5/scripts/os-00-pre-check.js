// QA Fase 2.5.1 (Ordens de Serviço) - PRE-CHECK somente leitura.
// Confirma que os fixtures permanentes da Fase 2.5 (recriados após a exclusão
// dos fixtures da Agenda) existem e estão ativos, e que não há OS de teste
// "sujando" a base antes de começar. Não faz INSERT/UPDATE/DELETE.
//
// Credenciais lidas de variáveis de ambiente (não ficam salvas no arquivo).
// Rodar: SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... node --env-file=qa/.env qa/fase-2.5/scripts/os-00-pre-check.js
// (aqui usamos direto as contas admin/sem-vinculo, que já são conhecidas)

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B
const CLIENTE_TESTE = 'c38d48b5-5ec8-4a31-8bf4-407bb6187155'; // [TESTE] Cliente QA Fase 2.5

const SENHA_TESTE = SENHA_QA;

async function login(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Falha no login ${email}: ${JSON.stringify(data)}`);
  return data;
}

async function query(token, path, label) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  console.log(`\n== ${label} (HTTP ${resp.status}) ==`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  const admin = await login(EMAIL_ADMIN, SENHA_TESTE);
  const semVinculo = await login(EMAIL_SEM_VINCULO, SENHA_TESTE);

  console.log('admin.user_id =', admin.user?.id);
  console.log('sem_vinculo.user_id =', semVinculo.user?.id);

  await query(admin.access_token, `empresas?id=eq.${EMPRESA_A}&select=*`, 'Empresa A (via admin)');
  await query(semVinculo.access_token, `empresas?id=eq.${EMPRESA_B}&select=*`, 'Empresa B (via sem vinculo, owner)');

  await query(admin.access_token, `usuarios_empresas?empresa_id=eq.${EMPRESA_A}&select=*&order=papel`, 'Vínculos ativos - Empresa A (esperado: proprietario, admin, usuario)');
  await query(semVinculo.access_token, `usuarios_empresas?empresa_id=eq.${EMPRESA_B}&select=*`, 'Vínculos ativos - Empresa B (esperado: proprietario = sem_vinculo)');

  await query(admin.access_token, `clientes?id=eq.${CLIENTE_TESTE}&select=*`, 'Cliente de teste (Empresa A)');

  await query(admin.access_token, `ordens_servico?empresa_id=eq.${EMPRESA_A}&select=id,descricao,status`, 'OS existentes - Empresa A (esperado: vazio antes do QA)');
  await query(semVinculo.access_token, `ordens_servico?empresa_id=eq.${EMPRESA_B}&select=id,descricao,status`, 'OS existentes - Empresa B (esperado: vazio antes do QA)');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
