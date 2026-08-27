// QA Fase 2.5.3 (fornecedores) - teste adicional de VÍNCULO CRUZADO ENTRE EMPRESAS.
// PREPARADO, AINDA NÃO EXECUTADO (ver STATUS.md).
//
// Este teste é diferente dos anteriores: não testa se um usuário consegue ACESSAR
// diretamente um registro de outra empresa (isso já é coberto por *-05-isolamento.js).
// Testa se é possível criar um VÍNCULO indireto entre empresas através de uma
// foreign key: uma peça da Empresa A pode referenciar (pecas.fornecedor_id) um
// fornecedor que pertence à Empresa B?
//
// A tabela pecas não tem nenhuma restrição visível (CHECK/trigger) que obrigue
// fornecedor_id a pertencer à mesma empresa_id da peça - só uma FK simples pra
// fornecedores.id. As policies de RLS de pecas e fornecedores são independentes
// (cada uma olha só o empresa_id da própria linha). Este script verifica na prática:
//
//  1) Login como sem_vinculo (proprietário da Empresa B) e cria um fornecedor na B.
//  2) Login como o papel informado (Empresa A) e tenta criar/atualizar uma peça da
//     Empresa A com fornecedor_id apontando pro fornecedor da B.
//  3) Se o passo 2 for permitido pelo banco (RLS de pecas só valida empresa_id da
//     própria peça, não teria motivo pra bloquear), reporta como vínculo cruzado
//     CRIADO - isso não é necessariamente uma falha de RLS (o dado da B continua
//     protegido pela RLS de fornecedores), mas é uma questão de integridade
//     referencial que pode merecer um CHECK/trigger dedicado.
//  4) Testa se esse vínculo cruzado causa QUALQUER vazamento de dado da Empresa B
//     pro usuário da Empresa A:
//     4a) leitura direta do fornecedor da B pelo id (deve continuar bloqueada);
//     4b) leitura da peça com embed do fornecedor via PostgREST
//         (?select=*,fornecedores(*)) - o embed deve vir vazio/null se a RLS de
//         fornecedores estiver corretamente aplicada também dentro do embed.
//
// Rodar (exemplo, papel proprietario da Empresa A tentando o vínculo cruzado):
//   SUPABASE_TEST_EMAIL=<e-mail do proprietario> node --env-file=qa/.env qa/fase-2.5/scripts/fornecedores-06-vinculo-cruzado.js
//
// Variável opcional: FORNECEDOR_B_ID=<uuid> para reusar um fornecedor da Empresa B
// já criado em vez de criar um novo a cada execução.

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B

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
  let fornecedorBId = process.env.FORNECEDOR_B_ID;

  if (!email || !password) {
    console.error('Defina SUPABASE_TEST_EMAIL e SUPABASE_TEST_PASSWORD (papel da Empresa A a testar).');
    process.exit(1);
  }

  // Passo 1: garantir um fornecedor na Empresa B (dono: sem_vinculo).
  if (!fornecedorBId) {
    console.log('\n== 1) Login como sem_vinculo (proprietário da Empresa B) - criar fornecedor de teste na B ==');
    const donoB = await login(EMAIL_SEM_VINCULO, SENHA_QA);
    const criaResp = await fetch(`${SUPABASE_URL}/rest/v1/fornecedores`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${donoB.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        empresa_id: EMPRESA_B,
        nome: '[TESTE] QA Fase 2.5.3 - Fornecedor da Empresa B',
        telefone: '11911112222',
        ganha_margem: true,
      }),
    });
    const criaData = await criaResp.json();
    console.log('HTTP status:', criaResp.status, JSON.stringify(criaData, null, 2));
    if (!criaResp.ok || !Array.isArray(criaData) || criaData.length === 0) {
      console.error('\nNão foi possível criar o fornecedor de teste na Empresa B - abortando.');
      process.exit(1);
    }
    fornecedorBId = criaData[0].id;
  } else {
    console.log(`\n== 1) Reusando fornecedor da Empresa B já existente: ${fornecedorBId} ==`);
  }

  // Passo 2: login como o papel da Empresa A e tentar o vínculo cruzado.
  console.log(`\n== 2) Login: ${email} (Empresa A) - tentar criar peça em A com fornecedor_id da B ==`);
  const loginA = await login(email, password);
  console.log('Login OK. user_id =', loginA.user?.id);

  const insResp = await fetch(`${SUPABASE_URL}/rest/v1/pecas`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginA.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_A,
      nome: '[TESTE] QA Fase 2.5.3 - Peça com fornecedor cruzado',
      qtd: 1,
      estoque_minimo: 0,
      custo: 1,
      preco: 1,
      fornecedor_id: fornecedorBId,
    }),
  });
  const insData = await insResp.json();
  console.log('HTTP status:', insResp.status);
  console.log('Resposta:', JSON.stringify(insData, null, 2));

  const vinculoCriado = insResp.ok && Array.isArray(insData) && insData.length > 0;
  if (vinculoCriado) {
    console.log('\n⚠️ VÍNCULO CRUZADO CRIADO: peça da Empresa A foi salva com fornecedor_id de um fornecedor da Empresa B.');
    console.log('   (Isso não é necessariamente uma falha de RLS - ver passo 4 abaixo sobre vazamento de dado.)');
  } else {
    console.log('\n✅ Vínculo cruzado bloqueado - não foi possível salvar a peça com fornecedor_id de outra empresa.');
    return;
  }

  const pecaId = insData[0].id;

  // Passo 3: o usuário da A consegue ler o fornecedor da B diretamente pelo id?
  console.log('\n== 3) SELECT direto do fornecedor da Empresa B pelo id (deve continuar bloqueado) ==');
  const selFornResp = await fetch(`${SUPABASE_URL}/rest/v1/fornecedores?id=eq.${fornecedorBId}&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${loginA.access_token}` },
  });
  const selFornData = await selFornResp.json();
  console.log('HTTP status:', selFornResp.status, '| registros:', Array.isArray(selFornData) ? selFornData.length : selFornData);

  // Passo 4: a peça, lida com embed do fornecedor via PostgREST, vaza dado da B?
  console.log('\n== 4) SELECT da peça com embed do fornecedor (?select=*,fornecedores(*)) ==');
  const embedResp = await fetch(
    `${SUPABASE_URL}/rest/v1/pecas?id=eq.${pecaId}&select=*,fornecedores(*)`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${loginA.access_token}` } }
  );
  const embedData = await embedResp.json();
  console.log('HTTP status:', embedResp.status);
  console.log('Resposta:', JSON.stringify(embedData, null, 2));

  const embedVazou = embedResp.ok && Array.isArray(embedData) && embedData[0] &&
    embedData[0].fornecedores && (Array.isArray(embedData[0].fornecedores) ? embedData[0].fornecedores.length > 0 : true);

  console.log('\n== RESUMO ==');
  console.log('- Vínculo cruzado (peça A -> fornecedor B) permitido pelo banco:', vinculoCriado);
  console.log('- Leitura direta do fornecedor da B bloqueada:', Array.isArray(selFornData) ? selFornData.length === 0 : 'ver resposta acima');
  console.log('- Embed do fornecedor na peça vazou dado da B:', embedVazou, embedVazou ? '🚨 FALHA - dado de outra empresa exposto via embed' : '✅ embed vazio/nulo, RLS de fornecedores respeitada mesmo dentro do embed');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
