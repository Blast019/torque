-- Incremento 3.2 - Rollback SOMENTE do seed do admin-09 (plano "Teste" +
-- sua vigencia inicial). NAO reverte a estrutura do admin-08 - isso e' o
-- admin-11, separado, que so' deve ser executado depois deste.
--
-- SCRIPT PREPARADO, AINDA NAO EXECUTADO. Rollback de EMERGENCIA do seed
-- do admin-09 (executado com sucesso em producao em 14/09/2026 - ver
-- qa/fase-5/STATUS.md, checkpoint "Incremento 3.2: admin-08 e admin-09
-- executados com sucesso"). Este script so' deve ser rodado se for
-- necessario reverter o plano "Teste" e seu historico inicial - nao faz
-- parte do fluxo normal do Incremento 3.2.
--
-- empresas.plano permanece INTOCADA por este script.
--
-- VALIDACAO ANTES DE EXCLUIR (fail-closed): este script NUNCA executa um
-- DELETE em planos_historico_precos por plano_id em massa. Ele so' exclui
-- depois de confirmar que existe EXATAMENTE uma linha historica para o
-- plano "Teste" e que essa unica linha corresponde EXATAMENTE ao que o
-- admin-09 teria criado (preco=0, moeda='BRL', vigente_ate IS NULL,
-- motivo='cadastro inicial do catalogo normalizado', registrado_por IS
-- NULL, vigente_desde preenchida). Qualquer divergencia - mais de uma
-- linha, vigencia ja encerrada, reajuste posterior, motivo diferente -
-- aborta com RAISE EXCEPTION sem excluir nada, em vez de assumir que e'
-- seguro remover. A exclusao em si e' feita pelo id exato da linha ja
-- validada (WHERE id = ...), nunca apenas por plano_id.
--
-- AUDITORIA DE FKs (fail-closed, generica, por conkey/confkey reais): antes
-- de excluir o plano, este script enumera TODAS as foreign keys que
-- apontam para public.planos diretamente do catalogo (pg_constraint,
-- contype='f', confrelid=public.planos) - nao apenas public.assinaturas
-- por nome fixo. Para cada FK encontrada, a coluna filha e' resolvida por
-- conkey e a coluna referenciada em public.planos e' resolvida por
-- confkey (nunca presumido que a FK referencia planos.id - uma FK futura
-- poderia, em tese, referenciar outra coluna com UNIQUE) - a contagem de
-- referencias e' feita por um JOIN dinamico entre a tabela filha e
-- public.planos usando essas duas colunas reais, filtrando
-- public.planos.id = v_plano_id, nunca comparando a coluna filha
-- diretamente com o UUID do plano (o que so' funcionaria se a FK
-- referenciasse id). Isso cobre qualquer tabela futura que venha a
-- referenciar planos. O rollback nao depende do proprio DELETE falhar por
-- violacao de FK como rede de seguranca: uma FK futura com ON DELETE
-- CASCADE apagaria dados de outra tabela silenciosamente, e uma com ON
-- DELETE SET NULL deixaria o DELETE prosseguir sem erro nenhum,
-- mascarando referencias que deveriam ter impedido a exclusao. Por isso a
-- contagem de referencias e' feita e comparada explicitamente ANTES de
-- cada exclusao, nunca inferida do resultado do proprio DELETE.
--
-- CONCORRENCIA: a primeira acao deste bloco e' um SELECT ... FOR UPDATE
-- na linha do plano "Teste" em public.planos. Esse lock de linha, mantido
-- ate o COMMIT/ROLLBACK desta transacao, e' o que fecha a janela de
-- corrida entre a auditoria e os DELETEs: pelo protocolo padrao do
-- Postgres para FKs, qualquer transacao concorrente que tente inserir (ou
-- atualizar) uma linha em OUTRA tabela referenciando esta linha de
-- planos via foreign key precisa primeiro adquirir um lock FOR KEY SHARE
-- nesta mesma linha - e FOR KEY SHARE conflita com FOR UPDATE. Ou seja,
-- enquanto este script mantiver o FOR UPDATE sobre a linha do plano
-- "Teste", nenhuma nova referencia a ela (em planos_historico_precos ou
-- em qualquer tabela futura com FK para planos, seja qual for a coluna
-- referenciada) pode ser criada concorrentemente - a transacao
-- concorrente fica bloqueada ate este script terminar. A unica linha de
-- planos_historico_precos ja validada tambem e' lida com FOR UPDATE,
-- fechando a janela equivalente contra uma atualizacao concorrente dela
-- (por exemplo, um encerramento de vigencia) entre a validacao e o
-- DELETE por id. Nenhum LOCK TABLE explicito e' usado - os dois locks de
-- linha (FOR UPDATE) descritos acima sao suficientes e mais granulares.

BEGIN;

DO $$
DECLARE
  v_plano_id            uuid;
  v_historico_count      bigint;
  v_historico_id           uuid;
  v_hist_preco              numeric;
  v_hist_moeda               text;
  v_hist_vigente_desde        timestamptz;
  v_hist_vigente_ate            timestamptz;
  v_hist_motivo                  text;
  v_hist_registrado_por           uuid;
  v_qtd_hist_removida               integer;
  v_fk                                RECORD;
  v_fk_child_col                       text;
  v_fk_parent_col                       text;
  v_fk_qtd                               bigint;
  v_total_fks                             integer;
  v_total_referencias                      bigint;
BEGIN
  -- 1) Localiza e BLOQUEIA a linha do plano "Teste" (FOR UPDATE) - o lock
  --    e' mantido ate o fim da transacao (COMMIT/ROLLBACK) e, pelo
  --    protocolo de FK do Postgres, impede qualquer INSERT/UPDATE
  --    concorrente em outra tabela que tente referenciar esta linha via
  --    foreign key (ver nota de concorrencia no topo do arquivo).
  SELECT id INTO v_plano_id FROM public.planos WHERE nome = 'Teste' FOR UPDATE;

  IF v_plano_id IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: plano "Teste" nao encontrado - nada para reverter. Abortando sem alterar nada.';
  END IF;

  -- 2) Exige EXATAMENTE uma linha historica para este plano. Como o lock
  --    do passo 1 ja impede qualquer nova insercao referenciando este
  --    plano a partir daqui, esta contagem e' estavel para o resto da
  --    transacao. Zero significa que ja nao ha nada para reverter no
  --    historico (estado inesperado, investigar); mais de uma significa
  --    que houve reajuste posterior (ou outra insercao) alem do seed
  --    original do admin-09 - em nenhum dos dois casos este rollback
  --    automatico pode prosseguir com seguranca.
  SELECT count(*) INTO v_historico_count
    FROM public.planos_historico_precos
   WHERE plano_id = v_plano_id;

  IF v_historico_count <> 1 THEN
    RAISE EXCEPTION 'Precheck falhou: encontrada(s) % linha(s) historicas para o plano "Teste" (plano_id=%), esperado exatamente 1 (o seed original do admin-09). Se houve reajuste de preco ou outra alteracao posterior, este rollback automatico nao pode prosseguir com seguranca - investigue manualmente. Abortando sem excluir nada.', v_historico_count, v_plano_id;
  END IF;

  -- 3) Le e BLOQUEIA (FOR UPDATE) a unica linha, e confere CADA campo,
  --    exatamente, contra o que o admin-09 teria gravado - nunca presume
  --    que "existe uma linha so'" ja e' suficiente. O lock fecha a janela
  --    contra uma atualizacao concorrente desta linha especifica (por
  --    exemplo, um encerramento de vigencia) entre esta validacao e o
  --    DELETE por id mais abaixo.
  SELECT id, preco, moeda, vigente_desde, vigente_ate, motivo, registrado_por
    INTO v_historico_id, v_hist_preco, v_hist_moeda, v_hist_vigente_desde,
         v_hist_vigente_ate, v_hist_motivo, v_hist_registrado_por
    FROM public.planos_historico_precos
   WHERE plano_id = v_plano_id
   FOR UPDATE;

  IF v_hist_preco IS DISTINCT FROM 0
     OR v_hist_moeda IS DISTINCT FROM 'BRL'
     OR v_hist_vigente_ate IS NOT NULL
     OR v_hist_motivo IS DISTINCT FROM 'cadastro inicial do catalogo normalizado'
     OR v_hist_registrado_por IS NOT NULL
     OR v_hist_vigente_desde IS NULL
  THEN
    RAISE EXCEPTION 'Precheck falhou: a unica linha historica do plano "Teste" (id=%) nao corresponde exatamente ao seed esperado do admin-09 (preco=0, moeda=''BRL'', vigente_ate NULL, motivo=''cadastro inicial do catalogo normalizado'', registrado_por NULL, vigente_desde preenchida). Valores encontrados: preco=%, moeda=%, vigente_ate=%, motivo=%, registrado_por=%, vigente_desde=%. Isso indica vigencia encerrada, reajuste posterior ou divergencia manual - este rollback automatico nao pode prosseguir com seguranca. Abortando sem excluir nada.',
      v_historico_id, v_hist_preco, v_hist_moeda, v_hist_vigente_ate, v_hist_motivo, v_hist_registrado_por, v_hist_vigente_desde;
  END IF;

  -- 4) Auditoria GENERICA de TODAS as foreign keys que apontam para
  --    public.planos (nao apenas public.assinaturas), descobertas
  --    diretamente no catalogo. Para cada FK: conkey/confkey precisam ser
  --    arrays de uma unica coluna (aborta fail-closed caso contrario);
  --    a coluna filha e' resolvida por conkey e a coluna referenciada em
  --    public.planos e' resolvida por confkey (NUNCA presumido que a FK
  --    aponta para planos.id); a contagem e' feita por um JOIN dinamico
  --    entre a tabela filha e public.planos por essas colunas reais,
  --    filtrando public.planos.id = v_plano_id - nunca comparando a
  --    coluna filha diretamente com o UUID do plano. Antes de excluir a
  --    linha de historico, o total esperado de referencias a este plano
  --    e' EXATAMENTE 1 - a propria linha ja validada acima (via a FK
  --    planos_historico_precos_plano_id_fkey, criada pelo admin-08).
  --    Qualquer outra referencia (de planos_historico_precos alem dessa
  --    unica linha, ou de qualquer tabela futura com FK para planos) faz
  --    abortar aqui, sem excluir nada - o script nunca conta com o
  --    proprio DELETE para barrar isso, porque uma FK futura com ON
  --    DELETE CASCADE ou ON DELETE SET NULL deixaria o DELETE prosseguir
  --    silenciosamente em vez de falhar.
  v_total_fks := 0;
  v_total_referencias := 0;

  FOR v_fk IN
    SELECT con.conname, con.conrelid, con.conkey, con.confkey
      FROM pg_catalog.pg_constraint con
     WHERE con.contype = 'f'
       AND con.confrelid = 'public.planos'::regclass
  LOOP
    v_total_fks := v_total_fks + 1;

    IF array_length(v_fk.conkey, 1) <> 1 OR array_length(v_fk.confkey, 1) <> 1 THEN
      RAISE EXCEPTION 'Precheck falhou: a foreign key % (tabela de origem %) aponta para public.planos com mais de uma coluna - a auditoria generica deste script so suporta FKs de coluna unica. Abortando por seguranca, sem excluir nada.', v_fk.conname, v_fk.conrelid::regclass;
    END IF;

    SELECT a.attname INTO v_fk_child_col
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = v_fk.conrelid AND a.attnum = v_fk.conkey[1];

    SELECT a.attname INTO v_fk_parent_col
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.planos'::regclass AND a.attnum = v_fk.confkey[1];

    EXECUTE format(
      'SELECT count(*) FROM %s AS filha JOIN public.planos AS p ON filha.%I = p.%I WHERE p.id = $1',
      v_fk.conrelid::regclass, v_fk_child_col, v_fk_parent_col
    )
      INTO v_fk_qtd
      USING v_plano_id;

    v_total_referencias := v_total_referencias + v_fk_qtd;
  END LOOP;

  IF v_total_referencias <> 1 THEN
    RAISE EXCEPTION 'Precheck falhou: encontrada(s) % referencia(s) a public.planos (id=%) somando todas as % foreign key(s) existentes no catalogo, esperado exatamente 1 (a propria linha de historico ja validada). Abortando sem excluir nada.', v_total_referencias, v_plano_id, v_total_fks;
  END IF;

  -- 5) So' agora exclui a linha de historico - pelo id EXATO ja
  --    validado e bloqueado, nunca por plano_id em massa.
  DELETE FROM public.planos_historico_precos WHERE id = v_historico_id;
  GET DIAGNOSTICS v_qtd_hist_removida = ROW_COUNT;

  IF v_qtd_hist_removida <> 1 THEN
    RAISE EXCEPTION 'Verificacao falhou: o DELETE por id (id=%) removeu % linha(s), esperado exatamente 1 - possivel modificacao concorrente. Abortando (ROLLBACK).', v_historico_id, v_qtd_hist_removida;
  END IF;

  -- 6) Reaudita as MESMAS foreign keys (mesma resolucao por
  --    conkey/confkey e mesmo JOIN dinamico), agora esperando ZERO
  --    referencias a este plano, antes de excluir o proprio plano.
  v_total_referencias := 0;

  FOR v_fk IN
    SELECT con.conname, con.conrelid, con.conkey, con.confkey
      FROM pg_catalog.pg_constraint con
     WHERE con.contype = 'f'
       AND con.confrelid = 'public.planos'::regclass
  LOOP
    SELECT a.attname INTO v_fk_child_col
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = v_fk.conrelid AND a.attnum = v_fk.conkey[1];

    SELECT a.attname INTO v_fk_parent_col
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.planos'::regclass AND a.attnum = v_fk.confkey[1];

    EXECUTE format(
      'SELECT count(*) FROM %s AS filha JOIN public.planos AS p ON filha.%I = p.%I WHERE p.id = $1',
      v_fk.conrelid::regclass, v_fk_child_col, v_fk_parent_col
    )
      INTO v_fk_qtd
      USING v_plano_id;

    v_total_referencias := v_total_referencias + v_fk_qtd;
  END LOOP;

  IF v_total_referencias <> 0 THEN
    RAISE EXCEPTION 'Verificacao falhou: apos excluir a linha de historico, ainda existem % referencia(s) a public.planos (id=%) em foreign key(s) do catalogo - inseguro excluir o plano. Abortando (ROLLBACK).', v_total_referencias, v_plano_id;
  END IF;

  -- 7) So' entao remove o plano.
  DELETE FROM public.planos WHERE id = v_plano_id;

  -- 8) Verificacao final (fail-closed) - confirma que realmente sumiu.
  IF EXISTS (SELECT 1 FROM public.planos WHERE id = v_plano_id) THEN
    RAISE EXCEPTION 'Verificacao final falhou: plano "Teste" (id=%) ainda existe apos o DELETE. Abortando (ROLLBACK).', v_plano_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.planos_historico_precos WHERE plano_id = v_plano_id) THEN
    RAISE EXCEPTION 'Verificacao final falhou: ainda existe historico referenciando o plano "Teste" (plano_id=%) apos o DELETE. Abortando (ROLLBACK).', v_plano_id;
  END IF;

  RAISE NOTICE 'Rollback do seed OK: plano "Teste" (id=%) e a linha de historico validada (id=%) removidas. Estrutura (admin-08) NAO foi tocada - use o admin-11 separadamente, se necessario.', v_plano_id, v_historico_id;
END $$;

COMMIT;
