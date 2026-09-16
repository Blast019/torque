-- Incremento 3.2 (Alternativa C, aprovada) - Estrutura de public.assinaturas.
--
-- SCRIPT PREPARADO, AINDA NAO EXECUTADO.
--
-- Implementa EXATAMENTE o desenho de "assinaturas" ja aprovado no checkpoint
-- "Planejamento revisado do Incremento 3", Correcao 1 (ver qa/fase-5/
-- STATUS.md): "assinaturas - contrato permanente da empresa, uma linha por
-- empresa, com o mesmo id para sempre: id, empresa_id (unico), plano_id
-- (plano atual - cache do estado corrente), situacao (situacao atual -
-- cache do estado corrente), iniciada_em, criado_em." Nenhum campo alem
-- destes seis foi adicionado, e nenhuma regra de negocio nova foi
-- inventada.
--
-- ESCOPO DESTA ETAPA (decisao "Alternativa C" registrada em qa/fase-5/
-- STATUS.md): public.assinaturas passa a ser a fonte oficial da assinatura
-- atual da empresa, e assinaturas.plano_id a fonte oficial do plano atual.
-- NAO cria empresas.plano_id. NAO altera nem remove empresas.plano nem
-- empresas.status_assinatura - continuam existindo, intocadas, como campos
-- legados durante a transicao.
--
-- NAO INCLUIDO NESTA ETAPA (fora de escopo, de proposito):
--   - public.assinaturas_historico, public.cobrancas, public.pagamentos -
--     pertencem ao Incremento 3.3/3.4, ainda nao iniciado;
--   - qualquer policy de RLS (RLS e' habilitado, mas fica sem nenhuma
--     policy nesta etapa - ver nota de RESSALVA abaixo);
--   - qualquer RPC nova ou alterada;
--   - qualquer alteracao em empresas ou planos.
--
-- RESSALVA IMPORTANTE (risco documentado, nao um erro de desenho): a
-- "Regra obrigatoria de implementacao" da Correcao 1 diz que "nenhuma RPC
-- pode escrever em assinaturas.plano_id/situacao sem, na mesma transacao,
-- fechar o evento anterior e inserir o novo evento em
-- assinaturas_historico. Nao havera via de escrita direta nessas colunas
-- fora dessa RPC unica." Essa RPC e assinaturas_historico ainda NAO
-- existem - sao trabalho do Incremento 3.3/3.4. O script de backfill
-- (admin-13) e', por decisao explicita e temporaria desta etapa, o UNICO
-- escritor direto permitido em assinaturas.plano_id/situacao enquanto essa
-- RPC nao existir - nenhum outro caminho de escrita deve ser criado antes
-- do Incremento 3.3/3.4 fechar esse gap (ver qa/fase-5/STATUS.md, secao de
-- riscos, para o registro completo desta decisao).
--
-- REGRAS ON DELETE (nao especificadas literalmente na Correcao 1 para
-- estas duas FKs - resolvidas aqui pela convencao real ja em uso neste
-- banco, nao inventadas):
--   - empresa_id -> empresas(id) ON DELETE CASCADE: mesma regra usada
--     pelas OUTRAS 11 foreign keys que hoje apontam para empresas(id)
--     (owner_id e as 10 tabelas operacionais - agendamentos, clientes,
--     funcionarios, etc., todas confirmadas ON DELETE CASCADE no
--     diagnostico real do Incremento 3.1).
--   - plano_id -> planos(id) SEM ON DELETE (NO ACTION): mesma regra da
--     UNICA outra FK existente para planos(id) hoje,
--     planos_historico_precos_plano_id_fkey (criada pelo admin-08, sem
--     ON DELETE declarado) - impede excluir um plano que ainda tenha
--     assinaturas referenciando-o, em vez de apagar/anular silenciosamente.
--
-- Multiempresa/isolamento (CLAUDE.md secao 18): assinaturas e' uma tabela
-- pertencente a uma empresa - possui empresa_id (FK), permitindo
-- identificar a empresa proprietaria, consistente com a regra do projeto.

BEGIN;

-- =============================================================
-- PRECHECKS (fail-closed) - nada e alterado se qualquer um falhar
-- =============================================================
DO $$
DECLARE
  v_attnum_empresas_id int2;
  v_attnum_planos_id   int2;
BEGIN
  IF to_regclass('public.empresas') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas nao existe. Abortando sem alterar nada.';
  END IF;

  IF to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos nao existe. Abortando sem alterar nada.';
  END IF;

  IF to_regclass('public.assinaturas') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.assinaturas ja existe. Abortando sem alterar nada.';
  END IF;

  -- Confirma que as colunas-alvo das FKs existem e sao uuid, antes de
  -- tentar criar as foreign keys sobre elas.
  SELECT a.attnum INTO v_attnum_empresas_id
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.empresas'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  IF v_attnum_empresas_id IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas.id nao encontrada. Abortando sem alterar nada.';
  END IF;

  SELECT a.attnum INTO v_attnum_planos_id
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.planos'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  IF v_attnum_planos_id IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos.id nao encontrada. Abortando sem alterar nada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.empresas'::regclass AND a.attname = 'id'
       AND a.atttypid = 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.empresas.id nao e do tipo uuid. Abortando sem alterar nada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.planos'::regclass AND a.attname = 'id'
       AND a.atttypid = 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos.id nao e do tipo uuid. Abortando sem alterar nada.';
  END IF;
END $$;

-- =============================================================
-- CRIACAO DE public.assinaturas
-- =============================================================
CREATE TABLE public.assinaturas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  plano_id     uuid not null,
  situacao     text not null,
  iniciada_em  timestamptz not null,
  criado_em    timestamptz not null default now(),
  constraint assinaturas_empresa_id_key
    unique (empresa_id),
  constraint assinaturas_empresa_id_fkey
    foreign key (empresa_id) references public.empresas(id) on delete cascade,
  constraint assinaturas_plano_id_fkey
    foreign key (plano_id) references public.planos(id)
);

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas OWNER TO postgres;
REVOKE ALL ON TABLE public.assinaturas FROM PUBLIC, anon, authenticated;

-- =============================================================
-- VERIFICACAO FINAL (fail-closed) - mesmo padrao estrutural (catalogo,
-- nunca ILIKE) ja aprovado no admin-08: conkey/confkey por attnum,
-- confdeltype exato, ACL via pg_class.relacl + aclexplode.
-- =============================================================
DO $$
DECLARE
  v_anon_oid                oid;
  v_authenticated_oid       oid;

  v_attnum_id                int2;
  v_attnum_empresa_id         int2;
  v_attnum_plano_id           int2;
  v_attnum_situacao            int2;
  v_attnum_iniciada_em          int2;
  v_attnum_criado_em              int2;
  v_attnum_empresas_id              int2;
  v_attnum_planos_id                  int2;

  v_relkind                  "char";
  v_rls_habilitado            boolean;
  v_rls_forcado                 boolean;
  v_total_colunas                 integer;
  v_total_constraints                integer;
  v_pk_ok                              integer;
  v_unique_ok                            integer;
  v_fk_empresa_ok                          integer;
  v_fk_plano_ok                              integer;
  v_total_indices                              integer;
  v_total_policies                               integer;
  v_relacl                                        pg_catalog.aclitem[];
  v_divergencias_acl                                text;
BEGIN
  SELECT r.oid INTO v_anon_oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon';
  IF v_anon_oid IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: role "anon" nao existe. Abortando (ROLLBACK).';
  END IF;

  SELECT r.oid INTO v_authenticated_oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated';
  IF v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: role "authenticated" nao existe. Abortando (ROLLBACK).';
  END IF;

  SELECT a.attnum INTO v_attnum_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.assinaturas'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_empresa_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.assinaturas'::regclass AND a.attname = 'empresa_id' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_plano_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.assinaturas'::regclass AND a.attname = 'plano_id' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_situacao FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.assinaturas'::regclass AND a.attname = 'situacao' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_iniciada_em FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.assinaturas'::regclass AND a.attname = 'iniciada_em' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_criado_em FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.assinaturas'::regclass AND a.attname = 'criado_em' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_empresas_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.empresas'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  SELECT a.attnum INTO v_attnum_planos_id FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.planos'::regclass AND a.attname = 'id' AND NOT a.attisdropped;

  IF v_attnum_id IS NULL OR v_attnum_empresa_id IS NULL OR v_attnum_plano_id IS NULL
     OR v_attnum_situacao IS NULL OR v_attnum_iniciada_em IS NULL OR v_attnum_criado_em IS NULL
     OR v_attnum_empresas_id IS NULL OR v_attnum_planos_id IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: nao foi possivel resolver todos os attnums necessarios. Abortando (ROLLBACK).';
  END IF;

  SELECT c.relkind, c.relrowsecurity, c.relforcerowsecurity
    INTO v_relkind, v_rls_habilitado, v_rls_forcado
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'assinaturas';

  IF v_relkind IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.assinaturas nao foi criada. Abortando (ROLLBACK).';
  END IF;
  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.assinaturas nao e uma tabela comum (relkind=%). Abortando (ROLLBACK).', v_relkind;
  END IF;
  IF NOT v_rls_habilitado THEN
    RAISE EXCEPTION 'Verificacao final falhou: RLS de assinaturas nao esta habilitado. Abortando (ROLLBACK).';
  END IF;
  IF v_rls_forcado THEN
    RAISE EXCEPTION 'Verificacao final falhou: RLS de assinaturas esta FORCADO, fora do desenho aprovado (sem FORCE). Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_total_colunas
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.assinaturas'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_total_colunas <> 6 THEN
    RAISE EXCEPTION 'Verificacao final falhou: assinaturas tem % coluna(s), esperado exatamente 6. Abortando (ROLLBACK).', v_total_colunas;
  END IF;

  SELECT count(*) INTO v_total_constraints
    FROM pg_catalog.pg_constraint WHERE conrelid = 'public.assinaturas'::regclass;
  IF v_total_constraints <> 4 THEN
    RAISE EXCEPTION 'Verificacao final falhou: assinaturas tem % constraint(s), esperado exatamente 4 (PK + UNIQUE + 2 FKs). Abortando (ROLLBACK).', v_total_constraints;
  END IF;

  SELECT count(*) INTO v_pk_ok FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.assinaturas'::regclass AND conname = 'assinaturas_pkey' AND contype = 'p'
     AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)';
  IF v_pk_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: PRIMARY KEY (id) nao encontrada como esperado. Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_unique_ok FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.assinaturas'::regclass AND conname = 'assinaturas_empresa_id_key' AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (empresa_id)';
  IF v_unique_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: UNIQUE (empresa_id) nao encontrada como esperado. Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_fk_empresa_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'assinaturas_empresa_id_fkey'
     AND con.contype = 'f'
     AND con.conrelid = 'public.assinaturas'::regclass
     AND con.confrelid = 'public.empresas'::regclass
     AND con.conkey = ARRAY[v_attnum_empresa_id]::int2[]
     AND con.confkey = ARRAY[v_attnum_empresas_id]::int2[]
     AND con.confdeltype = 'c'
     AND con.convalidated
     AND NOT con.condeferrable;
  IF v_fk_empresa_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: FK assinaturas_empresa_id_fkey nao confere estruturalmente (esperado ON DELETE CASCADE = confdeltype ''c''). Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_fk_plano_ok
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'assinaturas_plano_id_fkey'
     AND con.contype = 'f'
     AND con.conrelid = 'public.assinaturas'::regclass
     AND con.confrelid = 'public.planos'::regclass
     AND con.conkey = ARRAY[v_attnum_plano_id]::int2[]
     AND con.confkey = ARRAY[v_attnum_planos_id]::int2[]
     AND con.confdeltype = 'a'
     AND con.convalidated
     AND NOT con.condeferrable;
  IF v_fk_plano_ok <> 1 THEN
    RAISE EXCEPTION 'Verificacao final falhou: FK assinaturas_plano_id_fkey nao confere estruturalmente (esperado NO ACTION = confdeltype ''a''). Abortando (ROLLBACK).';
  END IF;

  SELECT count(*) INTO v_total_indices
    FROM pg_catalog.pg_indexes WHERE schemaname = 'public' AND tablename = 'assinaturas';
  IF v_total_indices <> 2 THEN
    RAISE EXCEPTION 'Verificacao final falhou: assinaturas tem % indice(s), esperado exatamente 2 (pkey + unique de empresa_id). Abortando (ROLLBACK).', v_total_indices;
  END IF;

  SELECT count(*) INTO v_total_policies
    FROM pg_catalog.pg_policy WHERE polrelid = 'public.assinaturas'::regclass;
  IF v_total_policies <> 0 THEN
    RAISE EXCEPTION 'Verificacao final falhou: assinaturas tem % politica(s) RLS, esperado 0. Abortando (ROLLBACK).', v_total_policies;
  END IF;

  SELECT coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner)) INTO v_relacl
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'assinaturas';

  SELECT string_agg(
           format('role=%s privilegio=%s grant_option=%s',
                  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END,
                  acl.privilege_type, acl.is_grantable),
           '; ' ORDER BY (CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END), acl.privilege_type
         )
    INTO v_divergencias_acl
    FROM pg_catalog.aclexplode(v_relacl) AS acl(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
   WHERE acl.grantee = 0 OR acl.grantee IN (v_anon_oid, v_authenticated_oid);

  IF v_divergencias_acl IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: ACL real de public.assinaturas diverge do esperado (PUBLIC/anon/authenticated deveriam ter zero privilegios). Divergencias: %. Abortando (ROLLBACK).', v_divergencias_acl;
  END IF;

  RAISE NOTICE 'Verificacao final OK: public.assinaturas (6 colunas, 4 constraints - PK/UNIQUE/2 FKs -, 2 indices, RLS habilitado sem FORCE, zero policies, zero privilegios para PUBLIC/anon/authenticated) conferida com sucesso.';
END $$;

COMMIT;
