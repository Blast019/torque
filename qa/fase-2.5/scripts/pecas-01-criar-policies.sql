-- QA Fase 2.5.2 (pecas/estoque) - resolução da pendência crítica registrada no STATUS.md.
-- Antes desta migração, a tabela pecas só tinha a policy pecas_update_usuario_operador (UPDATE).
-- Com RLS habilitado (confirmado: rowsecurity = true) e sem SELECT/INSERT/DELETE, ninguém
-- conseguia listar, cadastrar ou excluir peças via API - apesar do frontend (script.js) já
-- usar essas 4 operações ativamente (carregarDados, salvarPecaBtn, excluirPeca).
--
-- Regras definidas com o usuário em 24/08:
-- - SELECT: qualquer papel vinculado à empresa (mesmo padrão de ordens_servico)
-- - INSERT: proprietario/admin/usuario/gerente (usuario_pode_operar_empresa - exclui só sem_vinculo)
-- - DELETE: só proprietario/admin/gerente (usuario_pode_excluir_empresa - mesmo padrão de
--           ordens_servico; usuario NÃO pode excluir peças, decisão explícita do usuário)
--
-- Executado manualmente no SQL Editor do Supabase em 24/08. Resultado: "Success. No rows returned".

CREATE POLICY pecas_select_usuario_vinculado
ON public.pecas
FOR SELECT
USING (usuario_pertence_empresa(empresa_id, auth.uid()));

CREATE POLICY pecas_insert_usuario_operador
ON public.pecas
FOR INSERT
WITH CHECK (usuario_pode_operar_empresa(empresa_id, auth.uid()));

CREATE POLICY pecas_delete_usuario_gestor
ON public.pecas
FOR DELETE
USING (usuario_pode_excluir_empresa(empresa_id, auth.uid()));
