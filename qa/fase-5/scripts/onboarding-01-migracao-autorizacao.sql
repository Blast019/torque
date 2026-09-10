-- FASE 5.1 (Incremento 1 - Alternativa A) - Onboarding autorizado por convite.
--
-- Cria a tabela public.autorizacoes_onboarding e a RPC
-- public.criar_empresa_autorizada, que passa a ser o UNICO portao para
-- criacao de qualquer empresa nova (primeiro cadastro ou empresa
-- adicional) - substitui public.criar_empresa_com_vinculo e
-- public.criar_nova_empresa_com_vinculo, cujo EXECUTE e revogado de
-- authenticated NA MESMA migracao (nao ha DROP ainda - isso fica para uma
-- migracao de limpeza posterior, so depois do frontend novo publicado e
-- validado).
--
-- Base de todo o desenho: qa/fase-5/STATUS.md, secao "Checkpoint de
-- 10/09/2026 - Incremento 1: onboarding autorizado por convite
-- (Alternativa A)".
--
-- CODIGOS TRQ DESLOCADOS (09-10/09/2026): a Proposta Tecnica v4 original
-- reservava TRQ50-TRQ54 para esta RPC. Confirmado por leitura de TODOS os
-- .sql do projeto que TRQ51 (nao_autenticado) e TRQ54 (entrada_invalida)
-- JA ESTAO EM USO por public.listar_usuarios_empresa
-- (qa/fase-4/scripts/permissoes-09-listar-usuarios-empresa.sql) com
-- significados diferentes. Para nao colidir nem mudar o significado de um
-- codigo ja publicado, esta migracao usa a familia seguinte, livre e
-- confirmada por leitura:
--   TRQ56 nao_autenticado       (era TRQ50 na v4)
--   TRQ57 entrada_invalida      (era TRQ51 na v4 - colidia)
--   TRQ58 sem_autorizacao       (era TRQ52 na v4)
--   TRQ59 operacao_nao_permitida(era TRQ53 na v4)
--   TRQ60 conflito_dados        (era TRQ54 na v4 - colidia)
--
-- Descoberta dinamica da PK de public.empresas: nenhum script do projeto
-- jamais nomeou explicitamente essa constraint - "empresas_pkey" seria uma
-- suposicao, nao um fato confirmado. Por isso, dentro de
-- criar_empresa_autorizada, o nome real da PK e descoberto via
-- pg_catalog.pg_constraint (contype = 'p') no momento em que um
-- unique_violation acontece, e comparado ao nome informado pelo proprio
-- erro (GET STACKED DIAGNOSTICS). Como a funcao usa
-- SET search_path TO '', toda referencia ao catalogo abaixo e
-- explicitamente qualificada com o esquema pg_catalog. Se a PK nao puder
-- ser confirmada com exatidao (exatamente uma linha), a funcao NUNCA
-- classifica o unique_violation como colisao de UUID - cai sempre no
-- codigo generico (TRQ60), com falha segura.
--
-- AINDA NAO EXECUTADO. NAO RODAR sem revisao e autorizacao explicita
-- separada do usuario. Este arquivo e so a proposta de migracao para
-- revisao.
--
-- NAO INCLUI NESTA MIGRACAO (deliberadamente, fora de escopo desta etapa):
--   - DROP das duas RPCs antigas (fica para uma migracao de limpeza,
--     depois do frontend novo publicado e validado);
--   - qualquer autorizacao real de e-mail (nenhum INSERT de dado real);
--   - qualquer UUID pessoal fixo (nenhum operador e identificado aqui);
--   - qualquer alteracao em auth.users ou em Auth/configuracao do
--     Supabase;
--   - qualquer alteracao de frontend ou envio de convite.

BEGIN;

-- =====================================================================
-- PRECHECKS NAO DESTRUTIVOS (abortam a transacao inteira se algo nao
-- estiver exatamente como esperado - nada e alterado se qualquer um
-- destes falhar)
-- =====================================================================
DO $$
DECLARE
  v_pk_empresas_precheck text;
BEGIN
  -- 1) As tabelas base precisam existir.
  IF to_regclass('public.empresas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.usuarios_empresas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.usuarios_empresas nao encontrada. Abortando sem alterar nada.';
  END IF;

  -- 2) public.empresas precisa ter exatamente uma PK (confirmacao pelo
  --    catalogo, sem supor nome) - a mesma tecnica sera usada em tempo de
  --    execucao dentro de criar_empresa_autorizada.
  SELECT con.conname
    INTO STRICT v_pk_empresas_precheck
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.empresas'::regclass
     AND con.contype = 'p';
  RAISE NOTICE 'Precheck OK: PK de public.empresas confirmada pelo catalogo (nome nao exposto neste log por padrao de seguranca).';

  -- 3) As duas RPCs antigas precisam existir com a assinatura EXATA que
  --    esta migracao vai revogar - nunca revogar "no escuro".
  IF to_regprocedure('public.criar_empresa_com_vinculo(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: criar_empresa_com_vinculo(text,text,text) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: criar_nova_empresa_com_vinculo(uuid,text,text,text,uuid) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;

  -- 4) A nova tabela nao pode already existir (evita sobrescrever algo
  --    inesperado).
  IF to_regclass('public.autorizacoes_onboarding') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.autorizacoes_onboarding ja existe. Abortando sem alterar nada.';
  END IF;

  -- 5) As duas novas funcoes tambem nao podem existir ainda.
  IF to_regprocedure('public.criar_empresa_autorizada(uuid, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: criar_empresa_autorizada(uuid,text,text,text) ja existe. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.existe_autorizacao_onboarding_pendente()') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: existe_autorizacao_onboarding_pendente() ja existe. Abortando sem alterar nada.';
  END IF;

EXCEPTION
  WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Precheck falhou: nao foi possivel confirmar exatamente uma PK para public.empresas pelo catalogo. Abortando sem alterar nada.';
END $$;

-- =====================================================================
-- TABELA public.autorizacoes_onboarding
-- =====================================================================
CREATE TABLE public.autorizacoes_onboarding (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                     text NOT NULL,
  autorizado_por            uuid NOT NULL REFERENCES auth.users(id),
  autorizado_em             timestamptz NOT NULL DEFAULT now(),
  expira_em                 timestamptz NOT NULL,
  consumido_em              timestamptz,
  consumido_por             uuid REFERENCES auth.users(id),
  consumido_para_empresa_id uuid,
  revogado_em               timestamptz,
  revogado_por              uuid REFERENCES auth.users(id),
  CONSTRAINT autorizacoes_onboarding_email_normalizado
    CHECK (email = lower(btrim(email))),
  CONSTRAINT autorizacoes_onboarding_expira_apos_autorizado
    CHECK (expira_em > autorizado_em)
);

COMMENT ON TABLE public.autorizacoes_onboarding IS
  'Autorizacao administrativa da plataforma para criacao de empresa. Nao e um convite em si (a prova de posse do e-mail e nativa do Supabase Auth) - so registra a decisao de autorizar e o estado dessa decisao. Nenhum grant para anon/authenticated.';

-- No maximo uma autorizacao pendente (nao consumida, nao revogada) por
-- e-mail, ao mesmo tempo. Nao cobre expira_em (nao pode - predicado de
-- indice precisa ser imutavel) - por isso o procedimento operacional de
-- emissao (fora desta migracao) e OBRIGADO a revogar qualquer pendencia
-- expirada do mesmo e-mail antes de inserir uma nova, ou o INSERT falha
-- aqui por violacao de unicidade.
CREATE UNIQUE INDEX autorizacoes_onboarding_email_pendente_uniq
  ON public.autorizacoes_onboarding (email)
  WHERE consumido_em IS NULL AND revogado_em IS NULL;

ALTER TABLE public.autorizacoes_onboarding ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy criada de proposito - com RLS ligado e sem policy
-- nenhuma, nenhuma linha e visivel/gravavel por ninguem alem do dono da
-- tabela/roles com bypassrls. Reforcado pelos REVOKEs abaixo.

REVOKE ALL ON public.autorizacoes_onboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.autorizacoes_onboarding TO service_role;
-- Nenhum DELETE concedido a ninguem - historico nunca e apagado por esta via.

ALTER TABLE public.autorizacoes_onboarding OWNER TO postgres;

-- =====================================================================
-- RPC public.criar_empresa_autorizada
-- =====================================================================
CREATE OR REPLACE FUNCTION public.criar_empresa_autorizada(
  p_empresa_id uuid,
  p_nome_empresa text,
  p_cnpj_empresa text DEFAULT NULL::text,
  p_telefone_empresa text DEFAULT NULL::text
)
RETURNS TABLE(
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
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id       uuid;
  v_email_atual      text;
  v_nome             text;
  v_cnpj             text;
  v_telefone         text;
  v_lock_key         bigint;
  v_autorizacao_id   uuid;
  v_owner_existente  uuid;
  v_vinculo_id       uuid;
  v_constraint_name  text;
  v_pk_empresas_name text;
BEGIN
  -- 1) Autenticacao - exclusivamente via auth.uid(); nunca aceita
  --    usuario_id como parametro.
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ56',
      MESSAGE = 'nao_autenticado',
      DETAIL  = 'auth.uid() retornou null nesta chamada.';
  END IF;

  -- 2) E-mail da sessao atual (para validar a autorizacao por e-mail).
  --    Normalizado com lower(btrim(...)), igual ao CHECK da tabela e ao
  --    procedimento manual de emissao - nunca so lower(), para nao correr
  --    o risco (raro, mas real) de um e-mail com espaco incidental em
  --    auth.users nunca bater com a autorizacao gravada normalizada.
  SELECT lower(btrim(u.email)) INTO v_email_atual
    FROM auth.users u
   WHERE u.id = v_usuario_id;

  IF v_email_atual IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ56',
      MESSAGE = 'nao_autenticado',
      DETAIL  = 'nao foi possivel identificar o email do usuario autenticado.';
  END IF;

  -- 3) Validacao de entrada.
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ57',
      MESSAGE = 'entrada_invalida',
      DETAIL  = 'p_empresa_id e obrigatorio.';
  END IF;
  v_nome := trim(p_nome_empresa);
  IF v_nome IS NULL OR v_nome = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ57',
      MESSAGE = 'entrada_invalida',
      DETAIL  = 'nome da empresa e obrigatorio apos trim.';
  END IF;
  v_cnpj     := nullif(trim(p_cnpj_empresa), '');
  v_telefone := nullif(trim(p_telefone_empresa), '');

  -- 4) Portao unico de autorizacao da plataforma - consumo atomico e
  --    idempotente, por e-mail da sessao E por p_empresa_id. O UPDATE
  --    condicional garante atomicidade mesmo sob concorrencia (lock de
  --    linha natural do Postgres); se a transacao falhar depois por
  --    qualquer motivo, o ROLLBACK desfaz este UPDATE tambem, devolvendo a
  --    autorizacao ao estado pendente (retry seguro).
  --
  --    So e aceito como replay quando autorizacao, usuario E
  --    p_empresa_id coincidem TODOS com a primeira consumacao bem
  --    sucedida - uma chamada do mesmo usuario com p_empresa_id diferente
  --    depois da autorizacao ja consumida e recusada (TRQ58).
  UPDATE public.autorizacoes_onboarding
     SET consumido_em              = coalesce(consumido_em, now()),
         consumido_por             = coalesce(consumido_por, v_usuario_id),
         consumido_para_empresa_id = coalesce(consumido_para_empresa_id, p_empresa_id)
   WHERE email = v_email_atual
     AND revogado_em IS NULL
     AND (
          (consumido_em IS NULL AND expira_em > now())
          OR (consumido_por = v_usuario_id AND consumido_para_empresa_id = p_empresa_id)
         )
  RETURNING id INTO v_autorizacao_id;

  IF v_autorizacao_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ58',
      MESSAGE = 'sem_autorizacao',
      DETAIL  = 'nao ha autorizacao de plataforma pendente e valida para este email e esta empresa.';
  END IF;

  -- 5) Trava consultiva por usuario (mesmo padrao das demais RPCs desta
  --    familia - serializa tentativas concorrentes do mesmo usuario).
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(v_usuario_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- 6) Idempotencia via id gerado no cliente. Replay legitimo = mesmo id,
  --    mesmo owner, com vinculo proprietario ativo correspondente.
  SELECT e.owner_id INTO v_owner_existente
    FROM public.empresas e
   WHERE e.id = p_empresa_id;

  IF v_owner_existente IS NOT NULL THEN
    IF v_owner_existente <> v_usuario_id THEN
      RAISE EXCEPTION USING
        ERRCODE = 'TRQ59',
        MESSAGE = 'operacao_nao_permitida',
        DETAIL  = 'identificador de empresa nao pode ser reutilizado.';
    END IF;

    SELECT ue.id INTO v_vinculo_id
      FROM public.usuarios_empresas ue
     WHERE ue.usuario_id = v_usuario_id
       AND ue.empresa_id = p_empresa_id
       AND ue.papel = 'proprietario'
       AND ue.ativo = true;

    IF v_vinculo_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'TRQ59',
        MESSAGE = 'operacao_nao_permitida',
        DETAIL  = 'identificador de empresa nao pode ser reutilizado.';
    END IF;

    RETURN QUERY
      SELECT e.id, e.nome, e.cnpj, e.telefone, e.plano, e.status_assinatura,
             v_vinculo_id, 'proprietario'::text, v_usuario_id, false
        FROM public.empresas e
       WHERE e.id = p_empresa_id;
    RETURN;
  END IF;

  -- 7) Criacao real (empresa + vinculo proprietario), so INSERT.
  BEGIN
    INSERT INTO public.empresas (id, owner_id, nome, cnpj, telefone)
    VALUES (p_empresa_id, v_usuario_id, v_nome, v_cnpj, v_telefone);
  EXCEPTION WHEN unique_violation THEN
    -- Descobre o nome real da constraint que disparou o erro.
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;

    -- Descoberta dinamica da PK de public.empresas pelo catalogo -
    -- NUNCA supoe o nome "empresas_pkey". Qualificacao explicita de
    -- pg_catalog obrigatoria (esta funcao usa search_path = '').
    BEGIN
      SELECT con.conname
        INTO STRICT v_pk_empresas_name
        FROM pg_catalog.pg_constraint con
       WHERE con.conrelid = 'public.empresas'::regclass
         AND con.contype = 'p';
    EXCEPTION WHEN no_data_found OR too_many_rows THEN
      -- Nao foi possivel confirmar a PK com exatidao - NUNCA classifica
      -- como colisao de UUID sem essa confirmacao. Falha segura, generica.
      RAISE EXCEPTION USING
        ERRCODE = 'TRQ60',
        MESSAGE = 'conflito_dados',
        DETAIL  = 'nao foi possivel criar a empresa com os dados informados.';
    END;

    IF v_constraint_name = v_pk_empresas_name THEN
      -- Confirmado: foi de fato a PK - colisao de p_empresa_id reutilizado.
      RAISE EXCEPTION USING
        ERRCODE = 'TRQ59',
        MESSAGE = 'operacao_nao_permitida',
        DETAIL  = 'identificador de empresa nao pode ser reutilizado.';
    ELSE
      -- Qualquer outra constraint de unicidade - generico, sem expor o
      -- nome descoberto ao chamador.
      RAISE EXCEPTION USING
        ERRCODE = 'TRQ60',
        MESSAGE = 'conflito_dados',
        DETAIL  = 'nao foi possivel criar a empresa com os dados informados.';
    END IF;
  END;

  INSERT INTO public.usuarios_empresas (empresa_id, usuario_id, papel, ativo)
  VALUES (p_empresa_id, v_usuario_id, 'proprietario', true)
  RETURNING id INTO v_vinculo_id;

  RETURN QUERY
    SELECT e.id, e.nome, e.cnpj, e.telefone, e.plano, e.status_assinatura,
           v_vinculo_id, 'proprietario'::text, v_usuario_id, true
      FROM public.empresas e
     WHERE e.id = p_empresa_id;
  RETURN;
END;
$function$;

ALTER FUNCTION public.criar_empresa_autorizada(uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.criar_empresa_autorizada(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_empresa_autorizada(uuid, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.criar_empresa_autorizada(uuid, text, text, text) IS
  'Unico portao de criacao de empresa (primeiro cadastro ou empresa adicional), condicionado a autorizacao administrativa previa em public.autorizacoes_onboarding. Substitui criar_empresa_com_vinculo e criar_nova_empresa_com_vinculo (EXECUTE revogado de authenticated nesta mesma migracao).';

-- =====================================================================
-- RPC public.existe_autorizacao_onboarding_pendente
-- =====================================================================
CREATE OR REPLACE FUNCTION public.existe_autorizacao_onboarding_pendente()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id uuid;
  v_email      text;
  v_existe     boolean;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RETURN false;
  END IF;

  -- Mesma normalizacao lower(btrim(...)) usada em criar_empresa_autorizada
  -- e no CHECK da tabela - consistencia obrigatoria entre os dois pontos
  -- de comparacao de e-mail.
  SELECT lower(btrim(u.email)) INTO v_email
    FROM auth.users u
   WHERE u.id = v_usuario_id;

  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.autorizacoes_onboarding
     WHERE email = v_email
       AND consumido_em IS NULL
       AND revogado_em IS NULL
       AND expira_em > now()
  ) INTO v_existe;

  RETURN v_existe;
END;
$function$;

ALTER FUNCTION public.existe_autorizacao_onboarding_pendente() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.existe_autorizacao_onboarding_pendente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.existe_autorizacao_onboarding_pendente() TO authenticated, service_role;

COMMENT ON FUNCTION public.existe_autorizacao_onboarding_pendente() IS
  'Leitura auxiliar para o frontend: retorna so um boolean (sem dado sensivel), indicando se o e-mail da sessao atual tem autorizacao de onboarding pendente e valida. Nao expoe nenhuma linha de autorizacoes_onboarding.';

-- =====================================================================
-- Fecha o desvio via REST das duas RPCs antigas NA MESMA migracao (sem
-- DROP ainda - so revoga o EXECUTE de authenticated). A partir daqui,
-- nenhuma empresa nova pode ser criada por nenhum caminho, ate o
-- frontend novo ser publicado chamando criar_empresa_autorizada.
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.criar_empresa_com_vinculo(text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid) FROM authenticated;

-- =====================================================================
-- Fecha tambem qualquer INSERT direto nas tabelas (sem passar por RPC
-- nenhuma) que anon/authenticated pudessem ter recebido em alguma
-- migracao anterior a esta - achado registrado na auditoria de
-- 10/09/2026 como risco fora do escopo original do arquivo, corrigido
-- aqui por autorizacao explicita do usuario. So INSERT e revogado: SELECT,
-- UPDATE e DELETE (e os grants de postgres/service_role) permanecem
-- exatamente como estavam, sem nenhuma alteracao. A unica via de escrita
-- nestas duas tabelas para authenticated passa a ser exclusivamente
-- criar_empresa_autorizada (SECURITY DEFINER, dono postgres).
-- =====================================================================
REVOKE INSERT ON TABLE public.empresas FROM anon, authenticated;
REVOKE INSERT ON TABLE public.usuarios_empresas FROM anon, authenticated;

-- =====================================================================
-- CONSULTAS FINAIS SOMENTE DE VERIFICACAO (nenhuma escrita) - confirmar
-- antes do COMMIT que tudo ficou exatamente como esperado.
-- =====================================================================
SELECT relrowsecurity AS rls_ativo, relforcerowsecurity AS rls_forcado
  FROM pg_catalog.pg_class
 WHERE oid = 'public.autorizacoes_onboarding'::regclass;

SELECT indexname, indexdef
  FROM pg_catalog.pg_indexes
 WHERE schemaname = 'public' AND tablename = 'autorizacoes_onboarding';

SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'autorizacoes_onboarding'
 ORDER BY grantee, privilege_type;

SELECT proname, provolatile, prosecdef
  FROM pg_catalog.pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('criar_empresa_autorizada', 'existe_autorizacao_onboarding_pendente');

SELECT has_function_privilege('authenticated', 'public.criar_empresa_com_vinculo(text, text, text)', 'EXECUTE') AS antiga_1_ainda_executavel,
       has_function_privilege('authenticated', 'public.criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid)', 'EXECUTE') AS antiga_2_ainda_executavel;
-- Esperado apos esta migracao: false e false.

SELECT has_function_privilege('authenticated', 'public.criar_empresa_autorizada(uuid, text, text, text)', 'EXECUTE') AS nova_rpc_executavel,
       has_function_privilege('authenticated', 'public.existe_autorizacao_onboarding_pendente()', 'EXECUTE') AS leitura_auxiliar_executavel;
-- Esperado apos esta migracao: true e true.

SELECT has_table_privilege('anon', 'public.empresas', 'INSERT') AS anon_pode_inserir_empresas,
       has_table_privilege('authenticated', 'public.empresas', 'INSERT') AS authenticated_pode_inserir_empresas,
       has_table_privilege('anon', 'public.usuarios_empresas', 'INSERT') AS anon_pode_inserir_vinculos,
       has_table_privilege('authenticated', 'public.usuarios_empresas', 'INSERT') AS authenticated_pode_inserir_vinculos;
-- Esperado apos esta migracao: false, false, false, false.

COMMIT;
