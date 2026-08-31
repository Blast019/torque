-- QA Fase 4.2 (usuarios_empresas) - Rollback específico da constraint
-- usuarios_empresas_papel_check.
--
-- Remove somente esta constraint, sem afetar mais nada em
-- usuarios_empresas (colunas, FKs, RLS, dados). Pode ser executado em
-- qualquer estágio - com a constraint ainda NOT VALID (após o Passo 2) ou
-- já validada (após o Passo 3).
--
-- Usar apenas se for necessário desfazer a constraint depois de criada -
-- não faz parte do fluxo normal de aplicação.
--
-- AINDA NÃO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorização explícita do usuário.

BEGIN;

ALTER TABLE public.usuarios_empresas
DROP CONSTRAINT usuarios_empresas_papel_check;

COMMIT;
