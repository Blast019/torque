# Fase 5 — SaaS / Administração

Última atualização: 2026-09-10

## Checkpoint de 10/09/2026 — Incremento 1: onboarding autorizado por convite (Alternativa A)

🔵 **SOMENTE PLANEJADO. Nenhuma implementação foi realizada** — nenhum arquivo, código, banco de dados, configuração de Auth ou remoto foi alterado até este checkpoint. Esta seção consolida, por escrito, a Proposta Técnica v4 do Incremento 1 discutida em sessões anteriores (que até agora só existia em histórico de conversa) e o resultado da auditoria de pré-implementação feita em 10/09/2026.

### Estado do Git auditado nesta data

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
1. Autenticação (`TRQ50` se `auth.uid()` nulo).
2. Validação de entrada (`TRQ51`).
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
   -- v_autorizacao_id null => TRQ52 (sem_autorizacao)
   ```
4. Lock consultivo por usuário (mesmo padrão das demais RPCs do projeto).
5. Replay idempotente por `p_empresa_id` (mesmo dono + vínculo proprietário ativo correspondente) ou criação real (`INSERT` em `empresas` + `usuarios_empresas`).
6. `unique_violation` tratado por constraint específica via `GET STACKED DIAGNOSTICS` — só classifica como `TRQ53` (id reutilizado) quando a constraint é `empresas_pkey`; qualquer outra violação de unicidade cai em `TRQ54` (mensagem genérica, sem expor nome de constraint ao chamador).

`SET search_path = ''`, `SECURITY DEFINER`, owner `postgres`, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE` só para `authenticated`/`service_role`.

**`existe_autorizacao_onboarding_pendente()`** — RPC de leitura auxiliar, retorna só um `boolean` (sem dado sensível), para o frontend saber se deve oferecer "criar empresa autorizada" a um usuário já existente (que não passa pelo fluxo de convite, e por isso não tem outro jeito de descobrir isso, já que a tabela não é legível por `authenticated`).

**Códigos de erro reservados**: `TRQ50` nao_autenticado, `TRQ51` entrada_invalida, `TRQ52` sem_autorizacao, `TRQ53` operacao_nao_permitida (colisão de id), `TRQ54` conflito_dados (qualquer outra violação de unicidade). Confirmados livres por leitura de todos os `STATUS.md` do projeto.

**Idempotência — regra final**: só é aceito como replay quando autorização, usuário **e** `p_empresa_id` coincidem todos com a primeira consumação bem-sucedida. Qualquer chamada do mesmo usuário com um `p_empresa_id` diferente, depois da autorização já consumida, é recusada (`TRQ52`).

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
| Convite expirado / autorização expirada ou revogada | 🚫 `TRQ52` |
| Usuário existente, sem vínculo, autorizado (link simples) | ✅ |
| Definição de senha após convite | ✅ |
| Login de contas existentes (antes/depois de tudo) | ✅ Inalterado |
| Retry mesmo `p_empresa_id` | ✅ Idempotente |
| Retry com `p_empresa_id` diferente / 2ª empresa com autorização já consumida | 🚫 `TRQ52` |
| Duas chamadas simultâneas, UUIDs diferentes | Uma vence, a outra `TRQ52` |
| Nenhuma empresa/vínculo parcial gravado após qualquer rejeição | ✅ (transação única, `ROLLBACK` automático) |

### Arquivos candidatos (nenhum alterado ainda)

- `index.html` — tela "Defina sua senha", formulário de dados da empresa pós-convite, remoção do link "Criar conta".
- `script.js` — tratamento de `type=invite`/`type=recovery`, chamada à nova RPC nos dois pontos de entrada, affordance para usuário existente via `existe_autorizacao_onboarding_pendente()`.
- Nenhuma migração SQL foi salva em arquivo ainda — `qa/fase-5/scripts/` **não foi criada** neste checkpoint, propositalmente.

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
