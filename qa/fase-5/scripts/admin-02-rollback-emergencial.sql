-- FASE 5 (Incremento 2.1) - Fundacao de administradores da plataforma -
-- ROLLBACK EMERGENCIAL.
--
-- Reverte exatamente o que admin-01-fundacao-administradores-plataforma.sql
-- criou: as quatro RPCs novas e a tabela public.administradores_plataforma.
--
-- Este script SO se aplica enquanto nenhum administrador foi cadastrado por
-- admin-03-bootstrap-primeiro-administrador.sql - se algum administrador ja
-- foi concedido e esta em uso, aplicar este rollback exigiria decidir antes,
-- separadamente, o que fazer com esse cadastro (fora do escopo deste
-- arquivo). Por isso o precheck abaixo aborta se houver qualquer linha na
-- tabela.
--
-- Este script NAO altera public.autorizacoes_onboarding (nenhuma linha
-- dela, nenhuma constraint, nenhum grant) - essa tabela e suas duas RPCs
-- (criar_empresa_autorizada, existe_autorizacao_onboarding_pendente) sao do
-- Incremento 1 e nao fazem parte deste rollback.
--
-- Este script cobre SOMENTE a camada de banco. Nao ha frontend nem Edge
-- Function neste incremento para reverter.
--
-- AINDA NAO EXECUTADO. NAO RODAR sem autorizacao explicita separada do
-- usuario. Este arquivo e so a proposta de rollback para revisao.

BEGIN;

-- =====================================================================
-- PRECHECKS NAO DESTRUTIVOS - confirma que ha exatamente o que reverter,
-- com as assinaturas exatas, e que nenhum administrador foi cadastrado,
-- antes de qualquer DROP.
-- =====================================================================
DO $$
DECLARE
  v_total_administradores bigint;
BEGIN
  IF to_regclass('public.administradores_plataforma') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.administradores_plataforma nao encontrada - nada da migracao admin-01 parece ter sido aplicado. Abortando sem alterar nada.';
  END IF;

  EXECUTE 'SELECT count(*) FROM public.administradores_plataforma' INTO v_total_administradores;
  IF v_total_administradores > 0 THEN
    RAISE EXCEPTION 'Precheck falhou: existem % administrador(es) cadastrado(s) em public.administradores_plataforma. Este rollback so cobre o estado "sem nenhum administrador cadastrado" - decida separadamente o que fazer com o(s) cadastro(s) existente(s) antes de reverter. Abortando sem alterar nada.', v_total_administradores;
  END IF;

  IF to_regprocedure('public.sou_administrador_plataforma()') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: sou_administrador_plataforma() nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.admin_listar_autorizacoes_onboarding(boolean)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_listar_autorizacoes_onboarding(boolean) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.admin_autorizar_onboarding(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_autorizar_onboarding(text,integer) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.admin_revogar_autorizacao_onboarding(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_revogar_autorizacao_onboarding(uuid) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
END $$;

-- =====================================================================
-- DROP das quatro RPCs novas (nenhuma delas e usada por nenhum outro
-- objeto do banco fora desta migracao - Incremento 2.1 nao tem frontend
-- nem Edge Function ainda que dependa delas).
-- =====================================================================
DROP FUNCTION public.admin_revogar_autorizacao_onboarding(uuid);
DROP FUNCTION public.admin_autorizar_onboarding(text, integer);
DROP FUNCTION public.admin_listar_autorizacoes_onboarding(boolean);
DROP FUNCTION public.sou_administrador_plataforma();

-- =====================================================================
-- DROP da tabela nova - seguro porque o precheck acima ja confirmou que
-- esta vazia (nenhum administrador cadastrado).
-- =====================================================================
DROP TABLE public.administradores_plataforma;

-- =====================================================================
-- CONSULTAS FINAIS SOMENTE DE VERIFICACAO (nenhuma escrita)
-- =====================================================================
SELECT to_regclass('public.administradores_plataforma') AS tabela_apos_rollback;
-- Esperado apos este rollback: null.

SELECT to_regprocedure('public.sou_administrador_plataforma()') AS verificacao_apos_rollback,
       to_regprocedure('public.admin_listar_autorizacoes_onboarding(boolean)') AS listagem_apos_rollback,
       to_regprocedure('public.admin_autorizar_onboarding(text, integer)') AS autorizar_apos_rollback,
       to_regprocedure('public.admin_revogar_autorizacao_onboarding(uuid)') AS revogar_apos_rollback;
-- Esperado apos este rollback: null nas quatro.

SELECT to_regclass('public.autorizacoes_onboarding') AS onboarding_preservada,
       to_regprocedure('public.criar_empresa_autorizada(uuid, text, text, text)') AS criar_empresa_autorizada_preservada,
       to_regprocedure('public.existe_autorizacao_onboarding_pendente()') AS existe_pendente_preservada;
-- Esperado apos este rollback: as tres colunas NAO nulas (Incremento 1
-- intacto, nao afetado por este rollback).

COMMIT;
