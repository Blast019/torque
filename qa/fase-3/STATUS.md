# TORQUE — Status da Fase 3 (Contexto da empresa)

Última atualização: 2026-08-28

## 1. Resumo

```
FASE 3 — Contexto da empresa                        🟢 CONCLUÍDA
├── Contexto por vínculos ativos (usuarios_empresas)  🟢 CONCLUÍDA
├── Zero / um / múltiplos vínculos                    🟢 CONCLUÍDA
├── Escolha de empresa salva por usuário               🟢 CONCLUÍDA
├── Seletor de empresa + botão "Trocar"                🟢 CONCLUÍDA
├── Cadastro inicial (criar_empresa_com_vinculo)       🟢 CONCLUÍDA (RPC pré-existente, revalidada nesta fase)
└── Nova empresa com plano independente
    ├── RPC criar_nova_empresa_com_vinculo             🟢 CRIADA E VALIDADA (owner/grants/ACL conferidos)
    └── Frontend "+ Nova empresa"                      🟢 IMPLEMENTADO
```

Todos os artefatos SQL referenciados abaixo estão em `qa/fase-3/scripts/`.

## 2. Contexto de empresa por vínculos ativos

O contexto ativo do usuário nunca é resolvido por `empresas.owner_id` no frontend — é resolvido exclusivamente por `usuarios_empresas.usuario_id` com `ativo = true` (`buscarVinculosAtivos()` em `script.js`). `empresas.owner_id` só é usado dentro das RPCs, no banco, para a lógica de criação/idempotência.

- **Zero vínculos ativos**: se houver `pending_empresa = true` no `user_metadata` (vindo do cadastro), dispara `finalizarCadastroPendente()` → RPC `criar_empresa_com_vinculo`. Caso contrário, mostra o estado "Sem vínculo" com opção de sair.
- **Um vínculo ativo**: entra direto nele via `entrarNaEmpresa()`, sem consultar a escolha salva (não há "outra" empresa para escolher).
- **Múltiplos vínculos ativos**: usa a escolha salva se ainda for válida (`validarEscolhaSalva()`); caso contrário, mostra `mostrarSeletorEmpresa()`. Nunca escolhe `vinculos[0]` arbitrariamente.

## 3. Escolha salva por usuário

Chave `torque_empresa_ativa:{usuarioId}` no `localStorage`. `validarEscolhaSalva()` só aceita o valor salvo se ele corresponder a um vínculo ativo já carregado no boot atual; se o vínculo foi desativado ou a empresa não existe mais na lista, a chave é removida do `localStorage` nesse mesmo carregamento — nunca confia cegamente no valor salvo.

## 4. Seletor de empresa e botão "Trocar"

`mostrarSeletorEmpresa()` lista os vínculos ativos e, agora, também o botão `+ Nova empresa` (`#novaEmpresaSeletorBtn`). `trocarEmpresaBtn` reaproveita a lista já carregada no boot (sem repetir a consulta) e fica oculto quando há 1 vínculo só — acessível também com a sidebar recolhida/mobile (ícone permanece visível, só o rótulo de texto some).

## 5. Cadastro inicial

Fluxo inalterado nesta Fase, apenas revalidado: `signUp()` grava `pending_empresa` e os dados da empresa como metadata pendente (nenhuma empresa é criada nesse passo); a criação real (empresa + vínculo `proprietario`) acontece via `criar_empresa_com_vinculo`, chamada por `finalizarCadastroPendente()` assim que existe uma sessão autenticada de verdade. Definição completa, owner e grants efetivos em `empresas-01-criar-empresa-com-vinculo-inicial.sql`.

## 6. Nova empresa e plano independente

Nova RPC `public.criar_nova_empresa_com_vinculo(uuid, text, text, text)` (`empresas-02-criar-nova-empresa-com-vinculo.sql`), permitindo que um usuário já autenticado crie empresas adicionais. Cada empresa nova recebe `plano`/`status_assinatura` pelo `DEFAULT` da tabela (`Teste`/`ativo`), de forma independente das demais empresas do mesmo dono — não há nenhum compartilhamento ou herança de plano entre empresas do mesmo usuário.

Pontos de acesso no frontend, sem sobrecarregar a `company-pill`/sidebar:
- Botão `+ Nova empresa` no seletor (`#novaEmpresaSeletorBtn`).
- Seção "Minhas empresas" em Configurações (`#novaEmpresaConfigBtn` + `#minhasEmpresasLista`), acessível mesmo quando o usuário só tem 1 empresa hoje.

Idempotência via `p_empresa_id` (uuid) gerado no cliente com `crypto.randomUUID()`, capturado em variável local antes do `await` da chamada, com Submit/Cancelar bloqueados durante a requisição, `try/catch/finally` e validação de `resultado.empresa_id` antes de persistir a escolha — reaproveitando o fluxo já existente `persistirEscolhaERecarregar()`.

`criar_empresa_com_vinculo` permanece intocada (reconferida via `pg_get_functiondef` nesta Fase — ver `empresas-03-conferencia-rpcs.sql`).

## 7. Testes

| Teste | Resultado | Fonte |
|---|---|---|
| Cadastro completo (signUp → confirmação de e-mail → `criar_empresa_com_vinculo` → entrada automática) | 🟢 Aprovado | Teste manual do usuário |
| Reload (F5) mantendo contexto/sessão | 🟢 Aprovado | Teste manual do usuário |
| Logout / login preservando escolha salva | 🟢 Aprovado | Teste manual do usuário |
| Escolha salva inválida (empresa/vínculo não corresponde mais) é limpa do `localStorage` | 🟢 Aprovado | Teste manual do usuário |
| Múltiplos vínculos — seletor aparece, escolha persiste corretamente | 🟢 Aprovado | Teste manual do usuário |
| Idempotência de `criar_nova_empresa_com_vinculo` (retry com mesmo `p_empresa_id`) | 🟢 Aprovado | Teste manual do usuário |
| Chamada anônima (sem sessão) à `criar_nova_empresa_com_vinculo` → `HTTP 401` / `42501 insufficient_privilege`, sem alcançar `auth.uid()`, nada criado | 🟢 Aprovado | **Verificado nesta sessão** via chamada HTTP direta (`apikey`/`Authorization` = anon key, sem JWT de usuário) |
| Isolamento entre usuários — colisão de `p_empresa_id` de outro dono retorna erro genérico `TRQ16`, sem expor dados | 🟢 Aprovado | Teste manual do usuário |
| Responsividade (desktop e mobile) do modal "Nova empresa", seletor e seção "Minhas empresas" | 🟢 Aprovado | Teste manual do usuário |

## 8. Empresas de QA

- `QAteste` e `[TESTE] QA Fase 3 - Seletor` — **preservadas** intencionalmente como fixtures de QA da Fase 3, não removidas.
- `qateste 002` — **removida**, seguindo o procedimento de limpeza controlada (SELECT pelo `id` exato, confirmação visual, depois um único `DELETE` em `empresas`). O vínculo correspondente em `usuarios_empresas` foi removido automaticamente por `ON DELETE CASCADE` da foreign key — nenhum `DELETE` separado foi executado nessa tabela. Cascade confirmado pelo usuário.

## 9. Fora do escopo desta Fase

Cobrança, expiração de teste/assinatura, inadimplência e gestão de planos ficam para a **Fase 5 — SaaS / Administração**. Nesta Fase 3, `plano`/`status_assinatura` só recebem o `DEFAULT` da tabela na criação — nenhuma regra de cobrança, transição de status ou expiração automática foi implementada.

## 10. Alteração posterior (identificada e desenvolvida na Fase 4.3)

Esta seção registra uma mudança de regra de negócio feita **depois** da Fase 3 estar concluída (seções 1-9 acima descrevem o estado original e permanecem como registro histórico, sem alteração).

Durante o teste local da Fase 4.3, foi identificado que o botão "+ Nova empresa" ficava visível e funcional para **qualquer papel** (inclusive `usuario`), porque nem o frontend nem `criar_nova_empresa_com_vinculo` jamais validaram o papel do chamador em nenhuma empresa. Nova regra aprovada pelo usuário:

> Somente quem possuir vínculo ativo com papel `proprietario` na empresa **atualmente selecionada** pode criar outra empresa.

Status: 🟢 **CONCLUÍDO E PUBLICADO. Migração aplicada e validada no Supabase (02/09/2026); frontend publicado em 02/09/2026 no commit `793c3c5` — backend e frontend sincronizados.**

Mudanças:
- **Frontend**: botão `#novaEmpresaSeletorBtn` (tela de seleção de empresas) **removido** — nesse ponto do fluxo não existe "empresa atualmente selecionada" para validar, então o conceito não se aplica; quem for proprietário poderá selecionar a empresa e usar o botão em Configurações. Botão `#novaEmpresaConfigBtn` (Configurações) passa a ser mostrado/ocultado em `entrarNaEmpresa()` conforme `contextoEmpresa.papel === 'proprietario'`. `abrirModalNovaEmpresa()` ganhou uma guarda defensiva equivalente (não abre o modal se o papel atual não for `proprietario`) — a autorização real continua sendo do backend.
- **Backend**: migração `empresas-04-restringir-nova-empresa-a-proprietario.sql`, que substitui `criar_nova_empresa_com_vinculo(uuid, text, text, text)` por `criar_nova_empresa_com_vinculo(uuid, text, text, text, uuid)` (novo parâmetro obrigatório `p_empresa_origem_id`), com checagem de vínculo ativo `proprietario` na empresa de origem (novo código `TRQ15 sem_permissao`) antes de qualquer lógica de criação/idempotência. A assinatura antiga de 4 parâmetros foi removida (`DROP FUNCTION`) na mesma transação, para que não continuasse chamável via REST direto contornando a regra. `empresas-02-criar-nova-empresa-com-vinculo.sql` **não foi alterado** — permanece como registro histórico da assinatura original; `empresas-04` é a migração que levou de um estado ao outro.
- `criar_empresa_com_vinculo` (cadastro inicial de contas sem nenhum vínculo, seção 5 acima) **não foi tocada** — permaneceu fora do escopo desta mudança.

**Verificação pós-migração** (somente leitura, feita pelo usuário diretamente no SQL Editor do Supabase): assinatura antiga removida; assinatura nova (5 parâmetros) existente; `VOLATILE`; `SECURITY DEFINER`; `search_path` vazio; owner `postgres`; `anon` sem `EXECUTE`; `authenticated` e `service_role` com `EXECUTE`.

**QA funcional** (login real por papel + chamada REST direta à RPC, mesmo padrão das demais RPCs desta fase — script versionado em `empresas-05-qa-restricao-nova-empresa.js`):

| Teste | Resultado |
|---|---|
| `ADMIN_A`, origem = Empresa A | 🟢 `TRQ15` |
| `USUARIO_A`, origem = Empresa A | 🟢 `TRQ15` |
| Conta com papel `gerente` e vínculo **inativo**, origem = Empresa A | 🟢 `TRQ15` |
| `PROP_A`, origem = Empresa B (isolamento — não é proprietário lá) | 🟢 `TRQ15` |
| `PROP_A`, `p_empresa_origem_id = null` | 🟢 `TRQ14` |
| Chamada omitindo `p_empresa_origem_id` (formato da assinatura antiga) | 🟢 `TRQ14` (não "função não encontrada" — evidência funcional de que a assinatura antiga não existe mais, ver comentário no script) |
| Chamada anônima | 🟢 HTTP `401` / `42501` |
| Replay idempotente: `PROP_A`, `p_empresa_id`/`p_empresa_origem_id` = Empresa A (própria, existente) | 🟢 HTTP `200`, `criada_agora=false`, mesmo `empresa_id`/`vinculo_id`, nome/CNPJ/telefone reais preservados (não substituídos pelos valores de teste enviados) |

**Consolidado: 8/8 aprovados.** Nenhuma conta com papel `gerente` e vínculo **ativo** existe hoje nas fixtures de QA — o teste acima usa a mesma conta (`LIVRE`) já documentada como tendo esse papel com vínculo inativo (ver `qa/fase-4/STATUS.md`); a cobertura de "papel insuficiente com vínculo ativo" fica a cargo do teste com `USUARIO_A`. Nenhuma empresa nova, vínculo novo ou dado existente foi criado/alterado por nenhum desses testes — confirmado por leitura antes/depois em todos os casos. Nenhum `service_role` foi usado. O bloco de `INSERT` da função (criação real de empresa nova) **não foi exercitado** por nenhum teste desta rodada.

Ver `qa/fase-4/STATUS.md` para o achado original e o acompanhamento desta correção no contexto da Fase 4.3.
