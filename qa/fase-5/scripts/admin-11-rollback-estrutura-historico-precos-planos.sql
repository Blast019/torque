-- Incremento 3.2 - Rollback SOMENTE da estrutura criada pelo admin-08
-- (coluna/constraints novas em public.planos + a tabela
-- public.planos_historico_precos inteira). Exige que o admin-10 (rollback
-- do seed) ja' tenha sido executado antes - este script recusa rodar se
-- ainda houver qualquer linha em planos_historico_precos.
--
-- SCRIPT PREPARADO, AINDA NAO EXECUTADO. Rollback de EMERGENCIA da
-- estrutura do admin-08 (executado com sucesso em producao em 14/09/2026
-- - ver qa/fase-5/STATUS.md, checkpoint "Incremento 3.2: admin-08 e
-- admin-09 executados com sucesso"). Este script so' deve ser rodado se
-- for necessario reverter planos_historico_precos e as alteracoes de
-- public.planos, e somente depois do admin-10 - nao faz parte do fluxo
-- normal do Incremento 3.2.
--
-- btree_gist NAO e' removida por este script (nem por nenhum outro deste
-- projeto) - ela foi instalada manualmente pelo usuario e nunca
-- pertenceu ao escopo deste rollback. Este script remove somente o que o
-- admin-08 de fato criou/alterou.
--
-- empresas.plano permanece INTOCADA por este script.

BEGIN;

-- =============================================================
-- PRECHECKS (fail-closed) sobre planos_historico_precos
-- =============================================================
DO $$
DECLARE
  v_total_linhas               bigint;
  v_relkind                     "char";
  v_total_fks_apontando         integer;
  v_total_views_dependentes     integer;
BEGIN
  -- 1) planos_historico_precos precisa existir e estar VAZIA.
  IF to_regclass('public.planos_historico_precos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos_historico_precos nao existe - nada para reverter. Abortando sem alterar nada.';
  END IF;

  SELECT count(*) INTO v_total_linhas FROM public.planos_historico_precos;
  IF v_total_linhas <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos_historico_precos tem % linha(s) - rode o admin-10 (rollback do seed) primeiro. Abortando sem apagar nenhum dado.', v_total_linhas;
  END IF;

  -- 2) Confirma relkind = tabela comum (nao outro tipo de relacao).
  SELECT c.relkind INTO v_relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'planos_historico_precos';

  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos_historico_precos nao e uma tabela comum (relkind=%). Abortando sem alterar nada.', v_relkind;
  END IF;

  -- 3) Nenhuma foreign key de outra tabela apontando para
  --    planos_historico_precos.
  SELECT count(*) INTO v_total_fks_apontando
    FROM pg_catalog.pg_constraint
   WHERE confrelid = 'public.planos_historico_precos'::regclass AND contype = 'f';

  IF v_total_fks_apontando <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: existem % foreign key(s) de outras tabelas apontando para planos_historico_precos. Abortando sem alterar nada.', v_total_fks_apontando;
  END IF;

  -- 4) Nenhuma view/materialized view dependente (catalogado via
  --    pg_depend + pg_rewrite, nao busca textual).
  SELECT count(*) INTO v_total_views_dependentes
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite rw
      ON rw.oid = d.objid AND d.classid = 'pg_catalog.pg_rewrite'::regclass
   WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
     AND d.refobjid = 'public.planos_historico_precos'::regclass;

  IF v_total_views_dependentes <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: existem % view(s)/regra(s) dependendo de planos_historico_precos. Abortando sem alterar nada.', v_total_views_dependentes;
  END IF;
END $$;

-- SEM CASCADE de proposito - qualquer dependencia nao prevista faz o
-- DROP falhar, sem apagar objetos relacionados.
DROP TABLE public.planos_historico_precos;

-- =============================================================
-- Remove SOMENTE o que o admin-08 adicionou em public.planos - nunca a
-- tabela em si (criada pelo admin-07, fora do escopo deste rollback).
-- =============================================================
DO $$
BEGIN
  IF to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos nao existe - nada para reverter nela. Abortando (ROLLBACK).';
  END IF;
END $$;

ALTER TABLE public.planos DROP CONSTRAINT IF EXISTS planos_preco_nao_negativo;
ALTER TABLE public.planos DROP CONSTRAINT IF EXISTS planos_moeda_suportada;
ALTER TABLE public.planos DROP COLUMN IF EXISTS moeda;

-- =============================================================
-- VERIFICACAO FINAL (fail-closed)
-- =============================================================
DO $$
DECLARE
  v_total_colunas      integer;
  v_total_constraints   integer;
BEGIN
  IF to_regclass('public.planos_historico_precos') IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos_historico_precos ainda existe apos o DROP. Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_total_colunas
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.planos'::regclass AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_total_colunas <> 6 THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos tem % coluna(s) apos o rollback, esperado 6 (estrutura original do admin-07). Abortando (ROLLBACK).', v_total_colunas;
  END IF;

  SELECT count(*) INTO v_total_constraints
    FROM pg_catalog.pg_constraint WHERE conrelid = 'public.planos'::regclass;

  IF v_total_constraints <> 2 THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos tem % constraint(s) apos o rollback, esperado 2 (PK + UNIQUE originais do admin-07). Abortando (ROLLBACK).', v_total_constraints;
  END IF;

  RAISE NOTICE 'Rollback da estrutura OK: planos_historico_precos removida; public.planos restaurada para a estrutura original de 6 colunas / 2 constraints (admin-07). A extensao btree_gist NAO foi removida - nunca pertenceu a este rollback.';
END $$;

COMMIT;
