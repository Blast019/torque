// QA Fase 2.5.5 (movimentos_caixa) - teste de VÍNCULO CRUZADO via os_id.
// EXECUTADO EM 26/08/2026 — FALHA DE INTEGRIDADE CONFIRMADA (ver STATUS.md).
//
// Mesmo tipo de teste feito em 2.5.3 (fornecedores) e 2.5.4 (funcionarios), agora
// para movimentos_caixa.os_id -> ordens_servico.id. A FK confirmada via SQL é
// simples (movimentos_caixa_os_id_fkey, ON DELETE SET NULL), sem checar empresa_id.
//
// Passos:
//  0) Pré-condições (usuarios_empresas, filtro usuario_id + empresa_id - mesmo
//     padrão corrigido no script 06, já que proprietarios podem ver outros vínculos
//     da própria empresa):
//     - <e-mail do proprietario> é proprietario ativo da Empresa A;
//     - <e-mail do proprietario> NÃO tem vínculo na Empresa B;
//     - <e-mail do sem_vinculo> é proprietario ativo da Empresa B.
//     Aborta antes de qualquer INSERT se alguma falhar.
//  0b) Pré-checagem de duplicidade: busca pelas 3 descrições marcadoras (cliente,
//      OS, movimento) antes de criar qualquer dado. Aborta se algo já existir.
//  1) Login sem_vinculo (proprietario da Empresa B). Cria um cliente novo na B
//     (necessário pra poder criar uma OS) e depois uma OS legítima na B.
//  2) Login proprietario (Empresa A). Tenta criar uma movimentação NA EMPRESA A com
//     os_id apontando pra OS da Empresa B.
//  3) SELECT direto da OS da B pelo proprietario da A (deve continuar bloqueada pela
//     RLS de ordens_servico) - exigido sempre, HTTP 200 + [].
//  4) Se o vínculo cruzado foi aceito: SELECT da movimentação com embed
//     (?select=*,ordens_servico(*)) - deve vir null/vazio (RLS respeitada mesmo
//     dentro do embed). Não roda se o vínculo foi bloqueado (não há movimento).
//  5) Registra todos os IDs criados. NÃO cria UNIQUE, FK composta nem corrige nada,
//     e NÃO exclui nada - nenhuma limpeza automática.
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-07-vinculo-cruzado-os.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B

const DESCRICAO_CLIENTE = '[TESTE] QA Fase 2.5.5 - Cliente Empresa B (vinculo cruzado caixa)';
const DESCRICAO_OS = '[TESTE] QA Fase 2.5.5 - OS Empresa B (vinculo cruzado caixa)';
const DESCRICAO_MOVIMENTO = '[TESTE] QA Fase 2.5.5 - vinculo cruzado via os_id';

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

// Proprietarios podem visualizar outros vínculos da própria empresa via RLS - por
// isso é preciso filtrar explicitamente por usuario_id E empresa_id, não só por
// empresa_id (mesma correção aplicada no script 06). Coluna confirmada:
// usuarios_empresas.usuario_id.
async function vinculoEm(accessToken, usuarioId, empresaId) {
  return consultar(
    accessToken,
    `${SUPABASE_URL}/rest/v1/usuarios_empresas?usuario_id=eq.${usuarioId}&empresa_id=eq.${empresaId}&select=usuario_id,empresa_id,papel,ativo`
  );
}

async function main() {
  console.log('\n== Login: <e-mail do proprietario> (proprietario, esperado só na Empresa A) ==');
  const loginA = await login(EMAIL_PROPRIETARIO, SENHA_QA);
  console.log('Login OK. user_id =', loginA.user?.id);

  console.log('\n== Login: <e-mail do sem_vinculo> (esperado proprietario real da Empresa B) ==');
  const loginB = await login(EMAIL_SEM_VINCULO, SENHA_QA);
  console.log('Login OK. user_id =', loginB.user?.id);

  console.log('\n== 0) Pré-condições (usuarios_empresas, filtradas por usuario_id + empresa_id) ==');

  const vinculoAxA = await vinculoEm(loginA.access_token, loginA.user.id, EMPRESA_A);
  console.log('proprietario x Empresa A:', vinculoAxA.status, JSON.stringify(vinculoAxA.data));
  const aXAOk = vinculoAxA.status === 200
    && Array.isArray(vinculoAxA.data)
    && vinculoAxA.data.length === 1
    && vinculoAxA.data[0].papel === 'proprietario'
    && vinculoAxA.data[0].ativo === true;

  const vinculoAxB = await vinculoEm(loginA.access_token, loginA.user.id, EMPRESA_B);
  console.log('proprietario x Empresa B:', vinculoAxB.status, JSON.stringify(vinculoAxB.data));
  const aXBOk = vinculoAxB.status === 200 && Array.isArray(vinculoAxB.data) && vinculoAxB.data.length === 0;

  const vinculoBxB = await vinculoEm(loginB.access_token, loginB.user.id, EMPRESA_B);
  console.log('sem_vinculo x Empresa B:', vinculoBxB.status, JSON.stringify(vinculoBxB.data));
  const bXBOk = vinculoBxB.status === 200
    && Array.isArray(vinculoBxB.data)
    && vinculoBxB.data.length === 1
    && vinculoBxB.data[0].papel === 'proprietario'
    && vinculoBxB.data[0].ativo === true;

  console.log(aXAOk ? '✅ proprietario é proprietario ativo da Empresa A.' : '🚨 FALHA: proprietario NÃO confere como proprietario ativo da Empresa A.');
  console.log(aXBOk ? '✅ proprietario não tem nenhum vínculo com a Empresa B.' : '🚨 FALHA: proprietario tem vínculo inesperado com a Empresa B.');
  console.log(bXBOk ? '✅ sem_vinculo é proprietario ativo da Empresa B.' : '🚨 FALHA: sem_vinculo NÃO confere como proprietario ativo da Empresa B.');

  if (!aXAOk || !aXBOk || !bXBOk) {
    console.error('\nAbortando antes de qualquer INSERT - pré-condição(ões) não confirmada(s).');
    process.exit(1);
  }

  console.log('\n== 0b) Pré-checagem de duplicidade (descrições marcadoras) ==');

  const clienteExistente = await consultar(
    loginB.access_token,
    `${SUPABASE_URL}/rest/v1/clientes?empresa_id=eq.${EMPRESA_B}&nome=eq.${encodeURIComponent(DESCRICAO_CLIENTE)}&select=id,nome`
  );
  console.log('Cliente marcador (Empresa B):', clienteExistente.status, JSON.stringify(clienteExistente.data));

  const osExistente = await consultar(
    loginB.access_token,
    `${SUPABASE_URL}/rest/v1/ordens_servico?empresa_id=eq.${EMPRESA_B}&descricao=eq.${encodeURIComponent(DESCRICAO_OS)}&select=id,descricao`
  );
  console.log('OS marcadora (Empresa B):', osExistente.status, JSON.stringify(osExistente.data));

  const movimentoExistente = await consultar(
    loginA.access_token,
    `${SUPABASE_URL}/rest/v1/movimentos_caixa?empresa_id=eq.${EMPRESA_A}&descricao=eq.${encodeURIComponent(DESCRICAO_MOVIMENTO)}&select=id,descricao`
  );
  console.log('Movimento marcador (Empresa A):', movimentoExistente.status, JSON.stringify(movimentoExistente.data));

  const semDuplicidade = clienteExistente.status === 200 && Array.isArray(clienteExistente.data) && clienteExistente.data.length === 0
    && osExistente.status === 200 && Array.isArray(osExistente.data) && osExistente.data.length === 0
    && movimentoExistente.status === 200 && Array.isArray(movimentoExistente.data) && movimentoExistente.data.length === 0;

  console.log(semDuplicidade ? '✅ Nenhum registro marcador pré-existente.' : '🚨 FALHA: já existe registro com uma das descrições marcadoras.');
  if (!semDuplicidade) {
    console.error('\nAbortando antes de criar qualquer dado - risco de duplicidade.');
    process.exit(1);
  }

  // return=representation é intencional nos 3 INSERTs abaixo: as contas que criam
  // cada registro (sem_vinculo/dona da B para cliente e OS; proprietario/dono da A
  // para o movimento) sempre têm SELECT sobre a própria empresa, então não repete a
  // anomalia já vista com admin em movimentos_caixa - e os IDs retornados no corpo
  // são necessários para encadear as etapas seguintes (cliente_id, os_id, embed).

  console.log('\n== 1a) Criar cliente na Empresa B (sem_vinculo, dona da B) ==');
  const clienteResp = await fetch(`${SUPABASE_URL}/rest/v1/clientes`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginB.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_B,
      nome: DESCRICAO_CLIENTE,
      cpf: '',
      telefone: '',
      email: '',
    }),
  });
  const clienteData = await clienteResp.json();
  console.log('HTTP status:', clienteResp.status);
  console.log('Resposta:', JSON.stringify(clienteData, null, 2));
  const clienteOk = clienteResp.status === 201
    && Array.isArray(clienteData)
    && clienteData.length === 1
    && clienteData[0].empresa_id === EMPRESA_B;
  if (!clienteOk) {
    console.error('\n🚨 Falha ao criar/confirmar o cliente de teste na Empresa B - abortando.');
    process.exit(1);
  }
  const clienteBId = clienteData[0].id;
  console.log('✅ Cliente de teste criado e confirmado:', clienteBId);

  console.log('\n== 1b) Criar OS legítima na Empresa B (sem_vinculo, dona da B) ==');
  const osResp = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginB.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_B,
      cliente_id: clienteBId,
      veiculo_id: null,
      descricao: DESCRICAO_OS,
      mao_de_obra: 0,
      status: 'pendente',
      pago: false,
    }),
  });
  const osData = await osResp.json();
  console.log('HTTP status:', osResp.status);
  console.log('Resposta:', JSON.stringify(osData, null, 2));
  const osOk = osResp.status === 201
    && Array.isArray(osData)
    && osData.length === 1
    && osData[0].empresa_id === EMPRESA_B
    && osData[0].cliente_id === clienteBId;
  if (!osOk) {
    console.error('\n🚨 Falha ao criar/confirmar a OS de teste na Empresa B - abortando.');
    process.exit(1);
  }
  const osBId = osData[0].id;
  console.log('✅ OS de teste criada e confirmada:', osBId);

  console.log(`\n== 2) Login proprietario (Empresa A) - tentar criar movimentação com os_id da Empresa B (${osBId}) ==`);
  const movResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginA.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_A,
      tipo: 'saida',
      categoria: 'os',
      descricao: DESCRICAO_MOVIMENTO,
      valor: 10,
      data: hojeLocal(),
      os_id: osBId,
    }),
  });
  const movData = await movResp.json();
  const movCodigo = movData && typeof movData === 'object' && !Array.isArray(movData) ? movData.code : undefined;
  console.log('HTTP status:', movResp.status);
  console.log('Código Postgres:', movCodigo || '(nenhum)');
  console.log('Resposta:', JSON.stringify(movData, null, 2));

  const vinculoCriado = movResp.status === 201 && Array.isArray(movData) && movData.length === 1;
  let movId = null;

  if (vinculoCriado) {
    movId = movData[0].id;
    console.log('\n⚠️ Vínculo cruzado aceito pelo banco - confirmando por SELECT independente como proprietario da A...');
    const confirmacaoMov = await consultar(
      loginA.access_token,
      `${SUPABASE_URL}/rest/v1/movimentos_caixa?empresa_id=eq.${EMPRESA_A}&os_id=eq.${osBId}&select=*`
    );
    console.log('HTTP status (confirmação):', confirmacaoMov.status);
    console.log('Resposta (confirmação):', JSON.stringify(confirmacaoMov.data, null, 2));
    const confirmado = confirmacaoMov.status === 200
      && Array.isArray(confirmacaoMov.data)
      && confirmacaoMov.data.length === 1
      && confirmacaoMov.data[0].id === movId;
    if (!confirmado) {
      console.error('\n🚨 Confirmação inconclusiva do movimento cruzado - encerrando com erro.');
      process.exit(1);
    }
    console.log('\n🚨 FALHA DE INTEGRIDADE MULTIEMPRESA CONFIRMADA: movimentação da Empresa A foi salva e confirmada com os_id de uma OS da Empresa B.');
    console.log('   Movimento preservado como evidência - nenhuma correção aplicada por este script.');
  } else {
    console.log('\n✅ Vínculo cruzado bloqueado pelo banco - confirmando por SELECT como proprietario da A que nenhum movimento marcador existe...');
    const confirmacaoBloqueio = await consultar(
      loginA.access_token,
      `${SUPABASE_URL}/rest/v1/movimentos_caixa?empresa_id=eq.${EMPRESA_A}&descricao=eq.${encodeURIComponent(DESCRICAO_MOVIMENTO)}&select=*`
    );
    console.log('HTTP status (confirmação):', confirmacaoBloqueio.status);
    console.log('Resposta (confirmação):', JSON.stringify(confirmacaoBloqueio.data, null, 2));
    const confirmadoBloqueio = confirmacaoBloqueio.status === 200
      && Array.isArray(confirmacaoBloqueio.data)
      && confirmacaoBloqueio.data.length === 0;
    if (!confirmadoBloqueio) {
      console.error('\n🚨 Confirmação inconclusiva do bloqueio - encerrando com erro.');
      process.exit(1);
    }
    console.log('\n✅ Integridade multiempresa já protegida: nenhuma movimentação foi criada com os_id de outra empresa.');
    console.log('   Cliente e OS legítimos criados na Empresa B permanecem preservados (nenhuma exclusão automática).');
  }

  console.log('\n== 3) SELECT direto da OS da Empresa B pelo proprietario da A (deve continuar bloqueado) ==');
  const selOs = await consultar(loginA.access_token, `${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${osBId}&select=*`);
  console.log('HTTP status:', selOs.status);
  console.log('Resposta:', JSON.stringify(selOs.data, null, 2));
  const selOsOk = selOs.status === 200 && Array.isArray(selOs.data) && selOs.data.length === 0;
  console.log(selOsOk ? '✅ Leitura direta da OS da B bloqueada.' : '🚨 FALHA: leitura direta da OS da B não retornou HTTP 200 + [].');
  if (!selOsOk) {
    console.error('Encerrando com erro - possível vazamento de leitura direta.');
    process.exit(1);
  }

  if (vinculoCriado) {
    console.log('\n== 4) SELECT da movimentação com embed da OS (?select=*,ordens_servico(*)) ==');
    const embed = await consultar(loginA.access_token, `${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${movId}&select=*,ordens_servico(*)`);
    console.log('HTTP status:', embed.status);
    console.log('Resposta:', JSON.stringify(embed.data, null, 2));
    const embedRow = Array.isArray(embed.data) ? embed.data[0] : null;
    const embedOsValor = embedRow ? embedRow.ordens_servico : undefined;
    const embedVazio = embedOsValor === null || embedOsValor === undefined || (Array.isArray(embedOsValor) && embedOsValor.length === 0);
    const embedOk = embed.status === 200 && Array.isArray(embed.data) && embed.data.length === 1 && embedVazio;
    console.log(embedOk ? '✅ Embed vazio/nulo - RLS de ordens_servico respeitada mesmo dentro do embed.' : '🚨 VAZAMENTO: embed expôs dado da OS da Empresa B.');
    if (!embedOk) {
      console.error('Encerrando com erro - vazamento de dado via embed confirmado ou resposta inconclusiva.');
      process.exit(1);
    }
  } else {
    console.log('\n== 4) SELECT com embed não aplicável - vínculo cruzado foi bloqueado, não há movimento para testar. ==');
  }

  console.log('\n== RESUMO ==');
  console.log('- Cliente de teste criado na Empresa B:', clienteBId);
  console.log('- OS de teste criada na Empresa B:', osBId);
  console.log('- Movimentação de teste criada na Empresa A:', movId || '(nenhuma - vínculo cruzado bloqueado)');
  console.log('- Vínculo cruzado (movimento A -> OS B) permitido pelo banco:', vinculoCriado);
  console.log('\nNOTA: nenhuma UNIQUE, FK composta ou correção de dados foi criada por este script, e NENHUM registro criado foi excluído automaticamente.');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
