-- QA Fase 4.2 (usuarios_empresas) - correcao pontual de role da policy
-- usuarios_empresas_select_proprietario_admin
--
-- Achado na conferencia pos-execucao do script 04
-- (permissoes-04-ajustar-rls-select.sql): a policy foi criada sem clausula
-- TO, entao o Postgres aplicou roles = {public} (todos os roles, inclusive
-- anon), diferente das outras 4 policies de usuarios_empresas
-- (usuarios_empresas_select_proprio, insert/update/delete_proprietario),
-- que sao explicitamente TO authenticated. Nao era um vazamento de dados
-- (a funcao usuario_e_proprietario_ou_admin_ativo usa auth.uid(), que e
-- NULL para anon, entao a policy ja retornava false para anon na pratica),
-- mas era uma inconsistencia real de escopo em relacao ao padrao das
-- demais policies da tabela.
--
-- Este script NAO altera o script 04 (permanece como registro do que foi
-- originalmente executado) - e uma correcao pontual, separada, que
-- substitui so esta 1 policy, mantendo exatamente a mesma USING. Nao mexe
-- na funcao auxiliar nem em nenhuma outra policy.
--
-- AINDA NAO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorizacao explicita do usuario.

BEGIN;

DROP POLICY IF EXISTS usuarios_empresas_select_proprietario_admin ON public.usuarios_empresas;

CREATE POLICY usuarios_empresas_select_proprietario_admin
ON public.usuarios_empresas
FOR SELECT
TO authenticated
USING (
  public.usuario_e_proprietario_ou_admin_ativo(
    usuarios_empresas.empresa_id
  )
);

COMMIT;
