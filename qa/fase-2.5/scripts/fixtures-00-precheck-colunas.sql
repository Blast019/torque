-- PASSO 0 (opcional, mas recomendado) — somente leitura.
-- Confirma colunas/obrigatoriedade reais de empresas, clientes e usuarios_empresas
-- antes de rodar o script de reconstrução dos fixtures. Nenhuma alteração.

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('empresas', 'clientes', 'usuarios_empresas')
order by table_name, ordinal_position;
