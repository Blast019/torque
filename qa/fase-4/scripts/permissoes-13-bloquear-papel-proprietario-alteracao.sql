-- Fase 4.3 - Bloqueia p_novo_papel = 'proprietario' em
-- alterar_papel_usuario_empresa.
--
-- Contexto: durante a analise do 5o incremento do frontend (Alterar
-- papel), foi identificado que, diferente de incluir_usuario_empresa (que
-- bloqueia 'proprietario' via TRQ28, aplicado na Fase 4.3), a RPC
-- alterar_papel_usuario_empresa nunca teve um bloqueio equivalente: um
-- proprietario podia promover qualquer vinculo ativo nao-proprio a
-- 'proprietario' via chamada REST direta, contornando o frontend, sem
-- nenhum codigo de erro impedindo isso. Nova regra aprovada: o papel
-- 'proprietario' NUNCA pode ser atribuido por este fluxo - nem por outro
-- proprietario, nem por admin (que ja era bloqueado antes, mas so por
-- regra de hierarquia via TRQ35, nao de forma absoluta). Uma futura
-- transferencia de propriedade tera um fluxo separado e mais protegido,
-- fora do escopo desta RPC - mesmo raciocinio ja aplicado em
-- permissoes-11-bloquear-papel-proprietario-inclusao.sql.
--
-- NAO altera qa/fase-4/scripts/permissoes-02-alterar-papel-usuario-empresa.sql
-- (migracao historica ja executada e documentada - permanece como
-- registro do estado original). Este arquivo e a migracao que leva do
-- estado documentado em permissoes-02 para o novo estado.
--
-- A assinatura da funcao NAO muda (continua uuid, text) - apenas o corpo
-- e substituido via CREATE OR REPLACE. Nao ha necessidade de DROP nem de
-- nenhuma janela de incompatibilidade: qualquer chamada ja em voo com a
-- assinatura antiga continua compativel, so passa a ser validada pela
-- nova regra assim que esta transacao commitar.
--
-- Unica mudanca de comportamento: adiciona uma checagem logo apos a
-- validacao existente de p_novo_papel (TRQ34), ANTES de localizar o
-- vinculo alvo, ANTES da trava por empresa, ANTES de qualquer verificacao
-- de permissao (TRQ35/TRQ36/TRQ38/TRQ39) ou de escrita de negocio -
-- bloqueia p_novo_papel = 'proprietario' incondicionalmente, para
-- qualquer chamador (inclusive proprietario), inclusive em chamadas REST
-- diretas que tentem contornar o frontend. Mesma posicao relativa (logo
-- apos a validacao de entrada) usada em permissoes-11 para
-- incluir_usuario_empresa. Todo o restante do corpo da funcao
-- (autenticacao TRQ31, localizacao do vinculo TRQ37, trava por empresa,
-- releitura do vinculo, bloqueio de vinculo inativo TRQ38, bloqueio de
-- autoalteracao TRQ36, restricao de hierarquia do admin TRQ35, protecao
-- do ultimo proprietario TRQ39, o UPDATE final e o retorno) permanece
-- IDENTICO ao de permissoes-02.
--
-- Novo codigo de erro: TRQ40 papel_nao_permitido - confirmado livre em
-- 03/09/2026 (busca por todos os codigos TRQxx versionados no
-- repositorio - nenhuma ocorrencia de TRQ40).
--
-- Owner e grants preservados sem alteracao (mesmas linhas de
-- permissoes-02, repetidas ao final por seguranca do CREATE OR REPLACE).
--
-- Nao altera RLS, tabelas ou nenhuma outra RPC.
--
-- APLICADO E VALIDADO no Supabase em 03/09/2026, pelo usuario, via SQL
-- Editor. QA via REST (login real por papel, sem service_role, sem
-- DELETE manual) - 13 verificacoes aprovadas:
--   - PROP_A tenta promover ADMIN_A a proprietario -> TRQ40; vinculo de
--     ADMIN_A inalterado.
--   - ADMIN_A tenta promover USUARIO_A a proprietario -> TRQ40; vinculo
--     de USUARIO_A inalterado.
--   - p_novo_papel invalido ('papel_invalido'), com p_vinculo_id valido
--     (ADMIN_A) -> TRQ34, antes de localizar o vinculo/travar a empresa;
--     baseline dos 4 vinculos da Empresa A identico byte a byte antes/depois.
--   - Chamada anonima -> HTTP 401 / 42501 (permission denied).
--   - Alteracoes permitidas continuam funcionando: PROP_A altera LIVRE de
--     gerente para usuario; ADMIN_A altera LIVRE de usuario para gerente.
--   - Restauracao do baseline (autorremocao do LIVRE) e estado final
--     byte a byte identico ao baseline capturado antes de qualquer
--     mutacao.
--   - Owner (postgres) e grants (authenticated com acesso, anon
--     bloqueado) confirmados inalterados.

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

  -- 2b) Nova regra (Fase 4.3): o papel proprietario nunca pode ser
  --     atribuido por este fluxo, para nenhum chamador - nem mesmo por
  --     outro proprietario. Checagem de entrada pura, antes de localizar
  --     o vinculo, travar a empresa ou verificar qualquer permissao. Uma
  --     futura transferencia de propriedade tera um fluxo dedicado.
  if v_novo_papel = 'proprietario' then
    raise exception using
      errcode = 'TRQ40',
      message = 'papel_nao_permitido',
      detail  = 'o papel proprietario nao pode ser atribuido por este fluxo';
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
