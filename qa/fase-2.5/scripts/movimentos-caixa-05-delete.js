// QA Fase 2.5.5 (movimentos_caixa) - teste funcional de DELETE.
// EXECUTADO E APROVADO EM 26/08/2026 (ver STATUS.md).
//
// Matriz esperada: só proprietario pode excluir (policy caixa_delete_proprietario).
// admin, usuario e sem_vinculo devem ser bloqueados - diferente das tabelas
// anteriores, aqui NEM admin tem policy de DELETE.
//
// Ordem: usuario -> sem_vinculo -> admin tentam excluir primeiro (todos bloqueados,
// com CONFIRMAÇÃO INDEPENDENTE via proprietario depois de cada tentativa, exigência
// explícita do usuário) -> só por último o proprietario exclui de fato.
//
// Variável obrigatória: TARGET_MOVIMENTO_ID=<uuid>.
//
// Rodar:
//   TARGET_MOVIMENTO_ID=<uuid> node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-05-delete.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const PROPRIETARIO = { email: EMAIL_PROPRIETARIO, password: SENHA_QA };
const BLOQUEADOS = [
  { nome: 'usuario', email: EMAIL_USUARIO },
  { nome: 'sem_vinculo', email: EMAIL_SEM_VINCULO },
  { nome: 'admin', email: EMAIL_ADMIN },
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

async function lerComoProprietario(accessToken, id) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${id}&select=id,descricao`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

async function main() {
  const id = process.env.TARGET_MOVIMENTO_ID;
  if (!id) {
    console.error('Defina TARGET_MOVIMENTO_ID.');
    process.exit(1);
  }
  const descricaoEsperada = '[TESTE] QA Fase 2.5.5 - editado por proprietario';

  const loginProp = await login(PROPRIETARIO.email, PROPRIETARIO.password);

  console.log('\n== 0) Pré-checagem via proprietario (confirma estado inicial antes de qualquer DELETE) ==');
  const preCheck = await lerComoProprietario(loginProp.access_token, id);
  console.log('HTTP status:', preCheck.status);
  console.log('Resposta:', JSON.stringify(preCheck.data, null, 2));
  const preCheckOk = preCheck.status === 200
    && Array.isArray(preCheck.data)
    && preCheck.data.length === 1
    && preCheck.data[0].id === id
    && preCheck.data[0].descricao === descricaoEsperada;
  console.log(preCheckOk ? '✅ Pré-checagem OK - estado inicial confirmado.' : '🚨 FALHA na pré-checagem - estado inicial não confere.');
  if (!preCheckOk) { console.error('Abortando antes de qualquer DELETE - estado inicial inesperado.'); process.exit(1); }

  for (const papel of BLOQUEADOS) {
    console.log(`\n== Tentativa de DELETE por ${papel.nome} (esperado: bloqueado) ==`);
    const loginPapel = await login(papel.email, SENHA_QA);
    const delResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${loginPapel.access_token}`,
        Prefer: 'return=minimal',
      },
    });
    // return=minimal não devolve corpo em sucesso (204 vazio) - ler como texto e só
    // tentar JSON.parse se houver conteúdo (ex.: corpo de erro em bloqueio).
    const delRaw = await delResp.text();
    let delData = null;
    if (delRaw) {
      try { delData = JSON.parse(delRaw); } catch (e) { delData = delRaw; }
    }
    console.log('HTTP status:', delResp.status);
    console.log('Resposta:', delRaw ? JSON.stringify(delData, null, 2) : '(corpo vazio)');

    console.log('-- Confirmação independente via proprietario --');
    const leitura = await lerComoProprietario(loginProp.access_token, id);
    console.log('HTTP status (leitura):', leitura.status);
    console.log('Resposta (leitura):', JSON.stringify(leitura.data, null, 2));
    const aindaExiste = Array.isArray(leitura.data) && leitura.data.length > 0;
    console.log(aindaExiste ? `✅ PASS: ${papel.nome} foi bloqueado - registro ainda existe.` : `🚨 FALHA: registro não existe mais depois da tentativa de ${papel.nome}.`);
    if (!aindaExiste) { console.error('Abortando - estado inesperado.'); process.exit(1); }
  }

  console.log('\n== Exclusão real pelo proprietario (esperado: sucesso) ==');
  const delPropResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginProp.access_token}`,
      Prefer: 'return=minimal',
    },
  });
  const delPropRaw = await delPropResp.text();
  let delPropData = null;
  if (delPropRaw) {
    try { delPropData = JSON.parse(delPropRaw); } catch (e) { delPropData = delPropRaw; }
  }
  console.log('HTTP status:', delPropResp.status);
  console.log('Resposta:', delPropRaw ? JSON.stringify(delPropData, null, 2) : '(corpo vazio)');

  console.log('-- Confirmação final via proprietario --');
  const leituraFinal = await lerComoProprietario(loginProp.access_token, id);
  console.log('HTTP status (leitura):', leituraFinal.status);
  console.log('Resposta (leitura):', JSON.stringify(leituraFinal.data, null, 2));
  const foiExcluido = Array.isArray(leituraFinal.data) && leituraFinal.data.length === 0;
  console.log(foiExcluido ? '✅ PASS: proprietario excluiu com sucesso, registro não existe mais.' : '🚨 FALHA: registro ainda existe depois da exclusão do proprietario.');
  if (!foiExcluido) {
    console.error('Encerrando com erro - confirmação final ainda encontrou o registro.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
