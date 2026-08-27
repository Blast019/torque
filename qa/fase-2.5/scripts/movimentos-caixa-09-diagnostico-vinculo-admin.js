// QA Fase 2.5.5 (movimentos_caixa) - diagnóstico da anomalia do INSERT tipo='saida' bloqueado para admin.
// Script de LEITURA APENAS: loga como admin e consulta usuarios_empresas com o próprio
// token autenticado, para confirmar se o vínculo (admin, Empresa A) é visível dentro
// da sessão RLS real. Não faz nenhum INSERT/UPDATE/DELETE.
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-09-diagnostico-vinculo-admin.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const ADMIN_EMAIL = EMAIL_ADMIN;
const ADMIN_SENHA = SENHA_QA;

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
  const loginData = await login(ADMIN_EMAIL, ADMIN_SENHA);
  const token = loginData.access_token;

  const vinculoResp = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios_empresas` +
    `?select=usuario_id,empresa_id,papel,ativo` +
    `&usuario_id=eq.59482850-db77-49ef-9bd1-e06ddce1e058` +
    `&empresa_id=eq.670162c6-3437-4cd5-b581-0229d57d33e2`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const vinculoData = await vinculoResp.json();

  console.log('Consulta autenticada do vínculo:');
  console.log('HTTP:', vinculoResp.status);
  console.log(JSON.stringify(vinculoData, null, 2));
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
