-- FASE 3 — Contexto da empresa
-- RPC nova: public.criar_nova_empresa_com_vinculo(uuid, text, text, text)
--
-- Bloco atômico exatamente como apresentado para aprovação e aplicado
-- pelo usuário via SQL Editor do Supabase nesta Fase. Não toca em
-- public.criar_empresa_com_vinculo, que permanece intocada (ver
-- empresas-01 e a reconferência em empresas-03).
--
-- Permite que um usuário já autenticado (com um ou mais vínculos ativos)
-- crie uma empresa ADICIONAL, com plano/assinatura próprios (DEFAULT da
-- tabela: 'Teste'/'ativo'), independentes das demais empresas do mesmo
-- usuário. Idempotência via p_empresa_id gerado no cliente (uuid),
-- inserido diretamente como empresas.id — sem coluna nem índice novos.

BEGIN;

create or replace function public.criar_nova_empresa_com_vinculo(
  p_empresa_id uuid,
  p_nome_empresa text,
  p_cnpj_empresa text default null::text,
  p_telefone_empresa text default null::text
)
returns table(
  empresa_id uuid,
  empresa_nome text,
  empresa_cnpj text,
  empresa_telefone text,
  empresa_plano text,
  empresa_status_assinatura text,
  vinculo_id uuid,
  papel text,
  usuario_id uuid,
  criada_agora boolean
)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_usuario_id      uuid;
  v_nome            text;
  v_cnpj            text;
  v_telefone        text;
  v_lock_key        bigint;
  v_owner_existente uuid;
  v_vinculo_id      uuid;
begin
  -- 1) Autenticação — exclusivamente via auth.uid(); nunca aceita
  --    usuario_id como parâmetro.
  v_usuario_id := auth.uid();
  if v_usuario_id is null then
    raise exception using
      errcode = 'TRQ11',
      message = 'nao_autenticado',
      detail  = 'auth.uid() retornou null nesta chamada.';
  end if;

  -- 2) Validação de entrada.
  if p_empresa_id is null then
    raise exception using
      errcode = 'TRQ14',
      message = 'entrada_invalida',
      detail  = 'p_empresa_id e obrigatorio.';
  end if;
  v_nome := trim(p_nome_empresa);
  if v_nome is null or v_nome = '' then
    raise exception using
      errcode = 'TRQ14',
      message = 'entrada_invalida',
      detail  = 'nome da empresa e obrigatorio apos trim.';
  end if;
  v_cnpj     := nullif(trim(p_cnpj_empresa), '');
  v_telefone := nullif(trim(p_telefone_empresa), '');

  -- 3) Trava consultiva por usuário, mesmo padrão da RPC original —
  --    serializa também contra criar_empresa_com_vinculo, já que as duas
  --    mutam as mesmas tabelas para o mesmo auth.uid(). NÃO serializa
  --    contra chamadas de outro usuário: a proteção contra colisão de id
  --    entre usuários diferentes vem do PRIMARY KEY de empresas.id
  --    (blocos 4 e 5), não deste lock.
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(v_usuario_id::text), 1, 16))::bit(64)::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- 4) Idempotência via id gerado no cliente. Só é replay legítimo se o id
  --    já existente pertencer a este mesmo usuário E tiver vínculo
  --    proprietario ativo correspondente. Qualquer outro caso (id de
  --    outro owner, ou owner certo mas vínculo ausente/inativo) responde
  --    com o MESMO erro genérico, sem revelar se o id existe, a quem
  --    pertence, ou qual das duas condições falhou.
  select e.owner_id into v_owner_existente
  from public.empresas e
  where e.id = p_empresa_id;

  if v_owner_existente is not null then
    if v_owner_existente <> v_usuario_id then
      raise exception using
        errcode = 'TRQ16',
        message = 'operacao_nao_permitida',
        detail  = 'identificador de empresa nao pode ser reutilizado.';
    end if;

    select ue.id into v_vinculo_id
    from public.usuarios_empresas ue
    where ue.usuario_id = v_usuario_id
      and ue.empresa_id = p_empresa_id
      and ue.papel = 'proprietario'
      and ue.ativo = true;

    if v_vinculo_id is null then
      raise exception using
        errcode = 'TRQ16',
        message = 'operacao_nao_permitida',
        detail  = 'identificador de empresa nao pode ser reutilizado.';
    end if;

    -- Replay idempotente — ignora nome/cnpj/telefone recebidos nesta
    -- chamada; a empresa já existe exatamente como criada na 1ª chamada
    -- bem-sucedida.
    return query
      select
        e.id, e.nome, e.cnpj, e.telefone, e.plano, e.status_assinatura,
        v_vinculo_id, 'proprietario'::text, v_usuario_id, false
      from public.empresas e
      where e.id = p_empresa_id;
    return;
  end if;

  -- 5) Cria empresa + vínculo proprietario nesta transação, com o id
  --    fornecido pelo cliente. plano e status_assinatura ficam por conta
  --    do DEFAULT da tabela ('Teste'/'ativo'), igual à RPC original —
  --    cada empresa nova tem plano/assinatura próprios, independentes das
  --    demais empresas do mesmo usuário.
  begin
    insert into public.empresas (id, owner_id, nome, cnpj, telefone)
    values (p_empresa_id, v_usuario_id, v_nome, v_cnpj, v_telefone);
  exception when unique_violation then
    -- Corrida real entre duas transações inserindo o mesmo id ao mesmo
    -- tempo (janela entre o SELECT do bloco 4 e este INSERT). Mesmo erro
    -- genérico, sem detalhar de quem é o id.
    raise exception using
      errcode = 'TRQ16',
      message = 'operacao_nao_permitida',
      detail  = 'identificador de empresa nao pode ser reutilizado.';
  end;

  insert into public.usuarios_empresas (empresa_id, usuario_id, papel, ativo)
  values (p_empresa_id, v_usuario_id, 'proprietario', true)
  returning id into v_vinculo_id;

  return query
    select
      e.id, e.nome, e.cnpj, e.telefone, e.plano, e.status_assinatura,
      v_vinculo_id, 'proprietario'::text, v_usuario_id, true
    from public.empresas e
    where e.id = p_empresa_id;
  return;
end;
$function$;

alter function public.criar_nova_empresa_com_vinculo(uuid, text, text, text) owner to postgres;

revoke all on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text) from public;
revoke all on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text) from anon;
grant execute on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text) to authenticated;
grant execute on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text) to postgres;
grant execute on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text) to service_role;

COMMIT;
