-- QA Fase 4.2 (usuarios_empresas) - RPC alterar_papel_usuario_empresa
--
-- Altera o papel de um vinculo ativo existente. Chamador precisa ter
-- vinculo ativo proprietario/admin na mesma empresa do vinculo alvo.
-- Ninguem altera o proprio papel (bloqueado mesmo para proprietario).
-- admin so mexe em vinculos que hoje sao gerente/usuario, e so pode
-- definir gerente ou usuario (nunca promove a admin/proprietario, nunca
-- mexe em outro admin/proprietario). Bloqueia rebaixar o unico
-- proprietario ativo da empresa.
--
-- Mesmo padrao das demais RPCs desta fase: SECURITY DEFINER,
-- SET search_path TO '', autenticacao so via auth.uid(), REVOKE ALL de
-- public/anon, GRANT EXECUTE so para authenticated/postgres/service_role.
-- Trava por pg_advisory_xact_lock chaveada por empresa_id, com o vinculo
-- alvo localizado antes da trava (so para saber a empresa) e RE-LIDO depois
-- da trava, para evitar corrida entre a localizacao e a alteracao.
--
-- Codigos de erro: TRQ31 nao_autenticado, TRQ34 entrada_invalida,
-- TRQ35 sem_permissao, TRQ36 operacao_nao_permitida (proprio papel),
-- TRQ37 vinculo_nao_encontrado, TRQ38 vinculo_inativo,
-- TRQ39 ultimo_proprietario_protegido.
--
-- AINDA NAO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorizacao explicita do usuario.

BEGIN;

create or replace function public.alterar_papel_usuario_empresa(
  p_vinculo_id uuid,
  p_novo_papel text
)
returns table(
  vinculo_id uuid,
  empresa_id uuid,
  usuario_id uuid,
  papel_anterior text,
  papel_novo text
)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_chamador_id          uuid;
  v_novo_papel           text;
  v_empresa_id           uuid;
  v_usuario_alvo         uuid;
  v_papel_atual          text;
  v_ativo_atual          boolean;
  v_lock_key             bigint;
  v_papel_chamador       text;
  v_proprietarios_ativos bigint;
begin
  -- 1) Autenticação
  v_chamador_id := auth.uid();
  if v_chamador_id is null then
    raise exception using
      errcode = 'TRQ31',
      message = 'nao_autenticado',
      detail  = 'auth.uid() retornou null nesta chamada.';
  end if;

  -- 2) Validação de entrada
  if p_vinculo_id is null then
    raise exception using
      errcode = 'TRQ34',
      message = 'entrada_invalida',
      detail  = 'p_vinculo_id e obrigatorio.';
  end if;

  v_novo_papel := nullif(trim(p_novo_papel), '');
  if v_novo_papel is null or v_novo_papel not in ('proprietario', 'admin', 'gerente', 'usuario') then
    raise exception using
      errcode = 'TRQ34',
      message = 'entrada_invalida',
      detail  = 'p_novo_papel deve ser proprietario, admin, gerente ou usuario.';
  end if;

  -- 3) Localiza o vinculo alvo (antes da trava, so para saber a empresa)
  select ue.empresa_id into v_empresa_id
  from public.usuarios_empresas ue
  where ue.id = p_vinculo_id;

  if v_empresa_id is null then
    raise exception using
      errcode = 'TRQ37',
      message = 'vinculo_nao_encontrado',
      detail  = 'nenhum vinculo corresponde a p_vinculo_id.';
  end if;

  -- 4) Trava por empresa
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(v_empresa_id::text), 1, 16))::bit(64)::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- 5) Re-le o vinculo alvo dentro da trava (estado pode ter mudado)
  select ue.usuario_id, ue.papel, ue.ativo
    into v_usuario_alvo, v_papel_atual, v_ativo_atual
  from public.usuarios_empresas ue
  where ue.id = p_vinculo_id;

  if v_usuario_alvo is null then
    raise exception using
      errcode = 'TRQ37',
      message = 'vinculo_nao_encontrado',
      detail  = 'nenhum vinculo corresponde a p_vinculo_id.';
  end if;

  if not v_ativo_atual then
    raise exception using
      errcode = 'TRQ38',
      message = 'vinculo_inativo',
      detail  = 'nao e possivel alterar o papel de um vinculo inativo.';
  end if;

  -- 6) Ninguem edita o proprio papel
  if v_usuario_alvo = v_chamador_id then
    raise exception using
      errcode = 'TRQ36',
      message = 'operacao_nao_permitida',
      detail  = 'ninguem pode alterar o proprio papel.';
  end if;

  -- 7) Permissao do chamador
  select ue.papel into v_papel_chamador
  from public.usuarios_empresas ue
  where ue.empresa_id = v_empresa_id
    and ue.usuario_id = v_chamador_id
    and ue.ativo = true;

  if v_papel_chamador is null or v_papel_chamador not in ('proprietario', 'admin') then
    raise exception using
      errcode = 'TRQ35',
      message = 'sem_permissao',
      detail  = 'chamador precisa ter vinculo ativo proprietario ou admin nesta empresa.';
  end if;

  if v_papel_chamador = 'admin' and (
    v_papel_atual not in ('gerente', 'usuario')
    or v_novo_papel not in ('gerente', 'usuario')
  ) then
    raise exception using
      errcode = 'TRQ35',
      message = 'sem_permissao',
      detail  = 'admin so altera vinculos gerente/usuario, e so pode definir gerente ou usuario.';
  end if;

  -- 8) Protecao do ultimo proprietario ativo
  if v_papel_atual = 'proprietario' and v_novo_papel <> 'proprietario' then
    select count(*) into v_proprietarios_ativos
    from public.usuarios_empresas ue
    where ue.empresa_id = v_empresa_id
      and ue.papel = 'proprietario'
      and ue.ativo = true;

    if v_proprietarios_ativos <= 1 then
      raise exception using
        errcode = 'TRQ39',
        message = 'ultimo_proprietario_protegido',
        detail  = 'nao e possivel rebaixar o unico proprietario ativo da empresa.';
    end if;
  end if;

  -- 9) Aplica a mudanca
  update public.usuarios_empresas
    set papel = v_novo_papel
    where id = p_vinculo_id;

  return query
    select p_vinculo_id, v_empresa_id, v_usuario_alvo, v_papel_atual, v_novo_papel;
  return;
end;
$function$;

alter function public.alterar_papel_usuario_empresa(uuid, text) owner to postgres;

revoke all on function public.alterar_papel_usuario_empresa(uuid, text) from public;
revoke all on function public.alterar_papel_usuario_empresa(uuid, text) from anon;
grant execute on function public.alterar_papel_usuario_empresa(uuid, text) to authenticated;
grant execute on function public.alterar_papel_usuario_empresa(uuid, text) to postgres;
grant execute on function public.alterar_papel_usuario_empresa(uuid, text) to service_role;

COMMIT;
