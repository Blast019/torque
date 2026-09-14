-- Incremento 3.2 - Remocao da tabela public.planos inesperada (nao criada
-- por nenhum script deste repositorio, encontrada durante o diagnostico de
-- 12/09/2026 - ver qa/fase-5/STATUS.md).
--
-- Motivo da remocao: RLS habilitado SEM nenhuma politica, combinado com
-- GRANT direto de SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- para anon e authenticated - protegida hoje so pelo comportamento
-- default-deny do RLS sem politica, uma protecao fragil e acidental.
-- Confirmado ZERO linhas (12/09/2026) antes desta remocao.
--
-- SEM CASCADE de proposito: se existir qualquer dependencia nao prevista
-- (view, FK de outra tabela), o DROP falha e nao apaga nada relacionado -
-- o precheck abaixo tambem confirma isso de forma explicita, via catalogo,
-- antes mesmo de tentar o DROP.
--
-- PROTECAO CONTRA CONCORRENCIA: logo apos o BEGIN, esta migracao obtem
-- LOCK TABLE public.planos IN ACCESS EXCLUSIVE MODE - o modo de bloqueio
-- mais forte do Postgres, incompativel com QUALQUER outro bloqueio
-- (inclusive o ACCESS SHARE que um simples SELECT de outra sessao
-- precisaria). A partir do momento em que esse LOCK e' concedido, e' com
-- garantia que nenhuma outra sessao consegue fazer INSERT, UPDATE, DELETE
-- ou qualquer alteracao estrutural (ALTER/trigger/policy nova) em
-- public.planos ate esta transacao terminar (COMMIT ou ROLLBACK) - todas
-- ficam bloqueadas esperando o lock, e so prosseguem depois que a tabela
-- ja tiver sido removida (ou a transacao abortada, e nesse caso operam
-- normalmente sobre a tabela ainda existente). Isso elimina a janela de
-- corrida entre "contar zero linhas" e o DROP em si: nenhuma linha pode
-- ser inserida nesse intervalo, porque ninguem mais consegue nem tentar
-- escrever enquanto o lock estiver com esta transacao.
--
-- ORDEM LOCK -> VALIDACAO: o LOCK TABLE roda ANTES de qualquer precheck
-- customizado, imediatamente apos o BEGIN. Isso ja e', por si so, uma
-- primeira camada de seguranca nativa do Postgres: LOCK TABLE falha com
-- erro (sem alterar nada, a transacao inteira e' abortada) se a relacao
-- nao existir ("relation ... does not exist"), e tambem falha se a
-- relacao existir mas nao for uma tabela comum ou particionada (Postgres
-- rejeita explicitamente views, materialized views, sequences e foreign
-- tables com o erro "... is not a table"). O precheck dentro do DO $$
-- abaixo faz uma segunda checagem, mais especifica, de relkind = 'r' -
-- necessaria porque o LOCK TABLE aceitaria tambem uma tabela particionada
-- (relkind = 'p'), que nao e' o caso esperado aqui.
--
-- EXECUTADO COM SUCESSO EM PRODUCAO em 14/09/2026. Rodado manualmente no
-- SQL Editor do Supabase pelo usuario - retornou "Success" (sem nenhum
-- RAISE EXCEPTION), confirmando que todos os 10 prechecks acima passaram,
-- o LOCK foi obtido, o DROP TABLE foi executado e a transacao chegou ao
-- COMMIT. A remocao de public.planos (tabela inesperada, proveniencia
-- desconhecida) foi confirmada depois por uma consulta independente ao
-- catalogo, feita separadamente da execucao deste script - ver
-- qa/fase-5/STATUS.md, checkpoint "Incremento 3.2: admin-06 e admin-07
-- executados com sucesso".

BEGIN;

LOCK TABLE public.planos IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  v_relkind                  "char";
  v_rls_habilitado           boolean;
  v_total_colunas            integer;
  v_divergencias             integer;
  v_total_constraints        integer;
  v_constraints_ok           integer;
  v_total_linhas             bigint;
  v_total_triggers           integer;
  v_total_policies           integer;
  v_total_views_dependentes  integer;
  v_total_fks_apontando      integer;
BEGIN
  -- 1) relkind = 'r' (tabela comum) - distingue de tabela particionada
  --    ('p'), que o LOCK TABLE acima ja teria aceitado sem reclamar.
  --    Existencia e "e' uma relacao lockavel" ja foram garantidas pelo
  --    LOCK TABLE acima (que teria abortado a transacao inteira antes de
  --    chegar aqui, caso contrario).
  SELECT c.relkind, c.relrowsecurity
    INTO v_relkind, v_rls_habilitado
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'planos';

  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos nao e uma tabela comum (relkind=%, esperado "r"). Abortando sem alterar nada.', v_relkind;
  END IF;

  -- 2) Numero TOTAL de colunas nao removidas = 6 (via pg_attribute, nao
  --    so a contagem das esperadas - uma 7a coluna aborta aqui).
  SELECT count(*) INTO v_total_colunas
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.planos'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_total_colunas <> 6 THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos tem % coluna(s), esperado exatamente 6. Abortando sem alterar nada.', v_total_colunas;
  END IF;

  -- 3) Nomes, tipos, nulabilidade e defaults EXATOS das 6 colunas,
  --    comparados um a um contra o diagnostico real de 12/09/2026.
  SELECT count(*) INTO v_divergencias
    FROM (
      VALUES
        ('id',        'uuid',                    false, 'gen_random_uuid()'::text),
        ('nome',      'text',                     false, NULL::text),
        ('descricao', 'text',                     true,  NULL::text),
        ('preco',     'numeric',                  false, '0'::text),
        ('ativo',     'boolean',                  false, 'true'::text),
        ('criado_em', 'timestamp with time zone', false, 'now()'::text)
    ) AS esperado(coluna, tipo, nulavel, default_esperado)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = 'planos'
     AND c.column_name = esperado.coluna
   WHERE c.column_name IS NULL
      OR c.data_type IS DISTINCT FROM esperado.tipo
      OR (c.is_nullable = 'YES') IS DISTINCT FROM esperado.nulavel
      OR c.column_default IS DISTINCT FROM esperado.default_esperado;

  IF v_divergencias <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: % coluna(s) de public.planos divergem do schema diagnosticado em 12/09/2026. Abortando sem alterar nada.', v_divergencias;
  END IF;

  -- 4) Exatamente 2 constraints, e cada uma com a DEFINICAO real exata
  --    (via pg_get_constraintdef - nao so nome/tipo, que poderiam
  --    coincidir por acaso com uma constraint cobrindo outra coluna).
  --    planos_pkey precisa ser literalmente "PRIMARY KEY (id)" e
  --    planos_nome_key precisa ser literalmente "UNIQUE (nome)".
  SELECT count(*) INTO v_total_constraints
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.planos'::regclass;

  IF v_total_constraints <> 2 THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos tem % constraint(s), esperado exatamente 2. Abortando sem alterar nada.', v_total_constraints;
  END IF;

  SELECT count(*) INTO v_constraints_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.planos'::regclass
     AND ( (con.conname = 'planos_pkey'
            AND con.contype = 'p'
            AND pg_get_constraintdef(con.oid) = 'PRIMARY KEY (id)')
        OR (con.conname = 'planos_nome_key'
            AND con.contype = 'u'
            AND pg_get_constraintdef(con.oid) = 'UNIQUE (nome)') );

  IF v_constraints_ok <> 2 THEN
    RAISE EXCEPTION 'Precheck falhou: as constraints de public.planos nao sao exatamente PRIMARY KEY (id) e UNIQUE (nome). Abortando sem alterar nada.';
  END IF;

  -- 5) Zero linhas - com o ACCESS EXCLUSIVE lock ja adquirido acima,
  --    nenhuma linha pode ter sido inserida entre este ponto e o DROP.
  SELECT count(*) INTO v_total_linhas FROM public.planos;
  IF v_total_linhas <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos tem % linha(s), esperado 0. Abortando sem apagar nenhum dado.', v_total_linhas;
  END IF;

  -- 6) Nenhum trigger definido (pg_trigger, catalogo real - nao
  --    information_schema.triggers, que ja foi usada so no diagnostico
  --    informativo anterior).
  SELECT count(*) INTO v_total_triggers
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.planos'::regclass
     AND NOT tgisinternal;

  IF v_total_triggers <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos tem % trigger(s), esperado 0. Abortando sem alterar nada.', v_total_triggers;
  END IF;

  -- 7) RLS precisa estar habilitado (relrowsecurity = true), mesmo
  --    estado diagnosticado em 12/09/2026 - se alguem desativou o RLS
  --    nesse meio tempo, o estado real diverge do diagnostico e aborta.
  IF NOT v_rls_habilitado THEN
    RAISE EXCEPTION 'Precheck falhou: RLS de public.planos nao esta habilitado (relrowsecurity=false), diferente do diagnosticado. Abortando sem alterar nada.';
  END IF;

  -- 8) Exatamente ZERO politicas RLS (pg_policy, catalogo real - nao a
  --    view pg_policies usada no diagnostico informativo anterior).
  SELECT count(*) INTO v_total_policies
    FROM pg_catalog.pg_policy
   WHERE polrelid = 'public.planos'::regclass;

  IF v_total_policies <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos tem % politica(s) RLS, esperado 0. Abortando sem alterar nada.', v_total_policies;
  END IF;

  -- 9) Nenhuma view/materialized view construida sobre a tabela - via
  --    pg_depend + pg_rewrite (dependencia real catalogada), nao busca
  --    textual.
  SELECT count(*) INTO v_total_views_dependentes
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite rw
      ON rw.oid = d.objid
     AND d.classid = 'pg_catalog.pg_rewrite'::regclass
   WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
     AND d.refobjid = 'public.planos'::regclass;

  IF v_total_views_dependentes <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: existem % view(s)/regra(s) dependendo de public.planos. Abortando sem alterar nada.', v_total_views_dependentes;
  END IF;

  -- 10) Nenhuma foreign key de outra tabela apontando para planos.
  SELECT count(*) INTO v_total_fks_apontando
    FROM pg_catalog.pg_constraint
   WHERE confrelid = 'public.planos'::regclass
     AND contype = 'f';

  IF v_total_fks_apontando <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: existem % foreign key(s) de outras tabelas apontando para public.planos. Abortando sem alterar nada.', v_total_fks_apontando;
  END IF;
END $$;

DROP TABLE public.planos;

DO $$
BEGIN
  IF to_regclass('public.planos') IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos ainda existe apos o DROP. Abortando (ROLLBACK).';
  END IF;

  RAISE NOTICE 'Verificacao final OK: public.planos removida com sucesso.';
END $$;

COMMIT;
