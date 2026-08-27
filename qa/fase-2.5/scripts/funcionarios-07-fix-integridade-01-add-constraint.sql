-- QA Fase 2.5.4 (funcionarios) - correção da falha de integridade multiempresa
-- encontrada no teste de vínculo cruzado (funcionarios-06-vinculo-cruzado.js, 25/08/2026).
--
-- Achado: ordens_servico.funcionario_id aceita referenciar um funcionário de OUTRA
-- empresa, porque a FK simples existente só valida que o id existe em funcionarios,
-- sem checar se o funcionário pertence à mesma empresa_id da OS. Não houve vazamento
-- de leitura (RLS de funcionarios continua protegendo o dado, inclusive dentro de
-- embed do PostgREST) - é a mesma classe de falha já corrigida em
-- pecas.fornecedor_id -> fornecedores (Fase 2.5.3, ver
-- fornecedores-07-fix-integridade-01-add-constraint.sql).
--
-- Prova de conceito criada pelo teste (NÃO tocar antes do passo 4 do plano abaixo):
--   funcionário de teste na Empresa B: 1d39ca25-eb60-4e87-a6a0-441d0e4d0475
--   OS de teste na Empresa A com funcionario_id cruzado: 4db4b201-a169-4a28-8da8-3b2139b0cf6b
--
-- Plano de correção combinado com o usuário (25/08/2026), em 5 passos - este script é
-- só o PASSO 1:
--   1) [ESTE SCRIPT] Criar UNIQUE em funcionarios(id, empresa_id) e a FK composta em
--      ordens_servico(funcionario_id, empresa_id) como NOT VALID, com
--      ON DELETE SET NULL (funcionario_id) - ativa a proteção pra operações NOVAS
--      sem falhar por causa da OS cruzada que já existe hoje, e sem colocar em risco
--      o empresa_id da OS quando um funcionário for excluído no futuro.
--   2) Repetir o teste de vínculo cruzado e confirmar que o novo vínculo é bloqueado.
--   3) Definir como NULL somente o funcionario_id da OS de teste (4db4b201-...), pra
--      permitir validar a constraint sem apagar ou alterar mais nada na OS.
--   4) Rodar ALTER TABLE public.ordens_servico VALIDATE CONSTRAINT
--      ordens_servico_funcionario_mesma_empresa_fkey; pra validar definitivamente
--      os dados já existentes.
--   5) Testar se excluir um funcionário ainda aplica ON DELETE SET NULL só no
--      funcionario_id, preservando o empresa_id da OS intacto.
--
-- IMPORTANTE: a FK simples existente entre ordens_servico.funcionario_id e
-- funcionarios.id NÃO é removida por este script - ela continua ativa e é quem já
-- mantinha o comportamento de exclusão de funcionário até hoje. A nova FK composta
-- é ADICIONAL, não substitui a existente. Nenhuma policy de RLS é alterada por este
-- script.
--
-- NOT VALID: a nova FK composta entra em vigor imediatamente para INSERT/UPDATE
-- novos, mas o Postgres não escaneia as linhas já existentes em ordens_servico para
-- checar se violam a constraint - por isso a OS de teste com vínculo cruzado não
-- impede este ALTER TABLE de rodar. A validação retroativa dos dados existentes é o
-- passo 4 (VALIDATE CONSTRAINT), só depois de resolver a linha de teste no passo 3.
-- ESTE SCRIPT NÃO EXECUTA O VALIDATE - isso fica para um script separado, mais
-- adiante no plano.
--
-- ON DELETE SET NULL (funcionario_id): sintaxe de FK composta com coluna específica
-- (disponível a partir do PostgreSQL 15) - garante que, ao excluir um funcionário,
-- somente funcionario_id da OS é zerado, e empresa_id da OS permanece intacto. Sem
-- essa especificação de coluna, um ON DELETE SET NULL genérico numa FK composta
-- zeraria TODAS as colunas da FK, incluindo empresa_id - o que quebraria o
-- isolamento multiempresa da própria OS. Se o Supabase estiver rodando uma versão de
-- Postgres anterior à 15, o ALTER TABLE da FK composta falhará por erro de sintaxe -
-- nesse caso, parar e avisar antes de tentar qualquer alternativa (não improvisar
-- uma solução diferente sem checar com o usuário).
--
-- Esta versão inclui conferências defensivas antes de cada alteração: aborta com
-- RAISE EXCEPTION se qualquer uma das novas constraints já existir com o nome
-- esperado, e mostra via RAISE NOTICE o nome e a regra de exclusão da FK simples
-- atual entre ordens_servico.funcionario_id e funcionarios.id, para conferência
-- visual de que ela continua intacta antes e depois da mudança. Se essa FK simples
-- não for encontrada com a forma esperada, o script aborta em vez de prosseguir às
-- cegas.
--
-- AINDA NÃO EXECUTADO. Preparado para revisão - rodar manualmente no SQL Editor do
-- Supabase somente após aprovação explícita do usuário.

BEGIN;

DO $$
DECLARE
  fk_simples_nome text;
  fk_simples_delete_rule text;
BEGIN
  -- 1) Conferência defensiva: a nova UNIQUE não pode já existir.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'funcionarios_id_empresa_id_unique'
      AND conrelid = 'public.funcionarios'::regclass
  ) THEN
    RAISE EXCEPTION 'Abortando: já existe uma constraint chamada funcionarios_id_empresa_id_unique em public.funcionarios.';
  END IF;

  -- 2) Conferência defensiva: a nova FK composta não pode já existir.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ordens_servico_funcionario_mesma_empresa_fkey'
      AND conrelid = 'public.ordens_servico'::regclass
  ) THEN
    RAISE EXCEPTION 'Abortando: já existe uma constraint chamada ordens_servico_funcionario_mesma_empresa_fkey em public.ordens_servico.';
  END IF;

  -- 3) Conferência informativa: localizar e exibir a FK simples atual
  --    (ordens_servico.funcionario_id -> funcionarios.id), sem alterá-la. Se ela não
  --    existir no formato esperado, aborta em vez de seguir sem essa garantia.
  SELECT con.conname,
         CASE con.confdeltype
           WHEN 'a' THEN 'NO ACTION'
           WHEN 'r' THEN 'RESTRICT'
           WHEN 'c' THEN 'CASCADE'
           WHEN 'n' THEN 'SET NULL'
           WHEN 'd' THEN 'SET DEFAULT'
           ELSE con.confdeltype::text
         END
    INTO fk_simples_nome, fk_simples_delete_rule
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
   WHERE con.contype = 'f'
     AND con.conrelid = 'public.ordens_servico'::regclass
     AND con.confrelid = 'public.funcionarios'::regclass
     AND array_length(con.conkey, 1) = 1
     AND att.attname = 'funcionario_id'
   LIMIT 1;

  IF fk_simples_nome IS NULL THEN
    RAISE EXCEPTION 'Abortando: não foi encontrada a FK simples esperada entre ordens_servico.funcionario_id e funcionarios.id. Verificar manualmente antes de prosseguir.';
  END IF;

  RAISE NOTICE 'FK simples atual encontrada: % (ON DELETE %) - permanece intacta, não será removida por este script.', fk_simples_nome, fk_simples_delete_rule;
END $$;

-- 4) Criar a UNIQUE necessária para a FK composta poder referenciar (id, empresa_id).
ALTER TABLE public.funcionarios
ADD CONSTRAINT funcionarios_id_empresa_id_unique
UNIQUE (id, empresa_id);

-- 5) Criar a FK composta como NOT VALID, com ON DELETE SET NULL restrito à coluna
--    funcionario_id (empresa_id da OS nunca é tocado por esta constraint).
ALTER TABLE public.ordens_servico
ADD CONSTRAINT ordens_servico_funcionario_mesma_empresa_fkey
FOREIGN KEY (funcionario_id, empresa_id)
REFERENCES public.funcionarios (id, empresa_id)
ON DELETE SET NULL (funcionario_id)
NOT VALID;

COMMIT;
