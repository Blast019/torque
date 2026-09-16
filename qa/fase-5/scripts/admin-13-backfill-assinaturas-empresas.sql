-- Incremento 3.2 (Alternativa C) - Backfill idempotente: associa cada
-- empresa existente a public.assinaturas, resolvendo plano_id por
-- correspondencia exata de nome (empresas.plano = planos.nome) e copiando
-- o estado atual de status_assinatura para assinaturas.situacao.
--
-- SCRIPT PREPARADO, AINDA NAO EXECUTADO. Depende de public.assinaturas ja
-- existir com a estrutura criada pelo admin-12.
--
-- MARCADOR DETERMINISTICO (revisao obrigatoria apos auditoria): cada linha
-- criada por este backfill recebe um "id" calculado, nao aleatorio:
--   md5('torque:admin-13:assinatura:' || empresa_id::text)::uuid
-- Isso e' apenas uma MARCA TECNICA das linhas deste backfill - nao e' um
-- identificador de negocio nem substitui empresa_id como chave semantica.
-- O motivo: comparar plano_id/situacao com o estado atual de empresas NAO
-- prova por si so' que uma linha foi criada por este script - uma
-- assinatura criada depois por outro caminho (ex.: a futura RPC unica do
-- Incremento 3.3/3.4) poderia ter, por coincidencia, os mesmos
-- plano_id/situacao, e um rollback que apagasse "qualquer linha que bata
-- com os campos legados" apagaria essa linha por engano. Com o id
-- deterministico, o rollback (admin-14) so' toca em linhas cujo id seja
-- EXATAMENTE esse valor calculado - nunca em linhas com id normal
-- (gen_random_uuid(), o DEFAULT da tabela, inalterado pelo admin-12).
-- Assinaturas normais futuras (criadas fora deste backfill) continuam
-- recebendo id por gen_random_uuid() - este script e' o UNICO lugar deste
-- incremento que informa um "id" explicito no INSERT, e faz isso somente
-- para suas proprias linhas.
--
-- LOCALIZACAO DO PLANO - NUNCA POR UUID FIXO: este script nao presume nem
-- fixa o id do plano "Teste" (ou de qualquer outro) em nenhum ponto. Para
-- cada empresa, o plano_id e' resolvido dinamicamente por
-- "planos.nome = empresas.plano" no momento da execucao - mesmo que hoje
-- 100% das empresas estejam em "Teste", o script trata isso como o
-- resultado observado, nao como uma regra fixa.
--
-- VIGENCIA/DATA: iniciada_em recebe now() no momento da execucao - mesma
-- decisao ja aprovada e aplicada no admin-09 para a primeira vigencia do
-- plano "Teste" (vigente_desde = now(), sem data retroativa fabricada,
-- pois nao ha' historico real anterior a se preservar).
--
-- situacao recebe exatamente o valor atual de empresas.status_assinatura
-- (copia, sem reinterpretar nem mapear para outro rotulo) - continuidade
-- direta do campo legado, ja que nenhum dominio fechado de "situacao" foi
-- aprovado ainda (ver qa/fase-5/STATUS.md, Correcao 3: o conjunto de
-- situacoes elegiveis para rateio fica para o Incremento 3.7, nao decidido
-- agora).
--
-- IDEMPOTENCIA E FAIL-CLOSED: se uma empresa ja tiver uma assinatura, este
-- script NUNCA sobrescreve. Se essa assinatura existente NAO tiver o id
-- deterministico esperado, o script aborta (ela nao foi criada por este
-- backfill - provavelmente por uma RPC futura - e nao deve ser tratada
-- como um replay deste script). Se tiver o id deterministico mas
-- plano_id/situacao divergirem do que seria gerado agora, tambem aborta,
-- para investigacao manual, sem alterar nada. Antes de inserir, tambem
-- confirma que o id deterministico calculado ainda nao pertence a
-- NENHUMA outra empresa (deteccao de colisao, apesar de md5+uuid tornar
-- isso praticamente impossivel na pratica). Se o valor de empresas.plano
-- de qualquer empresa nao tiver correspondencia EXATA e UNICA em
-- planos.nome, ou se o plano correspondente estiver ativo=false, o script
-- aborta inteiro, sem criar nenhuma assinatura - nunca associa
-- parcialmente algumas empresas e pula as demais silenciosamente.
--
-- CONCORRENCIA: a primeira acao deste bloco (depois de confirmar que as
-- tabelas existem) e' adquirir LOCK TABLE ... IN SHARE MODE, na mesma
-- ordem (empresas, planos, assinaturas), sobre as tres tabelas lidas e
-- escritas por este script. SHARE e' o modo minimo suficiente para o
-- objetivo: conflita com ROW EXCLUSIVE (o modo que INSERT/UPDATE/DELETE
-- sempre precisam, inclusive de uma segunda execucao concorrente deste
-- mesmo script), entao nenhuma escrita concorrente pode acontecer em
-- nenhuma das tres tabelas enquanto esta transacao estiver aberta - mas
-- SHARE NAO conflita com ACCESS SHARE (leituras simples continuam
-- livres). ACCESS EXCLUSIVE seria desnecessariamente mais restritivo (
-- bloquearia inclusive leituras). Os locks sao mantidos ate o
-- COMMIT/ROLLBACK desta transacao, cobrindo precheck, backfill e
-- verificacao final.
--
-- empresas.plano e empresas.status_assinatura NUNCA sao alterados por
-- este script - somente lidos.

BEGIN;

DO $$
DECLARE
  v_total_empresas               bigint;
  v_total_assinaturas_antes       bigint;
  v_qtd_sem_correspondencia_unica   bigint;
  v_qtd_plano_inativo                 bigint;
  v_empresa                             RECORD;
  v_plano_id                              uuid;
  v_marcador                                uuid;
  v_assinatura_existente                      RECORD;
  v_total_assinaturas_depois                    bigint;
BEGIN
  -- 1) Tabelas base precisam existir.
  IF to_regclass('public.empresas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas nao existe. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos nao existe. Abortando sem alterar nada.';
  END IF;
  IF to_regclass('public.assinaturas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.assinaturas nao existe. Rode o admin-12 primeiro. Abortando sem alterar nada.';
  END IF;

  -- 2) Locks explicitos (fail-closed contra concorrencia) - mesma ordem
  --    em todo o incremento (empresas, planos, assinaturas), modo minimo
  --    suficiente (SHARE: bloqueia escrita concorrente, permite leitura
  --    concorrente). Mantidos ate o fim da transacao.
  LOCK TABLE public.empresas IN SHARE MODE;
  LOCK TABLE public.planos IN SHARE MODE;
  LOCK TABLE public.assinaturas IN SHARE MODE;

  SELECT count(*) INTO v_total_empresas FROM public.empresas;
  SELECT count(*) INTO v_total_assinaturas_antes FROM public.assinaturas;

  -- 3) Todo valor de empresas.plano precisa ter correspondencia EXATA e
  --    UNICA em planos.nome - abrange tanto ausencia (0 correspondencias)
  --    quanto duplicidade (mais de 1), reconfirmado ao vivo (nao presumido
  --    so' pela UNIQUE de planos.nome).
  SELECT count(*) INTO v_qtd_sem_correspondencia_unica
    FROM public.empresas e
   WHERE (SELECT count(*) FROM public.planos p WHERE p.nome = e.plano) <> 1;

  IF v_qtd_sem_correspondencia_unica <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: % empresa(s) com valor de plano sem correspondencia exata e unica em public.planos.nome. Abortando sem alterar nada - investigue manualmente antes de prosseguir.', v_qtd_sem_correspondencia_unica;
  END IF;

  -- 4) O plano correspondente precisa estar ativo.
  SELECT count(*) INTO v_qtd_plano_inativo
    FROM public.empresas e
    JOIN public.planos p ON p.nome = e.plano
   WHERE p.ativo = false;

  IF v_qtd_plano_inativo <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: % empresa(s) correspondem a um plano com ativo=false. Abortando sem alterar nada - investigue manualmente antes de prosseguir.', v_qtd_plano_inativo;
  END IF;

  -- 5) Para cada empresa: replay idempotente (compara e nunca sobrescreve
  --    divergencia) ou cria a assinatura agora, com id deterministico.
  FOR v_empresa IN SELECT id, plano, status_assinatura FROM public.empresas LOOP
    v_marcador := md5('torque:admin-13:assinatura:' || v_empresa.id::text)::uuid;

    SELECT id INTO v_plano_id FROM public.planos WHERE nome = v_empresa.plano;

    -- Deteccao de colisao: o marcador desta empresa ja pertence a OUTRA
    -- empresa em public.assinaturas?
    IF EXISTS (
      SELECT 1 FROM public.assinaturas a
       WHERE a.id = v_marcador AND a.empresa_id IS DISTINCT FROM v_empresa.id
    ) THEN
      RAISE EXCEPTION 'Precheck falhou: o id deterministico calculado para a empresa (id=%) ja pertence a uma assinatura de OUTRA empresa - colisao de marcador. Abortando sem alterar nada - investigue manualmente.', v_empresa.id;
    END IF;

    SELECT id, plano_id, situacao INTO v_assinatura_existente
      FROM public.assinaturas
     WHERE empresa_id = v_empresa.id;

    IF FOUND THEN
      IF v_assinatura_existente.id IS DISTINCT FROM v_marcador THEN
        RAISE EXCEPTION 'Precheck falhou: empresa (id=%) ja possui assinatura (id=%), mas com id diferente do marcador deterministico esperado (%) - essa assinatura nao foi criada por este backfill (provavelmente por outro caminho, ex.: uma RPC futura). Abortando sem alterar nada.', v_empresa.id, v_assinatura_existente.id, v_marcador;
      END IF;
      IF v_assinatura_existente.plano_id IS DISTINCT FROM v_plano_id
         OR v_assinatura_existente.situacao IS DISTINCT FROM v_empresa.status_assinatura THEN
        RAISE EXCEPTION 'Precheck falhou: assinatura marcada (id=%) da empresa (id=%) tem plano_id/situacao diferentes do que seria gerado agora a partir de empresas.plano/status_assinatura. Abortando sem alterar nada - investigue manualmente.', v_marcador, v_empresa.id;
      END IF;
      -- Replay exato (mesmo id deterministico, mesmos valores): nada a
      -- fazer para esta empresa.
    ELSE
      INSERT INTO public.assinaturas (id, empresa_id, plano_id, situacao, iniciada_em)
      VALUES (v_marcador, v_empresa.id, v_plano_id, v_empresa.status_assinatura, now());
    END IF;
  END LOOP;

  -- 6) Verificacao final: contagem depois precisa ser exatamente igual ao
  --    total de empresas - combinado com a UNIQUE (empresa_id) da propria
  --    tabela (que ja impede qualquer empresa ter mais de uma linha), essa
  --    igualdade prova que toda empresa tem exatamente uma assinatura.
  SELECT count(*) INTO v_total_assinaturas_depois FROM public.assinaturas;

  IF v_total_assinaturas_depois <> v_total_empresas THEN
    RAISE EXCEPTION 'Verificacao final falhou: total de assinaturas apos o backfill (%) nao bate com o total de empresas (%). Abortando (ROLLBACK).', v_total_assinaturas_depois, v_total_empresas;
  END IF;

  RAISE NOTICE 'Backfill OK: % empresa(s) antes, % assinatura(s) antes, % assinatura(s) depois (esperado = total de empresas = %). % assinatura(s) nova(s) criada(s) nesta execucao, cada uma com id deterministico md5(''torque:admin-13:assinatura:''||empresa_id).',
    v_total_empresas, v_total_assinaturas_antes, v_total_assinaturas_depois, v_total_empresas, (v_total_assinaturas_depois - v_total_assinaturas_antes);
END $$;

COMMIT;
