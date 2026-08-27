// QA Fase 2.5.5 (movimentos_caixa) - Passo 5 do plano de correção: validação de
// ponta a ponta do ON DELETE SET NULL (os_id) / ON DELETE SET NULL (peca_id) das
// FKs compostas já criadas e validadas (scripts 11-14). Mesmo padrão já usado em
// funcionarios (Fase 2.5.4, script 09), agora com DOIS vínculos testados na mesma
// execução (os_id e peca_id), tudo dentro da própria Empresa A - não envolve
// Empresa B, porque aqui o objetivo é só confirmar o efeito do ON DELETE, não
// isolamento entre empresas.
//
// EXECUTADO E APROVADO — ON DELETE SET NULL VALIDADO NOS DOIS CAMPOS (ver STATUS.md).
//
// Fluxo:
//  0) Login proprietario. Valida vínculo ativo na Empresa A (usuarios_empresas,
//     filtro usuario_id + empresa_id).
//  0b) Pré-checagem de duplicidade: as 5 descrições marcadoras (cliente, OS,
//      movimento-os, peça, movimento-peca) não podem já existir. Aborta se sim.
//  1) Cria cliente temporário na Empresa A.
//  2) Cria OS temporária ligada ao cliente.
//  3) Cria movimento temporário ligado à OS (os_id).
//  4) Cria peça temporária na Empresa A.
//  5) Cria movimento temporário ligado à peça (peca_id).
//  6) Confirma por SELECT independente o estado dos 2 movimentos ANTES de
//     qualquer exclusão, e guarda o snapshot completo de cada um.
//  7) Exclui SÓ a OS temporária. Confirma que o movimento da OS continua
//     existindo, com os_id virando null, empresa_id preservado e todas as
//     outras colunas iguais ao snapshot.
//  8) Exclui SÓ a peça temporária. Confirma o mesmo padrão para o movimento da
//     peça (peca_id vira null).
//  9) Resumo final com todos os IDs criados e excluídos. SEM limpeza automática
//     do cliente temporário nem dos 2 movimentos - ficam preservados de
//     propósito (só OS e peça são excluídas, intencionalmente, como parte do
//     próprio teste).
//
// Segurança: return=representation só nos INSERTs (proprietario sempre tem
// SELECT nas tabelas da própria empresa, então não repete a anomalia já vista
// com admin em movimentos_caixa). Toda exclusão é filtrada por um ID capturado
// nesta mesma execução - nenhum registro preexistente é tocado. Qualquer
// divergência encerra com process.exit(1).
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-15-fix-integridade-05-on-delete-set-null.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

const DESCRICAO_CLIENTE = '[TESTE] QA Fase 2.5.5 - Cliente temporario ON DELETE SET NULL';
const DESCRICAO_OS = '[TESTE] QA Fase 2.5.5 - OS temporaria ON DELETE SET NULL';
const DESCRICAO_MOV_OS = '[TESTE] QA Fase 2.5.5 - Movimento temporario os_id ON DELETE SET NULL';
const DESCRICAO_PECA = '[TESTE] QA Fase 2.5.5 - Peca temporaria ON DELETE SET NULL';
const DESCRICAO_MOV_PECA = '[TESTE] QA Fase 2.5.5 - Movimento temporario peca_id ON DELETE SET NULL';

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

async function inserir(accessToken, tabela, payload) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

async function excluir(accessToken, tabela, id) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'return=minimal',
    },
  });
  const raw = await resp.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch (e) { data = raw; }
  }
  return { status: resp.status, data };
}

// Compara duas linhas: todas as colunas de "antes" devem bater com "depois",
// exceto o campo indicado (que deve ter mudado de um valor não-nulo pra null).
function colunaVirouNullSemAlterarResto(antes, depois, campo) {
  if (!(antes[campo] !== null && antes[campo] !== undefined)) return false;
  if (depois[campo] !== null) return false;
  for (const chave of Object.keys(antes)) {
    if (chave === campo) continue;
    if (JSON.stringify(antes[chave]) !== JSON.stringify(depois[chave])) return false;
  }
  return true;
}

async function main() {
  console.log('\n== Login: <e-mail do proprietario> (proprietario da Empresa A) ==');
  const loginA = await login(EMAIL_PROPRIETARIO, SENHA_QA);
  console.log('Login OK. user_id =', loginA.user?.id);

  console.log('\n== 0) Validar vínculo do proprietario na Empresa A ==');
  const vinculo = await consultar(
    loginA.access_token,
    `${SUPABASE_URL}/rest/v1/usuarios_empresas?usuario_id=eq.${loginA.user.id}&empresa_id=eq.${EMPRESA_A}&select=usuario_id,empresa_id,papel,ativo`
  );
  console.log('HTTP status:', vinculo.status, JSON.stringify(vinculo.data));
  const vinculoOk = vinculo.status === 200
    && Array.isArray(vinculo.data)
    && vinculo.data.length === 1
    && vinculo.data[0].papel === 'proprietario'
    && vinculo.data[0].ativo === true;
  console.log(vinculoOk ? '✅ Vínculo confirmado.' : '🚨 FALHA: vínculo do proprietario na Empresa A não confere.');
  if (!vinculoOk) {
    console.error('\nAbortando - pré-condição de vínculo não confirmada.');
    process.exit(1);
  }

  console.log('\n== 0b) Pré-checagem de duplicidade (5 descrições marcadoras) ==');
  const checks = [
    ['clientes', 'nome', DESCRICAO_CLIENTE],
    ['ordens_servico', 'descricao', DESCRICAO_OS],
    ['movimentos_caixa', 'descricao', DESCRICAO_MOV_OS],
    ['pecas', 'nome', DESCRICAO_PECA],
    ['movimentos_caixa', 'descricao', DESCRICAO_MOV_PECA],
  ];
  let semDuplicidade = true;
  for (const [tabela, campo, valor] of checks) {
    const r = await consultar(
      loginA.access_token,
      `${SUPABASE_URL}/rest/v1/${tabela}?empresa_id=eq.${EMPRESA_A}&${campo}=eq.${encodeURIComponent(valor)}&select=id`
    );
    const ok = r.status === 200 && Array.isArray(r.data) && r.data.length === 0;
    console.log(`${tabela}.${campo} = "${valor}":`, r.status, JSON.stringify(r.data), ok ? '✅' : '🚨');
    if (!ok) semDuplicidade = false;
  }
  if (!semDuplicidade) {
    console.error('\nAbortando antes de criar qualquer dado - risco de duplicidade ou leitura inconclusiva.');
    process.exit(1);
  }

  console.log('\n== 1) Criar cliente temporário na Empresa A ==');
  const cliente = await inserir(loginA.access_token, 'clientes', {
    empresa_id: EMPRESA_A,
    nome: DESCRICAO_CLIENTE,
    cpf: '',
    telefone: '',
    email: '',
  });
  console.log('HTTP status:', cliente.status, JSON.stringify(cliente.data, null, 2));
  const clienteOk = cliente.status === 201 && Array.isArray(cliente.data) && cliente.data.length === 1 && cliente.data[0].empresa_id === EMPRESA_A;
  if (!clienteOk) { console.error('\n🚨 Falha ao criar/confirmar o cliente temporário - abortando.'); process.exit(1); }
  const clienteId = cliente.data[0].id;
  console.log('✅ Cliente temporário criado:', clienteId);

  console.log('\n== 2) Criar OS temporária ligada ao cliente ==');
  const os = await inserir(loginA.access_token, 'ordens_servico', {
    empresa_id: EMPRESA_A,
    cliente_id: clienteId,
    veiculo_id: null,
    descricao: DESCRICAO_OS,
    mao_de_obra: 0,
    status: 'pendente',
    pago: false,
  });
  console.log('HTTP status:', os.status, JSON.stringify(os.data, null, 2));
  const osOk = os.status === 201 && Array.isArray(os.data) && os.data.length === 1
    && os.data[0].empresa_id === EMPRESA_A && os.data[0].cliente_id === clienteId;
  if (!osOk) { console.error('\n🚨 Falha ao criar/confirmar a OS temporária - abortando.'); process.exit(1); }
  const osId = os.data[0].id;
  console.log('✅ OS temporária criada:', osId);

  console.log('\n== 3) Criar movimento temporário ligado à OS (os_id) ==');
  const movOs = await inserir(loginA.access_token, 'movimentos_caixa', {
    empresa_id: EMPRESA_A,
    tipo: 'saida',
    categoria: 'os',
    descricao: DESCRICAO_MOV_OS,
    valor: 10,
    data: hojeLocal(),
    os_id: osId,
  });
  console.log('HTTP status:', movOs.status, JSON.stringify(movOs.data, null, 2));
  const movOsOk = movOs.status === 201 && Array.isArray(movOs.data) && movOs.data.length === 1
    && movOs.data[0].empresa_id === EMPRESA_A && movOs.data[0].os_id === osId;
  if (!movOsOk) { console.error('\n🚨 Falha ao criar/confirmar o movimento ligado à OS - abortando.'); process.exit(1); }
  const movOsId = movOs.data[0].id;
  console.log('✅ Movimento (os_id) criado:', movOsId);

  console.log('\n== 4) Criar peça temporária na Empresa A ==');
  const peca = await inserir(loginA.access_token, 'pecas', {
    empresa_id: EMPRESA_A,
    nome: DESCRICAO_PECA,
    qtd: 1,
    estoque_minimo: 0,
    custo: 1,
    preco: 1,
    fornecedor_id: null,
  });
  console.log('HTTP status:', peca.status, JSON.stringify(peca.data, null, 2));
  const pecaOk = peca.status === 201 && Array.isArray(peca.data) && peca.data.length === 1 && peca.data[0].empresa_id === EMPRESA_A;
  if (!pecaOk) { console.error('\n🚨 Falha ao criar/confirmar a peça temporária - abortando.'); process.exit(1); }
  const pecaId = peca.data[0].id;
  console.log('✅ Peça temporária criada:', pecaId);

  console.log('\n== 5) Criar movimento temporário ligado à peça (peca_id) ==');
  const movPeca = await inserir(loginA.access_token, 'movimentos_caixa', {
    empresa_id: EMPRESA_A,
    tipo: 'saida',
    categoria: 'estoque',
    descricao: DESCRICAO_MOV_PECA,
    valor: 5,
    data: hojeLocal(),
    peca_id: pecaId,
  });
  console.log('HTTP status:', movPeca.status, JSON.stringify(movPeca.data, null, 2));
  const movPecaOk = movPeca.status === 201 && Array.isArray(movPeca.data) && movPeca.data.length === 1
    && movPeca.data[0].empresa_id === EMPRESA_A && movPeca.data[0].peca_id === pecaId;
  if (!movPecaOk) { console.error('\n🚨 Falha ao criar/confirmar o movimento ligado à peça - abortando.'); process.exit(1); }
  const movPecaId = movPeca.data[0].id;
  console.log('✅ Movimento (peca_id) criado:', movPecaId);

  console.log('\n== 6) Confirmação independente + snapshot ANTES das exclusões ==');
  const snapMovOsResp = await consultar(loginA.access_token, `${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${movOsId}&select=*`);
  const snapMovPecaResp = await consultar(loginA.access_token, `${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${movPecaId}&select=*`);
  console.log('Movimento (os_id) - HTTP', snapMovOsResp.status, JSON.stringify(snapMovOsResp.data, null, 2));
  console.log('Movimento (peca_id) - HTTP', snapMovPecaResp.status, JSON.stringify(snapMovPecaResp.data, null, 2));

  const snapMovOsOk = snapMovOsResp.status === 200 && Array.isArray(snapMovOsResp.data) && snapMovOsResp.data.length === 1
    && snapMovOsResp.data[0].empresa_id === EMPRESA_A && snapMovOsResp.data[0].os_id === osId;
  const snapMovPecaOk = snapMovPecaResp.status === 200 && Array.isArray(snapMovPecaResp.data) && snapMovPecaResp.data.length === 1
    && snapMovPecaResp.data[0].empresa_id === EMPRESA_A && snapMovPecaResp.data[0].peca_id === pecaId;

  console.log(snapMovOsOk ? '✅ Snapshot do movimento (os_id) confirmado.' : '🚨 FALHA no snapshot do movimento (os_id).');
  console.log(snapMovPecaOk ? '✅ Snapshot do movimento (peca_id) confirmado.' : '🚨 FALHA no snapshot do movimento (peca_id).');
  if (!snapMovOsOk || !snapMovPecaOk) {
    console.error('\nAbortando antes de qualquer exclusão - snapshot inconclusivo ou divergente.');
    process.exit(1);
  }
  const snapshotMovOs = snapMovOsResp.data[0];
  const snapshotMovPeca = snapMovPecaResp.data[0];

  console.log(`\n== 7) Excluir SOMENTE a OS temporária (${osId}) ==`);
  const delOs = await excluir(loginA.access_token, 'ordens_servico', osId);
  console.log('HTTP status:', delOs.status, delOs.data ? JSON.stringify(delOs.data, null, 2) : '(corpo vazio)');
  if (delOs.status !== 204 && delOs.status !== 200) {
    console.error('\n🚨 FALHA: DELETE da OS temporária não retornou sucesso - abortando.');
    process.exit(1);
  }

  const posMovOsResp = await consultar(loginA.access_token, `${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${movOsId}&select=*`);
  console.log('Confirmação do movimento (os_id) após exclusão da OS - HTTP', posMovOsResp.status, JSON.stringify(posMovOsResp.data, null, 2));
  const posMovOsOk = posMovOsResp.status === 200
    && Array.isArray(posMovOsResp.data)
    && posMovOsResp.data.length === 1
    && colunaVirouNullSemAlterarResto(snapshotMovOs, posMovOsResp.data[0], 'os_id')
    && posMovOsResp.data[0].empresa_id === EMPRESA_A;
  console.log(posMovOsOk
    ? '✅ ON DELETE SET NULL (os_id) confirmado: movimento existe, os_id nulo, empresa_id preservado, demais colunas iguais ao snapshot.'
    : '🚨 FALHA: estado do movimento após excluir a OS não confere com o esperado.');
  if (!posMovOsOk) {
    console.error('\nEncerrando com erro - ON DELETE SET NULL (os_id) não se comportou como esperado.');
    process.exit(1);
  }

  console.log(`\n== 8) Excluir SOMENTE a peça temporária (${pecaId}) ==`);
  const delPeca = await excluir(loginA.access_token, 'pecas', pecaId);
  console.log('HTTP status:', delPeca.status, delPeca.data ? JSON.stringify(delPeca.data, null, 2) : '(corpo vazio)');
  if (delPeca.status !== 204 && delPeca.status !== 200) {
    console.error('\n🚨 FALHA: DELETE da peça temporária não retornou sucesso - abortando.');
    process.exit(1);
  }

  const posMovPecaResp = await consultar(loginA.access_token, `${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${movPecaId}&select=*`);
  console.log('Confirmação do movimento (peca_id) após exclusão da peça - HTTP', posMovPecaResp.status, JSON.stringify(posMovPecaResp.data, null, 2));
  const posMovPecaOk = posMovPecaResp.status === 200
    && Array.isArray(posMovPecaResp.data)
    && posMovPecaResp.data.length === 1
    && colunaVirouNullSemAlterarResto(snapshotMovPeca, posMovPecaResp.data[0], 'peca_id')
    && posMovPecaResp.data[0].empresa_id === EMPRESA_A;
  console.log(posMovPecaOk
    ? '✅ ON DELETE SET NULL (peca_id) confirmado: movimento existe, peca_id nulo, empresa_id preservado, demais colunas iguais ao snapshot.'
    : '🚨 FALHA: estado do movimento após excluir a peça não confere com o esperado.');
  if (!posMovPecaOk) {
    console.error('\nEncerrando com erro - ON DELETE SET NULL (peca_id) não se comportou como esperado.');
    process.exit(1);
  }

  console.log('\n== RESUMO ==');
  console.log('- Cliente temporário criado (preservado):', clienteId);
  console.log('- OS temporária criada e EXCLUÍDA (intencional):', osId);
  console.log('- Movimento (os_id) criado (preservado, os_id agora null):', movOsId);
  console.log('- Peça temporária criada e EXCLUÍDA (intencional):', pecaId);
  console.log('- Movimento (peca_id) criado (preservado, peca_id agora null):', movPecaId);
  console.log('\nNOTA: nenhuma limpeza automática nesta versão - cliente temporário e os 2 movimentos permanecem na Empresa A. Nenhum registro preexistente foi alterado ou excluído.');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
