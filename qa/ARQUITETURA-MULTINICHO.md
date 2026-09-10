# Arquitetura Multinicho e Modular — Decisão Registrada

Data: 2026-09-09

🔵 **DECISÃO ARQUITETURAL REGISTRADA PARA PLANEJAMENTO FUTURO. Nenhuma implementação, alteração de código, banco ou frontend foi realizada.** Este documento registra uma decisão de arquitetura de longo prazo, não um plano de execução imediato nem uma modelagem física.

## Decisão

O Torque será uma plataforma SaaS multiempresa, multinicho e modular. Os segmentos inicialmente previstos são: oficina, barbearia, estética, salão de beleza, manicure e pedicure, lava-jato.

**Decisão funcional**: uma empresa poderá atuar em vários segmentos, e um mesmo segmento poderá atender várias empresas — relação conceitual **N:N** entre empresa e segmento. Por exemplo, um salão pode oferecer cabelo, estética, manicure e pedicure ao mesmo tempo; e o segmento "estética", por sua vez, pode ser oferecido por várias empresas diferentes (um salão, uma clínica, etc.). Não se deve assumir uma relação rígida de "uma empresa = um único nicho" em nenhuma modelagem futura.

**Não é objeto deste documento definir nomes de tabelas, colunas, constraints ou migrações.** A modelagem física — como essa relação N:N e a habilitação de módulos serão efetivamente representadas no banco — será decidida depois da investigação de acoplamento mencionada nas regras abaixo. Este documento registra só a decisão conceitual/funcional.

## Três conceitos a diferenciar claramente

- **Segmento**: área de atuação do estabelecimento (ex.: oficina, barbearia, estética, salão de beleza, manicure e pedicure, lava-jato).
- **Módulo/capacidade**: funcionalidade habilitada para uma empresa (ex.: agenda, veículos, ordens de serviço, produtos e estoque).
- **Plano**: conjunto comercial de recursos e limites contratados pela empresa — define, entre outras coisas, quais módulos/capacidades estão disponíveis e em que limite.

Esses três conceitos são independentes entre si: um segmento não determina automaticamente nenhum módulo, e um plano não determina automaticamente nenhum segmento.

## O que a futura modelagem deverá avaliar

- Segmentos vinculados à empresa (relação N:N, nunca 1:1).
- Módulos ou capacidades habilitados por empresa e por plano.
- Núcleo compartilhado entre todos os segmentos.
- Funcionalidades específicas isoladas por módulo.
- Ausência de condicionais espalhadas pelo sistema baseadas em nomes fixos de nichos.

## Regra de habilitação de módulo (decisão funcional)

**Um módulo não deve ser habilitado automaticamente apenas pelo nome do segmento.** A futura regra de habilitação de um módulo para uma empresa precisa considerar, no mínimo, a configuração da própria empresa e o plano contratado — nunca uma inferência direta a partir do segmento declarado. Por exemplo: uma empresa do segmento "oficina" não deve ganhar o módulo "Veículos" automaticamente só por ser oficina — a habilitação é uma decisão de configuração/plano, ainda que na prática a maioria das oficinas venha a habilitá-lo.

## Núcleo compartilhado (não deve ser duplicado por segmento)

- Autenticação.
- Recuperação de senha.
- Empresas.
- Usuários e permissões.
- Isolamento multiempresa.
- Segurança e auditoria.
- Planos, assinaturas e pagamentos.
- Painel administrativo global.
- Central de Avisos.
- Infraestrutura de mensagens.
- URLs personalizadas.
- Suporte.

## Módulos reutilizáveis (candidatos a capacidade, não a nicho nomeado)

- Agenda e horários.
- Profissionais e comissões.
- Catálogo de serviços e duração.
- Veículos.
- Ordens de serviço.
- Produtos e estoque.
- Pacotes e recorrências.
- Mensagens e lembretes automáticos.

**Esta lista registra candidatos a módulo, não uma classificação já confirmada.** Nenhum componente do sistema atual (código do piloto da oficina) foi avaliado ou confirmado como já desacoplado, genérico ou pronto para reuso — isso ainda depende inteiramente da investigação de acoplamento (ver regra 7 abaixo). É perfeitamente possível que a investigação encontre, por exemplo, que "Veículos" está hoje misturado com lógica específica de oficina de um jeito que precisa de trabalho antes de ser considerado um módulo reutilizável de fato.

## Regras explícitas desta decisão

1. **Não implementar agora os novos segmentos** (barbearia, estética, salão de beleza, manicure e pedicure, lava-jato).
2. **Não aumentar o escopo do cliente piloto da oficina** — a entrega do piloto continua com o escopo já definido, sem ampliação motivada por esta decisão.
3. **Não duplicar** autenticação, pagamentos, mensagens ou segurança em projetos separados — tudo isso é núcleo compartilhado, único.
4. **Não generalizar funções específicas sem necessidade comprovada** — evitar abstrair prematuramente algo que hoje só tem um caso de uso conhecido (a oficina).
5. **Manter módulos específicos separados do núcleo.**
6. **A URL permanece no padrão `nomedoestabelecimento.torque.tec.br`** — o nicho não precisa fazer parte do endereço.
7. **Antes de implementar a Fase 5**, realizar uma investigação somente leitura para identificar textos, campos e regras de oficina acoplados ao núcleo compartilhado (nomenclaturas, textos de interface, condicionais, e qualquer estrutura que hoje assuma "oficina" como único segmento possível). **Essa investigação é o que vai confirmar, ou não, que os módulos listados acima são de fato reutilizáveis** — nenhuma conclusão sobre acoplamento/desacoplamento deve ser tomada como certa antes dela.

## Impacto sobre o que já existe

O cliente piloto (oficina) continua sendo o único segmento implementado hoje, sem qualquer alteração de código motivada por este documento. Esta decisão não exige nenhuma refatoração imediata — ela estabelece o critério que qualquer nova funcionalidade, e especialmente a Fase 5 (Painel Administrativo Central), deverá seguir a partir de agora, e motiva a investigação de acoplamento (regra 7) antes de iniciar a Fase 5.

## Relação com outros documentos de planejamento

- `qa/fase-5/STATUS.md` — a investigação de acoplamento (regra 7) é um pré-requisito explícito antes de implementar essa fase.
- `CLAUDE.md` — já estabelece os princípios gerais de multiempresa/multinicho (seções 1 e 4); este documento os torna concretos, com a lista real de segmentos previstos e a diferenciação entre segmento/módulo/plano — sem alterar o `CLAUDE.md` em si.
