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

A Central é dividida em rotas navegáveis sem dependência adicional de roteador:

- `/` concentra agenda, foco, projetos fixados e leituras recentes;
- `/projetos` é o catálogo pesquisável de projetos;
- `/projetos/producao-auto` contém o painel completo da Produção Auto;
- `/leituras` é a caixa de entrada global do Hermes.

Projetos podem ser módulos internos com dashboard, atalhos locais de acesso ou
uma combinação dos dois. Módulos internos são registrados no frontend; atalhos
continuam no armazenamento privado de projetos. A página inicial mostra apenas
uma seleção fixada, sem replicar os dashboards completos.

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
