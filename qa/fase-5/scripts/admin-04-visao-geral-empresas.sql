-- FASE 5 (Incremento 3.1) - Visao Geral do Painel Administrativo Central.
--
-- Cria a RPC public.admin_visao_geral_empresas, exclusiva para
-- administrador ativo da plataforma, retornando um unico jsonb com
-- indicadores administrativos agregados sobre public.empresas e
-- public.usuarios_empresas: total de empresas, contagem de vinculos
-- (total/ativos/inativos), serie mensal de novas empresas (sempre em
-- America/Sao_Paulo), e distribuicao por status_assinatura e por plano
-- (tratados como texto legado, sem presumir valores fechados).
--
-- Base de todo o desenho: qa/fase-5/STATUS.md, checkpoint "Incremento 3.1:
-- diagnostico real confirmado e desenho tecnico da RPC de Visao Geral" -
-- inclui o diagnostico real executado no banco (schema de empresas
-- confirmado, ausencia de nicho/situacao de acesso/estruturas financeiras)
-- e as correcoes de revisao (fuso horario explicito, make_interval,
-- ordenacao deterministica).
--
-- NAO INCLUI NESTA MIGRACAO (fora de escopo desta etapa):
--   - qualquer coluna nova em empresas/usuarios_empresas;
--   - nicho, situacao de acesso, bloqueio, plano normalizado, MRR ou
--     qualquer indicador financeiro (dependem de incrementos futuros,
--     ainda inexistentes);
--   - qualquer alteracao de frontend (Torque-Admin fica para depois);
--   - qualquer dado individual de empresa (nome, cnpj, telefone) ou de
--     usuario - so contagens e os dois textos administrativos legados.
--
-- Todos os limites e agrupamentos de mes na RPC sao calculados em
-- America/Sao_Paulo, nunca no fuso da sessao do banco (normalmente UTC) -
-- uma empresa criada perto da meia-noite em SP pode ja ser madrugada do
-- dia/mes seguinte em UTC; sem a conversao explicita ela apareceria no mes
-- errado. Validado por teste dedicado (ver qa/fase-5/STATUS.md).
--
-- EXECUTADO COM SUCESSO EM PRODUCAO em 11/09/2026. Este arquivo foi
-- reconciliado depois da execucao para refletir exatamente a definicao
-- real do banco (confirmada via pg_get_functiondef) - a migracao efetiva
-- nao foi rodada diretamente a partir deste arquivo, e sim de uma consulta
-- corrigida em tempo real apos duas tentativas rejeitadas (histórico
-- completo, incluindo as tentativas rejeitadas e a bateria de testes
-- pos-execucao, registrado em qa/fase-5/STATUS.md). O corpo da funcao
-- abaixo e copia exata do objeto real - comentarios explicativos que
-- existiam numa versao anterior deste arquivo foram movidos para fora da
-- funcao (aqui no cabecalho), pois o objeto real em producao nao os
-- contem.

BEGIN;

-- =====================================================================
-- PRECHECKS NAO DESTRUTIVOS (abortam a transacao inteira se algo nao
-- estiver exatamente como esperado - nada e alterado se qualquer um
-- destes falhar). Preservados aqui como registro do que foi exigido antes
-- da criacao - reexecutar este arquivo hoje abortaria de proposito no
-- Precheck 3 (a funcao ja existe).
-- =====================================================================
DO $$
BEGIN
  -- 1) Tabelas base precisam existir.
  IF to_regclass('public.empresas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.usuarios_empresas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.usuarios_empresas nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.administradores_plataforma') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.administradores_plataforma nao encontrada. Abortando sem alterar nada.';
  END IF;

  -- 2) Colunas usadas pela RPC precisam existir com esses nomes exatos -
  --    confirmadas pelo diagnostico real de 11/09/2026, mas conferidas de
  --    novo aqui, no momento da migracao, por seguranca.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empresas' AND column_name = 'criado_em'
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas.criado_em nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empresas' AND column_name = 'status_assinatura'
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas.status_assinatura nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empresas' AND column_name = 'plano'
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas.plano nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'usuarios_empresas' AND column_name = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.usuarios_empresas.ativo nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'usuarios_empresas' AND column_name = 'empresa_id'
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.usuarios_empresas.empresa_id nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'administradores_plataforma' AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.administradores_plataforma.user_id nao encontrada. Abortando sem alterar nada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'administradores_plataforma' AND column_name = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.administradores_plataforma.ativo nao encontrada. Abortando sem alterar nada.';
  END IF;

  -- 3) A RPC nova nao pode existir ainda.
  IF to_regprocedure('public.admin_visao_geral_empresas(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_visao_geral_empresas(integer) ja existe. Abortando sem alterar nada.';
  END IF;
END $$;

-- =====================================================================
-- RPC public.admin_visao_geral_empresas
--
-- Corpo abaixo e copia exata de pg_get_functiondef() do objeto real em
-- producao (confirmado apos a execucao) - sem nenhum comentario interno,
-- pois o objeto real nao os tem. Ver o cabecalho deste arquivo e
-- qa/fase-5/STATUS.md para a explicacao de cada trecho.
-- =====================================================================
CREATE FUNCTION public.admin_visao_geral_empresas(p_meses_serie integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id uuid;
  v_eh_admin boolean;
  v_resultado jsonb;
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ61',
      MESSAGE = 'nao_autenticado',
      DETAIL = 'auth.uid() retornou null nesta chamada.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.administradores_plataforma AS administrador
    WHERE administrador.user_id = v_usuario_id
      AND administrador.ativo = true
  )
  INTO v_eh_admin;

  IF NOT v_eh_admin THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ62',
      MESSAGE = 'sem_permissao_administrativa',
      DETAIL = 'usuario autenticado nao e administrador ativo da plataforma.';
  END IF;

  IF p_meses_serie IS NULL
     OR p_meses_serie < 1
     OR p_meses_serie > 36 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ63',
      MESSAGE = 'entrada_invalida',
      DETAIL = 'p_meses_serie precisa estar entre 1 e 36.';
  END IF;

  SELECT jsonb_build_object(
    'total_empresas',
    (
      SELECT count(*)
      FROM public.empresas
    ),

    'vinculos',
    jsonb_build_object(
      'total',
      (
        SELECT count(*)
        FROM public.usuarios_empresas
      ),
      'ativos',
      (
        SELECT count(*)
        FROM public.usuarios_empresas
        WHERE ativo = true
      ),
      'inativos',
      (
        SELECT count(*)
        FROM public.usuarios_empresas
        WHERE ativo = false
      ),
      'empresas_com_vinculo',
      (
        SELECT count(DISTINCT empresa_id)
        FROM public.usuarios_empresas
      )
    ),

    'novas_empresas_por_mes',
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'mes',
          to_char(serie.mes, 'YYYY-MM'),
          'total',
          coalesce(totais.total, 0)
        )
        ORDER BY serie.mes
      )
      FROM generate_series(
        date_trunc(
          'month',
          now() AT TIME ZONE 'America/Sao_Paulo'
        ) - make_interval(months => p_meses_serie - 1),
        date_trunc(
          'month',
          now() AT TIME ZONE 'America/Sao_Paulo'
        ),
        interval '1 month'
      ) AS serie(mes)
      LEFT JOIN (
        SELECT
          date_trunc(
            'month',
            empresas.criado_em
              AT TIME ZONE 'America/Sao_Paulo'
          ) AS mes,
          count(*) AS total
        FROM public.empresas AS empresas
        GROUP BY 1
      ) AS totais
        ON totais.mes = serie.mes
    ),

    'distribuicao_status_assinatura',
    (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'valor',
            distribuicao.status_assinatura,
            'total',
            distribuicao.total
          )
          ORDER BY
            distribuicao.total DESC,
            distribuicao.status_assinatura
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          empresas.status_assinatura,
          count(*) AS total
        FROM public.empresas AS empresas
        GROUP BY empresas.status_assinatura
      ) AS distribuicao
    ),

    'distribuicao_plano',
    (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'valor',
            distribuicao.plano,
            'total',
            distribuicao.total
          )
          ORDER BY
            distribuicao.total DESC,
            distribuicao.plano
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          empresas.plano,
          count(*) AS total
        FROM public.empresas AS empresas
        GROUP BY empresas.plano
      ) AS distribuicao
    ),

    'gerado_em',
    now()
  )
  INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

ALTER FUNCTION public.admin_visao_geral_empresas(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_visao_geral_empresas(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_visao_geral_empresas(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_visao_geral_empresas(integer) IS
  'Indicadores administrativos agregados da Visao Geral do Painel Administrativo Central.';

-- =====================================================================
-- CONSULTAS FINAIS SOMENTE DE VERIFICACAO (nenhuma escrita)
-- =====================================================================

-- Existencia e assinatura
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS assinatura_identidade,
  pg_get_function_arguments(p.oid) AS assinatura_completa
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'admin_visao_geral_empresas';
-- Esperado: 1 linha. assinatura_identidade = "integer" (usada para
-- ALTER/DROP FUNCTION - so o tipo, sem nome nem DEFAULT).
-- assinatura_completa = "p_meses_serie integer DEFAULT 12" (via
-- pg_get_function_arguments, inclui nome do parametro e o DEFAULT).

-- Proprietario, SECURITY DEFINER e volatilidade
SELECT
  p.proname,
  p.proowner::regrole::text AS owner,
  p.prosecdef AS security_definer,
  CASE p.provolatile
    WHEN 'v' THEN 'VOLATILE' WHEN 's' THEN 'STABLE' WHEN 'i' THEN 'IMMUTABLE'
  END AS volatilidade
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'admin_visao_geral_empresas';
-- Esperado: owner = postgres, security_definer = true, volatilidade = STABLE.

-- search_path configurado na funcao (deve conter "search_path=")
SELECT p.proname, p.proconfig
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'admin_visao_geral_empresas';
-- Esperado: proconfig contem algo como {search_path=} (vazio, nunca "public").

-- Privilegios de EXECUTE
SELECT
  has_function_privilege('authenticated', 'public.admin_visao_geral_empresas(integer)', 'EXECUTE') AS authenticated_pode_executar,
  has_function_privilege('anon', 'public.admin_visao_geral_empresas(integer)', 'EXECUTE') AS anon_pode_executar,
  has_function_privilege('service_role', 'public.admin_visao_geral_empresas(integer)', 'EXECUTE') AS service_role_pode_executar;
-- Esperado apos esta migracao: true, false, true.
-- Confirmado com dado real em producao (11/09/2026): true, false, true.

-- =====================================================================
-- VERIFICACAO FINAL RIGIDA (abortante) - alem das consultas informativas
-- acima, confirma com RAISE EXCEPTION (desfazendo a transacao inteira via
-- ROLLBACK automatico) se a RPC nao ficou exatamente como esperado. Nao
-- depende de leitura humana das consultas informativas para pegar um
-- desvio - a propria migracao recusa se comitar se algo estiver errado.
-- =====================================================================
DO $$
DECLARE
  v_funcao            pg_catalog.regprocedure;
  v_owner             text;
  v_security_definer  boolean;
  v_volatilidade      "char";
  v_proconfig         text[];
  v_search_path_vazio boolean;
BEGIN
  v_funcao := to_regprocedure('public.admin_visao_geral_empresas(integer)');
  IF v_funcao IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: admin_visao_geral_empresas(integer) nao existe apos a criacao. Abortando (ROLLBACK).';
  END IF;

  SELECT p.proowner::regrole::text, p.prosecdef, p.provolatile, p.proconfig
    INTO v_owner, v_security_definer, v_volatilidade, v_proconfig
    FROM pg_catalog.pg_proc p
   WHERE p.oid = v_funcao::oid;

  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Verificacao final falhou: owner = %, esperado postgres. Abortando (ROLLBACK).', v_owner;
  END IF;

  IF NOT v_security_definer THEN
    RAISE EXCEPTION 'Verificacao final falhou: SECURITY DEFINER nao esta ativo. Abortando (ROLLBACK).';
  END IF;

  IF v_volatilidade IS DISTINCT FROM 's' THEN
    RAISE EXCEPTION 'Verificacao final falhou: volatilidade = %, esperado STABLE (s). Abortando (ROLLBACK).', v_volatilidade;
  END IF;

  v_search_path_vazio := EXISTS (
    SELECT 1 FROM unnest(coalesce(v_proconfig, '{}'::text[])) AS cfg WHERE cfg = 'search_path='
  );
  IF NOT v_search_path_vazio THEN
    RAISE EXCEPTION 'Verificacao final falhou: search_path nao esta configurado como vazio (proconfig = %). Abortando (ROLLBACK).', v_proconfig;
  END IF;

  IF NOT has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificacao final falhou: authenticated nao tem EXECUTE. Abortando (ROLLBACK).';
  END IF;

  IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificacao final falhou: anon possui EXECUTE (nao deveria). Abortando (ROLLBACK).';
  END IF;

  IF NOT has_function_privilege('service_role', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificacao final falhou: service_role nao tem EXECUTE. Abortando (ROLLBACK).';
  END IF;

  RAISE NOTICE 'Verificacao final OK: admin_visao_geral_empresas(integer) - owner=postgres, SECURITY DEFINER ativo, STABLE, search_path vazio, authenticated=EXECUTE, anon=sem EXECUTE, service_role=EXECUTE.';
END $$;

COMMIT;
