// QA Fase 4.2 - Bloco 2 (testes #11-#27 da matriz aprovada em 01/09/2026)
//
// Cobre:
//   #11 PRE-01  - pre-checagem obrigatoria: baseline da Empresa A (3 vinculos
//                 ativos originais, validados por usuario_id+papel+ativo, nao
//                 so por contagem) + deteccao segura do estado atual do LIVRE.
//   #12 SEL-06  - busca (read-only) de um vinculo real de SEM_VINCULO fora da
//                 Empresa A, candidato a alvo de ISO-05. Nao procura
//                 especificamente a Empresa B - qualquer empresa != Empresa A serve.
//   #13 INC-10  - PROP_A inclui LIVRE (insercao nova OU reativacao, conforme PRE-01).
//   #14 DEL-01  - ADMIN_A remove LIVRE (dentro do limite do admin).
//   #15 INC-11  - ADMIN_A reinclui LIVRE (reativacao - caminho valido do admin).
//   #16 UPD-01  - PROP_A altera papel do LIVRE (usuario -> gerente).
//   #17 UPD-02  - ADMIN_A tenta alterar papel de PROP_A -> TRQ35.
//   #18 DEL-02  - ADMIN_A tenta remover PROP_A -> TRQ45.
//   #19 UPD-03  - ADMIN_A tenta promover LIVRE a admin -> TRQ35.
//   #20 DEL-03  - ADMIN_A tenta remover outro vinculo admin -> SKIP/PENDENTE
//                 POR AUSENCIA DE FIXTURE (so existe 1 admin nas fixtures
//                 atuais; nao usar o proprio ADMIN_A).
//   #21 UPD-04a - LIVRE tenta alterar o proprio papel -> TRQ36.
//   #22 UPD-04b - PROP_A tenta alterar o proprio papel -> TRQ36 (bloqueado
//                 mesmo para proprietario).
//   #23 DEL-04  - USUARIO_A tenta remover LIVRE -> TRQ45.
//   #24 ISO-05  - ADMIN_A tenta remover um vinculo ATIVO de outra empresa
//                 (achado em SEL-06) -> TRQ45. So executa se SEL-06 achou um
//                 alvo seguro (ver nota abaixo); senao, PENDENTE POR AUSENCIA
//                 DE FIXTURE.
//   #25 PROT-01 - PROP_A (unico proprietario ativo) tenta remover a si mesmo
//                 -> TRQ49 (protecao do ultimo proprietario, mesmo em
//                 autorremocao).
//   #26 DEL-05  - LIVRE remove a si mesmo -> sucesso (autorremocao permitida
//                 sem checar hierarquia). Estado final: LIVRE inativo.
//   #27 FINAL-01 - confirmacao final: 3 vinculos ativos originais inalterados
//                 + LIVRE inativo.
//
// Nota sobre TRQ39 (achado documentado, NAO testado aqui): em
// alterar_papel_usuario_empresa, a protecao do ultimo proprietario (TRQ39) e
// inalcancavel por qualquer chamada legitima - o bloqueio de auto-alteracao
// (TRQ36) e a restricao hierarquica do admin (TRQ35) sempre interceptam
// antes que a checagem de TRQ39 seja alcancada. Por isso nao ha teste
// artificial para TRQ39 nesta matriz, e a RPC nao foi alterada. A protecao
// equivalente (mesma regra de negocio) E alcancavel em
// remover_usuario_empresa, testada em #25 PROT-01 (TRQ49).
//
// Nota sobre ISO-05: a RPC remover_usuario_empresa verifica "vinculo ja
// inativo" (TRQ46) ANTES de checar a permissao do chamador. Por isso, para
// que ISO-05 exercite de fato o isolamento entre empresas (TRQ45) e nao
// apenas o caminho de "vinculo ja inativo" (TRQ46, que nao prova isolamento
// nenhum), o candidato encontrado por SEL-06 so e aceito como alvo seguro se
// estiver ATIVO. Um candidato inativo nao e usado, e ISO-05 fica pendente.
//
// Padrao de seguranca reaproveitado do Bloco 1 (permissoes-06): login real
// via /auth/v1/token para cada papel (auth.uid()/RLS efetivamente
// exercitados), redigirSegredos() para nunca logar token/senha/chave, sem
// service_role, sem DELETE manual (as RPCs desta fase so fazem soft delete).
//
// Seguranca de reinicio (idempotencia manual): este script NAO tenta corrigir
// nem retomar automaticamente uma execucao anterior incompleta. Ele detecta o
// estado atual do LIVRE em PRE-01 e:
//   - 0 linha na Empresa A            -> segue por insercao nova (#13 insere).
//   - 1 linha INATIVA (estado compativel) -> segue por reativacao (#13 reativa).
//   - 1 linha ATIVA                   -> ABORTA antes de qualquer mutacao,
//                                        com mensagem de possivel execucao
//                                        anterior incompleta.
//   - mais de 1 linha ou qualquer outro estado -> ABORTA sem alterar nada.
//
// AINDA NAO EXECUTADO.
// Rodar (a partir da raiz do repositorio), sob autorizacao explicita do
// usuario:
//   node --env-file=qa/.env qa/fase-4/scripts/permissoes-07-qa-bloco2.js

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SENHA_QA,
  EMAIL_PROPRIETARIO,
  EMAIL_ADMIN,
  EMAIL_USUARIO,
  EMAIL_PROPRIETARIO_ANTIGO,
  EMAIL_SEM_VINCULO,
} = require('../../fase-2.5/scripts/qa-env');

// LIVRE (EMAIL_PROPRIETARIO_ANTIGO) nao usa a senha compartilhada - mesma
// exigencia ja usada no Bloco 1 (permissoes-06).
if (!process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO) {
  console.error('Variável de ambiente obrigatória ausente: QA_PASSWORD_PROPRIETARIO_ANTIGO');
  console.error('Configure qa/.env (ver qa/.env.example) e rode novamente.');
  process.exit(1);
}
const SENHA_PROPRIETARIO_ANTIGO = process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO;

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A

const PAPEIS_VALIDOS = ['proprietario', 'admin', 'gerente', 'usuario'];

let resultados = []; // { id, status: 'APROVADO' | 'REPROVADO' | 'PENDENTE', detalhe }

function registrar(id, status, detalhe) {
  const icone = status === 'APROVADO' ? '✅' : status === 'REPROVADO' ? '🚨' : '⏭️';
  console.log(`${icone} ${id} [${status}]${detalhe ? ' - ' + detalhe : ''}`);
  resultados.push({ id, status, detalhe });
}

function redigirSegredos(texto) {
  if (!texto) return texto;
  return texto
    .replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDIGIDO:jwt]')
    .replace(/"(access_token|refresh_token)"\s*:\s*"[^"]*"/g, '"$1":"[REDIGIDO]"');
}

async function login(nomeLogico, email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const contentType = resp.headers.get('content-type') || '(nenhum)';
  const raw = await resp.text();
  console.log(`[login:${nomeLogico}] HTTP ${resp.status} | content-type: ${contentType} | tamanho do corpo: ${raw.length} bytes`);

  let data = null;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error(`[login:${nomeLogico}] corpo recebido não é JSON válido (redigido, 300 chars): ${redigirSegredos(raw.slice(0, 300))}`);
      throw new Error(`Falha no login de ${nomeLogico}: corpo da resposta não é JSON válido (HTTP ${resp.status}).`);
    }
  }

  if (!resp.ok || !data) {
    console.error(`[login:${nomeLogico}] falha no login. Corpo (redigido): ${data ? redigirSegredos(JSON.stringify(data)) : '(corpo vazio)'}`);
    throw new Error(`Falha no login de ${nomeLogico} (HTTP ${resp.status}).`);
  }

  return { ...data, _httpStatus: resp.status };
}

async function selectVinculos(accessToken, empresaId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios_empresas?empresa_id=eq.${empresaId}&select=*`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } }
  );
  const data = await resp.json();
  return { status: resp.status, data };
}

// Sem filtro de empresa - a RLS (usuarios_empresas_select_proprio) restringe
// o resultado as proprias linhas do dono do token, em qualquer empresa.
async function selectTudoProprio(accessToken) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_empresas?select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

async function chamarRpc(accessToken, funcao, params) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const raw = await resp.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch (e) { data = raw; }
  }
  return { status: resp.status, data };
}

function incluirUsuario(token, empresaId, email, papel) {
  return chamarRpc(token, 'incluir_usuario_empresa', { p_empresa_id: empresaId, p_email: email, p_papel: papel });
}

function alterarPapel(token, vinculoId, novoPapel) {
  return chamarRpc(token, 'alterar_papel_usuario_empresa', { p_vinculo_id: vinculoId, p_novo_papel: novoPapel });
}

function removerUsuario(token, vinculoId) {
  return chamarRpc(token, 'remover_usuario_empresa', { p_vinculo_id: vinculoId });
}

function encontrarLinha(lista, usuarioId) {
  return Array.isArray(lista) ? lista.find((r) => r.usuario_id === usuarioId) : undefined;
}

// Normaliza uma linha de usuarios_empresas para comparação de estado
// funcional, ignorando campos variáveis que não afetam o estado (ex.:
// criado_em).
function normalizarLinha(r) {
  return { id: r.id, empresa_id: r.empresa_id, usuario_id: r.usuario_id, papel: r.papel, ativo: r.ativo };
}

function ordenarPorId(lista) {
  return [...lista].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function imprimirResumoFinal(estadoFinalEmpresaA) {
  const aprovados = resultados.filter((r) => r.status === 'APROVADO');
  const reprovados = resultados.filter((r) => r.status === 'REPROVADO');
  const pendentes = resultados.filter((r) => r.status === 'PENDENTE');

  console.log('\n===== RESUMO FINAL - BLOCO 2 =====');
  console.log(`Aprovados (${aprovados.length}): ${aprovados.map((r) => r.id).join(', ') || '(nenhum)'}`);
  console.log(`Reprovados (${reprovados.length}): ${reprovados.map((r) => r.id).join(', ') || '(nenhum)'}`);
  console.log(`Pendentes/Ignorados (${pendentes.length}): ${pendentes.map((r) => r.id).join(', ') || '(nenhum)'}`);

  if (estadoFinalEmpresaA) {
    console.log('\nEstado final da Empresa A:');
    console.log(JSON.stringify(estadoFinalEmpresaA, null, 2));
  } else {
    console.log('\nEstado final da Empresa A: não coletado (execução interrompida antes de #27 FINAL-01).');
  }

  if (reprovados.length > 0) {
    console.log('\n🚨 RESULTADO: HÁ TESTE(S) REPROVADO(S).');
  } else if (pendentes.length > 0) {
    console.log('\n⚠️ RESULTADO: sem reprovações, mas há teste(s) PENDENTE(S) - não considerar como "todos passaram".');
  } else {
    console.log('\n✅ RESULTADO: todos os testes executados foram aprovados (sem pendências).');
  }
}

function abortarPreVoo(id, motivo) {
  registrar(id, 'REPROVADO', motivo);
  console.error(`\n🛑 ABORTADO ANTES DE QUALQUER MUTAÇÃO: ${motivo}`);
  console.error('Nenhuma chamada de escrita foi realizada. Nenhum estado foi corrigido ou retomado automaticamente.');
  imprimirResumoFinal(null);
  process.exit(1);
}

function pararPorFalhaCritica(id, motivo) {
  registrar(id, 'REPROVADO', motivo);
  console.error(`\n🛑 INTERROMPENDO IMEDIATAMENTE após falha crítica em ${id}.`);
  imprimirResumoFinal(null);
  process.exit(1);
}

async function main() {
  console.log('== Login das 5 contas necessárias para o Bloco 2 ==');
  const prop = await login('PROP_A', EMAIL_PROPRIETARIO, SENHA_QA);
  console.log('PROP_A logado. user_id =', prop.user?.id);
  const admin = await login('ADMIN_A', EMAIL_ADMIN, SENHA_QA);
  console.log('ADMIN_A logado. user_id =', admin.user?.id);
  const usuario = await login('USUARIO_A', EMAIL_USUARIO, SENHA_QA);
  console.log('USUARIO_A logado. user_id =', usuario.user?.id);
  const livre = await login('LIVRE', EMAIL_PROPRIETARIO_ANTIGO, SENHA_PROPRIETARIO_ANTIGO);
  console.log('LIVRE logado. user_id =', livre.user?.id);
  const semVinculo = await login('SEM_VINCULO', EMAIL_SEM_VINCULO, SENHA_QA);
  console.log('SEM_VINCULO logado. user_id =', semVinculo.user?.id);

  // Confirmação explícita: os 5 logins precisam ter concluído com HTTP 200
  // antes de qualquer chamada mutável (INC-10 é a primeira). login() já
  // lança exceção em caso de falha (interrompendo main() antes de chegar
  // aqui), mas esta checagem torna a garantia explícita no código, não
  // apenas implícita no fluxo de exceções.
  const logins = [
    ['PROP_A', prop],
    ['ADMIN_A', admin],
    ['USUARIO_A', usuario],
    ['LIVRE', livre],
    ['SEM_VINCULO', semVinculo],
  ];
  for (const [nomeLogin, dadosLogin] of logins) {
    if (dadosLogin._httpStatus !== 200) {
      abortarPreVoo('LOGIN', `login de ${nomeLogin} não retornou HTTP 200 (recebido ${dadosLogin._httpStatus}) - abortando antes de qualquer mutação`);
    }
  }
  console.log('== Confirmado: os 5 logins concluíram com HTTP 200 antes de qualquer chamada mutável ==');

  // ===== #12 SEL-06 (busca read-only, antes de qualquer mutação) =====
  console.log('\n== #12 SEL-06 ==');
  const sel06 = await selectTudoProprio(semVinculo.access_token);
  console.log('HTTP', sel06.status, JSON.stringify(sel06.data));
  if (sel06.status !== 200 || !Array.isArray(sel06.data)) {
    pararPorFalhaCritica('SEL-06', `falha inesperada na leitura própria de SEM_VINCULO (HTTP ${sel06.status})`);
  }
  const candidatoIsolamento = sel06.data.find((r) => r.empresa_id !== EMPRESA_A && r.ativo === true);
  if (candidatoIsolamento) {
    registrar('SEL-06', 'APROVADO', `alvo candidato encontrado fora da Empresa A: vinculo_id=${candidatoIsolamento.id}, empresa_id=${candidatoIsolamento.empresa_id}, papel=${candidatoIsolamento.papel}, ativo=true`);
  } else {
    registrar('SEL-06', 'PENDENTE', 'nenhum vínculo ATIVO de SEM_VINCULO fora da Empresa A foi encontrado - ISO-05 ficará pendente');
  }

  // ===== #11 PRE-01 (pré-checagem obrigatória, antes de qualquer mutação) =====
  console.log('\n== #11 PRE-01 ==');
  const preSel = await selectVinculos(prop.access_token, EMPRESA_A);
  console.log('HTTP', preSel.status, JSON.stringify(preSel.data));
  if (preSel.status !== 200 || !Array.isArray(preSel.data)) {
    abortarPreVoo('PRE-01', `falha inesperada ao consultar a Empresa A (HTTP ${preSel.status})`);
  }

  const esperadoBaseline = {
    [prop.user.id]: 'proprietario',
    [admin.user.id]: 'admin',
    [usuario.user.id]: 'usuario',
  };
  const linhasAtivasBaseline = preSel.data.filter((r) => r.ativo === true && r.usuario_id in esperadoBaseline);
  const baselineOk =
    linhasAtivasBaseline.length === 3 &&
    Object.entries(esperadoBaseline).every(([uid, papelEsperado]) => {
      const linha = linhasAtivasBaseline.find((r) => r.usuario_id === uid);
      return linha && linha.papel === papelEsperado;
    }) &&
    // nenhuma linha ATIVA inesperada além das 3 originais e (possivelmente) do LIVRE
    preSel.data.filter((r) => r.ativo === true && r.usuario_id !== livre.user.id).length === 3;

  if (!baselineOk) {
    abortarPreVoo('PRE-01', 'baseline da Empresa A não corresponde ao esperado (3 vínculos ativos com usuario_id/papel/ativo exatos de PROP_A=proprietario, ADMIN_A=admin, USUARIO_A=usuario) - estado inesperado, nenhuma mutação será tentada');
  }

  const linhaLivre = encontrarLinha(preSel.data, livre.user.id);
  let modoLivre;
  let livreVinculoId;

  if (!linhaLivre) {
    modoLivre = 'inserir';
    livreVinculoId = null;
  } else if (linhaLivre.ativo === true) {
    abortarPreVoo('PRE-01', 'LIVRE possui vínculo ATIVO na Empresa A - possível execução anterior incompleta. Abortando antes de qualquer mutação (sem correção automática).');
  } else if (linhaLivre.ativo === false && PAPEIS_VALIDOS.includes(linhaLivre.papel)) {
    const outrasLinhasLivre = preSel.data.filter((r) => r.usuario_id === livre.user.id);
    if (outrasLinhasLivre.length > 1) {
      abortarPreVoo('PRE-01', `LIVRE possui mais de uma linha na Empresa A (${outrasLinhasLivre.length}) - estado inesperado. Abortando sem alterar nada.`);
    }
    modoLivre = 'reativar';
    livreVinculoId = linhaLivre.id;
  } else {
    abortarPreVoo('PRE-01', `LIVRE possui linha em estado inesperado na Empresa A: ${JSON.stringify(linhaLivre)}. Abortando sem alterar nada.`);
  }

  registrar('PRE-01', 'APROVADO', `baseline confirmado (3 vínculos ativos originais corretos); LIVRE em modo "${modoLivre}"`);

  // ===== #13 INC-10 =====
  console.log('\n== #13 INC-10 ==');
  const inc10 = await incluirUsuario(prop.access_token, EMPRESA_A, EMAIL_PROPRIETARIO_ANTIGO, 'gerente');
  console.log('HTTP', inc10.status, JSON.stringify(inc10.data));
  const reativadoEsperado = modoLivre === 'reativar';
  const inc10Linha = Array.isArray(inc10.data) ? inc10.data[0] : null;
  if (
    inc10.status !== 200 ||
    !inc10Linha ||
    inc10Linha.papel !== 'gerente' ||
    inc10Linha.ativo !== true ||
    inc10Linha.reativado !== reativadoEsperado
  ) {
    pararPorFalhaCritica('INC-10', `transição não corresponde ao esperado (modo=${modoLivre}, reativado esperado=${reativadoEsperado}). Resposta: ${JSON.stringify(inc10.data)}`);
  }
  livreVinculoId = inc10Linha.vinculo_id;

  const conf13 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha13 = encontrarLinha(conf13.data, livre.user.id);
  if (!linha13 || linha13.papel !== 'gerente' || linha13.ativo !== true) {
    pararPorFalhaCritica('INC-10', `reconsulta não confirma o estado esperado: ${JSON.stringify(linha13)}`);
  }
  registrar('INC-10', 'APROVADO', `LIVRE incluído com papel=gerente, ativo=true (reativado=${reativadoEsperado})`);

  // ===== #14 DEL-01 =====
  console.log('\n== #14 DEL-01 ==');
  const del01 = await removerUsuario(admin.access_token, livreVinculoId);
  console.log('HTTP', del01.status, JSON.stringify(del01.data));
  const del01Linha = Array.isArray(del01.data) ? del01.data[0] : null;
  if (del01.status !== 200 || !del01Linha || del01Linha.ativo !== false || del01Linha.papel !== 'gerente') {
    pararPorFalhaCritica('DEL-01', `transição não corresponde ao esperado. Resposta: ${JSON.stringify(del01.data)}`);
  }
  const conf14 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha14 = encontrarLinha(conf14.data, livre.user.id);
  if (!linha14 || linha14.ativo !== false || linha14.papel !== 'gerente') {
    pararPorFalhaCritica('DEL-01', `reconsulta não confirma o estado esperado: ${JSON.stringify(linha14)}`);
  }
  registrar('DEL-01', 'APROVADO', 'ADMIN_A removeu LIVRE (papel gerente, dentro do limite do admin)');

  // ===== #15 INC-11 =====
  console.log('\n== #15 INC-11 ==');
  const inc11 = await incluirUsuario(admin.access_token, EMPRESA_A, EMAIL_PROPRIETARIO_ANTIGO, 'usuario');
  console.log('HTTP', inc11.status, JSON.stringify(inc11.data));
  const inc11Linha = Array.isArray(inc11.data) ? inc11.data[0] : null;
  if (
    inc11.status !== 200 ||
    !inc11Linha ||
    inc11Linha.papel !== 'usuario' ||
    inc11Linha.ativo !== true ||
    inc11Linha.reativado !== true
  ) {
    pararPorFalhaCritica('INC-11', `transição não corresponde ao esperado (reativado=true, papel=usuario). Resposta: ${JSON.stringify(inc11.data)}`);
  }
  const conf15 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha15 = encontrarLinha(conf15.data, livre.user.id);
  if (!linha15 || linha15.papel !== 'usuario' || linha15.ativo !== true) {
    pararPorFalhaCritica('INC-11', `reconsulta não confirma o estado esperado: ${JSON.stringify(linha15)}`);
  }
  registrar('INC-11', 'APROVADO', 'ADMIN_A reativou LIVRE com papel=usuario (caminho de inclusão válido do admin)');

  // ===== #16 UPD-01 =====
  console.log('\n== #16 UPD-01 ==');
  const upd01 = await alterarPapel(prop.access_token, livreVinculoId, 'gerente');
  console.log('HTTP', upd01.status, JSON.stringify(upd01.data));
  const upd01Linha = Array.isArray(upd01.data) ? upd01.data[0] : null;
  if (upd01.status !== 200 || !upd01Linha || upd01Linha.papel_novo !== 'gerente' || upd01Linha.papel_anterior !== 'usuario') {
    pararPorFalhaCritica('UPD-01', `transição não corresponde ao esperado (usuario -> gerente). Resposta: ${JSON.stringify(upd01.data)}`);
  }
  const conf16 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha16 = encontrarLinha(conf16.data, livre.user.id);
  if (!linha16 || linha16.papel !== 'gerente' || linha16.ativo !== true) {
    pararPorFalhaCritica('UPD-01', `reconsulta não confirma o estado esperado: ${JSON.stringify(linha16)}`);
  }
  registrar('UPD-01', 'APROVADO', 'PROP_A alterou papel de LIVRE de usuario para gerente');

  // A partir daqui, os vínculos originais (PROP_A/ADMIN_A/USUARIO_A) são necessários como alvo.
  const linhaPropOriginal = encontrarLinha(preSel.data, prop.user.id);
  const linhaAdminOriginal = encontrarLinha(preSel.data, admin.user.id);
  const linhaUsuarioOriginal = encontrarLinha(preSel.data, usuario.user.id);

  // ===== #17 UPD-02 =====
  console.log('\n== #17 UPD-02 ==');
  const upd02 = await alterarPapel(admin.access_token, linhaPropOriginal.id, 'gerente');
  console.log('HTTP', upd02.status, JSON.stringify(upd02.data));
  if (!(upd02.status >= 400 && upd02.data && upd02.data.code === 'TRQ35')) {
    pararPorFalhaCritica('UPD-02', `esperado bloqueio TRQ35, recebido: ${JSON.stringify(upd02.data)}`);
  }
  const conf17 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha17 = encontrarLinha(conf17.data, prop.user.id);
  if (!linha17 || linha17.papel !== 'proprietario' || linha17.ativo !== true) {
    pararPorFalhaCritica('UPD-02', `vínculo de PROP_A mudou inesperadamente: ${JSON.stringify(linha17)}`);
  }
  registrar('UPD-02', 'APROVADO', 'ADMIN_A bloqueado (TRQ35) ao tentar alterar papel de PROP_A; vínculo de PROP_A inalterado');

  // ===== #18 DEL-02 =====
  console.log('\n== #18 DEL-02 ==');
  const del02 = await removerUsuario(admin.access_token, linhaPropOriginal.id);
  console.log('HTTP', del02.status, JSON.stringify(del02.data));
  if (!(del02.status >= 400 && del02.data && del02.data.code === 'TRQ45')) {
    pararPorFalhaCritica('DEL-02', `esperado bloqueio TRQ45, recebido: ${JSON.stringify(del02.data)}`);
  }
  const conf18 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha18 = encontrarLinha(conf18.data, prop.user.id);
  if (!linha18 || linha18.papel !== 'proprietario' || linha18.ativo !== true) {
    pararPorFalhaCritica('DEL-02', `vínculo de PROP_A mudou inesperadamente: ${JSON.stringify(linha18)}`);
  }
  registrar('DEL-02', 'APROVADO', 'ADMIN_A bloqueado (TRQ45) ao tentar remover PROP_A; vínculo de PROP_A inalterado');

  // ===== #19 UPD-03 =====
  console.log('\n== #19 UPD-03 ==');
  const upd03 = await alterarPapel(admin.access_token, livreVinculoId, 'admin');
  console.log('HTTP', upd03.status, JSON.stringify(upd03.data));
  if (!(upd03.status >= 400 && upd03.data && upd03.data.code === 'TRQ35')) {
    pararPorFalhaCritica('UPD-03', `esperado bloqueio TRQ35, recebido: ${JSON.stringify(upd03.data)}`);
  }
  const conf19 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha19 = encontrarLinha(conf19.data, livre.user.id);
  if (!linha19 || linha19.papel !== 'gerente' || linha19.ativo !== true) {
    pararPorFalhaCritica('UPD-03', `vínculo de LIVRE mudou inesperadamente: ${JSON.stringify(linha19)}`);
  }
  registrar('UPD-03', 'APROVADO', 'ADMIN_A bloqueado (TRQ35) ao tentar promover LIVRE a admin; vínculo de LIVRE inalterado (gerente)');

  // ===== #20 DEL-03 (SKIP) =====
  console.log('\n== #20 DEL-03 ==');
  registrar('DEL-03', 'PENDENTE', 'não executável com as fixtures atuais - só existe 1 vínculo admin (o próprio ADMIN_A); usá-lo alteraria uma conta essencial do QA, o que não é permitido');

  // ===== #21 UPD-04a =====
  console.log('\n== #21 UPD-04a ==');
  const upd04a = await alterarPapel(livre.access_token, livreVinculoId, 'usuario');
  console.log('HTTP', upd04a.status, JSON.stringify(upd04a.data));
  if (!(upd04a.status >= 400 && upd04a.data && upd04a.data.code === 'TRQ36')) {
    pararPorFalhaCritica('UPD-04a', `esperado bloqueio TRQ36, recebido: ${JSON.stringify(upd04a.data)}`);
  }
  const conf21 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha21 = encontrarLinha(conf21.data, livre.user.id);
  if (!linha21 || linha21.papel !== 'gerente' || linha21.ativo !== true) {
    pararPorFalhaCritica('UPD-04a', `vínculo de LIVRE mudou inesperadamente: ${JSON.stringify(linha21)}`);
  }
  registrar('UPD-04a', 'APROVADO', 'LIVRE bloqueado (TRQ36) ao tentar alterar o próprio papel');

  // ===== #22 UPD-04b =====
  console.log('\n== #22 UPD-04b ==');
  const upd04b = await alterarPapel(prop.access_token, linhaPropOriginal.id, 'admin');
  console.log('HTTP', upd04b.status, JSON.stringify(upd04b.data));
  if (!(upd04b.status >= 400 && upd04b.data && upd04b.data.code === 'TRQ36')) {
    pararPorFalhaCritica('UPD-04b', `esperado bloqueio TRQ36, recebido: ${JSON.stringify(upd04b.data)}`);
  }
  const conf22 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha22 = encontrarLinha(conf22.data, prop.user.id);
  if (!linha22 || linha22.papel !== 'proprietario' || linha22.ativo !== true) {
    pararPorFalhaCritica('UPD-04b', `vínculo de PROP_A mudou inesperadamente: ${JSON.stringify(linha22)}`);
  }
  registrar('UPD-04b', 'APROVADO', 'PROP_A bloqueado (TRQ36) ao tentar alterar o próprio papel, mesmo sendo proprietário');

  // ===== #23 DEL-04 =====
  console.log('\n== #23 DEL-04 ==');
  const del04 = await removerUsuario(usuario.access_token, livreVinculoId);
  console.log('HTTP', del04.status, JSON.stringify(del04.data));
  if (!(del04.status >= 400 && del04.data && del04.data.code === 'TRQ45')) {
    pararPorFalhaCritica('DEL-04', `esperado bloqueio TRQ45, recebido: ${JSON.stringify(del04.data)}`);
  }
  const conf23 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha23 = encontrarLinha(conf23.data, livre.user.id);
  if (!linha23 || linha23.papel !== 'gerente' || linha23.ativo !== true) {
    pararPorFalhaCritica('DEL-04', `vínculo de LIVRE mudou inesperadamente: ${JSON.stringify(linha23)}`);
  }
  registrar('DEL-04', 'APROVADO', 'USUARIO_A bloqueado (TRQ45) ao tentar remover LIVRE');

  // ===== #24 ISO-05 =====
  console.log('\n== #24 ISO-05 ==');
  if (!candidatoIsolamento) {
    registrar('ISO-05', 'PENDENTE', 'SEL-06 não encontrou vínculo ativo seguro fora da Empresa A - teste não executado');
  } else {
    const iso05 = await removerUsuario(admin.access_token, candidatoIsolamento.id);
    console.log('HTTP', iso05.status, JSON.stringify(iso05.data));
    if (!(iso05.status >= 400 && iso05.data && iso05.data.code === 'TRQ45')) {
      pararPorFalhaCritica('ISO-05', `esperado bloqueio TRQ45, recebido: ${JSON.stringify(iso05.data)}`);
    }
    const confIso05 = await selectTudoProprio(semVinculo.access_token);
    const linhaIso05 = Array.isArray(confIso05.data) ? confIso05.data.find((r) => r.id === candidatoIsolamento.id) : null;
    if (!linhaIso05 || linhaIso05.ativo !== true || linhaIso05.papel !== candidatoIsolamento.papel) {
      pararPorFalhaCritica('ISO-05', `vínculo alvo (outra empresa) mudou inesperadamente: ${JSON.stringify(linhaIso05)}`);
    }
    registrar('ISO-05', 'APROVADO', 'ADMIN_A bloqueado (TRQ45) ao tentar remover vínculo de outra empresa; vínculo alvo inalterado');
  }

  // ===== #25 PROT-01 =====
  console.log('\n== #25 PROT-01 ==');
  const prot01 = await removerUsuario(prop.access_token, linhaPropOriginal.id);
  console.log('HTTP', prot01.status, JSON.stringify(prot01.data));
  if (!(prot01.status >= 400 && prot01.data && prot01.data.code === 'TRQ49')) {
    pararPorFalhaCritica('PROT-01', `esperado bloqueio TRQ49 (proteção do último proprietário), recebido: ${JSON.stringify(prot01.data)}`);
  }
  const conf25 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha25 = encontrarLinha(conf25.data, prop.user.id);
  if (!linha25 || linha25.papel !== 'proprietario' || linha25.ativo !== true) {
    pararPorFalhaCritica('PROT-01', `vínculo de PROP_A mudou inesperadamente (proteção do último proprietário falhou de fato): ${JSON.stringify(linha25)}`);
  }
  registrar('PROT-01', 'APROVADO', 'PROP_A bloqueado (TRQ49) ao tentar remover a si mesmo, sendo o único proprietário ativo');

  // ===== #26 DEL-05 =====
  console.log('\n== #26 DEL-05 ==');
  const del05 = await removerUsuario(livre.access_token, livreVinculoId);
  console.log('HTTP', del05.status, JSON.stringify(del05.data));
  const del05Linha = Array.isArray(del05.data) ? del05.data[0] : null;
  if (del05.status !== 200 || !del05Linha || del05Linha.ativo !== false || del05Linha.papel !== 'gerente') {
    pararPorFalhaCritica('DEL-05', `transição não corresponde ao esperado (autorremoção). Resposta: ${JSON.stringify(del05.data)}`);
  }
  const conf26 = await selectVinculos(prop.access_token, EMPRESA_A);
  const linha26 = encontrarLinha(conf26.data, livre.user.id);
  if (!linha26 || linha26.ativo !== false || linha26.papel !== 'gerente') {
    pararPorFalhaCritica('DEL-05', `reconsulta não confirma o estado esperado: ${JSON.stringify(linha26)}`);
  }
  registrar('DEL-05', 'APROVADO', 'LIVRE removeu a si mesmo (autorremoção permitida sem checar hierarquia)');

  // ===== #27 FINAL-01 =====
  console.log('\n== #27 FINAL-01 ==');
  const finalProp = await selectVinculos(prop.access_token, EMPRESA_A);
  const finalAdmin = await selectVinculos(admin.access_token, EMPRESA_A);
  console.log('HTTP (PROP_A)', finalProp.status, JSON.stringify(finalProp.data));
  console.log('HTTP (ADMIN_A)', finalAdmin.status, JSON.stringify(finalAdmin.data));

  if (
    finalProp.status !== 200 ||
    finalAdmin.status !== 200 ||
    !Array.isArray(finalProp.data) ||
    !Array.isArray(finalAdmin.data)
  ) {
    pararPorFalhaCritica('FINAL-01', `falha inesperada ao consultar estado final (HTTP PROP_A=${finalProp.status}, HTTP ADMIN_A=${finalAdmin.status})`);
  }

  // Comparação pelo conjunto EXATO de linhas (não só pela quantidade):
  // normaliza (ignora campos variáveis como criado_em) e ordena por id antes
  // de comparar PROP_A x ADMIN_A.
  const propNormalizado = ordenarPorId(finalProp.data.map(normalizarLinha));
  const adminNormalizado = ordenarPorId(finalAdmin.data.map(normalizarLinha));

  if (JSON.stringify(propNormalizado) !== JSON.stringify(adminNormalizado)) {
    pararPorFalhaCritica(
      'FINAL-01',
      `PROP_A e ADMIN_A não enxergam exatamente o mesmo conjunto de linhas na Empresa A. PROP_A=${JSON.stringify(propNormalizado)} ADMIN_A=${JSON.stringify(adminNormalizado)}`
    );
  }

  if (propNormalizado.length !== 4) {
    pararPorFalhaCritica('FINAL-01', `esperado exatamente 4 linhas na Empresa A, recebido ${propNormalizado.length}: ${JSON.stringify(propNormalizado)}`);
  }

  const linhaPropFinal = propNormalizado.find((r) => r.usuario_id === prop.user.id);
  const linhaAdminFinal = propNormalizado.find((r) => r.usuario_id === admin.user.id);
  const linhaUsuarioFinal = propNormalizado.find((r) => r.usuario_id === usuario.user.id);
  const linhaLivreFinal = propNormalizado.find((r) => r.usuario_id === livre.user.id);

  const nominaisOk =
    linhaPropFinal && linhaPropFinal.papel === 'proprietario' && linhaPropFinal.ativo === true &&
    linhaAdminFinal && linhaAdminFinal.papel === 'admin' && linhaAdminFinal.ativo === true &&
    linhaUsuarioFinal && linhaUsuarioFinal.papel === 'usuario' && linhaUsuarioFinal.ativo === true &&
    linhaLivreFinal && linhaLivreFinal.papel === 'gerente' && linhaLivreFinal.ativo === false;

  // Nenhuma linha além das 4 contas conhecidas (PROP_A/ADMIN_A/USUARIO_A/LIVRE).
  const usuariosConhecidos = new Set([prop.user.id, admin.user.id, usuario.user.id, livre.user.id]);
  const linhaInesperada = propNormalizado.find((r) => !usuariosConhecidos.has(r.usuario_id));

  if (!nominaisOk || linhaInesperada) {
    pararPorFalhaCritica(
      'FINAL-01',
      `estado final não corresponde ao esperado nominalmente. PROP_A=${JSON.stringify(linhaPropFinal)} ADMIN_A=${JSON.stringify(linhaAdminFinal)} USUARIO_A=${JSON.stringify(linhaUsuarioFinal)} LIVRE=${JSON.stringify(linhaLivreFinal)} linha_inesperada=${JSON.stringify(linhaInesperada)}`
    );
  }

  registrar(
    'FINAL-01',
    'APROVADO',
    'PROP_A e ADMIN_A enxergam exatamente as mesmas 4 linhas; PROP_A=proprietario/ativo, ADMIN_A=admin/ativo, USUARIO_A=usuario/ativo, LIVRE=gerente/inativo; nenhuma linha adicional'
  );

  imprimirResumoFinal(finalProp.data);

  const houveReprovacao = resultados.some((r) => r.status === 'REPROVADO');
  if (houveReprovacao) process.exit(1);
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  imprimirResumoFinal(null);
  process.exit(1);
});
