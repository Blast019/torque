// QA Fase 2.5.5 (movimentos_caixa) - teste funcional de INSERT tipo='saida'.
// PREPARADO — AINDA NÃO EXECUTADO. AGUARDANDO AUTORIZAÇÃO.
//
// Mesmo padrão do movimentos-caixa-02-insert-entrada.js, agora com tipo='saida'.
// Esperado (policies confirmadas): proprietario E admin conseguem (as duas policies
// de INSERT são permissivas, combinadas por OR). usuario e sem_vinculo continuam
// bloqueados (não há nenhuma policy que os contemple).
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-03-insert-saida.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

const PAPEIS = [
  { nome: 'proprietario', email: EMAIL_PROPRIETARIO },
  { nome: 'admin', email: EMAIL_ADMIN },
  { nome: 'usuario', email: EMAIL_USUARIO },
  { nome: 'sem_vinculo', email: EMAIL_SEM_VINCULO },
];

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
    const insResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${loginData.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        empresa_id: EMPRESA_A,
        tipo: 'saida',
        categoria: 'outro',
        descricao: `[TESTE] QA Fase 2.5.5 - saida por ${papel.nome}`,
        valor: 50,
        data: hojeLocal(),
      }),
    });
    // return=minimal não devolve corpo em sucesso (201 vazio) - ler como texto e só
    // tentar JSON.parse se houver conteúdo (ex.: corpo de erro em bloqueio).
    const rawBody = await insResp.text();
    let insData = null;
    if (rawBody) {
      try { insData = JSON.parse(rawBody); } catch (e) { insData = rawBody; }
    }
    console.log('HTTP status:', insResp.status);
    console.log('Resposta:', rawBody ? JSON.stringify(insData, null, 2) : '(corpo vazio)');
    // Classificação agora depende só do HTTP status, não de uma linha no corpo -
    // com return=minimal o sucesso (201) não traz o registro criado. A confirmação
    // definitiva de que a linha existe de fato continua sendo feita à parte, via
    // consulta independente pelo proprietario (único papel com SELECT nesta tabela),
    // mesmo critério já adotado para os bloqueios de UPDATE/DELETE.
    const criado = insResp.ok;
    resultados.push({ papel: papel.nome, http: insResp.status, criado, corpo: insData });
    console.log(criado ? `✅ Aceito pelo servidor (HTTP ${insResp.status}, sem corpo — confirmar existência real via proprietario).` : '❌ Bloqueado (ver mensagem acima).');
  }

  console.log('\n== RESUMO (INSERT tipo=saida) ==');
  for (const r of resultados) {
    console.log(`- ${r.papel}: HTTP ${r.http} -> ${r.criado ? 'ACEITO (confirmar via proprietario)' : 'BLOQUEADO'}`);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
