-- QA Fase 2.5.5 (movimentos_caixa) - Passo 4 do plano de correção: ajustar as 2
-- evidências antigas (que violam a FK composta desde antes dela existir) para que
-- deixem de violar a regra, SEM excluir os movimentos.
--
-- Contexto (scripts 07, 08, 11, 12 e 13, já concluídos e aprovados):
--   - Movimento 70e22929-8220-4532-b946-29e34b032536 (Empresa A) tem os_id
--     apontando para uma OS da Empresa B (133a218d-507f-4e22-830a-7600e813acf7).
--   - Movimento 335d3415-77cd-497c-95f0-0e19d3335a47 (Empresa A) tem peca_id
--     apontando para uma peça da Empresa B (4b8c7193-4e20-413e-8f04-c6afa228dd65).
--   - As FKs compostas movimentos_caixa_os_mesma_empresa_fkey e
--     movimentos_caixa_peca_mesma_empresa_fkey já existem, NOT VALID, e já
--     bloqueiam qualquer vínculo cruzado NOVO (confirmado nos retestes 12/13).
--     Só essas 2 linhas antigas continuam violando a regra, porque NOT VALID não
--     valida retroativamente o que já existia.
--
-- O QUE ESTE SCRIPT FAZ: preserva os 2 movimentos por completo - eles continuam
-- existindo, com o mesmo id, empresa_id, tipo, categoria, descricao, valor, data
-- e created_at de sempre. A ÚNICA mudança é zerar (SET NULL) o vínculo inválido
-- de cada um (os_id no primeiro, peca_id no segundo) - o mesmo efeito que o
-- ON DELETE SET NULL já produziria automaticamente se a OS/peça da B fosse
-- excluída, só que aplicado manualmente agora, sem excluir nada na Empresa B.
--
-- O QUE ESTE SCRIPT NÃO FAZ:
--   - Não usa DELETE em lugar nenhum.
--   - Não toca no cliente 63194a33-ea2e-4065-9d7c-1337f264ba6d, na OS
--     133a218d-507f-4e22-830a-7600e813acf7 nem na peça
--     4b8c7193-4e20-413e-8f04-c6afa228dd65 (todos da Empresa B, continuam
--     intactos - são dados legítimos de teste da Empresa B, não o problema).
--   - Não roda VALIDATE CONSTRAINT (isso é um passo futuro separado, script 15,
--     só depois de confirmar que as duas linhas já não violam mais a regra).
--
-- Pré-checagem e pós-checagem, com RAISE EXCEPTION em qualquer divergência: como
-- tudo roda dentro de uma única transação BEGIN/COMMIT, um RAISE EXCEPTION em
-- qualquer ponto aborta a transação inteira - o COMMIT final, se a transação já
-- estiver abortada, se comporta como ROLLBACK (nenhuma alteração é persistida).
-- Cada UPDATE também confere ROW_COUNT = 1 antes de seguir, pelo mesmo motivo.

BEGIN;

-- =====================================================================
-- A) Pré-checagem: os dois movimentos precisam estar EXATAMENTE no estado
--    esperado antes de qualquer UPDATE. Qualquer divergência aborta tudo.
-- =====================================================================

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.movimentos_caixa
  WHERE id = '70e22929-8220-4532-b946-29e34b032536'
    AND empresa_id = '670162c6-3437-4cd5-b581-0229d57d33e2'
    AND os_id = '133a218d-507f-4e22-830a-7600e813acf7'
    AND peca_id IS NULL;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Pré-checagem falhou para o movimento 70e22929-8220-4532-b946-29e34b032536 (estado divergente do esperado) - abortando, nenhuma alteração será aplicada.';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.movimentos_caixa
  WHERE id = '335d3415-77cd-497c-95f0-0e19d3335a47'
    AND empresa_id = '670162c6-3437-4cd5-b581-0229d57d33e2'
    AND peca_id = '4b8c7193-4e20-413e-8f04-c6afa228dd65'
    AND os_id IS NULL;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Pré-checagem falhou para o movimento 335d3415-77cd-497c-95f0-0e19d3335a47 (estado divergente do esperado) - abortando, nenhuma alteração será aplicada.';
  END IF;
END $$;

-- =====================================================================
-- B) UPDATEs condicionais - só zeram o vínculo inválido de cada movimento,
--    nenhuma outra coluna é tocada. WHERE repete as mesmas condições da
--    pré-checagem, então só afeta a linha certa, no estado certo.
-- =====================================================================

DO $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.movimentos_caixa
  SET os_id = NULL
  WHERE id = '70e22929-8220-4532-b946-29e34b032536'
    AND empresa_id = '670162c6-3437-4cd5-b581-0229d57d33e2'
    AND os_id = '133a218d-507f-4e22-830a-7600e813acf7'
    AND peca_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'UPDATE do movimento 70e22929-8220-4532-b946-29e34b032536 afetou % linha(s) (esperado 1) - abortando.', v_rows;
  END IF;

  UPDATE public.movimentos_caixa
  SET peca_id = NULL
  WHERE id = '335d3415-77cd-497c-95f0-0e19d3335a47'
    AND empresa_id = '670162c6-3437-4cd5-b581-0229d57d33e2'
    AND peca_id = '4b8c7193-4e20-413e-8f04-c6afa228dd65'
    AND os_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'UPDATE do movimento 335d3415-77cd-497c-95f0-0e19d3335a47 afetou % linha(s) (esperado 1) - abortando.', v_rows;
  END IF;
END $$;

-- =====================================================================
-- C) Pós-checagem: os dois movimentos continuam existindo, na Empresa A,
--    com os_id/peca_id NULL. Qualquer divergência aborta tudo.
-- =====================================================================

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.movimentos_caixa
  WHERE id = '70e22929-8220-4532-b946-29e34b032536'
    AND empresa_id = '670162c6-3437-4cd5-b581-0229d57d33e2'
    AND os_id IS NULL
    AND peca_id IS NULL;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Pós-checagem falhou para o movimento 70e22929-8220-4532-b946-29e34b032536 - abortando.';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.movimentos_caixa
  WHERE id = '335d3415-77cd-497c-95f0-0e19d3335a47'
    AND empresa_id = '670162c6-3437-4cd5-b581-0229d57d33e2'
    AND os_id IS NULL
    AND peca_id IS NULL;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Pós-checagem falhou para o movimento 335d3415-77cd-497c-95f0-0e19d3335a47 - abortando.';
  END IF;
END $$;

COMMIT;
