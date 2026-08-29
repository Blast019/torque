# TORQUE — Status da Fase 2.5 (QA de RLS)

Última atualização: 2026-08-26

## 1. Fases concluídas

```
FASE 1 — Estrutura inicial do banco              🟢 CONCLUÍDA

FASE 2 — RLS e Segurança                         🟢 CONCLUÍDA
├── 2.1 usuarios_empresas                        🟢 CONCLUÍDA
├── 2.2 empresas                                  🟢 CONCLUÍDA
├── 2.3 clientes e veículos                       🟢 CONCLUÍDA
├── 2.4 Agenda
│   └── 2.4.1 Análise + Policies + QA             🟢 CONCLUÍDA (dados de QA limpos)
└── 2.5 OS / peças / estoque
    ├── Inventário do banco                       🟢 CONCLUÍDA
    ├── Matriz de permissões                      🟢 FECHADA
    ├── Policies principais                       🟢 IMPLEMENTADAS (incl. pecas, ver seção 4)
    ├── Fixtures permanentes de QA                🟢 RECONSTRUÍDOS (ver seção 3)
    └── 2.5.1 Ordens de Serviço — QA funcional
        ├── SELECT (policies)                     🟢 CONCLUÍDO (4/4 papéis testados)
        ├── INSERT                                🟢 CONCLUÍDO (4/4 papéis testados)
        ├── UPDATE (incl. WITH CHECK empresa_id)  🟢 CONCLUÍDO (4/4 papéis testados)
        ├── DELETE                                🟢 CONCLUÍDO (4/4 papéis testados)
        └── Isolamento dedicado (os-05)            🟢 CONCLUÍDO

    2.5.2 pecas / estoque
        ├── Pendência crítica (policies faltantes) 🟢 RESOLVIDA (3 policies criadas 24/08)
        └── QA funcional (SELECT/INSERT/UPDATE/DELETE por papel) 🟢 CONCLUÍDO (4/4 papéis cada, + isolamento dedicado)
    2.5.3 fornecedores — 🟢 QA FUNCIONAL CONCLUÍDO, correção de integridade multiempresa APLICADA E VALIDADA
        ├── Confirmação de policies via SQL          🟢 CONCLUÍDA (4 policies, RLS ativo, sem duplicidade — 24/08/2026)
        ├── Scripts de QA funcional (01 a 05)         🟢 CONCLUÍDOS (4/4 papéis cada, ver seção 4-B)
        └── Teste adicional: vínculo cruzado (06)     🟢 EXECUTADO (24/08/2026) — falha de integridade encontrada, CORRIGIDA e VALIDADA (5/5 passos), ver seção 4-B
    2.5.4 funcionarios — 🟢 QA FUNCIONAL CONCLUÍDO, correção de integridade multiempresa APLICADA E VALIDADA (5/5 passos)
        ├── Investigação somente leitura              🟢 CONCLUÍDA (frontend + git + SQL de conferência)
        └── Scripts de QA funcional (01 a 06)          🟢 CONCLUÍDOS — 4/4 papéis cada, resultado batendo 100% com a matriz esperada (ver seção 4-C)
    2.5.5 movimentos_caixa — 🟢 QA FUNCIONAL CONCLUÍDO, correção de integridade multiempresa APLICADA E VALIDADA, CONFERÊNCIA FINAL APROVADA (26/08/2026)
        ├── Scripts de QA funcional (01 a 08)         🟢 CONCLUÍDOS (ver seção 4-D/4-E)
        ├── Falha de integridade (os_id/peca_id)      🟢 CORRIGIDA e VALIDADA (5/5 passos, ver seção 4-E)
        └── Conferência final (script 16)             🟢 APROVADA (26/08/2026)

FASE 3 — Contexto da empresa                      🟢 CONCLUÍDA (ver ../fase-3/STATUS.md)
FASE 4 — Usuários e permissões                     ⏳
FASE 5 — SaaS / Administração                      ⏳
FASE 6 — Testes finais e produção                  ⏳
```

## 2. Policies atuais confirmadas (Fase 2.5) — `pg_policies` real, lido em 24/08

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ordens_servico` | `usuario_pertence_empresa` | `usuario_pode_operar_empresa` | `usuario_pode_operar_empresa` (USING+WITH CHECK) | `usuario_pode_excluir_empresa` |
| `os_itens` | idem, via `EXISTS (... ordens_servico ...)` (não tem `empresa_id` próprio) | idem | idem | idem |
| `fornecedores` | completo, mesmo padrão | completo | completo | completo |
| `funcionarios` | `usuario_pertence_empresa` | `usuario_pode_excluir_empresa` (INSERT/UPDATE/DELETE restritos a gestor — `usuario` só lê) | idem | idem |
| `movimentos_caixa` | só `proprietario` (via EXISTS direto, não usa as 3 funções) | `proprietario` (tudo) OU `admin`/`gerente` (só `tipo='saida'`) | só `proprietario` | só `proprietario` |
| `pecas` | `pecas_select_usuario_vinculado` | `pecas_insert_usuario_operador` | `pecas_update_usuario_operador` | `pecas_delete_usuario_gestor` |

### ✅ PENDÊNCIA CRÍTICA — `pecas` — RESOLVIDA (24/08)

Investigação (somente leitura, feita antes de qualquer alteração):
- **RLS confirmado ativo** (`rowsecurity = true`) e só a policy de UPDATE existia — pendência era real, não teórica.
- **Frontend já usa as 4 operações ativamente** (`script.js`): SELECT no boot (`carregarDados()`, linha 135), INSERT/UPDATE no cadastro de peça (`salvarPecaBtn`, linha ~1049-1062), UPDATE em baixa/estorno/reposição de estoque, DELETE em `excluirPeca()` (linha 1069-1071). Ou seja, o módulo de estoque estava efetivamente quebrado em produção (listagem sempre vazia, cadastro com erro 403, exclusão sem efeito).
- Sem rastro no git de commits/SQL sobre a origem da policy isolada de UPDATE — não versionada.

3 policies criadas pelo usuário via SQL Editor do Supabase em 24/08 (script salvo em `scripts/pecas-01-criar-policies.sql`):
- SELECT → `usuario_pertence_empresa` (mesmo padrão de `ordens_servico`)
- INSERT → `usuario_pode_operar_empresa` (exclui só `sem_vinculo`)
- DELETE → `usuario_pode_excluir_empresa` (pela definição da função, permite proprietario/admin/gerente; decisão explícita do usuário: `usuario` NÃO pode excluir peças, mesmo padrão de `ordens_servico`)

**🟢 QA funcional CONCLUÍDO para a matriz de papéis definida (24/08/2026)** — 4/4 papéis testados (proprietario/admin/usuario/sem_vinculo) em cada operação, resultado batendo 100% com a matriz esperada:

| Operação | proprietário | admin | usuário | sem vínculo |
|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ❌ |
| INSERT | ✅ | ✅ | ✅ | ❌ |
| UPDATE | ✅ | ✅ | ✅ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ |
| Trocar `empresa_id` p/ Empresa B (WITH CHECK) | ❌ | ❌ | ❌ | ❌ |

(DELETE segue o mesmo padrão já adotado em `ordens_servico`: só proprietario/admin/gerente podem excluir segundo a definição de `usuario_pode_excluir_empresa`, `usuario` é bloqueado em ambas as tabelas — não é uma regra diferente, é o mesmo padrão replicado.)

**⚠️ Papel `gerente` fora de escopo dos testes funcionais**, mesma decisão já registrada na Fase 2.5.1 (seção 4, abaixo). A tabela acima cobre só os 4 papéis efetivamente testados. O comportamento de `gerente` em `pecas` **não foi comprovado funcionalmente** — só sabemos, pela leitura da definição das funções (`usuario_pode_operar_empresa`, `usuario_pode_excluir_empresa`), que ele deveria ter permissão de INSERT/UPDATE/DELETE, mas isso não passou por nenhuma chamada real à API. Avaliar separadamente se/quando criar a conta de teste do papel `gerente`.

#### INSERT (`pecas-02-criar.js`)

| Papel | HTTP | Resultado | Peça criada |
|---|---|---|---|
| proprietario | 201 | ✅ PASS | `ce7256e1-7be4-48e2-bf11-e8838d99f5bc` |
| admin | 201 | ✅ PASS | `486bbff7-1a1a-499e-b4f4-8f3210eb459c` |
| usuario | 201 | ✅ PASS | `128da70e-c642-4419-b414-5b5523472416` |
| sem_vinculo | 403 (`42501`, RLS) | ✅ PASS (bloqueio confirmado) | — |

#### SELECT (`pecas-03-select.js`)

| Papel | Empresa A | Empresa B | Resultado |
|---|---|---|---|
| proprietario | 3 registros | 0 | ✅ PASS |
| admin | 3 registros | 0 | ✅ PASS |
| usuario | 3 registros | 0 | ✅ PASS |
| sem_vinculo | 0 | 0 | ✅ PASS (bloqueio confirmado) |

#### UPDATE (`pecas-04-update.js`) — normal + WITH CHECK

| Papel | Update normal | WITH CHECK (trocar empresa_id p/ B) |
|---|---|---|
| proprietario | 200, aplicado (`qtd` 10→15) | 403 `42501` bloqueado |
| admin | 200, aplicado (`qtd` 10→20) | 403 `42501` bloqueado |
| usuario | 200, aplicado (`qtd` 10→25) | 403 `42501` bloqueado |
| sem_vinculo | 200, 0 linhas afetadas (bloqueado) | 200, 0 linhas afetadas (bloqueado) |

Todos ✅ PASS. `usuario_pode_operar_empresa` confirmada para `pecas`, incluindo bloqueio do `WITH CHECK` para todos os papéis (nenhuma peça foi movida para a Empresa B).

#### DELETE (`pecas-05-delete.js`)

| Papel | HTTP | Resultado | Verificação (via admin) |
|---|---|---|---|
| proprietario | 200 | ✅ PASS | peça `ce7256e1-...` excluída |
| admin | 200 | ✅ PASS | peça `486bbff7-...` excluída |
| usuario | 200 (0 linhas) | ✅ PASS (bloqueado) | peça `128da70e-...` ainda existe |
| sem_vinculo | 200 (0 linhas) | ✅ PASS (bloqueado) | peça `128da70e-...` ainda existe |

`usuario_pode_excluir_empresa` confirmada: só proprietario/admin excluem, mesmo padrão de `ordens_servico`.

#### Isolamento dedicado (`pecas-06-isolamento.js`)

Login como admin da Empresa A:

| Teste | HTTP | Resultado |
|---|---|---|
| SELECT peças da Empresa B | 200, 0 registros | ✅ PASS |
| INSERT de peça com `empresa_id` = Empresa B | 403 `42501` bloqueado | ✅ PASS |

**Estado final dos dados de teste:** restou 1 peça na Empresa QA A (`128da70e-...`, "[TESTE] QA Fase 2.5.2 - Peça", `qtd: 25`), sobrevivente por ser alvo das tentativas bloqueadas de usuario/sem_vinculo — não foi excluída de propósito. Não limpar sem autorização explícita.

## 3. Fixtures permanentes de QA da Fase 2.5

Os fixtures antigos, reaproveitados da Agenda (Empresa A `6b1c2475-...`, Empresa B `57e7be22-...`, cliente `02c61001-...`), **foram apagados** em algum momento entre sessões — confirmado via SQL Editor com bypass de RLS (`Success. No rows returned`). Causa não identificada. Foram reconstruídos do zero:

| Recurso | ID | Detalhe |
|---|---|---|
| Empresa QA A | `670162c6-3437-4cd5-b581-0229d57d33e2` | nome `QA Fase 2.5 - Empresa A`, `status_assinatura: ativo`, `plano: Teste` |
| Empresa QA B | `069783bc-5f12-4e00-b8ed-d57efca4aa67` | nome `QA Fase 2.5 - Empresa B`, owner = sem_vinculo |
| Cliente QA | `c38d48b5-5ec8-4a31-8bf4-407bb6187155` | `[TESTE] Cliente QA Fase 2.5`, empresa A, `ativo: true` |

### Contas de teste (Auth) e vínculos na Empresa QA A

| Papel | Email | UUID | Vínculo (`usuarios_empresas.id`) | Status |
|---|---|---|---|---|
| proprietario | `torque.owner.qa@gmail.com` | `5f026bf2-226b-45f6-8474-4176fefbfe77` | `76083c64-a383-4afc-8752-0db23b9d80fb` | ✅ ativo, confirmado |
| admin | `torque.admin.teste@gmail.com` | `59482850-db77-49ef-9bd1-e06ddce1e058` | `2d89883d-ddc0-4878-93e9-2ccc5027eafe` | ✅ ativo |
| usuario | `torque.usuario.teste@gmail.com` | `7c53ac17-cc17-4cba-9a66-e3af1a170ff9` | `6dae30bd-9c21-49ad-8b67-a9fb57d1873d` | ✅ ativo |
| sem_vinculo | `torque.sem.vinculo@gmail.com` | `a27f1e18-f80d-49ac-95bd-5fdd8f4e0f4f` | (nenhum vínculo com Empresa A — proposital; é dono/proprietario da Empresa B) | ✅ |

**Credenciais (senha e chaves) não ficam mais registradas neste documento nem em nenhum script.** A partir de 26/08/2026, todos os scripts em `fase-2.5/scripts/` leem `SUPABASE_URL`, `SUPABASE_ANON_KEY`, a senha compartilhada de todas as contas de teste e os e-mails de cada papel via `qa/.env` local (arquivo ignorado pelo Git, nunca commitado — ver `.gitignore` na raiz e `qa/.env.example` para a lista de variáveis). Rodar com `node --env-file=qa/.env qa/fase-2.5/scripts/<script>.js`, a partir da raiz do repositório.

**Conta antiga descontinuada:** `torque.owner.teste@gmail.com` (`1bf87a5a-1657-42d7-89c0-c48ce9b4735b`) ficou com `email_not_confirmed` e nunca foi resolvida — foi substituída pela conta nova `torque.owner.qa@gmail.com` para o papel proprietário. O `owner_id` da Empresa QA A e o vínculo `usuarios_empresas.id=76083c64-...` foram corrigidos (via UPDATE) do UUID antigo para o novo em 24/08.

### ⚠️ Não usar / não alterar
Empresa **"Admim"** (`825c05d9-04ec-4ddf-b378-bd92d47e9627`, `owner_id` = conta admin de teste `59482850-...`) e cliente **"Maria Graça"** — não fazem parte de nenhum fixture de QA, apareceram associados à conta `admin` de teste por motivo desconhecido (uso real fora do escopo do QA?). Não excluir, não alterar, não reutilizar como fixture.

## 4. QA funcional — Fase 2.5.1 (Ordens de Serviço)

Padrão: login real via Supabase Auth REST + chamada REST direta (mesmo padrão validado na Agenda).

### INSERT — 🟢 CONCLUÍDO (4/4 papéis)

| Papel | HTTP | Resultado | OS criada |
|---|---|---|---|
| admin | 201 | ✅ PASS | `9184176c-c5aa-45e8-9e5b-a86b7fdd8701` |
| usuario | 201 | ✅ PASS | `97c2709a-8678-4322-a00c-d15129cd0708` |
| sem_vinculo | 403 (`42501`, RLS) | ✅ PASS (bloqueio confirmado, nenhum registro criado) | — |
| proprietario | 201 (após corrigir fixture) | ✅ PASS | `fdca2c6c-ccf6-46a9-89a0-18916b4f4b91` |

**3 OS de teste continuam na Empresa QA A** (ainda não foram limpas — não fazer limpeza sem autorização explícita, seguindo o mesmo cuidado usado na Agenda).

### SELECT — 🟢 CONCLUÍDO (4/4 papéis)

| Papel | HTTP (A / B) | Registros (A / B) | Resultado |
|---|---|---|---|
| proprietario | 200 / 200 | 3 / 0 | ✅ PASS |
| admin | 200 / 200 | 3 / 0 | ✅ PASS |
| usuario | 200 / 200 | 3 / 0 | ✅ PASS |
| sem_vinculo | 200 / 200 | 0 / 0 | ✅ PASS (bloqueio confirmado — não vê nada da Empresa A) |

Testado em 24/08. As 3 OS de teste (empresa A) aparecem para os 3 papéis vinculados; `sem_vinculo` não enxerga nenhuma. Isolamento contra Empresa B confirmado para os 3 papéis vinculados (0 linhas). Bate 100% com a matriz esperada.

### UPDATE — 🟢 CONCLUÍDO (4/4 papéis, normal + WITH CHECK)

| Papel | Update normal | WITH CHECK (trocar empresa_id p/ B) | Resultado |
|---|---|---|---|
| proprietario | 200, aplicado | 403 `42501` bloqueado | ✅ PASS |
| admin | 200, aplicado | 403 `42501` bloqueado | ✅ PASS |
| usuario | 200, aplicado | 403 `42501` bloqueado | ✅ PASS |
| sem_vinculo | 200, 0 linhas afetadas (bloqueado por USING) | 200, 0 linhas afetadas (bloqueado) | ✅ PASS |

Testado em 24/08. `usuario_pode_operar_empresa` confirmada: os 3 papéis vinculados conseguem atualizar OS da própria empresa (não é restrito por "dono" do registro — testado com proprietario e admin editando OS que não foram criadas por eles). `sem_vinculo` bloqueado em ambos os casos. `WITH CHECK` bloqueia troca de `empresa_id` para todos os papéis testados, inclusive proprietario/admin — nenhuma OS foi de fato movida para a Empresa B. Bate 100% com a matriz esperada.

Descrições das 3 OS de teste foram alteradas pelos testes (esperado, faz parte do teste funcional):
- `fdca2c6c-...` → "[TESTE] QA Fase 2.5.1 - editado por proprietario" (tentativa de sem_vinculo não teve efeito)
- `9184176c-...` → "[TESTE] QA Fase 2.5.1 - editado por admin"
- `97c2709a-...` → "[TESTE] QA Fase 2.5.1 - editado por usuario"

### DELETE — 🟢 CONCLUÍDO (4/4 papéis)

| Papel | HTTP | Resultado | Verificação (via admin) |
|---|---|---|---|
| proprietario | 200 | ✅ PASS | registro excluído |
| admin | 200 | ✅ PASS | registro excluído |
| usuario | 200 (0 linhas) | ✅ PASS (bloqueado) | registro ainda existe |
| sem_vinculo | 200 (0 linhas) | ✅ PASS (bloqueado) | registro ainda existe |

Testado em 24/08. `usuario_pode_excluir_empresa` confirmada: proprietario e admin conseguem excluir, usuario e sem_vinculo são bloqueados (RLS filtra a linha antes do DELETE, sem erro explícito, igual ao padrão de UPDATE bloqueado). Bate 100% com a matriz esperada.

**Estado final dos dados de teste:** das 3 OS de teste criadas na Fase 2.5.1, 2 foram excluídas neste teste (`fdca2c6c-...` por proprietario, `9184176c-...` por admin). Resta apenas `97c2709a-...` (descrição "[TESTE] QA Fase 2.5.1 - editado por usuario"), que sobreviveu por ser o alvo das tentativas bloqueadas de usuario/sem_vinculo — não foi excluída de propósito, mas pode ser removida depois se quiser fazer limpeza (aguardar autorização explícita).

### Isolamento dedicado (os-05) — 🟢 CONCLUÍDO

Login como admin da Empresa A, testado em 24/08:

| Teste | HTTP | Resultado |
|---|---|---|
| SELECT OS da Empresa B | 200, 0 registros | ✅ PASS |
| INSERT de OS com `empresa_id` = Empresa B | 403 `42501` bloqueado | ✅ PASS |

Confirma isolamento multi-tenant tanto em leitura quanto em escrita, mesmo sem depender de dado pré-existente na Empresa B — nenhuma OS foi criada na Empresa B.

**🟢 Fase 2.5.1 (Ordens de Serviço) 100% CONCLUÍDA** — SELECT, INSERT, UPDATE (+WITH CHECK), DELETE e isolamento dedicado, todos com 4/4 papéis testados e resultado batendo com a matriz esperada. Papel `gerente` fora de escopo (decisão do usuário).

Matriz esperada (baseada nas policies já confirmadas):

| Operação | proprietário | admin | usuário | sem vínculo |
|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ❌ |
| INSERT | ✅ (confirmado) | ✅ (confirmado) | ✅ (confirmado) | ❌ (confirmado) |
| UPDATE | ✅ | ✅ | ✅ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ |
| Trocar `empresa_id` p/ Empresa B (WITH CHECK) | ❌ | ❌ | ❌ | ❌ |

Papel `gerente` foi deliberadamente deixado de fora deste QA (decisão do usuário) — avaliar separadamente se/quando criar essa conta de teste.

## 4-B. QA funcional — Fase 2.5.3 (fornecedores) — 🟢 QA FUNCIONAL CONCLUÍDO E CORREÇÃO DE INTEGRIDADE MULTIEMPRESA APLICADA/VALIDADA

Mesmo padrão de login real + REST direto usado em 2.5.1/2.5.2.

### Confirmação via SQL — ✅ CONCLUÍDA (24/08/2026)

O usuário rodou o SQL de conferência proposto (pg_policies + rowsecurity + colunas de `fornecedores`) no SQL Editor do Supabase. Resultado:
- **4 policies confirmadas** (uma por operação: SELECT/INSERT/UPDATE/DELETE).
- **RLS ativo** (`rowsecurity = true`).
- **Estrutura e relacionamentos confirmados** (colunas e FKs consistentes com o uso observado no `script.js`).
- **Nenhuma duplicidade encontrada** (sem policies redundantes ou conflitantes).

Os nomes exatos de cada policy/função não foram registrados neste resumo (diferente do detalhamento fino que temos para `ordens_servico`) — se precisarmos deles depois (ex.: para comparar padrões entre tabelas), rodar novamente a query 1 do SQL de conferência e colar o resultado. Para efeito de QA funcional, a matriz abaixo deixa de ser hipótese e passa a ser o comportamento esperado confirmado.

### Uso real no frontend (confirmado via leitura de `script.js`, sem execução)

Todas as 4 operações são usadas ativamente na tela de Fornecedores: SELECT no boot (linha 136), INSERT/UPDATE no handler `salvarFornecedorBtn` (linhas 1126-1138), DELETE em `excluirFornecedor()` (linhas 1143-1145). `fornecedor_id` também é referenciado por `pecas` (relação lógica, não uma policy).

### Matriz esperada (confirmada via SQL em 24/08/2026, deixou de ser hipótese)

| Operação | proprietário | admin | usuário | sem vínculo |
|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ❌ |
| INSERT | ✅ | ✅ | ✅ | ❌ |
| UPDATE | ✅ | ✅ | ✅ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ |
| Trocar `empresa_id` p/ Empresa B (WITH CHECK) | ❌ | ❌ | ❌ | ❌ |

Papel `gerente` fora de escopo, mesma decisão das fases anteriores — não será testado funcionalmente.

#### INSERT (`fornecedores-01-criar.js`) — 🟢 CONCLUÍDO (4/4 papéis, 24/08/2026)

| Papel | HTTP | Resultado | Fornecedor criado |
|---|---|---|---|
| proprietario | 201 | ✅ PASS | `a343e2c3-794b-49c0-9127-9f0277f93609` |
| admin | 201 | ✅ PASS | `8016ca6c-af96-4cd3-b47a-7fb21f899fb5` |
| usuario | 201 | ✅ PASS | `a081953c-7f9c-49c4-91df-a09fdf532bcd` |
| sem_vinculo | 403 (`42501`, RLS) | ✅ PASS (bloqueio confirmado) | — |

3 fornecedores de teste ficam na Empresa QA A (não limpar sem autorização).

#### SELECT (`fornecedores-02-select.js`) — 🟢 CONCLUÍDO (4/4 papéis, 24/08/2026)

| Papel | Empresa A | Empresa B | Resultado |
|---|---|---|---|
| proprietario | 3 registros | 0 | ✅ PASS |
| admin | 3 registros | 0 | ✅ PASS |
| usuario | 3 registros | 0 | ✅ PASS |
| sem_vinculo | 0 | 0 | ✅ PASS (bloqueio confirmado) |

Critérios definidos pelo usuário todos atendidos: proprietario/admin/usuario veem os fornecedores da A, sem_vinculo não vê nada, e nenhum papel recebeu registro de outra empresa. Nenhuma escrita feita — os 3 fornecedores de teste preservados para os próximos testes.

#### UPDATE (`fornecedores-03-update.js`) — 🟢 CONCLUÍDO (4/4 papéis, normal + WITH CHECK, 24/08/2026)

| Papel | Update normal | Trocar empresa_id p/ B (WITH CHECK) | Confirmação pós-teste (via admin) |
|---|---|---|---|
| proprietario | HTTP 200, 1 registro alterado | HTTP 403 `42501` bloqueado | permanece na Empresa A |
| admin | HTTP 200, 1 registro alterado | HTTP 403 `42501` bloqueado | permanece na Empresa A |
| usuario | HTTP 200, 1 registro alterado | HTTP 403 `42501` bloqueado | permanece na Empresa A |
| sem_vinculo | HTTP 200, **0 registros alterados** | HTTP 200, **0 registros alterados** | fornecedor-alvo inalterado |

Todos ✅ PASS conforme os critérios definidos pelo usuário. Nenhum fornecedor foi movido para a Empresa B. Os 3 fornecedores de teste permanecem íntegros na Empresa A para os próximos testes (DELETE, isolamento, vínculo cruzado).

**Observação registrada para o teste 6 (vínculo cruzado):** antes de rodar `fornecedores-06-vinculo-cruzado.js`, confirmar que a conta `sem_vinculo` realmente tem vínculo válido como proprietária da Empresa B — o retorno de 0 registros nas consultas contra a Empresa B pode ser tanto bloqueio de RLS quanto simplesmente tabela vazia, e essa ambiguidade precisa ser resolvida antes de interpretar o resultado do script 6.

#### DELETE (`fornecedores-04-delete.js`) — 🟢 CONCLUÍDO (4/4 papéis, 24/08/2026)

| Papel | HTTP | Resultado | Verificação (via admin) |
|---|---|---|---|
| proprietario | 200 | ✅ PASS | fornecedor `a343e2c3-...` excluído |
| admin | 200 | ✅ PASS | fornecedor `8016ca6c-...` excluído |
| usuario | 200 (0 linhas) | ✅ PASS (bloqueado) | fornecedor `a081953c-...` ainda existe |
| sem_vinculo | 200 (0 linhas) | ✅ PASS (bloqueado) | fornecedor `a081953c-...` ainda existe |

**Estado final:** resta 1 fornecedor de teste na Empresa QA A (`a081953c-...`), sobrevivente das tentativas bloqueadas de usuario/sem_vinculo. Não limpar sem autorização explícita.

#### Isolamento dedicado (`fornecedores-05-isolamento.js`) — 🟢 CONCLUÍDO (24/08/2026)

Login como admin da Empresa A:

| Teste | HTTP | Resultado |
|---|---|---|
| SELECT fornecedores da Empresa B | 200, 0 registros | ✅ PASS |
| INSERT de fornecedor com `empresa_id` = Empresa B | 403 `42501` bloqueado | ✅ PASS |

Todos os critérios definidos pelo usuário atendidos: nenhum fornecedor criado na B, nenhum dado da B retornado. Nenhuma escrita ocorreu neste teste.

### Teste adicional: vínculo cruzado peça (Empresa A) × fornecedor (Empresa B)

Pedido explícito do usuário, além do roteiro padrão. Não é um teste de RLS "consegue acessar direto" (já coberto pelo isolamento) — testa se a tabela `pecas` permite salvar uma referência (`fornecedor_id`) para um fornecedor de **outra** empresa, já que a policy de `pecas` só valida o `empresa_id` da própria peça, não o da empresa do fornecedor referenciado. O script (`fornecedores-06-vinculo-cruzado.js`) cobre 4 passos:
1. Cria um fornecedor de teste na Empresa B (via conta `sem_vinculo`, que é proprietária da B).
2. Tenta salvar uma peça na Empresa A com `fornecedor_id` apontando pro fornecedor da B.
3. Se o vínculo for aceito pelo banco, verifica se o usuário da A consegue ler o fornecedor da B diretamente (deve continuar bloqueado pela RLS de `fornecedores`).
4. Verifica se um `SELECT` da peça com embed do fornecedor (`?select=*,fornecedores(*)`, sintaxe de embed do PostgREST) vaza algum dado do fornecedor da B — esse é o ponto crítico: mesмo que o vínculo cruzado seja permitido, a RLS de `fornecedores` deveria continuar bloqueando o dado dentro do embed.

Resultado esperado (hipótese, sem confirmação prévia — é um teste exploratório): o vínculo provavelmente será aceito (não há constraint visível que impeça), mas o embed deve retornar vazio/nulo porque a RLS de `fornecedores` é avaliada independentemente. Se o embed vazar dado da Empresa B, é uma falha de isolamento a ser corrigida.

### 🟢 EXECUTADO (24/08/2026) — resultado: vínculo aceito, sem vazamento de leitura, mas com falha de integridade

Antes de executar, confirmou-se que a conta `sem_vinculo` (`a27f1e18-...`) tem vínculo `proprietario` ativo com a Empresa B — criado explicitamente em `fixtures-01-reconstrucao.sql` e validado por `fixtures-02-validacao-pos-criacao.sql` (query 3). Executado com o papel **admin** da Empresa A.

| Passo | Resultado |
|---|---|
| 1. Criação do fornecedor na Empresa B | HTTP 201 — id `a63e9f73-12b5-4dd4-b236-174a6e2799fc` |
| 2. Leitura direta do fornecedor B pelo admin da A | HTTP 200, 0 registros (bloqueado) |
| 3. Criar peça na Empresa A com `fornecedor_id` da Empresa B | **HTTP 201 — ACEITO.** Peça criada: id `fa7ef17e-3fff-403c-8c17-648c7a22154c`, `empresa_id` = Empresa A, `fornecedor_id` = fornecedor da Empresa B |
| 4. SELECT da peça com `?select=*,fornecedores(*)` | HTTP 200, campo `fornecedores: null` |
| 5. Vazamento de dado da B no embed? | **Não** — embed retornou `null` |

**Interpretação (critérios definidos pelo usuário): vínculo aceito + fornecedor oculto no embed = não houve vazamento de leitura, porém existe FALHA DE INTEGRIDADE MULTIEMPRESA.** A tabela `pecas` não tem nenhum `CHECK`/trigger que valide que `fornecedor_id` pertence à mesma `empresa_id` da peça. O dado fica "órfão" do ponto de vista funcional (RLS de `fornecedores` protege a leitura, mas a peça referencia um fornecedor que a própria empresa nunca deveria poder enxergar).

**Registros criados neste teste (não limpos, aguardando decisão):**
- Fornecedor de teste na Empresa B: `a63e9f73-12b5-4dd4-b236-174a6e2799fc`
- Peça de teste na Empresa A com vínculo cruzado: `fa7ef17e-3fff-403c-8c17-648c7a22154c`

**Falha corrigida e validada com FK composta; plano concluído em 5/5 passos.**

### Plano de correção (definido com o usuário em 24/08/2026) — 🟢 5/5 PASSOS CONCLUÍDOS

1. **🟢 CONCLUÍDO (24/08/2026).** Criado `UNIQUE (id, empresa_id)` em `fornecedores` + FK composta `NOT VALID` em `pecas(fornecedor_id, empresa_id)` → `fornecedores(id, empresa_id)`. Script: `scripts/fornecedores-07-fix-integridade-01-add-constraint.sql`, executado pelo usuário no SQL Editor (`Success. No rows returned`). `NOT VALID` ativa a proteção pra operações novas sem falhar por causa da peça de teste que já viola a regra.
2. **🟢 CONCLUÍDO (24/08/2026).** Repetido o teste de vínculo cruzado — agora **bloqueado**: HTTP 409, `23503` "insert or update on table \"pecas\" violates foreign key constraint \"pecas_fornecedor_mesma_empresa_fkey\"", "Key is not present in table \"fornecedores\"." A FK composta funcionou: nenhuma peça foi criada. Fornecedor de teste criado neste passo (na Empresa B, pelo próprio script): `7a7c699a-357d-455f-8662-32a2ccab2843`.
3. **🟢 CONCLUÍDO (24/08/2026).** `fornecedor_id` da peça de teste (`fa7ef17e-3fff-403c-8c17-648c7a22154c`) definido como `NULL`, com filtro de 3 colunas (`id` + `empresa_id` + `fornecedor_id` antigo) pra garantir que só essa linha exata fosse afetada. Executado via REST (papel admin), efeito idêntico ao UPDATE SQL especificado pelo usuário. Retornou exatamente 1 linha: `{"id":"fa7ef17e-...","empresa_id":"670162c6-...","fornecedor_id":null}`. A peça continua existindo, só perdeu a referência cruzada.
4. **🟢 CONCLUÍDO (24/08/2026).** `ALTER TABLE public.pecas VALIDATE CONSTRAINT pecas_fornecedor_mesma_empresa_fkey;` rodado pelo usuário — FK composta definitivamente validada (`validated = true`).
5. **🟢 CONCLUÍDO (24/08/2026).** Testado `ON DELETE SET NULL` reutilizando o fornecedor extra `7a7c699a-357d-455f-8662-32a2ccab2843` (criado no reteste do passo 2), com a conta proprietária da Empresa B:
   - Criada peça na Empresa B ligada a esse fornecedor: HTTP 201, id `98a5a921-cb52-46d2-a85e-1f9a2027db1f`.
   - Excluído o fornecedor: HTTP 200, 1 linha excluída (sem 409/23503).
   - Reconsultada a peça: continua existindo, `fornecedor_id: null`.
   - Confirmado: a FK composta não interfere no `ON DELETE SET NULL` da FK simples existente.

**🟢 PLANO DE CORREÇÃO 100% CONCLUÍDO (5/5 passos, 24/08/2026).** A falha de integridade multiempresa encontrada em 2.5.3 está corrigida: `pecas.fornecedor_id` agora só aceita referenciar um fornecedor da mesma `empresa_id`, e o comportamento de exclusão (`SET NULL`) continua intacto.

## 4-C. QA funcional — Fase 2.5.4 (funcionarios) — 🟢 QA FUNCIONAL CONCLUÍDO, correção de integridade multiempresa APLICADA E VALIDADA

### Investigação somente leitura (24/08/2026)

- **Uso no frontend (confirmado em `script.js`):** todas as 4 operações usadas ativamente — SELECT no boot (linha 140), INSERT/UPDATE em `salvarFuncionarioBtn` (linhas 1185-1198), DELETE em `excluirFuncionario()` (linhas 1202-1204).
- **Relacionamento cruzado potencial identificado:** `ordens_servico.funcionario_id` referencia `funcionarios.id` (campo "Responsável" da OS, linhas 683-715 e 885-906 do `script.js`). Mesma classe de risco encontrada em 2.5.3 entre `pecas.fornecedor_id` e `fornecedores` — motivou a criação do teste 6 (vínculo cruzado) e da query 4 do SQL de conferência abaixo.
- **Histórico via git:** só 1 commit relacionado (`7d98047`, "Add funcionarios data handling in script.js", 17/08/2026) — só `script.js`, nenhum SQL versionado.
- **Estado já documentado (não re-verificado via SQL fresco ainda):** `STATUS.md` seção 2 registra SELECT via `usuario_pertence_empresa` e INSERT/UPDATE/DELETE via `usuario_pode_excluir_empresa` — ou seja, diferente de `ordens_servico`/`pecas`/`fornecedores`, aqui `usuario` só teria permissão de leitura.
- **SQL de conferência proposto ao usuário** (pg_policies + rowsecurity + colunas + FKs envolvendo `funcionarios`, incluindo a checagem se `ordens_servico.funcionario_id` já é uma FK composta ou simples) — **ainda não rodado**.

### Matriz esperada (definida pelo usuário, 24/08/2026)

| Operação | proprietário | admin | usuário | sem vínculo |
|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ❌ |
| INSERT | ✅ | ✅ | ❌ | ❌ |
| UPDATE | ✅ | ✅ | ❌ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ |
| Trocar `empresa_id` (WITH CHECK) | ❌ | ❌ | ❌ | ❌ |

Diferente das tabelas anteriores: aqui `usuario` é bloqueado em INSERT/UPDATE/DELETE, só mantém SELECT. Papel `gerente` fora de escopo, mesma decisão das fases anteriores — permissão só inferida pela definição das funções, nunca declarada como comprovada.

### INSERT (`funcionarios-01-criar.js`) — 🟢 CONCLUÍDO (4/4 papéis, 25/08/2026)

Empresa alvo: Empresa QA A (`670162c6-3437-4cd5-b581-0229d57d33e2`).

| Papel | HTTP | Resultado | Funcionário criado |
|---|---|---|---|
| proprietario | 201 | ✅ PASS | `bba38c9d-9f74-4bfe-aab3-e5aa8e607a9e` |
| admin | 201 | ✅ PASS | `7c161412-1687-4756-be27-4c2696eed2b6` |
| usuario | 403 (`42501`, RLS: "new row violates row-level security policy for table \"funcionarios\"") | ✅ PASS (bloqueio confirmado) | — |
| sem_vinculo | 403 (`42501`, RLS: mesma mensagem) | ✅ PASS (bloqueio confirmado) | — |

Resultado bate 100% com a matriz esperada — diferente de `ordens_servico`/`pecas`/`fornecedores`, aqui `usuario` já é bloqueado no INSERT (confirmado funcionalmente, não só pela leitura da função). 2 funcionários de teste ficam na Empresa QA A (`bba38c9d-...` e `7c161412-...`) — não limpar sem autorização explícita. Próximo passo: script 02 (SELECT), ainda não executado por instrução explícita do usuário (parar antes do SELECT). Teste 06 (vínculo cruzado) permanece por último, não pode tocar na OS `97c2709a-...`.

### SELECT (`funcionarios-02-select.js`) — 🟢 CONCLUÍDO (4/4 papéis, 25/08/2026)

| Papel | Empresa A | Empresa B | Resultado |
|---|---|---|---|
| proprietario | 200, 2 registros (`bba38c9d-...`, `7c161412-...`) | 200, 0 registros | ✅ PASS |
| admin | 200, 2 registros (idem) | 200, 0 registros | ✅ PASS |
| usuario | 200, 2 registros (idem) | 200, 0 registros | ✅ PASS |
| sem_vinculo | 200, 0 registros | 200, 0 registros | ✅ PASS (nada retornado em nenhuma empresa) |

Resultado bate 100% com a matriz esperada: proprietario/admin/usuario enxergam os 2 funcionários de teste da Empresa A e nada da Empresa B; sem_vinculo não enxerga nada em nenhuma das duas. `usuario` confirma SELECT liberado mesmo sendo bloqueado em INSERT (mesmo padrão de `ordens_servico`/`pecas`/`fornecedores`).

**Observação (mesma ambiguidade já registrada em 2.5.3 para fornecedores):** a Empresa B ainda não tem nenhum funcionário cadastrado, então o "0 registros" de `sem_vinculo` na Empresa B não distingue bloqueio de RLS de tabela vazia. Isso só será resolvido de fato no teste 06 (vínculo cruzado), quando um funcionário real for criado na Empresa B. Não muda o veredito deste teste (todos os critérios da matriz foram atendidos), é só uma ressalva para interpretação futura.

Nenhuma escrita foi feita neste teste — os 2 funcionários de teste (`bba38c9d-...`, `7c161412-...`) permanecem intactos na Empresa A.

### UPDATE (`funcionarios-03-update.js`) — 🟢 CONCLUÍDO (4/4 papéis, normal + WITH CHECK, 25/08/2026)

Alvo único reutilizado nos 4 papéis (mesmo padrão de `pecas-04`/`fornecedores-03`): funcionário `bba38c9d-9f74-4bfe-aab3-e5aa8e607a9e` (Empresa A).

| Papel | Update normal (`telefone`) | HTTP / corpo | WITH CHECK (`empresa_id` → Empresa B) | HTTP / corpo |
|---|---|---|---|---|
| proprietario | aplicado, `telefone` → `11966660001` | 200, linha retornada com o novo valor | bloqueado | 403 `42501` "new row violates row-level security policy for table \"funcionarios\"" |
| admin | aplicado, `telefone` → `11966660002` | 200, linha retornada com o novo valor | bloqueado | 403 `42501` (mesma mensagem) |
| usuario | não aplicado | 200, corpo `[]` (0 linhas afetadas) | não aplicado | 200, corpo `[]` (0 linhas afetadas) |
| sem_vinculo | não aplicado | 200, corpo `[]` (0 linhas afetadas) | não aplicado | 200, corpo `[]` (0 linhas afetadas) |

**Confirmação posterior do estado real (via SELECT como admin, leitura confiável):** o funcionário `bba38c9d-...` permanece na Empresa A (`empresa_id` inalterado) com `telefone: "11966660002"` — ou seja, o único update que realmente "colou" foi o do admin (o último a rodar); as tentativas de `usuario` e `sem_vinculo` (que tentariam `0003`/`0004`) não tiveram nenhum efeito, confirmando que os HTTP 200 com corpo vazio eram bloqueio silencioso (USING), não sucesso. Nenhuma troca de `empresa_id` se sustentou para nenhum papel. O outro funcionário (`7c161412-...`) não foi tocado neste teste e permanece com `telefone: "11977770000"`.

Resultado bate 100% com a matriz esperada: proprietario/admin conseguem UPDATE normal, usuario/sem_vinculo são bloqueados (mesmo padrão de bloqueio silencioso já visto em `ordens_servico`/`pecas` para papéis sem permissão), e o `WITH CHECK` bloqueia a troca de `empresa_id` para todos os 4 papéis, inclusive proprietario/admin.

Nenhum funcionário de teste foi excluído ou movido de empresa neste teste — ambos continuam na Empresa QA A.

### DELETE (`funcionarios-04-delete.js`) — 🟢 CONCLUÍDO (4/4 papéis, 25/08/2026)

Diferente das fases anteriores (onde 3 registros existiam porque `usuario` também conseguia INSERT), aqui só havia 2 funcionários de teste — `usuario` foi bloqueado no INSERT (seção acima), então não existe um 3º registro "de propriedade do usuario" pra sobreviver ao final, como aconteceu em `ordens_servico`/`pecas`/`fornecedores`. Pra que o bloqueio de `usuario`/`sem_vinculo` fosse testado contra um registro que de fato ainda existia (e não um ID já apagado), a ordem de execução foi: `usuario` → `sem_vinculo` (ambos tentando excluir `bba38c9d-...`, que sobreviveu às duas tentativas) → `proprietario` (exclui `bba38c9d-...` de verdade) → `admin` (exclui `7c161412-...` de verdade). Nenhum funcionário auxiliar foi criado pelo script — `funcionarios-04-delete.js` só recebe um `TARGET_FUNCIONARIO_ID` existente e tenta excluí-lo, não cria nada.

| Papel | ID usado | HTTP | Corpo da resposta | Resultado | Verificação (via admin) |
|---|---|---|---|---|---|
| usuario | `bba38c9d-9f74-4bfe-aab3-e5aa8e607a9e` | 200 | `[]` (0 linhas) | ✅ PASS (bloqueado) | registro ainda existe (`{"id":"bba38c9d-...","nome":"[TESTE] QA Fase 2.5.4 - Funcionário"}`) |
| sem_vinculo | `bba38c9d-9f74-4bfe-aab3-e5aa8e607a9e` | 200 | `[]` (0 linhas) | ✅ PASS (bloqueado) | registro ainda existe (mesmo resultado acima) |
| proprietario | `bba38c9d-9f74-4bfe-aab3-e5aa8e607a9e` | 200 | linha completa retornada (`empresa_id` Empresa A, `telefone: "11966660002"`, `criado_em: 2026-08-25T21:39:40.959953+00:00`) | ✅ PASS | registro **não existe mais** — exclusão efetivada |
| admin | `7c161412-1687-4756-be27-4c2696eed2b6` | 200 | linha completa retornada (`empresa_id` Empresa A, `telefone: "11977770000"`, `criado_em: 2026-08-25T21:39:48.087328+00:00`) | ✅ PASS | registro **não existe mais** — exclusão efetivada |

Resultado bate 100% com a matriz esperada: proprietario e admin excluem, usuario e sem_vinculo são bloqueados silenciosamente (RLS filtra a linha antes do DELETE, sem erro explícito — mesmo padrão do UPDATE bloqueado testado acima).

**Estado final dos dados de teste:** os 2 funcionários de teste da Fase 2.5.4 (`bba38c9d-...`, `7c161412-...`) foram **excluídos como consequência direta e esperada do próprio teste de DELETE** — não é uma limpeza adicional fora de escopo, é o resultado natural de proprietario/admin exercerem uma permissão que a matriz previa. Diferente das fases anteriores, aqui não sobrou nenhum funcionário de teste na Empresa QA A, porque não havia um 3º registro "de usuario" para servir de alvo remanescente. Se for necessário reter um registro para o teste 05 (isolamento) ou 06 (vínculo cruzado), será preciso criar um novo funcionário de teste nesses scripts.

### Isolamento dedicado (`funcionarios-05-isolamento.js`) — 🟢 CONCLUÍDO (25/08/2026)

Login como admin da Empresa A:

| Teste | HTTP | Corpo | Resultado |
|---|---|---|---|
| SELECT funcionarios da Empresa B | 200 | `[]` (0 registros) | ✅ PASS (inconclusivo isoladamente — ver observação abaixo) |
| INSERT de funcionário com `empresa_id` = Empresa B | 403 | `{"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"funcionarios\""}` | ✅ PASS (bloqueado pelo WITH CHECK) |

**Verificação independente de que nada foi criado:** consulta adicional feita com a conta `sem_vinculo` (proprietária legítima da Empresa B, portanto não sujeita a bloqueio de RLS ao ler os próprios dados) confirmou **0 registros em `funcionarios` na Empresa B** — mesmo resultado do SELECT do admin, agora vindo de uma leitura que não pode ser confundida com bloqueio. Confirma que o INSERT bloqueado (403) realmente não deixou nenhum registro na tabela.

**Observação sobre a ambiguidade do SELECT (mesma já registrada no teste 02):** o "0 registros" retornado ao admin da Empresa A para a Empresa B continua, isoladamente, não distinguindo bloqueio de RLS de tabela vazia — a Empresa B nunca teve nenhum funcionário legítimo cadastrado. A confirmação definitiva do isolamento de **leitura** (ou seja, provar que mesmo havendo dado real na B o admin da A não o vê) fica para o teste 06, quando um funcionário legítimo for criado na Empresa B pela conta `sem_vinculo`.

Nenhuma escrita se sustentou neste teste — a Empresa QA A e a Empresa QA B continuam sem nenhum funcionário de teste.

### Teste adicional: vínculo cruzado OS (Empresa A) × funcionário (Empresa B) — 🟢 EXECUTADO (25/08/2026)

Mesmo tipo de teste feito em 2.5.3 (`fornecedores-06`), agora para o par `ordens_servico.funcionario_id` → `funcionarios.id`. Executado com o papel **admin** da Empresa A.

| Passo | HTTP | Resultado |
|---|---|---|
| 1. Criação do funcionário legítimo na Empresa B (via `sem_vinculo`) | 201 | Funcionário `1d39ca25-eb60-4e87-a6a0-441d0e4d0475` criado em `empresa_id` = Empresa B |
| 2. Criar OS **nova e exclusiva** na Empresa A com `funcionario_id` = funcionário da B | 201 — **ACEITO** | OS `4db4b201-a169-4a28-8da8-3b2139b0cf6b` criada, `empresa_id` = Empresa A, `funcionario_id` = `1d39ca25-...` (funcionário da B) |
| 3. Leitura direta do funcionário da B pelo admin da A | 200, 0 registros | Bloqueado (RLS de `funcionarios` funcionando) |
| 4. SELECT da OS com embed `?select=*,funcionarios(*)` | 200 | Campo `"funcionarios": null` — embed vazio |
| 5. Vazamento de dado da B no embed? | — | **Não** — embed retornou `null` |

Corpo completo de cada resposta (reproduzido do output do script):
- Passo 1: `{"id":"1d39ca25-eb60-4e87-a6a0-441d0e4d0475","empresa_id":"069783bc-5f12-4e00-b8ed-d57efca4aa67","nome":"[TESTE] QA Fase 2.5.4 - Funcionário da Empresa B","cargo":"Mecânico","telefone":"11922223333","ativo":true,"criado_em":"2026-08-25T21:59:42.920418+00:00"}`.
- Passo 2: OS completa retornada — `{"id":"4db4b201-a169-4a28-8da8-3b2139b0cf6b","empresa_id":"670162c6-3437-4cd5-b581-0229d57d33e2","cliente_id":"c38d48b5-5ec8-4a31-8bf4-407bb6187155","veiculo_id":null,"descricao":"[TESTE] QA Fase 2.5.4 - OS com funcionário cruzado","mao_de_obra":0,"garantia_dias":0,"status":"pendente","total":0,"criada_em":"2026-08-25T21:59:43.503979+00:00","paga_em":null,"garantia_maodeobra_dias":null,"garantia_pecas_dias":null,"pago":false,"pago_em":null,"data":"2026-08-25","estoque_baixado":false,"cancelada":false,"cancelada_em":null,"funcionario_id":"1d39ca25-eb60-4e87-a6a0-441d0e4d0475"}`.
- Passo 3: `HTTP 200`, `[]` (0 registros).
- Passo 4: mesma OS do passo 2, com `"funcionarios": null` anexado pelo embed.

**Interpretação (mesmos critérios usados em 2.5.3):** o vínculo cruzado foi **aceito** (não há `CHECK`/trigger/FK composta que valide que `funcionario_id` pertence à mesma `empresa_id` da OS), mas **não houve vazamento de leitura** — a RLS de `funcionarios` continua bloqueando tanto a leitura direta quanto o dado dentro do embed do PostgREST. Ou seja: **existe falha de integridade multiempresa, mas não existe falha de confidencialidade/vazamento de dado.** É a mesma classe de problema já encontrada e corrigida em `pecas.fornecedor_id` (seção 4-B) — aqui o par é `ordens_servico.funcionario_id` → `funcionarios.id`.

**Registros criados neste teste:**
- Funcionário de teste na Empresa B: `1d39ca25-eb60-4e87-a6a0-441d0e4d0475` (ainda existe, não foi limpo).
- OS nova de teste na Empresa A com vínculo cruzado: `4db4b201-a169-4a28-8da8-3b2139b0cf6b` — o vínculo cruzado em si foi desfeito pelo plano de correção abaixo (passo 3: `funcionario_id` zerado), a OS em si continua existindo.

**Confirmado: a OS remanescente `97c2709a-8678-4322-a00c-d15129cd0708` (Fase 2.5.1) não foi tocada** — o script cria uma OS nova e exclusiva, nunca reutiliza a antiga.

**A falha de integridade encontrada aqui foi corrigida — ver o plano de correção 100% concluído logo abaixo.**

### Plano de correção 100% concluído (5/5 passos, 25/08/2026)

Mesmo padrão da correção já aplicada em `pecas.fornecedor_id` (seção 4-B), adaptado para `ordens_servico.funcionario_id` → `funcionarios.id`, em 5 passos:

1. **🟢 CONCLUÍDO (25/08/2026).** Criado `UNIQUE (id, empresa_id)` em `funcionarios` (`funcionarios_id_empresa_id_unique`) + FK composta `NOT VALID` em `ordens_servico(funcionario_id, empresa_id)` → `funcionarios(id, empresa_id)` (`ordens_servico_funcionario_mesma_empresa_fkey`), com `ON DELETE SET NULL (funcionario_id)` confirmado na definição. Script: `scripts/funcionarios-07-fix-integridade-01-add-constraint.sql`, executado pelo usuário no SQL Editor do Supabase. A FK simples existente NÃO foi removida. Nenhuma policy de RLS foi alterada.
2. **🟢 CONCLUÍDO (25/08/2026).** Repetido o teste de vínculo cruzado com o script `scripts/funcionarios-08-fix-integridade-02-reteste.js`, papel admin da Empresa A, reusando o funcionário de teste da Empresa B (`1d39ca25-...`). Resultado: **bloqueado pela FK composta**, exatamente como esperado.

   | Item | Resultado |
   |---|---|
   | HTTP do INSERT | 409 |
   | Corpo completo | `{"code":"23503","details":"Key is not present in table \"funcionarios\".","hint":null,"message":"insert or update on table \"ordens_servico\" violates foreign key constraint \"ordens_servico_funcionario_mesma_empresa_fkey\""}` |
   | Classificação do script | ✅ Vínculo cruzado bloqueado pela FK composta `ordens_servico_funcionario_mesma_empresa_fkey` (HTTP 409, código 23503) — passou nas 4 condições exigidas (nenhuma OS criada, HTTP 409, código 23503, nome da constraint citado na mensagem) |
   | Consulta independente (via admin, filtro pela descrição marcadora) | HTTP 200, 0 registros |
   | Nenhuma OS nova criada | ✅ Confirmado |

   Confirmado também: a OS cruzada de teste `4db4b201-...` e a OS protegida `97c2709a-...` não foram tocadas por este script (nem alteradas, nem lidas para escrita).

3. **🟢 CONCLUÍDO (25/08/2026), executado manualmente pelo usuário.** `funcionario_id` da OS de teste cruzada (`4db4b201-a169-4a28-8da8-3b2139b0cf6b`) foi definido como `NULL` por um UPDATE manual autorizado, feito diretamente pelo usuário — é por isso que o snapshot inicial do script 09 (passo 5, abaixo) já encontrou esse campo `null`: o script rodou depois desse UPDATE, não antes. Nenhum outro campo da OS foi alterado por essa ação.
4. **🟢 CONCLUÍDO (25/08/2026), executado e conferido pelo usuário.** `ALTER TABLE public.ordens_servico VALIDATE CONSTRAINT ordens_servico_funcionario_mesma_empresa_fkey;` executado no SQL Editor do Supabase. Consulta de conferência confirmou `validada = true` para essa constraint — os dados existentes foram validados com sucesso contra a FK composta (já sem violação, por conta do passo 3 acima).
5. **🟢 CONCLUÍDO (25/08/2026), validado exclusivamente pelo script `scripts/funcionarios-09-fix-integridade-03-on-delete-set-null.js`.** Este script testou apenas o `ON DELETE SET NULL (funcionario_id)` de ponta a ponta, reaproveitando a própria OS de teste (já com `funcionario_id: null` desde o passo 3): criou um funcionário temporário na Empresa A (`1f3c2b3b-8157-48c3-9d7d-a4da0a801ed2`), vinculou-o à OS (`4db4b201-...`, confirmado via GET), e em seguida excluiu o funcionário. Resultado pós-exclusão: a OS continua existindo, `empresa_id` permanece `670162c6-...` (inalterado), `funcionario_id` voltou a `NULL`, e nenhuma outra coluna mudou (comparação campo a campo entre os snapshots antes/depois do fluxo, excluindo `funcionario_id`). Confirma que a FK composta zera somente a coluna especificada, sem afetar `empresa_id` nem qualquer outro campo da OS.

A falha de integridade multiempresa encontrada no teste de vínculo cruzado (`ordens_servico.funcionario_id` → `funcionarios.id`) está corrigida e validada. Restrições explícitas do usuário respeitadas durante todo o plano: a FK simples existente não foi removida, nenhuma policy de RLS foi alterada, e a OS `97c2709a-...` (Fase 2.5.1) não foi tocada em nenhum dos 5 passos.

### Dados/fixtures que os scripts pretendem reutilizar

| Recurso | ID | Uso |
|---|---|---|
| Empresa QA A | `670162c6-3437-4cd5-b581-0229d57d33e2` | empresa alvo dos testes 01-04 |
| Empresa QA B | `069783bc-5f12-4e00-b8ed-d57efca4aa67` | empresa de isolamento (05) e origem do funcionário cruzado (06) |
| Cliente QA (Empresa A) | `c38d48b5-5ec8-4a31-8bf4-407bb6187155` | necessário pra criar a OS nova no teste 06 |
| Conta proprietario | `torque.owner.qa@gmail.com` | papel de teste |
| Conta admin | `torque.admin.teste@gmail.com` | papel de teste + verificação de DELETE |
| Conta usuario | `torque.usuario.teste@gmail.com` | papel de teste (esperado bloqueado em INSERT/UPDATE/DELETE aqui) |
| Conta sem_vinculo | `torque.sem.vinculo@gmail.com` | papel de teste + proprietária da Empresa B (cria o funcionário legítimo no teste 06) |

Nenhum novo registro foi criado ainda. A OS remanescente `97c2709a-8678-4322-a00c-d15129cd0708` (Fase 2.5.1) está marcada explicitamente nos comentários do script 06 como **não deve ser tocada**.

## 4-D. Fase 2.5.5 (movimentos_caixa) — 🟢 QA FUNCIONAL CONCLUÍDO, CORREÇÃO DE INTEGRIDADE MULTIEMPRESA APLICADA E VALIDADA, CONFERÊNCIA FINAL APROVADA (26/08/2026)

### Uso no frontend (confirmado em `script.js`, sem execução)

Todas as operações usadas ativamente na tela Financeiro:
- **SELECT no boot** (`carregarDados()`, linha 139): `select('*').eq('empresa_id', empresaId)`.
- **INSERT automático ao marcar OS como paga** (`marcarOSPaga()`, linhas 776-780): cria uma movimentação `tipo: 'entrada'`, `categoria: 'os'`, com `os_id` apontando pra OS.
- **DELETE automático ao cancelar OS** (`cancelarOS()`, linhas 812-814): remove a movimentação pelo `os_id`, só se a OS estava paga.
- **INSERT manual de despesa** (`salvarDespesaBtn`, linha 955): `tipo: 'saida'`, categoria escolhida pelo usuário (aluguel/energia/água/funcionários/outro), sem `os_id` nem `peca_id`.
- **DELETE manual de movimentação** (`excluirMovimento()`, linhas 961-964): qualquer linha da tabela, sem distinguir categoria/tipo/origem.
- **INSERT automático ao repor estoque** (`salvarReporBtn`, linhas 1095-1099): `tipo: 'saida'`, `categoria: 'estoque'`, com `peca_id` apontando pra peça reposta.

### Vínculos cruzados potenciais identificados

`movimentos_caixa` tem **duas** colunas que referenciam outras tabelas por id, além de `empresa_id`:
- `os_id` → `ordens_servico.id`
- `peca_id` → `pecas.id`

Mesma classe de risco já encontrada e corrigida em `pecas.fornecedor_id` (2.5.3) e `ordens_servico.funcionario_id` (2.5.4): se essas FKs forem simples (sem checar `empresa_id`), uma movimentação da Empresa A poderia teoricamente referenciar uma OS ou peça de outra empresa. Precisa ser confirmado via SQL (query 4 do script de conferência abaixo) antes de decidir se há necessidade de correção.

**Comportamento observado no frontend que depende do `ON DELETE` dessas FKs, ainda não confirmado via SQL:** `excluirOS()` (linha 785) apaga a OS diretamente e o próprio comentário do aviso ao usuário diz "*O valor já lançado no caixa NÃO é removido*" — ou seja, o app espera que a movimentação sobreviva à exclusão da OS (não é `CASCADE`). Isso sugere `ON DELETE SET NULL` em `os_id` (mesmo padrão adotado para `pecas.fornecedor_id` e `ordens_servico.funcionario_id`) ou nenhuma FK de verdade — mas isso é só uma hipótese do comportamento observado, precisa ser confirmado pela query 4.

### Ausência de controle de acesso no frontend (mesmo padrão das outras telas)

Não há nenhuma lógica de papel/perfil no `script.js` nem ocultação condicional da aba "Financeiro" no `index.html` — o botão "Excluir" em `excluirMovimento()` aparece pra qualquer usuário logado, independente do papel. Confirma que aqui, como nas demais tabelas, o controle de acesso é 100% responsabilidade do RLS do backend (consistente com a regra do projeto de não implementar permissões só visualmente).

### Histórico via git

Nenhum commit relacionado a `movimentos_caixa` encontrado (`git log --all --grep=caixa` sem resultados) — nenhum SQL de policies/estrutura versionado, mesmo padrão das tabelas anteriores.

### SQL de conferência — ✅ EXECUTADO E CONFIRMADO (25/08/2026)

O usuário rodou `scripts/movimentos-caixa-00-conferencia.sql` (100% somente leitura) no SQL Editor do Supabase. Resultado das 5 queries:

**1) Policies (5 no total, nenhuma usa as 3 funções padrão — todas são `EXISTS` direto em `usuarios_empresas`):**

| Policy | Operação | Regra completa |
|---|---|---|
| `caixa_select_proprietario` | SELECT | USING: `EXISTS (SELECT 1 FROM usuarios_empresas ue WHERE ue.empresa_id = movimentos_caixa.empresa_id AND ue.usuario_id = auth.uid() AND ue.ativo = true AND ue.papel = 'proprietario')` |
| `caixa_insert_proprietario` | INSERT | WITH CHECK: mesma expressão acima (papel = `proprietario`), sem restrição de `tipo` |
| `caixa_insert_despesa_admin_gerente` | INSERT | WITH CHECK: `(tipo = 'saida') AND EXISTS (... AND ue.papel = ANY(ARRAY['admin','gerente']))` |
| `caixa_update_proprietario` | UPDATE | USING **e** WITH CHECK: mesma expressão do SELECT (papel = `proprietario`) |
| `caixa_delete_proprietario` | DELETE | USING: mesma expressão do SELECT (papel = `proprietario`) |

**2) RLS:** `rls_ativo = true`, `rls_forcado = false` (padrão — só afeta o dono da tabela, não o app via `anon key`).

**3) Colunas de `movimentos_caixa`:**

| Coluna | Tipo | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `empresa_id` | uuid | NO | — |
| `tipo` | text | NO | — |
| `categoria` | text | NO | — |
| `descricao` | text | YES | — |
| `valor` | numeric | NO | `0` |
| `data` | date | NO | `CURRENT_DATE` |
| `os_id` | uuid | YES | — |
| `peca_id` | uuid | YES | — |
| `created_at` | timestamptz | NO | `now()` |

**4) FKs (com `ON DELETE`):**

| Constraint | Origem → Destino | ON DELETE |
|---|---|---|
| `movimentos_caixa_empresa_id_fkey` | `empresa_id` → `empresas.id` | CASCADE |
| `movimentos_caixa_peca_id_fkey` | `peca_id` → `pecas.id` | SET NULL |
| `movimentos_caixa_os_id_fkey` | `os_id` → `ordens_servico.id` | SET NULL |

Confirma a hipótese do frontend: `os_id`/`peca_id` são FKs **simples**, sem checar `empresa_id` — mesma classe de risco de vínculo cruzado já corrigida em `pecas.fornecedor_id` (2.5.3) e `ordens_servico.funcionario_id` (2.5.4). O `ON DELETE SET NULL` explica por que `excluirOS()` no frontend avisa que "o valor já lançado no caixa NÃO é removido": a movimentação sobrevive à exclusão da OS, só perde a referência.

**5) `UNIQUE(id, empresa_id)` em `ordens_servico`/`pecas`:** `Success. No rows returned` — **nenhuma das duas tem essa constraint hoje** (só `fornecedores` e `funcionarios` têm, das correções da Fase 2.5.3/2.5.4). Informação de planejamento: se decidirmos corrigir o vínculo cruzado de `movimentos_caixa` no mesmo padrão de FK composta, será preciso criar essa `UNIQUE` em `ordens_servico` e/ou `pecas` primeiro (passo adicional que as correções anteriores não precisaram, porque `fornecedores`/`funcionarios` já eram as tabelas "pai" a receber a `UNIQUE`).

### Achados relevantes para o desenho dos testes

- **`usuario` e `sem_vinculo` são bloqueados em TUDO** (SELECT incluído) — diferente de todas as tabelas já testadas nesta fase, onde `usuario` pelo menos lia. Não há nenhuma policy que os contemple.
- **Duas policies de INSERT coexistem** (permissivas, combinadas por OR): `proprietario` insere qualquer `tipo`; `admin`/`gerente` só inserem se `tipo = 'saida'` — ou seja, é esperado que `admin` consiga inserir uma despesa mas seja bloqueado ao tentar inserir uma entrada (algo nunca testado nas fases anteriores, é uma regra condicional a uma coluna, não só ao papel).
- **`gerente` continua fora do escopo dos testes funcionais** (não temos conta de teste desse papel, mesma decisão das fases anteriores) — mas aqui isso importa mais, porque é o único outro papel citado explicitamente numa policy de INSERT além de proprietario/admin.
- **Só `proprietario` pode fazer SELECT** — isso muda o padrão de verificação usado nas fases anteriores: lá, sempre confirmávamos o estado "por fora" usando a conta `admin` (que podia ler mas não necessariamente escrever). Aqui `admin` também não pode ler `movimentos_caixa` — toda verificação de estado real terá que ser feita com a conta `proprietario`.
- **Vínculo cruzado plausível em dois campos** (`os_id` e `peca_id`), não só um — o teste de vínculo cruzado desta fase precisará cobrir ambos.

### Matriz esperada — PROPOSTA em 25/08/2026 (derivada diretamente das policies confirmadas; aprovada pelo usuário em 25/08/2026 e validada por todos os testes funcionais concluídos em 26/08/2026 — ver seção 4-D)

| Operação | proprietário | admin | usuário | sem vínculo |
|---|---|---|---|---|
| SELECT | ✅ | ❌ | ❌ | ❌ |
| INSERT (`tipo='entrada'`) | ✅ | ❌ | ❌ | ❌ |
| INSERT (`tipo='saida'`) | ✅ | ✅ | ❌ | ❌ |
| UPDATE | ✅ | ❌ | ❌ | ❌ |
| DELETE | ✅ | ❌ | ❌ | ❌ |
| Trocar `empresa_id` (WITH CHECK, proprietario) | ❌ (esperado, mesmo padrão das outras tabelas — a policy reavalia o papel do usuário para a empresa de destino) | — | — | — |

`gerente` fora de escopo (sem conta de teste), mesma decisão das fases anteriores — a policy sugere que teria a mesma permissão de INSERT `tipo='saida'` que `admin`, mas isso não será comprovado funcionalmente.

**Convertida em matriz definitiva e aprovada pelo usuário em 25/08/2026** (escopo de 8 grupos de teste, ver "Escopo de testes aprovado" abaixo) **e validada na prática por todos os scripts funcionais, concluídos em 26/08/2026** (ver seção 4-D).

### Próximos passos

1. ~~Usuário roda `movimentos-caixa-00-conferencia.sql` e traz o resultado.~~ ✅ feito.
2. ~~Usuário confirma (ou ajusta) a matriz proposta acima.~~ ✅ aprovada em 25/08/2026, com escopo de 8 grupos de teste definido pelo usuário (ver abaixo).
3. 🟡 **Scripts de QA funcional criados e execução iniciada (25/08/2026) — PAUSADA por uma anomalia encontrada.** Ver seção 4-E.

### ⚠️ Anomalia encontrada e NÃO resolvida — INSERT de `admin` com `tipo='saida'` bloqueado (25/08/2026)

Ao rodar `movimentos-caixa-03-insert-saida.js`, o papel `admin` foi **bloqueado** (HTTP 403, `42501`) tentando inserir uma movimentação com `tipo='saida'` — contradizendo a matriz esperada, que previa sucesso com base na policy `caixa_insert_despesa_admin_gerente` confirmada via SQL.

Investigação feita para isolar a causa (todas as hipóteses abaixo foram **descartadas**):
1. Policy `caixa_insert_proprietario` ser **restritiva** em vez de permissiva (o que forçaria toda linha a também satisfazer `papel='proprietario'`) → descartado, `pg_policies.permissive` confirma **PERMISSIVE** para as 5 policies.
2. Vínculo do admin em `usuarios_empresas` incorreto (papel errado, empresa errada, inativo) → descartado, consulta direta confirmou `usuario_id=59482850-...`, `empresa_id=670162c6-...` (Empresa A), `papel='admin'`, `ativo=true`.
3. `roles` da policy não incluir a role usada pela sessão autenticada → descartado, `roles = {public}` em todas.
4. A condição da policy, com os valores literais reais (sem depender de `auth.uid()`), avaliada diretamente: `EXISTS (... papel = ANY(ARRAY['admin','gerente']))` com os valores reais do admin → **retornou `true`**.

Ou seja: **cada peça da condição, isoladamente, está correta** — mas a requisição HTTP real do admin (mesmo token que funciona normalmente em todas as outras tabelas desta mesma sessão) continua sendo bloqueada. Não há mais nenhuma verificação somente-leitura que eu consiga fazer sem acesso direto ao banco para simular o contexto exato de `auth.uid()` numa sessão autenticada real.

**Próximo passo proposto (aguardando o usuário):** testar diretamente no app rodando localmente (`http://localhost:53170`), logado como `torque.admin.teste@gmail.com`, se cadastrar uma despesa (Financeiro → "+ Nova despesa") também falha. Se falhar ali também, é um **bug de produção real** no módulo financeiro para o papel `admin` (mesma classe de achado do módulo de peças na Fase 2.5.2, que estava quebrado em produção por falta de policies) — não um problema do script de teste.

**Execução dos scripts pausada** até esclarecer esta anomalia. Scripts 02 (INSERT entrada), 01 (SELECT), 04 (UPDATE), 05 (DELETE), 06 (isolamento), 07 e 08 (vínculo cruzado) ainda não rodaram.

### ✅ Script 03 (INSERT `tipo='saida'`) — concluído e aprovado (26/08/2026)

A anomalia acima foi esclarecida. São **duas causas distintas**, não uma só:

**a) Problema do script 03 (raiz do bloqueio do `admin` no teste):** o script usava fetch cru com `Prefer: return=representation`, forçando o PostgREST a tentar devolver a linha criada — o que exige SELECT, e `admin` não tem policy de SELECT em `movimentos_caixa`. Corrigido trocando para `Prefer: return=minimal`, com leitura defensiva do corpo (`text()` + `JSON.parse` condicional) e classificação por `insResp.ok` (sem depender de linha retornada). Reexecutado com sucesso:

| Papel | HTTP | Resultado |
|---|---|---|
| proprietario | 201 | ✅ Aceito |
| admin | 201 | ✅ Aceito |
| usuario | 403 (`42501`) | ❌ Bloqueado (esperado) |
| sem_vinculo | 403 (`42501`) | ❌ Bloqueado (esperado) |

Bate 100% com a matriz esperada da seção 4-D. Confirmado por SELECT independente via proprietario (único papel com SELECT nesta tabela) que os registros existem de fato:
- `a07c3b4a-8453-4844-bd5f-4392d210a1b4` — `[TESTE] QA Fase 2.5.5 - saida por proprietario`, valor 50, criado em 26/08/2026.
- `3ca638ba-a5d9-41a9-8675-6dab3313916a` — `[TESTE] QA Fase 2.5.5 - saida por admin`, valor 50, criado em 26/08/2026.

O movimento preservado de execução anterior, `fa281de3-42ea-4834-8745-c894f1987461`, continua existente e intacto — confirmado na mesma consulta.

**b) Problema real do app local (achado à parte, NÃO é o mesmo bug do script):** testado diretamente no app (`http://localhost:53170`) como admin, o cadastro de despesa também falha com HTTP 403/42501 — mas por uma causa diferente e mais estrutural. `iniciarApp()` (`script.js:88-98`) resolve a empresa ativa (`empresaId`) só por `empresas.owner_id = auth.uid()`, **sem nunca consultar `usuarios_empresas`**. O admin de teste possui uma empresa própria legada (`825c05d9-...`, "Admim") onde não tem nenhum vínculo em `usuarios_empresas` — por isso o app sempre envia `empresa_id` errado (o da "Admim", não o da Empresa QA A `670162c6-...`, onde o vínculo `papel='admin', ativo=true` realmente existe). Confirmado por leitura: `usuarios_empresas` desse admin só tem 1 linha, ligada à Empresa QA A; nenhum registro de diagnóstico (`[TESTE] QA Fase 2.5.5 - app admin diagnóstico`) chegou a ser criado.

**Decisão do usuário (26/08/2026): a correção do app fica adiada para a Fase 3 — Contexto da empresa.** Não alterar `iniciarApp()`, policies ou vínculos nesta Fase 2.5.5. Na Fase 3, a seleção de empresa ativa precisará ser feita via `usuarios_empresas`, cobrindo o caso de usuário com múltiplos vínculos — sem escolher arbitrariamente o primeiro nem apenas priorizar `proprietario`. Confirmado nesta investigação: a coluna correta é `usuarios_empresas.usuario_id` (não `user_id`) — usar esse nome em qualquer código futuro da Fase 3.

### ✅ Script 01 (SELECT) — concluído e aprovado (26/08/2026)

Executado com os dados já criados pelo script 03 (nenhuma dependência do script 02, conforme já anotado no cabeçalho do script 01):

| Papel | HTTP | Registros |
|---|---|---|
| proprietario | 200 | 3 |
| admin | 200 | 0 |
| usuario | 200 | 0 |
| sem_vinculo | 200 | 0 |

Os 3 registros retornados para proprietario incluem os IDs esperados: `fa281de3-42ea-4834-8745-c894f1987461`, `a07c3b4a-8453-4844-bd5f-4392d210a1b4` e `3ca638ba-a5d9-41a9-8675-6dab3313916a`. Comportamento de **bloqueio silencioso via RLS confirmado** para `admin`/`usuario`/`sem_vinculo` (HTTP 200 + array vazio, não 403) — como previa a policy `caixa_select_proprietario`. Resultado bate 100% com a matriz esperada da seção 4-D.

### ✅ Script 02 (INSERT `tipo='entrada'`) — concluído e aprovado (26/08/2026)

Já executado com o padrão `return=minimal` (mesmo ajuste validado no script 03, aplicado aqui antes da primeira execução — sem passar pela anomalia do `return=representation`):

| Papel | HTTP | Resultado |
|---|---|---|
| proprietario | 201 | ✅ Aceito |
| admin | 403 (`42501`) | ❌ Bloqueado |
| usuario | 403 (`42501`) | ❌ Bloqueado |
| sem_vinculo | 403 (`42501`) | ❌ Bloqueado |

Bate 100% com a matriz esperada: só `proprietario` tem policy que permite `tipo='entrada'` (`caixa_insert_proprietario`); `admin` não é coberto aqui porque `caixa_insert_despesa_admin_gerente` exige `tipo='saida'`. Confirmado por SELECT independente via proprietario: 1 registro criado, `ce8357c2-179c-4009-8c46-cf2b33f96c62` (`[TESTE] QA Fase 2.5.5 - entrada por proprietario`, valor 100), e 0 registros para as descrições de admin/usuario/sem_vinculo.

### ✅ Script 04 (UPDATE) — concluído e aprovado (26/08/2026)

Corrigido antes de rodar para o mesmo padrão `return=minimal` (com confirmação do próprio UPDATE do proprietario feita via SELECT independente, já que `return=minimal` não devolve mais a linha no corpo do PATCH). Alvo: `TARGET_MOVIMENTO_ID=ce8357c2-179c-4009-8c46-cf2b33f96c62` (movimentação `entrada` do proprietario, criada pelo script 02).

| Papel | HTTP do PATCH | Resultado (confirmado por SELECT como proprietario) |
|---|---|---|
| proprietario | 204 | ✅ Aplicado — `descricao` = `[TESTE] QA Fase 2.5.5 - editado por proprietario` |
| admin | 204 | ✅ Bloqueado — `descricao` inalterada |
| usuario | 204 | ✅ Bloqueado — `descricao` inalterada |
| sem_vinculo | 204 | ✅ Bloqueado — `descricao` inalterada |

**Achado relevante confirmado na prática:** com `return=minimal`, as 4 chamadas de PATCH retornam HTTP 204 — inclusive as 3 bloqueadas pela RLS. O status HTTP do PATCH sozinho **não** distingue "linha realmente alterada" de "0 linhas afetadas por bloqueio de policy"; só a releitura via SELECT independente do proprietario (feita após cada tentativa) prova o estado real. Estado final do registro: `descricao = "[TESTE] QA Fase 2.5.5 - editado por proprietario"`, demais campos (`tipo`, `categoria`, `valor`, `data`, `empresa_id`) inalterados. Bate 100% com a matriz esperada.

### ✅ Script 05 (DELETE) — concluído e aprovado (26/08/2026)

Alvo: `TARGET_MOVIMENTO_ID=ce8357c2-179c-4009-8c46-cf2b33f96c62` (o mesmo registro editado pelo script 04). Ajustado antes de rodar para `return=minimal` em todos os DELETEs, com pré-checagem via SELECT antes de qualquer exclusão e `process.exit(1)` se a confirmação final ainda encontrasse o registro.

| Etapa | HTTP DELETE | Confirmação via SELECT (proprietario) |
|---|---|---|
| Pré-checagem | — | 200, 1 registro, `descricao` conferida ✅ |
| usuario | 204 | registro preservado ✅ |
| sem_vinculo | 204 | registro preservado ✅ |
| admin | 204 | registro preservado ✅ |
| proprietario | 204 | `[]` — registro excluído ✅ |

**Achado relevante confirmado na prática:** as 4 chamadas de DELETE (as 3 bloqueadas e a real do proprietario) retornaram o mesmo HTTP 204 — **HTTP 204 sozinho não comprova exclusão**; só a releitura via SELECT independente do proprietario, feita após cada tentativa, prova se a linha foi de fato removida ou não. Bate 100% com a matriz esperada (só `proprietario` tem `caixa_delete_proprietario`).

Registro `ce8357c2-179c-4009-8c46-cf2b33f96c62` foi **removido intencionalmente** por este teste (exclusão real e definitiva pelo proprietario, dentro do escopo autorizado). Os demais registros de teste permanecem preservados: `fa281de3-42ea-4834-8745-c894f1987461`, `a07c3b4a-8453-4844-bd5f-4392d210a1b4` e `3ca638ba-a5d9-41a9-8675-6dab3313916a` — nenhum foi tocado por este script (filtro estrito por `id` em todas as chamadas).

### ✅ Script 06 (isolamento Empresa A × B) — concluído e aprovado (26/08/2026)

**Primeira tentativa abortada com segurança na pré-condição**, antes de qualquer acesso a `movimentos_caixa`: a consulta a `usuarios_empresas` filtrando só por `empresa_id` (premissa "RLS self-only", herdada da Fase 2.5.1) retornou **todos os vínculos visíveis da empresa** (3 linhas para a Empresa A: admin, usuario e proprietario), não apenas a linha do próprio usuário autenticado — o critério `length === 1` do script rejeitou isso, abortando antes de tocar em qualquer dado de `movimentos_caixa`. **Correção aplicada:** filtro explícito por `usuario_id` (do próprio `login().user.id`) **e** `empresa_id` na consulta a `usuarios_empresas`, isolando corretamente a linha do usuário autenticado independente de quantos outros vínculos a empresa tenha.

Reexecutado com a correção — pré-condições confirmadas:

| Pré-condição | Resultado |
|---|---|
| proprietario × Empresa A | HTTP 200, 1 vínculo próprio, papel `proprietario`, ativo=true ✅ |
| proprietario × Empresa B | HTTP 200, `[]` (nenhum vínculo) ✅ |
| sem_vinculo × Empresa B | HTTP 200, 1 vínculo próprio, papel `proprietario`, ativo=true ✅ |

Teste de isolamento:

| Etapa | Resultado |
|---|---|
| SELECT cruzado (proprietario da A → Empresa B) | HTTP 200, `[]` ✅ |
| INSERT cruzado (proprietario da A → `empresa_id` = Empresa B) | HTTP 403, código `42501` ✅ |
| Confirmação final (dona real da Empresa B, `sem_vinculo`) | HTTP 200, `[]` ✅ |

Nenhum registro indevido foi criado na Empresa B. **Isolamento de `movimentos_caixa` entre Empresa A e Empresa B aprovado.**

### 🚨 Script 07 (vínculo cruzado via `os_id`) — executado em 26/08/2026, falha de integridade confirmada

Mesma classe de falha já encontrada e corrigida em `pecas.fornecedor_id` (Fase 2.5.3) e `ordens_servico.funcionario_id` (Fase 2.5.4) — aqui em `movimentos_caixa.os_id`.

**Registros criados (todos preservados, nenhuma limpeza automática):**
- Cliente na Empresa B: `63194a33-ea2e-4065-9d7c-1337f264ba6d`
- OS na Empresa B: `133a218d-507f-4e22-830a-7600e813acf7`
- Movimento cruzado na Empresa A: `70e22929-8220-4532-b946-29e34b032536` (`os_id` aponta para a OS da Empresa B acima)

**🚨 FALHA DE INTEGRIDADE MULTIEMPRESA CONFIRMADA:** o INSERT do movimento na Empresa A com `os_id` de uma OS da Empresa B foi **aceito** pelo banco (HTTP 201) e confirmado por SELECT independente do proprietario da A — a FK `movimentos_caixa_os_id_fkey` é simples, sem checar `empresa_id`, mesma lacuna já mapeada na seção 4-D.

**Sem vazamento de leitura confirmado:**
- SELECT direto da OS B pelo proprietario da A: HTTP 200, `[]`.
- Embed (`?select=*,ordens_servico(*)`) na movimentação cruzada: HTTP 200, `ordens_servico: null`.

**Nenhuma constraint, UNIQUE ou correção foi aplicada nesta etapa.** Correção fica pendente até concluir também o teste de vínculo cruzado por `peca_id` (script 08), para desenhar um único plano de correção cobrindo os dois campos (`os_id` e `peca_id`), mesmo padrão adotado em `pecas`/`funcionarios`.

### 🚨 Script 08 (vínculo cruzado via `peca_id`) — executado em 26/08/2026, falha de integridade confirmada

Mesma classe de falha do script 07, agora em `movimentos_caixa.peca_id`.

**Registros criados (todos preservados, nenhuma limpeza automática):**
- Peça na Empresa B: `4b8c7193-4e20-413e-8f04-c6afa228dd65`
- Movimento cruzado na Empresa A: `335d3415-77cd-497c-95f0-0e19d3335a47` (`peca_id` aponta para a peça da Empresa B acima)

**🚨 FALHA DE INTEGRIDADE MULTIEMPRESA CONFIRMADA:** o INSERT do movimento na Empresa A com `peca_id` de uma peça da Empresa B foi **aceito** pelo banco (HTTP 201) e confirmado por SELECT independente do proprietario da A — `movimentos_caixa_peca_id_fkey` também é uma FK simples, sem checar `empresa_id`.

**Sem vazamento de leitura confirmado:**
- SELECT direto da peça B pelo proprietario da A: HTTP 200, `[]`.
- Embed (`?select=*,pecas(*)`) na movimentação cruzada: HTTP 200, `pecas: null`.

**Nenhuma correção foi aplicada.** Com os testes de `os_id` (script 07) e `peca_id` (script 08) concluídos, ambas as falhas de integridade multiempresa em `movimentos_caixa` estão confirmadas e documentadas, prontas para planejamento conjunto de correção.

### ✅ SQL de planejamento (`movimentos-caixa-10-planejamento-integridade.sql`) — executado pelo usuário, resultado confirmado (26/08/2026)

100% somente leitura, rodado pelo usuário no SQL Editor do Supabase. Resultado dos 7 blocos:

- **Bloco A (constraints de `movimentos_caixa`):** as FKs de `os_id` (`movimentos_caixa_os_id_fkey`) e `peca_id` (`movimentos_caixa_peca_id_fkey`) confirmadas como **simples e validadas** — sem checar `empresa_id`, mesma lacuna já mapeada na seção 4-D.
- **Bloco B (UNIQUE em `ordens_servico`/`pecas`):** confirmado — **nenhuma das duas tem `UNIQUE(id, empresa_id)`** hoje (mesmo achado de planejamento já registrado na seção 4-D, query 5 do script 00).
- **Bloco C/E (vínculos cruzados reais por `os_id`):** **exatamente 1** vínculo cruzado encontrado.
- **Bloco D/E (vínculos cruzados reais por `peca_id`):** **exatamente 1** vínculo cruzado encontrado.
- **Bloco F (evidências):** confirmados os 2 movimentos de evidência — `70e22929-8220-4532-b946-29e34b032536` (os_id cruzado, script 07) e `335d3415-77cd-497c-95f0-0e19d3335a47` (peca_id cruzado, script 08) — nenhum vínculo cruzado adicional além desses dois.
- **Bloco G (versão do Postgres):** **PostgreSQL 17.6** — suporta a sintaxe de coluna específica em `ON DELETE SET NULL (coluna)` dentro de uma FK composta (recurso do Postgres 15+).

### ✅ Passo 1 do plano de correção — executado com sucesso (26/08/2026)

`movimentos-caixa-11-fix-integridade-01-constraints.sql` rodado pelo usuário no SQL Editor do Supabase, dentro de uma única transação `BEGIN`/`COMMIT`:

| Constraint | Tipo | Validada |
|---|---|---|
| `ordens_servico_id_empresa_unique` | `UNIQUE(id, empresa_id)` | ✅ `true` |
| `pecas_id_empresa_unique` | `UNIQUE(id, empresa_id)` | ✅ `true` |
| `movimentos_caixa_os_mesma_empresa_fkey` | FK composta `(os_id, empresa_id)` | ⏳ `false` (`NOT VALID`, intencional) |
| `movimentos_caixa_peca_mesma_empresa_fkey` | FK composta `(peca_id, empresa_id)` | ⏳ `false` (`NOT VALID`, intencional) |

As FKs simples antigas (`movimentos_caixa_os_id_fkey`, `movimentos_caixa_peca_id_fkey`) foram removidas e substituídas pelas compostas. **As FKs compostas já protegem qualquer INSERT/UPDATE novo** contra vínculo cruzado (efeito imediato do `NOT VALID`, mesmo sem validação retroativa). As duas evidências antigas (`70e22929-...`, `335d3415-...`) permanecem preservadas e intocadas, como esperado (a criação `NOT VALID` não varre nem falha sobre linhas já existentes).

### ✅ Script 12 (reteste FK composta `os_id`) — concluído e aprovado (26/08/2026)

Reutilizou a OS `133a218d-...` da Empresa B já existente (evidência do script 07), sem criar nada novo. Tentativa de INSERT cruzado na Empresa A:

- **HTTP 409, código `23503`**, mensagem citando explicitamente `movimentos_caixa_os_mesma_empresa_fkey` — a FK composta bloqueou o vínculo cruzado, diferente do resultado do script 07 (antes da correção, HTTP 201/aceito).
- SELECT independente pela descrição do reteste: HTTP 200, `[]` — **nenhum movimento novo foi criado**.
- Evidência antiga `70e22929-8220-4532-b946-29e34b032536` **continua existente**, com `os_id = 133a218d-507f-4e22-830a-7600e813acf7` **intacto** — a FK `NOT VALID` não afetou o registro pré-existente, como esperado.
- FK composta `movimentos_caixa_os_mesma_empresa_fkey` continua `NOT VALID` — nenhuma validação retroativa foi aplicada.

**Correção de `os_id` confirmada funcionalmente. Falta o mesmo reteste para `peca_id`.**

### ✅ Script 13 (reteste FK composta `peca_id`) — concluído e aprovado (26/08/2026)

Mesmo padrão do script 12, reutilizando a peça `4b8c7193-...` da Empresa B (evidência do script 08), sem criar nada novo:

- **HTTP 409, código `23503`**, mensagem citando explicitamente `movimentos_caixa_peca_mesma_empresa_fkey`.
- SELECT independente pela descrição do reteste: HTTP 200, `[]` — **nenhum movimento novo foi criado**.
- Evidência antiga `335d3415-77cd-497c-95f0-0e19d3335a47` **continua existente**, com `peca_id = 4b8c7193-4e20-413e-8f04-c6afa228dd65` **intacto**.
- FK composta `movimentos_caixa_peca_mesma_empresa_fkey` continua `NOT VALID`.

**Os dois retestes (`os_id`, script 12, e `peca_id`, script 13) foram aprovados.** A correção bloqueia novos vínculos cruzados nos dois campos, com as evidências antigas preservadas.

### 🟢 Passo 4 (ajuste das evidências) e Passo 5 (VALIDATE CONSTRAINT) — concluídos (26/08/2026)

`movimentos-caixa-14-fix-integridade-04-ajuste-evidencias.sql` executado pelo usuário no SQL Editor do Supabase. As duas evidências antigas foram **preservadas como movimentos** (nenhum `DELETE`), só tiveram o vínculo inválido zerado:

- `70e22929-8220-4532-b946-29e34b032536`: `os_id = null` (era `133a218d-...`).
- `335d3415-77cd-497c-95f0-0e19d3335a47`: `peca_id = null` (era `4b8c7193-...`).

**Execução real teve uma primeira tentativa parcial**, por cópia incorreta no SQL Editor: o UPDATE do primeiro movimento (`os_id`) foi aplicado normalmente, mas o do segundo (`peca_id`) não chegou a rodar naquela tentativa, deixando-o intacto. Em seguida, o usuário aplicou manualmente um segundo `UPDATE` condicional com `RETURNING` só para o segundo movimento, completando o ajuste. Estado final de ambos confirmado correto (`os_id`/`peca_id` nulos, demais colunas intactas).

**Validação final:** consulta de conferência confirmou **exatamente 0 vínculos cruzados** por `os_id` e **0** por `peca_id` em toda a tabela — as duas únicas ocorrências (as evidências) foram neutralizadas, nenhuma outra existia.

Com o estado das 2 evidências corrigido, o usuário executou `VALIDATE CONSTRAINT` para as duas FKs compostas, com sucesso:

| Constraint | Validada |
|---|---|
| `movimentos_caixa_os_mesma_empresa_fkey` | ✅ `true` |
| `movimentos_caixa_peca_mesma_empresa_fkey` | ✅ `true` |

As definições das duas FKs compostas mantêm `ON DELETE SET NULL` **somente** nas colunas `os_id`/`peca_id` respectivamente (não em `empresa_id`), confirmando que a exclusão futura de uma OS ou peça referenciada zera só o vínculo, preservando o movimento e sua `empresa_id`.

**🟢 A falha de integridade multiempresa em `movimentos_caixa.os_id`/`peca_id` está corrigida e totalmente validada — mesmo padrão de conclusão já usado em `pecas.fornecedor_id` (Fase 2.5.3) e `ordens_servico.funcionario_id` (Fase 2.5.4).**

### ✅ Script 15 (validação de ponta a ponta do `ON DELETE SET NULL`) — concluído e aprovado (26/08/2026)

Criações controladas na Empresa A, com pré-checagem de duplicidade (5/5) e validação de vínculo do proprietario antes de qualquer criação:

| Registro | ID | Estado final |
|---|---|---|
| Cliente temporário | `b13bf8c2-d8da-403b-9021-f3c727edaa76` | ✅ Preservado |
| OS temporária | `665c1116-8b29-4403-8b08-e74a33c9e2d4` | ❌ Excluída intencionalmente (parte do teste) |
| Movimento (ligado à OS) | `618681f7-28bb-43e9-ac43-653bbabad708` | ✅ Preservado — `os_id` passou para `null`, `empresa_id` e demais colunas permaneceram intactos (comparado ao snapshot capturado antes da exclusão) |
| Peça temporária | `8f34b4ff-1da9-49d6-a9bd-79fa261c6831` | ❌ Excluída intencionalmente (parte do teste) |
| Movimento (ligado à peça) | `16c8ef47-b08a-45ee-9ba1-467ebd622326` | ✅ Preservado — `peca_id` passou para `null`, `empresa_id` e demais colunas permaneceram intactos |

**`EXIT_CODE=0`.** `ON DELETE SET NULL (os_id)` e `ON DELETE SET NULL (peca_id)` das FKs compostas **validados de ponta a ponta**: ao excluir a OS/peça referenciada, só a coluna de vínculo do movimento é zerada, o resto (inclusive `empresa_id`) permanece intacto. Nenhum registro preexistente foi tocado.

### 🟢 Conferência final (script 16) — APROVADA (26/08/2026)

`movimentos-caixa-16-conferencia-final.sql` executado pelo usuário no SQL Editor do Supabase, 100% somente leitura. Resultado dos 7 blocos:

- **Bloco A (RLS):** `rls_ativo = true`, `rls_forcado = false`.
- **Bloco B (policies):** confirmadas **exatamente as 5 policies esperadas** (`caixa_select_proprietario`, `caixa_insert_proprietario`, `caixa_insert_despesa_admin_gerente`, `caixa_update_proprietario`, `caixa_delete_proprietario`), operações e expressões batendo com o mapeamento original da seção 4-D.
- **Bloco C (UNIQUEs):** `ordens_servico_id_empresa_unique` validada `true`; `pecas_id_empresa_unique` validada `true`.
- **Bloco D (FKs compostas):** `movimentos_caixa_os_mesma_empresa_fkey` validada `true`; `movimentos_caixa_peca_mesma_empresa_fkey` validada `true`; definições confirmam `ON DELETE SET NULL` apenas nas colunas `os_id`/`peca_id` respectivamente (não em `empresa_id`).
- **Bloco E (vínculos cruzados):** `os_id = 0`, `peca_id = 0` — nenhum vínculo cruzado remanescente em toda a tabela.
- **Bloco F (7 movimentos relevantes):** todos os 7 existem, todos pertencem à Empresa A, `os_id`/`peca_id` conferindo com o esperado (nulos onde deveriam estar).
- **Bloco G:** cliente `b13bf8c2-...` existe; OS `665c1116-...` não existe; peça `8f34b4ff-...` não existe — exatamente o estado esperado após o script 15.

**🟢 Fase 2.5.5 (movimentos_caixa) — CONCLUÍDA.** **Correção de integridade multiempresa `os_id`/`peca_id` — CONCLUÍDA.** **Conferência final — APROVADA.**

### Escopo de testes aprovado pelo usuário (25/08/2026)

1. SELECT para os 4 papéis.
2. INSERT `entrada` para os 4 papéis.
3. INSERT `saida` para os 4 papéis.
4. UPDATE para os 4 papéis.
5. DELETE para os 4 papéis.
6. Isolamento entre Empresa A e Empresa B.
7. Vínculo cruzado por `os_id`.
8. Vínculo cruzado por `peca_id`.

Regras explícitas do usuário pra esses testes: nos bloqueios de UPDATE/DELETE, sempre confirmar o estado real via `proprietario` (único papel com SELECT) antes de dar o teste como aprovado — o HTTP 200 com `[]` do PostgREST não é suficiente sozinho. Vínculo cruzado de `os_id` e `peca_id` testados separadamente. Nenhuma `UNIQUE`, FK composta ou correção de dados deve ser criada nesta etapa, mesmo que os vínculos cruzados sejam aceitos.

### Dados de teste criados até agora (não limpos)

- 1 movimentação `saida` na Empresa QA A, criada pelo proprietario (execução anterior, preservada): `fa281de3-42ea-4834-8745-c894f1987461` (`[TESTE] QA Fase 2.5.5 - saida por proprietario`, valor 50).
- 2 movimentações `saida` na Empresa QA A, criadas pelo script 03 já corrigido e aprovado (26/08/2026): `a07c3b4a-8453-4844-bd5f-4392d210a1b4` (proprietario) e `3ca638ba-a5d9-41a9-8675-6dab3313916a` (admin), ambas valor 50.
- 1 movimentação `entrada` criada pelo script 02 (`ce8357c2-179c-4009-8c46-cf2b33f96c62`), editada pelo script 04 e **removida intencionalmente pelo script 05** (26/08/2026) — não existe mais, exclusão fazia parte do próprio teste de DELETE.

### Scripts preparados (ver seção 5) — status de execução

- `movimentos-caixa-01-select.js` — 🟢 concluído e aprovado (26/08/2026): proprietario 3 registros, admin/usuario/sem_vinculo 0 registros (bloqueio silencioso via RLS).
- `movimentos-caixa-02-insert-entrada.js` — 🟢 concluído e aprovado (26/08/2026): proprietario 201 (confirmado), admin/usuario/sem_vinculo 403/42501.
- `movimentos-caixa-03-insert-saida.js` — 🟢 concluído e aprovado (26/08/2026): proprietario/admin aceitos (201), usuario/sem_vinculo bloqueados (403) — ver seção de resolução acima.
- `movimentos-caixa-04-update.js` — 🟢 concluído e aprovado (26/08/2026): proprietario aplicado, admin/usuario/sem_vinculo bloqueados (confirmado por SELECT, HTTP 204 sozinho não é conclusivo).
- `movimentos-caixa-05-delete.js` — 🟢 concluído e aprovado (26/08/2026): usuario/sem_vinculo/admin bloqueados (HTTP 204 mas registro preservado), proprietario excluiu de fato (confirmado por SELECT retornando `[]`).
- `movimentos-caixa-06-isolamento.js` — 🟢 concluído e aprovado (26/08/2026): pré-condição corrigida (filtro usuario_id+empresa_id), SELECT/INSERT cruzados bloqueados, isolamento confirmado.
- `movimentos-caixa-07-vinculo-cruzado-os.js` — 🚨 executado em 26/08/2026, falha de integridade multiempresa confirmada (`os_id` aceita OS de outra empresa), sem vazamento de leitura; correção pendente até o script 08.
- `movimentos-caixa-08-vinculo-cruzado-peca.js` — 🚨 executado em 26/08/2026, falha de integridade multiempresa confirmada (`peca_id` aceita peça de outra empresa), sem vazamento de leitura.

## 5. Scripts prontos (nesta pasta `scripts/`)

Todos já atualizados com os IDs dos fixtures novos (Empresa QA A/B, cliente QA):

- `fixtures-00-precheck-colunas.sql` — leitura, já executado, colunas confirmadas.
- `fixtures-01-reconstrucao.sql` — já executado (criou os fixtures atuais).
- `fixtures-02-validacao-pos-criacao.sql` — leitura, já executado (7/7 PASS).
- `fixtures-03-corrigir-uuid-proprietario.sql` — já executado (corrigiu owner_id + vínculo do proprietário).
- `os-00-pre-check.js` — leitura, já executado (fixtures OK, RLS de vínculos é self-only, esperado).
- `os-01-criar.js` — INSERT parametrizado por papel (`SUPABASE_TEST_EMAIL`/`SUPABASE_TEST_PASSWORD`/`DESCRICAO`), já rodado pros 4 papéis.
- `os-02-select.js` — **pronto, não executado**. SELECT por papel, testa Empresa A e B na mesma rodada.
- `os-03-update.js` — **pronto, não executado**. UPDATE por papel via `TARGET_OS_ID`/`PATCH_JSON` (env vars) — reusar pra também testar troca de `empresa_id`.
- `os-04-delete.js` — **pronto, não executado**. DELETE por papel via `TARGET_OS_ID`, com verificação via admin.
- `os-05-isolamento.js` — **pronto, não executado**. Admin da A tenta ler/inserir na B.
- `os-06-diagnostico-rls.js` — script de diagnóstico usado durante a investigação dos fixtures apagados (não faz parte do fluxo normal de QA, mantido de referência).
- `pecas-01-criar-policies.sql` — já executado pelo usuário no SQL Editor (criou as 3 policies faltantes de `pecas`).
- `pecas-02-criar.js` — INSERT parametrizado por papel (`SUPABASE_TEST_EMAIL`/`SUPABASE_TEST_PASSWORD`/`NOME`), mesmo padrão do `os-01-criar.js`. Já rodado pros 4 papéis (24/08/2026).
- `pecas-03-select.js` — SELECT por papel, testa Empresa A e B na mesma rodada. Já rodado pros 4 papéis.
- `pecas-04-update.js` — UPDATE por papel via `TARGET_PECA_ID`/`PATCH_JSON`. Já rodado pros 4 papéis (normal + troca de `empresa_id`).
- `pecas-05-delete.js` — DELETE por papel via `TARGET_PECA_ID`, com verificação via admin. Já rodado pros 4 papéis.
- `pecas-06-isolamento.js` — Admin da A tenta ler/inserir na B. Já rodado.
- `fornecedores-01-criar.js` — INSERT parametrizado por papel, mesmo padrão dos scripts anteriores. Já rodado e aprovado (24/08/2026).
- `fornecedores-02-select.js` — SELECT por papel, testa Empresa A e B na mesma rodada. Já rodado e aprovado (24/08/2026).
- `fornecedores-03-update.js` — UPDATE por papel via `TARGET_FORNECEDOR_ID`/`PATCH_JSON`, incl. troca de `empresa_id`. Já rodado e aprovado (24/08/2026).
- `fornecedores-04-delete.js` — DELETE por papel via `TARGET_FORNECEDOR_ID`, com verificação via admin. Já rodado e aprovado (24/08/2026).
- `fornecedores-05-isolamento.js` — Admin da A tenta ler/inserir na B. Já rodado (24/08/2026).
- `fornecedores-06-vinculo-cruzado.js` — Teste adicional (pedido do usuário): cria fornecedor na Empresa B, tenta vincular a uma peça da Empresa A via `fornecedor_id`, e verifica se há vazamento de dado da B através de embed do PostgREST (`?select=*,fornecedores(*)`). Aceita `FORNECEDOR_B_ID` opcional pra reusar um fornecedor já criado. Já rodado (24/08/2026) — vínculo aceito, sem vazamento, falha de integridade encontrada (ver seção 4-B).
- `fornecedores-07-fix-integridade-01-add-constraint.sql` — Passo 1 do plano de correção da falha de integridade: `UNIQUE (id, empresa_id)` em `fornecedores` + FK composta `NOT VALID` em `pecas`. Não remove a FK simples existente (`pecas_fornecedor_id_fkey`, mantém `ON DELETE SET NULL`). Já rodado pelo usuário no SQL Editor (24/08/2026).
- `funcionarios-01-criar.js` — INSERT parametrizado por papel. Já rodado pros 4 papéis (25/08/2026) — resultado batendo 100% com a matriz esperada, `usuario` bloqueado conforme previsto (diferente das tabelas anteriores).
- `funcionarios-02-select.js` — SELECT por papel, testa Empresa A e B na mesma rodada. Já rodado pros 4 papéis (25/08/2026) — resultado batendo 100% com a matriz esperada.
- `funcionarios-03-update.js` — UPDATE por papel via `TARGET_FUNCIONARIO_ID`/`PATCH_JSON`, incl. troca de `empresa_id`. Já rodado pros 4 papéis (25/08/2026) — resultado batendo 100% com a matriz esperada, confirmado com leitura pós-teste via admin.
- `funcionarios-04-delete.js` — DELETE por papel via `TARGET_FUNCIONARIO_ID`, com verificação via admin. Já rodado pros 4 papéis (25/08/2026) — resultado batendo 100% com a matriz esperada; os 2 funcionários de teste foram excluídos como consequência direta do teste (não sobrou fixture, diferente das fases anteriores).
- `funcionarios-05-isolamento.js` — Admin da A tenta ler/inserir na B. Já rodado (25/08/2026) — INSERT bloqueado (403 `42501`), confirmado por leitura independente (via `sem_vinculo`) que nada foi criado na B; SELECT segue inconclusivo isoladamente (B ainda sem funcionário legítimo).
- `funcionarios-06-vinculo-cruzado.js` — Teste adicional: cria funcionário legítimo na Empresa B, cria OS nova de teste na Empresa A associada a ele, testa leitura direta + embed do PostgREST. Não toca na OS remanescente `97c2709a-...`. Já rodado (25/08/2026) — vínculo aceito, sem vazamento, falha de integridade encontrada (mesma classe de `pecas.fornecedor_id`, ver seção 4-C).
- `funcionarios-07-fix-integridade-01-add-constraint.sql` — Passo 1 do plano de correção da falha de integridade: `UNIQUE (id, empresa_id)` em `funcionarios` + FK composta `NOT VALID` com `ON DELETE SET NULL (funcionario_id)` em `ordens_servico`, com conferências defensivas. Já executado pelo usuário no SQL Editor do Supabase (25/08/2026) — ambas as constraints criadas com sucesso.
- `funcionarios-08-fix-integridade-02-reteste.js` — Passo 2 do plano: repete o vínculo cruzado (OS nova na Empresa A + funcionário já existente na Empresa B) e confirma via consulta que a FK composta bloqueia a criação. Já rodado (25/08/2026) — bloqueado com HTTP 409/23503 citando `ordens_servico_funcionario_mesma_empresa_fkey`, nenhuma OS criada.
- `funcionarios-09-fix-integridade-03-on-delete-set-null.js` — Validação exclusiva do passo 5 do plano (os passos 3 e 4 foram feitos manualmente pelo usuário, direto no SQL Editor): cria funcionário temporário na Empresa A, vincula à OS cruzada de teste (já com `funcionario_id: null` desde o passo 3 manual), confirma o vínculo, exclui o funcionário e confirma o efeito `ON DELETE SET NULL (funcionario_id)`. Já rodado (25/08/2026) — resultado 100% OK: OS preservada, `empresa_id` intacto, `funcionario_id` zerado, nenhuma outra coluna alterada.
- `movimentos-caixa-00-conferencia.sql` — SQL 100% somente leitura: policies, RLS, colunas e FKs (com `ON DELETE`) de `movimentos_caixa`, mais uma checagem de planejamento (se `ordens_servico`/`pecas` já têm `UNIQUE(id, empresa_id)`). Já executado pelo usuário no SQL Editor (25/08/2026) — resultado completo registrado na seção 4-D.
- `movimentos-caixa-01-select.js` — SELECT nos 4 papéis (all-in-one). 🟢 Concluído e aprovado (26/08/2026) — ver seção de resolução na 4-E.
- `movimentos-caixa-02-insert-entrada.js` — INSERT `tipo='entrada'` nos 4 papéis (all-in-one). 🟢 Concluído e aprovado (26/08/2026) — ver seção de resolução na 4-E.
- `movimentos-caixa-03-insert-saida.js` — INSERT `tipo='saida'` nos 4 papéis (all-in-one). 🟢 Concluído e aprovado (26/08/2026), após corrigir para `return=minimal` — ver seção de resolução na 4-E.
- `movimentos-caixa-04-update.js` — UPDATE sequencial com confirmação via proprietario após cada bloqueio (`TARGET_MOVIMENTO_ID`). 🟢 Concluído e aprovado (26/08/2026) — ver seção de resolução na 4-E.
- `movimentos-caixa-05-delete.js` — DELETE sequencial com confirmação via proprietario após cada bloqueio (`TARGET_MOVIMENTO_ID`). 🟢 Concluído e aprovado (26/08/2026) — ver seção de resolução na 4-E.
- `movimentos-caixa-06-isolamento.js` — proprietario da A tenta ler/inserir na B, com confirmação independente via sem_vinculo. 🟢 Concluído e aprovado (26/08/2026) — ver seção de resolução na 4-E.
- `movimentos-caixa-07-vinculo-cruzado-os.js` — cria OS legítima na Empresa B e testa se `movimentos_caixa.os_id` da Empresa A aceita referenciá-la. 🚨 Executado em 26/08/2026 — ver seção de resolução na 4-E, falha de integridade confirmada.
- `movimentos-caixa-08-vinculo-cruzado-peca.js` — cria peça legítima na Empresa B e testa se `movimentos_caixa.peca_id` da Empresa A aceita referenciá-la. 🚨 Executado em 26/08/2026 — ver seção de resolução na 4-E, falha de integridade confirmada.
- `movimentos-caixa-10-planejamento-integridade.sql` — SQL 100% somente leitura, criado para planejar a correção conjunta de `os_id`/`peca_id`. Já executado pelo usuário no SQL Editor (26/08/2026) — resultado completo registrado na seção 4-E: FKs simples validadas, nenhuma `UNIQUE(id, empresa_id)` em `ordens_servico`/`pecas`, exatamente 1 vínculo cruzado por `os_id` e 1 por `peca_id` (as 2 evidências já conhecidas, nenhuma adicional), PostgreSQL 17.6.
- `movimentos-caixa-11-fix-integridade-01-constraints.sql` — Passo 1 do plano de correção: `UNIQUE(id, empresa_id)` em `ordens_servico` e `pecas` + FKs compostas `NOT VALID` em `movimentos_caixa` para `os_id` e `peca_id`, dentro de uma única transação. 🟢 Executado com sucesso pelo usuário no SQL Editor (26/08/2026) — ver seção de resolução na 4-E.
- `movimentos-caixa-12-fix-integridade-02-reteste-os.js` — Passo 2 do plano: reteste do vínculo cruzado por `os_id` reutilizando a OS legítima da Empresa B do script 07. 🟢 Concluído e aprovado (26/08/2026) — FK composta bloqueou (HTTP 409/23503), evidência antiga preservada.
- `movimentos-caixa-13-fix-integridade-03-reteste-peca.js` — Passo 3 do plano: mesmo reteste para `peca_id`, reutilizando a peça legítima da Empresa B do script 08. 🟢 Concluído e aprovado (26/08/2026) — FK composta bloqueou (HTTP 409/23503), evidência antiga preservada.
- `movimentos-caixa-14-fix-integridade-04-ajuste-evidencias.sql` — Passo 4: zera `os_id`/`peca_id` das 2 evidências antigas, preservando os movimentos. 🟢 Executado pelo usuário no SQL Editor (26/08/2026, com correção manual de uma tentativa parcial) — 0 vínculos cruzados restantes confirmados.
- Passo 5 (`VALIDATE CONSTRAINT`, executado direto no SQL Editor, sem script próprio) — 🟢 as duas FKs compostas validadas com sucesso (26/08/2026).
- `movimentos-caixa-15-fix-integridade-05-on-delete-set-null.js` — Validação de ponta a ponta do `ON DELETE SET NULL` para `os_id` e `peca_id`, com criação e exclusão controladas de dados temporários na Empresa A. 🟢 Concluído e aprovado (26/08/2026), `EXIT_CODE=0`.
- `movimentos-caixa-16-conferencia-final.sql` — SQL 100% somente leitura, conferência final da Fase 2.5.5: RLS, 5 policies, 2 UNIQUEs, 2 FKs compostas validadas, contagem de vínculos cruzados (0/0), estado dos 7 movimentos relevantes, existência do cliente temporário e ausência da OS/peça temporárias. 🟢 Executado pelo usuário no SQL Editor e APROVADO (26/08/2026) — ver seção de resolução na 4-D/4-E.

## 6. Ponto exato de retorno

**Fase 2.5.1 (Ordens de Serviço) está 100% concluída.** Todos os scripts (`os-01` a `os-05`) rodaram para os 4 papéis (proprietario/admin/usuario/sem_vinculo), com resultado batendo com a matriz esperada em todos os casos.

**🟢 Fase 2.5.2 (pecas/estoque) 100% concluída** — pendência crítica resolvida (3 policies criadas) e QA funcional completo (SELECT/INSERT/UPDATE/DELETE/isolamento, 4/4 papéis cada), tudo batendo com a matriz esperada.

**Fase 2.5.3 — QA funcional concluído, com correção de integridade multiempresa pendente.** Achado: `pecas.fornecedor_id` aceita referenciar um fornecedor de outra empresa — sem vazamento de leitura (RLS de `fornecedores` protege o dado, inclusive em embed do PostgREST), mas é uma falha de integridade multiempresa.

**🟢 Plano de correção 100% concluído (5/5 passos, 24/08/2026)** — ver seção 4-B para o detalhamento completo de cada passo. A falha de integridade multiempresa encontrada no teste de vínculo cruzado está corrigida e validada.

**🟢 Fase 2.5.4 (funcionarios) — QA funcional 100% concluído, correção de integridade multiempresa APLICADA E VALIDADA (25/08/2026).** Investigação somente leitura concluída (frontend + git), matriz definida com o usuário. Scripts 01 a 05 rodados para os papéis aplicáveis, resultado batendo 100% com a matriz esperada em todos: `usuario` bloqueado em INSERT/UPDATE/DELETE mas liberado em SELECT (diferente das tabelas anteriores), `WITH CHECK` bloqueia troca de `empresa_id` pra todos os papéis, isolamento do admin da A contra a B confirmado no INSERT (403 bloqueado). O teste 06 (vínculo cruzado) confirmou de forma definitiva o isolamento de leitura (com dado real criado na B) e encontrou uma falha de integridade multiempresa em `ordens_servico.funcionario_id` → `funcionarios.id` (mesma classe já corrigida em `pecas.fornecedor_id`, seção 4-B): o vínculo cruzado foi aceito pelo banco, mas sem vazamento de leitura (RLS de `funcionarios` continua bloqueando, inclusive dentro do embed do PostgREST). Ver seção 4-C para o detalhamento completo de cada script e do plano de correção em 5 passos.

**🟢 Plano de correção 100% concluído (5/5 passos, 25/08/2026)** — ver seção 4-C para o detalhamento completo de cada passo: 1) UNIQUE + FK composta `NOT VALID` criadas (script 07, executado pelo usuário); 2) reteste do vínculo cruzado confirmou bloqueio pela FK composta (script 08, HTTP 409/23503 citando o nome exato da constraint); 3) `funcionario_id` da OS cruzada de teste (`4db4b201-...`) zerado por UPDATE manual autorizado, feito diretamente pelo usuário; 4) `VALIDATE CONSTRAINT` executado pelo usuário, constraint confirmada como `validada = true`; 5) `ON DELETE SET NULL (funcionario_id)` validado de ponta a ponta pelo script 09 (funcionário temporário criado, vinculado à OS, excluído — só `funcionario_id` zerou, `empresa_id` e demais campos permaneceram intactos). A falha de integridade multiempresa encontrada no teste de vínculo cruzado está corrigida e validada. A OS remanescente `97c2709a-...` da Fase 2.5.1 não foi tocada em nenhum momento da Fase 2.5.4.

**🟢 Fase 2.5.5 (movimentos_caixa) — CONCLUÍDA (26/08/2026): QA funcional, correção de integridade multiempresa e conferência final, todos aprovados.** Histórico completo abaixo. Frontend, git e SQL de conferência já confirmados (ver seção 4-D): 5 policies reais confirmadas (`caixa_select_proprietario`, `caixa_insert_proprietario`, `caixa_insert_despesa_admin_gerente`, `caixa_update_proprietario`, `caixa_delete_proprietario`), RLS ativo, colunas e FKs mapeadas (`os_id`→`ordens_servico` e `peca_id`→`pecas`, ambas FK simples `ON DELETE SET NULL`, sem checar `empresa_id` — mesma classe de risco de vínculo cruzado já corrigida em 2.5.3/2.5.4). Achado central: regra própria e mais restritiva — só `proprietario` faz SELECT/UPDATE/DELETE e qualquer INSERT; `admin`/`gerente` só inserem `tipo='saida'`; `usuario`/`sem_vinculo` bloqueados em tudo. Matriz esperada já proposta na seção 4-D e **aprovada pelo usuário (25/08/2026)**, com escopo de 8 grupos de teste definido (ver "Escopo de testes aprovado"). **Script 03 (INSERT `tipo='saida'`) concluído e aprovado (26/08/2026)** — ver seção de resolução na 4-E, incluindo a distinção entre o problema do script (header `return=representation`) e o bug real do app (`empresaId` resolvido pelo modelo antigo via `owner_id`, sem consultar `usuarios_empresas`; correção adiada para a Fase 3 — Contexto da empresa). **Script 01 (SELECT) concluído e aprovado (26/08/2026)** — proprietario 3/3 registros esperados, admin/usuario/sem_vinculo bloqueio silencioso via RLS (200 + `[]`), bate 100% com a matriz. **Script 02 (INSERT `tipo='entrada'`) concluído e aprovado (26/08/2026)** — proprietario 201 (confirmado por SELECT, `ce8357c2-...`), admin/usuario/sem_vinculo 403/42501. **Script 04 (UPDATE) concluído e aprovado (26/08/2026)** — proprietario aplicado, admin/usuario/sem_vinculo bloqueados, tudo confirmado por SELECT independente (HTTP 204 sozinho não distingue sucesso de bloqueio). **Script 05 (DELETE) concluído e aprovado (26/08/2026)** — usuario/sem_vinculo/admin bloqueados (HTTP 204, mas registro preservado, confirmado por SELECT), proprietario excluiu de fato (`ce8357c2-...` removido intencionalmente, confirmado por SELECT retornando `[]`); mesmo achado do script 04, HTTP 204 sozinho não comprova exclusão. **Script 06 (isolamento Empresa A × B) concluído e aprovado (26/08/2026)** — primeira tentativa abortada com segurança por uma premissa errada de RLS "self-only" em `usuarios_empresas`, corrigida com filtro explícito `usuario_id`+`empresa_id`; reexecutado, SELECT e INSERT cruzados bloqueados, isolamento confirmado sem nenhum registro indevido criado. **🚨 Script 07 (vínculo cruzado `os_id`) executado (26/08/2026) — falha de integridade multiempresa confirmada** (movimento da Empresa A aceito com `os_id` de OS da Empresa B), sem vazamento de leitura (SELECT direto e embed ambos protegidos); todos os registros preservados. **🚨 Script 08 (vínculo cruzado `peca_id`) executado (26/08/2026) — mesma falha confirmada** (movimento da Empresa A aceito com `peca_id` de peça da Empresa B), também sem vazamento de leitura; registros preservados. Os 8 grupos de teste funcional estão concluídos. SQL de planejamento (`movimentos-caixa-10-planejamento-integridade.sql`) já executado e confirmado (seção 4-E): FKs simples validadas, nenhuma `UNIQUE(id, empresa_id)` em `ordens_servico`/`pecas`, exatamente 1 vínculo cruzado por `os_id` e 1 por `peca_id` (as evidências já conhecidas), PostgreSQL 17.6. **Passo 1 do plano de correção executado com sucesso (26/08/2026)** — `UNIQUE(id, empresa_id)` criada em `ordens_servico` e `pecas`; FKs compostas `movimentos_caixa_os_mesma_empresa_fkey`/`movimentos_caixa_peca_mesma_empresa_fkey` criadas `NOT VALID` (já protegendo INSERTs/UPDATEs novos); as 2 evidências antigas preservadas. **Passo 2 (reteste `os_id`, script 12) concluído e aprovado (26/08/2026)** — FK composta bloqueou o vínculo cruzado (HTTP 409/23503, citando o nome da constraint), nenhum registro novo criado, evidência antiga intacta. **Passo 3 (reteste `peca_id`, script 13) concluído e aprovado (26/08/2026)** — mesmo resultado, FK composta bloqueou, evidência antiga intacta. **Passo 4 (ajuste das evidências, script 14) e Passo 5 (`VALIDATE CONSTRAINT`) concluídos (26/08/2026)** — as 2 evidências antigas preservadas como movimentos com `os_id`/`peca_id` zerados, 0 vínculos cruzados restantes confirmados, as duas FKs compostas validadas com sucesso. **🟢 Correção de integridade multiempresa de `movimentos_caixa` (`os_id`/`peca_id`) concluída e validada.** **Script 15 (`ON DELETE SET NULL`, os dois campos) concluído e aprovado (26/08/2026)**, `EXIT_CODE=0` — mesmo padrão já feito em `funcionarios` (Fase 2.5.4, script 09). **Conferência final (script 16) executada e APROVADA (26/08/2026)** — RLS ativo, 5 policies confirmadas, 2 UNIQUEs validadas, 2 FKs compostas validadas com `ON DELETE SET NULL` só nas colunas de vínculo, 0 vínculos cruzados remanescentes, os 7 movimentos relevantes no estado esperado, cliente temporário existente e OS/peça temporárias ausentes como esperado. **🟢 FASE 2.5.5 — MOVIMENTOS_CAIXA: CONCLUÍDA.**

Dados remanescentes de teste (não limpar sem autorização explícita):
- 1 OS na Empresa QA A (`97c2709a-...`), sobrevivente dos testes de DELETE da Fase 2.5.1.
- 1 peça na Empresa QA A (`128da70e-...`, `qtd: 25`), sobrevivente dos testes de DELETE da Fase 2.5.2.

Fixtures de `funcionarios` da Fase 2.5.4 criados no INSERT (`bba38c9d-...`, `7c161412-...`) foram excluídos pelo próprio teste de DELETE (25/08/2026).

Novos dados remanescentes do teste de vínculo cruzado (06, 25/08/2026), não limpar sem autorização explícita:
- 1 funcionário de teste na Empresa QA B (`1d39ca25-eb60-4e87-a6a0-441d0e4d0475`).
- 1 OS de teste na Empresa QA A (`4db4b201-a169-4a28-8da8-3b2139b0cf6b`) — foi a evidência original da falha de integridade em `ordens_servico.funcionario_id`, mas seu `funcionario_id` **já foi zerado** durante a correção da Fase 2.5.4 (UPDATE manual autorizado, passo 3 do plano em 4-C) e a constraint composta já está validada; a OS não aponta mais para o funcionário da Empresa B. Continua preservada como registro histórico da fase.

Dados remanescentes da Fase 2.5.5 (movimentos_caixa, 26/08/2026), não limpar sem autorização explícita:
- Movimentos na Empresa QA A: `fa281de3-...`, `a07c3b4a-...`, `3ca638ba-...` (saídas de teste), `70e22929-...` e `335d3415-...` (evidências de vínculo cruzado, hoje com `os_id`/`peca_id` nulos), `618681f7-...` e `16c8ef47-...` (movimentos temporários do script 15, preservados com `os_id`/`peca_id` nulos).
- Cliente temporário na Empresa QA A: `b13bf8c2-d8da-403b-9021-f3c727edaa76`.
- OS e peça temporárias do script 15 (`665c1116-...`, `8f34b4ff-...`) foram **excluídas intencionalmente** como parte do próprio teste — não existem mais, não é pendência de limpeza.

Regras que continuam valendo:
- Nenhuma policy, função ou estrutura deve ser alterada sem autorização explícita e prévia explicação.
- Nenhum teste roda sem autorização explícita, um de cada vez, com pausa para análise depois.
- Não limpar dados de teste sem autorização.
- Não mexer na empresa "Admim" / cliente "Maria Graça".
- Papel `gerente` fica fora de todos os QAs funcionais até decisão em contrário — nunca afirmar que seu comportamento foi comprovado, só que a definição das funções sugere permissão.

## 7. Pendência encaminhada para a Fase 3 — Contexto da empresa

Achado da Fase 2.5.5 (investigação do bug real do app, ver seção 4-E): `iniciarApp()` (`script.js:88-98`) ainda resolve `empresaId` pelo modelo antigo, via `empresas.owner_id = auth.uid()`, **sem consultar `usuarios_empresas`**. Isso faz qualquer usuário convidado como membro de outra empresa (papel diferente de dono via `owner_id`) operar sobre a empresa errada.

Na Fase 3, a correção precisa:
- Resolver a empresa ativa via `usuarios_empresas`, não mais via `empresas.owner_id`.
- Tratar corretamente usuários com **múltiplos vínculos** (mais de uma empresa).
- **Não** escolher arbitrariamente o primeiro vínculo encontrado, nem apenas priorizar `proprietario` sem critério explícito — a regra de seleção precisa ser definida deliberadamente.
- Usar o nome de coluna já confirmado nesta investigação: `usuarios_empresas.usuario_id` (não `user_id`).

Nenhuma alteração de `iniciarApp()`, policies ou vínculos foi feita na Fase 2.5.5 — fica registrada aqui só como pendência para quando a Fase 3 começar.
