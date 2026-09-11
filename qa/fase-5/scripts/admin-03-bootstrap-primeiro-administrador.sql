-- FASE 5 (Incremento 2.1) - Fundacao de administradores da plataforma -
-- BOOTSTRAP DO PRIMEIRO ADMINISTRADOR (procedimento manual, separado).
--
-- Este arquivo NAO e uma migracao e NAO deve ser executado como um bloco
-- unico. E um PROCEDIMENTO MANUAL, passo a passo, com placeholders que o
-- operador preenche no SQL Editor do Supabase, exatamente como o
-- "Procedimento manual de autorizacao" ja documentado em
-- qa/fase-5/STATUS.md para autorizacoes_onboarding.
--
-- Pre-requisito: admin-01-fundacao-administradores-plataforma.sql aplicado
-- (public.administradores_plataforma precisa existir e estar vazia).
--
-- Por que este arquivo existe separado da migracao: por instrucao explicita
-- do usuario, a migracao admin-01 NAO cadastra nenhum administrador. A
-- conta candidata ao primeiro administrador so e aceita se passar pelos
-- tres criterios genericos do Passo 0 abaixo - nenhum UUID ou e-mail
-- especifico e privilegiado ou excluido por nome neste arquivo; qualquer
-- conta que falhe em qualquer um dos tres criterios (existir em
-- auth.users; nao ter nenhuma linha em usuarios_empresas, ativa ou
-- inativa; ainda nao estar em administradores_plataforma) e recusada, sem
-- excecao.
--
-- Este arquivo, de proposito, NAO fixa nenhum UUID nem e-mail real - todos
-- os placeholders abaixo (<...>) precisam ser substituidos manualmente pelo
-- operador no momento da execucao, nunca commitados com um valor real.
--
-- AINDA NAO EXECUTADO. Nao ha nenhum administrador cadastrado hoje via este
-- procedimento. Requer autorizacao explicita separada do usuario antes de
-- rodar qualquer um dos passos abaixo.

-- =====================================================================
-- PASSO 0 - Escolher e validar a conta candidata a primeiro administrador.
-- =====================================================================
-- Deve ser uma conta auth.users JA EXISTENTE (criada por convite do
-- proprio Supabase Auth, como qualquer outra conta da plataforma - este
-- procedimento nao cria usuario nenhum, so concede o papel administrativo
-- a um user_id que ja existe em auth.users). So prosseguir para o Passo 2
-- se as tres consultas abaixo confirmarem os tres criterios.

-- Criterio 1 - a conta existe em auth.users:
SELECT id, email
  FROM auth.users
 WHERE id = '<uuid-da-conta-candidata>';
-- Esperado: exatamente 1 linha. Se vazio, a conta nao existe - escolher
-- outra ou criar a conta primeiro pelo fluxo normal de convite.

-- Criterio 2 - a conta NAO tem nenhuma linha em usuarios_empresas, seja
-- ativa ou inativa (identidade exclusiva da plataforma - uma conta que ja
-- teve qualquer vinculo, mesmo desativado, com uma empresa cliente nao
-- serve para este papel):
SELECT ue.id, ue.empresa_id, ue.papel, ue.ativo
  FROM public.usuarios_empresas ue
 WHERE ue.usuario_id = '<uuid-da-conta-candidata>';
-- Esperado: zero linhas. Se houver qualquer linha (ativa ou inativa),
-- escolher outra conta - nao prosseguir com esta.

-- Criterio 3 - a conta ainda NAO esta cadastrada em
-- administradores_plataforma (evita duplicar/reativar por acidente uma
-- linha existente por este procedimento, que e so para o PRIMEIRO
-- administrador):
SELECT id, ativo, concedido_em, revogado_em
  FROM public.administradores_plataforma
 WHERE user_id = '<uuid-da-conta-candidata>';
-- Esperado: zero linhas. Se houver alguma linha, esta conta ja passou por
-- este procedimento antes - nao prosseguir.

-- =====================================================================
-- PASSO 1 - Confirmar que ainda nao existe nenhum administrador
-- cadastrado (bootstrap e feito uma unica vez; qualquer administrador
-- seguinte deveria, no futuro, ser concedido por outro administrador ja
-- ativo via uma RPC de gestao de administradores - fora do escopo deste
-- incremento, ainda nao implementada).
-- =====================================================================
SELECT count(*) AS total_administradores_hoje
  FROM public.administradores_plataforma;
-- Esperado antes do bootstrap: 0. Se for maior que zero, PARAR - este
-- procedimento e so para o primeiro administrador; ja existe pelo menos
-- um cadastrado.

-- =====================================================================
-- PASSO 2 - Conceder o papel, somente se os Passos 0 e 1 confirmaram os
-- criterios acima. concedido_por fica NULL de proposito - nao havia
-- nenhum administrador anterior para conceder este primeiro papel.
-- =====================================================================
INSERT INTO public.administradores_plataforma (user_id, ativo, concedido_por)
VALUES ('<uuid-da-conta-candidata>', true, NULL);

-- =====================================================================
-- PASSO 3 - Verificacao final (nenhuma escrita).
-- =====================================================================
SELECT id, user_id, ativo, concedido_por, concedido_em
  FROM public.administradores_plataforma;
-- Esperado depois do bootstrap: exatamente 1 linha, ativo = true,
-- concedido_por = null, user_id igual ao escolhido no Passo 0.

-- =====================================================================
-- Revogacao manual (se um dia for preciso desfazer este bootstrap
-- especifico, antes de existir uma RPC de gestao de administradores) -
-- SOMENTE soft, nunca DELETE, mesmo aqui. revogado_em e revogado_por sao
-- OBRIGATORIOS junto com ativo=false (constraint
-- administradores_plataforma_revogacao_consistente):
-- =====================================================================
-- UPDATE public.administradores_plataforma
--    SET ativo = false, revogado_em = now(), revogado_por = '<uuid-de-quem-esta-revogando>'
--  WHERE user_id = '<uuid-da-conta-candidata>';
