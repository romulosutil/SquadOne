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

O fluxo observado é n8n → Google Drive → Syncthing → runner de produção →
`publicado.json` → watcher Linux → `hermes send` → WhatsApp. Não existe chamada
direta entre n8n e o runner. A rota de eventos da Produção Auto mantém uma
conexão SSE com o navegador e sinaliza novas leituras periódicas; ela não
executa, reinicia nem reconfigura nenhum desses serviços.

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

O Dell é o worker persistente. O Hermes é o gestor desse ambiente: observa e
opera os serviços Linux, o Docker e o n8n, acompanha os repositórios pelo
GitHub e usa a Central do SquadOne como superfície de leitura operacional.
Codex e Claude executam demandas pesadas nos checkouts de desenvolvimento;
Antigravity organiza documentação e arquivos.

O diretório `~/Pessoal-dev` no Dell é uma réplica Syncthing da pasta de
desenvolvimento. Ele serve para o Hermes enxergar o trabalho em andamento, mas
não é uma fronteira Git confiável: metadados `.git` podem estar incompletos.
Operações de branch, commit, push e pull usam clones Git próprios no Dell ou o
checkout de origem no Windows. O GitHub é a fronteira de integração entre os
agentes.

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

Os artefatos importáveis de `ops/n8n/workflows/` ligam a descoberta comercial
ao diagnóstico sem transformar sinais públicos em diagnóstico. O
`company_id`, derivado da chave de deduplicação do Google Places, é o vínculo
entre a fila de revisão, o formulário pré-preenchido e o retorno do Índice
PRUMO.

O Lead Scout continua responsável pela descoberta e pela priorização. Antes de
pontuar, ele consulta o site público retornado pelo Google Places e só encaminha
à fila comercial empresas com link de WhatsApp explicitamente publicado e,
quando o link contém número, um celular brasileiro direto. Fixos e 0800 são
recusados. A
prioridade usa aderência graduada (0–60), complexidade pública como proxy
(0–20) e facilidade de contato binária (0 ou 20), com corte mínimo de 60. Esses
sinais servem apenas para ordenar a revisão humana e não constituem diagnóstico
ou confirmação do decisor. A guia `Leads` apresenta um contrato humano em
português e mantém identificadores e detalhes técnicos ocultos. Um aceite
comercial explícito (`Etapa=Contato aceito`) cria o convite e muda a linha para
`Convite pronto`. Como a instância não possui credencial de
e-mail ou WhatsApp, o workflow gera uma ação `mailto:`/`wa.me` para envio
humano e não registra o convite como enviado.

Depois do Google Places, o Lead Scout consulta a página inicial do site
institucional e procura links públicos de WhatsApp. Somente essa evidência
preenche automaticamente o canal e o destino; o telefone público do Places é
mantido como referência, mas não prova que o número atende por WhatsApp. As
células amarelas e suas validações delimitam os campos sob decisão humana.

O workflow do diagnóstico consulta a cada cinco minutos a planilha vinculada
ao Google Forms com a credencial Sheets já autorizada,
mantém somente a resposta mais recente de cada um dos cinco papéis e atualiza
a linha original do lead. Sessões incompletas produzem apenas a próxima ação;
as cinco sessões completas produzem índice, médias por domínio, lacunas e um
briefing interno com revisão humana obrigatória.
