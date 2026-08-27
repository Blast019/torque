-- RECONSTRUÇÃO DOS FIXTURES PERMANENTES — FASE 2.5
-- NÃO EXECUTAR SEM AUTORIZAÇÃO EXPLÍCITA.
--
-- Cria: Empresa QA A (com vínculos proprietario/admin/usuario),
--        Empresa QA B (owner_id = sem_vinculo + vínculo proprietario correspondente),
--        1 cliente mínimo na Empresa QA A.
-- Não toca em nenhuma outra tabela, policy, função ou dado existente.
-- Não gera novos usuários Auth — reaproveita os 4 UUIDs já conhecidos.
--
-- IMPORTANTE: script único, com "commit" embutido no final desta mesma
-- execução (não depende de o SQL Editor manter a transação aberta entre
-- execuções separadas). A validação acontece DEPOIS, rodando o
-- fixtures-02-validacao-pos-criacao.sql logo em seguida. Se algo estiver
-- errado, a correção é via DELETE direcionado nas linhas criadas, não rollback.
-- Se qualquer INSERT falhar por violação de constraint, a transação inteira
-- é desfeita automaticamente (nada fica parcialmente criado).

begin;

with nova_empresa_a as (
  insert into empresas (owner_id, nome)
  values ('1bf87a5a-1657-42d7-89c0-c48ce9b4735b', 'QA Fase 2.5 - Empresa A')
  returning id
),
nova_empresa_b as (
  insert into empresas (owner_id, nome)
  values ('a27f1e18-f80d-49ac-95bd-5fdd8f4e0f4f', 'QA Fase 2.5 - Empresa B')
  returning id
),
vinculos_empresa_a as (
  insert into usuarios_empresas (empresa_id, usuario_id, papel, ativo)
  select nova_empresa_a.id, v.usuario_id, v.papel, true
  from nova_empresa_a,
  (values
    ('1bf87a5a-1657-42d7-89c0-c48ce9b4735b'::uuid, 'proprietario'),
    ('59482850-db77-49ef-9bd1-e06ddce1e058'::uuid, 'admin'),
    ('7c53ac17-cc17-4cba-9a66-e3af1a170ff9'::uuid, 'usuario')
  ) as v(usuario_id, papel)
  returning *
),
vinculo_empresa_b as (
  insert into usuarios_empresas (empresa_id, usuario_id, papel, ativo)
  select nova_empresa_b.id, 'a27f1e18-f80d-49ac-95bd-5fdd8f4e0f4f'::uuid, 'proprietario', true
  from nova_empresa_b
  returning *
),
novo_cliente as (
  insert into clientes (empresa_id, nome, ativo)
  select nova_empresa_a.id, '[TESTE] Cliente QA Fase 2.5', true
  from nova_empresa_a
  returning *
)
select
  (select id from nova_empresa_a) as empresa_qa_a_id,
  (select id from nova_empresa_b) as empresa_qa_b_id,
  (select id from novo_cliente) as cliente_qa_id,
  (select count(*) from vinculos_empresa_a) as vinculos_criados_empresa_a,
  (select count(*) from vinculo_empresa_b) as vinculos_criados_empresa_b;

commit;

-- Depois de rodar este script, execute o fixtures-02-validacao-pos-criacao.sql
-- pra conferir tudo (isolamento do sem_vinculo, contagens, Admim intocada, etc).
