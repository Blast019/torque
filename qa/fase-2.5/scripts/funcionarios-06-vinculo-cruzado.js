// QA Fase 2.5.4 (funcionarios) - teste adicional de VÍNCULO CRUZADO ENTRE EMPRESAS.
// PREPARADO, AINDA NÃO EXECUTADO (ver STATUS.md).
//
// Mesmo tipo de teste feito em 2.5.3 (fornecedores-06-vinculo-cruzado.js), agora pro
// par ordens_servico.funcionario_id -> funcionarios.id: uma OS da Empresa A pode
// referenciar (funcionario_id) um funcionário que pertence à Empresa B?
//
// Passos:
//  1) Login como sem_vinculo (proprietário da Empresa B) e cria um funcionário
//     LEGÍTIMO na B.
//  2) Login como o papel informado (Empresa A) e cria uma OS NOVA e EXCLUSIVA de
//     teste na Empresa A (NÃO reusa a OS remanescente 97c2709a-...) já com
//     funcionario_id apontando pro funcionário da B.
//  3) Se o passo 2 for permitido pelo banco, reporta como vínculo cruzado CRIADO.
//  4) Testa vazamento de dado:
//     4a) leitura direta do funcionário da B pelo id (deve continuar bloqueada
//         pela RLS de funcionarios, mesmo com o vínculo cruzado existindo);
//     4b) leitura da OS com embed do funcionário via PostgREST
//         (?select=*,funcionarios(*)) - deve vir vazio/null se a RLS de
//         funcionarios for aplicada corretamente também dentro do embed.
//  5) Registra todos os IDs criados.
//
// A OS de teste remanescente da Fase 2.5.1 (97c2709a-8678-4322-a00c-d15129cd0708)
// NÃO é tocada por este script - só é usada uma OS nova, criada aqui.
//
// Rodar (exemplo, papel proprietario da Empresa A tentando o vínculo cruzado):
//   SUPABASE_TEST_EMAIL=<e-mail do proprietario> node --env-file=qa/.env qa/fase-2.5/scripts/funcionarios-06-vinculo-cruzado.js
//
// Variável opcional: FUNCIONARIO_B_ID=<uuid> para reusar um funcionário da Empresa B
// já criado em vez de criar um novo a cada execução.

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B
const CLIENTE_TESTE_A = 'c38d48b5-5ec8-4a31-8bf4-407bb6187155'; // [TESTE] Cliente QA Fase 2.5 (Empresa A)

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
  let funcionarioBId = process.env.FUNCIONARIO_B_ID;

  if (!email || !password) {
    console.error('Defina SUPABASE_TEST_EMAIL e SUPABASE_TEST_PASSWORD (papel da Empresa A a testar).');
    process.exit(1);
  }

  // Passo 1: garantir um funcionário legítimo na Empresa B (dono: sem_vinculo).
  if (!funcionarioBId) {
    console.log('\n== 1) Login como sem_vinculo (proprietário da Empresa B) - criar funcionário legítimo na B ==');
    const donoB = await login(EMAIL_SEM_VINCULO, SENHA_QA);
    const criaResp = await fetch(`${SUPABASE_URL}/rest/v1/funcionarios`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${donoB.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        empresa_id: EMPRESA_B,
        nome: '[TESTE] QA Fase 2.5.4 - Funcionário da Empresa B',
        cargo: 'Mecânico',
        telefone: '11922223333',
      }),
    });
    const criaData = await criaResp.json();
    console.log('HTTP status:', criaResp.status, JSON.stringify(criaData, null, 2));
    if (!criaResp.ok || !Array.isArray(criaData) || criaData.length === 0) {
      console.error('\nNão foi possível criar o funcionário de teste na Empresa B - abortando.');
      process.exit(1);
    }
    funcionarioBId = criaData[0].id;
  } else {
    console.log(`\n== 1) Reusando funcionário da Empresa B já existente: ${funcionarioBId} ==`);
  }

  // Passo 2: login como o papel da Empresa A e criar uma OS NOVA já com o vínculo cruzado.
  console.log(`\n== 2) Login: ${email} (Empresa A) - criar OS NOVA em A com funcionario_id da B ==`);
  const loginA = await login(email, password);
  console.log('Login OK. user_id =', loginA.user?.id);

  const insResp = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginA.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_A,
      cliente_id: CLIENTE_TESTE_A,
      veiculo_id: null,
      descricao: '[TESTE] QA Fase 2.5.4 - OS com funcionário cruzado',
      mao_de_obra: 0,
      status: 'pendente',
      pago: false,
      funcionario_id: funcionarioBId,
    }),
  });
  const insData = await insResp.json();
  console.log('HTTP status:', insResp.status);
  console.log('Resposta:', JSON.stringify(insData, null, 2));

  const vinculoCriado = insResp.ok && Array.isArray(insData) && insData.length > 0;
  if (vinculoCriado) {
    console.log('\n⚠️ VÍNCULO CRUZADO CRIADO: OS nova da Empresa A foi salva com funcionario_id de um funcionário da Empresa B.');
    console.log('   (Isso não é necessariamente uma falha de RLS - ver passo 4 abaixo sobre vazamento de dado.)');
  } else {
    console.log('\n✅ Vínculo cruzado bloqueado - não foi possível salvar a OS com funcionario_id de outra empresa.');
    return;
  }

  const osId = insData[0].id;

  // Passo 3: o usuário da A consegue ler o funcionário da B diretamente pelo id?
  console.log('\n== 3) SELECT direto do funcionário da Empresa B pelo id (deve continuar bloqueado) ==');
  const selFuncResp = await fetch(`${SUPABASE_URL}/rest/v1/funcionarios?id=eq.${funcionarioBId}&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${loginA.access_token}` },
  });
  const selFuncData = await selFuncResp.json();
  console.log('HTTP status:', selFuncResp.status, '| registros:', Array.isArray(selFuncData) ? selFuncData.length : selFuncData);

  // Passo 4: a OS, lida com embed do funcionário via PostgREST, vaza dado da B?
  console.log('\n== 4) SELECT da OS com embed do funcionário (?select=*,funcionarios(*)) ==');
  const embedResp = await fetch(
    `${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${osId}&select=*,funcionarios(*)`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${loginA.access_token}` } }
  );
  const embedData = await embedResp.json();
  console.log('HTTP status:', embedResp.status);
  console.log('Resposta:', JSON.stringify(embedData, null, 2));

  const embedVazou = embedResp.ok && Array.isArray(embedData) && embedData[0] &&
    embedData[0].funcionarios && (Array.isArray(embedData[0].funcionarios) ? embedData[0].funcionarios.length > 0 : true);

  console.log('\n== RESUMO ==');
  console.log('- funcionário de teste criado na Empresa B:', funcionarioBId);
  console.log('- OS nova de teste criada na Empresa A:', osId);
  console.log('- Vínculo cruzado (OS A -> funcionário B) permitido pelo banco:', vinculoCriado);
  console.log('- Leitura direta do funcionário da B bloqueada:', Array.isArray(selFuncData) ? selFuncData.length === 0 : 'ver resposta acima');
  console.log('- Embed do funcionário na OS vazou dado da B:', embedVazou, embedVazou ? '🚨 FALHA - dado de outra empresa exposto via embed' : '✅ embed vazio/nulo, RLS de funcionarios respeitada mesmo dentro do embed');
  console.log('\nNOTA: a OS remanescente 97c2709a-8678-4322-a00c-d15129cd0708 (Fase 2.5.1) NÃO foi tocada por este script.');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
