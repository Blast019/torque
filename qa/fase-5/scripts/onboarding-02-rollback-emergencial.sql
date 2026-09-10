-- FASE 5.1 (Incremento 1 - Alternativa A) - ROLLBACK EMERGENCIAL.
--
-- Reverte, no banco, exatamente o que onboarding-01-migracao-autorizacao.sql
-- alterou em termos de EXECUTE das RPCs de criacao de empresa - devolve o
-- sistema ao comportamento de antes daquela migracao (as duas RPCs antigas
-- voltam a ser chamaveis por authenticated; a RPC nova e a auxiliar deixam
-- de ser chamaveis por authenticated).
--
-- Este script NAO desfaz tudo o que a migracao 01 fez - de proposito:
--   - NAO apaga public.autorizacoes_onboarding nem nenhuma linha dela
--     (nenhuma autorizacao, historico de consumo/revogacao e preservado);
--   - NAO restaura o INSERT direto revogado em public.empresas e
--     public.usuarios_empresas para anon/authenticated (esse fechamento
--     de acesso direto continua valendo, independente do rollback das
--     RPCs de criacao de empresa);
--   - NAO faz DROP de nenhuma tabela, funcao, constraint ou indice.
--
-- Este script cobre SOMENTE a camada de banco. O rollback do frontend
-- (reverter index.html/script.js para a versao anterior, republicar) e o
-- rollback de qualquer configuracao do Supabase Auth (ex.: reativar
-- "Allow new users to sign up", se algum dia tiver sido desativado) sao
-- ETAPAS SEPARADAS, fora deste arquivo - ver qa/fase-5/STATUS.md.
--
-- AINDA NAO EXECUTADO. NAO RODAR sem autorizacao explicita separada do
-- usuario. Este arquivo e so a proposta de rollback para revisao.

BEGIN;

-- =====================================================================
-- PRECHECKS NAO DESTRUTIVOS - confirma que ha o que reverter, com as
-- assinaturas exatas, antes de qualquer REVOKE/GRANT.
-- =====================================================================
DO $$
BEGIN
  IF to_regprocedure('public.criar_empresa_com_vinculo(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: criar_empresa_com_vinculo(text,text,text) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: criar_nova_empresa_com_vinculo(uuid,text,text,text,uuid) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.criar_empresa_autorizada(uuid, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: criar_empresa_autorizada(uuid,text,text,text) nao encontrada - nada da migracao 01 parece ter sido aplicado. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.existe_autorizacao_onboarding_pendente()') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: existe_autorizacao_onboarding_pendente() nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.autorizacoes_onboarding') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.autorizacoes_onboarding nao encontrada. Abortando sem alterar nada.';
  END IF;
END $$;

-- =====================================================================
-- Fecha a RPC nova e a auxiliar para authenticated (reverte o que a
-- migracao 01 abriu). postgres e service_role NUNCA sao tocados aqui -
-- preservados exatamente como estavam.
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.criar_empresa_autorizada(uuid, text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.existe_autorizacao_onboarding_pendente() FROM authenticated;

-- =====================================================================
-- Restaura o EXECUTE das duas RPCs antigas para authenticated (reverte o
-- que a migracao 01 revogou). Nenhum outro grant delas e alterado.
-- =====================================================================
GRANT EXECUTE ON FUNCTION public.criar_empresa_com_vinculo(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) TO authenticated;

-- =====================================================================
-- Deliberadamente NAO incluido neste rollback (ver cabecalho):
--   - Nenhum DROP TABLE / DROP FUNCTION.
--   - Nenhum DELETE em public.autorizacoes_onboarding.
--   - Nenhum GRANT INSERT de volta em public.empresas ou
--     public.usuarios_empresas para anon/authenticated - o fechamento do
--     INSERT direto e uma protecao independente, que continua valendo
--     mesmo com as RPCs antigas restauradas.
-- =====================================================================

-- =====================================================================
-- CONSULTAS FINAIS SOMENTE DE VERIFICACAO (nenhuma escrita)
-- =====================================================================
SELECT has_function_privilege('authenticated', 'public.criar_empresa_com_vinculo(text, text, text)', 'EXECUTE') AS antiga_1_restaurada,
       has_function_privilege('authenticated', 'public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid)', 'EXECUTE') AS antiga_2_restaurada;
-- Esperado apos este rollback: true e true.

SELECT has_function_privilege('authenticated', 'public.criar_empresa_autorizada(uuid, text, text, text)', 'EXECUTE') AS nova_rpc_ainda_executavel,
       has_function_privilege('authenticated', 'public.existe_autorizacao_onboarding_pendente()', 'EXECUTE') AS leitura_auxiliar_ainda_executavel;
-- Esperado apos este rollback: false e false.

SELECT has_table_privilege('authenticated', 'public.empresas', 'INSERT') AS authenticated_pode_inserir_empresas_direto,
       has_table_privilege('authenticated', 'public.usuarios_empresas', 'INSERT') AS authenticated_pode_inserir_vinculos_direto;
-- Esperado apos este rollback: false e false (o fechamento do INSERT direto
-- NAO e revertido por este script).

SELECT count(*) AS total_autorizacoes_preservadas FROM public.autorizacoes_onboarding;
-- Esperado apos este rollback: numero igual ao existente antes do rollback
-- (nenhuma linha excluida).

COMMIT;
