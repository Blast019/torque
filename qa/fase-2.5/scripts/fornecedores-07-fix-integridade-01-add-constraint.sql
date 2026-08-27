-- QA Fase 2.5.3 (fornecedores) - correção da falha de integridade multiempresa
-- encontrada no teste de vínculo cruzado (fornecedores-06-vinculo-cruzado.js, 24/08/2026).
--
-- Achado: pecas.fornecedor_id aceita referenciar um fornecedor de OUTRA empresa,
-- porque a FK simples (pecas_fornecedor_id_fkey) só valida que o id existe em
-- fornecedores, sem checar se o fornecedor pertence à mesma empresa_id da peça.
-- Não houve vazamento de leitura (RLS de fornecedores continua protegendo o dado,
-- inclusive dentro de embed do PostgREST), mas é uma falha de integridade referencial
-- entre tenants: uma peça pode ficar "casada" com um fornecedor que a própria
-- empresa nunca deveria poder ver.
--
-- Prova de conceito criada pelo teste (NÃO limpar antes do passo 5 do plano abaixo):
--   fornecedor de teste na Empresa B: a63e9f73-12b5-4dd4-b236-174a6e2799fc
--   peça de teste na Empresa A com fornecedor_id cruzado: fa7ef17e-3fff-403c-8c17-648c7a22154c
--
-- Plano de correção combinado com o usuário (24/08/2026), em 5 passos - este script é
-- só o PASSO 1:
--   1) [ESTE SCRIPT] Criar UNIQUE em fornecedores(id, empresa_id) e a FK composta
--      em pecas(fornecedor_id, empresa_id) como NOT VALID - ativa a proteção pra
--      operações NOVAS sem falhar por causa da peça cruzada que já existe hoje.
--   2) Repetir o teste de vínculo cruzado e confirmar que o novo vínculo é bloqueado.
--   3) Definir como NULL somente o fornecedor_id da peça de teste (fa7ef17e-...),
--      pra permitir validar a constraint sem apagar a peça em si.
--   4) Rodar ALTER TABLE public.pecas VALIDATE CONSTRAINT pecas_fornecedor_mesma_empresa_fkey;
--      pra validar definitivamente os dados já existentes.
--   5) Testar se excluir um fornecedor ainda aplica ON DELETE SET NULL como esperado.
--
-- IMPORTANTE: pecas_fornecedor_id_fkey (a FK simples existente) NÃO é removida por
-- este script - ela é quem mantém o comportamento ON DELETE SET NULL ao excluir um
-- fornecedor. A nova FK composta é ADICIONAL, não substitui a existente.
--
-- NOT VALID: a nova FK composta entra em vigor imediatamente para INSERT/UPDATE
-- novos, mas o Postgres não escaneia as linhas já existentes em pecas para checar
-- se violam a constraint - por isso a peça de teste com vínculo cruzado não impede
-- este ALTER TABLE de rodar. A validação retroativa dos dados existentes é o
-- passo 4 (VALIDATE CONSTRAINT), só depois de resolver a linha de teste no passo 3.
--
-- AINDA NÃO EXECUTADO. Rodar manualmente no SQL Editor do Supabase, sob autorização.

BEGIN;

ALTER TABLE public.fornecedores
ADD CONSTRAINT fornecedores_id_empresa_id_unique
UNIQUE (id, empresa_id);

ALTER TABLE public.pecas
ADD CONSTRAINT pecas_fornecedor_mesma_empresa_fkey
FOREIGN KEY (fornecedor_id, empresa_id)
REFERENCES public.fornecedores (id, empresa_id)
NOT VALID;

COMMIT;
