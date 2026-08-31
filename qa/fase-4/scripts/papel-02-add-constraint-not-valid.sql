-- QA Fase 4.2 (usuarios_empresas) - Passo 2 do plano de adição da constraint
-- usuarios_empresas_papel_check.
--
-- Pré-requisito: papel-01-pre-checagem.sql já executado e conferido com o
-- usuário, confirmando 0 linhas fora do conjunto aprovado
-- (proprietario, admin, gerente, usuario).
--
-- Cria a constraint como NOT VALID: passa a valer imediatamente para
-- INSERT/UPDATE novos em usuarios_empresas, mas o Postgres não varre as
-- linhas já existentes agora - por isso este ALTER TABLE não falha mesmo
-- que exista alguma linha antiga fora do conjunto aprovado. A validação
-- retroativa dos dados existentes é o Passo 3 (VALIDATE CONSTRAINT), em
-- script separado.
--
-- Checagem defensiva: aborta com RAISE EXCEPTION se já existir uma
-- constraint com esse nome em usuarios_empresas, em vez de tentar recriar
-- silenciosamente.
--
-- AINDA NÃO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorização explícita do usuário.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usuarios_empresas_papel_check'
      AND conrelid = 'public.usuarios_empresas'::regclass
  ) THEN
    RAISE EXCEPTION 'Abortando: já existe uma constraint chamada usuarios_empresas_papel_check em public.usuarios_empresas.';
  END IF;
END $$;

ALTER TABLE public.usuarios_empresas
ADD CONSTRAINT usuarios_empresas_papel_check
CHECK (papel IN ('proprietario', 'admin', 'gerente', 'usuario'))
NOT VALID;

COMMIT;
