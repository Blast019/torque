-- QA Fase 4.2 (usuarios_empresas) - Passo 4 do plano de adição da constraint
-- usuarios_empresas_papel_check.
--
-- Confirma o texto exato da constraint e seu estado de validação
-- (convalidated = false logo após o Passo 2, NOT VALID; true depois do
-- Passo 3, VALIDATE CONSTRAINT). Script só de leitura - não altera nada.

SELECT
  conname,
  pg_get_constraintdef(oid) AS definicao,
  convalidated AS validada
FROM pg_constraint
WHERE conname = 'usuarios_empresas_papel_check'
  AND conrelid = 'public.usuarios_empresas'::regclass;
