-- QA Fase 2.5.5 (movimentos_caixa) - SQL de conferência, 100% SOMENTE LEITURA.
-- Não faz nenhum ALTER/INSERT/UPDATE/DELETE - só consulta o catálogo do Postgres.
-- Rodar no SQL Editor do Supabase e colar o resultado de cada query de volta na
-- conversa, para fechar a investigação antes de definir a matriz esperada e criar
-- os scripts de QA funcional.

-- 1) Policies de movimentos_caixa (uma linha por policy: operação, roles, using/check).
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
order by operacao;

-- 2) RLS está ativo na tabela?
select relrowsecurity as rls_ativo, relforcerowsecurity as rls_forcado
from pg_class
where oid = 'public.movimentos_caixa'::regclass;

-- 3) Colunas de movimentos_caixa (nome, tipo, nullable, default).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'movimentos_caixa'
order by ordinal_position;

-- 4) Foreign keys que ENVOLVEM movimentos_caixa (como origem ou destino), com a
--    regra de ON DELETE de cada uma - importante pra entender o que acontece com
--    uma movimentação quando a OS ou a peça referenciada é excluída.
select
  con.conname as constraint_name,
  con.conrelid::regclass as tabela_origem,
  con.confrelid::regclass as tabela_referenciada,
  pg_get_constraintdef(con.oid) as definicao,
  case con.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else con.confdeltype::text
  end as on_delete
from pg_constraint con
where con.contype = 'f'
  and (con.conrelid = 'public.movimentos_caixa'::regclass
       or con.confrelid = 'public.movimentos_caixa'::regclass);

-- 5) Só para planejamento de uma eventual correção futura: ordens_servico e pecas
--    já têm UNIQUE(id, empresa_id)? (fornecedores e funcionarios já têm, criado nas
--    correções das Fases 2.5.3 e 2.5.4 - útil saber se o mesmo padrão de FK composta
--    já seria viável aqui sem passo extra, caso movimentos_caixa precise dele.)
select conrelid::regclass as tabela, conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where contype = 'u'
  and conrelid in ('public.ordens_servico'::regclass, 'public.pecas'::regclass);
