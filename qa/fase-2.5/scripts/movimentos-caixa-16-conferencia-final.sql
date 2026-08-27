-- EXECUTADO E APROVADO — CONFERÊNCIA FINAL DA FASE 2.5.5 (ver STATUS.md).
--
-- QA Fase 2.5.5 (movimentos_caixa) - SQL de CONFERÊNCIA FINAL, 100% SOMENTE
-- LEITURA. Não faz nenhum INSERT/UPDATE/DELETE/ALTER/DROP/CREATE.
--
-- Objetivo: reunir num único lugar a evidência final de que RLS, policies,
-- constraints e dados de movimentos_caixa estão no estado esperado depois de
-- todo o plano de correção (scripts 11 a 15). Esta conferência já foi
-- EXECUTADA E APROVADA em 26/08/2026 (ver STATUS.md) - a Fase 2.5.5 está
-- concluída.
--
-- Rodar no SQL Editor do Supabase e colar o resultado de cada bloco de volta na
-- conversa.

-- =====================================================================
-- BLOCO A - RLS ativo em movimentos_caixa
-- =====================================================================
select relrowsecurity as rls_ativo, relforcerowsecurity as rls_forcado
from pg_class
where oid = 'public.movimentos_caixa'::regclass;

-- =====================================================================
-- BLOCO B - As 5 policies esperadas, com operação e expressão completa
-- =====================================================================
select
  polname as policy_name,
  case polcmd
    when 'r' then 'SELECT'
    when 'a' then 'INSERT'
    when 'w' then 'UPDATE'
    when 'd' then 'DELETE'
    when '*' then 'ALL'
    else polcmd::text
  end as operacao,
  pg_get_expr(polqual, polrelid) as using_expr,
  pg_get_expr(polwithcheck, polrelid) as with_check_expr
from pg_policy
where polrelid = 'public.movimentos_caixa'::regclass
order by
  case polname
    when 'caixa_select_proprietario' then 1
    when 'caixa_insert_proprietario' then 2
    when 'caixa_insert_despesa_admin_gerente' then 3
    when 'caixa_update_proprietario' then 4
    when 'caixa_delete_proprietario' then 5
    else 6
  end;

-- =====================================================================
-- BLOCO C - As duas UNIQUE(id, empresa_id), validadas
-- =====================================================================
select
  conrelid::regclass as tabela,
  conname as constraint_name,
  pg_get_constraintdef(oid) as definicao_completa,
  convalidated as validada
from pg_constraint
where contype = 'u'
  and conname in ('ordens_servico_id_empresa_unique', 'pecas_id_empresa_unique')
order by tabela;

-- =====================================================================
-- BLOCO D - As duas FKs compostas, validadas, com definição completa
-- =====================================================================
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definicao_completa,
  convalidated as validada
from pg_constraint
where conrelid = 'public.movimentos_caixa'::regclass
  and conname in ('movimentos_caixa_os_mesma_empresa_fkey', 'movimentos_caixa_peca_mesma_empresa_fkey')
order by constraint_name;

-- =====================================================================
-- BLOCO E - Contagem de vínculos cruzados remanescentes (esperado: 0 e 0)
-- =====================================================================
select 'os_id' as tipo_vinculo, count(*) as total
from public.movimentos_caixa m
join public.ordens_servico o on o.id = m.os_id
where m.os_id is not null and m.empresa_id <> o.empresa_id
union all
select 'peca_id' as tipo_vinculo, count(*) as total
from public.movimentos_caixa m
join public.pecas p on p.id = m.peca_id
where m.peca_id is not null and m.empresa_id <> p.empresa_id;

-- =====================================================================
-- BLOCO F - Estado final dos 7 movimentos relevantes da Fase 2.5.5
-- =====================================================================
select
  id, empresa_id, tipo, categoria, descricao, valor, data,
  os_id, peca_id, created_at
from public.movimentos_caixa
where id in (
  'fa281de3-42ea-4834-8745-c894f1987461', -- saida original, proprietario (script 03)
  'a07c3b4a-8453-4844-bd5f-4392d210a1b4', -- saida, proprietario (script 03)
  '3ca638ba-a5d9-41a9-8675-6dab3313916a', -- saida, admin (script 03)
  '70e22929-8220-4532-b946-29e34b032536', -- evidência os_id cruzado (script 07), ajustada (script 14)
  '335d3415-77cd-497c-95f0-0e19d3335a47', -- evidência peca_id cruzado (script 08), ajustada (script 14)
  '618681f7-28bb-43e9-ac43-653bbabad708', -- movimento temporário os_id (script 15)
  '16c8ef47-b08a-45ee-9ba1-467ebd622326'  -- movimento temporário peca_id (script 15)
)
order by created_at;

-- =====================================================================
-- BLOCO G - Confirmação de existência/ausência (cliente, OS e peça do script 15)
-- =====================================================================
select 'cliente' as tabela, id, nome as identificacao, empresa_id
from public.clientes
where id = 'b13bf8c2-d8da-403b-9021-f3c727edaa76' -- esperado: 1 linha (existe)
union all
select 'ordens_servico' as tabela, id, descricao as identificacao, empresa_id
from public.ordens_servico
where id = '665c1116-8b29-4403-8b08-e74a33c9e2d4' -- esperado: 0 linhas (não existe)
union all
select 'pecas' as tabela, id, nome as identificacao, empresa_id
from public.pecas
where id = '8f34b4ff-1da9-49d6-a9bd-79fa261c6831'; -- esperado: 0 linhas (não existe)
