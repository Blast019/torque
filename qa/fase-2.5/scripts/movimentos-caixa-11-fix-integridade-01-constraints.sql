-- QA Fase 2.5.5 (movimentos_caixa) - Passo 1 do plano de correção da falha de
-- integridade multiempresa confirmada nos scripts 07 (os_id) e 08 (peca_id).
--
-- Diagnóstico prévio (movimentos-caixa-10-planejamento-integridade.sql, executado
-- e confirmado em 26/08/2026):
--   - movimentos_caixa_os_id_fkey e movimentos_caixa_peca_id_fkey são FKs simples
--     e validadas, sem checar empresa_id.
--   - Nem ordens_servico nem pecas têm UNIQUE(id, empresa_id) hoje.
--   - Exatamente 1 vínculo cruzado real por os_id e 1 por peca_id - as duas
--     evidências já conhecidas:
--       70e22929-8220-4532-b946-29e34b032536 (os_id cruzado, script 07)
--       335d3415-77cd-497c-95f0-0e19d3335a47 (peca_id cruzado, script 08)
--   - PostgreSQL 17.6 - suporta ON DELETE SET NULL (coluna) em FK composta.
--
-- Este script:
--   - NÃO altera nem exclui as duas evidências acima - elas continuam existindo
--     exatamente como estão (a FK composta é criada NOT VALID, então linhas
--     antigas que já violam a regra não são tocadas nem impedem a criação).
--   - NÃO valida as FKs compostas ainda (isso é um passo futuro separado,
--     depois de decidir o que fazer com as 2 evidências).
--   - NÃO usa IF EXISTS / IF NOT EXISTS - o estado atual já foi confirmado pelo
--     diagnóstico; se este script for rodado de novo sobre um banco onde as
--     constraints já existem, ele deve falhar com erro claro (nome duplicado),
--     não silenciar o problema.
--   - Roda tudo dentro de uma única transação: ou todos os passos abaixo
--     funcionam, ou nenhum é aplicado.
--
-- Mesmo padrão já usado nas correções de pecas.fornecedor_id (Fase 2.5.3) e
-- ordens_servico.funcionario_id (Fase 2.5.4).

BEGIN;

-- =====================================================================
-- A) UNIQUE(id, empresa_id) - pré-requisito para a FK composta poder referenciar
--    (id, empresa_id) de ordens_servico e de pecas.
-- =====================================================================

ALTER TABLE public.ordens_servico
  ADD CONSTRAINT ordens_servico_id_empresa_unique
  UNIQUE (id, empresa_id);

ALTER TABLE public.pecas
  ADD CONSTRAINT pecas_id_empresa_unique
  UNIQUE (id, empresa_id);

-- =====================================================================
-- B) Remover as FKs simples atuais (não checam empresa_id).
-- =====================================================================

ALTER TABLE public.movimentos_caixa
  DROP CONSTRAINT movimentos_caixa_os_id_fkey;

ALTER TABLE public.movimentos_caixa
  DROP CONSTRAINT movimentos_caixa_peca_id_fkey;

-- =====================================================================
-- C) Criar as FKs compostas NOT VALID, agora exigindo que os_id/peca_id
--    pertençam à MESMA empresa_id do movimento.
--
--    NOT VALID: a constraint passa a valer IMEDIATAMENTE para qualquer INSERT ou
--    UPDATE novo (nenhum vínculo cruzado novo será aceito a partir de agora), mas
--    o Postgres não varre as linhas já existentes na criação - por isso as 2
--    evidências antigas, que já violam a regra, continuam existindo sem erro
--    nem serem alteradas. A validação retroativa (VALIDATE CONSTRAINT) é um
--    passo separado e futuro, só depois de decidir o que fazer com essas 2
--    linhas (mesma decisão pendente que já foi tomada manualmente nas correções
--    de fornecedores/funcionarios).
--
--    ON DELETE SET NULL (os_id) / ON DELETE SET NULL (peca_id): sintaxe de
--    coluna específica (suportada a partir do Postgres 15, confirmado 17.6 aqui)
--    - ao excluir a OS ou a peça referenciada, só a coluna os_id/peca_id do
--    movimento é zerada; empresa_id do movimento é preservado intacto, porque
--    ele não faz parte do SET NULL declarado, só da condição de referência.
-- =====================================================================

ALTER TABLE public.movimentos_caixa
  ADD CONSTRAINT movimentos_caixa_os_mesma_empresa_fkey
  FOREIGN KEY (os_id, empresa_id)
  REFERENCES public.ordens_servico (id, empresa_id)
  ON DELETE SET NULL (os_id)
  NOT VALID;

ALTER TABLE public.movimentos_caixa
  ADD CONSTRAINT movimentos_caixa_peca_mesma_empresa_fkey
  FOREIGN KEY (peca_id, empresa_id)
  REFERENCES public.pecas (id, empresa_id)
  ON DELETE SET NULL (peca_id)
  NOT VALID;

COMMIT;
