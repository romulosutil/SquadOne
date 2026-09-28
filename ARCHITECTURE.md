# Arquitetura

## Aplicação atual

- Frontend Vue em `src/`, com o escritório visual em `src/office/` e
  `src/components/GameMap.vue`.
- Servidor Express em `server.ts` e módulos de domínio em `server/`.
- Dados locais e seeds em `data/` e `seed/`.
- Arte do escritório em `public/sprites/`.

## Protótipos

Protótipos em `prototypes/` são documentos executáveis e autocontidos em HTML,
CSS e JavaScript. Eles não importam módulos da aplicação, não usam endpoints e
não devem carregar segredos, métricas ou estados operacionais reais.

O protótipo `prototypes/central-operacoes/` explora a futura superfície de
operação sem implementar infraestrutura, túneis, autenticação ou integrações.

## Central de Operações

A mesma aplicação possui dois perfis selecionados no servidor por
`SQUADONE_MODE`:

- `app` preserva o comportamento remoto e não registra `/api/operations/*`;
- `operations` serve a Central em `/`, o app existente em `/squadone`, registra
  as rotas locais e troca o bind do Express para `127.0.0.1`.

`src/RootApp.vue` consulta somente `/api/runtime` para escolher a superfície.
Os componentes da Central ficam em `src/operations/`; eles não incorporam o
SquadOne em iframe e usam navegação interna para `/squadone`.

A Central tem duas rotas, sem dependência adicional de roteador:

- `/` responde se o Dell está bem, mostra a agenda de hoje e os acessos
  (Terminal, n8n, Hermes, Syncthing, SquadOne, Produção Auto);
- `/projetos/producao-auto` contém o painel completo da Produção Auto.

O estado do Dell vem de `SQUADONE_OPERATIONS_DATA_DIR/status.json`, gravado a
cada minuto por `deploy/dell/dell-status.py` e lido por `server/dell-status.ts`
dentro de `GET /api/operations/overview`. O mesmo monitor avisa o Rômulo pelo
Hermes quando algo quebra e quando volta. Retrato com mais de 5 minutos vira a
falha "Monitor do Dell". As rotas de projetos e leituras do Hermes seguem no
servidor, mas saíram da interface em 23/09/2026.

`server/operations.ts` contém a fronteira local:

- valida e persiste projetos em JSON com substituição atômica;
- aceita somente caminhos Linux absolutos ou URLs `http`/`https`;
- verifica uma lista fixa de serviços lida da configuração privada, com timeout
  curto e sem aceitar comandos ou URLs enviados pelo navegador;
- expõe somente launch URLs, estados e detalhes não sensíveis à interface.

`server/auto-production.ts` lê somente artefatos conhecidos nas subpastas do
diretório `autoDirectory` configurado localmente. A mesma fronteira agrega as
evidências já emitidas pela automação: `.logs/status.json` e o log do runner,
o arquivo de deduplicação do watcher do Hermes e a saúde HTTP configurada para
o Hermes. Os marcos humanos de envio ao cliente e confirmação são gravados
separadamente em `SQUADONE_OPERATIONS_DATA_DIR/auto-production.json`, com
escrita atômica. A presença de `publicado.json` é exposta apenas como registro
local e não como prova de disponibilidade pública.

O fluxo observado é Caçador do n8n → pacote em `auto-entrada` → `~/auto-site`
→ `gerador-de-sites` (Claude Code + Vercel) → `publicado.json` → watcher Linux
→ `hermes send` → WhatsApp; o Balcão do n8n lê os mesmos `publicado.json` em
`~/auto-site`. O Google Drive saiu do fluxo em 23/09/2026: a pasta `auto` do
Drive era só um espelho, pelo PC, e está parada desde 25/09/2026 (ver
`deploy/pc/README.md`). Não existe chamada direta entre n8n e o runner. A rota
de eventos da Produção Auto mantém uma conexão SSE com o navegador e sinaliza
novas leituras periódicas; ela não executa, reinicia nem reconfigura nenhum
desses serviços.

A listagem de clientes é consultável e paginada no servidor. O resumo e o
funil continuam representando todo o diretório; busca, estágio, ordenação e
página limitam apenas as linhas devolvidas. Isso evita renderizar toda a base
à medida que novos clientes e sites forem anexados.

As leituras do Hermes são uma entrada local, somente leitura, carregada de
`SQUADONE_OPERATIONS_DATA_DIR/hermes-readings.json`. Cada leitura identifica o
projeto, a origem, o instante, o resumo e a evidência disponível. A ausência do
arquivo representa uma caixa vazia; a interface não inventa leituras nem oferece
uma escrita genérica em nome do agente.

A agenda da Central reutiliza o armazenamento OAuth e a leitura do Google
Calendar do processo local do SquadOne. A credencial fica no Dell e é
independente da produção; o callback retorna por loopback. Não existe agenda
paralela: sem essa autorização local, a API devolve explicitamente
`disconnected`. A ação de conexão da Central inicia `/api/auth/google`
diretamente e o callback retorna à raiz da Central.

No Dell, `deploy/dell/squadone-operations.service` é instalado como serviço de
usuário com linger. O arquivo de ambiente, a configuração real e os dados ficam
respectivamente em `~/.config/squadone/operations.env`,
`~/.config/squadone/operations.json` e
`~/.local/share/squadone-operations`.

## Modelo operacional pessoal

O Dell é o worker persistente e o servidor de projetos (Docker). Claude e
Codex controlam e corrigem o ambiente a partir da máquina de controle, pelo
SSH, Tailscale e Syncthing.

**Máquina de controle, desde 28/09/2026:** o PC Windows queimou (NVMe; visto
pela última vez em 25/09/2026) e, até o PC novo chegar, o próprio Dell é a
máquina de controle: Claude e Codex rodam nele. O que não tinha sincronizado
com o Dell nem ido ao GitHub foi perdido. O PC novo vai receber a organização
do SquadOne; estado, consequências e checklist em `deploy/pc/README.md`.

O Hermes é o secretário: não opera, só informa pelo WhatsApp, a partir das
rotinas dele e dos avisos do monitor `dell-status` e do n8n. O n8n do Dell é o
gerente de fluxos e todo fluxo termina respondendo a alguém (Error Workflow
único + avisos pela fila). O SquadOne é o gerente de agendas. Antigravity
organiza documentação e arquivos.

O repositório CORPORATIVO é espelhado em `~/Corporativo-dev` como somente
leitura no Dell: era editado no PC e nada no Dell propaga de volta. Sem o PC,
a pasta é o último retrato de 25/09/2026 e não recebe mais nada.

O diretório `~/Pessoal-dev` no Dell é uma réplica Syncthing da pasta de
desenvolvimento do PC, congelada em 25/09/2026. Ele serve para o Hermes
enxergar o trabalho, mas não é uma fronteira Git confiável: metadados `.git`
podem estar incompletos. Operações de branch, commit, push e pull usam clones
Git próprios no Dell (o checkout de origem no Windows se perdeu com o PC). O
GitHub é a fronteira de integração entre os agentes.

Credenciais não ficam na pasta sincronizada, em skills ou na configuração do
SquadOne. OAuth do n8n usa o armazenamento cifrado de credenciais do próprio
n8n. Sessões web persistentes podem auxiliar o Hermes, mas login inicial, MFA
e consentimentos sensíveis permanecem sob ação humana. O SquadOne recebe
estado e evidências; ele não recebe senhas, tokens nem poder de controle sobre
os serviços.

O playbook instalável do gestor fica em
`deploy/hermes/skills/dell-operations-manager/SKILL.md`.

O modelo de orquestração, as conexões pendentes e a separação entre credenciais
humanas, OAuth e segredos técnicos estão em
`docs/OPERATIONS-SECRETS-AND-ORCHESTRATION.md`.

## Workflows PRUMO no n8n

Desde 23/09/2026 o PRUMO é simples (decisão do Rômulo). A planilha "PRUMO — Fila
de revisão" tem uma aba de trabalho, **Prospects**, com uma coluna **Etapa**:
Revisar → Convite enviado → Diagnóstico pronto → Concluído | Sem interesse.
"Descartados" (só para não reavaliar) e a antiga "Leads" ficam ocultas.

- **Lead Scout** (9h, rodízio de 80 buscas segmento × cidade): Google Places →
  WhatsApp publicado no site → nota → Prospects (com o link "Enviar convite ↗")
  ou Descartados; cadastro repetido (mesmo WhatsApp) é descartado. Resumo da
  busca pelo Hermes.
- **Clique em "Enviar convite"** (webhook do n8n pelo túnel): Etapa → Convite
  enviado e abre o WhatsApp com a mensagem e o formulário já com a empresa e o
  papel "Dono".
- **Diagnóstico do dono** (de hora em hora): a resposta completa mais recente
  da empresa fecha o Índice PRUMO, grava Índice e Briefing na linha, muda a
  Etapa para Diagnóstico pronto e avisa pelo Hermes. Também grava as
  pendências que a Central mostra em "Esperando você".

O vínculo entre formulário e linha é o `ID` (ID do Google Places), enviado no
campo Empresa como `ID::Nome`. Os scripts que montam tudo isso estão em
`deploy/dell/claude-ops/` (`prumo-simples.py`, `prumo-ajuste-planilha.py`); os
JSON em `ops/n8n/workflows/` e o `scripts/prepare-prumo-workflows.mjs`
descrevem a versão anterior.

## Radar PNCP

O radar PNCP é executado pelo Compose em `~/licitacoes-automation` no Dell, com
fontes versionadas em `deploy/dell/licitacoes-automation/`. O n8n apenas inicia
a coleta: `POST /collect` responde `202 Accepted` com um `collection_id`, e o
collector consulta o PNCP em segundo plano. Uma nova chamada durante a coleta
ativa reutiliza o mesmo ID; `GET /collections/:id` expõe o estado persistido.
Falhas da fonte são gravadas como `source_unavailable` para a próxima execução
agendada tentar novamente sem manter o workflow bloqueado.
