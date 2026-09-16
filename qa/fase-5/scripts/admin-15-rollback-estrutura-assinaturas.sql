-- Incremento 3.2 (Alternativa C) - Rollback SOMENTE da estrutura criada
-- pelo admin-12 (a tabela public.assinaturas inteira). Exige que o
-- admin-14 (rollback do backfill) ja' tenha sido executado antes - este
-- script recusa rodar se ainda houver qualquer linha em assinaturas.
--
-- SCRIPT PREPARADO, AINDA NAO EXECUTADO. Rollback de EMERGENCIA da
-- estrutura - so' deve ser rodado se for necessario reverter
-- public.assinaturas por completo, e somente depois do admin-14 - nao faz
-- parte do fluxo normal deste incremento.
--
-- Nao toca em planos, planos_historico_precos, empresas ou em nenhuma RPC
-- - somente DROP TABLE public.assinaturas, sem CASCADE.

BEGIN;

-- =============================================================
-- PRECHECKS (fail-closed) sobre public.assinaturas
-- =============================================================
DO $$
DECLARE
  v_total_linhas            bigint;
  v_relkind                  "char";
  v_total_fks_apontando        integer;
  v_total_views_dependentes      integer;
BEGIN
  -- 1) assinaturas precisa existir e estar VAZIA.
  IF to_regclass('public.assinaturas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.assinaturas nao existe - nada para reverter. Abortando sem alterar nada.';
  END IF;

  SELECT count(*) INTO v_total_linhas FROM public.assinaturas;
  IF v_total_linhas <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: public.assinaturas tem % linha(s) - rode o admin-14 (rollback do backfill) primeiro. Abortando sem apagar nenhum dado.', v_total_linhas;
  END IF;

  -- 2) Confirma relkind = tabela comum.
  SELECT c.relkind INTO v_relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'assinaturas';

  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION 'Precheck falhou: public.assinaturas nao e uma tabela comum (relkind=%). Abortando sem alterar nada.', v_relkind;
  END IF;

  -- 3) Nenhuma foreign key de outra tabela apontando para assinaturas
  --    (nenhuma tabela filha existe ainda - assinaturas_historico e'
  --    trabalho futuro do Incremento 3.3/3.4).
  SELECT count(*) INTO v_total_fks_apontando
    FROM pg_catalog.pg_constraint
   WHERE confrelid = 'public.assinaturas'::regclass AND contype = 'f';

  IF v_total_fks_apontando <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: existem % foreign key(s) de outras tabelas apontando para assinaturas. Abortando sem alterar nada.', v_total_fks_apontando;
  END IF;

  -- 4) Nenhuma view/materialized view dependente.
  SELECT count(*) INTO v_total_views_dependentes
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite rw
      ON rw.oid = d.objid AND d.classid = 'pg_catalog.pg_rewrite'::regclass
   WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
     AND d.refobjid = 'public.assinaturas'::regclass;

  IF v_total_views_dependentes <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: existem % view(s)/regra(s) dependendo de assinaturas. Abortando sem alterar nada.', v_total_views_dependentes;
  END IF;
END $$;

-- SEM CASCADE de proposito - qualquer dependencia nao prevista faz o
-- DROP falhar, sem apagar objetos relacionados.
DROP TABLE public.assinaturas;

-- =============================================================
-- VERIFICACAO FINAL (fail-closed)
-- =============================================================
DO $$
BEGIN
  IF to_regclass('public.assinaturas') IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.assinaturas ainda existe apos o DROP. Abortando (ROLLBACK).';
  END IF;

  IF to_regclass('public.empresas') IS NULL OR to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.empresas ou public.planos nao existem mais - este script nunca deveria toca-las. Abortando (ROLLBACK).';
  END IF;

  RAISE NOTICE 'Rollback da estrutura OK: public.assinaturas removida. empresas, planos, planos_historico_precos e todas as RPCs NAO foram tocadas.';
END $$;

COMMIT;
