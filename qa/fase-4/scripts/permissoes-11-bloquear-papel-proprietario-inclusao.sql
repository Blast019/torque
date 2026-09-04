-- Fase 4.3 - Bloqueia p_papel = 'proprietario' em incluir_usuario_empresa.
--
-- Contexto: durante o planejamento do 2o incremento do frontend
-- (Adicionar usuario), foi definida uma nova regra de negocio: o papel
-- 'proprietario' NUNCA pode ser atribuido pelo fluxo de inclusao de
-- usuarios - nem por outro proprietario, nem por admin (que ja era
-- bloqueado antes, mas so por regra de hierarquia, nao de forma
-- absoluta). Uma futura transferencia de propriedade tera um fluxo
-- separado e mais protegido, fora do escopo desta RPC.
--
-- NAO altera qa/fase-4/scripts/permissoes-01-incluir-usuario-empresa.sql
-- (migracao historica ja executada e documentada - permanece como
-- registro do estado original). Este arquivo e a migracao que leva do
-- estado documentado em permissoes-01 para o novo estado.
--
-- A assinatura da funcao NAO muda (continua uuid, text, text) - apenas o
-- corpo e substituido via CREATE OR REPLACE. Diferente da mudanca feita
-- em criar_nova_empresa_com_vinculo (Fase 3), aqui nao ha necessidade de
-- DROP nem de nenhuma janela de incompatibilidade: qualquer chamada ja
-- em voo com a assinatura antiga continua compativel, so passa a ser
-- validada pela nova regra assim que esta transacao commitar.
--
-- Unica mudanca de comportamento: adiciona uma checagem logo apos a
-- validacao existente de p_papel (TRQ24), ANTES de qualquer verificacao
-- de permissao do chamador (TRQ25) ou de leitura/escrita de negocio -
-- bloqueia p_papel = 'proprietario' incondicionalmente, para qualquer
-- chamador (inclusive proprietario), inclusive em chamadas REST diretas
-- que tentem contornar o frontend. Todo o restante do corpo da funcao
-- (autenticacao TRQ21, demais validacoes de entrada, restricao de
-- hierarquia do admin TRQ25, advisory lock, busca por e-mail TRQ27,
-- reativacao/insercao, TRQ26) permanece IDENTICO ao de permissoes-01.
--
-- Novo codigo de erro: TRQ28 papel_nao_permitido - unico codigo livre na
-- familia desta RPC (21, 24, 25, 26, 27 ja em uso; 28 nao esta em uso em
-- nenhuma outra RPC do projeto).
--
-- AINDA NAO EXECUTADO. Rodar manualmente no SQL Editor do Supabase apenas
-- apos revisao e autorizacao explicita do usuario.

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

  -- 2b) Nova regra (Fase 4.3): o papel proprietario nunca pode ser
  --     atribuido por este fluxo, para nenhum chamador - nem mesmo por
  --     outro proprietario. Checagem de entrada pura, antes de qualquer
  --     verificacao de permissao ou leitura/escrita de negocio. Uma
  --     futura transferencia de propriedade tera um fluxo dedicado.
  if v_papel = 'proprietario' then
    raise exception using
      errcode = 'TRQ28',
      message = 'papel_nao_permitido',
      detail  = 'o papel proprietario nao pode ser atribuido por este fluxo.';
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
