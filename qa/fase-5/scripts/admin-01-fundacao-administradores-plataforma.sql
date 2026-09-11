-- FASE 5 (Incremento 2.1) - Fundacao de administradores da plataforma.
--
-- Cria a tabela public.administradores_plataforma (quem e administrador da
-- plataforma, independente de qualquer empresa cliente) e quatro RPCs que
-- substituem o procedimento manual hoje feito pelo SQL Editor/Authentication
-- do Supabase para gerenciar autorizacoes de onboarding (ver
-- qa/fase-5/STATUS.md, secao "Procedimento manual de autorizacao"):
--   1) public.sou_administrador_plataforma()              - verificacao.
--   2) public.admin_listar_autorizacoes_onboarding(...)    - leitura.
--   3) public.admin_autorizar_onboarding(...)              - criar/renovar.
--   4) public.admin_revogar_autorizacao_onboarding(...)    - revogar pendente.
--
-- Investigacao de acoplamento (regra 7 de qa/ARQUITETURA-MULTINICHO.md),
-- escopo restrito a este incremento (10/09/2026): as estruturas tocadas por
-- esta migracao (auth.users, autorizacoes_onboarding,
-- administradores_plataforma) sao genericas, sem nenhum campo especifico de
-- segmento, e nao acessam nenhuma tabela operacional de empresa cliente
-- (clientes, veiculos, ordens de servico, financeiro, etc.). Isto nao e uma
-- conclusao sobre o acoplamento do restante do sistema - so confirma que
-- esta fundacao administrativa especifica pode prosseguir sem bloqueio.
--
-- CODIGOS TRQ (10/09/2026): confirmados livres por leitura de TODOS os .sql
-- do projeto antes de escolher (mesma auditoria que corrigiu a colisao
-- TRQ51/TRQ54 no Incremento 1). Em uso hoje: TRQ01-04, TRQ11, TRQ14-16,
-- TRQ21, TRQ24-28, TRQ31, TRQ34-41, TRQ44-47, TRQ49, TRQ51, TRQ54-60. Esta
-- migracao usa a proxima familia livre:
--   TRQ61 nao_autenticado
--   TRQ62 sem_permissao_administrativa
--   TRQ63 entrada_invalida
--   TRQ64 nao_encontrado
--   TRQ65 conflito_dados
--
-- ESTA MIGRACAO NAO CADASTRA NENHUM ADMINISTRADOR. A tabela e criada vazia -
-- de proposito, por instrucao explicita do usuario. O primeiro administrador
-- e tratado em procedimento SEPARADO (admin-03-bootstrap-primeiro-
-- administrador.sql), sem nenhum UUID ou e-mail fixo neste arquivo nem
-- naquele - a conta candidata so e aceita se passar pelos criterios
-- genericos descritos naquele procedimento (existir em auth.users, nao ter
-- nenhuma linha em usuarios_empresas, ainda nao estar em
-- administradores_plataforma).
--
-- AINDA NAO EXECUTADO. NAO RODAR sem revisao e autorizacao explicita
-- separada do usuario. Este arquivo e so a proposta de migracao para
-- revisao.
--
-- NAO INCLUI NESTA MIGRACAO (deliberadamente, fora de escopo desta etapa):
--   - qualquer INSERT em public.administradores_plataforma (nenhum
--     administrador e cadastrado aqui);
--   - qualquer alteracao em auth.users ou em Auth/configuracao do Supabase;
--   - Edge Function de envio automatico de convite (fica para o
--     Incremento 2.3);
--   - qualquer alteracao de frontend ou novo repositorio/dominio (fica
--     para o Incremento 2.2);
--   - qualquer informacao operacional de empresas clientes (clientes,
--     veiculos, ordens de servico, financeiro, etc.) - esta tabela e este
--     conjunto de RPCs so tratam identidade de administrador da plataforma
--     e autorizacoes de onboarding, nunca dados de uma empresa cliente.

BEGIN;

-- =====================================================================
-- PRECHECKS NAO DESTRUTIVOS (abortam a transacao inteira se algo nao
-- estiver exatamente como esperado - nada e alterado se qualquer um
-- destes falhar)
-- =====================================================================
DO $$
BEGIN
  -- 1) Dependencias externas precisam existir.
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: auth.users nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.autorizacoes_onboarding') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.autorizacoes_onboarding nao encontrada (dependencia de 3 das 4 RPCs desta migracao). Abortando sem alterar nada.';
  END IF;

  -- 2) A nova tabela nao pode existir ainda.
  IF to_regclass('public.administradores_plataforma') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.administradores_plataforma ja existe. Abortando sem alterar nada.';
  END IF;

  -- 3) Nenhuma das quatro novas funcoes pode existir ainda.
  IF to_regprocedure('public.sou_administrador_plataforma()') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: sou_administrador_plataforma() ja existe. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.admin_listar_autorizacoes_onboarding(boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_listar_autorizacoes_onboarding(boolean) ja existe. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.admin_autorizar_onboarding(text, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_autorizar_onboarding(text,integer) ja existe. Abortando sem alterar nada.';
  END IF;
  IF to_regprocedure('public.admin_revogar_autorizacao_onboarding(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_revogar_autorizacao_onboarding(uuid) ja existe. Abortando sem alterar nada.';
  END IF;
END $$;

-- =====================================================================
-- TABELA public.administradores_plataforma
-- =====================================================================
CREATE TABLE public.administradores_plataforma (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  ativo          boolean NOT NULL DEFAULT true,
  concedido_por  uuid REFERENCES auth.users(id),
  concedido_em   timestamptz NOT NULL DEFAULT now(),
  revogado_em    timestamptz,
  revogado_por   uuid REFERENCES auth.users(id),
  CONSTRAINT administradores_plataforma_revogacao_consistente
    CHECK (
      (ativo AND revogado_em IS NULL AND revogado_por IS NULL)
      OR
      ((NOT ativo) AND revogado_em IS NOT NULL AND revogado_por IS NOT NULL)
    )
);

COMMENT ON TABLE public.administradores_plataforma IS
  'Identidade administrativa da propria plataforma Torque - independente de qualquer empresa cliente e de qualquer vinculo em usuarios_empresas. Nao guarda nenhum dado operacional de empresa. Estado sempre soft (ativo/inativo) - nenhuma linha e apagada. Nenhum grant para anon/authenticated; concedido_por e nulo apenas no bootstrap do primeiro administrador (nao havia administrador anterior para conceder).';

-- concedido_por so pode ser nulo se for o unico registro sem outro
-- administrador ativo anterior no momento em que foi concedido - nao e
-- garantido por constraint (dependeria de estado historico), e sim pelo
-- procedimento de bootstrap (admin-03), que e a UNICA via prevista para
-- inserir a primeira linha desta tabela.

ALTER TABLE public.administradores_plataforma ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy criada de proposito - com RLS ligado e sem policy nenhuma,
-- nenhuma linha e visivel/gravavel por ninguem alem do dono da
-- tabela/roles com bypassrls. Reforcado pelos REVOKEs abaixo. Leitura pelo
-- frontend so acontece de forma indireta, via sou_administrador_plataforma()
-- (que devolve apenas um boolean, nunca uma linha desta tabela).

REVOKE ALL ON public.administradores_plataforma FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.administradores_plataforma TO service_role;
-- Nenhum DELETE concedido a ninguem - historico de concessao/revogacao
-- nunca e apagado por esta via, mesmo por service_role.

ALTER TABLE public.administradores_plataforma OWNER TO postgres;

-- =====================================================================
-- RPC public.sou_administrador_plataforma
-- =====================================================================
CREATE OR REPLACE FUNCTION public.sou_administrador_plataforma()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id uuid;
  v_eh_admin   boolean;
BEGIN
  -- Sem sessao = nao e administrador. Nunca lanca erro por ausencia de
  -- sessao (mesmo padrao de existe_autorizacao_onboarding_pendente) - o
  -- frontend usa isto so para decidir se mostra ou nao o painel.
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.administradores_plataforma a
     WHERE a.user_id = v_usuario_id
       AND a.ativo = true
  ) INTO v_eh_admin;

  RETURN v_eh_admin;
END;
$function$;

ALTER FUNCTION public.sou_administrador_plataforma() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sou_administrador_plataforma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sou_administrador_plataforma() TO authenticated, service_role;

COMMENT ON FUNCTION public.sou_administrador_plataforma() IS
  'Leitura auxiliar para o frontend: retorna so um boolean (sem dado sensivel), indicando se o usuario da sessao atual e administrador ativo da plataforma. Nao expoe nenhuma linha de administradores_plataforma.';

-- =====================================================================
-- RPC public.admin_listar_autorizacoes_onboarding
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_listar_autorizacoes_onboarding(
  p_apenas_pendentes boolean DEFAULT true
)
RETURNS TABLE(
  id                        uuid,
  email                     text,
  autorizado_por            uuid,
  autorizado_em             timestamptz,
  expira_em                 timestamptz,
  consumido_em              timestamptz,
  consumido_por             uuid,
  consumido_para_empresa_id uuid,
  revogado_em               timestamptz,
  revogado_por              uuid,
  situacao                  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id uuid;
  v_eh_admin   boolean;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ61',
      MESSAGE = 'nao_autenticado',
      DETAIL  = 'auth.uid() retornou null nesta chamada.';
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.administradores_plataforma a
     WHERE a.user_id = v_usuario_id
       AND a.ativo = true
  ) INTO v_eh_admin;

  IF NOT v_eh_admin THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ62',
      MESSAGE = 'sem_permissao_administrativa',
      DETAIL  = 'usuario autenticado nao e administrador ativo da plataforma.';
  END IF;

  -- 'situacao' e derivada, nunca armazenada - evita qualquer divergencia
  -- entre coluna e estado real. Mesma logica que rege a unicidade da
  -- tabela (consumido_em/revogado_em) e o portao de criar_empresa_autorizada
  -- (expira_em > now()).
  RETURN QUERY
    SELECT a.id, a.email, a.autorizado_por, a.autorizado_em, a.expira_em,
           a.consumido_em, a.consumido_por, a.consumido_para_empresa_id,
           a.revogado_em, a.revogado_por,
           CASE
             WHEN a.revogado_em IS NOT NULL THEN 'revogada'
             WHEN a.consumido_em IS NOT NULL THEN 'consumida'
             WHEN a.expira_em <= now() THEN 'expirada'
             ELSE 'pendente'
           END AS situacao
      FROM public.autorizacoes_onboarding a
     WHERE (NOT p_apenas_pendentes)
        OR (a.consumido_em IS NULL AND a.revogado_em IS NULL AND a.expira_em > now())
     ORDER BY a.autorizado_em DESC;
END;
$function$;

ALTER FUNCTION public.admin_listar_autorizacoes_onboarding(boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_listar_autorizacoes_onboarding(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_autorizacoes_onboarding(boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_listar_autorizacoes_onboarding(boolean) IS
  'Lista autorizacoes de onboarding (public.autorizacoes_onboarding), exclusivo para administrador ativo da plataforma. Por padrao (p_apenas_pendentes = true) mostra so as pendentes AINDA VALIDAS (nao consumidas, nao revogadas e nao expiradas); pendencias expiradas so aparecem no historico completo (false), com situacao = ''expirada''. Nenhum dado operacional de empresa cliente e retornado.';

-- =====================================================================
-- RPC public.admin_autorizar_onboarding
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_autorizar_onboarding(
  p_email text,
  p_horas_validade integer DEFAULT 72
)
RETURNS TABLE(
  id             uuid,
  email          text,
  autorizado_por uuid,
  autorizado_em  timestamptz,
  expira_em      timestamptz,
  renovada       boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id  uuid;
  v_eh_admin    boolean;
  v_email       text;
  v_lock_key    bigint;
  v_id          uuid;
  v_renovada    boolean;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ61',
      MESSAGE = 'nao_autenticado',
      DETAIL  = 'auth.uid() retornou null nesta chamada.';
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.administradores_plataforma a
     WHERE a.user_id = v_usuario_id
       AND a.ativo = true
  ) INTO v_eh_admin;

  IF NOT v_eh_admin THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ62',
      MESSAGE = 'sem_permissao_administrativa',
      DETAIL  = 'usuario autenticado nao e administrador ativo da plataforma.';
  END IF;

  -- Normalizacao identica ao CHECK da tabela e a criar_empresa_autorizada -
  -- lower(btrim(...)), nunca so lower().
  v_email := lower(btrim(p_email));
  IF v_email IS NULL OR v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ63',
      MESSAGE = 'entrada_invalida',
      DETAIL  = 'e-mail e obrigatorio e precisa conter "@" apos normalizacao.';
  END IF;

  IF p_horas_validade IS NULL OR p_horas_validade <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ63',
      MESSAGE = 'entrada_invalida',
      DETAIL  = 'horas de validade precisa ser maior que zero.';
  END IF;

  -- Trava consultiva por e-mail (nao por usuario, como em
  -- criar_empresa_autorizada) - aqui o alvo compartilhado entre chamadas
  -- concorrentes e o e-mail autorizado, nao quem esta autorizando.
  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(v_email), 1, 16))::bit(64)::bigint;
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- Idempotencia/renovacao: se ja existe uma pendencia (consumido_em e
  -- revogado_em nulos) para este e-mail - inclusive se ja expirada -
  -- RENOVA a mesma linha em vez de inserir outra. Isso e equivalente ao
  -- procedimento manual documentado em qa/fase-5/STATUS.md ("revogar
  -- pendencia expirada, depois inserir nova"), mas atomico e sem depender
  -- de dois passos separados.
  UPDATE public.autorizacoes_onboarding
     SET autorizado_por = v_usuario_id,
         autorizado_em  = now(),
         expira_em      = now() + (p_horas_validade || ' hours')::interval
   WHERE public.autorizacoes_onboarding.email = v_email
     AND consumido_em IS NULL
     AND revogado_em IS NULL
  RETURNING public.autorizacoes_onboarding.id INTO v_id;

  IF v_id IS NOT NULL THEN
    v_renovada := true;
  ELSE
    INSERT INTO public.autorizacoes_onboarding (email, autorizado_por, expira_em)
    VALUES (v_email, v_usuario_id, now() + (p_horas_validade || ' hours')::interval)
    RETURNING public.autorizacoes_onboarding.id INTO v_id;
    v_renovada := false;
  END IF;

  RETURN QUERY
    SELECT a.id, a.email, a.autorizado_por, a.autorizado_em, a.expira_em, v_renovada
      FROM public.autorizacoes_onboarding a
     WHERE a.id = v_id;
EXCEPTION
  WHEN unique_violation THEN
    -- So existe um indice unico relevante nesta tabela (pendencia por
    -- e-mail) - sem ambiguidade de qual constraint disparou, diferente do
    -- caso de public.empresas em criar_empresa_autorizada. A trava
    -- consultiva acima ja deveria ter evitado isto; se ainda assim
    -- acontecer (ex.: chamada concorrente fora desta funcao), falha
    -- generica e segura.
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ65',
      MESSAGE = 'conflito_dados',
      DETAIL  = 'nao foi possivel autorizar este e-mail agora.';
END;
$function$;

ALTER FUNCTION public.admin_autorizar_onboarding(text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_autorizar_onboarding(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_autorizar_onboarding(text, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_autorizar_onboarding(text, integer) IS
  'Cria ou renova (idempotente) uma autorizacao de onboarding por e-mail, exclusivo para administrador ativo da plataforma. Nao envia nenhum convite/e-mail - so registra a autorizacao (envio automatico fica para a Edge Function do Incremento 2.3).';

-- =====================================================================
-- RPC public.admin_revogar_autorizacao_onboarding
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_revogar_autorizacao_onboarding(
  p_autorizacao_id uuid
)
RETURNS TABLE(
  id           uuid,
  email        text,
  revogado_em  timestamptz,
  revogado_por uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id uuid;
  v_eh_admin   boolean;
  v_lock_key   bigint;
  v_id         uuid;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ61',
      MESSAGE = 'nao_autenticado',
      DETAIL  = 'auth.uid() retornou null nesta chamada.';
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.administradores_plataforma a
     WHERE a.user_id = v_usuario_id
       AND a.ativo = true
  ) INTO v_eh_admin;

  IF NOT v_eh_admin THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ62',
      MESSAGE = 'sem_permissao_administrativa',
      DETAIL  = 'usuario autenticado nao e administrador ativo da plataforma.';
  END IF;

  IF p_autorizacao_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ63',
      MESSAGE = 'entrada_invalida',
      DETAIL  = 'p_autorizacao_id e obrigatorio.';
  END IF;

  v_lock_key := ('x' || pg_catalog.substr(pg_catalog.md5(p_autorizacao_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- So revoga pendencia (nunca consumida, nunca ja revogada) - por
  -- instrucao explicita do usuario. Uma autorizacao ja consumida
  -- (empresa ja criada) nao pode ser "revogada" - isso pertenceria a um
  -- fluxo de bloqueio de empresa (Fase 5, fora deste incremento), nunca a
  -- esta tabela.
  UPDATE public.autorizacoes_onboarding
     SET revogado_em  = now(),
         revogado_por = v_usuario_id
   WHERE public.autorizacoes_onboarding.id = p_autorizacao_id
     AND consumido_em IS NULL
     AND public.autorizacoes_onboarding.revogado_em IS NULL
  RETURNING public.autorizacoes_onboarding.id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ64',
      MESSAGE = 'nao_encontrado',
      DETAIL  = 'autorizacao nao encontrada ou nao esta mais pendente (ja consumida ou ja revogada).';
  END IF;

  RETURN QUERY
    SELECT a.id, a.email, a.revogado_em, a.revogado_por
      FROM public.autorizacoes_onboarding a
     WHERE a.id = v_id;
END;
$function$;

ALTER FUNCTION public.admin_revogar_autorizacao_onboarding(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_revogar_autorizacao_onboarding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revogar_autorizacao_onboarding(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_revogar_autorizacao_onboarding(uuid) IS
  'Revoga somente uma autorizacao de onboarding ainda pendente (nunca uma ja consumida), exclusivo para administrador ativo da plataforma.';

-- =====================================================================
-- CONSULTAS FINAIS SOMENTE DE VERIFICACAO (nenhuma escrita) - confirmar
-- antes do COMMIT que tudo ficou exatamente como esperado.
-- =====================================================================
SELECT relrowsecurity AS rls_ativo, relforcerowsecurity AS rls_forcado
  FROM pg_catalog.pg_class
 WHERE oid = 'public.administradores_plataforma'::regclass;

SELECT count(*) AS total_administradores_apos_esta_migracao
  FROM public.administradores_plataforma;
-- Esperado apos esta migracao: 0 (nenhum administrador cadastrado aqui).

SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'administradores_plataforma'
 ORDER BY grantee, privilege_type;

SELECT proname, provolatile, prosecdef
  FROM pg_catalog.pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('sou_administrador_plataforma', 'admin_listar_autorizacoes_onboarding',
                    'admin_autorizar_onboarding', 'admin_revogar_autorizacao_onboarding');

SELECT has_function_privilege('authenticated', 'public.sou_administrador_plataforma()', 'EXECUTE') AS verificacao_executavel,
       has_function_privilege('authenticated', 'public.admin_listar_autorizacoes_onboarding(boolean)', 'EXECUTE') AS listagem_executavel,
       has_function_privilege('authenticated', 'public.admin_autorizar_onboarding(text, integer)', 'EXECUTE') AS autorizar_executavel,
       has_function_privilege('authenticated', 'public.admin_revogar_autorizacao_onboarding(uuid)', 'EXECUTE') AS revogar_executavel;
-- Esperado apos esta migracao: true nas quatro (o controle de acesso real e
-- feito DENTRO de cada RPC via administradores_plataforma, nao pelo grant).

SELECT has_table_privilege('anon', 'public.administradores_plataforma', 'SELECT') AS anon_pode_ler,
       has_table_privilege('authenticated', 'public.administradores_plataforma', 'SELECT') AS authenticated_pode_ler;
-- Esperado apos esta migracao: false e false (acesso so via RPC SECURITY DEFINER).

COMMIT;
