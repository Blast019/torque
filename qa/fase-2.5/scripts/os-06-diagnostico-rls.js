// DIAGNÓSTICO somente leitura - por que Empresa A/B, vínculos e cliente de teste
// não apareceram no pre-check. Não faz INSERT/UPDATE/DELETE. Não cria nada.
//
// Testa padrões diferentes de consulta, com as 4 contas de teste conhecidas,
// para tentar separar "dado apagado" de "dado bloqueado por RLS":
//  - vínculo próprio (usuario_id = auth.uid()), igual ao check-vinculo-proprio.js da Agenda
//  - empresas por id, sem outro filtro
//  - empresas SEM filtro nenhum (ver se a conta enxerga QUALQUER empresa)
//  - usuarios_empresas SEM filtro (ver se a conta enxerga QUALQUER vínculo, inclusive o próprio)
//  - clientes por id e sem filtro

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '6b1c2475-32f7-474c-abac-5baa9b73fc59';
const EMPRESA_B = '57e7be22-ef43-4a65-bf24-f77fda0838ca';
const CLIENTE_TESTE = '02c61001-66c6-4ed0-a691-921510dd1a44';
const SENHA_TESTE = SENHA_QA;

const CONTAS = [
  { papel: 'proprietario', email: EMAIL_PROPRIETARIO_ANTIGO },
  { papel: 'admin', email: EMAIL_ADMIN },
  { papel: 'usuario', email: EMAIL_USUARIO },
  { papel: 'sem_vinculo', email: EMAIL_SEM_VINCULO },
];

async function login(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  return { ok: resp.ok, status: resp.status, data };
}

async function query(token, path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

async function main() {
  const tokens = {};

  for (const c of CONTAS) {
    const login1 = await login(c.email, SENHA_TESTE);
    console.log(`\n########## LOGIN ${c.papel} (${c.email}) ##########`);
    if (!login1.ok) {
      console.log('❌ LOGIN FALHOU:', JSON.stringify(login1.data));
      continue;
    }
    console.log('user_id =', login1.data.user?.id);
    tokens[c.papel] = { token: login1.data.access_token, userId: login1.data.user?.id };
  }

  for (const c of CONTAS) {
    const t = tokens[c.papel];
    if (!t) continue;
    console.log(`\n========== ${c.papel} (${c.email}) ==========`);

    const vinculoProprio = await query(t.token, `usuarios_empresas?usuario_id=eq.${t.userId}&select=*`);
    console.log(`[vínculo próprio, usuario_id=eq.${t.userId}] HTTP ${vinculoProprio.status}:`, JSON.stringify(vinculoProprio.data));

    const vinculosSemFiltro = await query(t.token, `usuarios_empresas?select=*&limit=5`);
    console.log(`[usuarios_empresas SEM filtro, limit 5] HTTP ${vinculosSemFiltro.status}:`, JSON.stringify(vinculosSemFiltro.data));

    const empresaA = await query(t.token, `empresas?id=eq.${EMPRESA_A}&select=*`);
    console.log(`[empresas id=Empresa A] HTTP ${empresaA.status}:`, JSON.stringify(empresaA.data));

    const empresaB = await query(t.token, `empresas?id=eq.${EMPRESA_B}&select=*`);
    console.log(`[empresas id=Empresa B] HTTP ${empresaB.status}:`, JSON.stringify(empresaB.data));

    const empresasSemFiltro = await query(t.token, `empresas?select=id,nome,owner_id&limit=5`);
    console.log(`[empresas SEM filtro, limit 5] HTTP ${empresasSemFiltro.status}:`, JSON.stringify(empresasSemFiltro.data));

    const clienteTeste = await query(t.token, `clientes?id=eq.${CLIENTE_TESTE}&select=*`);
    console.log(`[clientes id=cliente teste] HTTP ${clienteTeste.status}:`, JSON.stringify(clienteTeste.data));

    const clientesSemFiltro = await query(t.token, `clientes?select=id,nome,empresa_id&limit=5`);
    console.log(`[clientes SEM filtro, limit 5] HTTP ${clientesSemFiltro.status}:`, JSON.stringify(clientesSemFiltro.data));
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
