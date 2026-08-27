-- CORREÇÃO — trocar o proprietário da Empresa QA A do UUID antigo para o novo.
-- NÃO EXECUTAR SEM AUTORIZAÇÃO EXPLÍCITA.
--
-- Altera SOMENTE:
--   1) empresas.owner_id da Empresa QA A (670162c6-...)
--   2) usuarios_empresas.usuario_id do vínculo id=76083c64-... (papel proprietario)
-- de '1bf87a5a-1657-42d7-89c0-c48ce9b4735b' (torque.owner.teste@gmail.com, e-mail não confirmado)
-- para        '5f026bf2-226b-45f6-8474-4176fefbfe77' (torque.owner.qa@gmail.com, confirmado)
--
-- Cada UPDATE tem WHERE com id exato + valor antigo esperado, como trava dupla:
-- se por algum motivo o registro não estiver exatamente como o inventário indicou,
-- o UPDATE não afeta nenhuma linha (rowcount = 0) em vez de alterar algo errado.
--
-- Não toca em admin (59482850-...) nem usuario (7c53ac17-...), não altera policies,
-- funções, estrutura, nem qualquer outra empresa/vínculo/OS.
--
-- Script único com commit embutido nesta mesma execução (mesmo padrão já
-- validado no fixtures-01). Revisar o resultado do SELECT final antes de
-- considerar concluído.

begin;

with upd_empresa as (
  update empresas
  set owner_id = '5f026bf2-226b-45f6-8474-4176fefbfe77'
  where id = '670162c6-3437-4cd5-b581-0229d57d33e2'
    and owner_id = '1bf87a5a-1657-42d7-89c0-c48ce9b4735b'
  returning id, nome, owner_id
),
upd_vinculo as (
  update usuarios_empresas
  set usuario_id = '5f026bf2-226b-45f6-8474-4176fefbfe77'
  where id = '76083c64-a383-4afc-8752-0db23b9d80fb'
    and usuario_id = '1bf87a5a-1657-42d7-89c0-c48ce9b4735b'
    and papel = 'proprietario'
  returning id, empresa_id, usuario_id, papel, ativo
)
select
  (select count(*) from upd_empresa) as empresas_atualizadas,   -- esperado: 1
  (select owner_id from upd_empresa) as novo_owner_id,           -- esperado: 5f026bf2-...
  (select count(*) from upd_vinculo) as vinculos_atualizados,    -- esperado: 1
  (select usuario_id from upd_vinculo) as novo_usuario_id;       -- esperado: 5f026bf2-...

commit;

-- Depois de rodar, validar com:
-- select id, nome, owner_id from empresas where id = '670162c6-3437-4cd5-b581-0229d57d33e2';
-- select id, empresa_id, usuario_id, papel, ativo from usuarios_empresas where id = '76083c64-a383-4afc-8752-0db23b9d80fb';
-- select usuario_id, papel from usuarios_empresas where empresa_id = '670162c6-3437-4cd5-b581-0229d57d33e2' order by papel; -- deve mostrar as 3 linhas, admin e usuario intactas
