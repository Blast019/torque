-- QA Fase 4.2 (usuarios_empresas) - RPC remover_usuario_empresa
--
-- Remove (soft delete via ativo=false) um vinculo ativo. Autorremocao e
-- permitida sem checar hierarquia (qualquer usuario pode sair da propria
-- empresa); remover o vinculo de outra pessoa exige que o chamador tenha
-- vinculo ativo proprietario/admin na mesma empresa, com a mesma
-- restricao de hierarquia de alterar_papel_usuario_empresa (admin so
-- remove gerente/usuario). Bloqueia remover o unico proprietario ativo da
-- empresa, mesmo em autorremocao. Nunca faz DELETE.
--
-- Mesmo padrao das demais RPCs desta fase: SECURITY DEFINER,
-- SET search_path TO '', autenticacao so via auth.uid(), REVOKE ALL de
-- public/anon, GRANT EXECUTE so para authenticated/postgres/service_role.
-- Trava por pg_advisory_xact_lock chaveada por empresa_id, com o vinculo
-- alvo localizado antes da trava (so para saber a empresa) e RE-LIDO depois
-- da trava, para evitar corrida entre a localizacao e a remocao.
--
-- Codigos de erro: TRQ41 nao_autenticado, TRQ44 entrada_invalida,
-- TRQ45 sem_permissao, TRQ46 operacao_nao_permitida (ja inativo),
-- TRQ47 vinculo_nao_encontrado, TRQ49 ultimo_proprietario_protegido.
--
-- AINDA NAO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorizacao explicita do usuario.

BEGIN;

create or replace function public.remover_usuario_empresa(
  p_vinculo_id uuid
)
returns table(
  vinculo_id uuid,
  empresa_id uuid,
  usuario_id uuid,
  papel text,
  ativo boolean
)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_chamador_id          uuid;
  v_empresa_id           uuid;
  v_usuario_alvo         uuid;
  v_papel_alvo           text;
  v_ativo_atual          boolean;
  v_lock_key             bigint;
  v_papel_chamador       text;
  v_proprietarios_ativos bigint;
begin
  -- 1) Autenticação
  v_chamador_id := auth.uid();
  if v_chamador_id is null then
    raise exception using
      errcode = 'TRQ41',
      message = 'nao_autenticado',
      detail  = 'auth.uid() retornou null nesta chamada.';
  end if;

  -- 2) Validação de entrada
  if p_vinculo_id is null then
    raise exception using
      errcode = 'TRQ44',
      message = 'entrada_invalida',
      detail  = 'p_vinculo_id e obrigatorio.';
  end if;

  -- 3) Localiza o vinculo alvo (antes da trava, so para saber a empresa)
  select ue.empresa_id into v_empresa_id
  from public.usuarios_empresas ue
  where ue.id = p_vinculo_id;

  if v_empresa_id is null then
    raise exception using
      errcode = 'TRQ47',
      message = 'vinculo_nao_encontrado',
      detail  = 'nenhum vinculo corresponde a p_vinculo_id.';
  end if;

  -- 4) Trava por empresa
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(v_empresa_id::text), 1, 16))::bit(64)::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- 5) Re-le o vinculo alvo dentro da trava
  select ue.usuario_id, ue.papel, ue.ativo
    into v_usuario_alvo, v_papel_alvo, v_ativo_atual
  from public.usuarios_empresas ue
  where ue.id = p_vinculo_id;

  if v_usuario_alvo is null then
    raise exception using
      errcode = 'TRQ47',
      message = 'vinculo_nao_encontrado',
      detail  = 'nenhum vinculo corresponde a p_vinculo_id.';
  end if;

  if not v_ativo_atual then
    raise exception using
      errcode = 'TRQ46',
      message = 'operacao_nao_permitida',
      detail  = 'vinculo ja esta inativo.';
  end if;

  -- 6) Autorremocao e permitida sem checar hierarquia; remover outra
  --    pessoa exige vinculo ativo proprietario/admin do chamador, com a
  --    mesma restricao de hierarquia de alterar_papel_usuario_empresa.
  if v_usuario_alvo <> v_chamador_id then
    select ue.papel into v_papel_chamador
    from public.usuarios_empresas ue
    where ue.empresa_id = v_empresa_id
      and ue.usuario_id = v_chamador_id
      and ue.ativo = true;

    if v_papel_chamador is null or v_papel_chamador not in ('proprietario', 'admin') then
      raise exception using
        errcode = 'TRQ45',
        message = 'sem_permissao',
        detail  = 'chamador precisa ter vinculo ativo proprietario ou admin nesta empresa.';
    end if;

    if v_papel_chamador = 'admin' and v_papel_alvo not in ('gerente', 'usuario') then
      raise exception using
        errcode = 'TRQ45',
        message = 'sem_permissao',
        detail  = 'admin so remove vinculos gerente/usuario.';
    end if;
  end if;

  -- 7) Protecao do ultimo proprietario ativo (vale tambem em autorremocao)
  if v_papel_alvo = 'proprietario' then
    select count(*) into v_proprietarios_ativos
    from public.usuarios_empresas ue
    where ue.empresa_id = v_empresa_id
      and ue.papel = 'proprietario'
      and ue.ativo = true;

    if v_proprietarios_ativos <= 1 then
      raise exception using
        errcode = 'TRQ49',
        message = 'ultimo_proprietario_protegido',
        detail  = 'nao e possivel remover o unico proprietario ativo da empresa.';
    end if;
  end if;

  -- 8) Soft delete
  update public.usuarios_empresas
    set ativo = false
    where id = p_vinculo_id;

  return query
    select p_vinculo_id, v_empresa_id, v_usuario_alvo, v_papel_alvo, false;
  return;
end;
$function$;

alter function public.remover_usuario_empresa(uuid) owner to postgres;

revoke all on function public.remover_usuario_empresa(uuid) from public;
revoke all on function public.remover_usuario_empresa(uuid) from anon;
grant execute on function public.remover_usuario_empresa(uuid) to authenticated;
grant execute on function public.remover_usuario_empresa(uuid) to postgres;
grant execute on function public.remover_usuario_empresa(uuid) to service_role;

COMMIT;
