// QA Fase 4.2 - Bloco 1 (testes que NAO alteram dados)
//
// Cobre os testes #1-#10 da matriz aprovada:
//   #1 SEL-01, #2 SEL-02, #3 SEL-03, #4 SEL-05, #5 ISO-04 - leituras de RLS
//   #6 INC-08, #7 INC-09, #8 INC-04, #9 INC-05, #10 PERM-01 - chamadas de RPC
//   com resultado NEGATIVO esperado (erro), sem criar/alterar nenhuma linha.
//
// Autenticacao real de cada papel (login via /auth/v1/token, cada chamada
// usando o access_token da conta correspondente) - nenhuma chamada usa so a
// anon key sem sessao, para que auth.uid() e as policies de RLS sejam
// efetivamente exercitados, mesmo padrao ja usado nos scripts da Fase 2.5
// (ver qa-env.js e movimentos-caixa-06-isolamento.js).
//
// Reaproveita o helper de credenciais ja existente da Fase 2.5
// (qa/fase-2.5/scripts/qa-env.js) em vez de duplicar - os 5 e-mails de teste
// necessarios (proprietario/admin/usuario/proprietario_antigo/sem_vinculo)
// ja sao exatamente as mesmas contas reais usadas nesta Fase 4, so que agora
// mapeadas para papeis diferentes (ver comentario de contas abaixo). Nenhuma
// variavel de ambiente nova e necessaria.
//
// Contas usadas neste Bloco 1 (nomes da matriz -> variavel de ambiente):
//   PROP_A     -> EMAIL_PROPRIETARIO         (proprietario ativo, Empresa A)
//   ADMIN_A    -> EMAIL_ADMIN                (admin ativo, Empresa A)
//   USUARIO_A  -> EMAIL_USUARIO              (usuario ativo, Empresa A)
//   LIVRE      -> EMAIL_PROPRIETARIO_ANTIGO  (sem nenhum vinculo hoje -
//                 login confirmado manualmente pelo usuario em 31/08/2026)
//
// Ao final, reconfirma que nenhuma das 5 chamadas de RPC (#6-#10) criou ou
// alterou qualquer linha: reconsulta a contagem de vinculos da Empresa A
// (deve continuar igual ao baseline capturado no #1) e reconsulta que LIVRE
// continua sem nenhum vinculo na Empresa A (nao deveria ter sido criado
// nenhum vinculo para ela, mesmo tendo sido usada como e-mail alvo real nos
// testes #7-#10 - todos devem falhar ANTES de qualquer INSERT/UPDATE).
//
// AINDA NAO EXECUTADO.
// Rodar (a partir da raiz do repositorio), sob autorizacao explicita do
// usuario:
//   node --env-file=qa/.env qa/fase-4/scripts/permissoes-06-qa-bloco1-sem-alteracao.js

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SENHA_QA,
  EMAIL_PROPRIETARIO,
  EMAIL_ADMIN,
  EMAIL_USUARIO,
  EMAIL_PROPRIETARIO_ANTIGO,
} = require('../../fase-2.5/scripts/qa-env');

// LIVRE (EMAIL_PROPRIETARIO_ANTIGO) não usa a senha compartilhada
// (SENHA_QA/SUPABASE_TEST_PASSWORD) - tem senha própria, validada aqui com o
// mesmo padrão de checagem de obrigatoriedade já usado em qa-env.js.
if (!process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO) {
  console.error('Variável de ambiente obrigatória ausente: QA_PASSWORD_PROPRIETARIO_ANTIGO');
  console.error('Configure qa/.env (ver qa/.env.example) e rode novamente.');
  process.exit(1);
}
const SENHA_PROPRIETARIO_ANTIGO = process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO;

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B
const EMAIL_INEXISTENTE = 'nao-existe.qa-fase4@teste.invalido';

let falhas = 0;

function reportar(id, ok, detalhe) {
  console.log(`${ok ? '✅' : '🚨'} ${id}${detalhe ? ' - ' + detalhe : ''}`);
  if (!ok) falhas++;
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

  return data;
}

async function selectVinculos(accessToken, empresaId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/usuarios_empresas?empresa_id=eq.${empresaId}&select=*`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } }
  );
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

async function main() {
  console.log('== Login das 4 contas necessárias para o Bloco 1 ==');
  const prop = await login('PROP_A', EMAIL_PROPRIETARIO, SENHA_QA);
  console.log('PROP_A logado. user_id =', prop.user?.id);
  const admin = await login('ADMIN_A', EMAIL_ADMIN, SENHA_QA);
  console.log('ADMIN_A logado. user_id =', admin.user?.id);
  const usuario = await login('USUARIO_A', EMAIL_USUARIO, SENHA_QA);
  console.log('USUARIO_A logado. user_id =', usuario.user?.id);
  const livre = await login('LIVRE', EMAIL_PROPRIETARIO_ANTIGO, SENHA_PROPRIETARIO_ANTIGO);
  console.log('LIVRE logado. user_id =', livre.user?.id);

  // #1 SEL-01 - PROP_A vê as 3 linhas da Empresa A
  console.log('\n== #1 SEL-01 ==');
  const sel01 = await selectVinculos(prop.access_token, EMPRESA_A);
  console.log('HTTP', sel01.status, JSON.stringify(sel01.data));
  reportar(
    'SEL-01',
    sel01.status === 200 && Array.isArray(sel01.data) && sel01.data.length === 3,
    `esperado 3, recebido ${Array.isArray(sel01.data) ? sel01.data.length : 'erro'}`
  );
  const baselineEmpresaA = Array.isArray(sel01.data) ? sel01.data.length : null;

  // #2 SEL-02 - ADMIN_A vê as 3 linhas da Empresa A
  console.log('\n== #2 SEL-02 ==');
  const sel02 = await selectVinculos(admin.access_token, EMPRESA_A);
  console.log('HTTP', sel02.status, JSON.stringify(sel02.data));
  reportar(
    'SEL-02',
    sel02.status === 200 && Array.isArray(sel02.data) && sel02.data.length === 3,
    `esperado 3, recebido ${Array.isArray(sel02.data) ? sel02.data.length : 'erro'}`
  );

  // #3 SEL-03 - USUARIO_A vê só a própria linha
  console.log('\n== #3 SEL-03 ==');
  const sel03 = await selectVinculos(usuario.access_token, EMPRESA_A);
  console.log('HTTP', sel03.status, JSON.stringify(sel03.data));
  const sel03Ok =
    sel03.status === 200 &&
    Array.isArray(sel03.data) &&
    sel03.data.length === 1 &&
    sel03.data[0].usuario_id === usuario.user.id;
  reportar('SEL-03', sel03Ok, `esperado 1 linha do próprio usuario_id, recebido ${JSON.stringify(sel03.data)}`);

  // #4 SEL-05 - LIVRE não vê nenhuma linha da Empresa A
  console.log('\n== #4 SEL-05 ==');
  const sel05 = await selectVinculos(livre.access_token, EMPRESA_A);
  console.log('HTTP', sel05.status, JSON.stringify(sel05.data));
  reportar(
    'SEL-05',
    sel05.status === 200 && Array.isArray(sel05.data) && sel05.data.length === 0,
    `esperado 0, recebido ${Array.isArray(sel05.data) ? sel05.data.length : 'erro'}`
  );

  // #5 ISO-04 - PROP_A não vê nenhuma linha da Empresa B
  console.log('\n== #5 ISO-04 ==');
  const iso04 = await selectVinculos(prop.access_token, EMPRESA_B);
  console.log('HTTP', iso04.status, JSON.stringify(iso04.data));
  reportar(
    'ISO-04',
    iso04.status === 200 && Array.isArray(iso04.data) && iso04.data.length === 0,
    `esperado 0, recebido ${Array.isArray(iso04.data) ? iso04.data.length : 'erro'}`
  );

  // #6 INC-08 - PROP_A inclui e-mail inexistente
  console.log('\n== #6 INC-08 ==');
  const inc08 = await chamarRpc(prop.access_token, 'incluir_usuario_empresa', {
    p_empresa_id: EMPRESA_A,
    p_email: EMAIL_INEXISTENTE,
    p_papel: 'usuario',
  });
  console.log('HTTP', inc08.status, JSON.stringify(inc08.data));
  reportar(
    'INC-08',
    inc08.status >= 400 && inc08.data && inc08.data.code === 'TRQ27',
    `esperado erro TRQ27, recebido code=${inc08.data && inc08.data.code}`
  );

  // #7 INC-09 - PROP_A tenta papel inválido
  console.log('\n== #7 INC-09 ==');
  const inc09 = await chamarRpc(prop.access_token, 'incluir_usuario_empresa', {
    p_empresa_id: EMPRESA_A,
    p_email: EMAIL_PROPRIETARIO_ANTIGO,
    p_papel: 'gestor',
  });
  console.log('HTTP', inc09.status, JSON.stringify(inc09.data));
  reportar(
    'INC-09',
    inc09.status >= 400 && inc09.data && inc09.data.code === 'TRQ24',
    `esperado erro TRQ24, recebido code=${inc09.data && inc09.data.code}`
  );

  // #8 INC-04 - ADMIN_A tenta incluir como admin
  console.log('\n== #8 INC-04 ==');
  const inc04 = await chamarRpc(admin.access_token, 'incluir_usuario_empresa', {
    p_empresa_id: EMPRESA_A,
    p_email: EMAIL_PROPRIETARIO_ANTIGO,
    p_papel: 'admin',
  });
  console.log('HTTP', inc04.status, JSON.stringify(inc04.data));
  reportar(
    'INC-04',
    inc04.status >= 400 && inc04.data && inc04.data.code === 'TRQ25',
    `esperado erro TRQ25, recebido code=${inc04.data && inc04.data.code}`
  );

  // #9 INC-05 - ADMIN_A tenta incluir como proprietario
  console.log('\n== #9 INC-05 ==');
  const inc05 = await chamarRpc(admin.access_token, 'incluir_usuario_empresa', {
    p_empresa_id: EMPRESA_A,
    p_email: EMAIL_PROPRIETARIO_ANTIGO,
    p_papel: 'proprietario',
  });
  console.log('HTTP', inc05.status, JSON.stringify(inc05.data));
  reportar(
    'INC-05',
    inc05.status >= 400 && inc05.data && inc05.data.code === 'TRQ25',
    `esperado erro TRQ25, recebido code=${inc05.data && inc05.data.code}`
  );

  // #10 PERM-01 - USUARIO_A tenta incluir alguém (sem nenhuma permissão)
  console.log('\n== #10 PERM-01 ==');
  const perm01 = await chamarRpc(usuario.access_token, 'incluir_usuario_empresa', {
    p_empresa_id: EMPRESA_A,
    p_email: EMAIL_PROPRIETARIO_ANTIGO,
    p_papel: 'gerente',
  });
  console.log('HTTP', perm01.status, JSON.stringify(perm01.data));
  reportar(
    'PERM-01',
    perm01.status >= 400 && perm01.data && perm01.data.code === 'TRQ25',
    `esperado erro TRQ25, recebido code=${perm01.data && perm01.data.code}`
  );

  // Confirmação final: nenhuma das 5 chamadas de RPC (#6-#10) alterou dados.
  console.log('\n== Confirmação pós-testes: nenhuma alteração causada por #6-#10 ==');
  const confEmpresaA = await selectVinculos(prop.access_token, EMPRESA_A);
  console.log(
    'Empresa A agora:',
    confEmpresaA.status,
    `${Array.isArray(confEmpresaA.data) ? confEmpresaA.data.length : 'erro'} linha(s)`
  );
  reportar(
    'Confirmação - contagem da Empresa A inalterada',
    confEmpresaA.status === 200 &&
      Array.isArray(confEmpresaA.data) &&
      confEmpresaA.data.length === baselineEmpresaA,
    `baseline=${baselineEmpresaA}, agora=${Array.isArray(confEmpresaA.data) ? confEmpresaA.data.length : 'erro'}`
  );

  const confLivre = await selectVinculos(livre.access_token, EMPRESA_A);
  console.log('LIVRE ainda sem vínculo na Empresa A:', confLivre.status, JSON.stringify(confLivre.data));
  reportar(
    'Confirmação - LIVRE continua sem vínculo na Empresa A',
    confLivre.status === 200 && Array.isArray(confLivre.data) && confLivre.data.length === 0,
    `esperado 0, recebido ${Array.isArray(confLivre.data) ? confLivre.data.length : 'erro'}`
  );

  console.log(`\n== Resumo: ${falhas === 0 ? 'TODOS OS TESTES PASSARAM ✅' : `${falhas} FALHA(S) 🚨`} ==`);
  if (falhas > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
