-- FASE 3 — Contexto da empresa
-- Conferência somente leitura das duas RPCs de criação de empresa.
-- Apenas SELECT — nenhuma alteração de schema, dados, owner ou grants.

-- 1) Existência, assinatura, VOLATILE, SECURITY DEFINER e owner das duas RPCs
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as assinatura,
  case p.provolatile
    when 'v' then 'VOLATILE'
    when 's' then 'STABLE'
    when 'i' then 'IMMUTABLE'
  end as volatilidade,
  p.prosecdef as security_definer,
  p.proowner::regrole::text as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('criar_empresa_com_vinculo', 'criar_nova_empresa_com_vinculo')
order by p.proname;

-- 2) ACL completa das duas RPCs, com PUBLIC explicitado (grantee = 0)
select
  p.proname,
  case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end as grantee,
  g.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(p.proacl) as g(grantor, grantee, privilege_type, is_grantable)
where n.nspname = 'public'
  and p.proname in ('criar_empresa_com_vinculo', 'criar_nova_empresa_com_vinculo')
order by p.proname, grantee, privilege_type;

-- 3) Confirmação explícita de ausência de anon/PUBLIC nas duas RPCs
--    (esperado: tem_public = false e tem_anon = false nas duas linhas)
select
  p.proname,
  bool_or(g.grantee = 0) as tem_public,
  bool_or(g.grantee = 'anon'::regrole) as tem_anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(p.proacl) as g(grantor, grantee, privilege_type, is_grantable)
where n.nspname = 'public'
  and p.proname in ('criar_empresa_com_vinculo', 'criar_nova_empresa_com_vinculo')
group by p.proname
order by p.proname;
