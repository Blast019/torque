-- FASE 3 (alteração posterior, aprovada na Fase 4.3) — Restringe a criação
-- de empresa adicional a proprietário ativo da empresa de origem.
--
-- Contexto: durante o teste local da Fase 4.3, foi identificado que o botão
-- "+ Nova empresa" ficava visível e funcional para QUALQUER papel (inclusive
-- usuario), porque nem o frontend nem a RPC
-- public.criar_nova_empresa_com_vinculo jamais validaram o papel do
-- chamador em nenhuma empresa. Nova regra aprovada pelo usuário:
--
--   Somente quem possuir vínculo ativo com papel 'proprietario' na empresa
--   ATUALMENTE SELECIONADA pode criar outra empresa.
--
-- NÃO altera qa/fase-3/scripts/empresas-02-criar-nova-empresa-com-vinculo.sql
-- (mantido como registro histórico do estado original da Fase 3). Este
-- arquivo é a migração que leva do estado documentado em empresas-02 para o
-- novo estado.
--
-- NÃO altera public.criar_empresa_com_vinculo (RPC do cadastro inicial de
-- contas sem nenhum vínculo — usada por finalizarCadastroPendente() no
-- frontend). Essa RPC é conceitualmente diferente (não tem "empresa de
-- origem": é usada exatamente quando o usuário NÃO tem nenhuma empresa
-- ainda) e permanece fora do escopo desta mudança.
--
-- O que muda na assinatura:
--   Antes: criar_nova_empresa_com_vinculo(uuid, text, text, text)
--   Depois: criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid)
--           (novo parâmetro: p_empresa_origem_id)
--
-- Por que trocar a assinatura em vez de só adicionar uma checagem: a RPC
-- não tem como saber qual é a "empresa atualmente selecionada" pelo
-- chamador sem que o cliente informe — a mesma conta pode ter vínculos
-- ativos em várias empresas, com papéis diferentes em cada uma. O novo
-- parâmetro p_empresa_origem_id é obrigatório (validado via TRQ14, mesmo
-- padrão já usado para p_empresa_id nesta função).
--
-- Por que remover a assinatura antiga (DROP) em vez de deixar as duas
-- coexistirem: CREATE OR REPLACE com uma lista de parâmetros diferente
-- cria uma SOBRECARGA NOVA, sem remover a antiga. Se a assinatura de 4
-- parâmetros continuasse exposta, ela seguiria chamável via REST
-- diretamente (bypassando o frontend e a nova regra por completo), já que
-- nunca validou papel nenhum. Por isso o DROP da assinatura antiga é
-- feito na MESMA transação da criação da nova — não há janela em que as
-- duas existam ao mesmo tempo.
--
-- Preservado integralmente em relação a empresas-02 (só o necessário para
-- a nova regra foi adicionado; nenhuma outra linha de comportamento
-- mudou): autenticação (TRQ11), validações de entrada existentes,
-- advisory lock por usuário, idempotência via p_empresa_id gerado no
-- cliente, proteção de colisão de id (TRQ16), criação atômica de
-- empresa + vínculo proprietario, formato e colunas do retorno,
-- SECURITY DEFINER, search_path vazio, owner postgres, revokes/grants.
--
-- Código de erro novo: TRQ15 sem_permissao — único código livre na família
-- desta RPC (11=nao_autenticado, 14=entrada_invalida, 16=operacao_nao_
-- permitida já em uso; 15 não está em uso em nenhuma outra RPC do
-- projeto), no mesmo padrão de posição já usado em incluir_usuario_empresa
-- (TRQ25 sem_permissao fica entre TRQ24 entrada_invalida e TRQ26/27).
--
-- EXECUTADO no Supabase em 02/09/2026, após revisão e autorização
-- explícita do usuário. Verificação pós-migração (somente leitura, feita
-- pelo usuário diretamente no SQL Editor) confirmou: assinatura antiga de
-- 4 parâmetros removida; assinatura nova de 5 parâmetros existente;
-- VOLATILE; SECURITY DEFINER; search_path vazio; owner postgres; anon sem
-- EXECUTE; authenticated e service_role com EXECUTE.
--
-- Validado também via QA funcional (login real por papel + chamada REST
-- direta à RPC, mesmo padrão das demais RPCs desta fase — ver
-- empresas-05-qa-restricao-nova-empresa.js e qa/fase-3/STATUS.md, seção
-- 10): 7/7 testes negativos aprovados (TRQ15 para admin/usuario/gerente
-- com vínculo inativo/isolamento entre empresas; TRQ14 para origem nula e
-- para chamada no formato da assinatura antiga; HTTP 401/42501 para
-- chamada anônima) e o replay idempotente de uma empresa própria já
-- existente aprovado (criada_agora=false, nenhum dado substituído).
-- Nenhuma empresa nova foi criada durante a validação — o bloco de INSERT
-- desta função ainda não foi exercitado por nenhum teste.
--
-- Frontend correspondente (index.html/script.js) publicado em 02/09/2026
-- no commit 793c3c5 — backend e frontend sincronizados. Ver
-- qa/fase-4/STATUS.md.

BEGIN;

drop function public.criar_nova_empresa_com_vinculo(uuid, text, text, text);

create or replace function public.criar_nova_empresa_com_vinculo(
  p_empresa_id uuid,
  p_nome_empresa text,
  p_cnpj_empresa text default null::text,
  p_telefone_empresa text default null::text,
  p_empresa_origem_id uuid default null::uuid
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
  if p_empresa_origem_id is null then
    raise exception using
      errcode = 'TRQ14',
      message = 'entrada_invalida',
      detail  = 'p_empresa_origem_id e obrigatorio.';
  end if;

  -- 2b) Nova regra (Fase 4.3): só proprietario ativo da empresa de origem
  --     pode criar outra empresa. Checagem de autorização pura, feita
  --     antes de qualquer lock ou leitura de negócio.
  if not exists (
    select 1
    from public.usuarios_empresas ue
    where ue.empresa_id = p_empresa_origem_id
      and ue.usuario_id = v_usuario_id
      and ue.papel = 'proprietario'
      and ue.ativo = true
  ) then
    raise exception using
      errcode = 'TRQ15',
      message = 'sem_permissao',
      detail  = 'chamador precisa ter vinculo ativo proprietario na empresa de origem.';
  end if;

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

alter function public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) owner to postgres;

revoke all on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) from public;
revoke all on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) from anon;
grant execute on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) to postgres;
grant execute on function public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) to service_role;

COMMIT;
