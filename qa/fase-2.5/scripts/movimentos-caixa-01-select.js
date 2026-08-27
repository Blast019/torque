// QA Fase 2.5.5 (movimentos_caixa) - teste funcional de SELECT.
// EXECUTADO E APROVADO EM 26/08/2026 (ver STATUS.md).
//
// IMPORTANTE: este teste precisa de pelo menos uma movimentação já existente na
// Empresa A - assim o "0 registros" dos papéis bloqueados é conclusivo (bloqueio
// real), não ambíguo com "tabela vazia". Essa condição já foi atendida pelo
// script 03 (movimentos-caixa-03-insert-saida.js, executado e aprovado em
// 26/08/2026), que deixou 2 movimentações novas na Empresa A, além da
// preexistente. Não é necessário executar o script 02 antes deste.
//
// Esperado (policy caixa_select_proprietario): só proprietario enxerga alguma
// coisa. admin, usuario e sem_vinculo devem receber 0 registros (bloqueio
// silencioso via RLS - PostgREST responde 200 com array vazio, não 403).
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-01-select.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

const PAPEIS = [
  { nome: 'proprietario', email: EMAIL_PROPRIETARIO },
  { nome: 'admin', email: EMAIL_ADMIN },
  { nome: 'usuario', email: EMAIL_USUARIO },
  { nome: 'sem_vinculo', email: EMAIL_SEM_VINCULO },
];

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
  const resultados = [];
  for (const papel of PAPEIS) {
    console.log(`\n== Papel: ${papel.nome} (${papel.email}) ==`);
    const loginData = await login(papel.email, SENHA_QA);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?empresa_id=eq.${EMPRESA_A}&select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${loginData.access_token}` },
    });
    const respData = await resp.json();
    console.log('HTTP status:', resp.status);
    if (resp.ok) {
      console.log('Registros retornados:', respData.length);
      console.log(JSON.stringify(respData, null, 2));
    } else {
      console.log('Resposta:', JSON.stringify(respData, null, 2));
    }
    resultados.push({ papel: papel.nome, http: resp.status, registros: Array.isArray(respData) ? respData.length : null });
  }

  console.log('\n== RESUMO (SELECT Empresa A) ==');
  for (const r of resultados) {
    console.log(`- ${r.papel}: HTTP ${r.http}, ${r.registros} registro(s)`);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
