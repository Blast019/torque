# Fase 5 — SaaS / Administração

Última atualização: 2026-09-11

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
