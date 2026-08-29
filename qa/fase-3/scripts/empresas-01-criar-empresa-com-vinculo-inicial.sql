-- FASE 3 — Contexto da empresa
-- RPC inicial: public.criar_empresa_com_vinculo(text, text, text)
--
-- Este arquivo é uma RECONSTRUÇÃO DOCUMENTAL do estado já validado em
-- produção antes do início desta Fase 3 (a função já existia e já estava
-- em uso pelo frontend quando a investigação começou). Não é o script de
-- migração original — é a definição real capturada via
-- `pg_get_functiondef` e os grants efetivos capturados via
-- `information_schema.routine_privileges`, ambos conferidos nesta Fase.
--
-- Estado validado no momento da captura:
--   owner: postgres
--   SECURITY DEFINER, VOLATILE
--   EXECUTE: authenticated = true, postgres = true, service_role = true
--   EXECUTE: anon = false, PUBLIC = false
--
-- Não executar isto como migração — é registro de referência. Qualquer
-- alteração real nesta função é uma operação de alto impacto e exige
-- autorização explícita, conforme as regras do projeto.

BEGIN;

create or replace function public.criar_empresa_com_vinculo(p_nome_empresa text, p_cnpj_empresa text DEFAULT NULL::text, p_telefone_empresa text DEFAULT NULL::text)
 RETURNS TABLE(empresa_id uuid, empresa_nome text, empresa_cnpj text, empresa_telefone text, empresa_plano text, empresa_status_assinatura text, vinculo_id uuid, papel text, usuario_id uuid, criada_agora boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id              uuid;
  v_nome                    text;
  v_cnpj                    text;
  v_telefone                text;
  v_lock_key                bigint;
  v_empresas_proprias_count bigint;
  v_empresa_propria_id      uuid;
  v_vinculo_proprietario_id uuid;
  v_vinculos_ativos_count   bigint;
  v_nova_empresa_id         uuid;
  v_novo_vinculo_id         uuid;
begin
  -- 1) Autenticação — exclusivamente via auth.uid(); nunca aceita
  --    usuario_id/owner_id como parâmetro.
  v_usuario_id := auth.uid();
  if v_usuario_id is null then
    raise exception using
      errcode = 'TRQ01',
      message = 'nao_autenticado',
      detail  = 'auth.uid() retornou null nesta chamada.';
  end if;

  -- 2) Validação de entrada. Só o nome é obrigatório, após trim. CNPJ e
  --    telefone são opcionais, sem validação de formato/matemática — as
  --    colunas são text NULL sem limite (confirmado via information_schema),
  --    então não há restrição de tamanho real a impor aqui.
  v_nome := trim(p_nome_empresa);
  if v_nome is null or v_nome = '' then
    raise exception using
      errcode = 'TRQ04',
      message = 'entrada_invalida',
      detail  = 'nome da empresa e obrigatorio apos trim.';
  end if;
  v_cnpj     := nullif(trim(p_cnpj_empresa), '');
  v_telefone := nullif(trim(p_telefone_empresa), '');

  -- 3) Lock transacional por auth.uid(), antes de qualquer SELECT ou
  --    INSERT nas tabelas envolvidas — serializa chamadas concorrentes do
  --    mesmo usuário (duplo clique, duas abas). Derivação determinística
  --    de um bigint a partir do uuid via md5 (técnica padrão para
  --    pg_advisory_xact_lock, que só aceita bigint ou par de int).
  --    Liberado automaticamente ao fim da transação (commit ou rollback).
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(v_usuario_id::text), 1, 16))::bit(64)::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- 4) Matriz de decisão (A–D) -------------------------------------------

  select count(*) into v_empresas_proprias_count
  from public.empresas e
  where e.owner_id = v_usuario_id;

  if v_empresas_proprias_count >= 2 then
    -- Duas ou mais empresas com owner_id = auth.uid(): conta inconsistente,
    -- não escolhe nenhuma, não repara.
    raise exception using
      errcode = 'TRQ02',
      message = 'conta_inconsistente',
      detail  = 'usuario e owner_id de mais de uma empresa.';
  end if;

  if v_empresas_proprias_count = 1 then
    select e.id into v_empresa_propria_id
    from public.empresas e
    where e.owner_id = v_usuario_id;

    select ue.id into v_vinculo_proprietario_id
    from public.usuarios_empresas ue
    where ue.usuario_id = v_usuario_id
      and ue.empresa_id = v_empresa_propria_id
      and ue.papel = 'proprietario'
      and ue.ativo = true;

    if v_vinculo_proprietario_id is not null then
      -- Caso A: empresa própria + vínculo proprietario ativo correspondente.
      -- Idempotente — retorna o contexto existente, não cria nada.
      return query
        select
          e.id, e.nome, e.cnpj, e.telefone, e.plano, e.status_assinatura,
          v_vinculo_proprietario_id, 'proprietario'::text, v_usuario_id, false
        from public.empresas e
        where e.id = v_empresa_propria_id;
      return;
    else
      -- Caso B: empresa própria SEM vínculo proprietario ativo
      -- correspondente. Aborta como conta inconsistente, sem reparar, sem
      -- vincular, sem criar. É o padrão exato de "Admim" hoje — a função
      -- nunca a toca justamente por cair aqui.
      raise exception using
        errcode = 'TRQ02',
        message = 'conta_inconsistente',
        detail  = 'usuario e owner_id de uma empresa sem vinculo proprietario ativo correspondente.';
    end if;
  end if;

  -- v_empresas_proprias_count = 0 a partir daqui.

  select count(*) into v_vinculos_ativos_count
  from public.usuarios_empresas ue
  where ue.usuario_id = v_usuario_id
    and ue.ativo = true;

  if v_vinculos_ativos_count > 0 then
    -- Caso C: zero empresas próprias, mas algum vínculo ativo (qualquer
    -- papel, qualquer empresa). Fora do escopo desta RPC no MVP.
    raise exception using
      errcode = 'TRQ03',
      message = 'criacao_inicial_nao_permitida',
      detail  = 'usuario ja possui vinculo ativo em pelo menos uma empresa.';
  end if;

  -- Caso D: zero empresas próprias e zero vínculos ativos. Cria empresa +
  -- vínculo proprietario, na mesma transação desta chamada. Só INSERT —
  -- nunca UPDATE/DELETE em empresas ou usuarios_empresas. plano e
  -- status_assinatura ficam por conta do DEFAULT da tabela ('Teste'/'ativo').

  insert into public.empresas (owner_id, nome, cnpj, telefone)
  values (v_usuario_id, v_nome, v_cnpj, v_telefone)
  returning id into v_nova_empresa_id;

  insert into public.usuarios_empresas (empresa_id, usuario_id, papel, ativo)
  values (v_nova_empresa_id, v_usuario_id, 'proprietario', true)
  returning id into v_novo_vinculo_id;

  return query
    select
      e.id, e.nome, e.cnpj, e.telefone, e.plano, e.status_assinatura,
      v_novo_vinculo_id, 'proprietario'::text, v_usuario_id, true
    from public.empresas e
    where e.id = v_nova_empresa_id;
  return;
end;
$function$;

-- Owner e grants efetivos, conforme validados via
-- information_schema.routine_privileges nesta Fase.
alter function public.criar_empresa_com_vinculo(text, text, text) owner to postgres;

revoke all on function public.criar_empresa_com_vinculo(text, text, text) from public;
revoke all on function public.criar_empresa_com_vinculo(text, text, text) from anon;
grant execute on function public.criar_empresa_com_vinculo(text, text, text) to authenticated;
grant execute on function public.criar_empresa_com_vinculo(text, text, text) to postgres;
grant execute on function public.criar_empresa_com_vinculo(text, text, text) to service_role;

COMMIT;
