-- Incremento 3.2 (Alternativa C) - Rollback SOMENTE dos dados criados pelo
-- admin-13 (associacoes empresa->assinatura). NAO reverte a estrutura do
-- admin-12 - isso e' o admin-15, separado, que so' deve ser executado
-- depois deste.
--
-- SCRIPT PREPARADO, AINDA NAO EXECUTADO. Rollback de EMERGENCIA do
-- backfill - so' deve ser rodado se for necessario reverter as
-- associacoes criadas, nao faz parte do fluxo normal deste incremento.
--
-- IDENTIFICACAO EXCLUSIVA DAS LINHAS DO ADMIN-13 (revisao obrigatoria
-- apos auditoria - correcao critica): este script NUNCA identifica uma
-- linha do backfill comparando plano_id/situacao com o estado atual de
-- empresas. Essa comparacao, isolada, NAO prova a origem de uma linha -
-- uma assinatura criada depois por outro caminho (ex.: a futura RPC unica
-- do Incremento 3.3/3.4) poderia ter, por coincidencia, os mesmos
-- plano_id/situacao de uma empresa, e seria apagada por engano se o
-- criterio fosse so' esse. Por isso a UNICA identificacao valida de uma
-- linha candidata e' o seu "id" ser EXATAMENTE:
--   md5('torque:admin-13:assinatura:' || empresa_id::text)::uuid
-- (o mesmo marcador deterministico que o admin-13 grava). So' depois de
-- localizada por esse id EXATO, a linha e' validada campo a campo
-- (empresa_id/plano_id/situacao) contra o que o backfill teria gerado
-- agora - e so' e' excluida se AMBAS as condicoes (id = marcador E
-- valores batem) forem verdadeiras. Isso significa, explicitamente:
--   - este script NUNCA aborta so' porque existem outras assinaturas com
--     id normal (gen_random_uuid()) na tabela - elas sao simplesmente
--     ignoradas, nunca examinadas como candidatas;
--   - este script NUNCA apaga uma linha cujo id nao seja exatamente o
--     marcador deterministico de alguma empresa atual.
-- O DELETE final tem WHERE explicito pelo conjunto desses ids
-- deterministicos - nunca um DELETE sem filtro em public.assinaturas.
--
-- VALIDACAO ANTES DE EXCLUIR (fail-closed): a validacao de TODAS as
-- linhas candidatas (id = marcador de alguma empresa) acontece antes de
-- qualquer DELETE - se qualquer uma divergir campo a campo do que o
-- backfill geraria agora, o script aborta inteiro, sem apagar nenhuma
-- linha, mesmo as que estariam corretas.
--
-- CONCORRENCIA: mesmo padrao e mesma ordem de locks do admin-13 - LOCK
-- TABLE IN SHARE MODE sobre empresas, planos e assinaturas (nessa ordem),
-- adquiridos logo apos confirmar que assinaturas existe. SHARE bloqueia
-- qualquer escrita concorrente (INSERT/UPDATE/DELETE, que sempre exigem
-- ROW EXCLUSIVE, conflitante com SHARE) durante toda a validacao e a
-- exclusao, sem bloquear leituras simples (ACCESS SHARE). ACCESS
-- EXCLUSIVE seria desnecessariamente mais restritivo. Mantidos ate o
-- COMMIT/ROLLBACK.
--
-- Nao toca em empresas nem em planos - somente DELETE em
-- public.assinaturas, filtrado exatamente pelos ids marcados, nunca
-- UPDATE em nenhuma outra tabela.

BEGIN;

DO $$
DECLARE
  v_total_nao_marcadas_antes    bigint;
  v_total_candidatas             integer := 0;
  v_empresa                        RECORD;
  v_marcador                        uuid;
  v_candidata                        RECORD;
  v_plano_esperado_id                 uuid;
  v_total_removidas                    bigint;
  v_total_nao_marcadas_depois            bigint;
BEGIN
  IF to_regclass('public.assinaturas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.assinaturas nao existe - nada para reverter. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.empresas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas nao existe. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos nao existe. Abortando sem alterar nada.';
  END IF;

  -- Locks explicitos (fail-closed contra concorrencia) - mesma ordem e
  -- mesmo modo minimo suficiente do admin-13.
  LOCK TABLE public.empresas IN SHARE MODE;
  LOCK TABLE public.planos IN SHARE MODE;
  LOCK TABLE public.assinaturas IN SHARE MODE;

  -- Linhas "nao marcadas" hoje = qualquer linha cujo id NAO seja o
  -- marcador deterministico de nenhuma empresa atual. Capturado ANTES da
  -- exclusao, para provar depois que nenhuma delas foi tocada.
  SELECT count(*) INTO v_total_nao_marcadas_antes
    FROM public.assinaturas a
   WHERE NOT EXISTS (
     SELECT 1 FROM public.empresas e
      WHERE md5('torque:admin-13:assinatura:' || e.id::text)::uuid = a.id
   );

  -- FASE 1 - localiza e valida TODAS as linhas candidatas (id = marcador
  -- de alguma empresa atual) antes de excluir qualquer uma. Empresas sem
  -- linha marcada sao simplesmente ignoradas (nao ha' nada a fazer para
  -- elas) - nunca abortam o script.
  FOR v_empresa IN SELECT id, plano, status_assinatura FROM public.empresas LOOP
    v_marcador := md5('torque:admin-13:assinatura:' || v_empresa.id::text)::uuid;

    SELECT empresa_id, plano_id, situacao INTO v_candidata
      FROM public.assinaturas
     WHERE id = v_marcador;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_total_candidatas := v_total_candidatas + 1;

    IF v_candidata.empresa_id IS DISTINCT FROM v_empresa.id THEN
      RAISE EXCEPTION 'Precheck falhou: a linha marcada (id=%) nao pertence a empresa esperada (empresa_id encontrado=%, empresa_id esperado=%) - integridade inesperada. Abortando sem excluir nada.', v_marcador, v_candidata.empresa_id, v_empresa.id;
    END IF;

    SELECT p.id INTO v_plano_esperado_id
      FROM public.planos p
     WHERE p.nome = v_empresa.plano;

    IF v_plano_esperado_id IS NULL THEN
      RAISE EXCEPTION 'Precheck falhou: nao foi possivel resolver, agora, o plano correspondente da empresa (id=%) - o valor de empresas.plano pode ter deixado de ter correspondencia unica em planos.nome desde o backfill. Abortando sem excluir nada.', v_empresa.id;
    END IF;

    IF v_candidata.plano_id IS DISTINCT FROM v_plano_esperado_id
       OR v_candidata.situacao IS DISTINCT FROM v_empresa.status_assinatura THEN
      RAISE EXCEPTION 'Precheck falhou: assinatura marcada (id=%, empresa_id=%) nao corresponde mais exatamente ao que o backfill teria gerado a partir do estado atual da empresa (plano_id esperado=%, situacao esperada=%) - pode ter sido alterada por outro processo apos o backfill. Abortando sem excluir nada.', v_marcador, v_empresa.id, v_plano_esperado_id, v_empresa.status_assinatura;
    END IF;
  END LOOP;

  -- FASE 2 - so' agora, com todas as candidatas validadas, exclui
  -- exclusivamente as linhas cujo id seja o marcador deterministico de
  -- alguma empresa atual - NUNCA um DELETE sem filtro.
  DELETE FROM public.assinaturas a
   WHERE a.id IN (
     SELECT md5('torque:admin-13:assinatura:' || e.id::text)::uuid
       FROM public.empresas e
   );
  GET DIAGNOSTICS v_total_removidas = ROW_COUNT;

  IF v_total_removidas <> v_total_candidatas THEN
    RAISE EXCEPTION 'Verificacao final falhou: o DELETE removeu % linha(s), esperado exatamente % (total de candidatas previamente validadas) - possivel modificacao concorrente. Abortando (ROLLBACK).', v_total_removidas, v_total_candidatas;
  END IF;

  -- Nenhuma linha marcada pode ter sobrado.
  IF EXISTS (
    SELECT 1 FROM public.assinaturas a
     WHERE EXISTS (
       SELECT 1 FROM public.empresas e
        WHERE md5('torque:admin-13:assinatura:' || e.id::text)::uuid = a.id
     )
  ) THEN
    RAISE EXCEPTION 'Verificacao final falhou: ainda existe pelo menos uma linha marcada em public.assinaturas apos o DELETE. Abortando (ROLLBACK).';
  END IF;

  -- Nenhuma linha nao marcada pode ter sido afetada.
  SELECT count(*) INTO v_total_nao_marcadas_depois FROM public.assinaturas;
  IF v_total_nao_marcadas_depois <> v_total_nao_marcadas_antes THEN
    RAISE EXCEPTION 'Verificacao final falhou: total de linhas nao marcadas mudou de % para % - alguma assinatura futura/nao marcada pode ter sido afetada. Abortando (ROLLBACK).', v_total_nao_marcadas_antes, v_total_nao_marcadas_depois;
  END IF;

  RAISE NOTICE 'Rollback do backfill OK: % linha(s) marcada(s) do admin-13 removida(s) (identificadas exclusivamente por id = marcador deterministico, nunca por comparacao de campos legados); % linha(s) nao marcada(s) preservada(s) intocada(s). Estrutura (admin-12) NAO foi tocada - use o admin-15 separadamente, se necessario. empresas e planos NAO foram alterados.', v_total_removidas, v_total_nao_marcadas_depois;
END $$;

COMMIT;
