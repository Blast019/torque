# Fase 4 — Usuários e Permissões

Última atualização: 2026-09-03

## Situação geral

```
FASE 4 — Usuários e permissões                       ⏳ EM ANDAMENTO
├── 4.1 Constraint dos quatro papéis                  🟢 CONCLUÍDA
└── 4.2 Banco, RPCs, RLS e QA funcional                🟢 CONCLUÍDA
    ├── RPCs (incluir/alterar/remover)                🟢 CONCLUÍDAS
    ├── Ajuste de RLS SELECT                          🟢 CONCLUÍDO
    └── QA funcional (27 testes)                      🟢 CONCLUÍDO (27/27 aprovados)

Frontend de gerenciamento de usuários (Configurações)  🟡 EM DESENVOLVIMENTO
├── 1º incremento: listagem de usuários                🟢 CONCLUÍDO E PUBLICADO (commit `793c3c5`, 02/09/2026)
├── 2º incremento: incluir/reativar usuário por e-mail  🟡 IMPLEMENTADO LOCALMENTE, reativação c/ escrita OK, inclusão nova pendente (aguarda commit/push)
├── 3º incremento: filtros + remover acesso             🟡 IMPLEMENTADO LOCALMENTE, QA com escrita OK (aguarda commit/push)
└── 4º incremento: botão dedicado "Reativar acesso"     🟢 IMPLEMENTADO, teste visual completo e QA REST (5/5) OK (aguarda commit/push)
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
| Bloqueio de `proprietario` na inclusão | `permissoes-11-bloquear-papel-proprietario-inclusao.sql` | `CREATE OR REPLACE` de `incluir_usuario_empresa` (mesma assinatura), adicionando `TRQ28` para `p_papel='proprietario'`. Versão vigente da função — ver "Correção de regra" no 2º incremento. |
| QA REST — reativação direta (4º incremento) | `permissoes-12-qa-reativacao-direta.js` | Equivalente automatizado do botão "Reativar acesso": reativa o vínculo do `LIVRE` via `incluir_usuario_empresa` com o papel travado no valor anterior, confirma `reativado=true`/`vinculo_id`/`criado_em` idênticos ao baseline, e restaura o baseline obrigatoriamente (autorremoção) ao final — com restauração de segurança em qualquer falha. Executado em 03/09/2026, 5/5 aprovados — ver 4º incremento. |
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

🟢 **CORRIGIDO E PUBLICADO — migração aplicada e validada no Supabase (02/09/2026); frontend publicado em 02/09/2026 no commit `793c3c5` — backend e frontend sincronizados.**

Durante o teste local integrado da seção Usuários (Fase 4.3), logado como `USUARIO_A`, foi identificado que o botão "+ Nova empresa" permanecia visível e funcional — nem o frontend nem a RPC `criar_nova_empresa_com_vinculo` (Fase 3) jamais validaram o papel do chamador em nenhuma empresa. Nova regra aprovada: **somente vínculo ativo `proprietario` na empresa atualmente selecionada pode criar outra empresa.**

Correção:
- **Backend** — aplicado e validado no banco: migração `qa/fase-3/scripts/empresas-04-restringir-nova-empresa-a-proprietario.sql` (RPC passa a exigir `p_empresa_origem_id` e validar vínculo `proprietario` ativo nela, código `TRQ15`; assinatura antiga de 4 parâmetros removida na mesma transação). QA funcional: 8/8 testes aprovados (7 negativos + replay idempotente), sem criação de empresa/vínculo novo — ver `qa/fase-3/STATUS.md` (seção 10) e o script versionado `qa/fase-3/scripts/empresas-05-qa-restricao-nova-empresa.js`.
- **Frontend** — implementado, testado localmente e **publicado em 02/09/2026 no commit `793c3c5`**: botão do seletor de empresas removido; botão de Configurações passa a ser mostrado/ocultado por papel em `entrarNaEmpresa()`; guarda defensiva em `abrirModalNovaEmpresa()`; novo parâmetro `p_empresa_origem_id` na chamada RPC; mensagem para `TRQ15`. Testes visuais aprovados para proprietário, administrador e usuário.

Detalhe completo em `qa/fase-3/STATUS.md` (seção 10 — Alteração posterior), já que a RPC afetada pertence à Fase 3.

## 2º incremento — incluir/reativar usuário existente por e-mail

🟡 **IMPLEMENTADO LOCALMENTE. QA sem escrita aprovado (incluindo `TRQ28`). QA visual parcial aprovado para proprietário e administrador (visibilidade do botão, abertura do modal, opções de papel corretas). Ainda não commitado/publicado.**

Usa a RPC `incluir_usuario_empresa` (já publicada e validada na Fase 4.2 — ver `qa/fase-4/scripts/permissoes-01-incluir-usuario-empresa.sql`), sem nenhuma alteração de banco nesta etapa.

Frontend implementado:
- Botão "+ Adicionar usuário" dentro de `#usuariosEmpresaSection` (ao lado do título "Usuários"), oculto junto com toda a seção para `gerente`/`usuário` — nenhum toggle novo foi necessário, só reaproveitou o comportamento já existente de `carregarUsuariosEmpresa()`.
- Modal `#overlayAdicionarUsuario` (e-mail, papel, erro, Cancelar, Adicionar usuário), com opções de papel montadas na abertura conforme `contextoEmpresa.papel`: proprietário vê `admin`/`gerente`/`usuario`; admin vê só `gerente`/`usuario`. **O papel `proprietario` nunca é oferecido** (ver correção de regra abaixo).
- Guarda defensiva em `abrirModalAdicionarUsuario()` (`usuarioPodeGerenciarVinculos()`) — a autorização real permanece na RPC (`TRQ25`/`TRQ28`).
- Proteção contra duplo envio com flag própria (`adicionandoUsuarioEmpresa`), liberada em `finally`.
- Mapeamento de erros dentro do modal: `TRQ24`, `TRQ25`, `TRQ26`, `TRQ27`, `TRQ28` e fallback genérico.
- Sucesso: fecha o modal, invalida `usuariosEmpresaCarregados` e recarrega a lista sem recarregar a página inteira, mostrando "Usuário incluído com sucesso." ou "Vínculo reativado com sucesso." (conforme `reativado` no retorno da RPC) numa área de feedback separada (`#usuariosEmpresaFeedback`, `role="status"`), independente do estado de carregamento da lista.

**QA sem escrita executado via REST** (login real por papel, mesmo padrão das rodadas anteriores — nenhuma linha criada/alterada, contagem de vínculos da Empresa A confirmada idêntica antes/depois): `TRQ26` (e-mail com vínculo já ativo) aprovado para proprietário e admin; `TRQ27` (e-mail inexistente) aprovado para proprietário e admin; `TRQ24` (e-mail vazio) aprovado; `TRQ25` (admin tentando papel fora do permitido) aprovado; `TRQ28` (tentativa de atribuir `proprietario`) aprovado para proprietário e admin — ver seção "Correção de regra" abaixo. **QA visual no navegador — parcial, aprovado para proprietário e administrador**: visibilidade do botão "+ Adicionar usuário", abertura do modal e opções de papel corretas por perfil. **Ainda pendente**: comportamento do Cancelar, exibição dos erros dentro do modal, proteção contra clique duplo, Console sem erros, aba Network (uma única chamada por envio) e responsividade abaixo de 600px — nenhum desses itens foi verificado em navegador real ainda. **Teste visual da conta gerente continua pendente**: não existe hoje, nas fixtures de QA, nenhuma conta com papel `gerente` e vínculo **ativo** para essa validação específica.

### Correção de regra — papel `proprietario` bloqueado no fluxo de inclusão

🟢 **MIGRAÇÃO APLICADA E VALIDADA no Supabase. `TRQ28` aprovado para proprietário e administrador via QA sem escrita.**

Nova regra aprovada: o papel `proprietario` **nunca** pode ser atribuído pelo fluxo "Adicionar usuário" — nem por outro proprietário, nem por admin. Uma futura transferência de propriedade terá um fluxo separado e mais protegido.

- **Frontend**: `montarOpcoesPapelAdicionarUsuario()` não oferece mais `proprietario` para nenhum papel — proprietário vê exatamente 3 opções (`admin`, `gerente`, `usuario`); admin vê exatamente 2 (`gerente`, `usuario`). Código `TRQ28` mapeado para "O papel Proprietário não pode ser atribuído por este fluxo."
- **Backend**: migração `qa/fase-4/scripts/permissoes-11-bloquear-papel-proprietario-inclusao.sql` — aplicada no Supabase, `CREATE OR REPLACE` de `incluir_usuario_empresa` (mesma assinatura de 3 parâmetros, sem `DROP` necessário), adicionando a checagem `p_papel = 'proprietario'` → `TRQ28` logo após a validação de entrada existente, antes de qualquer verificação de permissão ou escrita. Todo o restante do corpo da função permanece idêntico ao de `permissoes-01-incluir-usuario-empresa.sql`, que **não foi alterado** (continua como registro histórico).
- **QA sem escrita via REST** (login real por papel, contagem e registros completos da Empresa A — `id`, `usuario_id`, `papel`, `ativo`, `criado_em` de todos os 4 vínculos — confirmados byte-a-byte idênticos antes/depois): `PROP_A` tentando incluir uma conta existente com `p_papel='proprietario'` → `HTTP 400`, `code=TRQ28`, `message=papel_nao_permitido` ✅; `ADMIN_A` idem → mesmo resultado ✅. Zero escrita confirmada — nenhuma linha inserida, reativada ou modificada.

## 3º incremento — filtros da listagem e "Remover acesso"

🟡 **IMPLEMENTADO LOCALMENTE. Filtros e "Remover acesso" com QA REST sem escrita e QA visual/estático aprovados. Ainda não testado com escrita real, QA visual completo em navegador pendente. Ainda não commitado/publicado.**

Não altera nenhuma RPC nem cria SQL novo — usa exclusivamente `listar_usuarios_empresa` (já publicada) e `remover_usuario_empresa` (já publicada na Fase 4.2, lida integralmente antes desta implementação — ver `qa/fase-4/scripts/permissoes-03-remover-usuario-empresa.sql` e a matriz de testes DEL-01 a DEL-05 documentada acima). Nenhuma divergência foi encontrada entre o comportamento real da RPC e a regra descrita para a UI.

**Filtros** (busca por e-mail, status, papel — acima da tabela):
- Aplicados 100% localmente sobre `usuariosEmpresaListaAtual` (a lista já trazida por `listar_usuarios_empresa`) — nenhuma nova chamada de rede a cada caractere digitado ou opção trocada.
- Busca por e-mail: case-insensitive, `input` a cada tecla.
- Status: `Ativos` (padrão inicial), `Inativos`, `Todos`.
- Papel: `Todos os papéis`, `Proprietário`, `Administrador`, `Gerente`, `Usuário`.
- Os três filtros combinam entre si (AND). Sem resultado → "Não foram encontrados usuários com os filtros selecionados." (mensagem distinta de "Nenhum usuário vinculado a esta empresa.", usada quando a empresa não tem nenhum vínculo, independente de filtro).
- Markup reaproveita exatamente o padrão já usado no filtro de OS (`class="field search-field"` com `display:flex` inline) — nenhuma classe CSS nova foi necessária.

**Coluna "Ações" / "Remover acesso"**:
- Nova coluna na tabela, com botão `.btn.btn-ghost.btn-sm` dentro de `.row-actions` — mesmo padrão visual já usado nas demais tabelas do app (fornecedores, peças, funcionários etc.) para ações de linha.
- Matriz de exibição (`usuarioPodeRemoverAlvo()`), só para vínculos **ativos**: proprietário vê o botão nas linhas `admin`/`gerente`/`usuario`; admin vê o botão só nas linhas `gerente`/`usuario`. **Nunca aparece na linha de um `proprietario`** (nem a do próprio proprietário logado, nem a de outro) — saída do proprietário fica para um fluxo separado, ainda não implementado.
- Confirmação em modal (`#overlayRemoverUsuario`, mesmo padrão visual dos outros dois modais desta fase): "Deseja remover o acesso deste usuário à empresa?", Cancelar/Remover acesso, os dois botões bloqueados durante o envio, proteção contra duplo clique com flag própria (`removendoUsuarioEmpresa`) liberada em `finally`.
- Chama exclusivamente `remover_usuario_empresa(p_vinculo_id)` — nunca `DELETE`; a RPC faz soft delete (`ativo=false`). Mapeamento de erros dentro do modal: `TRQ44`, `TRQ45`, `TRQ46`, `TRQ47`, `TRQ49` e fallback genérico.
- Sucesso: fecha o modal, invalida `usuariosEmpresaCarregados`, recarrega a lista (mesmo padrão de "Adicionar usuário") e mostra "Acesso removido com sucesso." na área de feedback compartilhada. Como o filtro padrão é "Ativos", o vínculo recém-inativado some da visualização atual — permanece acessível em "Inativos"/"Todos" (comportamento automático da recarga + filtro, sem código adicional).

**Nota sobre autorremoção de admin**: a RPC permite que qualquer papel remova a si mesmo sem checar hierarquia (confirmado no código e no teste `DEL-05`, Fase 4.2 — `LIVRE` removeu a si mesmo com sucesso). A matriz de exibição desta UI, porém, é baseada apenas no papel do **alvo** (não em "é o próprio usuário"): um admin nunca vê o botão na própria linha, porque sua própria linha tem papel `admin`, que não está na lista de papéis removíveis por um admin (`gerente`/`usuario`). Isso é mais restritivo do que a RPC permite — não é uma divergência bloqueante, é uma escolha de UI deliberadamente mais conservadora, documentada aqui para transparência.

**QA REST sem escrita de `remover_usuario_empresa`** (login real por papel, chamada direta à RPC — mesmo padrão das rodadas anteriores; distinto do QA visual abaixo, que testa a interface, não o banco):

| Teste | Chamador | HTTP | Código | Resultado |
|---|---|---|---|---|
| `TRQ44` — `p_vinculo_id = null` | `PROP_A` | 400 | `TRQ44` | ✅ |
| `TRQ47` — UUID inexistente | `PROP_A` | 400 | `TRQ47` | ✅ |
| `TRQ46` — vínculo já inativo (`LIVRE`) | `PROP_A` | 400 | `TRQ46` | ✅ |
| `TRQ45` — admin removendo proprietário | `ADMIN_A` | 400 | `TRQ45` | ✅ |
| `TRQ45` — admin removendo outro admin | `ADMIN_A` | — | — | **Não aplicável** — não existe outro vínculo admin ativo além do próprio `ADMIN_A` nas fixtures atuais; nenhum dado foi criado para viabilizar o teste |
| `TRQ49` — último proprietário (autorremoção) | `PROP_A` | 400 | `TRQ49` | ✅ (confirmado exatamente 1 proprietário ativo antes de tentar) |
| Chamada anônima | — | 401 | `42501` | ✅ |

Baseline dos 4 vínculos da Empresa A (`id`, `usuario_id`, `papel`, `ativo`, `criado_em`) e contagem total (`Content-Range`) comparados byte a byte antes/depois: **idênticos**. `LIVRE` continua `ativo=false`; `PROP_A` continua `ativo=true`. Nenhum `UPDATE ativo=false` foi alcançado por nenhum dos 7 cenários — **zero escrita confirmada**.

**QA visual/estático da interface (sem rede, sem dados reais)** — 39 testes estáticos/simulados aprovados, cobrindo: matriz de exibição do botão "Remover acesso" (proprietário vê admin/gerente/usuário ativos; admin vê só gerente/usuário ativos; nenhuma linha de proprietário mostra o botão; vínculos inativos nunca mostram o botão); guarda defensiva (`validarRemocaoUsuarioEmpresa`) bloqueando vínculo inexistente, inativo, `vinculoId` vazio e papel sem permissão; Cancelar fecha o modal sem chamar a RPC; clique duplo resulta em uma única execução simulada; filtros combinados (busca/status/papel, incluindo e-mail nulo) não geram nenhuma chamada de rede; troca de empresa simulada zera lista e filtros. **Estes testes validam a lógica do código, não substituem nem foram descritos como execução "pela nova UI" real** — as próprias guardas da interface impedem intencionalmente várias dessas chamadas de chegarem à RPC (ex.: o botão nunca aparece para removê-las na tela).

**QA com escrita real — ciclo remoção + reativação (03/09/2026), pela UI real, autorizado pelo usuário:**

1. `PROP_A` (logado na interface) removeu o acesso de `USUARIO_A` na Empresa A pelo botão "Remover acesso" — vínculo passou para Inativo (`remover_usuario_empresa`, soft delete).
2. Em seguida, o mesmo vínculo foi reativado pelo modal "Adicionar usuário" (papel `usuario`) — via `incluir_usuario_empresa`, que reativa vínculo inativo existente (`UPDATE ativo=true, papel=v_papel`, preservando `id` e `criado_em`) em vez de inserir uma linha nova. A interface exibiu "Vínculo reativado com sucesso."

Verificação somente leitura pós-ciclo, via `listar_usuarios_empresa` (login real de `PROP_A`), confirmou o baseline restaurado:

| Campo | Antes do ciclo | Depois do ciclo |
|---|---|---|
| `vinculo_id` | `6dae30bd-9c21-49ad-8b67-a9fb57d1873d` | `6dae30bd-9c21-49ad-8b67-a9fb57d1873d` (idêntico) |
| `usuario_id` | `7c53ac17-cc17-4cba-9a66-e3af1a170ff9` | `7c53ac17-cc17-4cba-9a66-e3af1a170ff9` (idêntico) |
| `papel` | `usuario` | `usuario` (idêntico) |
| `ativo` | `true` | `true` (restaurado) |
| `criado_em` | `2026-08-24T09:32:31.220706+00:00` | `2026-08-24T09:32:31.220706+00:00` (idêntico — confirma reativação por `UPDATE`, não recriação por `INSERT`) |
| Total de vínculos da Empresa A | 4 | 4 (idêntico) |

`LIVRE` (`weversonantonio27+torqueqa@gmail.com`) permanece `gerente`/`ativo=false`, sem alteração. Este é o primeiro teste com escrita real feito pela UI (não por script REST) nesta fase, cobrindo ao mesmo tempo "remoção real de um vínculo de teste, com reversão" (pendência do 3º incremento) e "reativação" (pendência do 2º incremento) — a "inclusão nova" (usuário sem vínculo prévio) continua pendente.

**Ajustes de robustez aplicados após revisão** (mesma rodada, antes de qualquer teste com escrita):
- Busca por e-mail agora usa `(usuario.email || '').toLowerCase()` — não quebra mais se um registro vier sem e-mail.
- Os três controles de filtro (`#usuariosEmpresaBuscaEmail`, `#usuariosEmpresaFiltroStatus`, `#usuariosEmpresaFiltroPapel`) ganharam `aria-label` — não dependem mais só do `placeholder` para identificação acessível. Estilos inline removidos do HTML; layout agora vem da classe `.usuarios-empresa-filtros` (`style.css`), incluindo empilhamento vertical abaixo de 600px.
- `entrarNaEmpresa()` agora reseta explicitamente `usuariosEmpresaListaAtual`, `usuariosEmpresaCarregados` e os três filtros (busca vazia, status `ativos`, papel `todos`) — defensivo mesmo já havendo `location.reload()` completo em toda troca de empresa hoje, para não depender implicitamente do reload como garantia.
- Nova guarda defensiva `validarRemocaoUsuarioEmpresa()`, aplicada tanto na abertura do modal quanto imediatamente antes da chamada da RPC: confirma vínculo existente em `usuariosEmpresaListaAtual`, `ativo=true` e permissão do papel atual sobre o papel do alvo. Não substitui a segurança da RPC — só evita abrir/confirmar com estado de tela desatualizado.
- Modal de confirmação agora mostra o e-mail do alvo (`#removerUsuarioEmailAlvo`, via `textContent`), sem uso de `innerHTML`.
- Coluna "Ações" vazia (quando o botão não se aplica) não deixa mais um respiro visual em branco (`td:empty{padding:0;}`); no mobile, o botão de remoção passa a alinhar à esquerda junto do resto do cartão, em vez de ficar à direita isolado.

## 4º incremento — botão dedicado "Reativar acesso"

🟢 **IMPLEMENTADO LOCALMENTE, TESTE VISUAL E QA REST AUTOMATIZADO APROVADOS (03/09/2026, `permissoes-12-qa-reativacao-direta.js`, 5/5). Ainda não commitado/publicado.**

Não cria nenhum SQL novo — usa exclusivamente `incluir_usuario_empresa` (já publicada, mesma RPC do 2º incremento, lida integralmente antes desta implementação — ver `qa/fase-4/scripts/permissoes-11-bloquear-papel-proprietario-inclusao.sql`, versão vigente). Até este incremento, reativar um vínculo exigia reabrir "Adicionar usuário" e digitar o e-mail de novo, escolhendo um papel; agora existe um botão dedicado na própria linha do vínculo inativo.

**Botão "Reativar acesso"** (`renderUsuariosEmpresa()`, `script.js`):
- Aparece apenas em vínculos **inativos**, reaproveitando a mesma matriz `usuarioPodeRemoverAlvo()` já usada por "Remover acesso" — aplicada, aqui, ao papel **anterior** do vínculo (proprietário: pode reativar `admin`/`gerente`/`usuario`; admin: só `gerente`/`usuario`; `proprietario` nunca é alvo em nenhum dos dois fluxos). Essa reutilização não é coincidência: como o papel enviado à RPC fica travado no papel anterior (ver abaixo), a pergunta "o chamador tem autoridade sobre este papel?" é idêntica nos dois botões.

**Modal reutilizado** (`#overlayAdicionarUsuario`, mesmo do 2º incremento — nenhum modal novo foi criado):
- `abrirModalReativarUsuario(vinculoId)` troca o título para "Reativar acesso", preenche e **bloqueia** (`disabled`) o campo de e-mail com o e-mail do alvo, e reduz o `<select>` de papel a uma única opção — o papel anterior do vínculo — também bloqueada. Este fluxo **nunca** permite trocar o papel na reativação.
- `abrirModalAdicionarUsuario()` (fluxo original) foi ajustada para resetar título, habilitar os campos e restaurar as opções normais de papel sempre que reaberta — os dois modos compartilham o mesmo modal e o mesmo botão de envio.
- A confirmação do envio é o próprio clique no botão do modal (mesmo padrão já usado em "Adicionar usuário" e "Remover acesso" — não há um segundo diálogo de confirmação).
- Cancelar fecha o modal sem chamar a RPC e limpa o estado de reativação (`vinculoIdParaReativar = null`).

**Guardas defensivas** (não substituem a segurança real, que é da RPC):
- `validarReativacaoUsuarioEmpresa(vinculoId)`: usada tanto para decidir se o botão aparece quanto para validar antes de abrir o modal e imediatamente antes do envio — confirma que o vínculo ainda existe em `usuariosEmpresaListaAtual`, que continua **inativo**, e que o papel atual do chamador tem permissão sobre o papel anterior do alvo.
- Revalidação obrigatória no clique de envio: o e-mail e o papel enviados à RPC **não** vêm dos campos do modal (que só exibem, bloqueados) — vêm de uma nova chamada a `validarReativacaoUsuarioEmpresa()` no momento do clique, para não confiar em um estado que pode ter mudado desde a abertura do modal.
- Confirmação pós-chamada: só é tratado como sucesso quando a RPC retorna `reativado === true` **e** `vinculo_id` idêntico ao vínculo que abriu o modal. Qualquer divergência mostra o erro `CONFIRMACAO_REATIVACAO_FALHOU`, recarrega a lista (sem afirmar sucesso) e não fecha o modal automaticamente.
- Proteção contra duplo clique reaproveita a mesma flag `adicionandoUsuarioEmpresa` do 2º incremento (mesmo handler de envio, compartilhado pelos dois modos).
- Mapeamento de erros: mesmos códigos do 2º incremento (`TRQ24/25/26/27/28`) mais `ESTADO_DESATUALIZADO` (revalidação falhou antes do envio) e `CONFIRMACAO_REATIVACAO_FALHOU` (retorno da RPC não confirma o vínculo esperado). A mensagem de fallback (código não mapeado) agora também distingue o modo: usa o estado já existente `vinculoIdParaReativar` para mostrar "Não foi possível reativar o acesso agora. Tente novamente." no modo reativação, mantendo "Não foi possível concluir a inclusão agora. Tente novamente." no modo adicionar — nenhum estado, flag ou fluxo novo foi criado para essa distinção.

Arquivos alterados: `script.js` (estado `vinculoIdParaReativar`, `usuarioPodeRemoverAlvo()` documentada como reutilizada por ambos os botões, novo ramo em `renderUsuariosEmpresa()`, `validarReativacaoUsuarioEmpresa()`, `abrirModalReativarUsuario()`, ajustes em `abrirModalAdicionarUsuario()`, no handler de envio compartilhado e na mensagem de fallback de `mostrarErroAdicionarUsuario()`); `index.html` (apenas `id="adicionarUsuarioTitulo"` adicionado ao `<h3>` do modal reutilizado — nenhum modal, campo ou overlay novo). Nenhuma alteração em `style.css` — `.row-actions`, `td:empty` e a responsividade abaixo de 600px já são genéricas por classe, não por texto do botão.

**Teste visual aprovado (03/09/2026)**, no navegador local (`http://localhost:53170`), com o vínculo do `LIVRE` (`gerente`, inativo — único vínculo inativo disponível nas fixtures), em duas contas:
- **`PROP_A`**: botão "Reativar acesso" exibido corretamente na linha; modal abriu com título, e-mail e papel (`Gerente`) corretos e bloqueados; confirmação concluiu com sucesso; mensagem "Vínculo reativado com sucesso." exibida; lista recarregada. Em seguida, `LIVRE` foi removido novamente pelo botão "Remover acesso", restaurando o baseline (inativo/gerente).
- **`ADMIN_A`**: mesmo ciclo repetido e aprovado — administrador visualizou "Reativar acesso" para o `LIVRE` (gerente, inativo), modal com e-mail e papel bloqueados, reativação concluída com sucesso, vínculo removido novamente ao final para restaurar o baseline. Também confirmado visualmente que o administrador não possui nenhuma ação (nem "Remover acesso", nem "Reativar acesso") sobre vínculos de `proprietario` ou `admin` — consistente com a matriz `usuarioPodeRemoverAlvo()`.

Baseline restaurado e confirmado pelo usuário após os dois ciclos. Confirmação do ciclo `ADMIN_A` reforçada com evidência visual (captura de tela) fornecida pelo usuário, mostrando a matriz de exibição correta e o `LIVRE` restaurado como gerente inativo ao final.

**Teste visual restante do 4º incremento — aprovado (03/09/2026)**, completando os itens que ainda estavam pendentes:
- Cancelar: fechou o modal sem executar nenhuma chamada de rede.
- Proteção contra duplo clique: aprovada — um segundo clique durante o envio não gerou uma segunda chamada.
- Aba Network: exatamente uma chamada a `incluir_usuario_empresa` por reativação confirmada, HTTP 200; chamadas de listagem (`listar_usuarios_empresa`) e de remoção (`remover_usuario_empresa`, usada para restaurar o baseline) também HTTP 200.
- Console do navegador: sem erros da aplicação.
- Responsividade: aprovada em 600×786.
- Estado final: `LIVRE` restaurado como gerente inativo.

Com isso, o 4º incremento conclui toda a cobertura de teste visual planejada (Cancelar, clique duplo, Console, Network, responsividade abaixo de 600px, matriz de exibição para `PROP_A` e `ADMIN_A`). O único caso não coberto continua sendo um vínculo inativo cujo papel anterior é `admin`, por falta de fixture disponível para esse cenário específico.

**QA REST automatizado — executado em 03/09/2026, 5/5 aprovados**: `qa/fase-4/scripts/permissoes-12-qa-reativacao-direta.js` — equivalente do fluxo acima via chamada direta às RPCs (sem navegador), reativando o vínculo do `LIVRE` com o papel travado no valor anterior (`gerente`), confirmando `reativado=true` e `vinculo_id` idêntico ao baseline, confirmando `id`/`papel`/`ativo`/`criado_em` idênticos após a reativação (prova de `UPDATE`, não `INSERT`), e então restaurando o baseline obrigatoriamente via autorremoção do `LIVRE` — com comparação final byte-a-byte contra o estado capturado no início do script. Nenhuma falha ocorreu, então a rotina de restauração de segurança (`restaurarLivre()`, mesmo padrão de `permissoes-08-qa-del03.js`) não precisou ser acionada.

| Teste | Resultado |
|---|---|
| `PRE-REACT-01` (baseline: 4 vínculos, `LIVRE` inativo/gerente) | ✅ Aprovado |
| `REACT-01` (`PROP_A` reativa `LIVRE` com papel travado `gerente`; `reativado=true`, `vinculo_id` idêntico ao baseline) | ✅ Aprovado |
| `CONF-REACT-01` (`id`/`papel`/`ativo`/`criado_em` idênticos ao baseline — confirma `UPDATE`, não `INSERT`) | ✅ Aprovado |
| `RESTORE-REACT-01` (autorremoção do `LIVRE`, baseline restaurado) | ✅ Aprovado |
| `FINAL-REACT` (estado final byte-a-byte idêntico ao baseline) | ✅ Aprovado |

Conferência final somente leitura, independente do script (via `listar_usuarios_empresa`, login real de `PROP_A`, caminho de código diferente do usado internamente pelo script): `LIVRE` — `vinculo_id=3a24fbb6-950e-463d-801d-fe529a2ffb34`, papel `gerente`, `ativo=false`, `criado_em=2026-09-02T00:48:43.622014+00:00` (idêntico ao baseline em todos os campos); `USUARIO_A` — `vinculo_id=6dae30bd-9c21-49ad-8b67-a9fb57d1873d`, papel `usuario`, `ativo=true`; total de 4 vínculos na Empresa A. Nenhuma credencial, token ou senha apareceu na saída do script (o login só registra HTTP status e `user_id`).

## Cargo, admissão, desligamento e recontratação — investigação e decisões

🟡 **REQUISITO REGISTRADO. Investigação somente leitura (baseada em código/documentação, sem conferência ao vivo do catálogo) concluída. Decisões de escopo confirmadas pelo usuário. Nenhum SQL ou frontend criado nesta fase.**

**Investigação** (leitura de `script.js` e `qa/fase-2.5/STATUS.md`/`funcionarios-07-fix-integridade-01-add-constraint.sql` — não é uma conferência ao vivo do banco):
- `funcionarios` hoje tem `id`, `empresa_id`, `nome`, `cargo` (texto livre — o frontend restringe via `<select>` fixo, mas não há evidência de `CHECK`/enum no banco), `telefone`. **Não existem** colunas de admissão, desligamento ou vínculo com conta de usuário.
- `UNIQUE(id, empresa_id)` (`funcionarios_id_empresa_id_unique`) já existe, criada na Fase 2.5.4 — usada pela FK composta de `ordens_servico.funcionario_id`. É o padrão que a proposta abaixo reaproveita.
- `excluirFuncionario()` faz `DELETE` físico direto (`script.js`) — incompatível com preservar histórico (ver decisão abaixo).
- RLS de `funcionarios` documentada na Fase 2.5 usa nomenclatura anterior ao sistema de 4 papéis da Fase 4 ("gestor" vs. `usuario`) — **não reconfirmada ao vivo nesta sessão**.

**Proposta de estrutura** (para implementação futura, não criada agora): tabela `historico_funcionarios` (`id`, `empresa_id`, `funcionario_id`, `cargo`, `data_admissao`, `data_desligamento`, `criado_em`), com FK composta `(funcionario_id, empresa_id)` → `funcionarios(id, empresa_id)` (mesmo padrão já validado), e um índice único parcial `where data_desligamento is null` garantindo no máximo um contrato aberto por funcionário/empresa. Vínculo opcional `usuarios_empresas.funcionario_id`, nullable, com a mesma FK composta.

**Decisões confirmadas pelo usuário (02/09/2026):**
- **RLS**: inicialmente só `proprietario` e `admin` poderão visualizar e administrar admissão, desligamento e histórico profissional (menor privilégio). Acesso do `gerente` fica para estudo futuro.
- **Cargo**: `historico_funcionarios.cargo` será o registro histórico do cargo daquele período; `funcionarios.cargo` é mantido temporariamente por compatibilidade com as telas atuais. **Nenhuma sincronização improvisada ou duplicação manual permanente** — antes de implementar, será necessário definir um fluxo transacional único (RPC) que mantenha os dois consistentes. Depois da migração completa das telas para o histórico, avaliar a aposentadoria de `funcionarios.cargo`.
- **Exclusão de funcionário**: o `DELETE` físico atual é incompatível com preservar histórico. Plano futuro: adicionar estado ativo/inativo ao funcionário; "Desligar funcionário" encerra o contrato aberto e inativa o cadastro; recontratação cria novo período e reativa; ordens de serviço e períodos anteriores são preservados; sem `ON DELETE CASCADE` no histórico; exclusão física passa a ser impedida quando existir histórico.
- **Catálogo**: conferência ao vivo das policies e da estrutura real de `funcionarios` é **obrigatória** antes de preparar qualquer migração — ainda não feita (sem acesso a banco nesta sessão).
- **Escopo desta rodada**: nenhum SQL de cargo/admissão/desligamento foi criado.

## Próximos passos

- ~~Aplicar e validar `permissoes-09-listar-usuarios-empresa.sql`.~~ 🟢 Concluído — aplicado e validado no Supabase.
- ~~Validar a primeira tela de listagem por papel (proprietário/admin visíveis; gerente/usuário sem acesso).~~ 🟢 Concluído — testes visuais aprovados para proprietário, administrador e usuário.
- ~~Commit e push do frontend (seção Usuários + correção de "+ Nova empresa").~~ 🟢 Concluído — publicado em 02/09/2026, commit `793c3c5`.
- ~~QA sem escrita do 2º incremento (incluir usuário): `TRQ24`, `TRQ25`, `TRQ27`.~~ 🟢 Concluído via REST.
- ~~Aplicar e validar `permissoes-11-bloquear-papel-proprietario-inclusao.sql` (correção de regra — bloqueio de `proprietario`).~~ 🟢 Concluído — aplicado e validado no Supabase.
- ~~QA sem escrita do bloqueio `TRQ28` (proprietário e admin tentando `p_papel='proprietario'`).~~ 🟢 Concluído via REST.
- ~~QA visual parcial no navegador do 2º incremento (botão, modal, opções de papel).~~ 🟢 Concluído — aprovado para proprietário e administrador.
- Teste visual completo do 2º e 3º incremento (Cancelar, erros no modal, clique duplo, Console, Network, responsividade abaixo de 600px) — pendente, sem extensão de navegador conectada nesta sessão.
- Teste visual da conta gerente — pendente, sem conta ativa de gerente disponível nas fixtures de QA.
- ~~QA sem escrita de `remover_usuario_empresa` (`TRQ44`/`TRQ45`/`TRQ46`/`TRQ47`/`TRQ49`/anônimo).~~ 🟢 Concluído via REST (7/7 cenários aplicáveis aprovados; `TRQ45` admin-vs-admin não aplicável por falta de fixture).
- ~~QA com escrita do 2º incremento (reativação) e do 3º incremento (remoção real com reversão).~~ 🟢 Concluído pela UI real em 03/09/2026 (ciclo remoção + reativação de `USUARIO_A`, baseline restaurado — ver seção "3º incremento" acima).
- QA com escrita do 2º incremento — inclusão nova (usuário sem vínculo prévio na empresa) — ainda pendente, autorização separada.
- ~~Implementar botão dedicado "Reativar acesso" (4º incremento).~~ 🟢 Concluído — implementado, teste visual aprovado em 03/09/2026 para `PROP_A` e `ADMIN_A`.
- ~~Executar `permissoes-12-qa-reativacao-direta.js` (QA REST automatizado da reativação, com restauração obrigatória do baseline).~~ 🟢 Concluído em 03/09/2026 — 5/5 testes aprovados, baseline restaurado e confirmado por conferência independente.
- ~~Teste visual restante do 4º incremento (Cancelar, clique duplo, Console, Network, responsividade abaixo de 600px).~~ 🟢 Concluído em 03/09/2026 — todos aprovados. O caso específico de um vínculo inativo cujo papel anterior é `admin` continua sem fixture disponível para teste.
- Commit e push do 2º, 3º e 4º incrementos (frontend + `permissoes-09` já publicada + `permissoes-11` já publicada).
- Alterar papel de um vínculo existente.
- Fluxo separado de saída do próprio proprietário.
- Cargo, admissão, desligamento e recontratação — requisito registrado, análise somente leitura pendente (ver seção dedicada).
- Regressão das Fases 2.5 e 3.

## Restrições

- `CNAME` permanece fora da Fase 4 e não deve ser alterado.
- `qa/.env` não deve ser versionado.
- Nenhuma credencial deve ser documentada.
