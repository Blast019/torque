-- QA Fase 4.2 (usuarios_empresas) - Passo 1 do plano de adição da constraint
-- usuarios_empresas_papel_check.
--
-- Objetivo: confirmar, antes de criar qualquer constraint, se existe hoje
-- alguma linha em usuarios_empresas com papel fora do conjunto aprovado
-- (proprietario, admin, gerente, usuario) ou com papel nulo.
--
-- Este script é só leitura (SELECT) - não altera nada. Só deve-se seguir
-- para o Passo 2 (papel-02-add-constraint-not-valid.sql) depois de conferir
-- o resultado abaixo com o usuário.

-- Visão geral por valor distinto de papel
SELECT papel, COUNT(*) AS quantidade
FROM public.usuarios_empresas
GROUP BY papel
ORDER BY papel NULLS FIRST;

-- Linhas que violariam a constraint proposta (deve retornar 0 linhas)
SELECT id, empresa_id, usuario_id, papel
FROM public.usuarios_empresas
WHERE papel IS NULL
   OR papel NOT IN ('proprietario', 'admin', 'gerente', 'usuario');
