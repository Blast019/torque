// QA Fase 4.3 - Validacao (SOMENTE LEITURA) da RPC listar_usuarios_empresa.
//
// Cobre a matriz de 10 testes validada nesta fase:
//   #1 RPC-PROP-01, #2 RPC-ADMIN-01 - proprietario/admin leem os vinculos
//      da propria empresa (sucesso, mesmo resultado para os dois).
//   #3 RPC-USUARIO-01 - usuario tenta ler (esperado: TRQ55).
//   #4 RPC-SEMVINCULO-01 - conta sem nenhum vinculo tenta ler (TRQ55).
//   #5 RPC-LIVRE-01 - conta com papel gerente porem vinculo INATIVO tenta
//      ler (TRQ55). Nao existe hoje, nas fixtures de QA, nenhuma conta com
//      papel gerente e vinculo ATIVO - este teste valida o bloqueio por
//      vinculo inativo, nao especificamente "gerente ativo". A cobertura
//      de "papel insuficiente com vinculo ATIVO" fica com o teste #3.
//   #6 RPC-ANON-01 - chamada anonima, sem token (esperado: bloqueada pelo
//      REVOKE antes mesmo de alcancar o corpo da funcao - HTTP 401/42501).
//   #7 RPC-ISO-01, #8 RPC-ISO-02 - proprietario/admin da Empresa A tentam
//      ler a Empresa B, onde nao tem nenhum vinculo (isolamento - TRQ55).
//   #9 RPC-NULL-01 - p_empresa_id nulo (TRQ54).
//   #10 RPC-REPETIR-01 - repete o teste #1 para confirmar leitura estavel
//      (idempotencia de leitura / ausencia de efeito colateral).
//
// Autenticacao real de cada papel (login via /auth/v1/token, cada chamada
// usando o access_token da conta correspondente), mesmo padrao ja usado
// nos scripts de QA da Fase 4.2 (ver qa-env.js).
//
// Nao chama nenhuma RPC de escrita (incluir/alterar/remover_usuario_empresa
// ou criar(_nova)_empresa_com_vinculo). Nao usa service_role em nenhum
// momento. Nao altera nenhuma linha - listar_usuarios_empresa e STABLE e
// so leitura.
//
// JA EXECUTADO manualmente (fora deste arquivo versionado, via script
// equivalente) em 02/09/2026, com os 10/10 testes aprovados - ver
// qa/fase-4/STATUS.md para o resultado documentado. Este arquivo e a
// versao final, versionada, do mesmo teste, adaptada ao padrao do
// projeto - nao foi reexecutada a partir daqui.
//
// Rodar (a partir da raiz do repositorio), sob autorizacao explicita do
// usuario:
//   node --env-file=qa/.env qa/fase-4/scripts/permissoes-10-qa-listar-usuarios-empresa.js

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SENHA_QA,
  EMAIL_PROPRIETARIO,
  EMAIL_ADMIN,
  EMAIL_USUARIO,
  EMAIL_SEM_VINCULO,
  EMAIL_PROPRIETARIO_ANTIGO,
} = require('../../fase-2.5/scripts/qa-env');

// LIVRE (EMAIL_PROPRIETARIO_ANTIGO) nao usa a senha compartilhada
// (SENHA_QA/SUPABASE_TEST_PASSWORD) - tem senha propria, mesmo padrao ja
// usado em permissoes-06/07/08.
if (!process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO) {
  console.error('Variável de ambiente obrigatória ausente: QA_PASSWORD_PROPRIETARIO_ANTIGO');
  console.error('Configure qa/.env (ver qa/.env.example) e rode novamente.');
  process.exit(1);
}
const SENHA_PROPRIETARIO_ANTIGO = process.env.QA_PASSWORD_PROPRIETARIO_ANTIGO;

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const EMPRESA_B = '069783bc-5f12-4e00-b8ed-d57efca4aa67'; // QA Fase 2.5 - Empresa B

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
  const raw = await resp.text();
  let data = null;
  if (raw.length > 0) {
    try { data = JSON.parse(raw); } catch (e) {
      throw new Error(`Falha no login de ${nomeLogico}: corpo da resposta não é JSON válido (HTTP ${resp.status}).`);
    }
  }
  if (!resp.ok || !data) {
    console.error(`[login:${nomeLogico}] falha no login. Corpo (redigido): ${data ? redigirSegredos(JSON.stringify(data)) : '(corpo vazio)'}`);
    throw new Error(`Falha no login de ${nomeLogico} (HTTP ${resp.status}).`);
  }
  console.log(`[login:${nomeLogico}] HTTP ${resp.status} OK, user_id=${data.user?.id}`);
  return data;
}

async function chamarListarUsuarios(accessTokenOuNull, empresaId) {
  const headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (accessTokenOuNull) headers.Authorization = `Bearer ${accessTokenOuNull}`;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/listar_usuarios_empresa`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_empresa_id: empresaId }),
  });
  const raw = await resp.text();
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch (e) { data = raw; } }
  return { status: resp.status, data };
}

async function main() {
  console.log('== Login das contas de teste ==');
  const prop = await login('PROP_A (proprietario)', EMAIL_PROPRIETARIO, SENHA_QA);
  const admin = await login('ADMIN_A (admin)', EMAIL_ADMIN, SENHA_QA);
  const usuario = await login('USUARIO_A (usuario)', EMAIL_USUARIO, SENHA_QA);
  const semVinculo = await login('SEM_VINCULO', EMAIL_SEM_VINCULO, SENHA_QA);
  const livre = await login('LIVRE (gerente, vínculo inativo)', EMAIL_PROPRIETARIO_ANTIGO, SENHA_PROPRIETARIO_ANTIGO);

  console.log('\n== #1 RPC-PROP-01: PROP_A lista usuários da Empresa A (esperado: sucesso) ==');
  const t1 = await chamarListarUsuarios(prop.access_token, EMPRESA_A);
  console.log('HTTP', t1.status, JSON.stringify(t1.data));
  const t1Ok = t1.status === 200 && Array.isArray(t1.data) && t1.data.length >= 1 &&
    t1.data.every(r => typeof r.email === 'string' && r.email.includes('@'));
  reportar('RPC-PROP-01', t1Ok, `linhas=${Array.isArray(t1.data) ? t1.data.length : 'erro'}`);

  console.log('\n== #2 RPC-ADMIN-01: ADMIN_A lista usuários da Empresa A (esperado: sucesso, mesmo resultado) ==');
  const t2 = await chamarListarUsuarios(admin.access_token, EMPRESA_A);
  console.log('HTTP', t2.status, JSON.stringify(t2.data));
  const t2Ok = t2.status === 200 && Array.isArray(t2.data) && t2.data.length === (Array.isArray(t1.data) ? t1.data.length : -1);
  reportar('RPC-ADMIN-01', t2Ok, `linhas=${Array.isArray(t2.data) ? t2.data.length : 'erro'}, comparado a PROP_A=${Array.isArray(t1.data) ? t1.data.length : 'erro'}`);

  console.log('\n== #3 RPC-USUARIO-01: USUARIO_A tenta listar (esperado: TRQ55) ==');
  const t3 = await chamarListarUsuarios(usuario.access_token, EMPRESA_A);
  console.log('HTTP', t3.status, JSON.stringify(t3.data));
  reportar('RPC-USUARIO-01', t3.status >= 400 && t3.data && t3.data.code === 'TRQ55', `code=${t3.data && t3.data.code}`);

  console.log('\n== #4 RPC-SEMVINCULO-01: SEM_VINCULO tenta listar Empresa A (esperado: TRQ55) ==');
  const t4 = await chamarListarUsuarios(semVinculo.access_token, EMPRESA_A);
  console.log('HTTP', t4.status, JSON.stringify(t4.data));
  reportar('RPC-SEMVINCULO-01', t4.status >= 400 && t4.data && t4.data.code === 'TRQ55', `code=${t4.data && t4.data.code}`);

  console.log('\n== #5 RPC-LIVRE-01: LIVRE (gerente, vínculo INATIVO) tenta listar Empresa A (esperado: TRQ55) ==');
  const t5 = await chamarListarUsuarios(livre.access_token, EMPRESA_A);
  console.log('HTTP', t5.status, JSON.stringify(t5.data));
  reportar('RPC-LIVRE-01', t5.status >= 400 && t5.data && t5.data.code === 'TRQ55', `code=${t5.data && t5.data.code}`);

  console.log('\n== #6 RPC-ANON-01: chamada anônima, sem access_token (esperado: bloqueada antes do corpo da função) ==');
  const t6 = await chamarListarUsuarios(null, EMPRESA_A);
  console.log('HTTP', t6.status, JSON.stringify(t6.data));
  reportar('RPC-ANON-01', t6.status >= 400, `HTTP ${t6.status} (esperado 4xx)`);

  console.log('\n== #7 RPC-ISO-01 (isolamento): PROP_A tenta listar a Empresa B, onde não tem vínculo (esperado: TRQ55) ==');
  const t7 = await chamarListarUsuarios(prop.access_token, EMPRESA_B);
  console.log('HTTP', t7.status, JSON.stringify(t7.data));
  reportar('RPC-ISO-01', t7.status >= 400 && t7.data && t7.data.code === 'TRQ55', `code=${t7.data && t7.data.code}`);

  console.log('\n== #8 RPC-ISO-02 (isolamento): ADMIN_A tenta listar a Empresa B, onde não tem vínculo (esperado: TRQ55) ==');
  const t8 = await chamarListarUsuarios(admin.access_token, EMPRESA_B);
  console.log('HTTP', t8.status, JSON.stringify(t8.data));
  reportar('RPC-ISO-02', t8.status >= 400 && t8.data && t8.data.code === 'TRQ55', `code=${t8.data && t8.data.code}`);

  console.log('\n== #9 RPC-NULL-01: p_empresa_id nulo (esperado: TRQ54) ==');
  const t9 = await chamarListarUsuarios(prop.access_token, null);
  console.log('HTTP', t9.status, JSON.stringify(t9.data));
  reportar('RPC-NULL-01', t9.status >= 400 && t9.data && t9.data.code === 'TRQ54', `code=${t9.data && t9.data.code}`);

  console.log('\n== #10 RPC-REPETIR-01: repete o #1 para confirmar leitura estável (sem efeito colateral) ==');
  const t10 = await chamarListarUsuarios(prop.access_token, EMPRESA_A);
  const t10Ok = t10.status === 200 && Array.isArray(t10.data) && Array.isArray(t1.data) &&
    JSON.stringify(t10.data) === JSON.stringify(t1.data);
  reportar('RPC-REPETIR-01', t10Ok, `idêntico ao #1: ${t10Ok}`);

  console.log(`\n== RESULTADO: ${falhas === 0 ? 'TODOS OS 10 TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'} ==`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Erro inesperado:', redigirSegredos(e.message));
  process.exit(1);
});
