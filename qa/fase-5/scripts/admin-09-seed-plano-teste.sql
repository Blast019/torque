-- Incremento 3.2 - Seed idempotente do plano normalizado "Teste".
--
-- EXECUTADO COM SUCESSO EM PRODUCAO em 14/09/2026, imediatamente apos a
-- conclusao com sucesso do admin-08. Rodado manualmente no SQL Editor do
-- Supabase pelo usuario - retornou "Success. No rows returned" (sem
-- nenhum RAISE EXCEPTION), confirmando que o precheck, a insercao do
-- plano "Teste" e de sua primeira vigencia, e a verificacao final de
-- sincronizacao passaram integralmente. Validado depois por uma consulta
-- independente ao catalogo (nao o DO $$ deste script): plano "Teste"
-- criado com descricao/preco/moeda/ativo esperados, exatamente 1 linha
-- historica com todos os campos batendo (preco=0, moeda=BRL, vigente_ate
-- NULL, motivo="cadastro inicial do catalogo normalizado",
-- registrado_por NULL) e planos.preco/moeda sincronizados com o
-- historico vigente. Ver qa/fase-5/STATUS.md, checkpoint "Incremento 3.2:
-- admin-08 e admin-09 executados com sucesso" para o resultado integral
-- (incluindo plano_id e historico_id reais). Desenho completo no
-- checkpoint "Incremento 3.2: desenho do historico de precos e
-- instalacao da extensao btree_gist confirmada".
--
-- Decisoes de negocio ja aprovadas para este plano (ver checkpoint
-- "Incremento 3.2: duas decisoes de negocio aprovadas" e as decisoes
-- adicionais sobre valor/moeda/vigencia): plano "Teste" gratuito, preco
-- inicial 0,00, moeda BRL, vigencia inicial = now() no momento da
-- execucao deste script.
--
-- empresas.plano permanece INTOCADA por este script - nenhuma empresa e'
-- associada ao plano "Teste" normalizado aqui (isso e' trabalho futuro,
-- ainda pendente, listado no checkpoint acima). Nenhuma tabela
-- public.assinaturas existe ainda e nenhuma assinatura e' criada ou
-- alterada por este script.
--
-- MODELO DE PRECO CONTRATADO - RESSALVA IMPORTANTE (mesma do admin-08):
-- a vigencia aqui registrada e' um modelo simples de preco de tabela,
-- sem suporte a promocoes/descontos/valores negociados - isso sera
-- reavaliado no Incremento 3.3/3.4 antes de qualquer assinatura real
-- depender dela.
--
-- IDEMPOTENCIA (revisada): se este script for executado mais de uma vez,
-- ele NUNCA cria duplicidade nem sobrescreve silenciosamente. Um replay
-- so' e' considerado valido se TODOS os campos relevantes do plano
-- "Teste" (nome, descricao, preco, moeda, ativo) E o historico completo
-- dele baterem EXATAMENTE com o que o seed original teria produzido:
--   - o historico e' contado por INTEIRO (todas as linhas, abertas ou ja
--     encerradas) - nao apenas a vigencia aberta - porque um reajuste de
--     preco posterior encerraria a vigencia original e abriria uma nova,
--     e isso NAO e' um replay valido deste seed;
--   - a EXATAMENTE 1 linha historica esperada precisa ter, ela mesma,
--     todos os campos batendo (preco=0, moeda='BRL', vigente_ate IS
--     NULL, motivo='cadastro inicial do catalogo normalizado',
--     registrado_por IS NULL, vigente_desde preenchida) - nao apenas
--     "existir uma vigencia aberta com preco/moeda certos".
-- Qualquer divergencia em qualquer um desses campos - inclusive zero
-- historicos, mais de um historico, ou uma vigencia ja encerrada -
-- aborta com RAISE EXCEPTION para investigacao manual, em vez de
-- corrigir, substituir ou ignorar o que encontrar. Este e' exatamente o
-- mesmo estado exigido pelos prechecks do admin-10 (rollback do seed) -
-- um admin-09 bem-sucedido (insercao nova ou replay) sempre deixa o
-- plano "Teste" em um estado que o admin-10 pode reverter com seguranca.
--
-- CONCORRENCIA: o fluxo abaixo faz leituras para decidir se o plano/o
-- historico ja existem, seguidas condicionalmente de INSERTs - por si so
-- isso teria uma janela de corrida classica (TOCTOU) entre duas execucoes
-- concorrentes deste script: as duas poderiam ler "nao existe" ao mesmo
-- tempo e as duas tentarem inserir. Mesmo sem nenhum lock, essa
-- duplicacao especifica ja seria estruturalmente impossivel de
-- COMMITAR - o UNIQUE de planos.nome, o indice unico parcial
-- planos_historico_precos_vigente_unico e a exclusion constraint GiST
-- (todos criados pelo admin-08) fariam a transacao "perdedora" falhar
-- com um erro de violacao de constraint no proprio INSERT. Isso ja evita
-- qualquer duplicidade real - mas nao de forma idempotente/fail-closed
-- "limpa": a transacao perdedora abortaria com um erro generico de
-- constraint do Postgres, em vez de detectar via este script que o
-- estado esperado ja foi alcancado pela outra execucao.
--
-- Por isso, a primeira acao deste bloco e' adquirir um advisory lock
-- transacional (pg_advisory_xact_lock) com uma chave fixa e exclusiva
-- deste seed. Esse lock serializa quaisquer execucoes concorrentes deste
-- script especifico: a segunda execucao fica bloqueada ate a primeira
-- terminar (COMMIT ou ROLLBACK - o advisory lock e' liberado
-- automaticamente nesse momento, por ser _xact_ e nao _session_), e so'
-- entao le o estado ja committado pela primeira - momento em que o
-- proprio fluxo de leitura-entao-insercao ja existente (idempotente,
-- fail-closed) trata corretamente o caso de replay. No cenario onde a
-- SEGUNDA execucao concorrente encontra o plano/historico ja criados
-- pela primeira, ela cai no ramo de replay (compara valores, nao
-- insere de novo) - nunca no ramo de insercao. A chave do lock e'
-- derivada de uma string fixa e exclusiva deste seed via
-- hashtextextended, que gera uma chave de 64 bits (bigint) diretamente,
-- em vez do hash de 32 bits de hashtext ampliado por cast - isso
-- identifica este seed com risco de colisao com advisory locks de outro
-- script deste projeto bastante reduzido, embora nao eliminado por
-- garantia formal.

BEGIN;

DO $$
DECLARE
  v_plano_id                 uuid;
  v_plano_existe              boolean;
  v_descricao_atual            text;
  v_preco_atual                  numeric;
  v_moeda_atual                    text;
  v_ativo_atual                      boolean;
  v_total_historico                    bigint;
  v_hist_id                              uuid;
  v_hist_preco                            numeric;
  v_hist_moeda                             text;
  v_hist_vigente_desde                      timestamptz;
  v_hist_vigente_ate                          timestamptz;
  v_hist_motivo                                text;
  v_hist_registrado_por                         uuid;
BEGIN
  -- 0) Serializa execucoes concorrentes deste seed especifico - fecha a
  --    janela de corrida do fluxo de leitura-entao-insercao abaixo. Lock
  --    transacional: liberado automaticamente no COMMIT/ROLLBACK deste
  --    bloco, nunca precisa de unlock manual.
  PERFORM pg_advisory_xact_lock(hashtextextended('torque:qa:fase-5:admin-09:seed-plano-teste', 0));

  -- 1) public.planos e public.planos_historico_precos precisam existir
  --    (criadas pelo admin-08).
  IF to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos nao existe. Rode o admin-07 e o admin-08 primeiro. Abortando sem alterar nada.';
  END IF;

  IF to_regclass('public.planos_historico_precos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos_historico_precos nao existe. Rode o admin-08 primeiro. Abortando sem alterar nada.';
  END IF;

  -- 2) Verifica se o plano "Teste" ja existe (replay) ou se precisa ser
  --    criado agora - agora tambem lendo descricao, para conferir esse
  --    campo em um eventual replay.
  SELECT id, descricao, preco, moeda, ativo
    INTO v_plano_id, v_descricao_atual, v_preco_atual, v_moeda_atual, v_ativo_atual
    FROM public.planos
   WHERE nome = 'Teste';

  v_plano_existe := FOUND;

  IF v_plano_existe THEN
    -- 3a) Replay: confirma que TODOS os campos do plano batem EXATAMENTE
    --     com o esperado - nunca sobrescreve silenciosamente um estado
    --     diferente.
    IF v_descricao_atual IS DISTINCT FROM 'Plano de avaliacao gratuito'
       OR v_preco_atual IS DISTINCT FROM 0
       OR v_moeda_atual IS DISTINCT FROM 'BRL'
       OR v_ativo_atual IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Precheck falhou: plano "Teste" ja existe (id=%) mas com valores diferentes do esperado (descricao=%, preco=%, moeda=%, ativo=%). Abortando sem alterar nada - investigue manualmente antes de prosseguir.', v_plano_id, v_descricao_atual, v_preco_atual, v_moeda_atual, v_ativo_atual;
    END IF;

    -- Conta TODAS as linhas historicas deste plano - abertas ou ja
    -- encerradas. Um reajuste de preco posterior (fora do escopo deste
    -- seed) encerraria a vigencia original e abriria uma nova, o que
    -- NAO e' um replay valido deste script - precisa ser detectado e
    -- abortado, nao ignorado.
    SELECT count(*) INTO v_total_historico
      FROM public.planos_historico_precos
     WHERE plano_id = v_plano_id;

    IF v_total_historico <> 1 THEN
      RAISE EXCEPTION 'Precheck falhou: plano "Teste" (id=%) ja existe, mas tem % linha(s) historicas no total (contando abertas e encerradas), esperado exatamente 1 para um replay valido do seed original. Abortando sem alterar nada - investigue manualmente (pode haver reajuste de preco posterior, vigencia encerrada, ou o seed original nunca foi concluido corretamente).', v_plano_id, v_total_historico;
    END IF;

    -- A unica linha historica precisa corresponder, campo a campo, ao
    -- que este seed teria gravado originalmente.
    SELECT id, preco, moeda, vigente_desde, vigente_ate, motivo, registrado_por
      INTO v_hist_id, v_hist_preco, v_hist_moeda, v_hist_vigente_desde,
           v_hist_vigente_ate, v_hist_motivo, v_hist_registrado_por
      FROM public.planos_historico_precos
     WHERE plano_id = v_plano_id;

    IF v_hist_preco IS DISTINCT FROM 0
       OR v_hist_moeda IS DISTINCT FROM 'BRL'
       OR v_hist_vigente_ate IS NOT NULL
       OR v_hist_motivo IS DISTINCT FROM 'cadastro inicial do catalogo normalizado'
       OR v_hist_registrado_por IS NOT NULL
       OR v_hist_vigente_desde IS NULL
    THEN
      RAISE EXCEPTION 'Precheck falhou: a unica linha historica do plano "Teste" (id=%) nao corresponde exatamente ao seed original esperado (preco=0, moeda=''BRL'', vigente_ate NULL, motivo=''cadastro inicial do catalogo normalizado'', registrado_por NULL, vigente_desde preenchida). Valores encontrados: preco=%, moeda=%, vigente_ate=%, motivo=%, registrado_por=%, vigente_desde=%. Abortando sem alterar nada - investigue manualmente.',
        v_hist_id, v_hist_preco, v_hist_moeda, v_hist_vigente_ate, v_hist_motivo, v_hist_registrado_por, v_hist_vigente_desde;
    END IF;
  ELSE
    -- 3b) Plano ainda nao existia - cria agora.
    INSERT INTO public.planos (nome, descricao, preco, moeda, ativo)
    VALUES ('Teste', 'Plano de avaliacao gratuito', 0, 'BRL', true)
    RETURNING id INTO v_plano_id;

    -- Exige ZERO historicos para este plano recem-criado - o id e' novo
    -- (gen_random_uuid()), entao isso nunca deveria falhar; e' uma
    -- guarda fail-closed de sanidade, no mesmo espirito das demais
    -- reconfirmacoes ao vivo deste projeto, nunca presumida.
    SELECT count(*) INTO v_total_historico
      FROM public.planos_historico_precos
     WHERE plano_id = v_plano_id;

    IF v_total_historico <> 0 THEN
      RAISE EXCEPTION 'Verificacao falhou: o plano "Teste" (id=%) acabou de ser inserido nesta execucao, mas ja existem % linha(s) historicas para ele - estado inesperado. Abortando (ROLLBACK).', v_plano_id, v_total_historico;
    END IF;

    -- Insere exatamente a primeira vigencia deste plano recem-criado.
    INSERT INTO public.planos_historico_precos
      (plano_id, preco, moeda, vigente_desde, vigente_ate, motivo)
    VALUES
      (v_plano_id, 0, 'BRL', now(), NULL, 'cadastro inicial do catalogo normalizado');
  END IF;

  -- 4) Verificacao final de sincronizacao (mantida): planos.preco/
  --    planos.moeda (cache) precisam bater exatamente com o historico
  --    vigente, em qualquer um dos dois ramos acima.
  PERFORM 1
    FROM public.planos p
    JOIN public.planos_historico_precos h
      ON h.plano_id = p.id AND h.vigente_ate IS NULL
   WHERE p.id = v_plano_id AND p.preco = h.preco AND p.moeda = h.moeda;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verificacao final falhou: planos.preco/moeda nao correspondem ao historico vigente para o plano "Teste" (plano_id=%). Abortando (ROLLBACK).', v_plano_id;
  END IF;

  RAISE NOTICE 'Seed OK: plano "Teste" (id=%) com descricao=''Plano de avaliacao gratuito'', preco=0, moeda=BRL, ativo=true, e exatamente uma vigencia historica registrada em planos_historico_precos.', v_plano_id;
END $$;

COMMIT;
