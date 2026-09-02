-- QA Fase 4.2 (usuarios_empresas) - ajuste da policy de SELECT
--
-- Achado: a policy usuarios_empresas_select_proprietario atual libera a
-- lista completa de vinculos da empresa somente para quem e
-- empresas.owner_id (dono original da empresa) - nao para quem tem
-- papel='proprietario' em usuarios_empresas. Isso e inconsistente com a
-- decisao aprovada da Fase 4.1 ("proprietario gerencia todos",
-- "apenas proprietario/admin veem a lista completa"), que e sobre o papel,
-- nao sobre ser o owner_id original.
--
-- Este script substitui usuarios_empresas_select_proprietario por
-- usuarios_empresas_select_proprietario_admin: libera a lista completa da
-- empresa para qualquer vinculo ATIVO com papel proprietario OU admin.
--
-- Revisao (correcao de uma afirmacao incorreta da versao anterior deste
-- arquivo): a primeira versao usava uma subconsulta inline diretamente em
-- usuarios_empresas, dentro da propria policy de usuarios_empresas, e o
-- comentario chamava isso de "mesmo padrao ja usado e testado em
-- caixa_select_proprietario". Isso estava errado. caixa_select_proprietario
-- e uma policy em public.movimentos_caixa (uma tabela DIFERENTE) que faz
-- EXISTS consultando usuarios_empresas - ou seja, e uma consulta cruzada
-- entre duas tabelas, sem nenhuma autorreferencia. Uma policy DENTRO de
-- usuarios_empresas que consulta a propria usuarios_empresas e uma
-- situacao estruturalmente diferente (autorreferente), sem nenhum
-- precedente testado neste projeto - nenhuma das 5 policies atuais de
-- usuarios_empresas (select_proprio, select_proprietario,
-- insert/update/delete_proprietario) faz isso, e nenhuma das 3 funcoes
-- padrao (usuario_pertence_empresa, usuario_pode_operar_empresa,
-- usuario_pode_excluir_empresa) e usada em usuarios_empresas.
--
-- Investigacao feita nesta etapa: mesmo sem esse
-- precedente, a subconsulta autorreferente nao causaria recursao infinita
-- em runtime, porque usuarios_empresas_select_proprio (usuario_id =
-- auth.uid(), inalterada) sempre torna a propria linha do chamador visivel
-- independente da nova policy, quebrando o ciclo. Mesmo assim, por ser um
-- padrao nao validado neste projeto e por depender implicitamente de outra
-- policy nunca ser removida, a correcao abaixo evita completamente a
-- questao: usa uma funcao SECURITY DEFINER (mesmo padrao de owner/grants
-- ja usado em todas as RPCs desta fase), que roda com os privilegios do
-- dono (postgres) e portanto ignora RLS internamente - sem nenhuma
-- autorreferencia sujeita a policy.
--
-- Nao mexe nas policies de INSERT/UPDATE/DELETE (continuam restritas a
-- owner_id, agora redundantes mas inofensivas, ja que a escrita real passa
-- pelas RPCs SECURITY DEFINER desta fase, que ignoram RLS).
--
-- Checagem defensiva: aborta se ja existir uma policy com o novo nome, em
-- vez de tentar recriar silenciosamente. A funcao usa CREATE OR REPLACE,
-- mesmo padrao ja usado nas RPCs desta fase e nas RPCs da Fase 3.
--
-- AINDA NAO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob
-- autorizacao explicita do usuario.

BEGIN;

-- Funcao auxiliar: true se auth.uid() tiver vinculo ATIVO com papel
-- proprietario ou admin na empresa informada. SECURITY DEFINER + owner
-- postgres faz a consulta interna ignorar RLS - sem autorreferencia.
create or replace function public.usuario_e_proprietario_ou_admin_ativo(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.usuarios_empresas ue
    where ue.empresa_id = p_empresa_id
      and ue.usuario_id = auth.uid()
      and ue.ativo = true
      and ue.papel in ('proprietario', 'admin')
  );
$function$;

alter function public.usuario_e_proprietario_ou_admin_ativo(uuid) owner to postgres;

revoke all on function public.usuario_e_proprietario_ou_admin_ativo(uuid) from public;
revoke all on function public.usuario_e_proprietario_ou_admin_ativo(uuid) from anon;
grant execute on function public.usuario_e_proprietario_ou_admin_ativo(uuid) to authenticated;
grant execute on function public.usuario_e_proprietario_ou_admin_ativo(uuid) to postgres;
grant execute on function public.usuario_e_proprietario_ou_admin_ativo(uuid) to service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'usuarios_empresas'
      AND policyname = 'usuarios_empresas_select_proprietario_admin'
  ) THEN
    RAISE EXCEPTION 'Abortando: já existe uma policy chamada usuarios_empresas_select_proprietario_admin.';
  END IF;
END $$;

drop policy if exists usuarios_empresas_select_proprietario on public.usuarios_empresas;

create policy usuarios_empresas_select_proprietario_admin
on public.usuarios_empresas
for select
using (
  public.usuario_e_proprietario_ou_admin_ativo(
    usuarios_empresas.empresa_id
  )
);

COMMIT;
