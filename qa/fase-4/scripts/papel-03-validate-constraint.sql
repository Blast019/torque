-- QA Fase 4.2 (usuarios_empresas) - Passo 3 do plano de adição da constraint
-- usuarios_empresas_papel_check.
--
-- Pré-requisito: papel-02-add-constraint-not-valid.sql já executado, e
-- papel-01-pre-checagem.sql já confirmou 0 linhas fora do conjunto
-- aprovado (proprietario, admin, gerente, usuario). Se alguma linha antiga
-- estiver fora do conjunto, este VALIDATE falha - resolver essa linha
-- antes de rodar este script, não improvisar uma correção aqui.
--
-- VALIDATE CONSTRAINT varre as linhas já existentes em usuarios_empresas e
-- torna a constraint efetivamente "validada" (convalidated = true),
-- passando a garantir integridade também para os dados que já existiam
-- antes do Passo 2.
--
-- AINDA NÃO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorização explícita do usuário.

BEGIN;

ALTER TABLE public.usuarios_empresas
VALIDATE CONSTRAINT usuarios_empresas_papel_check;

COMMIT;
