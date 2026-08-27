-- VALIDAÇÃO PÓS-CRIAÇÃO — somente leitura.
-- Rodar só depois do "commit;" do fixtures-01-reconstrucao.sql.
-- Substituir os IDs de exemplo abaixo pelos IDs reais retornados na criação
-- (ou trocar por "where nome = 'QA Fase 2.5 - Empresa A'" etc.).

-- 1) As duas empresas existem e com o owner_id certo
select id, nome, owner_id
from empresas
where nome in ('QA Fase 2.5 - Empresa A', 'QA Fase 2.5 - Empresa B');

-- 2) Empresa QA A deve ter exatamente 3 vínculos ativos: proprietario, admin, usuario
select ue.empresa_id, ue.usuario_id, ue.papel, ue.ativo
from usuarios_empresas ue
join empresas e on e.id = ue.empresa_id
where e.nome = 'QA Fase 2.5 - Empresa A'
order by ue.papel;

-- 3) Empresa QA B deve ter exatamente 1 vínculo ativo: proprietario = sem_vinculo
select ue.empresa_id, ue.usuario_id, ue.papel, ue.ativo
from usuarios_empresas ue
join empresas e on e.id = ue.empresa_id
where e.nome = 'QA Fase 2.5 - Empresa B';

-- 4) Confirmar isolamento: sem_vinculo (a27f1e18-...) NÃO deve ter nenhum vínculo com a Empresa QA A
select count(*) as deve_ser_zero
from usuarios_empresas ue
join empresas e on e.id = ue.empresa_id
where e.nome = 'QA Fase 2.5 - Empresa A'
  and ue.usuario_id = 'a27f1e18-f80d-49ac-95bd-5fdd8f4e0f4f';

-- 5) Cliente de teste existe, vinculado à Empresa QA A, ativo
select c.id, c.nome, c.empresa_id, c.ativo
from clientes c
join empresas e on e.id = c.empresa_id
where e.nome = 'QA Fase 2.5 - Empresa A';

-- 6) Confirmar que a empresa "Admim" e o cliente "Maria Graça" continuam intocados
select id, nome, owner_id from empresas where id = '825c05d9-04ec-4ddf-b378-bd92d47e9627';
select id, nome, empresa_id, ativo from clientes where nome = 'Maria Graça';
