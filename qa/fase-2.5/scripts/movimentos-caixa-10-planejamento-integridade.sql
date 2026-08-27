-- QA Fase 2.5.5 (movimentos_caixa) - SQL de planejamento, 100% SOMENTE LEITURA.
-- Não faz nenhum INSERT/UPDATE/DELETE/ALTER/DROP/CREATE - só consulta o catálogo
-- do Postgres e os dados existentes. Objetivo: reunir tudo o que é preciso saber
-- ANTES de desenhar um plano de correção para as duas falhas de integridade
-- multiempresa já confirmadas nos scripts 07 (os_id) e 08 (peca_id).
--
-- Rodar no SQL Editor do Supabase e colar o resultado de cada bloco de volta na
-- conversa. Nenhuma correção deve ser aplicada a partir só deste resultado - ele é
-- só insumo para o planejamento, que ainda precisa ser apresentado e aprovado.

-- =====================================================================
-- BLOCO A - Constraints atuais de movimentos_caixa (todas, qualquer tipo)
-- =====================================================================
-- Nome, tipo, definição completa e se já está validada. Cobre PK, FK, UNIQUE,
-- CHECK etc. - inclui as FKs de os_id, peca_id e empresa_id para comparação lado
-- a lado (as duas primeiras são simples, sem checar empresa_id; a de empresa_id
-- é a FK para "empresas").
select
  con.conname as constraint_name,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    when 'x' then 'EXCLUDE'
    else con.contype::text
  end as tipo,
  pg_get_constraintdef(con.oid) as definicao_completa,
  con.convalidated as validada
from pg_constraint con
where con.conrelid = 'public.movimentos_caixa'::regclass
order by tipo, constraint_name;

-- =====================================================================
-- BLOCO B - Constraints UNIQUE em ordens_servico e pecas
-- =====================================================================
-- Verifica especificamente se já existe UNIQUE(id, empresa_id) em alguma das
-- duas - pré-requisito para uma eventual FK composta (mesmo padrão já usado em
-- fornecedores e funcionarios).
select
  conrelid::regclass as tabela,
  conname as constraint_name,
  pg_get_constraintdef(oid) as definicao_completa
from pg_constraint
where contype = 'u'
  and conrelid in ('public.ordens_servico'::regclass, 'public.pecas'::regclass)
order by tabela, constraint_name;

-- =====================================================================
-- BLOCO C - Movimentações com os_id cruzado (empresa_id diferente da OS)
-- =====================================================================
select
  m.id as movimento_id,
  m.empresa_id as movimento_empresa_id,
  m.descricao as movimento_descricao,
  m.os_id,
  o.empresa_id as os_empresa_id,
  o.descricao as os_descricao
from public.movimentos_caixa m
join public.ordens_servico o on o.id = m.os_id
where m.os_id is not null
  and m.empresa_id <> o.empresa_id
order by m.created_at;

-- =====================================================================
-- BLOCO D - Movimentações com peca_id cruzado (empresa_id diferente da peça)
-- =====================================================================
select
  m.id as movimento_id,
  m.empresa_id as movimento_empresa_id,
  m.descricao as movimento_descricao,
  m.peca_id,
  p.empresa_id as peca_empresa_id,
  p.nome as peca_nome
from public.movimentos_caixa m
join public.pecas p on p.id = m.peca_id
where m.peca_id is not null
  and m.empresa_id <> p.empresa_id
order by m.created_at;

-- =====================================================================
-- BLOCO E - Contagem total de vínculos cruzados, por tipo
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
-- BLOCO F - Conferência específica das evidências (scripts 07 e 08)
-- =====================================================================
select
  m.id, m.empresa_id, m.tipo, m.categoria, m.descricao, m.valor, m.data,
  m.os_id, m.peca_id, m.created_at
from public.movimentos_caixa m
where m.id in (
  '70e22929-8220-4532-b946-29e34b032536', -- evidência script 07 (os_id cruzado)
  '335d3415-77cd-497c-95f0-0e19d3335a47'  -- evidência script 08 (peca_id cruzado)
)
order by m.created_at;

-- =====================================================================
-- BLOCO G - Versão do PostgreSQL
-- =====================================================================
-- Confirma suporte à sintaxe de uma eventual FK composta com
-- ON DELETE SET NULL (os_id) / ON DELETE SET NULL (peca_id) sem zerar
-- empresa_id (coluna especificada dentro do SET NULL) - sintaxe de coluna
-- específica no ON DELETE SET NULL requer Postgres 15+.
select version() as versao_completa, current_setting('server_version_num') as versao_numerica;
