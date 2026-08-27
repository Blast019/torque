// QA Fase 2.5.5 (movimentos_caixa) - Passo 2 do plano de correção: reteste do
// vínculo cruzado via os_id, agora com a FK composta movimentos_caixa_os_mesma_
// empresa_fkey já criada (NOT VALID) pelo script 11.
//
// NÃO cria cliente nem OS - reutiliza a OS legítima da Empresa B já existente,
// criada pelo próprio script 07 (evidência da falha original).
//
// Esperado: o INSERT deve ser BLOQUEADO agora (HTTP 409, código 23503, citando o
// nome da FK composta) - diferente do resultado do script 07 (HTTP 201, aceito),
// porque a FK simples antiga foi substituída pela composta.
//
// A evidência antiga (70e22929-...) NÃO deve ser afetada - a FK composta foi
// criada NOT VALID, então não valida retroativamente linhas já existentes; ela
// continua existindo com o mesmo os_id de antes.
//
// EXECUTADO E APROVADO — FK COMPOSTA BLOQUEOU O VÍNCULO CRUZADO (ver STATUS.md).
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-12-fix-integridade-02-reteste-os.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const OS_B_ID = '133a218d-507f-4e22-830a-7600e813acf7'; // OS legítima da Empresa B, criada pelo script 07
const DESCRICAO_RETESTE = '[TESTE] QA Fase 2.5.5 - RETESTE FK composta os_id';
const NOME_CONSTRAINT = 'movimentos_caixa_os_mesma_empresa_fkey';
const EVIDENCIA_ANTIGA_ID = '70e22929-8220-4532-b946-29e34b032536';

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

async function consultar(accessToken, url) {
  const resp = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  return { status: resp.status, data };
}

async function main() {
  console.log('\n== Login: <e-mail do proprietario> (proprietario da Empresa A) ==');
  const loginA = await login(EMAIL_PROPRIETARIO, SENHA_QA);
  console.log('Login OK. user_id =', loginA.user?.id);

  console.log(`\n== 1) Tentar criar movimento na Empresa A com os_id da OS da Empresa B (${OS_B_ID}) ==`);
  const movResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginA.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_A,
      tipo: 'saida',
      categoria: 'os',
      descricao: DESCRICAO_RETESTE,
      valor: 10,
      data: hojeLocal(),
      os_id: OS_B_ID,
    }),
  });
  // return=minimal não devolve corpo em sucesso (201 vazio) - ler como texto e só
  // tentar JSON.parse se houver conteúdo (ex.: corpo de erro em bloqueio).
  const movRaw = await movResp.text();
  let movData = null;
  if (movRaw) {
    try { movData = JSON.parse(movRaw); } catch (e) { movData = movRaw; }
  }
  const movCodigo = movData && typeof movData === 'object' ? movData.code : undefined;
  const movMensagem = movData && typeof movData === 'object' ? `${movData.message || ''} ${movData.details || ''}` : '';
  console.log('HTTP status:', movResp.status);
  console.log('Código Postgres:', movCodigo || '(nenhum)');
  console.log('Resposta:', movRaw ? JSON.stringify(movData, null, 2) : '(corpo vazio)');

  const bloqueadoPelaFk = movResp.status === 409
    && movCodigo === '23503'
    && movMensagem.includes(NOME_CONSTRAINT);

  console.log(bloqueadoPelaFk
    ? `✅ Bloqueado como esperado: HTTP 409, código 23503, mensagem cita "${NOME_CONSTRAINT}".`
    : `🚨 FALHA: resultado não bate com o esperado (HTTP 409/23503 citando "${NOME_CONSTRAINT}").`);

  if (!bloqueadoPelaFk) {
    console.error('\nEncerrando com erro - a FK composta não bloqueou o vínculo cruzado como esperado.');
    process.exit(1);
  }

  console.log('\n== 2) SELECT independente (proprietario da A) pela descrição exata do reteste ==');
  const checkReteste = await consultar(
    loginA.access_token,
    `${SUPABASE_URL}/rest/v1/movimentos_caixa?empresa_id=eq.${EMPRESA_A}&descricao=eq.${encodeURIComponent(DESCRICAO_RETESTE)}&select=*`
  );
  console.log('HTTP status:', checkReteste.status);
  console.log('Resposta:', JSON.stringify(checkReteste.data, null, 2));
  const nadaCriado = checkReteste.status === 200 && Array.isArray(checkReteste.data) && checkReteste.data.length === 0;
  console.log(nadaCriado ? '✅ Confirmado: nenhum movimento foi criado com a descrição do reteste.' : '🚨 FALHA: encontrado (ou erro de leitura) para a descrição do reteste.');
  if (!nadaCriado) {
    console.error('\nEncerrando com erro - confirmação do bloqueio inconclusiva ou divergente.');
    process.exit(1);
  }

  console.log('\n== 3) Confirmar que a evidência antiga continua intacta ==');
  const checkEvidencia = await consultar(
    loginA.access_token,
    `${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${EVIDENCIA_ANTIGA_ID}&select=*`
  );
  console.log('HTTP status:', checkEvidencia.status);
  console.log('Resposta:', JSON.stringify(checkEvidencia.data, null, 2));
  const evidenciaOk = checkEvidencia.status === 200
    && Array.isArray(checkEvidencia.data)
    && checkEvidencia.data.length === 1
    && checkEvidencia.data[0].id === EVIDENCIA_ANTIGA_ID
    && checkEvidencia.data[0].os_id === OS_B_ID;
  console.log(evidenciaOk
    ? `✅ Evidência antiga (${EVIDENCIA_ANTIGA_ID}) continua existente, com os_id = ${OS_B_ID} intacto.`
    : '🚨 FALHA: a evidência antiga não confere (não existe mais, ou os_id mudou, ou leitura inconclusiva).');
  if (!evidenciaOk) {
    console.error('\nEncerrando com erro - estado da evidência antiga divergente do esperado.');
    process.exit(1);
  }

  console.log('\n== RESUMO ==');
  console.log('- FK composta bloqueou o novo vínculo cruzado (os_id):', bloqueadoPelaFk);
  console.log('- Nenhum registro novo criado com a descrição do reteste:', nadaCriado);
  console.log('- Evidência antiga preservada e intacta:', evidenciaOk);
  console.log('\nNOTA: nenhum dado foi criado, alterado ou excluído por este script - só o INSERT bloqueado (sem sucesso) e leituras.');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
