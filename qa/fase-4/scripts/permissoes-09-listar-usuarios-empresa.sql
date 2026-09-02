-- Fase 4.3 - RPC de leitura para o frontend de Configuracoes/Usuarios.
--
-- usuarios_empresas nao armazena e-mail e o schema auth nao e exposto ao
-- navegador. Esta RPC retorna os vinculos da empresa com o e-mail da conta
-- somente quando o chamador possui vinculo ativo proprietario/admin nela.
-- Nenhuma escrita e realizada.
--
-- Codigos de erro: TRQ51 nao_autenticado, TRQ54 entrada_invalida,
-- TRQ55 sem_permissao.
--
-- AINDA NAO EXECUTADO. Rodar manualmente no SQL Editor do Supabase apos
-- revisao e autorizacao explicita do usuario.

BEGIN;

create or replace function public.listar_usuarios_empresa(p_empresa_id uuid)
returns table(
  vinculo_id uuid,
  usuario_id uuid,
  email text,
  papel text,
  ativo boolean,
  criado_em timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_chamador_id uuid;
begin
  v_chamador_id := auth.uid();

  if v_chamador_id is null then
    raise exception using
      errcode = 'TRQ51',
      message = 'nao_autenticado',
      detail = 'auth.uid() retornou null nesta chamada.';
  end if;

  if p_empresa_id is null then
    raise exception using
      errcode = 'TRQ54',
      message = 'entrada_invalida',
      detail = 'p_empresa_id e obrigatorio.';
  end if;

  if not exists (
    select 1
    from public.usuarios_empresas ue
    where ue.empresa_id = p_empresa_id
      and ue.usuario_id = v_chamador_id
      and ue.ativo = true
      and ue.papel in ('proprietario', 'admin')
  ) then
    raise exception using
      errcode = 'TRQ55',
      message = 'sem_permissao',
      detail = 'chamador precisa ter vinculo ativo proprietario ou admin nesta empresa.';
  end if;

  return query
    select
      ue.id,
      ue.usuario_id,
      u.email::text,
      ue.papel,
      ue.ativo,
      ue.criado_em
    from public.usuarios_empresas ue
    join auth.users u on u.id = ue.usuario_id
    where ue.empresa_id = p_empresa_id
    order by ue.ativo desc, lower(u.email), ue.id;
end;
$function$;

alter function public.listar_usuarios_empresa(uuid) owner to postgres;

revoke all on function public.listar_usuarios_empresa(uuid) from public;
revoke all on function public.listar_usuarios_empresa(uuid) from anon;
grant execute on function public.listar_usuarios_empresa(uuid) to authenticated;
grant execute on function public.listar_usuarios_empresa(uuid) to postgres;
grant execute on function public.listar_usuarios_empresa(uuid) to service_role;

COMMIT;
