// QA Fase 2.5.4 (funcionarios) - passos 3 e 5 do plano de correção da falha de
// integridade multiempresa, combinados num único fluxo.
// PREPARADO E EXECUTADO SOB AUTORIZAÇÃO (ver STATUS.md).
//
// Em vez de simplesmente zerar funcionario_id na OS cruzada de teste via UPDATE
// direto, este script resolve a violação da FK composta
// (ordens_servico_funcionario_mesma_empresa_fkey) da MESMA forma que aconteceria no
// uso real do sistema - religando a OS a um funcionário legítimo da própria empresa -
// e, ao excluir esse funcionário temporário logo em seguida, também comprova de
// ponta a ponta o comportamento ON DELETE SET NULL (funcionario_id) da FK composta
// sobre um registro real.
//
// Fluxo:
//  0) Login como admin da Empresa A.
//  1) Snapshot ANTES: lê o estado completo da OS cruzada de teste
//     (4db4b201-a169-4a28-8da8-3b2139b0cf6b) para comparação posterior.
//  2) Cria um funcionário TEMPORÁRIO legítimo na Empresa A.
//  3) Vincula esse funcionário à OS de teste (PATCH funcionario_id).
//  4) Confirma que o vínculo foi aplicado (GET da OS).
//  5) Exclui o funcionário temporário.
//  6) Snapshot DEPOIS: lê a OS de novo e confirma:
//       - a OS continua existindo;
//       - empresa_id não mudou (670162c6-3437-4cd5-b581-0229d57d33e2);
//       - funcionario_id virou NULL (efeito do ON DELETE SET NULL (funcionario_id));
//       - nenhuma outra coluna mudou em relação ao snapshot do passo 1 (exceto
//         funcionario_id, que é o único campo que deveria mudar).
//
// NÃO usa nem toca na OS protegida da Fase 2.5.1 (97c2709a-8678-4322-a00c-d15129cd0708).
// NÃO exclui a OS de teste (4db4b201-...) - só atualiza funcionario_id nela.
// NÃO exclui o funcionário de teste da Empresa B (1d39ca25-...) - esse não é tocado
// por este script.
// NÃO faz nenhuma limpeza adicional além do que o próprio fluxo descreve (a exclusão
// do funcionário TEMPORÁRIO criado aqui é parte do teste, não uma limpeza).
//
// Pré-requisito: passos 1 e 2 do plano já concluídos (FK composta criada e
// confirmada bloqueando novos vínculos cruzados - ver
// funcionarios-07-fix-integridade-01-add-constraint.sql e
// funcionarios-08-fix-integridade-02-reteste.js).
//
// Rodar: node --env-file=qa/.env qa/fase-2.5/scripts/funcionarios-09-fix-integridade-03-on-delete-set-null.js

const { SUPABASE_URL, SUPABASE_ANON_KEY, SENHA_QA, EMAIL_PROPRIETARIO, EMAIL_ADMIN, EMAIL_USUARIO, EMAIL_SEM_VINCULO, EMAIL_PROPRIETARIO_ANTIGO } = require('./qa-env');

const EMPRESA_A = '670162c6-3437-4cd5-b581-0229d57d33e2'; // QA Fase 2.5 - Empresa A
const OS_CRUZADA_ID = '4db4b201-a169-4a28-8da8-3b2139b0cf6b'; // OS de teste com vínculo cruzado (criada no funcionarios-06)

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

async function getOs(accessToken, id) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${id}&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

function compararSnapshots(antes, depois) {
  const diffs = [];
  const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  for (const chave of chaves) {
    if (antes[chave] !== depois[chave]) {
      diffs.push({ campo: chave, antes: antes[chave], depois: depois[chave] });
    }
  }
  return diffs;
}

async function main() {
  const email = EMAIL_ADMIN;
  const password = SENHA_QA;

  console.log(`\n== 0) Login: ${email} (admin, Empresa A) ==`);
  const login1 = await login(email, password);
  console.log('Login OK. user_id =', login1.user?.id);
  const accessToken = login1.access_token;

  console.log(`\n== 1) Snapshot ANTES da OS de teste (${OS_CRUZADA_ID}) ==`);
  const antesResp = await getOs(accessToken, OS_CRUZADA_ID);
  console.log('HTTP status:', antesResp.status);
  console.log('Resposta:', JSON.stringify(antesResp.data, null, 2));
  if (!Array.isArray(antesResp.data) || antesResp.data.length === 0) {
    console.error('\nOS de teste não encontrada - abortando.');
    process.exit(1);
  }
  const osAntes = antesResp.data[0];

  console.log('\n== 2) Criar funcionário TEMPORÁRIO legítimo na Empresa A ==');
  const criaFuncResp = await fetch(`${SUPABASE_URL}/rest/v1/funcionarios`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      empresa_id: EMPRESA_A,
      nome: '[TESTE] QA Fase 2.5.4 - funcionário temporário (ON DELETE SET NULL)',
      cargo: 'Mecânico',
      telefone: '11955554444',
    }),
  });
  const criaFuncData = await criaFuncResp.json();
  console.log('HTTP status:', criaFuncResp.status);
  console.log('Resposta:', JSON.stringify(criaFuncData, null, 2));
  if (!criaFuncResp.ok || !Array.isArray(criaFuncData) || criaFuncData.length === 0) {
    console.error('\nNão foi possível criar o funcionário temporário - abortando.');
    process.exit(1);
  }
  const funcionarioTempId = criaFuncData[0].id;
  console.log('Funcionário temporário criado:', funcionarioTempId);

  console.log(`\n== 3) Vincular o funcionário temporário à OS de teste (${OS_CRUZADA_ID}) ==`);
  const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${OS_CRUZADA_ID}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ funcionario_id: funcionarioTempId }),
  });
  const patchData = await patchResp.json();
  console.log('HTTP status:', patchResp.status);
  console.log('Resposta:', JSON.stringify(patchData, null, 2));

  console.log('\n== 4) Confirmar que o vínculo foi aplicado (GET da OS) ==');
  const confirmaResp = await getOs(accessToken, OS_CRUZADA_ID);
  console.log('HTTP status:', confirmaResp.status);
  console.log('Resposta:', JSON.stringify(confirmaResp.data, null, 2));
  const vinculoAplicado =
    Array.isArray(confirmaResp.data) &&
    confirmaResp.data.length > 0 &&
    confirmaResp.data[0].funcionario_id === funcionarioTempId;
  if (!vinculoAplicado) {
    console.error('\nO vínculo com o funcionário temporário NÃO foi confirmado - abortando antes de excluir o funcionário.');
    process.exit(1);
  }
  console.log('✅ Vínculo confirmado: funcionario_id da OS =', funcionarioTempId);

  console.log('\n== 5) Excluir o funcionário temporário ==');
  const delResp = await fetch(`${SUPABASE_URL}/rest/v1/funcionarios?id=eq.${funcionarioTempId}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'return=representation',
    },
  });
  let delData = null;
  try { delData = await delResp.json(); } catch (e) { /* corpo vazio */ }
  console.log('HTTP status:', delResp.status);
  console.log('Resposta:', JSON.stringify(delData, null, 2));

  console.log('\n== 6) Snapshot DEPOIS da OS de teste ==');
  const depoisResp = await getOs(accessToken, OS_CRUZADA_ID);
  console.log('HTTP status:', depoisResp.status);
  console.log('Resposta:', JSON.stringify(depoisResp.data, null, 2));

  if (!Array.isArray(depoisResp.data) || depoisResp.data.length === 0) {
    console.log('\n🚨 FALHA: a OS de teste não existe mais - isso NÃO deveria acontecer (ON DELETE SET NULL, não CASCADE).');
    return;
  }
  const osDepois = depoisResp.data[0];

  console.log('\n== RESUMO ==');
  console.log('- OS continua existindo:', true);
  console.log('- empresa_id inalterado:', osDepois.empresa_id === EMPRESA_A, `(${osDepois.empresa_id})`);
  console.log('- funcionario_id virou NULL:', osDepois.funcionario_id === null, `(${JSON.stringify(osDepois.funcionario_id)})`);

  const diffs = compararSnapshots(osAntes, osDepois).filter((d) => d.campo !== 'funcionario_id');
  if (diffs.length === 0) {
    console.log('- Nenhuma outra coluna foi alterada além de funcionario_id: ✅ confirmado');
  } else {
    console.log('- ⚠️ Outras colunas mudaram além de funcionario_id:');
    console.log(JSON.stringify(diffs, null, 2));
  }

  console.log('\nNOTA: a OS protegida 97c2709a-8678-4322-a00c-d15129cd0708 (Fase 2.5.1) não foi usada nem tocada. O funcionário de teste da Empresa B (1d39ca25-eb60-4e87-a6a0-441d0e4d0475) não foi tocado. A OS de teste (4db4b201-...) não foi excluída, apenas teve funcionario_id atualizado.');
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
