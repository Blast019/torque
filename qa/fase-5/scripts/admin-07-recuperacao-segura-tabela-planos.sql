-- Recuperacao segura apos a remocao de public.planos (NAO e' um rollback
-- fiel - ver qa/fase-5/STATUS.md para a discussao). Recria a tabela vazia,
-- com a mesma estrutura de colunas/constraints diagnosticada, mas com
-- grants seguros por padrao (revogados de anon/authenticated) - o grant
-- permissivo original era exatamente o motivo da remocao, entao esta
-- recuperacao nao o reintroduz. Owner definido como postgres, consistente
-- com toda tabela/RPC ja criada por este projeto (o owner original nunca
-- foi diagnosticado, entao nao ha "owner original" fiel para restaurar).
--
-- EXECUTADO COM SUCESSO EM PRODUCAO em 14/09/2026. Rodado manualmente no
-- SQL Editor do Supabase pelo usuario, imediatamente apos a conclusao com
-- sucesso do admin-06 - retornou "Success" (sem nenhum RAISE EXCEPTION),
-- confirmando que a tabela foi recriada, RLS habilitado, owner definido
-- como postgres, REVOKE ALL executado, e que a auditoria fail-closed de
-- ACL (pg_class.relacl + aclexplode, com resolucao obrigatoria dos OIDs
-- de anon/authenticated antes de auditar) nao encontrou nenhum privilegio
-- para PUBLIC/anon/authenticated. Estado final confirmado depois por uma
-- consulta independente ao catalogo (nao os DO $$ deste script) - ver
-- qa/fase-5/STATUS.md, checkpoint "Incremento 3.2: admin-06 e admin-07
-- executados com sucesso" para o resultado completo (tabela_comum_ok,
-- total_linhas, rls_habilitado, rls_forcado, total_policies,
-- role_anon_existe, role_authenticated_existe,
-- privilegios_public_anon_authenticated). RLS nao forcado (rls_forcado =
-- false) e' o desenho aprovado - este script nunca incluiu FORCE ROW
-- LEVEL SECURITY.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.planos') IS NOT NULL THEN
    RAISE EXCEPTION 'Precheck falhou: public.planos ja existe. Abortando sem alterar nada.';
  END IF;
END $$;

CREATE TABLE public.planos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  descricao  text,
  preco      numeric not null default 0,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  constraint planos_nome_key unique (nome)
);

ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos OWNER TO postgres;
REVOKE ALL ON TABLE public.planos FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_relacl_efetivo     pg_catalog.aclitem[];
  v_anon_oid           oid;
  v_authenticated_oid  oid;
  v_divergencias_texto text;
BEGIN
  IF to_regclass('public.planos') IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: public.planos nao foi criada. Abortando (ROLLBACK).';
  END IF;

  -- Resolve os OIDs de anon/authenticated ANTES de auditar o ACL -
  -- fail-closed: se qualquer uma das duas roles nao existir neste banco,
  -- aborta aqui e agora. Sem esta checagem, um OID NULL faria a
  -- comparacao "acl.grantee IN (v_anon_oid, v_authenticated_oid)" (ou um
  -- LEFT JOIN por OID) simplesmente nunca casar com nada - a auditoria
  -- passaria "verde" por ausencia de correspondencia, nao porque a role
  -- realmente nao tem privilegio nenhum, e sim porque a propria role nao
  -- foi encontrada. Isso seria um falso negativo silencioso.
  SELECT r.oid INTO v_anon_oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon';
  IF v_anon_oid IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: role "anon" nao existe neste banco - auditoria nao pode prosseguir sem confirmar esta role. Abortando (ROLLBACK).';
  END IF;

  SELECT r.oid INTO v_authenticated_oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated';
  IF v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: role "authenticated" nao existe neste banco - auditoria nao pode prosseguir sem confirmar esta role. Abortando (ROLLBACK).';
  END IF;

  -- Le o ACL real da tabela diretamente de pg_catalog.pg_class.relacl,
  -- localizando o objeto por pg_class + pg_namespace (join explicito, nao
  -- por ::regclass). relacl NULL nunca e' tratado como "sem privilegio"
  -- por presuncao: NULL significa "este objeto nunca teve seu ACL
  -- alterado - vale o ACL padrao do tipo de objeto", nao "ACL vazio". Por
  -- isso o ACL EFETIVO usado na auditoria e' sempre calculado
  -- explicitamente via pg_catalog.acldefault('r', relowner) quando relacl
  -- for NULL - nunca presumido "vazio" so porque e' NULL.
  SELECT coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    INTO v_relacl_efetivo
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'planos';

  -- Audita o ACL efetivo via pg_catalog.aclexplode - NUNCA
  -- information_schema.role_table_grants (pode nao refletir com
  -- seguranca grants ao pseudo-papel PUBLIC, e depende da visibilidade de
  -- role da sessao que consulta) nem has_table_privilege como prova
  -- principal (ele responde "privilegio efetivo", que pode incluir
  -- heranca por associacao entre roles, sem revelar de onde o privilegio
  -- veio - nao serve como prova de auditoria da ACL armazenada em si).
  --
  -- grantee = 0 e' o valor-sentinela ACL_ID_PUBLIC (nao e' um OID de
  -- pg_roles - e' como o Postgres representa "PUBLIC" dentro de um
  -- aclitem). anon/authenticated sao identificados pelos OIDs exatos ja
  -- resolvidos e confirmados acima (v_anon_oid/v_authenticated_oid) - nao
  -- por comparacao de nome. O estado esperado para os tres destinatarios
  -- e' ZERO privilegios, de QUALQUER tipo - por isso NAO ha filtro de
  -- privilege_type: uma lista fechada (SELECT/INSERT/UPDATE/...) correria
  -- o risco de deixar passar despercebido um tipo de privilegio novo,
  -- suportado por uma versao futura do Postgres, que nao estivesse nessa
  -- lista. Qualquer aclitem para um destes tres destinatarios, seja qual
  -- for o privilege_type, ja e' por si so uma divergencia.
  SELECT string_agg(
           format('role=%s privilegio=%s grant_option=%s',
                  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END,
                  acl.privilege_type, acl.is_grantable),
           '; ' ORDER BY (CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END), acl.privilege_type
         )
    INTO v_divergencias_texto
    FROM pg_catalog.aclexplode(v_relacl_efetivo) AS acl(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
   WHERE acl.grantee = 0
      OR acl.grantee IN (v_anon_oid, v_authenticated_oid);

  -- Fail-closed: qualquer divergencia (inclusive relacl NULL resolvido
  -- via acldefault) sempre aborta com RAISE EXCEPTION, nunca vira NOTICE.
  -- A ausencia das roles anon/authenticated ja foi barrada acima, antes
  -- desta auditoria, entao nao pode mascarar um falso "sem divergencia"
  -- aqui.
  IF v_divergencias_texto IS NOT NULL THEN
    RAISE EXCEPTION 'Verificacao final falhou: ACL real de public.planos diverge do esperado (PUBLIC/anon/authenticated deveriam ter zero privilegios, de qualquer tipo). Divergencias encontradas: %. Abortando (ROLLBACK).', v_divergencias_texto;
  END IF;

  RAISE NOTICE 'Verificacao final OK: ACL real de public.planos (pg_class.relacl via aclexplode) confirmado com zero privilegios para PUBLIC/anon/authenticated.';
END $$;

COMMIT;
