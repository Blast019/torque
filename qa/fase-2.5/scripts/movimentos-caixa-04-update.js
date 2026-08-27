// QA Fase 2.5.5 (movimentos_caixa) - teste funcional de UPDATE.
// EXECUTADO E APROVADO EM 26/08/2026 (ver STATUS.md).
//
// Testa os 4 papéis num único fluxo sequencial, com CONFIRMAÇÃO INDEPENDENTE do
// estado sempre pela conta proprietario (única com policy de SELECT) depois de
// cada tentativa - exigência explícita do usuário, porque o PostgREST responde
// HTTP 200 com [] tanto pra "bloqueado pela policy" quanto poderia (em outro
// contexto) significar outra coisa; só a releitura confirma o que realmente
// aconteceu no banco.
//
// Ordem: proprietario edita primeiro (sucesso esperado) -> depois admin, usuario e
// sem_vinculo tentam editar por cima (bloqueio esperado, HTTP 200 com [] pela
// policy caixa_update_proprietario) -> depois de CADA tentativa bloqueada, relê o
// registro como proprietario e confirma que o valor continua sendo o que o
// proprietario definiu (não o que o papel bloqueado tentou escrever).
//
// Variável obrigatória: TARGET_MOVIMENTO_ID=<uuid> (linha de movimentos_caixa da
// Empresa A a ser usada no teste - não precisa ter sido criada pelo proprietario,
// a policy não é por dono da linha).
//
// Rodar:
//   TARGET_MOVIMENTO_ID=<uuid> node --env-file=qa/.env qa/fase-2.5/scripts/movimentos-caixa-04-update.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const PROPRIETARIO = { email: EMAIL_PROPRIETARIO, password: SENHA_QA };
const OUTROS_PAPEIS = [
  { nome: 'admin', email: EMAIL_ADMIN },
  { nome: 'usuario', email: EMAIL_USUARIO },
  { nome: 'sem_vinculo', email: EMAIL_SEM_VINCULO },
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
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${id}&select=*`, {
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

  console.log(`\n== 1) Login proprietario e UPDATE normal (esperado: sucesso) ==`);
  const loginProp = await login(PROPRIETARIO.email, PROPRIETARIO.password);
  const descricaoProprietario = '[TESTE] QA Fase 2.5.5 - editado por proprietario';
  const patchProp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${loginProp.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ descricao: descricaoProprietario }),
  });
  // return=minimal não devolve corpo em sucesso (204 vazio) - ler como texto e só
  // tentar JSON.parse se houver conteúdo (ex.: corpo de erro em bloqueio).
  const patchPropRaw = await patchProp.text();
  let patchPropData = null;
  if (patchPropRaw) {
    try { patchPropData = JSON.parse(patchPropRaw); } catch (e) { patchPropData = patchPropRaw; }
  }
  console.log('HTTP status:', patchProp.status);
  console.log('Resposta:', patchPropRaw ? JSON.stringify(patchPropData, null, 2) : '(corpo vazio)');

  // Com return=minimal o PATCH não devolve a linha - a confirmação de que o UPDATE
  // do proprietario realmente foi aplicado é feita por SELECT independente (mesma
  // função usada para confirmar os bloqueios abaixo), não pelo corpo do PATCH.
  console.log('-- Confirmação do UPDATE do proprietario via SELECT independente --');
  const leituraProp = await lerComoProprietario(loginProp.access_token, id);
  console.log('HTTP status (leitura):', leituraProp.status);
  console.log('Resposta (leitura):', JSON.stringify(leituraProp.data, null, 2));
  const propAplicado = patchProp.ok && Array.isArray(leituraProp.data) && leituraProp.data.length > 0 && leituraProp.data[0].descricao === descricaoProprietario;
  console.log(propAplicado ? '✅ UPDATE do proprietario aplicado e confirmado.' : '🚨 FALHA: UPDATE do proprietario não foi aplicado como esperado.');
  if (!propAplicado) { console.error('Abortando - o baseline do teste depende do proprietario conseguir editar.'); process.exit(1); }

  let algumaFalha = false;

  for (const papel of OUTROS_PAPEIS) {
    console.log(`\n== Tentativa de UPDATE por ${papel.nome} (esperado: bloqueado) ==`);
    const loginPapel = await login(papel.email, SENHA_QA);
    const descricaoTentativa = `[TESTE] QA Fase 2.5.5 - editado por ${papel.nome} (NAO deveria aplicar)`;
    const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/movimentos_caixa?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${loginPapel.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ descricao: descricaoTentativa }),
    });
    const patchRaw = await patchResp.text();
    let patchData = null;
    if (patchRaw) {
      try { patchData = JSON.parse(patchRaw); } catch (e) { patchData = patchRaw; }
    }
    console.log('HTTP status:', patchResp.status);
    console.log('Resposta:', patchRaw ? JSON.stringify(patchData, null, 2) : '(corpo vazio)');

    console.log(`-- Confirmação independente via proprietario --`);
    const leitura = await lerComoProprietario(loginProp.access_token, id);
    console.log('HTTP status (leitura):', leitura.status);
    console.log('Resposta (leitura):', JSON.stringify(leitura.data, null, 2));
    const inalterado = Array.isArray(leitura.data) && leitura.data.length > 0 && leitura.data[0].descricao === descricaoProprietario;
    if (inalterado) {
      console.log(`✅ PASS: ${papel.nome} foi bloqueado - descricao continua "${descricaoProprietario}".`);
    } else {
      console.log(`🚨 FALHA: descricao mudou depois da tentativa de ${papel.nome} - esperado "${descricaoProprietario}", encontrado "${leitura.data?.[0]?.descricao}".`);
      algumaFalha = true;
    }
  }

  console.log('\nNOTA: nenhuma outra linha de movimentos_caixa foi tocada por este script além do id informado em TARGET_MOVIMENTO_ID.');

  if (algumaFalha) {
    console.error('\n🚨 Ao menos um papel bloqueado conseguiu alterar o registro - encerrando com erro.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
