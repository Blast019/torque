# Fase 5 — SaaS / Administração

Última atualização: 2026-09-14

## Checkpoint de 14/09/2026 — Incremento 3.2: admin-06 e admin-07 executados com sucesso (tabela inesperada removida, placeholder seguro recriado)

🟢 **admin-06 E admin-07 EXECUTADOS COM SUCESSO EM PRODUÇÃO, VALIDADOS POR CONSULTA INDEPENDENTE AO CATÁLOGO.** Este checkpoint registra a execução real dos dois scripts aprovados no checkpoint "Incremento 3.2: duas decisões de negócio aprovadas" (mais abaixo). **Não** inicia nem conclui o desenho definitivo do catálogo de planos do Incremento 3.2 em si — ver "Pendente" no final desta seção.

### admin-06 — remoção da tabela `public.planos` inesperada

- `qa/fase-5/scripts/admin-06-remover-tabela-planos-inesperada.sql` executado manualmente no SQL Editor do Supabase pelo usuário em 14/09/2026.
- Resultado: **Success** (sem nenhum `RAISE EXCEPTION`) — todos os 10 prechecks (relkind='r', 6 colunas exatas por nome/tipo/nulabilidade/default, 2 constraints com definição exata via `pg_get_constraintdef`, zero linhas, zero triggers, RLS habilitado, zero políticas, zero views/matviews dependentes via `pg_depend`, zero FKs de outras tabelas apontando para ela) passaram, o `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` foi obtido, o `DROP TABLE public.planos` foi executado, e a transação chegou ao `COMMIT`.
- **A tabela `public.planos` original — proveniência desconhecida, RLS habilitado sem nenhuma política combinado com `GRANT` direto de CRUD completo para `anon`/`authenticated` (ver checkpoint anterior "Incremento 3.2: duas decisões de negócio aprovadas") — foi removida.**

### admin-07 — recriação segura de `public.planos`

- `qa/fase-5/scripts/admin-07-recuperacao-segura-tabela-planos.sql` executado manualmente no SQL Editor do Supabase pelo usuário, imediatamente após a conclusão do admin-06, em 14/09/2026.
- Resultado: **Success** (sem nenhum `RAISE EXCEPTION`) — a tabela foi recriada (mesma estrutura de colunas/constraints do original), RLS habilitado, owner definido como `postgres`, `REVOKE ALL` executado contra `PUBLIC`/`anon`/`authenticated`, e a auditoria fail-closed de ACL (via `pg_class.relacl` + `aclexplode`, com resolução obrigatória — e abortante se ausente — dos OIDs reais de `anon`/`authenticated` antes de auditar, sem filtro fechado de tipo de privilégio) não encontrou nenhum privilégio para `PUBLIC`/`anon`/`authenticated`, de nenhum tipo.

### Validação final — consulta independente ao catálogo

Depois dos dois scripts, o usuário executou uma consulta somente leitura adicional, **independente** dos dois scripts, direto contra o catálogo do Postgres, para confirmar o estado real da tabela recriada. Resultado retornado:

| Verificação | Resultado |
|---|---|
| `tabela_comum_ok` (relkind = 'r') | `true` |
| `total_linhas` | `0` |
| `rls_habilitado` | `true` |
| `rls_forcado` | `false` |
| `total_policies` | `0` |
| `role_anon_existe` | `true` |
| `role_authenticated_existe` | `true` |
| `privilegios_public_anon_authenticated` | `0` |

**`rls_forcado = false` é o desenho aprovado, não uma pendência**: nenhum dos dois scripts inclui `FORCE ROW LEVEL SECURITY`. O owner da tabela é `postgres`, que ignora RLS de qualquer forma (forçado ou não); como não há nenhuma política e os grants de `PUBLIC`/`anon`/`authenticated` foram revogados, o acesso já fica bloqueado independentemente de `FORCE`. Uma garantia formal de RLS forçado, se um dia for desejada, é uma migração nova e separada — fora do escopo do que foi aprovado e executado aqui.

**Resultado: execução e validação final aprovadas pelo usuário.**

### Estado real de `public.planos` após esta etapa

`public.planos` existe hoje só como uma tabela **placeholder mínima e segura** (`id`, `nome`, `descricao`, `preco`, `ativo`, `criado_em`, com PK em `id` e UNIQUE em `nome`, RLS habilitado, zero políticas, zero grants para `anon`/`authenticated`) — **ainda não é o catálogo definitivo do Incremento 3.2**. Nenhuma linha foi inserida, inclusive **nenhum plano "Teste" ainda** — a Decisão 2 já aprovada (ver checkpoint "Incremento 3.2: duas decisões de negócio aprovadas") continua sem implementação.

### Pendente (nada disto foi iniciado nesta etapa)

- Inserir o plano "Teste" no catálogo (Decisão 2, já aprovada).
- Criar `planos_historico_precos`.
- Desenhar e criar as RPCs administrativas de CRUD de planos.
- Associar as empresas atuais ao plano "Teste" normalizado.
- Frontend (`Torque-Admin`) da tela "Planos".
- Testes mockados + reais do catálogo definitivo, mesmo padrão rigoroso já usado no Incremento 3.1.

Este checkpoint documenta exclusivamente a remoção da tabela inesperada e a recriação segura de um placeholder vazio — nenhuma etapa futura do Incremento 3.2 está concluída.

## Checkpoint de 12/09/2026 — Decisão provisória de cobrança em nome de pessoa física (CPF) e requisitos jurídicos/fiscais antes da formalização

🟡 **DECISÃO DE NEGÓCIO PROVISÓRIA REGISTRADA. Nenhuma cobrança real foi feita ainda. Nenhuma implementação de checkout, contrato ou fluxo de pagamento foi iniciada nesta etapa.** Este checkpoint documenta uma decisão temporária de como a Torque vai operar comercialmente enquanto ainda não existe pessoa jurídica (CNPJ) nem contador contratado — e os requisitos que precisam ser validados antes da primeira cobrança real e antes de qualquer crescimento de escala. Não substitui nem contradiz o modelo financeiro já registrado no checkpoint "Planejamento revisado do Incremento 3" (Correções 1-4) — é uma camada de conformidade jurídica/fiscal sobre aquele modelo, a ser respeitada quando ele for implementado.

**Decisão provisória de titularidade da cobrança**:
- Inicialmente, a cobrança das assinaturas do Torque será recebida **em nome de Weverson Silva, usando CPF**, enquanto o negócio estiver em fase de validação e ainda não possuir CNPJ nem contador.
- A referência de **100 clientes pagantes é somente uma meta interna para acionar a formalização** — não é uma autorização legal, nem um limite que por si só torna a operação regular até ser atingido.
- **Reavaliação obrigatória antes de chegar a essa meta**, sempre que o volume, o faturamento, a habitualidade da operação, uma exigência de cliente, da prefeitura, de um banco, de uma adquirente ou de um gateway de pagamento tornar necessária a formalização mais cedo — a meta de 100 é um teto de referência, nunca um piso que autoriza esperar até lá.

**Antes da primeira cobrança real** (bloqueante — não deve ser feita nenhuma cobrança de assinatura antes disto):
- Validar junto à **Prefeitura de Uberlândia**: cadastro como prestador de serviço autônomo, incidência de ISS sobre o serviço prestado, e a forma correta de emissão de documento fiscal (NFS-e de autônomo ou nota fiscal avulsa, conforme o que o município exigir).

**Escrituração e separação de recebimentos**:
- Recebimentos de pessoas físicas e de pessoas jurídicas devem ser **separados e escriturados**, mantendo, para cada um: identificação do cliente, competência, valor, desconto, estorno, meio de pagamento e comprovante — consistente com o mesmo rigor de auditoria já exigido para `pagamentos` no modelo financeiro (Correção 1, ver checkpoint "Planejamento revisado do Incremento 3").
- Avaliar a incidência de **IRPF/Carnê-Leão** conforme a origem de cada pagamento e as regras vigentes no momento.

**Clientes pessoa jurídica**:
- Um cliente pessoa jurídica poderá exigir documento fiscal. Quando juridicamente aplicável, a própria empresa contratante/tomadora poderá emitir RPA pelo pagamento realizado à pessoa física e efetuar as retenções tributárias e previdenciárias cabíveis. O RPA não deve ser tratado como documento emitido pela Torque nem como substituto automático das obrigações municipais de cadastro, ISS ou emissão de nota fiscal. Isso precisa ser definido **antes** de vender o Torque para empresas (pessoas jurídicas) como clientes — não está definido ainda.

**Documentos que precisam refletir a titularidade real**:
- Contratos, Termos de Uso, Política de Privacidade, política de cancelamento, renovação, inadimplência, reembolso e suporte precisam identificar corretamente **Weverson Silva/CPF**, enquanto não houver pessoa jurídica constituída.
- **O checkout não deve apresentar a Torque como pessoa jurídica** enquanto ela não existir formalmente — nenhuma menção a CNPJ, razão social ou identidade empresarial fictícia.

**Proteção de dados**:
- Dados de cobrança, CPF e e-mail usados neste fluxo devem seguir a **LGPD**: minimização de dados coletados, controle de acesso, retenção adequada (nem além do necessário) e capacidade de resposta a incidentes — mesmo requisito transversal já registrado na seção "Segurança e proteção de dados" desta fase.
- **A plataforma não deve armazenar dados completos de cartão** — o processamento de pagamento deve ficar inteiramente a cargo de um provedor de pagamento compatível (tokenização), mesma restrição já registrada na seção "Segurança e proteção de dados".

**Marco obrigatório de regularização**:
- Fica registrado um **marco obrigatório de "regularização antes da escala"** — a formalização (CNPJ, contador) não deve esperar automaticamente até o cliente pagante de número 100; qualquer um dos gatilhos listados acima (volume, faturamento, habitualidade, exigência externa) antecipa esse marco.
- **Contador e advogado deverão validar este modelo** (titularidade da cobrança, tributação, documentos, LGPD) **antes de a operação comercial recorrente ganhar escala** — nenhuma cobrança recorrente em volume deve começar sem essa validação profissional.

## Checkpoint de 11/09/2026 — Incremento 3.2: duas decisões de negócio aprovadas (investigação técnica em andamento)

🟢 **DECISÕES DE NEGÓCIO APROVADAS PELO USUÁRIO. Nenhuma tabela criada, nenhum SQL executado, nenhum arquivo de código alterado nesta etapa.** Estas duas decisões resolvem as duas pendências registradas no checkpoint "Próximo incremento identificado" logo abaixo (linhas "Depende de uma decisão de negócio ainda não tomada..." e "Decisão de reconciliação ainda em aberto...") — registradas aqui como um novo checkpoint, sem alterar o texto histórico daquela análise.

**Decisão 1 — Efeito de alteração de preço sobre assinaturas**:
- Novas assinaturas usam o preço vigente do plano no momento da contratação.
- Assinaturas já existentes **preservam o preço contratado original** — um reajuste de preço no catálogo não muda automaticamente o valor de nenhuma assinatura já ativa.
- Reajustar o preço de contratos já existentes será feito **futuramente, por uma ação administrativa específica e própria** (não é parte do Incremento 3.2).
- **Todo reajuste de preço deverá ter data de vigência e ficar registrado em histórico** — nunca sobrescrevendo um preço anterior.
- **Nenhuma assinatura existente muda de preço de forma automática ou implícita**, nem por efeito colateral de uma alteração no catálogo.

**Decisão 2 — Migração de `empresas.plano` (texto livre legado) para o catálogo normalizado**:
- Será criado o plano **"Teste"** no novo catálogo normalizado de planos.
- **Novas assinaturas** deverão referenciar o catálogo por `plano_id` (nunca mais por texto livre).
- **Empresas atuais** serão associadas ao plano "Teste" normalizado (consistente com o diagnóstico real do Incremento 3.1, que já confirmou 100% das empresas com `plano='Teste'` na data da consulta).
- `empresas.plano` (coluna de texto livre) será **mantida temporariamente como campo legado** — não é removida nem deixa de funcionar nesta etapa.
- **A remoção definitiva do campo legado só poderá acontecer em outra migração futura, separada, após validação completa** de que a nova estrutura normalizada está correta e em uso — nunca como parte do Incremento 3.2.

Essas duas decisões **não alteram nenhuma decisão anterior já registrada** neste documento — apenas resolvem, de forma explícita, os dois pontos que a análise do Incremento 3.2 (logo abaixo) já havia identificado como pendentes antes de iniciar o desenho técnico da migração.

## Checkpoint de 11/09/2026 — Incremento 3.1 concluído (banco + frontend) e publicado em produção

🟢 **INCREMENTO 3.1 CONCLUÍDO E PUBLICADO EM PRODUÇÃO — banco e frontend.** Este checkpoint consolida a conclusão de todo o Incremento 3.1 (Visão Geral do Painel Administrativo Central), cujas etapas de desenho, execução e testes já estão detalhadas nos checkpoints abaixo. Registrado aqui, no topo, como fechamento oficial.

**Banco (repositório `Blast019/torque`)**:
- Commit `92f94dd` — `feat(admin): criar RPC agregada da visao geral`.
- RPC `public.admin_visao_geral_empresas(integer)` executada com sucesso no Supabase de produção (ver checkpoint "Migração `admin-04-visao-geral-empresas.sql` executada com sucesso" abaixo para a evidência completa e a proveniência real da execução).
- Bateria completa de testes aprovada: casos positivos, negativos (`TRQ61`/`TRQ62`/`TRQ63`), permissões por role (`authenticated`/`anon`/`service_role`) e teste dedicado de fuso horário (`America/Sao_Paulo`) — todos ✅ (ver seção "Testes funcionais — todos aprovados" abaixo).

**Frontend (repositório separado `Blast019/torque-admin`, domínio `admin.torque.tec.br`)**:
- Commit publicado: `9954135` — `feat(painel): implementar visao geral e redesenhar autorizacoes`.
- Hash completo: `99541353c43cda8ada906092379f2a6aceced538`.
- Arquivos alterados: somente `index.html`, `script.js`, `style.css` — `CNAME` e `config.js` do `Torque-Admin` permaneceram intocados em toda a etapa.
- Push fast-forward, sem `--force`, sem alteração de histórico.
- Telas concluídas: **"Visão Geral"** (tela inicial pós-login, chamada única a `admin_visao_geral_empresas({p_meses_serie:12})` por sessão, 4 indicadores reais, gráfico de novas empresas por mês, distribuição de status de assinatura e de plano em gráficos de rosca, seção "Próximos indicadores" sem nenhum valor fictício) e **"Autorizações de acesso"** (redesenho completo da antiga tela de Onboarding, mesma identidade visual).
- **Nomenclatura visível corrigida**: toda referência visível ao termo técnico "Onboarding" foi substituída por "Autorizações"/"Autorizações de acesso" (menu, título da página, subtítulo, título do formulário, título da listagem, badges de situação — "Consumida" também virou "Utilizada"). Nomes internos (IDs, funções JavaScript, nomes de RPC como `admin_listar_autorizacoes_onboarding`) foram **preservados de propósito**, sem renomeação, para não gerar regressão — a mudança foi só nos textos exibidos ao usuário.
- **Testes aprovados**: suíte funcional completa (mockada, cobrindo os dois telas, filtros, estados de erro/retry, proteção contra clique duplo, divisão por zero/NaN nas distribuições), testes de responsividade em 1920×1080, 1366×768 e 390×844 (sem rolagem horizontal em nenhum tamanho, navegação lateral no desktop e navegação horizontal preservada no celular), e **smoke test manual real em produção** (`https://admin.torque.tec.br`) aprovado pelo usuário: login administrativo, Visão Geral com dados reais, navegação para Autorizações, histórico real carregando, botão "Sair" visível — sem nenhuma autorização criada/renovada/revogada durante o teste.

**Identidade visual**: o novo design (fundo azul-preto profundo, laranja como cor de destaque, cards com ícone em caixa translúcida, gráficos de barra e rosca em HTML/CSS puro, sem biblioteca externa) foi **aprovado como referência visual do Painel Administrativo Central** e também **como referência para o futuro redesenho do projeto principal Torque** (o sistema usado pelas empresas clientes, hoje com identidade visual diferente). **Decisão registrada**: esse redesenho do Torque principal será feito **futuramente, tela por tela**, cada uma com seu próprio ciclo de testes e publicação separados — não é um retrabalho único de todo o sistema de uma vez, e não está agendado como parte do Incremento 3.1 nem do próximo incremento.

**Restrição confirmada nesta entrega**: a Visão Geral administrativa **não exibe, e nunca deve exibir, nenhum indicador operacional interno das empresas clientes** — quantidade de funcionários, veículos, barbeiros ou qualquer outro tipo de colaborador/recurso interno de um estabelecimento não pertence a este painel, mesmo de forma agregada. Isso reforça a "Restrição fundamental" já registrada nesta fase (ver seção correspondente abaixo): os únicos indicadores administrativos agregados hoje na tela são total de empresas, novas empresas no mês, empresas ativas e empresas no plano Teste — todos relativos à relação Torque↔estabelecimento, nunca ao funcionamento interno do estabelecimento.

**Indicadores futuros já previstos (seção "Próximos indicadores" da tela, hoje sem nenhum número, só descrição do que virá)**: valor recebido, valores pendentes/inadimplência, mensagens enviadas e custo das mensagens — todos dependentes de módulos ainda não implementados (financeiro/assinaturas e mensagens), sem nenhuma data fictícia exibida até que esses módulos existam de fato.

### Próximo incremento identificado — análise, nada implementado

🔵 **ANÁLISE DE PLANEJAMENTO. Nenhuma tabela criada, nenhum SQL executado, nenhum arquivo do painel alterado nesta etapa.**

Pela "Ordem de trabalho registrada" no checkpoint "Planejamento revisado do Incremento 3" (mais abaixo neste mesmo documento), a sequência aprovada após o Incremento 3.1 é: **Incremento 3.2 — Catálogo e histórico de preços dos planos**, seguido por 3.5 (Despesas), depois 3.3/3.4 (Assinaturas), 3.6 (Rateio), 3.7 (Fechamento mensal) e 3.8 (Métricas de WhatsApp, condicionado à Fase 7). Essa ordem já foi aprovada anteriormente e não foi alterada aqui — nenhuma numeração nova foi inventada.

**Nenhuma contradição encontrada** entre essa ordem e o restante do planejamento: as sub-fases 5.1 (restrição de acesso), 5.3 (URL personalizada) e 5.4 (Central de Avisos) continuam registradas como requisitos pendentes, mas não fazem parte da fila de execução imediata definida nessa "Ordem de trabalho registrada" — não é uma contradição, é uma priorização já explícita no documento (o detalhamento técnico de "Incremento 3" foi a decisão de focar primeiro em 5.2/Operação e Financeiro + o dashboard, deixando 5.1/5.3/5.4 para depois, sem data definida).

**Objetivo do Incremento 3.2**: criar o catálogo de planos (`planos`) e o histórico de preços (`planos_historico_precos`) da própria Torque — nome, periodicidade, período de teste, limites, descontos e recursos de cada plano, com histórico de mudanças de preço preservado (nunca sobrescrito). É pré-requisito estrutural do Incremento 3.3/3.4 (Assinaturas), cujo modelo já aprovado (`assinaturas.plano_id`) pressupõe a existência desse catálogo.

**Dependências**:
- Nenhuma dependência de dado real além do que já foi confirmado no diagnóstico do Incremento 3.1 (schema de `empresas` já conhecido).
- Depende de uma decisão de negócio ainda **não tomada e explicitamente registrada como pendente** na seção 5.2: como uma mudança de preço afeta assinaturas já existentes (aplicação imediata, só em renovações futuras, ou regra de transição) — isso precisa ser decidido antes de fechar o desenho de `planos_historico_precos`, pois afeta diretamente sua estrutura (campo de vigência, estratégia de aplicação).
- Decisão de reconciliação ainda em aberto: hoje `empresas.plano` é texto livre (`'Teste'` etc., sem `CHECK`, confirmado no diagnóstico real do Incremento 3.1). É preciso decidir se o Incremento 3.2 já migra/relaciona esse campo ao novo catálogo normalizado, ou se mantém os dois coexistindo temporariamente até o Incremento 3.3/3.4 (quando `assinaturas.plano_id` for de fato criado e passar a ser a fonte de verdade).

**Dados necessários antes de desenhar a migração**: nenhuma nova consulta de diagnóstico ao banco é estritamente necessária (diferente do 3.1, que dependeu de confirmar colunas desconhecidas) — mas convém, ao iniciar, reconferir os valores reais hoje presentes em `empresas.plano` (o diagnóstico do 3.1 já indicou 100% das empresas em `'Teste'` na data da consulta) para garantir que o desenho do catálogo cobre pelo menos os valores realmente em uso.

**Riscos identificados**:
- Reconciliar o texto livre existente (`empresas.plano`) com um catálogo normalizado pode expor inconsistências de grafia/capitalização se novos valores tiverem sido gravados fora do padrão desde o diagnóstico do 3.1.
- Risco de escopo: desenhar `planos_historico_precos` sem a decisão pendente sobre efeito de mudança de preço pode gerar retrabalho estrutural quando o Incremento 3.3/3.4 (Assinaturas) precisar consumir esse histórico.
- Mesmo princípio de segurança já aplicado no 3.1 (RPCs `SECURITY DEFINER`, `search_path` vazio, gated por `administradores_plataforma`) precisa se repetir aqui — nenhum dado de plano deve ficar gravável diretamente por `anon`/`authenticated`.

**Ordem sugerida** (dentro do próprio Incremento 3.2, ainda não iniciado):
1. Confirmar/decidir a política de efeito de mudança de preço (pendência de negócio acima) — sem isso, não desenhar a tabela.
2. Desenhar `planos` + `planos_historico_precos` (aditivo — sem alterar `empresas` nem nenhuma tabela existente nesta etapa).
3. Desenhar as RPCs administrativas de CRUD de planos (criar/editar/ativar/desativar plano; registrar novo preço no histórico).
4. Testes mockados + reais, mesmo padrão rigoroso do Incremento 3.1 (positivos, negativos, permissões).
5. Frontend: nova tela "Planos" no `Torque-Admin` (item já existe no menu lateral, hoje marcado "Em breve").
6. Publicação separada, com smoke test real, mesmo fluxo usado para o Incremento 3.1.

Este incremento **não foi implementado** nesta etapa — só identificado e descrito, aguardando decisão do usuário para prosseguir.

## Checkpoint de 11/09/2026 — Incremento 3.1: diagnóstico real confirmado e desenho técnico da RPC de Visão Geral

🔵 **INVESTIGAÇÃO CONCLUÍDA E DESENHO TÉCNICO PROPOSTO. Nada executado, nada implementado, nenhum arquivo de migração criado ainda.**

### Diagnóstico executado no banco real (SQL somente leitura, sem escrita)

O script de diagnóstico (colunas, constraints, índices, RLS, policies, triggers, grants, dependências, contagens agregadas) foi executado pelo usuário no SQL Editor do Supabase. Resultados reais:

**`public.empresas` — schema confirmado:**

| Coluna | Tipo | Nulo? | Default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `owner_id` | uuid | não | — (FK `auth.users(id)` `ON DELETE CASCADE`) |
| `nome` | text | não | `'Minha oficina'::text` |
| `criado_em` | timestamptz | não | `now()` |
| `cnpj` | text | sim | — |
| `telefone` | text | sim | — |
| `plano` | text | não | `'Teste'::text` |
| `status_assinatura` | text | não | `'ativo'::text` |

- **`empresas.criado_em` existe de verdade** — não precisa de proxy via `usuarios_empresas.criado_em` (hipótese da investigação anterior, agora descartada por desnecessária).
- **Nenhuma `CHECK` constraint** em `plano` nem `status_assinatura` — são texto livre, sem lista fechada de valores garantida pelo banco (só 2 constraints existem na tabela: `empresas_pkey` e `empresas_owner_id_fkey`).
- **Confirmada ausência total** de `nicho`, `segmento`, `situacao_acesso`, `bloqueado`/`bloqueada`, `suspenso`/`suspensa`, `contato_administrativo`, `contato_financeiro`, `plano_id`, `assinatura_id` — em `empresas` e em `usuarios_empresas`. Nenhuma estrutura financeira formal existe (planos/assinaturas/cobranças continuam sendo só planejamento, ver checkpoint de "Incremento 3" acima).
- **RLS**: ativo, não forçado (`relforcerowsecurity=false`, irrelevante pois `postgres`/RPCs `SECURITY DEFINER` sempre puderam ler tudo). 4 policies: `empresa_select_own`, `empresa_update_own`, `empresa_delete_own` (todas `owner_id = auth.uid()`) e `empresa_select_usuario_vinculado` (`authenticated`, via `usuario_pertence_empresa(id, auth.uid())`). **Nenhuma policy de `INSERT`** — consistente com o fechamento do Incremento 1.
- **FKs apontando para `empresas`** (todas `ON DELETE CASCADE`): `agendamentos`, `caixa_movimentos`, `clientes`, `fornecedores`, `funcionarios`, `movimentos_caixa`, `ordens_servico`, `pecas`, `usuarios_empresas`, `veiculos`.
- **Achado lateral, não investigado a fundo**: existem duas tabelas com nomes muito parecidos referenciando `empresas` — `movimentos_caixa` (a que o app realmente usa, confirmado em `script.js`) e `caixa_movimentos` (nunca referenciada em nenhum código lido nesta sessão). Pode ser uma tabela legada/abandonada. **Não foi investigada a fundo e não se conclui que pode ser removida** — só registrado como candidato a uma investigação futura própria, fora do escopo do Incremento 3.1.
- **Contagens reais** (11/09/2026): `10` empresas cadastradas; `13` vínculos em `usuarios_empresas` (`12` ativos, `1` inativo); as `10` empresas têm pelo menos um vínculo. Hoje, **100% das empresas** estão com `status_assinatura='ativo'` e `plano='Teste'` (zero variedade nos dados reais atuais — não há hoje nenhuma empresa em outro plano ou status).

**Achado de acoplamento ao nicho "oficina" (regra 7 de `qa/ARQUITETURA-MULTINICHO.md`)**: além do acoplamento já conhecido em `script.js` (IDs/textos de interface como `oficinaNome`, `"Informe o nome da oficina"`), o diagnóstico revela que o **próprio schema do banco** tem esse acoplamento — `empresas.nome DEFAULT 'Minha oficina'::text`. Isso não bloqueia o Incremento 3.1 (a RPC de Visão Geral não depende do valor de `nome`), mas é um achado mais sério que os anteriores por estar no nível do banco, não só do frontend — registrado aqui para a futura investigação completa da regra 7.

**Achado de segurança — item obrigatório de hardening futuro, fora do escopo do Incremento 3.1**: `anon` e `authenticated` têm `DELETE`, `UPDATE` e **`TRUNCATE`** concedidos diretamente em `public.empresas` (só `INSERT` já foi revogado, no Incremento 1). `SELECT`/`UPDATE`/`DELETE` são efetivamente contidos pelas 4 policies de RLS (nunca exploráveis pela superfície real do app, que só fala com o banco via PostgREST/RPCs). `TRUNCATE` **não é filtrado por RLS** — só seria explorável por alguém com conexão Postgres direta como `anon`/`authenticated`, o que a aplicação real não expõe (PostgREST não tem endpoint de `TRUNCATE`). **Não é explorável pela superfície de ataque atual**, mas viola o princípio do menor privilégio já registrado como requisito pendente em "Segurança e proteção de dados" (acima). **Registrado como item obrigatório de hardening futuro — não corrigido agora, e a investigação não foi ampliada para as outras 9 tabelas com FK para `empresas`** (decisão explícita: manter o escopo desta etapa restrito a `empresas`).

### Desenho técnico proposto — Incremento 3.1: RPC `admin_visao_geral_empresas`

🔵 **PROPOSTA. Nenhum SQL executado, nenhum arquivo de migração criado ainda — aguardando aprovação antes de salvar o script.**

**Uma única RPC**, `SECURITY DEFINER`, `STABLE`, `SET search_path TO ''`, gated pelo mesmo padrão das RPCs administrativas já existentes (`administradores_plataforma`, ativo). Retorna um único `jsonb` agregando os cortes já possíveis com dado real hoje — evita múltiplas idas ao banco para montar uma tela de dashboard, e permite estender a estrutura no futuro sem trocar de RPC.

🟡 **Correção de revisão (11/09/2026)**: a série mensal agora usa explicitamente o fuso `America/Sao_Paulo` (tanto no limite gerado por `generate_series` quanto no agrupamento de `empresas.criado_em`), evitando que uma empresa criada perto da virada do mês em UTC caia no mês errado quando vista em horário de São Paulo. O intervalo usa `make_interval(months => ...)`, não concatenação de texto. As duas distribuições (`status_assinatura`/`plano`) agora têm ordenação determinística (`ORDER BY total DESC, <coluna>`) — sem isso, duas execuções com o mesmo dado podiam retornar a mesma contagem em ordens diferentes.

```sql
CREATE FUNCTION public.admin_visao_geral_empresas(
  p_meses_serie integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario_id uuid;
  v_eh_admin   boolean;
  v_resultado  jsonb;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ61',
      MESSAGE = 'nao_autenticado',
      DETAIL  = 'auth.uid() retornou null nesta chamada.';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.administradores_plataforma a
     WHERE a.user_id = v_usuario_id AND a.ativo = true
  ) INTO v_eh_admin;

  IF NOT v_eh_admin THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ62',
      MESSAGE = 'sem_permissao_administrativa',
      DETAIL  = 'usuario autenticado nao e administrador ativo da plataforma.';
  END IF;

  IF p_meses_serie IS NULL OR p_meses_serie < 1 OR p_meses_serie > 36 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TRQ63',
      MESSAGE = 'entrada_invalida',
      DETAIL  = 'p_meses_serie precisa estar entre 1 e 36.';
  END IF;

  -- Todos os limites e agrupamentos de mes abaixo sao calculados em
  -- America/Sao_Paulo, nunca no fuso da sessao do banco (normalmente UTC) -
  -- uma empresa criada as 23h30 de SP no ultimo dia do mes e ja madrugada
  -- do mes seguinte em UTC; sem a conversao explicita ela apareceria no
  -- mes errado.
  SELECT jsonb_build_object(
    'total_empresas', (SELECT count(*) FROM public.empresas),
    'vinculos', jsonb_build_object(
      'total',               (SELECT count(*) FROM public.usuarios_empresas),
      'ativos',              (SELECT count(*) FROM public.usuarios_empresas WHERE ativo),
      'inativos',            (SELECT count(*) FROM public.usuarios_empresas WHERE NOT ativo),
      'empresas_com_vinculo',(SELECT count(DISTINCT empresa_id) FROM public.usuarios_empresas)
    ),
    'novas_empresas_por_mes', (
      SELECT jsonb_agg(jsonb_build_object('mes', to_char(mes, 'YYYY-MM'), 'total', coalesce(t.total, 0)) ORDER BY mes)
      FROM generate_series(
             date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - make_interval(months => p_meses_serie - 1),
             date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')),
             interval '1 month'
           ) AS mes
      LEFT JOIN (
        SELECT date_trunc('month', criado_em AT TIME ZONE 'America/Sao_Paulo') AS mes, count(*) AS total
          FROM public.empresas
         GROUP BY 1
      ) t USING (mes)
    ),
    'distribuicao_status_assinatura', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('valor', status_assinatura, 'total', total) ORDER BY total DESC, status_assinatura), '[]'::jsonb)
        FROM (SELECT status_assinatura, count(*) AS total FROM public.empresas GROUP BY status_assinatura) t
    ),
    'distribuicao_plano', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('valor', plano, 'total', total) ORDER BY total DESC, plano), '[]'::jsonb)
        FROM (SELECT plano, count(*) AS total FROM public.empresas GROUP BY plano) t
    ),
    'gerado_em', now()
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;
```

**Decisões de desenho**:
- **Nenhum código TRQ novo**: `TRQ61`/`TRQ62` são reaproveitados — pertencem à mesma família de RPCs administrativas (mesma tabela `administradores_plataforma`, mesmo significado exato) criada no `admin-01`. `TRQ63` (`entrada_invalida`) também já existe nessa família, reaproveitado só para validar `p_meses_serie`.
- **`plano`/`status_assinatura` tratados como texto legado**: `GROUP BY` direto na coluna, sem `CASE`/mapa de rótulos, sem presumir nenhum valor fechado — o que existir de verdade no banco aparece como está.
- **Série de 12 meses (padrão) sempre contínua e sempre em `America/Sao_Paulo`**: usa `generate_series` + `LEFT JOIN`, com `AT TIME ZONE 'America/Sao_Paulo'` explícito nos dois lados do `JOIN` (limites da série e agrupamento de `criado_em`) — garante que meses sem nenhuma empresa nova apareçam com `total:0`, e que o mês de cada empresa nova seja o mês real em horário de São Paulo, nunca o de UTC.
- **`make_interval(months => p_meses_serie - 1)`** no lugar de concatenar texto para montar o intervalo — evita qualquer ambiguidade de formatação/parsing de intervalo.
- **Ordenação determinística** nas duas distribuições (`ORDER BY total DESC, <coluna>`) — em caso de empate na contagem, o desempate por ordem alfabética do próprio valor garante que a mesma consulta sempre retorne a mesma ordem.
- **Nenhum dado individual de empresa** (`nome`, `cnpj`, `telefone`) nem de usuário — só contagens e os dois textos administrativos (`plano`/`status_assinatura`), consistentes com a "Restrição fundamental" já registrada nesta fase.
- **Nenhum `nicho`, bloqueio, MRR ou indicador financeiro** incluído — todos continuam bloqueados por dependerem de estruturas ainda inexistentes (ver seção acima).

**Estrutura da futura migração** (quando o arquivo for de fato criado — ainda não foi):
1. `BEGIN;`
2. Precheck (`DO $$ ... $$`) que confirma que `public.empresas`, `public.usuarios_empresas` e `public.administradores_plataforma` existem, **e que `admin_visao_geral_empresas(integer)` ainda NÃO existe** — aborta com `RAISE EXCEPTION` se qualquer uma dessas condições falhar, sem alterar nada.
3. `CREATE FUNCTION` (não `CREATE OR REPLACE FUNCTION` — a função é nova; usar `CREATE` puro garante que a migração falha alto e claro se, por qualquer motivo, ela já existir, em vez de silenciosamente substituir algo).
4. `ALTER FUNCTION ... OWNER TO postgres`, `REVOKE ALL ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated, service_role`.
5. Consultas finais **somente leitura** de verificação (existência da função, `has_function_privilege` para `authenticated`).
6. `COMMIT;`

**Riscos identificados**:
- Sem índice em `empresas.criado_em`/`plano`/`status_assinatura` — irrelevante com 10 linhas hoje; se a base crescer muito, agregações passam a fazer *sequential scan* — não é um problema atual, só uma revisão futura de performance se necessário.
- `plano`/`status_assinatura` sem `CHECK`: a distribuição pode expor inconsistência de texto (ex.: variações de maiúscula/minúscula ou espaço) se algum dia forem gravados fora do `DEFAULT` — a RPC só reporta o que existe, não normaliza; isso fica resolvido de verdade só no Incremento 3.2 (catálogo de planos).
- `criado_em` como marco de "nova empresa" é a data real de criação da linha, mas pode não corresponder ao início comercial exato em casos históricos de correção manual (ex.: o ajuste de `owner_id` já documentado no `qa/fase-2.5/STATUS.md`) — não é um problema para o Incremento 3.1 (não há esses casos hoje), só uma ressalva de interpretação.
- **Fuso horário — risco corrigido nesta revisão, mas que precisa de teste dedicado**: antes da correção, `date_trunc('month', now())`/`date_trunc('month', criado_em)` dependiam do fuso da sessão do banco (normalmente UTC), podendo classificar uma empresa criada no fim da noite (horário de SP) já como do mês seguinte. Corrigido com `AT TIME ZONE 'America/Sao_Paulo'` explícito nos dois pontos — mas isso só fica realmente validado com um teste que crie um registro perto da virada do mês em UTC e confirme o mês correto em SP (ver testes abaixo).
- Contrato do retorno é `jsonb`: qualquer mudança de estrutura no futuro precisa ser versionada com cuidado pelo consumidor (o frontend do `Torque-Admin`).

**Testes previstos, quando implementado** (mesmo padrão já usado no Onboarding — mockado + real):
- Administrador ativo recebe o `jsonb` completo, com as **6 chaves de topo** (`total_empresas`, `vinculos`, `novas_empresas_por_mes`, `distribuicao_status_assinatura`, `distribuicao_plano`, `gerado_em`); não autenticado recebe `TRQ61`; autenticado não administrador recebe `TRQ62`; `p_meses_serie` fora de `[1,36]` recebe `TRQ63`.
- `total_empresas`, `vinculos.*` batem exatamente com os números do diagnóstico real (Blocos 11-1/11-2 desta sessão) no momento do teste.
- `novas_empresas_por_mes` sempre retorna exatamente `p_meses_serie` pontos, mesmo com meses zerados.
- `distribuicao_status_assinatura`/`distribuicao_plano` batem com os Blocos 13-1/13-2, e vêm ordenadas por `total DESC` com desempate alfabético estável entre execuções.
- **Teste dedicado de fuso horário**: inserir (em ambiente de teste, nunca em produção) uma empresa com `criado_em` correspondente a, por exemplo, `2026-09-30 23:30:00 America/Sao_Paulo` (= `2026-10-01 02:30:00 UTC`) e confirmar que ela aparece em `"2026-09"` na série, não em `"2026-10"` — e o inverso, uma criada logo após a meia-noite de SP no primeiro dia do mês, confirmando que cai no mês novo mesmo que ainda seja o dia anterior em algum outro fuso de referência.
- Nenhuma chamada de rede além desta RPC; nenhuma coluna de `nome`/`cnpj`/`telefone`/usuário aparece na resposta.

**Rollback proposto** (quando a migração for criada e executada):

```sql
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.admin_visao_geral_empresas(integer)') IS NULL THEN
    RAISE EXCEPTION 'Precheck falhou: admin_visao_geral_empresas(integer) nao encontrada com a assinatura esperada. Abortando sem alterar nada.';
  END IF;
END $$;

DROP FUNCTION public.admin_visao_geral_empresas(integer);

SELECT to_regprocedure('public.admin_visao_geral_empresas(integer)') AS funcao_apos_rollback;
-- Esperado apos este rollback: null.

COMMIT;
```

Sem risco de perda de dado — a função é puramente `STABLE`/leitura; nenhuma tabela é criada por este incremento, então o rollback é só o `DROP FUNCTION`.

**Estado atual (atualizado em 11/09/2026)**: os dois arquivos abaixo foram **criados como proposta** — texto revisado e estaticamente conferido, **ainda NÃO executados em nenhum banco**:
- `qa/fase-5/scripts/admin-04-visao-geral-empresas.sql` — migração completa: `BEGIN`, prechecks (tabelas, colunas usadas pela RPC, e confirmação de que a RPC ainda não existe), `CREATE FUNCTION public.admin_visao_geral_empresas`, `OWNER TO postgres`, `REVOKE ALL ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated, service_role`, `COMMENT ON FUNCTION`, consultas finais **informativas** somente leitura (existência/assinatura, owner/`SECURITY DEFINER`/volatilidade, `search_path`, privilégios de `EXECUTE` por role), `COMMIT`.
- `qa/fase-5/scripts/admin-05-rollback-visao-geral-empresas.sql` — rollback: `BEGIN`, precheck que aborta se a função não existir, `DROP FUNCTION` exclusivo dessa RPC, verificação de ausência, `COMMIT`. Não toca em nenhuma tabela ou dado.

**Endurecimento aplicado em `admin-04` (11/09/2026, antes de qualquer execução)**:
- As consultas finais informativas foram **mantidas exatamente como estavam** (mesma função, mesmo contrato JSON — nenhuma alteração de lógica).
- Corrigido o comentário da primeira consulta: `pg_get_function_identity_arguments()` retorna só o tipo (`"integer"`, usado para `ALTER`/`DROP FUNCTION`), **não** `"p_meses_serie integer DEFAULT 12"` como o comentário original dizia erradamente. Adicionada uma segunda coluna com `pg_get_function_arguments()`, que é quem de fato mostra nome do parâmetro e `DEFAULT`.
- **Acrescentado, logo antes do `COMMIT`, um bloco `DO $$ ... $$` de verificação final abortante**: confirma, com `RAISE EXCEPTION` (que desfaz a transação inteira via `ROLLBACK` automático, sem depender de leitura humana das consultas informativas), que a RPC recém-criada tem exatamente: existência com assinatura `(integer)`; `owner = postgres`; `SECURITY DEFINER` ativo; volatilidade `STABLE`; `search_path` configurado como vazio (`proconfig` contém `search_path=`); `authenticated` **com** `EXECUTE`; `anon` **sem** `EXECUTE`; `service_role` **com** `EXECUTE`. Se qualquer uma dessas 8 condições falhar, a migração inteira é revertida automaticamente, mesmo que já tenha chegado ao fim do arquivo.

### Migração `admin-04-visao-geral-empresas.sql` executada com sucesso (11/09/2026)

🟢 **EXECUTADA NO SUPABASE DE PRODUÇÃO, com sucesso — inclusive o bloco `DO $$` de verificação final abortante (que teria desfeito tudo via `ROLLBACK` se qualquer uma das 8 condições rígidas tivesse falhado).** A função `public.admin_visao_geral_empresas(integer)` existe agora no banco real.

**Evidência confirmada pelo usuário** (consulta "Privilégios de EXECUTE" do próprio script):
- `authenticated_pode_executar` = `true`
- `anon_pode_executar` = `false`
- `service_role_pode_executar` = `true`

Bate exatamente com o esperado documentado (`true, false, true`). Como o bloco `DO $$` abortante roda **antes** do `COMMIT` e verifica essas mesmas três condições (junto com existência/assinatura, owner, `SECURITY DEFINER`, volatilidade `STABLE` e `search_path` vazio) — e a migração não foi revertida — as outras 5 condições também foram confirmadas implicitamente pela própria migração, sem precisar de nova consulta manual.

**Nenhum administrador foi cadastrado, nenhuma empresa foi criada/alterada, nenhum dado foi modificado** por esta migração — ela só cria uma função de leitura.

### Como a migração foi de fato aplicada (provenance real, diferente do arquivo original)

🟡 **Correção de registro (11/09/2026)**: a execução **não** foi feita rodando `admin-04-visao-geral-empresas.sql` diretamente. O usuário usou uma consulta corrigida, gerada por outra ferramenta (Codex), em três tentativas:

1. **Tentativa 1** — conteúdo em formato de *diff* (não SQL puro executável direto) — **rejeitada antes de qualquer execução**. Nada rodou, nada foi alterado.
2. **Tentativa 2** — corpo da função com um nome de variável incorreto (`v_definer`, divergente do declarado) — **rejeitada antes do `COMMIT` e revertida** (a transação não chegou a ser confirmada; nada persistiu).
3. **Tentativa 3** — corrigida para `v_security_definer` (o nome correto, igual ao que já estava no arquivo original deste incremento) — **executada com sucesso até o `COMMIT`**. É esta a versão realmente em produção hoje.

**Reconciliação do arquivo local com produção**: como o texto executado divergia do arquivo original (mesma lógica, porém com aliases diferentes — `a`→`administrador`, subconsultas renomeadas para `serie`/`totais`/`distribuicao`, `JOIN ... USING` reescrito como `JOIN ... ON`, formatação em várias linhas, e **todos os comentários internos removidos**), o corpo da função dentro de `qa/fase-5/scripts/admin-04-visao-geral-empresas.sql` foi **atualizado para ser cópia exata** do que `pg_get_functiondef()` retornou do objeto real. Confirmado, comparando linha a linha, que a lógica é **100% equivalente** à originalmente revisada e aprovada — mesmos códigos `TRQ61`/`TRQ62`/`TRQ63`, mesmo tratamento de fuso horário (`AT TIME ZONE 'America/Sao_Paulo'` nos dois pontos), mesmo `make_interval`, mesma ordenação determinística, mesmo contrato de 6 chaves no JSON. As explicações que antes estavam como comentário **dentro** da função foram movidas para o cabeçalho do arquivo (fora do corpo), já que o objeto real não as contém. O `COMMENT ON FUNCTION` também foi ajustado para o texto curto que está de fato em produção: *"Indicadores administrativos agregados da Visao Geral do Painel Administrativo Central."*

**Ressalva de precisão**: só o **corpo da função** (via `pg_get_functiondef`) e o **`COMMENT ON FUNCTION`** têm confirmação byte-a-byte do texto realmente executado. Os prechecks, `OWNER`/`REVOKE`/`GRANT` e o bloco `DO $$` de verificação final abortante no arquivo continuam sendo a versão originalmente autorada e revisada — não há prova byte-a-byte de que o texto exato desses trechos foi o mesmo usado pelo Codex, mas o **resultado observado** (grants corretos, função existente, nenhum erro) é consistente com eles terem produzido exatamente esse mesmo estado final.

### Testes funcionais — todos aprovados (11/09/2026)

🟢 Todos os testes preparados na etapa anterior foram executados pelo usuário direto no SQL Editor (via simulação de `request.jwt.claims`, sem alterar nenhum dado) e **aprovados**:

- **A1** (sem sessão → `TRQ61`): ✅
- **A2** (autenticado, não administrador → `TRQ62`): ✅
- **A3** (administrador ativo, `p_meses_serie` inválido → `TRQ63`): ✅
- **B1** (6 chaves de topo no `jsonb`): ✅
- **B2** (`total_empresas`/`vinculos.*` batem com o diagnóstico real — 10/13/12/1/10): ✅
- **B3** (`distribuicao_status_assinatura`/`distribuicao_plano` batem com o real): ✅
- **B4** (tamanho da série respeita `p_meses_serie`, padrão e customizado): ✅
- **B5** (ordenação determinística entre chamadas sucessivas): ✅
- **B6** (nenhuma chave sensível no nível de topo do `jsonb`): ✅
- **C** (fuso horário — mesmo instante escrito em `America/Sao_Paulo` e em UTC cai no mesmo mês de SP): ✅

**Conclusão**: a RPC `admin_visao_geral_empresas(integer)` está em produção, correta, segura e validada — tanto estaticamente (comparação de código) quanto dinamicamente (bateria completa de testes positivos e negativos), sem qualquer alteração de dado real em nenhum momento.

**Próximo passo registrado**: iniciar o frontend do `Torque-Admin` para a tela "Visão Geral" (ainda não iniciado) — ou outro incremento, conforme prioridade do usuário.

## Checkpoint de 11/09/2026 — Redesenho do Torque-Admin revisado, testado e publicado

🟢 **Redesenho visual e de navegação do Painel Administrativo Central revisado, testado (mockado e real) e publicado separadamente — concluído.**

### Publicação

- **Repositório**: `Blast019/torque-admin`.
- **Domínio**: `admin.torque.tec.br`.
- **Commit do redesenho**: `e3736e3` — `feat(painel): redesenhar identidade visual e navegacao do painel administrativo`. Arquivos: `index.html`, `script.js`, `style.css`.
- **Commit da correção responsiva**: `b7580dd` — `fix(layout): manter botao de logout visivel em telas estreitas`. Arquivo: somente `style.css`.
- Os dois pushes foram **fast-forward, sem `--force`**.
- `CNAME` e `config.js` do `Torque-Admin` **não foram alterados** em nenhuma dessas etapas.
- O **repositório principal `Torque` não foi alterado** durante a revisão e publicação do painel.

### Auditoria mockada (Playwright, sem nenhuma chamada real ao Supabase) — 11/11 testes aprovados

- Login inválido e login administrativo: **aprovados**.
- Bloqueio e logout automático para conta não administradora: **aprovados**.
- Logout administrativo: **aprovado**.
- Listagem, os quatro indicadores (Pendentes/Consumidas/Expiradas/Revogadas) e os cinco filtros: **aprovados**.
- Autorizar, renovar e proteção contra duplo clique: **aprovados**.
- Revogação — cancelamento e confirmação: **aprovados**.
- Confirmado que só as quatro RPCs administrativas já existentes são usadas (`sou_administrador_plataforma`, `admin_listar_autorizacoes_onboarding`, `admin_autorizar_onboarding`, `admin_revogar_autorizacao_onboarding`) — nenhuma `service_role`, senha, token privado ou acesso direto a tabela foi introduzido.
- `node --check` e `git diff --check`: **aprovados**.
- Testes responsivos (desktop, notebook, mobile): **aprovados**.

### Teste real publicado (dispositivo real, contra `admin.torque.tec.br` em produção)

- Computador: **aprovado**, sem barra de rolagem horizontal da página.
- Celular: **aprovado**.
- Botão "Sair" totalmente visível nos dois dispositivos.
- O e-mail administrativo (comprido, com `+admintorque`) não empurra mais o botão para fora — defeito real encontrado após a primeira publicação, corrigido pelo commit `b7580dd` acima.
- A navegação horizontal do menu lateral no celular (faixa com rolagem própria, comportamento intencional) foi visualizada e **aprovada pelo usuário** como comportamento desejado.

**Redesenho do `Torque-Admin` considerado concluído e publicado.**

### Próximo passo

1. Versionar este checkpoint e o planejamento financeiro já pendente (seção "Planejamento revisado do Incremento 3", logo abaixo).
2. Depois, iniciar — em etapa separada e **apenas como planejamento** — a revisão técnica do Incremento 3.1.
3. **Não implementar ainda o Incremento 3.1.**

## Checkpoint de 11/09/2026 — Planejamento revisado do Incremento 3 (Painel Administrativo Central: Operação e Financeiro) — aprovado com 4 correções obrigatórias

🔵 **PLANEJAMENTO. Nenhuma implementação iniciada nesta etapa — nenhuma tabela criada, nenhum SQL executado, nenhum arquivo do painel (`Blast019/torque-admin`) alterado.**

### Contexto

Depois da conclusão do Incremento 2.2 (Onboarding, testado e aprovado em produção) e da transferência do painel para `Blast019/torque-admin`, foi pedido o planejamento do que o painel deve se tornar: centro de acompanhamento da operação da Torque — visão geral da plataforma, faturamento da própria Torque (distinto do faturamento interno das empresas clientes), controle de despesas, custos e rentabilidade por empresa, e monitoramento agregado do WhatsApp. Uma primeira proposta de modelo de dados e incrementos foi apresentada em conversa e **aprovada com 4 correções obrigatórias**, já incorporadas abaixo. Este documento registra o planejamento corrigido e o ponto exato de retomada — nenhum incremento de código foi iniciado.

### Correção 1 — Identidade permanente da assinatura

A proposta original fechava (`encerrada_em`) e criava uma nova linha em `assinaturas` a cada mudança de plano ou situação — **rejeitado**: transformaria artificialmente a mesma empresa em um "novo assinante" a cada mudança, distorcendo qualquer indicador de novas assinaturas x cancelamentos. Modelo corrigido:

- **`assinaturas`** — contrato permanente da empresa, uma linha por empresa, **com o mesmo `id` para sempre**: `id`, `empresa_id` (único), `plano_id` (plano atual — cache do estado corrente), `situacao` (situação atual — cache do estado corrente), `iniciada_em`, `criado_em`.
- **`assinaturas_historico`** — todo evento de mudança (plano, situação, datas, motivo), nunca apagado nem sobrescrito: `id`, `assinatura_id`, `plano_id` (vigente a partir deste evento), `situacao` (vigente a partir deste evento), `vigente_desde`, `vigente_ate` (nulo enquanto for o evento mais recente — fechado pela própria RPC de mudança no mesmo instante em que abre o próximo evento, mesmo padrão de índice único parcial já usado em `autorizacoes_onboarding`), `motivo`, `registrado_por` (nulo quando a mudança for automática, ex.: suspensão por inadimplência).
- **Regra obrigatória de implementação**: nenhuma RPC pode escrever em `assinaturas.plano_id`/`situacao` sem, na mesma transação, fechar o evento anterior e inserir o novo evento em `assinaturas_historico`. Não haverá via de escrita direta nessas colunas fora dessa RPC única.
- **`cobrancas`** passa a tratar só a obrigação financeira por competência (não mistura mais com recebimento): `id`, `assinatura_id`, `competencia`, `valor_previsto`, `valor_faturado` (nulo até ser efetivamente emitida), `desconto`, `vencimento`, `status` (prevista/faturada/paga/parcialmente_paga/atrasada/inadimplente/cancelada), `criado_em`.
- **`pagamentos`** (nova, separada de `cobrancas`) — todo recebimento, taxa, estorno e identificador do provedor, sempre como evento próprio, nunca sobrescrevendo um pagamento anterior: `id`, `cobranca_id`, `valor_recebido`, `taxa_pagamento`, `estorno` (boolean) + `valor_estornado` (nulo se não for estorno), `forma_pagamento` (manual por enquanto — sem integração de meio de pagamento ainda, mesma restrição já registrada na seção 5.2 abaixo), `identificador_externo` (referência do provedor, para quando houver integração — hoje nulo), `recebido_em`, `registrado_por`, `observacao`. Uma cobrança pode ter zero, um ou vários pagamentos (parcial + complemento depois, ou pagamento + estorno posterior como linha própria).

### Correção 2 — Prevenção de custos duplicados

Risco identificado: o custo de consumo do WhatsApp (quando `whatsapp_uso_mensal.custo` existir) poderia ser contado uma vez como "consumo" e de novo, separadamente, como uma linha digitada manualmente em `despesas` — duplicando o custo na rentabilidade. Corrigido com uma camada de reconciliação obrigatória para toda origem automática de custo:

- **`lancamentos_custo`** — única ponte entre qualquer origem automática de custo (hoje: WhatsApp; no futuro: outras integrações) e a despesa efetivamente contabilizada: `id`, `origem` (ex.: `whatsapp_consumo`, extensível), `empresa_id` (nulo se compartilhado), `competencia`, `identificador_externo` (id no provedor/origem, quando houver), `valor`, `situacao` (`pendente`/`lancado`/`ignorado_duplicado`/`estornado`), `referencia_origem_id` (aponta para o registro de consumo de origem, ex.: `whatsapp_uso_mensal.id`), `despesa_id` (nulo até virar de fato uma linha em `despesas`; preenchido quando `situacao='lancado'`), `criado_em`.
- **Proteção contra duplicidade**: `UNIQUE (origem, identificador_externo) WHERE identificador_externo IS NOT NULL`, e `UNIQUE (origem, empresa_id, competencia) WHERE origem <> 'manual'` — uma tentativa de lançar o mesmo consumo agregado da mesma empresa na mesma competência falha em vez de duplicar.
- **Fluxo**: uma RPC de "lançar custos do período" varre as origens automáticas, tenta inserir em `lancamentos_custo` (protegido pelas UNIQUEs acima) e só então cria a `despesa` correspondente, vinculando `despesa_id`. Despesas **manuais** continuam indo direto para `despesas`, sem passar por esta camada — o risco que esta correção resolve é o de origens automáticas/repetíveis, não o de digitação manual isolada.
- Se o provedor corrigir um valor já lançado, o tratamento é **estorno do lançamento anterior + novo lançamento**, nunca `UPDATE` do valor já contabilizado — mesma filosofia de auditoria usada em `pagamentos`.

### Correção 3 — Rateio proporcional a dias-empresa

`regras_rateio.metodo` passa a ter `dias_empresa` como **primeiro método recomendado e padrão inicial** (o rateio igualitário simples fica só como alternativa, não como padrão):

1. Para a competência, calcular `dias_ativos` de cada empresa = dias do mês em que a assinatura da empresa esteve numa situação elegível (recomendação inicial: `ativa` e `inadimplente` contam, `teste`/`suspensa`/`cancelada` não contam — **regra de negócio a confirmar explicitamente quando o Incremento 3.7 começar**, não decidida agora).
2. `total_dias_empresa` = soma de `dias_ativos` de todas as empresas na competência.
3. `custo_compartilhado_do_periodo` = soma de `despesas` com `empresa_id IS NULL` (incluindo custos automáticos compartilhados via `lancamentos_custo`) na competência.
4. `parcela_da_empresa` = `custo_compartilhado_do_periodo × (dias_ativos_da_empresa ÷ total_dias_empresa)`.
5. `dias_ativos` é derivado por sobreposição de intervalo sobre `assinaturas_historico.vigente_desde/vigente_ate` — por isso a Correção 1 (intervalos explícitos, fechados pela própria RPC) é pré-requisito direto desta correção.

`regras_rateio.parametros` (jsonb) guarda a configuração de cada método (ex.: quais situações contam como "dias ativos"; pesos por plano no futuro `proporcional_plano`) — a arquitetura já nasce permitindo os métodos futuros (`proporcional_plano`, `proporcional_consumo`) sem alterar o schema, só o valor de `metodo` e o conteúdo de `parametros`.

**Risco técnico adicional identificado nesta correção**: divisão proporcional gera resíduo de arredondamento (centavos) que pode não fechar exatamente o total da despesa compartilhada. A RPC de rateio precisa absorver esse resíduo de forma determinística para que a soma das parcelas sempre feche exatamente com o valor original — detalhe a especificar tecnicamente no Incremento 3.7.

### Correção 4 — Separação dos indicadores financeiros

Glossário fixado (vale para toda tela e toda RPC deste módulo, sem exceção):

| Indicador | Definição | Fonte |
|---|---|---|
| **MRR contratado** | Soma do valor de plano vigente das assinaturas em situação elegível na data de referência — valor de **contrato**, não fluxo de caixa | `assinaturas` + `planos_historico_precos` |
| **Receita prevista** | Soma de `cobrancas.valor_previsto` da competência — o que **deveria** ser cobrado | `cobrancas` |
| **Valor faturado** | Soma de `cobrancas.valor_faturado` — o que foi **efetivamente emitido** (pode divergir do previsto por desconto/proração) | `cobrancas` |
| **Valor recebido** | Soma de `pagamentos.valor_recebido` menos estornos, vinculados a cobranças da competência — dinheiro que **realmente entrou** | `pagamentos` |
| **Valores pendentes** | Cobranças faturadas/previstas sem pagamento suficiente e **ainda dentro do vencimento** | `cobrancas` + `pagamentos` |
| **Inadimplência** | Cobranças **vencidas** sem pagamento suficiente — distinto de "pendente" | `cobrancas` + `pagamentos` |
| **Resultado operacional** | Receita recebida − custo total (direto + compartilhado rateado) — rentabilidade **antes** de taxas/impostos | `pagamentos` + custos |
| **Resultado líquido** | Resultado operacional − taxas de pagamento − impostos | idem + `pagamentos.taxa_pagamento` |
| **Margem líquida** | Resultado líquido ÷ receita recebida × 100 | derivado |

**Regra explícita, sem exceção**: nenhuma tela ou RPC pode apresentar "valor previsto" ou "valor faturado" rotulado como "recebido" — os três são sempre exibidos separadamente, nunca somados como se fossem equivalentes.

### Outros riscos identificados nesta revisão

- **Divergência entre competências**: despesa/pagamento registrado num mês pode se referir a uma competência diferente (ex.: despesa paga em outubro, competência setembro). Todo agregado **deve agrupar por `competencia`**, nunca pela data do evento (`data_pagamento`/`criado_em`/`recebido_em`).
- **Fechamento mensal x lançamento tardio**: se uma despesa/cobrança de uma competência já fechada em `resultados_mensais` for lançada/corrigida depois, o mês fechado **não muda sozinho** — precisa de uma ação administrativa explícita e auditável de "reabrir e refechar o mês", nunca recálculo automático silencioso.
- **Divisão por zero no rateio**: se não houver nenhum dia-empresa no período, a RPC de rateio não pode dividir por zero — precisa tratar como "sem rateio possível neste período", nunca falhar sem tratamento nem retornar valor inventado.
- **Identidade de empresa x identidade de assinatura**: a "identidade permanente" da Correção 1 vale por `empresa_id`. Uma empresa que realmente encerra e depois é recriada como cadastro novo (novo `empresas.id`, fluxo normal de onboarding) gera, por definição, uma nova assinatura — isso não é o caso que a Correção 1 evita (fechar/reabrir artificialmente a assinatura da **mesma** empresa).

### Decisões aprovadas para este momento

- Planos, assinaturas, cobranças, pagamentos, despesas e rentabilidade serão administrados **somente pelo Painel Administrativo Central** nesta fase.
- **Futuramente**, cada empresa poderá consultar somente o próprio plano e as próprias cobranças, por RPC específica e segura (filtrada pela própria empresa) — não implementado agora; arquitetura já compatível (RPC `SECURITY DEFINER` gated pelo vínculo ativo do usuário com a própria empresa, sem policy aberta).
- Nenhum acesso a dado financeiro operacional interno dos estabelecimentos (reforça a "Restrição fundamental" já registrada nesta fase, ver abaixo).
- Nenhum dado fictício será exibido como se fosse real em nenhuma tela deste módulo.
- WhatsApp só entra **depois** da futura integração de mensagens (Fase 7) existir de fato.

### Ordem de trabalho registrada (nenhum item iniciado)

1. Validar e publicar **separadamente** o redesenho visual já existente do `Torque-Admin`.
2. Consultar o esquema real de `empresas` no Supabase, **sem alteração** — confirmar colunas hoje desconhecidas (data de criação, nicho) antes de desenhar a migração do Incremento 3.1.
3. Incremento 3.1 — Visão Geral, somente com dados reais.
4. Incremento 3.2 — Catálogo e histórico de preços dos planos.
5. Incremento 3.5 — Despesas.
6. Incremento 3.3/3.4 — Assinaturas (modelo corrigido acima), histórico, cobranças e pagamentos.
7. Incremento 3.6 — Rateio (método `dias_empresa`), custos e rentabilidade.
8. Incremento 3.7 — Fechamento mensal.
9. Incremento 3.8 — Métricas de WhatsApp, somente depois da integração de mensagens (Fase 7) existir.

### Ponto exato de retomada

🔵 **O próximo passo NÃO é o Incremento 3.1.** É revisar e publicar **separadamente** o redesenho visual já existente e aprovado localmente do `Torque-Admin` (identidade escura/laranja, navegação lateral, indicadores do Onboarding — ainda pendente de commit/push em `Blast019/torque-admin`, sem nenhuma dependência do modelo financeiro acima). Só depois dessa publicação, retomar pelo passo 2 da ordem de trabalho acima (consulta ao esquema real de `empresas`).

## Checkpoint de 11/09/2026 — Teste real do painel aprovado; painel transferido para repositório próprio

🟢 **Teste manual real do Incremento 2.2 aprovado pelo usuário. Painel administrativo transferido do repositório Torque para o repositório público separado `Blast019/torque-admin`** (criação e publicação desse repositório é uma etapa própria, registrada junto com este checkpoint).

**Teste real aprovado pelo usuário** (login manual com a conta administrativa de bootstrap, contra o Supabase de produção, sem nenhuma automação/mock):
- Login como administrador ativo: **aprovado**.
- Listagem real das autorizações de onboarding (via `admin_listar_autorizacoes_onboarding`): **aprovada**.
- Operação real de autorizar/renovar por e-mail (via `admin_autorizar_onboarding`): **aprovada**.
- Operação real de revogar autorização pendente (via `admin_revogar_autorizacao_onboarding`): **aprovada**.
- Datas exibidas no painel (`formatarDataHora`) ajustadas para usar explicitamente `timeZone: 'America/Sao_Paulo'` (mantendo locale `pt-BR`, `dateStyle`/`timeStyle` `short`) — confirmado antes do teste real.

**Painel transferido para repositório próprio**: o frontend administrativo, antes em `painel-admin/` dentro deste repositório (Torque), foi movido (copiado com verificação de hash SHA-256 dos quatro arquivos antes de remover a origem, depois removido daqui) para `C:\Users\weverson.silva\Documents\Torque-Admin`, que se tornou o repositório Git público `Blast019/torque-admin`, com o objetivo de publicar `admin.torque.tec.br` separado do sistema usado pelas empresas clientes (`torque.tec.br`). A partir deste checkpoint, `painel-admin/` **não existe mais** neste repositório — o desenvolvimento do painel administrativo continua exclusivamente em `Blast019/torque-admin`. Detalhes de publicação (Pages, DNS, Cloudflare) ficam registrados no repositório novo, não aqui.

## Checkpoint de 11/09/2026 — Incremento 2.1 executado; Incremento 2.2 iniciado

🟢 **Incremento 2.1 EXECUTADO NO SUPABASE. Incremento 2.2 EM ANDAMENTO (frontend mínimo criado localmente, nada publicado).**

**Incremento 2.1 executado**: `qa/fase-5/scripts/admin-01-fundacao-administradores-plataforma.sql` (versão revisada e aprovada — ver seção abaixo) foi executado com sucesso no banco de produção. `public.administradores_plataforma` e as quatro RPCs (`sou_administrador_plataforma`, `admin_listar_autorizacoes_onboarding`, `admin_autorizar_onboarding`, `admin_revogar_autorizacao_onboarding`) estão ativas.

**Bootstrap do primeiro administrador executado** (`admin-03-bootstrap-primeiro-administrador.sql`, procedimento manual — não commitado com nenhum valor real, como já documentado): identidade exclusiva da plataforma, sem nenhum vínculo em `usuarios_empresas`.
- `administradores_plataforma.id`: `69caf91b-7102-4631-9614-bb47b1f312ab`
- `user_id` (`auth.users.id`): `8c440421-a211-4a92-9a54-e5c39ddb385a`
- E-mail: `weversonantonio27+admintorque@gmail.com`
- `ativo`: `true`
- `concedido_por`: `null` (nenhum administrador anterior — primeiro bootstrap)
- `concedido_em`: `2026-09-11 01:11:14.039112+00`

**Defeito encontrado e corrigido antes do Incremento 2.2** (correção do convite sem autorização): o convite `type=invite` dessa própria conta administrativa revelou uma presunção incorreta no handler de "Defina sua senha" em `script.js` — depois de salvar a senha, `tipoFluxoAuthAtual === 'invite'` levava **sempre** direto a "Cadastrar empresa" (`abrirTelaEmpresaAutorizada()`), sem checar `existe_autorizacao_onboarding_pendente()`. Isso presumia que todo convite (incluindo um convite administrativo, sem nenhuma autorização em `autorizacoes_onboarding`) autoriza criar empresa — incorreto. **Corrigido** em `script.js` (handler do botão `definirSenhaSubmitBtn`, ramo `tipoFluxoAuthAtual === 'invite'`): agora consulta `existe_autorizacao_onboarding_pendente()` (mesmo padrão já usado em `iniciarApp()`) e só abre "Cadastrar empresa" se houver autorização pendente; caso contrário, mostra "Sem vínculo". O fluxo já aprovado do usuário `+convitetorque` (convite empresarial, com autorização) é preservado — a checagem sempre retorna `true` para ele. Nenhuma alteração de banco/RPC foi necessária. Validado por teste mockado local (ver "Incremento 2.2" abaixo).

**Incremento 2.2 iniciado** — frontend mínimo do Painel Administrativo Central, ainda **100% local, nada publicado**:
- **Parte A (correção no Torque atual)**: `script.js` corrigido conforme o defeito acima. Nenhuma alteração em `index.html`, banco ou RPCs.
- **Parte B (painel administrativo local)**: novo projeto frontend em `painel-admin/` (dentro deste mesmo repositório, por enquanto — sem repositório remoto, sem DNS, sem Cloudflare, sem `CNAME` próprio, conforme decidido). Estrutura simples HTML/CSS/JS, sem framework/build, compatível com GitHub Pages, reusando a mesma URL pública e a mesma anon key do Supabase já usadas pelo site principal (nunca `service_role`). Implementa: login; verificação exclusiva via `sou_administrador_plataforma()` (bloqueio + logout automático para quem não é administrador ativo); listagem via `admin_listar_autorizacoes_onboarding()` com filtros (pendente/consumida/expirada/revogada/todas); formulário de autorizar/renovar por e-mail (72 horas, `admin_autorizar_onboarding()`); revogação com confirmação (`admin_revogar_autorizacao_onboarding()`); aviso fixo de que o envio do convite continua manual pelo Supabase até o Incremento 2.3; layout responsivo; nenhum link ou acesso a dado operacional de empresa cliente.
- **Arquivos criados**: `painel-admin/index.html`, `painel-admin/style.css`, `painel-admin/script.js`, `painel-admin/config.js`.
- **Validação**: `node --check` sem erros em `script.js` (site principal) e em `painel-admin/script.js`. Testes locais mockados (Playwright + stub de `supabase-js`, sem nenhuma chamada real ao Supabase) cobrindo: convite empresarial com autorização (→ Cadastrar empresa, preservado); convite administrativo sem autorização (→ Sem vínculo, defeito corrigido); administrador ativo (→ painel); usuário autenticado não administrador (→ bloqueio + logout); listagem e os quatro filtros; autorizar (criação) e autorizar de novo o mesmo e-mail (renovação idempotente); revogação (com confirmação). Todos os cenários passaram.
- **Pendente para publicar** (fora do escopo desta etapa, decisões represadas para o momento da publicação): criar o repositório remoto para `painel-admin/` (ou decidir manter no mesmo repositório do site principal, com publicação separada), configurar DNS/Cloudflare para `admin.torque.tec.br`, e só então criar o `CNAME` desse novo site — nada disso foi feito aqui.

## Checkpoint de 11/09/2026 — Início do Incremento 2.1: fundação de administradores da plataforma

🟢 **EXECUTADO NO SUPABASE em 11/09/2026** (ver checkpoint acima). Descrição original da proposta, mantida como registro histórico: Após a conclusão e publicação do Incremento 1, o usuário aprovou o próximo passo do Painel Administrativo Central: eliminar o procedimento manual de autorização de onboarding hoje feito pelo SQL Editor/Authentication do Supabase, substituindo-o por um painel próprio. Esse trabalho foi dividido em três incrementos:

- **Incremento 2.1** (este) — fundação no banco: tabela de administradores da plataforma e RPCs de gestão de autorizações. **Sem frontend, sem administrador cadastrado, sem execução no Supabase.**
- **Incremento 2.2** — frontend do painel e hospedagem em `admin.torque.tec.br` (exige um segundo repositório/site do GitHub Pages e um novo registro DNS no Cloudflare, já que o GitHub Pages não hospeda dois domínios personalizados a partir do mesmo repositório) — fica para depois deste incremento.
- **Incremento 2.3** — Edge Function do Supabase para envio automático de convite (`inviteUserByEmail`, que exige `service_role` e só pode rodar no servidor) — autorizada conceitualmente pelo usuário, chave secreta exclusivamente no ambiente servidor, implementação fica para depois do 2.2.

**Investigação de acoplamento (regra 7 de `qa/ARQUITETURA-MULTINICHO.md`), escopo restrito a este incremento**: as estruturas efetivamente tocadas por este incremento (`auth.users`, a já existente `autorizacoes_onboarding`, e a nova `administradores_plataforma`) são genéricas, sem nenhum campo específico de segmento, e não acessam nenhuma tabela operacional de empresa cliente (clientes, veículos, ordens de serviço, financeiro, etc.). **Conclusão: sem bloqueio para esta fundação administrativa.** Isso não é uma conclusão sobre o acoplamento do restante do sistema (textos de interface, nomenclaturas de módulos futuros e demais áreas continuam pendentes de uma investigação completa antes do resto da Fase 5) — apenas confirma que esta fundação específica, por não tocar em nenhuma estrutura operacional, pode prosseguir.

**Arquivos criados nesta etapa** (todos como proposta, nada executado no Supabase):
- `qa/fase-5/scripts/admin-01-fundacao-administradores-plataforma.sql` — cria `public.administradores_plataforma` (vínculo com `auth.users` por `user_id`, estado `ativo`/soft, dados mínimos de auditoria — `concedido_por`/`concedido_em`/`revogado_em`/`revogado_por` — nenhuma informação operacional de empresa cliente; constraint `administradores_plataforma_revogacao_consistente` exige `revogado_em`/`revogado_por` preenchidos sempre que `ativo = false`, e ambos nulos sempre que `ativo = true`) e quatro RPCs, todas `SECURITY DEFINER`/`SET search_path TO ''`/dono `postgres`: `sou_administrador_plataforma()` (verificação, retorna só boolean), `admin_listar_autorizacoes_onboarding(p_apenas_pendentes boolean)` (leitura, gated; com `true` mostra só pendentes ainda válidas — não expiradas —, expiradas só aparecem no histórico completo com `situacao = 'expirada'`), `admin_autorizar_onboarding(p_email text, p_horas_validade integer default 72)` (cria ou renova por e-mail, idempotente, mesma validade padrão de 72 horas já usada no procedimento manual), `admin_revogar_autorizacao_onboarding(p_autorizacao_id uuid)` (revoga somente autorização ainda pendente). **Não cadastra nenhum administrador.** Todas as cláusulas `RETURNING`/`WHERE` que poderiam colidir com os parâmetros de saída de `RETURNS TABLE` (ex.: `id`, `email`, `revogado_em`) foram explicitamente qualificadas com `public.autorizacoes_onboarding.<coluna>` para evitar ambiguidade.
- `qa/fase-5/scripts/admin-02-rollback-emergencial.sql` — reverte (via `DROP`) exatamente as quatro RPCs e a tabela acima; aborta com segurança se já existir qualquer administrador cadastrado (nesse caso, decidir separadamente antes de reverter). Não toca em `autorizacoes_onboarding` nem nas RPCs do Incremento 1.
- `qa/fase-5/scripts/admin-03-bootstrap-primeiro-administrador.sql` — procedimento manual separado (não é uma migração, não deve ser executado como bloco único) para conceder o primeiro administrador, com placeholders `<uuid-da-conta-candidata>` — **sem nenhum UUID ou e-mail fixo**. A conta candidata só é aceita se passar pelos três critérios genéricos: (1) existir em `auth.users`; (2) não ter nenhuma linha em `usuarios_empresas`, ativa ou inativa; (3) ainda não estar em `administradores_plataforma`.

**Códigos TRQ novos** (confirmados livres por leitura de todos os `.sql` do projeto antes de escolher — mesma auditoria que corrigiu a colisão TRQ51/TRQ54 no Incremento 1): `TRQ61 nao_autenticado`, `TRQ62 sem_permissao_administrativa`, `TRQ63 entrada_invalida`, `TRQ64 nao_encontrado`, `TRQ65 conflito_dados`.

**Restrições respeitadas nesta etapa**: nenhum SQL foi executado; nenhuma alteração em Supabase/Auth; nenhum administrador cadastrado; nenhuma Edge Function criada; nenhum frontend ou novo repositório criado; `CNAME` não foi tocado; nenhum commit/push feito; o Incremento 1 não foi revisado novamente.

## Checkpoint de 10/09/2026 — Incremento 1: onboarding autorizado por convite (Alternativa A)

🟢 **CONCLUÍDO E PUBLICADO EM PRODUÇÃO (11/09/2026).** Esta seção consolida, por escrito, a Proposta Técnica v4 do Incremento 1, a auditoria de pré-implementação, o SQL de migração e rollback, a implementação do frontend, o defeito encontrado e corrigido, e a conclusão oficial da validação (ver "Conclusão oficial" logo abaixo).

### Conclusão oficial — Incremento 1 concluído e publicado (11/09/2026)

🟢 **INCREMENTO 1 CONCLUÍDO E PUBLICADO EM PRODUÇÃO.** As três validações previstas foram executadas e aprovadas.

**Validação 1 de 3 — frontend local**: ✅ aprovada (ver seção detalhada abaixo).

**Validação 2 de 3 — migração no Supabase**: ✅ executada com sucesso.
- `qa/fase-5/scripts/onboarding-01-migracao-autorizacao.sql` aplicada no banco de produção.
- **Site URL** configurada como `https://torque.tec.br`.
- **Redirect URL** configurada como `https://torque.tec.br/**`.
- `INSERT` direto em `public.empresas` e `public.usuarios_empresas` confirmado **bloqueado** para `anon` e `authenticated` (só `criar_empresa_autorizada`, `SECURITY DEFINER`, continua como via de escrita).

**Defeito real encontrado no primeiro teste (dispositivo real)**: o convite abriu diretamente a tela de cadastro da empresa, **pulando a definição de senha**. Causa raiz: o SDK do Supabase consumia/limpava o marcador `type=invite` da URL antes da leitura tardia feita pelo frontend (`onAuthStateChange` registrado só no fim do arquivo) — detalhamento completo já registrado na seção "Defeito encontrado na Validação 3 de 3 e correção" logo abaixo.

**Correção publicada** (commit `ec01b94`): captura da URL movida para a primeira linha executável do arquivo (antes da criação do cliente Supabase) + proteção adicional independente da URL — uma sessão autorizada sem vínculo só pula direto para "Cadastrar empresa" quando chega pelo próprio formulário de login desta carga de página; qualquer sessão vinda do boot (armazenamento local ou link) sempre passa por "Defina sua senha" primeiro. Validação local direcionada aprovada nos 4 cenários (convite com `type=invite`, sessão sem `type` na URL, usuário normal com vínculo, recuperação de senha) — resultados já registrados na seção "Defeito encontrado..." abaixo.

**Validação 3 de 3 — teste real em celular, após a correção**: ✅ **APROVADA**. Confirmado que a definição de senha foi exigida antes da criação da empresa (sem repetir o defeito). Evidência real:
- E-mail: `weversonantonio27+convitetorque@gmail.com`
- Autorização (`autorizacoes_onboarding.id`): `2825ed30-5002-4559-b4a5-715227f6151b`
- Usuário criado (`auth.users.id`): `166e0c8d-ad66-4448-b959-3a586c8fab9d`
- Empresa criada (`empresas.id`): `79225aa6-87bc-4d03-a023-35304145e60f`
- Nome da empresa: `QA convite 2026-09-11`
- `consumido_em`: `2026-09-11 00:08:10.426463+00`
- Papel do vínculo: `proprietario`, `ativo = true`
- `revogado_em`: `null`

**Preservação da evidência**: a conta e a empresa QA criadas neste teste real **foram preservadas** (nenhuma exclusão) como evidência de regressão, até uma decisão futura de limpeza — não excluir sem autorização explícita separada.

### Defeito encontrado na Validação 3 de 3 e correção (10/09/2026)

🚨 **DEFEITO REAL, ENCONTRADO EM PRODUÇÃO (commit `7b59054`), CORRIGIDO LOCALMENTE — correção ainda não commitada.**

**Sintoma**: ao abrir o convite real pelo navegador interno do Gmail (celular), o Supabase autenticou a conta, mas o frontend abriu direto a tela "Cadastrar empresa", **pulando "Defina sua senha"**. Confirmado que a autorização não foi consumida e nenhuma empresa foi criada (ninguém clicou em "Criar empresa").

**Causa raiz**: a função que lia `type=invite`/`type=recovery` da URL (`extrairTipoAuthDaUrl()`) só era chamada **depois** de `onAuthStateChange` disparar. O próprio SDK do Supabase (`detectSessionInUrl`, padrão) processa e **limpa o fragmento da URL como parte da sua própria inicialização assíncrona**, ao construir o cliente — isso pode acontecer antes do nosso `onAuthStateChange` sequer ser registrado (só ocorre no fim do arquivo). Quando isso acontece, `location.hash` já está vazio no momento da checagem, `tipo` vem `null`, e o código caía direto em `iniciarApp()` — que, com zero vínculos e autorização pendente, abria "Cadastrar empresa" sem exigir senha. O navegador interno do Gmail (conhecido por processar/recarregar links antes da abertura real) agrava a chance disso acontecer, mas a causa é a ordem de leitura da URL em relação ao processamento assíncrono do próprio SDK — não um comportamento exclusivo do Gmail.

**Correção aplicada em `script.js` (2 camadas):**
1. **Captura da URL movida para a primeira linha executável do arquivo** (`const URL_AUTH_INICIAL = ...`, antes de `sb = window.supabase.createClient(...)`) — lida de forma síncrona, imune a qualquer limpeza posterior do SDK.
2. **Rede de segurança independente da URL**: `iniciarApp()` passou a receber um parâmetro `viaLoginForm`. A tela "Cadastrar empresa" só abre diretamente quando a sessão foi estabelecida **pelo próprio formulário de login nesta carga de página** (login normal, ou "Defina sua senha" no fluxo de recuperação — provas de que a pessoa digitou uma senha real). Qualquer sessão vinda do boot (armazenamento local ou link, sem o formulário) sempre passa por "Defina sua senha" primeiro — mesmo que `type=invite` já tenha desaparecido por completo da URL.

**Efeito colateral aceito, documentado**: um usuário existente muito raro (com vínculo zerado por remoção, depois reautorizado, reabrindo uma aba com sessão persistida) passaria por "Defina sua senha" mesmo já tendo uma senha válida — inconveniente de UX, não uma falha de segurança (redefinir a mesma senha é inofensivo). Priorizado deliberadamente sobre o risco de pular a definição de senha.

**Testes locais executados (100% mockado — sem SQL, sem convite real, sem consumir autorização):**

| Cenário | Esperado | Resultado |
|---|---|---|
| Convite com `type=invite` na URL | `definirSenhaScreen` visível | ✅ |
| **Sessão sem `type=invite` na URL (reproduz o defeito relatado)** | `definirSenhaScreen` visível (não mais "Cadastrar empresa" direto) | ✅ **confirma a correção** |
| Usuário normal, com vínculo | `appScreen` visível, sem passar por telas novas | ✅ |
| Recuperação de senha (`type=recovery`) | `definirSenhaScreen` visível | ✅ |

Testado com `node --check script.js` (sintaxe válida) e um cliente Supabase simulado via Playwright (nenhuma chamada real de rede, `criar_empresa_autorizada`/`updateUser` nunca invocados de fato). Limitação do método de teste: não foi possível ler `tipoFluxoAuthAtual` de fora do script (variável `let` de topo de nível não fica exposta em `window`) — a confirmação foi feita pela tela efetivamente exibida em cada cenário, que já reflete corretamente esse valor internamente.

**Pendências**: correção ainda não commitada nem publicada — depende da sua revisão. Depois de aprovada, é necessário reexecutar a Validação 3 de 3 com um convite real para confirmar a correção em produção.

### Validação 1 de 3 — frontend local (10/09/2026) — ✅ APROVADA

Executada com `npx serve -l 53170 .` (mesmo procedimento do projeto) + Playwright (Chrome do sistema) para desktop (1440×900) e mobile (390×844). Nenhum SQL executado, nenhum convite enviado, nenhuma empresa criada, nenhuma senha salva — só login normal de uma conta QA já existente (`QA_EMAIL_PROPRIETARIO`).

**Cenário A — tela pública**: ✅ só "Entrar" aparece, "Criar conta" ausente (0 ocorrências, `#authToggle` inexistente no DOM), campos de e-mail/senha e botão alinhados, em desktop e mobile. Confirmado por screenshot.

**Cenário B — login existente**: ✅ login de `PROP_A` bem-sucedido; empresa carregada ("QA Fase 2.5 - Empresa A"); sidebar, navegação entre abas (Painel ↔ Clientes) e logout funcionando, em desktop e mobile. Sequência de rede do boot confirmada como única (sem duplicação): `auth/v1/token` → `auth/v1/user` → `usuarios_empresas` → `rpc/existe_autorizacao_onboarding_pendente` → (logout) `auth/v1/logout`. **`existe_autorizacao_onboarding_pendente` ainda não existe no banco atual** (migração não executada) — a chamada falha, é capturada pelo `try/catch`, e `#novaEmpresaConfigBtn` permanece oculto (`novaEmpresaConfigBtnHidden: true`), exatamente como esperado; o restante do fluxo (carregamento da empresa, navegação, logout) não foi afetado.

**Cenário C — novas telas, só inspeção visual**: ✅ `#definirSenhaScreen` e `#empresaAutorizadaScreen` exibidas via remoção manual da classe `hidden` no Console (sem clicar em nenhum botão de submit) — campos, botões e responsividade corretos em desktop e mobile, sem elementos sobrepostos. Confirmado por screenshot nas 4 combinações (2 telas × 2 viewports).

**Console**: nenhum erro relacionado a este incremento. Único registro: `Failed to load resource: 404`, idêntico em todas as passagens (inclusive na tela pública, antes de qualquer login/RPC) — consistente com o `favicon.ico` ausente, já documentado como ocorrência pré-existente e fora de escopo em auditoria anterior desta mesma sessão.

**Network**: ✅ zero chamadas a `criar_empresa_com_vinculo`/`criar_nova_empresa_com_vinculo` em toda a validação; ✅ zero chamadas a `criar_empresa_autorizada` durante o Cenário C (nenhuma ação disparada); ✅ nenhuma chamada duplicada de inicialização (sequência de boot única, confirmada acima).

**Resultado: APROVADA — nenhum erro funcional ou visual encontrado. Nenhuma correção necessária nesta etapa.**

### Atualização do checkpoint — rollback e frontend local (10/09/2026)

**O que foi feito nesta rodada:**

- **Correção documental**: a afirmação de que `criar_empresa_autorizada` seria o "único caminho de escrita legítimo" nas duas tabelas foi corrigida (ver seção "Endurecimentos" abaixo) — ela é o único caminho para **criar empresa nova**; as RPCs de gerenciamento de vínculos da Fase 4 (`incluir_usuario_empresa`, `alterar_papel_usuario_empresa`, `remover_usuario_empresa`) continuam sendo os caminhos legítimos para vínculos em empresas já existentes, sem nenhuma alteração.
- **`qa/fase-5/scripts/onboarding-02-rollback-emergencial.sql`** (novo) — reverte só o `EXECUTE` das RPCs de criação de empresa (restaura as duas antigas, revoga a nova e a auxiliar), sem apagar tabela/autorização/dado, sem restaurar `INSERT` direto. **Não executado.**
- **Frontend implementado localmente** (`index.html`, `script.js`) — cadastro público removido; detecção de `type=invite`/`type=recovery` via `onAuthStateChange` (`INITIAL_SESSION`/`PASSWORD_RECOVERY`), sem logar sessão/tokens, com limpeza da URL após estabelecer a sessão; tela "Defina sua senha" (`sb.auth.updateUser`); tela de cadastro da empresa autorizada (`criar_empresa_autorizada`, com `p_empresa_id` gerado uma única vez e reaproveitado em retry, proteção contra duplo clique, mensagens para `TRQ56`-`TRQ60`); fluxo "Sem vínculo" agora consulta `existe_autorizacao_onboarding_pendente()` antes do estado definitivo; botão "+ Nova empresa" (usuário já com vínculo) passa a depender dessa mesma autorização em vez do papel `proprietario`, chamando `criar_empresa_autorizada` sem `p_empresa_origem_id`.

**Testes locais realizados:**
- `node --check script.js` — sintaxe válida.
- Busca textual confirmando que `criar_empresa_com_vinculo`/`criar_nova_empresa_com_vinculo` não são mais chamadas no fluxo novo (a única ocorrência restante de `criar_empresa_com_vinculo` é o `finalizarCadastroPendente()` legado, inalterado, hoje inatingível para contas novas por não existir mais cadastro público — mantido só para não quebrar uma eventual conta pré-existente com `pending_empresa=true`).
- Busca textual confirmando as novas chamadas (`criar_empresa_autorizada` ×2, `existe_autorizacao_onboarding_pendente` ×2, `updateUser({ password })` ×1) e a ausência total de `authToggleLink`/`modoCadastro`/`alternarModoAuth`/campos de cadastro antigos em `index.html` e `script.js`.
- `git diff --check` — sem erros de whitespace.
- **Não foi feito**: nenhum teste real no navegador (`npx serve` + clique manual), nenhuma execução de SQL, nenhum convite real enviado.

**Correção (10/09/2026) — pendência da chamada legada eliminada:** `finalizarCadastroPendente()` e `mostrarErroRpcCadastro()` foram **removidas** (ficaram sem uso, código morto apontando para RPC revogada). O ramo `vinculos.length === 0` de `iniciarApp()` foi unificado: `pending_empresa` (metadata de um cadastro antigo, anterior a este incremento) deixou de autorizar sozinho a criação de empresa — agora, em qualquer caso (com ou sem metadata pendente), a única via é `existe_autorizacao_onboarding_pendente()` + `criar_empresa_autorizada`. Quando há metadata antiga, ela só é usada para **pré-preencher** o formulário (`abrirTelaEmpresaAutorizada(metadata)`); se não houver autorização válida, nenhuma empresa é criada, mesmo com metadata pendente presente. A limpeza best-effort da metadata (`pending_empresa=false` etc.) passou a rodar só **depois** do sucesso confirmado de `criar_empresa_autorizada`, nunca antes — uma falha nessa limpeza não desfaz a criação nem causa duplicidade num retry (idempotência preservada pelo mesmo `p_empresa_id`, já garantida pela RPC).

- **Nova busca confirmada**: zero ocorrências de `sb.rpc('criar_empresa_com_vinculo'` ou `sb.rpc('criar_nova_empresa_com_vinculo'` em `index.html`/`script.js` — a única menção textual restante é um comentário explicativo (não uma chamada).

**Pendências:**
- Executar a migração (`onboarding-01-migracao-autorizacao.sql`) em ambiente controlado.
- Configurar a URL de redirecionamento do convite na allowlist do Supabase.
- Testar o convite administrativo real, ponta a ponta (Dashboard → "Add user → Send invitation").
- Teste manual no navegador do fluxo completo (login existente, convite/senha/empresa, "+ Nova empresa" com autorização).
- Só depois disso, avaliar a etapa separada de desativar "Allow new users to sign up" (com evidência e rollback próprios, conforme já registrado).

**Estado do Git nesta atualização:**
```
branch: main, HEAD = origin/main = 89380e95bf0bc3302664e2bff0a9adb844952210 (antes desta rodada)
Modificados (working tree, nada staged): CNAME (pré-existente), index.html, script.js, qa/fase-5/STATUS.md
Novo (não rastreado): qa/fase-5/scripts/ (migração 01 + rollback 02)
Nenhum git add, commit ou push executado.
```

### Estado do Git auditado em 10/09/2026 (auditoria de pré-implementação original)

```
branch: main
HEAD = origin/main = 89380e95bf0bc3302664e2bff0a9adb844952210
Modificado: só CNAME (pré-existente, fora de escopo)
Staged: nenhum arquivo
```

### Direção arquitetural

Restringir a criação de qualquer empresa nova (primeiro cadastro ou empresa adicional) a um **portão único de autorização administrativa da plataforma**, usando o mecanismo nativo de convite do Supabase Auth (`inviteUserByEmail`) como prova de posse do e-mail para contas novas — **sem criar um token de convite próprio do Torque**, já que a sessão autenticada nativa (aceite de convite, ou login normal para quem já tem conta) já é prova suficiente.

### Achado crítico do frontend atual (confirmado por leitura de código, não presumido)

`script.js` tem um boot-time check (`sb.auth.getSession()`, linhas 126-127) que chama `iniciarApp()` direto se houver sessão — **sem nenhum tratamento de `onAuthStateChange`, `PASSWORD_RECOVERY`, `type=invite` ou `type=recovery`, e sem nenhuma tela de "Defina sua senha"**. O único `updateUser({...})` existente (linha 389) só limpa metadata de cadastro pendente, não define senha. **Se um convite nativo fosse aceito hoje, a pessoa cairia direto no estado "Sem vínculo", sem chance de definir senha ou preencher os dados da empresa.** Isso precisa ser construído como parte do Incremento 1, não presumido como "resolvido pelo Supabase".

### Modelagem de banco proposta (não executada)

**Tabela `autorizacoes_onboarding`** — só autorização administrativa + estado; não é um convite em si (o convite/prova de posse do e-mail é nativo do Supabase):

```sql
create table public.autorizacoes_onboarding (
  id                        uuid primary key default gen_random_uuid(),
  email                     text not null,
  autorizado_por            uuid not null references auth.users(id),
  autorizado_em             timestamptz not null default now(),
  expira_em                 timestamptz not null,
  consumido_em              timestamptz,
  consumido_por             uuid references auth.users(id),
  consumido_para_empresa_id uuid,
  revogado_em               timestamptz,
  revogado_por              uuid references auth.users(id),
  constraint autorizacoes_onboarding_email_normalizado check (email = lower(btrim(email))),
  constraint autorizacoes_onboarding_expira_apos_autorizado check (expira_em > autorizado_em)
);

create unique index autorizacoes_onboarding_email_pendente_uniq
  on public.autorizacoes_onboarding (email)
  where consumido_em is null and revogado_em is null;

alter table public.autorizacoes_onboarding enable row level security;
-- Sem nenhuma policy — nenhuma linha visível/gravável por anon/authenticated.
revoke all on public.autorizacoes_onboarding from public, anon, authenticated;
grant select, insert, update on public.autorizacoes_onboarding to service_role;
alter table public.autorizacoes_onboarding owner to postgres;
```

Pontos de design consolidados:
- **`email` normalizado por `CHECK`** (`email = lower(btrim(email))`) — o banco rejeita qualquer gravação não normalizada, não depende só de convenção manual.
- **Índice único parcial** (`WHERE consumido_em IS NULL AND revogado_em IS NULL`) — garante no máximo uma autorização pendente por e-mail, incluído desde a implantação (não fica para depois). Consequência: o procedimento de emissão é **obrigado** a revogar qualquer pendência expirada do mesmo e-mail antes de inserir uma nova, ou o `INSERT` falha por violação de unicidade.
- **`consumido_para_empresa_id`** — corrige uma falha crítica encontrada na v3: sem essa coluna, o mesmo usuário poderia consumir a autorização uma vez e depois criar empresas adicionais ilimitadas com `p_empresa_id` diferentes. Com ela, o replay só é aceito quando **autorização, usuário e `p_empresa_id` são todos iguais** à primeira consumação.
- Sem `citext`, sem extensão nova, sem `CHECK` fixando um UUID de operador (ver seção de procedimento manual abaixo).

### RPCs propostas (não executadas)

**`criar_empresa_autorizada(p_empresa_id uuid, p_nome_empresa text, p_cnpj_empresa text, p_telefone_empresa text)`** — substitui as duas RPCs existentes (`criar_empresa_com_vinculo` e `criar_nova_empresa_com_vinculo`), eliminando o conceito de "empresa de origem" (a autorização por e-mail passa a ser o único portão, independente de vínculos existentes em outras empresas — preserva multiempresa). Lógica central:
1. Autenticação (`TRQ56` se `auth.uid()` nulo).
2. Validação de entrada (`TRQ57`).
3. Consumo atômico e idempotente da autorização, por e-mail da sessão **e** `p_empresa_id`:
   ```sql
   update public.autorizacoes_onboarding
      set consumido_em = coalesce(consumido_em, now()),
          consumido_por = coalesce(consumido_por, v_usuario_id),
          consumido_para_empresa_id = coalesce(consumido_para_empresa_id, p_empresa_id)
    where email = v_email_atual
      and revogado_em is null
      and ( (consumido_em is null and expira_em > now())
            or (consumido_por = v_usuario_id and consumido_para_empresa_id = p_empresa_id) )
   returning id into v_autorizacao_id;
   -- v_autorizacao_id null => TRQ58 (sem_autorizacao)
   ```
4. Lock consultivo por usuário (mesmo padrão das demais RPCs do projeto).
5. Replay idempotente por `p_empresa_id` (mesmo dono + vínculo proprietário ativo correspondente) ou criação real (`INSERT` em `empresas` + `usuarios_empresas`).
6. `unique_violation` tratado por constraint específica via `GET STACKED DIAGNOSTICS` — o nome real da PK de `public.empresas` é descoberto dinamicamente pelo catálogo (`pg_catalog.pg_constraint`, `contype = 'p'`), nunca supondo o nome `empresas_pkey`; só classifica como `TRQ59` (id reutilizado) quando o nome descoberto coincide com o da constraint que disparou o erro. Se a PK não puder ser confirmada com exatidão, ou se for qualquer outra constraint de unicidade, cai em `TRQ60` (mensagem genérica, sem expor nome de constraint ao chamador) — falha sempre segura, nunca classifica como colisão de UUID sem confirmação.

`SET search_path = ''`, `SECURITY DEFINER`, owner `postgres`, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE` só para `authenticated`/`service_role`.

**`existe_autorizacao_onboarding_pendente()`** — RPC de leitura auxiliar, retorna só um `boolean` (sem dado sensível), para o frontend saber se deve oferecer "criar empresa autorizada" a um usuário já existente (que não passa pelo fluxo de convite, e por isso não tem outro jeito de descobrir isso, já que a tabela não é legível por `authenticated`).

**Códigos de erro — mapeamento final**: `TRQ56` nao_autenticado, `TRQ57` entrada_invalida, `TRQ58` sem_autorizacao, `TRQ59` operacao_nao_permitida (colisão de id), `TRQ60` conflito_dados (qualquer outra violação de unicidade).

**Por que TRQ56-TRQ60 e não TRQ50-TRQ54 (numeração original da Proposta v4)**: confirmado por leitura de **todos** os `.sql` do projeto que `TRQ51` já era usado como `nao_autenticado` e `TRQ54` já era usado como `entrada_invalida`, ambos por `public.listar_usuarios_empresa` (`qa/fase-4/scripts/permissoes-09-listar-usuarios-empresa.sql`, Fase 4.3) — com significados diferentes dos que a v4 pretendia. Para não colidir nem alterar o significado de um código já publicado, a numeração foi deslocada para o próximo bloco livre e sequencial (`TRQ56`-`TRQ60`), confirmado sem uso em nenhum outro script do projeto.

**Idempotência — regra final**: só é aceito como replay quando autorização, usuário **e** `p_empresa_id` coincidem todos com a primeira consumação bem-sucedida. Qualquer chamada do mesmo usuário com um `p_empresa_id` diferente, depois da autorização já consumida, é recusada (`TRQ58`).

### Endurecimentos adicionados após a auditoria estática do SQL (10/09/2026)

- **Normalização de e-mail com `lower(btrim(email))` nas duas RPCs** (`criar_empresa_autorizada` e `existe_autorizacao_onboarding_pendente`) — a versão inicial usava só `lower(email)` ao ler `auth.users.email`, inconsistente com o `CHECK` da tabela e o procedimento manual (ambos já usavam `lower(btrim(...))`). Corrigido para eliminar o risco, raro mas real, de um e-mail com espaço incidental nunca bater com a autorização gravada.
- **`REVOKE INSERT ON TABLE public.empresas` e `public.usuarios_empresas` de `anon, authenticated`**, incluído na mesma migração — fecha qualquer via de escrita **direta** (sem passar por nenhuma RPC) nessas duas tabelas que `anon`/`authenticated` pudessem ter recebido em alguma migração anterior. Só `INSERT` direto é revogado: `SELECT`, `UPDATE`, `DELETE` e os grants de `postgres`/`service_role` permanecem exatamente como estavam. Quatro consultas finais com `has_table_privilege` confirmam o resultado esperado (`false` para `INSERT` de `anon`/`authenticated` nas duas tabelas).
  - **Correção de precisão (10/09/2026)**: o `REVOKE INSERT` bloqueia só a inserção **direta** feita por `anon`/`authenticated` fora de qualquer RPC — nunca as RPCs `SECURITY DEFINER` legítimas, que continuam funcionando normalmente (rodam com o privilégio do dono `postgres`, não do chamador).
  - Para **`public.empresas`**: a criação de empresa nova passa **exclusivamente** por `criar_empresa_autorizada` (que substitui `criar_empresa_com_vinculo` e `criar_nova_empresa_com_vinculo` para esse fim).
  - Para **`public.usuarios_empresas`**: `criar_empresa_autorizada` só insere o vínculo `proprietario` inicial da empresa nova — **continuam existindo, sem nenhuma alteração**, as demais RPCs `SECURITY DEFINER` de gerenciamento de vínculos já publicadas na Fase 4 (`incluir_usuario_empresa`, `alterar_papel_usuario_empresa`, `remover_usuario_empresa`), que seguem sendo os caminhos legítimos para adicionar, alterar ou remover vínculos de usuários numa empresa já existente.

### Fechamento das RPCs antigas — sem janela vulnerável

Na **mesma migração** que cria a tabela e a nova RPC: `REVOKE EXECUTE` de `criar_empresa_com_vinculo(text,text,text)` e `criar_nova_empresa_com_vinculo(uuid,text,text,text,uuid)` do role `authenticated`. Isso aceita uma indisponibilidade temporária **só de criação de empresa** (nunca de login ou uso das empresas existentes) entre essa migração e a publicação do frontend novo — preferível a manter uma rota desprotegida via REST. O `DROP` definitivo das duas assinaturas fica para depois, como limpeza, quando já não há grant nenhum.

### Procedimento manual de autorização (sem painel, validade de 72 horas)

Sem `CHECK` fixando um UUID de operador (removido da v3 — decisão explícita) — a proteção real é a tabela ser totalmente inacessível a `anon`/`authenticated`. O procedimento inclui uma conferência visual do operador antes do `INSERT`:

```sql
-- 0) Conferir visualmente que o UUID é o do operador correto:
select id, email from auth.users where id = '<uuid do operador>';

-- 1) Revogar qualquer pendência expirada do mesmo e-mail (o índice único exige isso):
update public.autorizacoes_onboarding
   set revogado_em = now(), revogado_por = '<uuid do operador>'
 where email = lower(btrim('<email>')) and consumido_em is null and revogado_em is null and expira_em <= now();

-- 2) Inserir a nova autorização (validade proposta: 72 horas):
insert into public.autorizacoes_onboarding (email, autorizado_por, expira_em)
values (lower(btrim('<email>')), '<uuid do operador>', now() + interval '72 hours');
```

### Sequência consolidada de implantação

1. Migração única: tabela + índice + `CHECK`s + nova RPC + RPC de leitura auxiliar + `REVOKE EXECUTE` das RPCs antigas.
2. Publicar frontend novo (tratamento de `type=invite`/`type=recovery`, tela "Defina sua senha", chamada à nova RPC nos dois pontos, esconder "Criar conta").
3. **Configuração futura necessária**: adicionar a URL de onboarding à allowlist de redirect do Supabase (`Authentication → URL Configuration`) — sem isso, o `redirectTo` do convite é ignorado.
4. Testar convite administrativo real (Dashboard → "Add user → Send invitation"), ponta a ponta, com cadastro público ainda **ligado**.
5. Etapa separada, com evidência do estado anterior e rollback próprio: desativar "Allow new users to sign up".
6. Reconfirmar login de usuários existentes + recuperação de senha + convite administrativo, agora com o toggle desativado.
7. `DROP` de limpeza das RPCs antigas.

### Rollback

- Passo 1: reverter é reconceder `EXECUTE` das RPCs antigas a `authenticated` (a tabela/RPC nova pode continuar existindo, inofensiva, sem uso).
- Passo 5 (toggle de cadastro público): reverter é reativar o toggle — configuração, instantâneo, sem risco de perda de dado.

### Matriz final de QA (a executar somente após implementação e autorização)

| Cenário | Esperado |
|---|---|
| Chamada direta às 2 RPCs antigas, antes do `REVOKE` | ✅ Funcionam (baseline) |
| Mesma chamada, depois do `REVOKE` | 🚫 `42501 permission denied` |
| Cadastro público bloqueado (depois do passo 5) | 🚫 Erro em `signUp()` |
| Convite novo aceito, ponta a ponta | ✅ |
| Convite expirado / autorização expirada ou revogada | 🚫 `TRQ58` |
| Usuário existente, sem vínculo, autorizado (link simples) | ✅ |
| Definição de senha após convite | ✅ |
| Login de contas existentes (antes/depois de tudo) | ✅ Inalterado |
| Retry mesmo `p_empresa_id` | ✅ Idempotente |
| Retry com `p_empresa_id` diferente / 2ª empresa com autorização já consumida | 🚫 `TRQ58` |
| Duas chamadas simultâneas, UUIDs diferentes | Uma vence, a outra `TRQ58` |
| Nenhuma empresa/vínculo parcial gravado após qualquer rejeição | ✅ (transação única, `ROLLBACK` automático) |

### Arquivos candidatos e estado atual (atualizado em 10/09/2026)

- `qa/fase-5/scripts/onboarding-01-migracao-autorizacao.sql` — **criado e revisado estaticamente** (prechecks, DDL, as duas RPCs, os dois endurecimentos acima, `REVOKE EXECUTE` das RPCs antigas, consultas finais de verificação). **Migração ainda NÃO executada em nenhum banco.**
- `index.html` — candidato, **ainda não alterado**: tela "Defina sua senha", formulário de dados da empresa pós-convite, remoção do link "Criar conta".
- `script.js` — candidato, **ainda não alterado**: tratamento de `type=invite`/`type=recovery`, chamada à nova RPC nos dois pontos de entrada, affordance para usuário existente via `existe_autorizacao_onboarding_pendente()`.

**Estado atual, por completo**:
- Arquivo SQL criado e revisado estaticamente (auditoria de leitura, sem execução).
- Migração ainda **NÃO executada** em nenhum banco/ambiente.
- Frontend (`index.html`/`script.js`) ainda **NÃO alterado**.
- As duas RPCs antigas (`criar_empresa_com_vinculo`, `criar_nova_empresa_com_vinculo`) **continuam funcionando normalmente** no banco atual, sem nenhuma restrição — nada mudou em produção.
- Nenhum convite foi enviado, nenhum e-mail foi autorizado de verdade.
- **A migração não deve ser executada antes de o frontend novo estar preparado e o procedimento de rollback estar claro** — executar a migração isolada já revoga `EXECUTE` das RPCs antigas para `authenticated`, o que interromperia a criação de empresa (não o login, nem o uso de empresas existentes) até o frontend novo estar publicado.

### Alinhamento com a Restrição fundamental já registrada nesta fase

Este incremento não envolve, em nenhum momento, acesso a dados operacionais de empresas clientes — a autorização e as RPCs tratam exclusivamente de identidade (e-mail) e criação de registro administrativo (`empresas`/`usuarios_empresas`), nunca de clientes, veículos, OS, peças, fornecedores, funcionários, agenda ou caixa. Nenhuma função de personificação ou acesso emergencial é criada por este incremento — consistente com a "Restrição fundamental" já registrada acima neste mesmo documento.

## Pré-requisito antes de implementar esta fase

🔵 Antes de iniciar a implementação da Fase 5, é necessário concluir a investigação somente leitura de acoplamento à oficina no núcleo compartilhado, registrada como regra 7 em `qa/ARQUITETURA-MULTINICHO.md` — **ainda não realizada**.

## Restrição fundamental — isolamento dos dados operacionais no Painel Administrativo Central (registrada em 09/09/2026)

🔒 **Requisito de segurança e privacidade da arquitetura multiempresa. Vale para TODAS as sub-fases abaixo (5.1 a 5.4) e para qualquer funcionalidade futura do Painel Administrativo Central — nenhuma delas pode ser desenhada de um jeito que dependa de violar esta restrição.**

- **O proprietário da plataforma e a equipe do Torque não terão acesso direto aos dados operacionais das empresas clientes, nem mesmo por uma função de suporte ou personificação de usuário.**
- O painel global pode mostrar **somente** dados administrativos necessários à gestão do SaaS: empresa, nicho, plano, assinatura, pagamentos, situação de acesso, quantidade agregada de usuários, consumo de mensagens, status técnico, e o **contato administrativo/financeiro oficialmente designado pela própria empresa** (necessário para assinatura, cobrança e comunicados contratuais — esse contato não concede nenhum acesso aos dados operacionais da empresa).
- O painel global **não pode exibir**: clientes, CPF, veículos, ordens de serviço, peças, fornecedores, funcionários, agenda, caixa, ou qualquer outro conteúdo interno do estabelecimento.
- **Proibido criar**: função de "entrar como cliente", personificação de usuário, acesso emergencial, ou qualquer forma de abertura administrativa dos dados internos de uma empresa.
- Esta separação deve ser garantida estruturalmente (RLS/backend), não apenas ocultada na interface do painel global — mesmo princípio já aplicado ao isolamento entre empresas (nunca confiar somente em filtro de frontend).
- **Suporte ao cliente será feito externamente, por WhatsApp** (ver "Botão de Ajuda flutuante" abaixo) — é a alternativa deliberada ao acesso administrativo direto aos dados, não um recurso à parte.

Implicações imediatas para as sub-fases já registradas:
- **5.1** (restrição de acesso e administração de empresas): o administrador pode alterar a situação de acesso de uma empresa (bloquear/suspender/liberar/cancelar), mas isso é uma operação sobre um atributo administrativo da empresa — nunca uma via de acesso aos dados internos dela.
- **5.2** (planos, assinaturas e pagamentos): os dados geridos (plano, valor, situação da assinatura, vencimentos) são administrativos/financeiros da relação Torque↔estabelecimento — nunca dados operacionais do estabelecimento.
- **5.3** (URL personalizada): o subdomínio é só um identificador de empresa — nunca substitui autenticação, vínculo ativo ou autorização, e nunca concede acesso por si só.
- **5.4** (Central de Avisos): já compatível — a segmentação usa somente atributos administrativos (nicho, plano, situação da assinatura, situação de acesso), nunca dados de clientes ou conteúdo operacional do estabelecimento.

## Painel Administrativo Central — dashboard geral (requisito transversal, registrado em 09/09/2026)

🔵 **REQUISITO DETALHADO. Nenhuma implementação iniciada.**

Existirá uma área exclusiva do proprietário da plataforma (administrador global), **completamente separada** dos painéis usados pelos estabelecimentos — nunca acessível a partir do contexto de uma empresa cliente, nem pelos usuários dessa empresa.

O dashboard geral deverá apresentar, entre outros indicadores administrativos agregados:

- Empresas ativas.
- Empresas em período de teste.
- Empresas inadimplentes.
- Empresas suspensas ou bloqueadas.
- Empresas canceladas.
- Novas empresas e cancelamentos por período.
- Quantidade agregada de usuários ativos.
- Receita mensal recorrente.
- Valores recebidos e pendentes.
- Próximos vencimentos.
- Distribuição das empresas por nicho.
- Distribuição das empresas por plano.
- Consumo e custo de mensagens.
- Alertas administrativos.

**Regra explícita (reafirma a "Restrição fundamental" acima): todos esses indicadores são apenas administrativos e agregados.** O dashboard nunca poderá mostrar dados operacionais internos das empresas (clientes, CPF, veículos, ordens de serviço, peças, fornecedores, funcionários, agenda, caixa) — nem em forma de lista, nem de detalhe, nem de amostra "para diagnóstico".

## Botão de Ajuda flutuante (suporte externo via WhatsApp)

🔵 **REQUISITO REGISTRADO PARA PLANEJAMENTO FUTURO (09/09/2026). Nenhuma implementação iniciada.**

Consequência direta da restrição acima: como a equipe Torque não terá acesso aos dados internos das empresas, o suporte é feito por um humano, externamente, via WhatsApp — nunca por um administrador entrando nos dados da empresa.

- **Botão flutuante de Ajuda**, presente nas telas do sistema (frontend-wide — não é uma funcionalidade exclusiva do Painel Administrativo Central, nem depende de nenhuma sub-fase de 5.1 a 5.4 estar pronta; pode ser implementado como incremento independente, em qualquer momento).
- Opções: contato de suporte (abre WhatsApp), dúvidas frequentes, comunicação de problema, sugestões, e avisos (ponto de entrada natural para os avisos já publicados pela Central de Avisos — Fase 5.4 — quando ela existir).
- **Preenchimento automático ao abrir o WhatsApp — somente informações não sensíveis**: nome da empresa, tela atual, e uma identificação técnica do atendimento (ex.: um identificador de sessão/ticket, não um dado de negócio).
- **Proibido incluir no preenchimento automático**: CPF, dados financeiros, nomes de clientes, ou qualquer conteúdo operacional do estabelecimento — mesma restrição de dados sensíveis já aplicada ao painel global acima.

## Segurança e proteção de dados (requisito transversal, registrado em 09/09/2026)

🔵 **REQUISITO REGISTRADO PARA PLANEJAMENTO FUTURO. PENDENTE de análise técnica própria e de implementação — nenhum destes controles está implementado, testado ou validado hoje.** Esta seção documenta um levantamento inicial de requisitos de segurança e privacidade a considerar antes de avançar com o Painel Administrativo Central e os demais módulos desta fase; não é uma auditoria realizada nem uma decisão de arquitetura fechada. Vale para toda a Fase 5 (5.1 a 5.4) e para os requisitos transversais já registrados acima.

- Isolamento rigoroso entre empresas por RLS/backend — já é princípio aplicado no restante do Torque; precisa ser reavaliado e estendido especificamente para a camada do Painel Administrativo Central e para os novos módulos desta fase.
- Princípio do menor privilégio.
- Permissão global separada das funções `proprietario`, `admin`, `gerente` e `usuario` dos estabelecimentos — o administrador da plataforma não é, e não deve se confundir com, nenhum desses papéis internos de uma empresa.
- Autenticação reforçada para o Painel Administrativo Central.
- Futura avaliação de autenticação em dois fatores (2FA) para o administrador global.
- Proteção e expiração de sessões.
- Links de recuperação de senha temporários e de uso único (mesmo requisito já citado em `qa/fase-4/STATUS.md`, seção "Recuperação de senha").
- Proteção contra tentativas repetidas de login e de recuperação de senha.
- Não registrar senhas, tokens, CPF, dados financeiros ou informações operacionais sensíveis em logs.
- Armazenamento seguro de segredos e chaves — nunca no frontend, nunca no Git.
- Auditoria das operações administrativas críticas.
- Validação segura de webhooks do futuro provedor de pagamentos.
- Não armazenar diretamente dados completos de cartão — utilizar tokenização e os recursos de segurança do futuro provedor de pagamentos.
- Política futura de retenção, exportação, correção e exclusão de dados.
- Backups e restauração.
- Plano futuro de resposta a incidentes.
- Análise específica de privacidade e LGPD antes da entrada em produção.

**Nenhum destes itens deve ser considerado implementado, testado ou validado só por estar listado aqui** — é uma lista de requisitos a analisar e planejar, não um relatório de conformidade.

## Situação geral

```
FASE 5 — SaaS / Administração                           🔵 PLANEJAMENTO
├── 5.1 — Restrição de acesso e administração de empresas 🔵 Requisito detalhado (ver seção abaixo)
├── 5.2 — Planos, assinaturas e pagamentos                🔵 Requisito detalhado (ver seção abaixo)
├── 5.3 — URL personalizada por estabelecimento           🔵 Requisito detalhado (ver seção abaixo)
└── 5.4 — Central de Avisos da Plataforma                 🔵 Requisito detalhado (ver seção abaixo)

Requisitos transversais (não numerados, não exclusivos de uma sub-fase):
├── Painel Administrativo Central — dashboard geral        🔵 Requisito detalhado (ver seção acima)
├── Botão de Ajuda flutuante (suporte externo via WhatsApp) 🔵 Requisito detalhado (ver seção acima)
└── Segurança e proteção de dados                          🔵 Requisito registrado, PENDENTE de análise técnica e implementação (ver seção acima)

Referenciado aqui, mas registrado fora da Fase 5:
└── Mensagens automáticas (futura Fase 7, sem numeração formal ainda) 🔵 Referência resumida (ver seção abaixo)
```

## Nota sobre esta numeração

A divisão em 5.1 a 5.4 foi proposta em conversa em 09/09/2026, durante o planejamento dos requisitos futuros trazidos pelo usuário (propriedade da empresa, recuperação de acesso, segurança, restrição de acesso à plataforma, assinaturas/pagamentos, mensagens automáticas, URL personalizada, funcionários, e depois a Central de Avisos). Foi registrada por escrito pela primeira vez neste arquivo — não havia nenhuma numeração de sub-fases anterior em nenhum documento do projeto. As quatro sub-fases (5.1 a 5.4) já têm requisitos detalhados nas seções correspondentes; nenhuma delas foi implementada.

## 5.1 — Restrição de acesso e administração de empresas

🔵 **REQUISITO DETALHADO (09/09/2026). Nenhuma implementação iniciada.**

- Remover ou restringir o cadastro público atual (hoje qualquer pessoa consegue criar conta e usar o Torque).
- Permitir entrada somente por convite, liberação administrativa ou contratação válida — o fluxo exato entre essas três formas ainda precisa ser desenhado.
- Impedir acesso de usuários sem vínculo ativo a dados ou funcionalidades — reforça, agora também no nível de entrada na plataforma, o que já vale hoje para o contexto de empresa (dependência de vínculo ativo em `usuarios_empresas`).
- Permitir ao administrador global consultar empresas e seus dados administrativos — nunca dados operacionais internos (ver "Restrição fundamental" acima).
- Bloquear, suspender, liberar ou cancelar o acesso de uma empresa.
- Permitir desbloqueio manual quando o processo automático (ex.: inadimplência, ver 5.2) precisar de intervenção humana.
- **Registrar motivo, responsável, data e origem de cada bloqueio ou desbloqueio** — este é um requisito de auditoria próprio deste fluxo, já detalhado aqui; não depende do "padrão global de auditoria da plataforma" ainda a ser definido (citado nas dependências da 5.4), que cobre outros mecanismos administrativos.
- Garantir a autorização no banco/backend, não apenas no frontend — mesmo princípio de segurança já aplicado ao isolamento entre empresas (RLS, nunca confiar só em filtro de tela).
- Manter proibido qualquer acesso aos dados operacionais internos — reforça a "Restrição fundamental" acima.

## 5.2 — Planos, assinaturas e pagamentos

🔵 **REQUISITO DETALHADO (09/09/2026). Nenhuma implementação iniciada. Não implementar ainda a integração com nenhum meio de pagamento — o provedor ainda será escolhido.**

- Criar, editar, ativar e desativar planos.
- Alterar valores com facilidade.
- Definir periodicidade, período de teste, limites, descontos e recursos de cada plano.
- Controlar a situação da assinatura: ativa, em teste, inadimplente, suspensa ou cancelada.
- Definir vencimentos, pagamentos e renovação.
- Definir regras de bloqueio automático por inadimplência.
- Permitir desbloqueio manual auditado (mesmo padrão de auditoria de bloqueio/desbloqueio já detalhado na 5.1 — motivo, responsável, data, origem).
- Manter histórico de mudanças de preço.
- Definir como as mudanças de preço afetam assinaturas já existentes (aplicação imediata, só em renovações futuras, ou por regra de transição — ainda a ser definido).
- **Separar claramente** a assinatura SaaS paga pelo estabelecimento à Torque das futuras assinaturas que um estabelecimento (ex.: uma barbearia) poderá oferecer aos próprios clientes — são dois conceitos de "assinatura" diferentes, e a estrutura de dados não deve misturá-los.

**Detalhamento técnico completo** (modelo de dados corrigido de `assinaturas`/`assinaturas_historico`/`cobrancas`/`pagamentos`, despesas, rateio por dias-empresa, indicadores financeiros e ordem de incrementos) registrado no checkpoint "Planejamento revisado do Incremento 3 (Painel Administrativo Central: Operação e Financeiro)", no topo deste documento.

## 5.3 — URL personalizada

🔵 **REQUISITO DETALHADO (09/09/2026). Nenhuma implementação iniciada.**

- Padrão `nomedoestabelecimento.torque.tec.br`.
- Identificador único por empresa.
- Regras de criação, alteração e reserva do nome (quem pode escolher/alterar, e quando).
- Impedir duplicidade de subdomínio entre empresas.
- Tratar nomes inválidos ou proibidos (caracteres permitidos, palavras reservadas, lista de bloqueio).
- Garantir que o subdomínio identifique o estabelecimento, mas **nunca substitua** autenticação, vínculo ativo ou autorização.
- Impedir acesso aos dados somente pelo conhecimento da URL — conhecer o subdomínio de uma empresa não pode, por si só, conceder nenhum acesso.

## 5.4 — Central de Avisos da Plataforma

🔵 **REQUISITO REGISTRADO PARA PLANEJAMENTO FUTURO (09/09/2026). Estrutura aprovada conceitualmente pelo usuário. Nenhuma implementação de código, banco de dados ou frontend foi iniciada.**

### Objetivo

Submódulo do Painel Administrativo Central (Fase 5) que permite ao administrador global da plataforma comunicar informações às empresas assinantes: atualizações e novos recursos, manutenção programada, indisponibilidade/incidentes, mudanças de plano e valor de assinatura, comunicados de segurança, e alterações importantes nos termos ou no funcionamento da plataforma.

### Dependências

- **Depende de 5.1** (restrição de acesso/administração de empresas) — a segmentação por "situação de acesso" precisa dos atributos de empresa geridos ali.
- **Depende de 5.2** (assinaturas e pagamentos) — a segmentação por plano/situação da assinatura, e os dados de valor/vigência exigidos pelo requisito de "Alteração de preços" (ver abaixo), dependem do modelo de assinatura já estar definido.
- **Depende de um padrão global de auditoria ainda a ser definido.** Não deve reutilizar como pronto nenhum mecanismo específico das RPCs da Fase 4 — a auditoria detalhada dessas RPCs foi deliberadamente deixada para implementação futura (ver `qa/fase-4/STATUS.md`), não é hoje um mecanismo completo e reutilizável. Quando o padrão global de auditoria da plataforma for definido, a Central de Avisos deve seguir esse padrão, em vez de criar um mecanismo de auditoria próprio e isolado.
- **Pode compartilhar infraestrutura genérica de envio** (canal, custo, consentimento, histórico) com o módulo de mensagens automáticas para clientes finais dos estabelecimentos (ver seção "Mensagens automáticas" abaixo). Os dois módulos devem manter **regras, públicos e permissões completamente separados** — o compartilhamento é só da camada de envio/custo, nunca da lógica de conteúdo, público ou permissão de cada módulo.

### Público do aviso

- Enviar para todas as empresas, selecionar empresas específicas, ou segmentar por nicho, plano, situação da assinatura ou situação de acesso.
- **Isolamento multi-tenant**: cada empresa deve visualizar somente os avisos destinados ao seu público — mesmo rigor de design já exigido para qualquer dado de empresa no projeto (nunca filtro só no frontend).
- **Público fixado no momento da publicação, não uma consulta dinâmica.** Ao publicar um aviso, o sistema deve registrar os destinatários efetivos (por empresa, e quando necessário por usuário) como um retrato do público-alvo naquele instante. Mudanças posteriores de nicho, plano ou situação da assinatura de uma empresa **não podem alterar retroativamente** quem foi ou não destinatário de um aviso já publicado.

### Tipos de comunicação (a diferenciar)

1. Avisos operacionais e de segurança.
2. Manutenção e indisponibilidade.
3. Alterações contratuais ou de preço.
4. Comunicações promocionais.

Consentimento, obrigatoriedade de recebimento e possibilidade de cancelamento (opt-out) devem ser definidos **conforme o tipo E o canal** — por exemplo, um aviso de segurança interno pode ser obrigatório e sem opt-out, enquanto uma comunicação promocional por WhatsApp pode exigir consentimento prévio e permitir cancelamento. A matriz completa (tipo × canal × obrigatoriedade/consentimento/opt-out) ainda precisa ser desenhada em detalhe quando a implementação desta sub-fase começar — não está definida agora.

### Configuração

Título e conteúdo; tipo (um dos 4 acima); prioridade (informativo/importante/crítico); data/horário de início e encerramento; publicação imediata ou programada; link opcional; possibilidade de salvar como rascunho.

### Estados de recebimento (três estados distintos, não um booleano "lido")

1. **Recebido/disponibilizado** — o aviso foi tornado visível/entregue ao destinatário.
2. **Visualizado** — o destinatário efetivamente abriu/viu o aviso.
3. **Confirmado explicitamente** — o destinatário realizou uma ação explícita de confirmação (aplicável a avisos críticos que exigem confirmação de leitura).

### Exibição e bloqueio

Área de avisos dentro do sistema; indicador de avisos não lidos; banner ou modal para avisos importantes. Um aviso crítico pode exigir confirmação de leitura, **mas isso não deve, por si só, bloquear automaticamente o uso do sistema**. Qualquer bloqueio de acesso motivado por um aviso não confirmado deve ser uma **ação administrativa separada, explícita e auditável** — nunca um efeito colateral automático da criação ou publicação do aviso.

### Canais

- Interno (exibição na plataforma) — primeiro canal a existir.
- E-mail e WhatsApp — possibilidade futura. Canais que gerarem custo devem registrar consumo e custo por comunicação (mesmo requisito de controle já levantado para as mensagens automáticas aos clientes finais).

### Controle e histórico

**Correção de contradição (09/09/2026): esta seção antes permitia ao administrador global "consultar empresas e usuários" individualmente, o que contradizia a "Restrição fundamental" (que só permite quantidade agregada de usuários, nunca dados de usuários individuais). Corrigido abaixo.**

- O sistema pode registrar tecnicamente o estado de recebimento/visualização/confirmação **por usuário** — necessário para controlar avisos não lidos e confirmações — mas isso é um dado técnico interno de operação do sistema, não uma tela de consulta para o administrador global.
- **O administrador global não pode navegar pela lista de funcionários ou usuários internos de uma empresa.**
- No painel global, mostrar apenas: a **empresa destinatária** e **resultados agregados** (contagens) de recebimento, visualização e confirmação — nunca nomes individuais de usuários, funcionários ou clientes.
- Quando houver necessidade contratual ou financeira (por exemplo, confirmar que um aviso de alteração de preço foi disponibilizado a um responsável pela empresa), mostrar somente o **contato administrativo/financeiro oficialmente designado** pela própria empresa — nunca uma lista de usuários internos.
- O proprietário da empresa poderá, no futuro, consultar as confirmações dos próprios usuários da sua empresa — mas isso é uma tela do **painel da própria empresa**, sob permissão específica do proprietário, nunca do painel global do administrador da plataforma.
- Editar, cancelar ou encerrar uma publicação.
- Manter histórico completo dos comunicados.
- Registrar em auditoria quem criou, alterou, publicou ou cancelou o aviso — usando o padrão global de auditoria da plataforma quando ele for definido (ver "Dependências" acima).

### Alteração de preços — dados a registrar

- Plano afetado.
- Assinaturas afetadas (lista concreta de assinaturas impactadas, não só o plano genérico).
- Valor anterior.
- Novo valor.
- Data de vigência.
- Data em que o comunicado foi publicado.
- Comprovante de disponibilização ou envio.

O aviso **nunca altera o valor da assinatura por si só** — comunicação e alteração financeira são operações separadas, cada uma auditável independentemente.

## Mensagens automáticas (referência resumida — futura Fase 7, ainda sem numeração formal)

🔵 **REQUISITO REGISTRADO PARA PLANEJAMENTO FUTURO (09/09/2026). Nenhuma implementação iniciada.** Mantido **fora da Fase 5** — é um módulo distinto, proposto em conversa como uma futura "Fase 7", que ainda não tem documento de planejamento próprio. Registrado aqui só como referência resumida, por causa da dependência de infraestrutura compartilhada com a Central de Avisos (5.4).

- Lembretes de revisão e outros eventos.
- Configuração pelo próprio estabelecimento.
- Consentimento e possibilidade de cancelamento, conforme canal e finalidade.
- Histórico de envio.
- Falhas de entrega.
- Consumo, limite e custo.
- Possibilidade de cobrança do serviço.
- Compartilha **apenas a infraestrutura de envio** (canal, custo, consentimento, histórico) com a Central de Avisos (Fase 5.4) — públicos e permissões continuam **completamente separados** entre os dois módulos.
