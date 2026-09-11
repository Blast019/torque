-- FASE 5 (Incremento 3.1) - Visao Geral do Painel Administrativo Central -
-- ROLLBACK EMERGENCIAL.
--
-- Reverte exatamente o que admin-04-visao-geral-empresas.sql criou: a RPC
-- public.admin_visao_geral_empresas(integer).
--
-- Este script NAO toca em nenhuma tabela nem em nenhum dado - a RPC
-- revertida e puramente de leitura (STABLE), nunca escreveu nada em
-- public.empresas, public.usuarios_empresas ou qualquer outra tabela.
-- Remove exclusivamente essa unica funcao, sem afetar nenhuma outra RPC
-- administrativa (sou_administrador_plataforma,
-- admin_listar_autorizacoes_onboarding, admin_autorizar_onboarding,
-- admin_revogar_autorizacao_onboarding) nem o Incremento 1
-- (autorizacoes_onboarding, criar_empresa_autorizada).
--
-- AINDA NAO EXECUTADO. NAO RODAR sem autorizacao explicita separada do
-- usuario. Este arquivo e so a proposta de rollback para revisao.

BEGIN;

-- =====================================================================
-- PRECHECK NAO DESTRUTIVO - confirma que ha o que reverter, com a
-- assinatura exata, antes de qualquer DROP.
-- =====================================================================
DO $$
BEGIN
  IF to_regprocedure('public.admin_visao_geral_empresas(integer)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_visao_geral_empresas(integer) nao encontrada com a assinatura esperada - nada da migracao admin-04 parece ter sido aplicado (ou ja foi revertido). Abortando sem alterar nada.';
  END IF;
END $$;

-- =====================================================================
-- Remove exclusivamente a RPC desta migracao - nenhuma tabela, nenhuma
-- outra funcao, nenhum dado.
-- =====================================================================
DROP FUNCTION public.admin_visao_geral_empresas(integer);

-- =====================================================================
-- CONSULTA FINAL SOMENTE DE VERIFICACAO (nenhuma escrita)
-- =====================================================================
SELECT to_regprocedure('public.admin_visao_geral_empresas(integer)') AS funcao_apos_rollback;
-- Esperado apos este rollback: null.

COMMIT;
