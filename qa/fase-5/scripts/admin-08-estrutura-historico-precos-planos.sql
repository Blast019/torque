-- Incremento 3.2 - Estrutura do historico de precos do catalogo de planos.
--
-- EXECUTADO COM SUCESSO EM PRODUCAO em 14/09/2026. Rodado manualmente no
-- SQL Editor do Supabase pelo usuario - retornou "Success. No rows
-- returned" (sem nenhum RAISE EXCEPTION), confirmando que o precheck, a
-- alteracao de public.planos, a criacao de public.planos_historico_precos
-- (constraints, indices, exclusion constraint GiST, RLS, grants) e a
-- verificacao final fail-closed passaram integralmente. Desenho completo
-- em qa/fase-5/STATUS.md, checkpoint "Incremento 3.2: desenho do historico
-- de precos e instalacao da extensao btree_gist confirmada"; registro da
-- execucao em si no checkpoint "Incremento 3.2: admin-08 e admin-09
-- executados com sucesso".
--
-- O que este script faz:
--   1) Adiciona public.planos.moeda (text, NOT NULL, default 'BRL') e as
--      CHECKs planos_moeda_suportada / planos_preco_nao_negativo em
--      public.planos (tabela ja existente, criada pelo admin-07).
--   2) Cria public.planos_historico_precos - ledger append-only de
--      vigencias de preco por plano, com integridade temporal garantida
--      por indice unico parcial (uma vigencia aberta por plano) + uma
--      exclusion constraint GiST (nenhuma sobreposicao de intervalos por
--      plano, mesmo entre vigencias ja fechadas).
--
-- btree_gist: este script NAO executa CREATE EXTENSION. A extensao
-- btree_gist foi instalada MANUALMENTE pelo usuario e confirmada antes
-- desta etapa (extname=btree_gist, extversion=1.7 - ver checkpoint citado
-- acima). O precheck abaixo apenas CONFIRMA (fail-closed) que ela ja
-- esta instalada - se nao estiver, o script aborta sem alterar nada. A
-- extensao NAO pertence ao rollback deste incremento (ver admin-11): ela
-- nunca sera removida por nenhum script deste projeto.
--
-- empresas.plano permanece INTOCADA por este script - nenhuma coluna,
-- constraint ou dado de public.empresas e alterado aqui. Nenhuma linha e
-- inserida em planos/planos_historico_precos por este script (isso e' o
-- admin-09, separado) - este script e' somente estrutura (DDL).
-- Nenhuma tabela public.assinaturas existe ainda e nenhuma assinatura e'
-- criada ou alterada por este script.
--
-- MODELO DE PRECO CONTRATADO - RESSALVA IMPORTANTE: a integridade
-- temporal aqui desenhada (vigente_desde/vigente_ate sem sobreposicao)
-- so' suporta um modelo simples de "preco de tabela historico". Ela NAO
-- suporta ainda promocoes, descontos ou valores individualmente
-- negociados por assinatura - isso sera reavaliado explicitamente no
-- Incremento 3.3/3.4 (Assinaturas). Nenhuma assinatura real deve depender
-- apenas desta associacao temporal para determinar o valor cobrado, sem
-- essa revisao acontecer antes.

BEGIN;

-- =============================================================
-- PRECHECKS (fail-closed) - nada e alterado se qualquer um falhar
-- =============================================================
DO $$
DECLARE
  v_btree_gist_instalada  boolean;
  v_total_colunas_planos  integer;
  v_divergencias_planos   integer;
  v_linhas_preco_negativo bigint;
BEGIN
  -- 1) btree_gist precisa estar instalada - este script NUNCA a cria.
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'btree_gist'
  ) INTO v_btree_gist_instalada;

  IF NOT v_btree_gist_instalada THEN
    RAISE EXCEPTION 'Precheck falhou: extensao btree_gist nao esta instalada neste banco. Este script NUNCA executa CREATE EXTENSION - instale manualmente (fora deste script) antes de rodar novamente. Abortando sem alterar nada.';
  END IF;

  -- 2) public.planos_historico_precos NAO pode existir ainda (evita
  --    reexecucao acidental deste script).
  IF to_regclass('public.planos_historico_precos') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos_historico_precos ja existe. Abortando sem alterar nada.';
  END IF;

  -- 3) public.planos precisa existir com EXATAMENTE a estrutura de 6
  --    colunas criada pelo admin-07 (nao pode ja ter, por exemplo, a
  --    coluna moeda desta migracao).
  IF to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos nao existe - rode o admin-07 primeiro. Abortando sem alterar nada.';
  END IF;

  SELECT count(*) INTO v_total_colunas_planos
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.planos'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_total_colunas_planos <> 6 THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos tem % coluna(s), esperado exatamente 6 (estrutura do admin-07, antes desta migracao). Abortando sem alterar nada.', v_total_colunas_planos;
  END IF;

  SELECT count(*) INTO v_divergencias_planos
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

  IF v_divergencias_planos <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: % coluna(s) de public.planos divergem da estrutura esperada (criada pelo admin-07). Abortando sem alterar nada.', v_divergencias_planos;
  END IF;

  -- 4) Nenhuma linha com preco negativo em planos, reconfirmado agora
  --    (nao presumido do diagnostico anterior), antes de adicionar a
  --    CHECK - um ADD CONSTRAINT CHECK ja falharia sozinho neste caso,
  --    mas este precheck da' uma mensagem de erro especifica e auditavel.
  SELECT count(*) INTO v_linhas_preco_negativo
    FROM public.planos
   WHERE preco < 0;

  IF v_linhas_preco_negativo <> 0 THEN
    RAISE EXCEPTION 'Precheck falhou: % linha(s) em public.planos com preco negativo. Abortando sem alterar nada.', v_linhas_preco_negativo;
  END IF;
END $$;

-- =============================================================
-- ALTERACAO DE public.planos (moeda + CHECKs)
-- =============================================================
ALTER TABLE public.planos
  ADD COLUMN moeda text NOT NULL DEFAULT 'BRL';

ALTER TABLE public.planos
  ADD CONSTRAINT planos_moeda_suportada CHECK (moeda = 'BRL');

ALTER TABLE public.planos
  ADD CONSTRAINT planos_preco_nao_negativo CHECK (preco >= 0);

-- =============================================================
-- CRIACAO DE public.planos_historico_precos
-- =============================================================
CREATE TABLE public.planos_historico_precos (
  id              uuid primary key default gen_random_uuid(),
  plano_id        uuid not null,
  preco           numeric not null,
  moeda           text not null default 'BRL',
  vigente_desde   timestamptz not null,
  vigente_ate     timestamptz,
  motivo          text,
  registrado_por  uuid,
  criado_em       timestamptz not null default now(),
  constraint planos_historico_precos_plano_id_fkey
    foreign key (plano_id) references public.planos(id),
  constraint planos_historico_precos_registrado_por_fkey
    foreign key (registrado_por) references auth.users(id) on delete set null,
  constraint planos_historico_precos_preco_nao_negativo
    check (preco >= 0),
  constraint planos_historico_precos_vigencia_valida
    check (vigente_ate is null or vigente_ate > vigente_desde),
  constraint planos_historico_precos_moeda_suportada
    check (moeda = 'BRL')
);

-- Uma vigencia aberta (vigente_ate IS NULL) por plano, no maximo.
CREATE UNIQUE INDEX planos_historico_precos_vigente_unico
  ON public.planos_historico_precos (plano_id)
  WHERE vigente_ate IS NULL;

-- Apoio as futuras consultas de "qual preco estava vigente na data X"
-- (usadas pelo MRR contratado, ver Correcao 4 do modelo financeiro).
CREATE INDEX planos_historico_precos_plano_vigencia_idx
  ON public.planos_historico_precos (plano_id, vigente_desde);

-- Impede sobreposicao de intervalos de vigencia por plano, mesmo entre
-- vigencias ja fechadas (o indice unico acima so' cobre a vigencia
-- aberta). Exige btree_gist, ja confirmada instalada no precheck acima.
ALTER TABLE public.planos_historico_precos
  ADD CONSTRAINT planos_historico_precos_sem_sobreposicao
  EXCLUDE USING gist (
    plano_id WITH =,
    tstzrange(vigente_desde, coalesce(vigente_ate, 'infinity'::timestamptz), '[)') WITH &&
  );

ALTER TABLE public.planos_historico_precos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos_historico_precos OWNER TO postgres;
REVOKE ALL ON TABLE public.planos_historico_precos FROM PUBLIC, anon, authenticated;

-- =============================================================
-- VERIFICACAO FINAL (fail-closed)
--
-- Nota de metodo (revisada): toda verificacao abaixo usa o catalogo
-- ESTRUTURAL sempre que existe uma representacao estrutural para o que
-- esta sendo conferido - nunca busca textual generica (ILIKE '%...%')
-- que pudesse aceitar por engano uma regra diferente da esperada:
--   - CHECK: conname exato, contype='c', convalidated=true, conrelid
--     exato, conkey apontando exatamente para a(s) coluna(s) certa(s)
--     (por attnum, nao por nome dentro de texto), e a expressao
--     conferida individualmente via regex ANCORADA (^...$, nao busca
--     livre) contra pg_get_expr(conbin, conrelid).
--   - FOREIGN KEY: conname exato, contype='f', conrelid/confrelid
--     exatos (por regclass, nao por texto), conkey/confkey exatos (por
--     attnum), confdeltype exato (a acao de exclusao realmente definida
--     no script - 'a'=NO ACTION para plano_id, que nao tem ON DELETE
--     declarado; 'n'=SET NULL para registrado_por), convalidated=true,
--     condeferrable=false (nenhuma das duas FKs foi declarada
--     DEFERRABLE).
--   - EXCLUSION CONSTRAINT: conname exato, contype='x', conrelid exato,
--     convalidated=true, metodo GiST confirmado via
--     conindid -> pg_class.relam -> pg_am.amname (estrutural), operador
--     de igualdade de plano_id e operador de sobreposicao do intervalo
--     confirmados via conexclop -> pg_operator.oprname (estrutural,
--     exato: "=" e "&&"). Only a forma do INTERVALO (expressao
--     tstzrange com vigente_desde/vigente_ate/infinity/"[)") usa
--     correspondencia por padrao ancorado contra pg_get_indexdef - essa
--     e' a UNICA parte que nao tem uma coluna escalar propria no
--     catalogo para comparacao exata (Postgres nao armazena expressoes
--     arbitrarias de chave de exclusion constraint como um valor
--     isolado, so' como texto reconstruido), entao o padrao exige TODOS
--     os elementos semanticos juntos, na ordem esperada - nao aceita
--     nenhuma outra regra por coincidencia parcial de substring.
--   - INDICES: nome exato, unicidade (indisunique), metodo de acesso
--     (pg_am.amname) e colunas exatas (por attnum via indkey, nao por
--     nome), e o predicado do indice parcial conferido por igualdade
--     exata via pg_get_expr(indpred, indrelid) - ja confirmado
--     confiavel para uma expressao IS NULL simples.
-- =============================================================
DO $$
DECLARE
  v_anon_oid                        oid;
  v_authenticated_oid               oid;

  -- attnums resolvidos uma unica vez, reusados nas comparacoes
  -- estruturais de conkey/confkey abaixo (nunca por nome de coluna
  -- dentro de texto livre).
  v_attnum_planos_id                 int2;
  v_attnum_planos_preco              int2;
  v_attnum_planos_moeda              int2;
  v_attnum_hist_plano_id             int2;
  v_attnum_hist_preco                int2;
  v_attnum_hist_moeda                int2;
  v_attnum_hist_vigente_desde        int2;
  v_attnum_hist_vigente_ate          int2;
  v_attnum_hist_registrado_por       int2;
  v_attnum_users_id                  int2;

  -- planos (alterada)
  v_total_colunas_planos            integer;
  v_divergencias_planos             integer;
  v_total_constraints_planos        integer;
  v_check_moeda_planos_ok           integer;
  v_check_preco_planos_ok           integer;
  v_relacl_planos                   pg_catalog.aclitem[];
  v_divergencias_acl_planos         text;

  -- planos_historico_precos (nova)
  v_relkind                         "char";
  v_rls_habilitado                  boolean;
  v_rls_forcado                     boolean;
  v_total_colunas_hist              integer;
  v_col_moeda_ok                    integer;
  v_total_constraints_hist          integer;
  v_pk_ok                           integer;
  v_fk_plano_ok                     integer;
  v_fk_registrado_por_ok            integer;
  v_check_preco_hist_ok             integer;
  v_check_vigencia_ok               integer;
  v_check_moeda_hist_ok             integer;

  -- exclusion constraint - verificada via catalogo estrutural
  -- (conindid -> pg_class.relam -> pg_am, e conexclop -> pg_operator);
  -- so' a forma do intervalo usa correspondencia por padrao ancorado
  -- (ver comentario no ponto de uso).
  v_exclusion_conoid                 oid;
  v_exclusion_amname                  text;
  v_exclusion_op1                     text;
  v_exclusion_op2                     text;
  v_exclusion_indexdef                text;

  -- indices planos - verificados via pg_index/pg_class/pg_am, nao so'
  -- pela existencia do nome.
  v_idx_unico_unique                  boolean;
  v_idx_unico_am                      text;
  v_idx_unico_natts                   int2;
  v_idx_unico_col1                    int2;
  v_idx_unico_pred                    text;
  v_idx_consulta_unique               boolean;
  v_idx_consulta_am                   text;
  v_idx_consulta_natts                int2;
  v_idx_consulta_col1                 int2;
  v_idx_consulta_col2                 int2;
  v_idx_consulta_pred                 pg_catalog.pg_node_tree;

  v_total_indices                   integer;
  v_total_policies                  integer;
  v_relacl_hist                     pg_catalog.aclitem[];
  v_divergencias_acl_hist           text;
BEGIN
  -- Resolve os OIDs de anon/authenticated uma unica vez - fail-closed,
  -- mesmo padrao ja usado e aprovado no admin-07.
  SELECT r.oid INTO v_anon_oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon';
  IF v_anon_oid IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: role "anon" nao existe neste banco. Abortando (ROLLBACK).';
  END IF;

  SELECT r.oid INTO v_authenticated_oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated';
  IF v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: role "authenticated" nao existe neste banco. Abortando (ROLLBACK).';
  END IF;

  -- Resolve os attnums usados nas comparacoes estruturais de
  -- conkey/confkey/indkey abaixo - uma unica vez, reusados em todas as
  -- checagens de CHECK/FK/indice desta verificacao.
  SELECT a.attnum INTO v_attnum_planos_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_planos_preco FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos'::regclass AND a.attname = 'preco' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_planos_moeda FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos'::regclass AND a.attname = 'moeda' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_hist_plano_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos_historico_precos'::regclass AND a.attname = 'plano_id' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_hist_preco FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos_historico_precos'::regclass AND a.attname = 'preco' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_hist_moeda FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos_historico_precos'::regclass AND a.attname = 'moeda' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_hist_vigente_desde FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos_historico_precos'::regclass AND a.attname = 'vigente_desde' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_hist_vigente_ate FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos_historico_precos'::regclass AND a.attname = 'vigente_ate' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_hist_registrado_por FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos_historico_precos'::regclass AND a.attname = 'registrado_por' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_users_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'auth.users'::regclass AND a.attname = 'id' AND NOT a.attisdropped;

  IF v_attnum_planos_id IS NULL OR v_attnum_planos_preco IS NULL OR v_attnum_planos_moeda IS NULL
     OR v_attnum_hist_plano_id IS NULL OR v_attnum_hist_preco IS NULL OR v_attnum_hist_moeda IS NULL
     OR v_attnum_hist_vigente_desde IS NULL OR v_attnum_hist_vigente_ate IS NULL
     OR v_attnum_hist_registrado_por IS NULL OR v_attnum_users_id IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: nao foi possivel resolver todos os attnums necessarios para a verificacao estrutural. Abortando (ROLLBACK).';
  END IF;

  -- ===================== public.planos (alterada) =====================

  SELECT count(*) INTO v_total_colunas_planos
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.planos'::regclass AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_total_colunas_planos <> 7 THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos tem % coluna(s), esperado exatamente 7 apos adicionar moeda. Abortando (ROLLBACK).', v_total_colunas_planos;
  END IF;

  -- 6 colunas originais, comparacao exata (ja confirmada contra o real).
  SELECT count(*) INTO v_divergencias_planos
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
      ON c.table_schema = 'public' AND c.table_name = 'planos' AND c.column_name = esperado.coluna
   WHERE c.column_name IS NULL
      OR c.data_type IS DISTINCT FROM esperado.tipo
      OR (c.is_nullable = 'YES') IS DISTINCT FROM esperado.nulavel
      OR c.column_default IS DISTINCT FROM esperado.default_esperado;

  IF v_divergencias_planos <> 0 THEN
    RAISE EXCEPTION 'Verificacao final falhou: % das 6 colunas originais de public.planos divergem apos a alteracao. Abortando (ROLLBACK).', v_divergencias_planos;
  END IF;

  -- coluna moeda (nova) - tipo/nulabilidade exatos; default conferido por
  -- regex ANCORADA (aceita so' as duas formas possiveis de deparse de um
  -- literal text: com ou sem o cast explicito ::text - nunca uma
  -- substring livre).
  SELECT count(*) INTO v_col_moeda_ok
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'planos' AND c.column_name = 'moeda'
     AND c.data_type = 'text' AND c.is_nullable = 'NO'
     AND c.column_default ~ '^''BRL''(::text)?$';

  IF v_col_moeda_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: coluna planos.moeda nao ficou com o tipo/nulabilidade/default esperados. Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_total_constraints_planos
    FROM pg_catalog.pg_constraint WHERE conrelid = 'public.planos'::regclass;

  IF v_total_constraints_planos <> 4 THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos tem % constraint(s), esperado exatamente 4 (PK + UNIQUE originais + 2 novas CHECKs). Abortando (ROLLBACK).', v_total_constraints_planos;
  END IF;

  -- CHECK planos_moeda_suportada: nome/tipo/validada/conrelid exatos,
  -- conkey exatamente sobre a coluna moeda (por attnum), expressao
  -- conferida por regex ANCORADA (^...$) contra pg_get_expr.
  SELECT count(*) INTO v_check_moeda_planos_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.planos'::regclass
     AND con.conname = 'planos_moeda_suportada'
     AND con.contype = 'c'
     AND con.convalidated
     AND con.conkey = ARRAY[v_attnum_planos_moeda]::int2[]
     AND pg_get_expr(con.conbin, con.conrelid) ~ '^\(moeda = ''BRL''(::text)?\)$';
  IF v_check_moeda_planos_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: CHECK planos_moeda_suportada nao confere estruturalmente (nome/tipo/validada/coluna/expressao). Abortando (ROLLBACK).';
  END IF;

  -- CHECK planos_preco_nao_negativo: mesma rigor - conkey exatamente
  -- sobre preco, expressao ancorada (tolerante so' ao cast ::numeric
  -- opcional, cuja presenca exata nunca foi observada ao vivo).
  SELECT count(*) INTO v_check_preco_planos_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.planos'::regclass
     AND con.conname = 'planos_preco_nao_negativo'
     AND con.contype = 'c'
     AND con.convalidated
     AND con.conkey = ARRAY[v_attnum_planos_preco]::int2[]
     AND pg_get_expr(con.conbin, con.conrelid) ~ '^\(preco >= \(?0\)?(::numeric)?\)$';
  IF v_check_preco_planos_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: CHECK planos_preco_nao_negativo nao confere estruturalmente (nome/tipo/validada/coluna/expressao). Abortando (ROLLBACK).';
  END IF;

  -- ACL de planos nao deveria ter mudado com um ALTER TABLE ADD
  -- COLUMN/ADD CONSTRAINT - reconfirmado aqui mesmo assim.
  SELECT coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner)) INTO v_relacl_planos
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'planos';

  SELECT string_agg(
           format('role=%s privilegio=%s grant_option=%s',
                  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END,
                  acl.privilege_type, acl.is_grantable),
           '; ' ORDER BY (CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END), acl.privilege_type
         )
    INTO v_divergencias_acl_planos
    FROM pg_catalog.aclexplode(v_relacl_planos) AS acl(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
   WHERE acl.grantee = 0 OR acl.grantee IN (v_anon_oid, v_authenticated_oid);

  IF v_divergencias_acl_planos IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: ACL real de public.planos mudou inesperadamente apos esta migracao. Divergencias: %. Abortando (ROLLBACK).', v_divergencias_acl_planos;
  END IF;

  -- ===================== public.planos_historico_precos (nova) =====================

  SELECT c.relkind, c.relrowsecurity, c.relforcerowsecurity
    INTO v_relkind, v_rls_habilitado, v_rls_forcado
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'planos_historico_precos';

  IF v_relkind IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos_historico_precos nao foi criada. Abortando (ROLLBACK).';
  END IF;
  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos_historico_precos nao e uma tabela comum (relkind=%). Abortando (ROLLBACK).', v_relkind;
  END IF;
  IF NOT v_rls_habilitado THEN
    RAISE EXCEPTION 'Verificacao final falhou: RLS de planos_historico_precos nao esta habilitado. Abortando (ROLLBACK).';
  END IF;
  IF v_rls_forcado THEN
    RAISE EXCEPTION 'Verificacao final falhou: RLS de planos_historico_precos esta FORCADO, fora do desenho aprovado (sem FORCE). Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_total_colunas_hist
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.planos_historico_precos'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_total_colunas_hist <> 9 THEN
    RAISE EXCEPTION 'Verificacao final falhou: planos_historico_precos tem % coluna(s), esperado exatamente 9. Abortando (ROLLBACK).', v_total_colunas_hist;
  END IF;

  SELECT count(*) INTO v_col_moeda_ok
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'planos_historico_precos' AND c.column_name = 'moeda'
     AND c.data_type = 'text' AND c.is_nullable = 'NO'
     AND c.column_default ~ '^''BRL''(::text)?$';
  IF v_col_moeda_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: coluna planos_historico_precos.moeda nao ficou com o tipo/nulabilidade/default esperados. Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_total_constraints_hist
    FROM pg_catalog.pg_constraint WHERE conrelid = 'public.planos_historico_precos'::regclass;
  IF v_total_constraints_hist <> 7 THEN
    RAISE EXCEPTION 'Verificacao final falhou: planos_historico_precos tem % constraint(s), esperado exatamente 7 (PK, 2 FKs, 3 CHECKs, 1 EXCLUDE). Abortando (ROLLBACK).', v_total_constraints_hist;
  END IF;

  SELECT count(*) INTO v_pk_ok FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.planos_historico_precos'::regclass AND conname = 'planos_historico_precos_pkey' AND contype = 'p'
     AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)';
  IF v_pk_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: PRIMARY KEY (id) de planos_historico_precos nao encontrada como esperado. Abortando (ROLLBACK).';
  END IF;

  -- FK plano_id -> planos(id): conrelid/confrelid exatos (por regclass),
  -- conkey/confkey exatos (por attnum), confdeltype = 'a' (NO ACTION -
  -- a acao realmente definida no script, ja que nenhum ON DELETE foi
  -- declarado para esta FK), validada, nao deferrable.
  SELECT count(*) INTO v_fk_plano_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'planos_historico_precos_plano_id_fkey'
     AND con.contype = 'f'
     AND con.conrelid = 'public.planos_historico_precos'::regclass
     AND con.confrelid = 'public.planos'::regclass
     AND con.conkey = ARRAY[v_attnum_hist_plano_id]::int2[]
     AND con.confkey = ARRAY[v_attnum_planos_id]::int2[]
     AND con.confdeltype = 'a'
     AND con.convalidated
     AND NOT con.condeferrable;
  IF v_fk_plano_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: FK planos_historico_precos_plano_id_fkey nao confere estruturalmente (conrelid/confrelid/conkey/confkey/confdeltype/validada/deferrable). Abortando (ROLLBACK).';
  END IF;

  -- FK registrado_por -> auth.users(id) ON DELETE SET NULL:
  -- confdeltype = 'n' exigido explicitamente.
  SELECT count(*) INTO v_fk_registrado_por_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'planos_historico_precos_registrado_por_fkey'
     AND con.contype = 'f'
     AND con.conrelid = 'public.planos_historico_precos'::regclass
     AND con.confrelid = 'auth.users'::regclass
     AND con.conkey = ARRAY[v_attnum_hist_registrado_por]::int2[]
     AND con.confkey = ARRAY[v_attnum_users_id]::int2[]
     AND con.confdeltype = 'n'
     AND con.convalidated
     AND NOT con.condeferrable;
  IF v_fk_registrado_por_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: FK planos_historico_precos_registrado_por_fkey nao confere estruturalmente (esperado ON DELETE SET NULL = confdeltype ''n''). Abortando (ROLLBACK).';
  END IF;

  -- CHECK preco >= 0.
  SELECT count(*) INTO v_check_preco_hist_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.planos_historico_precos'::regclass
     AND con.conname = 'planos_historico_precos_preco_nao_negativo'
     AND con.contype = 'c'
     AND con.convalidated
     AND con.conkey = ARRAY[v_attnum_hist_preco]::int2[]
     AND pg_get_expr(con.conbin, con.conrelid) ~ '^\(preco >= \(?0\)?(::numeric)?\)$';
  IF v_check_preco_hist_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: CHECK planos_historico_precos_preco_nao_negativo nao confere estruturalmente. Abortando (ROLLBACK).';
  END IF;

  -- CHECK vigente_ate IS NULL OR vigente_ate > vigente_desde - conkey
  -- precisa conter EXATAMENTE as duas colunas (verificado por dupla
  -- contencao, independente da ordem interna que o Postgres escolheu).
  SELECT count(*) INTO v_check_vigencia_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.planos_historico_precos'::regclass
     AND con.conname = 'planos_historico_precos_vigencia_valida'
     AND con.contype = 'c'
     AND con.convalidated
     AND con.conkey @> ARRAY[v_attnum_hist_vigente_desde, v_attnum_hist_vigente_ate]::int2[]
     AND con.conkey <@ ARRAY[v_attnum_hist_vigente_desde, v_attnum_hist_vigente_ate]::int2[]
     AND pg_get_expr(con.conbin, con.conrelid) ~ '^\(\(vigente_ate IS NULL\) OR \(vigente_ate > vigente_desde\)\)$';
  IF v_check_vigencia_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: CHECK planos_historico_precos_vigencia_valida nao confere estruturalmente. Abortando (ROLLBACK).';
  END IF;

  -- CHECK moeda = 'BRL'.
  SELECT count(*) INTO v_check_moeda_hist_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.planos_historico_precos'::regclass
     AND con.conname = 'planos_historico_precos_moeda_suportada'
     AND con.contype = 'c'
     AND con.convalidated
     AND con.conkey = ARRAY[v_attnum_hist_moeda]::int2[]
     AND pg_get_expr(con.conbin, con.conrelid) ~ '^\(moeda = ''BRL''(::text)?\)$';
  IF v_check_moeda_hist_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: CHECK planos_historico_precos_moeda_suportada nao confere estruturalmente. Abortando (ROLLBACK).';
  END IF;

  -- Exclusion constraint: nome/tipo/conrelid/validada exatos + metodo
  -- GiST confirmado estruturalmente via conindid -> pg_class.relam ->
  -- pg_am.amname (nao por texto).
  SELECT con.conindid, am.amname
    INTO v_exclusion_conoid, v_exclusion_amname
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class idx ON idx.oid = con.conindid
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
   WHERE con.conname = 'planos_historico_precos_sem_sobreposicao'
     AND con.contype = 'x'
     AND con.conrelid = 'public.planos_historico_precos'::regclass
     AND con.convalidated;

  IF v_exclusion_conoid IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: exclusion constraint planos_historico_precos_sem_sobreposicao nao encontrada (nome/tipo/conrelid/validada). Abortando (ROLLBACK).';
  END IF;
  IF v_exclusion_amname <> 'gist' THEN
    RAISE EXCEPTION 'Verificacao final falhou: exclusion constraint nao usa o metodo GiST (encontrado: %). Abortando (ROLLBACK).', v_exclusion_amname;
  END IF;

  -- Operadores exatos: conexclop[1] = "=" (para plano_id), conexclop[2]
  -- = "&&" (para o intervalo) - resolvidos via pg_operator, estrutural.
  SELECT
    (SELECT oprname FROM pg_catalog.pg_operator WHERE oid = con.conexclop[1]),
    (SELECT oprname FROM pg_catalog.pg_operator WHERE oid = con.conexclop[2])
    INTO v_exclusion_op1, v_exclusion_op2
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'planos_historico_precos_sem_sobreposicao';

  IF v_exclusion_op1 <> '=' THEN
    RAISE EXCEPTION 'Verificacao final falhou: primeiro operador da exclusion constraint nao e "=" (encontrado: %). Abortando (ROLLBACK).', v_exclusion_op1;
  END IF;
  IF v_exclusion_op2 <> '&&' THEN
    RAISE EXCEPTION 'Verificacao final falhou: segundo operador da exclusion constraint nao e "&&" (encontrado: %). Abortando (ROLLBACK).', v_exclusion_op2;
  END IF;

  -- Forma do intervalo (unica parte desta constraint conferida por
  -- padrao, nao por coluna escalar do catalogo - ver nota de metodo no
  -- topo desta verificacao). Regex case-insensitive e tolerante a
  -- espacos, mas ANCORADA a exigir plano_id + tstzrange com
  -- vigente_desde + coalesce(vigente_ate, infinity) + modo '[)', todos
  -- juntos - nunca aceitaria uma regra diferente por coincidencia
  -- parcial.
  SELECT pg_get_indexdef(con.conindid) INTO v_exclusion_indexdef
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'planos_historico_precos_sem_sobreposicao';

  IF v_exclusion_indexdef !~* 'plano_id.*tstzrange\(\s*vigente_desde\s*,\s*coalesce\(\s*vigente_ate\s*,\s*''infinity''.*\)\s*,\s*''\[\)''' THEN
    RAISE EXCEPTION 'Verificacao final falhou: definicao da exclusion constraint nao contem a expressao de intervalo esperada (plano_id + tstzrange(vigente_desde, coalesce(vigente_ate, infinity), "[)")). Definicao real: %. Abortando (ROLLBACK).', v_exclusion_indexdef;
  END IF;

  -- Indices: pkey + indice unico parcial + indice de consulta + indice
  -- de apoio da exclusion constraint = 4.
  SELECT count(*) INTO v_total_indices
    FROM pg_catalog.pg_indexes WHERE schemaname = 'public' AND tablename = 'planos_historico_precos';
  IF v_total_indices <> 4 THEN
    RAISE EXCEPTION 'Verificacao final falhou: planos_historico_precos tem % indice(s), esperado exatamente 4. Abortando (ROLLBACK).', v_total_indices;
  END IF;

  -- Indice unico parcial: unicidade, metodo (btree), coluna exata
  -- (attnum) e predicado exato "(vigente_ate IS NULL)" - todos via
  -- pg_index/pg_class/pg_am, nao so' a existencia do nome.
  SELECT idx.indisunique, am.amname, idx.indnatts, idx.indkey[0],
         pg_get_expr(idx.indpred, idx.indrelid)
    INTO v_idx_unico_unique, v_idx_unico_am, v_idx_unico_natts, v_idx_unico_col1, v_idx_unico_pred
    FROM pg_catalog.pg_class ic
    JOIN pg_catalog.pg_index idx ON idx.indexrelid = ic.oid
    JOIN pg_catalog.pg_am am ON am.oid = ic.relam
    JOIN pg_catalog.pg_namespace n ON n.oid = ic.relnamespace
   WHERE n.nspname = 'public' AND ic.relname = 'planos_historico_precos_vigente_unico';

  IF v_idx_unico_am IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_vigente_unico nao encontrado. Abortando (ROLLBACK).';
  END IF;
  IF NOT v_idx_unico_unique THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_vigente_unico nao e UNIQUE. Abortando (ROLLBACK).';
  END IF;
  IF v_idx_unico_am <> 'btree' THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_vigente_unico nao usa btree (encontrado: %). Abortando (ROLLBACK).', v_idx_unico_am;
  END IF;
  IF v_idx_unico_natts <> 1 OR v_idx_unico_col1 <> v_attnum_hist_plano_id THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_vigente_unico nao esta exatamente sobre a coluna plano_id. Abortando (ROLLBACK).';
  END IF;
  IF v_idx_unico_pred IS DISTINCT FROM '(vigente_ate IS NULL)' THEN
    RAISE EXCEPTION 'Verificacao final falhou: predicado parcial de planos_historico_precos_vigente_unico nao e exatamente "(vigente_ate IS NULL)" (encontrado: %). Abortando (ROLLBACK).', v_idx_unico_pred;
  END IF;

  -- Indice de consulta: nao unico, btree, exatamente (plano_id,
  -- vigente_desde) nessa ordem, sem predicado parcial.
  SELECT idx.indisunique, am.amname, idx.indnatts, idx.indkey[0], idx.indkey[1], idx.indpred
    INTO v_idx_consulta_unique, v_idx_consulta_am, v_idx_consulta_natts, v_idx_consulta_col1, v_idx_consulta_col2, v_idx_consulta_pred
    FROM pg_catalog.pg_class ic
    JOIN pg_catalog.pg_index idx ON idx.indexrelid = ic.oid
    JOIN pg_catalog.pg_am am ON am.oid = ic.relam
    JOIN pg_catalog.pg_namespace n ON n.oid = ic.relnamespace
   WHERE n.nspname = 'public' AND ic.relname = 'planos_historico_precos_plano_vigencia_idx';

  IF v_idx_consulta_am IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_plano_vigencia_idx nao encontrado. Abortando (ROLLBACK).';
  END IF;
  IF v_idx_consulta_unique THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_plano_vigencia_idx deveria ser NAO unico. Abortando (ROLLBACK).';
  END IF;
  IF v_idx_consulta_am <> 'btree' THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_plano_vigencia_idx nao usa btree (encontrado: %). Abortando (ROLLBACK).', v_idx_consulta_am;
  END IF;
  IF v_idx_consulta_natts <> 2 OR v_idx_consulta_col1 <> v_attnum_hist_plano_id OR v_idx_consulta_col2 <> v_attnum_hist_vigente_desde THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_plano_vigencia_idx nao esta exatamente sobre (plano_id, vigente_desde), nessa ordem. Abortando (ROLLBACK).';
  END IF;
  IF v_idx_consulta_pred IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: indice planos_historico_precos_plano_vigencia_idx nao deveria ter predicado parcial. Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_total_policies
    FROM pg_catalog.pg_policy WHERE polrelid = 'public.planos_historico_precos'::regclass;
  IF v_total_policies <> 0 THEN
    RAISE EXCEPTION 'Verificacao final falhou: planos_historico_precos tem % politica(s) RLS, esperado 0. Abortando (ROLLBACK).', v_total_policies;
  END IF;

  -- ACL de planos_historico_precos: mesma auditoria fail-closed do
  -- admin-07 (pg_class.relacl + aclexplode + acldefault, sem filtro
  -- fechado de tipo de privilegio).
  SELECT coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner)) INTO v_relacl_hist
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'planos_historico_precos';

  SELECT string_agg(
           format('role=%s privilegio=%s grant_option=%s',
                  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END,
                  acl.privilege_type, acl.is_grantable),
           '; ' ORDER BY (CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END), acl.privilege_type
         )
    INTO v_divergencias_acl_hist
    FROM pg_catalog.aclexplode(v_relacl_hist) AS acl(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
   WHERE acl.grantee = 0 OR acl.grantee IN (v_anon_oid, v_authenticated_oid);

  IF v_divergencias_acl_hist IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: ACL real de planos_historico_precos diverge do esperado (PUBLIC/anon/authenticated deveriam ter zero privilegios). Divergencias: %. Abortando (ROLLBACK).', v_divergencias_acl_hist;
  END IF;

  RAISE NOTICE 'Verificacao final OK: public.planos (7 colunas, 4 constraints) e public.planos_historico_precos (9 colunas, 7 constraints, 4 indices, RLS habilitado sem FORCE, zero policies, zero privilegios para PUBLIC/anon/authenticated) conferidas com sucesso.';
END $$;

COMMIT;
