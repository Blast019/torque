# Fase 4 — Usuários e Permissões

Última atualização: 2026-09-02

## Situação geral

```
FASE 4 — Usuários e permissões                       ⏳ EM ANDAMENTO
├── 4.1 Constraint dos quatro papéis                  🟢 CONCLUÍDA
└── 4.2 Banco, RPCs, RLS e QA funcional                🟢 CONCLUÍDA
    ├── RPCs (incluir/alterar/remover)                🟢 CONCLUÍDAS
    ├── Ajuste de RLS SELECT                          🟢 CONCLUÍDO
    └── QA funcional (27 testes)                      🟢 CONCLUÍDO (27/27 aprovados)

Frontend de gerenciamento de usuários (Configurações)  🟡 EM DESENVOLVIMENTO
└── Primeiro incremento: listagem de usuários          🟢 CONCLUÍDO LOCALMENTE (aguarda commit/push)
```

Todos os artefatos referenciados abaixo estão em `qa/fase-4/scripts/`.

## Decisões funcionais

- Papéis: `proprietario`, `admin`, `gerente` e `usuario`.
- Somente contas previamente existentes podem ser vinculadas a uma empresa (inclusão busca por e-mail exato, case-insensitive, em `auth.users`; não cria conta nova).
- Proprietário possui gestão completa dentro das regras (inclui, altera papel e remove qualquer vínculo, exceto o próprio papel).
- Admin possui limites hierárquicos: só inclui/altera/remove vínculos com papel `gerente` ou `usuario`; nunca mexe em `admin` ou `proprietario`, nem promove ninguém a esses papéis.
- Usuário não pode alterar o próprio papel — regra vale para qualquer papel, inclusive o próprio proprietário (bloqueado mesmo sendo proprietário).
- Último proprietário ativo da empresa não pode ser removido, nem por si mesmo (autorremoção incluída).
- Remoção utiliza soft delete (`ativo = false`) — nenhuma das RPCs desta fase faz `DELETE`.
- Funcionários e usuários permanecem entidades separadas (sem relação com esta fase).

## Implementação

| Item | Arquivo | Resumo |
|---|---|---|
| Constraint dos 4 papéis | `papel-01` a `papel-05` | Pré-checagem, `ADD CONSTRAINT ... NOT VALID`, `VALIDATE CONSTRAINT`, conferência de definição e script de rollback — restringe `usuarios_empresas.papel` a `proprietario`/`admin`/`gerente`/`usuario`. |
| `incluir_usuario_empresa` | `permissoes-01-incluir-usuario-empresa.sql` | RPC `SECURITY DEFINER`. Localiza conta existente por e-mail exato (case-insensitive); reativa vínculo inativo existente ou insere um novo; trava por `pg_advisory_xact_lock` chaveada por `empresa_id`. Códigos: `TRQ21` não_autenticado, `TRQ24` entrada_invalida, `TRQ25` sem_permissao, `TRQ26` operacao_nao_permitida (vínculo já ativo), `TRQ27` usuario_nao_encontrado. |
| `alterar_papel_usuario_empresa` | `permissoes-02-alterar-papel-usuario-empresa.sql` | Bloqueia auto-alteração de papel (`TRQ36`) antes de qualquer outra checagem, inclusive para o próprio proprietário. Admin restrito a mexer só em `gerente`/`usuario`. Códigos: `TRQ31`, `TRQ34`, `TRQ35`, `TRQ36`, `TRQ37`, `TRQ38`, `TRQ39` (proteção do último proprietário — ver nota em QA funcional). |
| `remover_usuario_empresa` | `permissoes-03-remover-usuario-empresa.sql` | Soft delete (`ativo = false`). Autorremoção permitida sem checar hierarquia; proteção do último proprietário ativo vale mesmo em autorremoção. Códigos: `TRQ41`, `TRQ44`, `TRQ45`, `TRQ46`, `TRQ47`, `TRQ49`. |
| Ajuste da RLS SELECT | `permissoes-04-ajustar-rls-select.sql` | Substitui `usuarios_empresas_select_proprietario` (baseada em `empresas.owner_id`) por `usuarios_empresas_select_proprietario_admin`, baseada no papel ativo (`proprietario` ou `admin`) via função auxiliar `SECURITY DEFINER` `usuario_e_proprietario_ou_admin_ativo`. |
| Policy corrigida para `TO authenticated` | `permissoes-05-fix-policy-role-authenticated.sql` | A policy criada no script 04 ficou sem cláusula `TO`, aplicando-se a todos os roles (inclusive `anon`) — não era vazamento de dado (função depende de `auth.uid()`, `NULL` para `anon`), mas inconsistente com o padrão das outras 4 policies da tabela. Corrigida para `TO authenticated`. |
| Scripts de QA — Fase 4.1 | `papel-01` a `papel-05` | Constraint dos 4 papéis (ver acima). |
| Scripts de QA — Fase 4.2 | `permissoes-01` a `permissoes-08` | RPCs, RLS e QA funcional (Bloco 1, Bloco 2 e complemento do DEL-03 — ver seção seguinte). |
| Variável de ambiente | `qa/.env.example` | `QA_PASSWORD_PROPRIETARIO_ANTIGO` (vazia no exemplo) — senha própria da conta reaproveitada como "LIVRE" nesta fase, que não usa a senha compartilhada (`SUPABASE_TEST_PASSWORD`) das demais contas de QA. |

Nenhuma senha, chave ou token aparece neste documento.

## QA funcional

Execução via login real por papel (`/auth/v1/token`) + chamadas REST diretas às RPCs/tabela, mesmo padrão já validado nas Fases 2.5 e 3. Login das contas necessárias validado com HTTP 200 antes de qualquer chamada mutável, em todos os scripts.

| Script | Testes | Resultado |
|---|---|---|
| `permissoes-06-qa-bloco1-sem-alteracao.js` (Bloco 1) | #1–#10 | 🟢 10/10 aprovados |
| `permissoes-07-qa-bloco2.js` (Bloco 2) | #11–#27 | 🟢 16/17 aprovados, 1 pendente (`DEL-03` — sem um 2º vínculo `admin` seguro nas fixtures do Bloco 2) |
| `permissoes-08-qa-del03.js` (complemento) | Conclusão de `DEL-03` | 🟢 7/7 sub-passos aprovados (`PRE-DEL03-01`, `PREP-01`, `DEL-03`, `CONF-DEL03-01`, `RESTORE-01`, `RESTORE-02`, `FINAL-DEL03`) |
| **Consolidado** | **27 testes da matriz** | **🟢 27/27 aprovados, 0 reprovados, 0 pendentes** |

`DEL-03` foi concluído usando um segundo `admin` **temporário** (o vínculo do usuário "LIVRE", reativado como `admin` só para esse teste) e desfeito ao final via `alterar_papel_usuario_empresa` (admin → gerente) + autorremoção — sem alterar PROP_A, ADMIN_A ou USUARIO_A.

Isolamento entre empresas validado em dois pontos: leitura (`SEL-05`/`ISO-04`, Bloco 1 — RLS bloqueia leitura cruzada) e escrita (`ISO-05`, Bloco 2 — `ADMIN_A` bloqueado ao tentar `remover_usuario_empresa` sobre um vínculo ativo real pertencente a outra empresa, encontrado por leitura própria da conta `SEM_VINCULO`).

Códigos de erro confirmados via chamada real: `TRQ24`, `TRQ25`, `TRQ27`, `TRQ35`, `TRQ36`, `TRQ45`, `TRQ49`.

**Nota sobre TRQ39:** TRQ39 (proteção do último proprietário em `alterar_papel_usuario_empresa`) **não foi testado**. Análise do código confirmou que essa proteção é estruturalmente inalcançável por qualquer chamada legítima: o bloqueio de auto-alteração (`TRQ36`) e a restrição hierárquica do admin (`TRQ35`) sempre interceptam antes que a checagem de `TRQ39` seja alcançada. O que foi de fato validado é equivalente em efeito prático: o último proprietário ativo foi protegido contra remoção por `TRQ49` (`remover_usuario_empresa`, inclusive em autorremoção — teste `PROT-01`), e a autoalteração de papel foi bloqueada por `TRQ36` em dois cenários (`UPD-04a`, usuário comum; `UPD-04b`, o próprio proprietário).

**Estado final da Empresa A** (confirmado de forma idêntica por PROP_A e ADMIN_A em `FINAL-01` e `FINAL-DEL03`):

| Conta | Papel | Ativo |
|---|---|---|
| PROP_A | proprietario | true |
| ADMIN_A | admin | true |
| USUARIO_A | usuario | true |
| LIVRE | gerente | **false** |

Nenhuma linha adicional. Nenhum `DELETE` manual ou `service_role` foi utilizado em nenhum dos três scripts de QA desta fase — todas as escritas passaram pelas 3 RPCs `SECURITY DEFINER`, com login real por papel.

## Achado durante o teste local — botão "+ Nova empresa" sem checagem de papel

🟢 **CORRIGIDO — migração aplicada e validada no Supabase (02/09/2026). Frontend implementado localmente, aguardando commit/push.**

Durante o teste local integrado da seção Usuários (Fase 4.3), logado como `USUARIO_A`, foi identificado que o botão "+ Nova empresa" permanecia visível e funcional — nem o frontend nem a RPC `criar_nova_empresa_com_vinculo` (Fase 3) jamais validaram o papel do chamador em nenhuma empresa. Nova regra aprovada: **somente vínculo ativo `proprietario` na empresa atualmente selecionada pode criar outra empresa.**

Correção:
- **Backend** — aplicado e validado no banco: migração `qa/fase-3/scripts/empresas-04-restringir-nova-empresa-a-proprietario.sql` (RPC passa a exigir `p_empresa_origem_id` e validar vínculo `proprietario` ativo nela, código `TRQ15`; assinatura antiga de 4 parâmetros removida na mesma transação). QA funcional: 8/8 testes aprovados (7 negativos + replay idempotente), sem criação de empresa/vínculo novo — ver `qa/fase-3/STATUS.md` (seção 10) e o script versionado `qa/fase-3/scripts/empresas-05-qa-restricao-nova-empresa.js`.
- **Frontend** — implementado e testado localmente, **ainda não commitado/publicado**: botão do seletor de empresas removido; botão de Configurações passa a ser mostrado/ocultado por papel em `entrarNaEmpresa()`; guarda defensiva em `abrirModalNovaEmpresa()`; novo parâmetro `p_empresa_origem_id` na chamada RPC; mensagem para `TRQ15`. Testes visuais aprovados para proprietário, administrador e usuário.

Detalhe completo em `qa/fase-3/STATUS.md` (seção 10 — Alteração posterior), já que a RPC afetada pertence à Fase 3.

## Próximos passos

- ~~Aplicar e validar `permissoes-09-listar-usuarios-empresa.sql`.~~ 🟢 Concluído — aplicado e validado no Supabase.
- ~~Validar a primeira tela de listagem por papel (proprietário/admin visíveis; gerente/usuário sem acesso).~~ 🟢 Concluído — testes visuais aprovados para proprietário, administrador e usuário.
- Commit e push do frontend (seção Usuários + correção de "+ Nova empresa").
- Incluir, alterar papel e remover/desativar vínculos.
- Tratamento de reativação (vínculo inativo reaparecendo ao reincluir o mesmo e-mail).
- Regressão das Fases 2.5 e 3.

## Restrições

- `CNAME` permanece fora da Fase 4 e não deve ser alterado.
- `qa/.env` não deve ser versionado.
- Nenhuma credencial deve ser documentada.
