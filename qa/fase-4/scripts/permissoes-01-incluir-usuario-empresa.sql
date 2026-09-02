-- QA Fase 4.2 (usuarios_empresas) - RPC incluir_usuario_empresa
--
-- Inclui uma conta EXISTENTE (busca por e-mail exato, case-insensitive) como
-- vinculo ativo em uma empresa. Chamador precisa ter vinculo ativo
-- proprietario/admin nessa empresa; admin so pode atribuir papel gerente ou
-- usuario. Se ja existir vinculo inativo para o usuario nessa empresa,
-- reativa (ativo=true, papel=p_papel); se ja existir vinculo ativo, erro.
--
-- Padrao identico ao usado em criar_empresa_com_vinculo /
-- criar_nova_empresa_com_vinculo (Fase 3): SECURITY DEFINER,
-- SET search_path TO '', autenticacao so via auth.uid(), REVOKE ALL de
-- public/anon, GRANT EXECUTE so para authenticated/postgres/service_role.
-- Trava por pg_advisory_xact_lock chaveada por empresa_id (nao por
-- chamador), porque aqui o risco de corrida e dois admins da MESMA empresa
-- mexendo em usuarios_empresas ao mesmo tempo.
--
-- Codigos de erro: TRQ21 nao_autenticado, TRQ24 entrada_invalida,
-- TRQ25 sem_permissao, TRQ26 operacao_nao_permitida (vinculo ja ativo),
-- TRQ27 usuario_nao_encontrado.
--
-- AINDA NAO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorizacao explicita do usuario.

BEGIN;

create or replace function public.incluir_usuario_empresa(
  p_empresa_id uuid,
  p_email text,
  p_papel text
)
returns table(
  vinculo_id uuid,
  empresa_id uuid,
  usuario_id uuid,
  papel text,
  ativo boolean,
  reativado boolean
)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_chamador_id    uuid;
  v_email          text;
  v_papel          text;
  v_lock_key       bigint;
  v_papel_chamador text;
  v_usuario_alvo   uuid;
  v_vinculo_id     uuid;
  v_ativo_atual    boolean;
begin
  -- 1) Autenticação
  v_chamador_id := auth.uid();
  if v_chamador_id is null then
    raise exception using
      errcode = 'TRQ21',
      message = 'nao_autenticado',
      detail  = 'auth.uid() retornou null nesta chamada.';
  end if;

  -- 2) Validação de entrada
  if p_empresa_id is null then
    raise exception using
      errcode = 'TRQ24',
      message = 'entrada_invalida',
      detail  = 'p_empresa_id e obrigatorio.';
  end if;

  v_email := nullif(trim(p_email), '');
  if v_email is null then
    raise exception using
      errcode = 'TRQ24',
      message = 'entrada_invalida',
      detail  = 'p_email e obrigatorio.';
  end if;

  v_papel := nullif(trim(p_papel), '');
  if v_papel is null or v_papel not in ('proprietario', 'admin', 'gerente', 'usuario') then
    raise exception using
      errcode = 'TRQ24',
      message = 'entrada_invalida',
      detail  = 'p_papel deve ser proprietario, admin, gerente ou usuario.';
  end if;

  -- 3) Trava por empresa - serializa chamadas concorrentes de diferentes
  --    proprietarios/admins da MESMA empresa mexendo em usuarios_empresas.
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(p_empresa_id::text), 1, 16))::bit(64)::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- 4) Permissão do chamador
  select ue.papel into v_papel_chamador
  from public.usuarios_empresas ue
  where ue.empresa_id = p_empresa_id
    and ue.usuario_id = v_chamador_id
    and ue.ativo = true;

  if v_papel_chamador is null or v_papel_chamador not in ('proprietario', 'admin') then
    raise exception using
      errcode = 'TRQ25',
      message = 'sem_permissao',
      detail  = 'chamador precisa ter vinculo ativo proprietario ou admin nesta empresa.';
  end if;

  if v_papel_chamador = 'admin' and v_papel not in ('gerente', 'usuario') then
    raise exception using
      errcode = 'TRQ25',
      message = 'sem_permissao',
      detail  = 'admin so pode incluir usuarios com papel gerente ou usuario.';
  end if;

  -- 5) Localiza a conta pelo e-mail exato (case-insensitive)
  select u.id into v_usuario_alvo
  from auth.users u
  where lower(u.email) = lower(v_email)
  limit 1;

  if v_usuario_alvo is null then
    raise exception using
      errcode = 'TRQ27',
      message = 'usuario_nao_encontrado',
      detail  = 'nenhuma conta existente corresponde a este e-mail.';
  end if;

  -- 6) Vinculo existente? Reativa ou cria.
  select ue.id, ue.ativo into v_vinculo_id, v_ativo_atual
  from public.usuarios_empresas ue
  where ue.empresa_id = p_empresa_id
    and ue.usuario_id = v_usuario_alvo;

  if v_vinculo_id is not null then
    if v_ativo_atual then
      raise exception using
        errcode = 'TRQ26',
        message = 'operacao_nao_permitida',
        detail  = 'usuario ja possui vinculo ativo nesta empresa.';
    end if;

    update public.usuarios_empresas
      set ativo = true, papel = v_papel
      where id = v_vinculo_id;

    return query
      select v_vinculo_id, p_empresa_id, v_usuario_alvo, v_papel, true, true;
    return;
  end if;

  insert into public.usuarios_empresas (empresa_id, usuario_id, papel, ativo)
  values (p_empresa_id, v_usuario_alvo, v_papel, true)
  returning id into v_vinculo_id;

  return query
    select v_vinculo_id, p_empresa_id, v_usuario_alvo, v_papel, true, false;
  return;
end;
$function$;

alter function public.incluir_usuario_empresa(uuid, text, text) owner to postgres;

revoke all on function public.incluir_usuario_empresa(uuid, text, text) from public;
revoke all on function public.incluir_usuario_empresa(uuid, text, text) from anon;
grant execute on function public.incluir_usuario_empresa(uuid, text, text) to authenticated;
grant execute on function public.incluir_usuario_empresa(uuid, text, text) to postgres;
grant execute on function public.incluir_usuario_empresa(uuid, text, text) to service_role;

COMMIT;
