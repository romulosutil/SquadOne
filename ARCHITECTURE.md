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

## App único no Dell (decisão de 05–06/10/2026)

Até 06/10/2026 o SquadOne eram duas metades: o app do Easypanel tinha os
agentes sem o mundo (só a agenda), e a Central do Dell tinha o mundo (CRM,
estado do Dell, fluxos) sem agentes, com um botão de uma para a outra. A
decisão é juntar as duas num **app único, mobile first, no Dell**. Este
documento e o `RULES.md` mudaram antes do código (regra 6); o que está abaixo
é o alvo, e "Transição" diz o que ainda não é verdade hoje.

```
celular ── Telegram ──► bot (getUpdates, buscado pelo Dell) ─┐
celular ── tailnet :8443 (Serve, ACL, header de identidade) ─┤
                                                             ▼
                         SquadOne no Dell, 127.0.0.1:9120 (perfil operations)
                           ├─► Google Calendar e Tasks (credencial do Dell)
                           ├─► finanças (financas.db; Meu Pluggy, OFX/CSV de reserva)
                           ├─► sinais: status.json, retrato do CRM, ~/auto-site
                           └─► fila de avisos (schema e teto) ─► Hermes ─► WhatsApp
                                    └─ P0 também ─► Telegram
healthchecks.io ◄── sinal de vida do Dell; parou = avisa por Telegram e e-mail
Easypanel: reserva fria, travada, sem TELEGRAM_*
```

- **Um processo, um bind.** O perfil `operations` passa a montar o app (roster,
  turno, Mochila, ajuste, avisos, finanças) além da Central, em
  `127.0.0.1:9120`, publicado só pelo Tailscale Serve na 8443 e nunca pelo
  Funnel. Acesso: ACL do Tailscale com os aparelhos do Rômulo, header
  `Tailscale-User-Login` conferido pelo servidor, `Origin` da mesma origem nas
  escritas e o porteiro de IP por último (regra 7).
- **Escrita só por gesto.** A infraestrutura continua somente leitura; o
  domínio (Calendar, Tasks, roster, CRM, finanças) só muda por gesto do
  usuário ou cartão confirmado (regra 10). Link no WhatsApp abre; confirmar é
  um `POST` na tela.
- **Home "Hoje"**, com barra inferior Hoje · Funil · ＋Pedir · Finanças · Mais
  no celular (lateral a partir de 1024 px). Ordem e teto de cartões na regra
  13. O escritório pixel art continua, em "Mais", com lista como padrão no
  celular.
- **Canais** (regra 20):

  | O quê | Por onde | Por quê |
  |---|---|---|
  | Demandas (texto, áudio, `/foco`, `/baixa`) | Telegram, `getUpdates` pelo Dell | sem URL pública: Funnel é proibido |
  | Resultado do turno e botões | Telegram, na mesma conversa | resposta a um gesto; os botões só existem lá |
  | Lembretes, falhas, cartões, alertas de finanças | WhatsApp do Hermes, pela fila | ponto único com teto: o número é o mesmo dos leads |
  | Cartão que pede decisão | WhatsApp com link da tailnet | abrir não confirma |
  | P0 | WhatsApp + espelho no Telegram | a sessão do WhatsApp não é oficial e cai |
  | Dell sumiu | healthchecks.io (Telegram e e-mail) | o Hermes cai junto com o Dell |

  O Hermes é só transporte: o SquadOne decide quando e o quê, grava na fila, e
  o `dell-status` drena com as regras dela (formato e campos em
  `deploy/dell/README.md`, "Fila de avisos"). O ntfy deixa de existir.
- **Finanças** num banco próprio (`financas.db`, permissão 600, backup pelo
  cofre restic), fonte principal Meu Pluggy e OFX/CSV de reserva. A regra que
  segura a dupla contagem: o pagamento da fatura nunca é despesa, só quita o
  cartão. Valores em R$ ficam no app; os canais recebem semáforo e %; nada vai
  ao modelo sem pedido (regra 24).
- **Easypanel como reserva fria**: implantável, travado, sem as variáveis do
  Telegram, sem vigia (regra 25). É a volta ensaiada se o Dell morrer.

### Transição

O que ainda **não** é como acima, e em que ordem muda (o plano completo está no
artefato "SquadOne Único", versão 2 de 06/10/2026):

1. **Higiene** (feita em 06/10/2026, PR #20): a escrita do app saiu do perfil
   `operations`, porque o `data/squad.json` do Dell é um retrato de 14/09/2026;
   `/api/runtime` diz `ocupado`; a fila de avisos ganhou schema e teto; os
   bancos Docker entraram no cofre.
2. **Regras** (este documento e o `RULES.md`).
3. **Finanças no Dell**, que não esperam a mudança da agenda: banco próprio,
   tela de Visão, e nasce a casca mobile (tokens, barra inferior com o ＋Pedir
   desabilitado). Implementado em 07/10/2026 (ver "Finanças", abaixo); a
   conferência de identidade do Serve entrou junto; desde a mudança da agenda
   a lista é a mesma dela, `SQUADONE_LOGINS_TAILSCALE`.
4. **Mudança da agenda para o Dell.** O roster de **produção** é a verdade; o
   do Dell é arquivado, nunca mesclado, com as contratações congeladas durante
   a troca. O código (diretório de dados fora do clone, polling do Telegram,
   avisos pela fila, travas de identidade e origem, sinal de vida) chega
   desligado: a agenda só liga no Dell com `SQUADONE_DATA_DIR` presente e fora
   do checkout. O runbook, passo a passo e com volta em cada um, é
   `deploy/dell/CUTOVER-AGENDA.md`. Nesta ordem:
   1. tirar `TELEGRAM_*` do Easypanel e implantar;
   2. copiar o `squad.json` de produção para o Dell;
   3. travar o Easypanel (`IPS_PERMITIDOS=127.0.0.1`), implantável;
   4. `deleteWebhook` **sem** `drop_pending_updates` (as mensagens pendentes
      passam a ser buscadas pelo Dell, e a guarda de 10 min continua valendo)
      e ligar o `getUpdates`;
   5. vigia do Dell avisando pelo WhatsApp em sombra por 3 dias úteis, com o
      ntfy ainda ligado;
   6. só com a sombra validada pelo Rômulo: apagar `server/push.ts`, as rotas
      `/api/push/*` e `LEMBRETES_NTFY_URL`, e depois o serviço ntfy do
      Easypanel e o app do celular.

   Até este passo, o botão "Agentes do SquadOne" (`OperationsHeader.vue`,
   `AccessPanel.vue`, `fluxos.ts`) e o `/squadone` ainda levam ao Easypanel, e
   o bot do Telegram ainda é webhook no Easypanel.
5. **Casca mobile completa**: `App.vue` dividido, Pedir como folha, Hoje na
   ordem da regra 13, escritório com Lista|Mapa.
6. Organização das finanças e alertas de 70/90/100% (feito em 07/10/2026, ver
   "Organização das finanças"); 7. PRUMO como uma squad, com o Site antes da
   venda como sala (feito em 07/10/2026, ver "PRUMO como squad"); 8. o resto
   (roster em SQLite, Luna em sombra, explicação com IA).

### PRUMO como squad (07/10/2026)

SquadOne (app) › PRUMO (squad `prumo`) › Site antes da venda (sala). Criada
no roster de produção do Dell pelo fluxo de Nova squad que já existia (Nova
squad, ✎ na sala raiz, Abrir sala três vezes), sem mudar o schema v3. São
quatro salas, no máximo, e cada uma é **quem trabalha**, não uma etapa do
funil — as etapas continuam em `src/operations/fluxos.ts` e nas planilhas:

| Sala (id) | Quem trabalha | Automáticos (catálogo) |
|---|---|---|
| Atendimento e proposta (`prumo--geral`, sala raiz) | todo contato com lead e dono: convite, abordagem com o site, follow-up, conversa, proposta, fechamento; e o do PRUMO sem outra sala | Balcão |
| Prospecção (`prumo--prospeccao`) | achar e qualificar empresas nos dois produtos, antes do primeiro contato | Caçador, Lead Scout |
| Site antes da venda (`prumo--site-antes-da-venda`) | fazer, publicar, ajustar e pausar os sites (demo e de quem fechou) | gerador |
| Organizar (`prumo--organizar`) | a consultoria: diagnóstico, Índice PRUMO, Mapa, entrevistas, recomendação, workshop | Diagnóstico |

- **`prumo--geral` é o Atendimento.** Nova squad sempre nasce com a sala
  "Geral"; ela foi renomeada no ✎, e id nunca muda. Ser a sala raiz combina
  com o papel: o PO dela é quem fala com o cliente e recebe o que não tem
  outra sala.
- **"Não cuida de" explícito em todo escopo** (squad, sala e treino do PO),
  apontando a sala ou a squad certa. É o que evita ida e volta no
  redirecionamento: a squad PJ já tinha uma sala Prospecção (clientes
  freelance). Os dois lados dizem a fronteira: o escopo da squad PRUMO não
  cuida deles, e o da sala `pj--prospeccao` ganhou "Não cuida de: PRUMO e
  Site antes da venda (squad PRUMO)". O treino só existe no roster de
  produção; muda-se pelo ✎, não pelo Git.
- **Telegram `/p`** (`server/telegram-entrada.ts`, `PREFIXOS_DE_SQUAD`):
  prefixo sem estado que fixa a squad `prumo` pelo id, combinável com
  `/foco`/`/baixa` em qualquer ordem e na legenda do áudio. Nenhuma chamada a
  mais ao modelo; o redirecionamento automático continua como rede. Squad
  arquivada ou sumida: o turno falha antes do Gemini e a resposta diz para
  mandar sem o prefixo (regra 20).
- **Catálogo dos trabalhadores automáticos** (`src/office/trabalhadores.ts`,
  regra 26): versionado, fora do prompt, mostrado em texto sob cada sala no
  painel de salas. Cada trabalhador aponta para a mesma verificação do
  `status.json` que o passo dele em `fluxos.ts`; o teste confere as duas
  listas e que nenhum módulo do servidor importa o catálogo.

### Finanças (07/10/2026)

Como está no código (perfil `operations`; instalação e conferência em
`deploy/dell/README.md`, "Finanças"):

```
Meu Pluggy (Santander, Nubank, Mercado Pago)
  └─ api.pluggy.ai ── polling 1x/dia depois das 7h + botão "Atualizar agora"
       └─ server/financas/sync.ts ── por conexão, numa transação
            ├─ pluggy-mapa.ts (PURO): JSON → conta, fatura, transação
            ├─ dedupe.ts (PURO): PENDENTE→LANÇADO, id trocado, Pluggy vence PDF
            └─ banco.ts: financas.db (SQLite, 600, migrações em user_version)
       └─ processar.ts (PURO), sobre tudo: natureza → fatura → pagamento pelo
          valor → pares entre contas → parcelas → categoria (refeito também ao
          abrir as finanças: uma regra nova vale no deploy)
       └─ VACUUM INTO financas.copia.db (600) → cofre restic
fatura do Santander em PDF ── pdf-texto.ts → fatura-santander.ts (PURO)
  └─ conferência contra o total da fatura da Pluggy → grava no 2º toque
extrato OFX/CSV de reserva ── extrato.ts (PURO) → parearEntreFontes contra a Pluggy
/api/financas/{visao,lancamentos,sincronizar,importar/santander,importar/extrato,
               organizacao,categorias,orcamento,recorrentes,estado,alertas/simular}
  └─ resumo.ts (PURO): tenho, devo, gastei (competência|caixa), orçamento, recorrentes
  └─ alertas.ts (PURO): 70/90/100% → fila de avisos (só % e semáforo)
Telegram "gastei 30 no mercado" ── gasto-falado.ts (PURO) → conta manual
```

- **Dinheiro em centavos inteiros**, com sinal do ponto de vista do
  patrimônio (negativo = saiu ou aumentou a dívida). A conferência da fatura
  exige bater no centavo.
- **A regra da dupla contagem** (`natureza.ts`, teste obrigatório em
  `visoes.test.ts`): o pagamento da fatura na conta é sempre
  `pagamento_fatura`, reconhecido pela descrição/categoria **ou** pelo valor
  (igual a um pagamento registrado na fatura a ±3 dias, ou ao total perto do
  vencimento) **ou** pelo par com o "pagamento recebido" no cartão. Na
  competência conta a compra (no mês da fatura); no caixa, o pagamento; nunca
  os dois.
- **Devo** por cartão = o limite usado que o banco informa, quando ele dá o
  disponível; o detalhe (fatura fechada a pagar + fatura aberta + parcelas
  futuras, sem sobrepor) aparece abaixo, e a diferença vira "sem detalhe" em
  vez de sumir. A fatura aberta soma os lançamentos já listados e as parcelas
  dela que o banco ainda não lançou (o Santander e o Mercado Pago lançam as
  parcelas no dia do fechamento; sem a projeção, um mês inteiro de parcelas
  virava "sem detalhe"). A Pluggy não dá id de compra parcelada: o grupo é heurístico
  (`parcelas.ts`) e a chave é a **data da compra** quando a fonte a dá
  (`purchaseDate`, a data da linha no PDF): datas diferentes são compras
  diferentes, e na mesma data o valor da parcela pode variar até 1% (o
  Santander e o Mercado Pago cobram as primeiras uns centavos acima; com a
  tolerância de 1 centavo a mesma compra virava dois grupos e as parcelas
  que faltam contavam em dobro). Sem a data, valor ±1 centavo e mês de
  origem ±1.
- **O pago de uma fatura sai da data do pagamento** (`pagoDasFaturas`), não
  do `pago` que a fonte põe nela: um pagamento quita a última fatura que já
  tinha fechado. Cada banco informa de um jeito: o Mercado Pago e o Nubank
  põem na fatura o pagamento dela; o Santander põe os pagamentos feitos
  dentro do ciclo, que são da fatura anterior (visto em 07/10/2026: a fatura
  fechada aparecia paga e sumia do "devo").
- **Categoria por regra**: natureza → regra do Rômulo por estabelecimento →
  tabela da categoria da Pluggy → palavras da descrição; nada vai ao modelo
  (RULES 24). A do usuário (`origem_categoria = usuario`) nunca é
  sobrescrita. A tela de mudar veio com a organização (abaixo).
- **Dependências opcionais**: `better-sqlite3` e `pdfjs-dist` são
  `optionalDependencies`, carregados por `import()` só quando as finanças
  abrem. O perfil `app` (Easypanel) nunca os carrega, e uma instalação que
  falhe neles derruba só as finanças (503), não a Central.
- **Riscos aceitos:** o leitor do PDF do Santander foi escrito pelo layout
  descrito (seções por cartão, Parcelamentos e Despesas com n/total, Resumo) e
  testado com texto sintético; a conferência é a trava contra layout que
  mudou. O pareamento de transferências pode casar dois Pix de mesmo valor a
  até 2 dias entre contas próprias que não eram o mesmo dinheiro.

#### Organização das finanças (07/10/2026)

O banco guarda só o que o Rômulo DECIDIU (migração 2: `categoria_criada`,
`categoria_renomeada`, `regra_categoria`, `orcamento`, `recorrente_marca`,
`alerta_enviado`); o resto é derivado a cada passe. Tela "Organizar"
(`/financas/organizar`) e o editor de cada lançamento em Lançamentos.

- **Categorias editáveis** (`organizacao.ts`, PURO): criar, renomear (para um
  nome que existe = juntar), remover (= juntar em "Outros"). O renome fica num
  mapa que o passe aplica depois da regra embutida, para "Mercado" renomeada
  continuar com o nome novo a cada sincronização. Fixas (as da natureza e
  "Outros") não se renomeiam nem se escolhem à mão.
- **"Aplicar sempre a este estabelecimento"**: a correção de um lançamento vira
  `regra_categoria` (estabelecimento = descrição normalizada), que vale para
  os novos e os antigos, menos os mudados à mão.
- **Orçamento mensal por categoria**, sempre em competência (a compra no mês
  da fatura), com barra e semáforo na Visão: verde < 70, amarelo ≥ 70, laranja
  ≥ 90, vermelho ≥ 100. A % arredonda para baixo.
- **Recorrentes**: mesmo estabelecimento a cada ~30 dias (±10; um mês pulado
  vale), 3 vezes em 120 dias, a última há até 45 dias, valor até o dobro. Marcar
  e desmarcar vencem a detecção; `null` volta para ela.
- **Alertas de 70/90/100%** (`alertas.ts`, PURO) do limite de cada cartão e do
  orçamento de cada categoria, pela fila de avisos (origem
  `squadone:financas`), depois de cada sincronização e de cada escrita. Só
  semáforo e % (categoria e nome do cartão podem; R$, valor e estabelecimento
  nunca; a chave leva o hash da categoria). Uma vez por faixa e período (mês da
  fatura aberta, mês do orçamento), só a faixa mais alta, guardado em
  `alerta_enviado` depois de entrar na fila; 70% é P2, 90/100% P1, nenhum P0.
  `POST /api/financas/alertas/simular` mostra o que sairia, sem gravar.
- **Sala Finanças no escritório**: um domínio comum aberto com o nome
  "Finanças" (ou id `…--financas`). O PO dela mostra num balão a % do cartão
  mais usado e do orçamento (`GET /api/financas/estado`, `src/office/salaFinancas.ts`).
  Nada disso entra no roster nem no prompt.
- **"gastei 30 no mercado" no Telegram** (`gasto-falado.ts`, PURO e
  determinístico): "gastei/paguei/gasto" + valor + onde. Vai à conta manual
  `manual:dinheiro` (sem saldo, fora do "tenho"), chave pela mensagem (reentrega
  não duplica), data da mensagem (sem a guarda de atraso). A resposta é
  "Anotado: <categoria>", sem valor; a frase nunca vira turno, e sem finanças no
  processo o bot só diz isso. Áudio que transcreve para um gasto é anotado sem
  ecoar a transcrição (o áudio em si já passou pelo Gemini para transcrever).
- **Extrato OFX/CSV de reserva** (`extrato.ts`, PURO), para quando uma conexão
  parar: prévia e confirmação, como o PDF. Chave pelo FITID (OFX), pelo
  identificador (CSV) ou pelo conteúdo + ordem. Contra a Pluggy, pareamento UM
  A UM (`parearEntreFontes`, mesma conta e valor, até 2 dias, descrição
  parecida ou candidato único); quando a conexão volta, a Pluggy vence e a linha
  do extrato sai (`dedupe.ts`, caso 3). Risco aceito: duas compras de mesmo
  valor a até 2 dias, uma em cada fonte e com descrições sem nada em comum,
  viram um par.

## Central de Operações

Esta seção descreve o código como está hoje. Com o app único (acima), a
Central vira a parte operacional do mesmo app: o nome continua nos módulos
(`src/operations/`, `server/operations.ts`), não na interface.

A mesma aplicação possui dois perfis selecionados no servidor por
`SQUADONE_MODE`:

- `app` preserva o comportamento remoto e não registra `/api/operations/*`;
- `operations` serve só a Central (em `/`; desde 30/09/2026 sem a cópia do app em `/squadone`, que redireciona ao app do Easypanel), registra
  as rotas locais e troca o bind do Express para `127.0.0.1`. Desde 06/10/2026
  as rotas do app (escritas no roster e no Google) não são montadas nesse
  perfil: do Google ficam só `/api/auth/google` e `/api/auth/callback` (a agenda
  da Central), além de `/api/financas/*` (desde 07/10/2026, ver "Finanças"),
  e o resto de `/api` responde 404 JSON. O `data/squad.json` do
  Dell é um retrato de 14/09/2026 e nada da Central o lê ou escreve.

`src/RootApp.vue` consulta somente `/api/runtime` para escolher a superfície.
A mesma rota diz `ocupado` (turno ou fila do bot do Telegram em andamento),
que o `atualizar-central` do Dell espera virar `false` antes de reiniciar.
Os componentes da Central ficam em `src/operations/`; eles não incorporam o
SquadOne em iframe. `/squadone` redireciona ao app do Easypanel até a mudança
da agenda para o Dell; depois, os agentes moram no mesmo app.

A Central tem duas rotas, sem dependência adicional de roteador:

- `/` diz o que precisa do Rômulo agora e o que fazer com cada alerta
  ("Precisa de você", do `status.json`), como a operação funciona (os fluxos
  de `src/operations/fluxos.ts`, um por vez, e "Um dia"), a agenda de hoje e
  os acessos (CRM, Agentes do SquadOne no Easypanel, Terminal, n8n, Hermes,
  Syncthing); o detalhe de cada verificação fica fechado no fim. Esta home
  vira "Hoje" (regra 13) na casca mobile: no máximo 3 cartões, próximos
  compromissos, time, funil e "resolve sozinho" fechado, sem link para o
  Easypanel;
- `/entrada/` abre a página da Entrada da Mel (texto e arquivos para o Hermes organizar; segredos
  vão para o cofre `age`). Não é da SPA: `server/entrada-proxy.ts` repassa três rotas fechadas ao
  serviço `deploy/dell/entrada/` em `127.0.0.1:9130`, com o mesmo porteiro de IP, e o item
  "Entrada" do menu fica logo abaixo de CRM. Pela tailnet é a mesma porta 8443 da Central: não há
  outro listener do Tailscale Serve. Detalhes e modelo de segurança em `deploy/dell/entrada/README.md`.
- `/crm` é o CRM do Site antes da venda e do PRUMO (desde 30/09/2026; o antigo
  `/projetos/producao-auto` redireciona para cá).

O estado do Dell vem de `SQUADONE_OPERATIONS_DATA_DIR/status.json`, gravado a
cada minuto por `deploy/dell/dell-status.py` e lido por `server/dell-status.ts`
dentro de `GET /api/operations/overview`. Desde 30/09/2026 cada verificação
pode trazer `o_que_fazer`, `acao` ({rotulo, url}: http(s) ou rota da Central)
e `sozinho` (resolve sem o Rômulo); os três são opcionais e o leitor aceita
retrato antigo sem eles. O mesmo monitor avisa o Rômulo pelo
Hermes quando algo quebra e quando volta. Retrato com mais de 5 minutos vira a
falha "Monitor do Dell". As rotas de projetos e leituras do Hermes seguem no
servidor, mas saíram da interface em 23/09/2026.

`server/operations.ts` contém a fronteira local:

- valida e persiste projetos em JSON com substituição atômica;
- aceita somente caminhos Linux absolutos ou URLs `http`/`https`;
- verifica uma lista fixa de serviços lida da configuração privada, com timeout
  curto e sem aceitar comandos ou URLs enviados pelo navegador;
- expõe somente launch URLs, estados e detalhes não sensíveis à interface.

### CRM (30/09/2026)

Até 29/09/2026 o estado de um lead morava em três lugares que discordavam: a
planilha, as pastas de `~/auto-site` e os marcos manuais da Produção Auto
(`auto-production.json`). Desde 30/09/2026 a fonte da verdade é a planilha
(aba Leads do Site antes da venda; aba Prospects do PRUMO), as pastas a
espelham (`site-pastas`) e a Central só lê:

- o fluxo `08 · CRM` do n8n lê Leads, Prospects e a aba CRM a cada 10 min (e
  por `POST /webhook/crm-atualizar`) e grava `~/.local/share/n8n-estado/crm.json`,
  as linhas como vieram, com o cabeçalho que a planilha tiver; falha de leitura
  grava `crm-falha.json` e deixa o retrato anterior valendo;
- `server/crm.ts` junta esse retrato com as pastas (`server/auto-production.ts`,
  que agora só lê pastas, artefatos da fila do gerador e `.logs/status.json`) e
  os Mapas de `~/prumo-entregas` e põe cada lead numa das 6 etapas (Novo,
  Contatado, Conversando, Proposta, Ganho, Perdido) com a subetapa do produto.
  As regras ficam em `etapaDoSite`/`etapaDoPrumo` e os nomes de coluna em
  `COLUNAS_DO_*`; coluna ausente vira vazio e aviso na tela;
- divergência entre planilha e pasta vira nota na ficha, nunca correção;
- nota, próximo passo e proposta: `POST /api/operations/crm/registro` →
  servidor da Central → `POST http://127.0.0.1:5679/webhook/crm-registro` com o
  header `X-CRM` → uma linha acrescentada na aba CRM. A Central não grava etapa
  nem registro próprio; `auto-production.json` deixou de ser lido.

`GET /api/operations/crm` não leva o instante da leitura: a resposta só muda
com o retrato, as pastas ou o dia, e o ETag do Express devolve 304 ao celular.

### Acesso pelo celular (30/09/2026)

O processo continua escutando só em `127.0.0.1:9120`. O Tailscale Serve do Dell
publica esse loopback em `https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/`,
só para a tailnet (não é Funnel), numa porta própria: `/` (Hermes) e
`/webhook` (n8n) na 443 não mudam. O Serve reescreve o `X-Forwarded-For` com o
IP do aparelho da tailnet, e o porteiro de IP (`server/acesso.ts`, que desde
então aceita faixas CIDR) admite loopback e as faixas da tailnet.

O porteiro sozinho admite **qualquer** nó da tailnet. Antes de o app (que
escreve no Google e guarda finanças) entrar neste processo, entram as outras
duas travas da regra 7: a ACL do Tailscale restrita aos aparelhos do Rômulo
para a 8443 do Dell, e a conferência do `Tailscale-User-Login` que o Serve põe
em cada requisição (e apaga quando vem do cliente). Requisição local direta,
sem `X-Forwarded-For` do Serve (o `atualizar-central` perguntando
`/api/runtime`, o túnel SSH do PC no callback do OAuth), não tem esse header e
continua aceita. Escrita exige `Origin`/`Sec-Fetch-Site` da mesma origem,
porque o header de identidade também acompanha um POST forjado por outra
página aberta no celular.

No código (07/10/2026, `server/acesso.ts`): uma lista só,
`SQUADONE_LOGINS_TAILSCALE` no `operations.env`. `guardaDeIdentidade` vale para
toda requisição quando a agenda está no processo (lista vazia então fecha a
tailnet) ou quando a lista existe; sem os dois, a Central de hoje segue aberta
à tailnet como antes, e só `/api/financas/*` fecha para quem chega pelo Serve.
"Chegou pelo Serve" = trouxe `X-Forwarded-For`, `Tailscale-User-Login` ou
`Tailscale-Funnel-Request`; Funnel nunca passa. `guardaDeOrigem` exige, em toda
escrita em `/api`, `Origin` com host e porta iguais aos do `Host` e, quando o
navegador manda, `Sec-Fetch-Site: same-origin`. A ACL do Tailscale continua um
passo manual no console.

O fluxo observado é Caçador do n8n → pacote em `auto-entrada` → `~/auto-site`
→ `gerador-de-sites` (Claude Code + Vercel) → `publicado.json` → watcher Linux
→ `hermes send` → WhatsApp; o Balcão do n8n lê os mesmos `publicado.json` em
`~/auto-site`. O Google Drive saiu do fluxo em 23/09/2026: a pasta `auto` do
Drive era só um espelho, pelo PC, e está parada desde 25/09/2026 (ver
`deploy/pc/README.md`). Não existe chamada direta entre n8n e o runner. A
Central não executa, reinicia nem reconfigura nenhum desses serviços; o CRM
relê o retrato a cada 2 min com a aba visível (a rota SSE da Produção Auto saiu
em 30/09/2026).

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

O Dell (a Mel) é o worker persistente e o servidor de projetos (Docker).
Claude e Codex controlam e corrigem o ambiente a partir da máquina de controle,
pelo SSH e pela Tailscale; o código vai pelo GitHub.

**Máquina de controle, desde 04/10/2026:** o PC novo (o Jarvis, Windows,
`paiduben` na tailnet). Ele entra na Mel por `ssh mel` (só chave), abre a
Central, a Entrada, o Hermes e os webhooks pela tailnet, e o editor do n8n e o
code-server por túnel SSH; o app Claude do PC também pode abrir sessões do
Claude Code que rodam na Mel. De 28/09 a 04/10/2026 o próprio Dell foi a máquina de
controle, porque o PC antigo queimou (NVMe; visto pela última vez em
25/09/2026); o que não tinha sincronizado com o Dell nem ido ao GitHub foi
perdido. Estado, túneis e checklist em `deploy/pc/README.md`.

**O PRUMO é dono de tudo (28/09/2026).** O Site antes da venda passa a ser a
frente "Vender mais" do PRUMO. A fonte da verdade do PRUMO é o repositório
privado `romulosutil/prumo` (`~/prumo` no Dell). No Drive, o negócio fica em
`PRUMO/`: `Sites antes da venda/` (espelho de `~/auto-site`) e `Consultoria/`
(espelho do repositório). São espelhos só de leitura, feitos pelo próprio Dell.
Um cofre cifrado com o que refaz o Dell (n8n e chave, Hermes, segredos) fica à
parte, em `Backups/dell-worker/`. Tudo sai de um manifesto único
(`deploy/dell/backup/fontes.toml`) e o `dell-status` avisa quando um deles
atrasa. A junção física da esteira dentro do PRUMO (pastas, fluxos) é um passo
seguinte.

O Hermes é o carteiro do WhatsApp: não opera nem decide, só entrega o que
chega pela fila de avisos (do `dell-status`, do n8n e, depois da mudança, do
SquadOne) e o que as rotinas próprias dele produzem. Para o SquadOne ele é só
transporte, não motor nem orquestrador, e trata como dado as mensagens que ele
mesmo enviou (regra 20). O n8n do Dell é o gerente de fluxos e todo fluxo
termina respondendo a alguém (Error Workflow único + avisos pela fila). O
SquadOne é o app: agenda, agentes, CRM e finanças. Antigravity organiza
documentação e arquivos.

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
os serviços. As credenciais do domínio dele (Google, Pluggy, bot do Telegram)
ficam em arquivos `600` do usuário do serviço, fora do Git, e o Rômulo as
digita no Dell, nunca pelo chat.

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

## Riscos aceitos

### Disco do Dell sem cifra (registrado em 06/10/2026)

O Dell é ext4 **sem LUKS**. Quem levar o notebook (roubo, assistência técnica,
descarte) e montar o disco em outra máquina lê tudo em claro: o `financas.db`,
o `google-auth.json` **e** a `TOKEN_ENC_KEY` que o decifra (os dois no mesmo
disco), a sessão do WhatsApp do Hermes (o número pessoal), o login do ChatGPT,
o token do bot do Telegram e os segredos do n8n e de `operations.env`. Com o
app único, o Dell passa a guardar finanças e a credencial de produção do
Google, então o risco cresce com a mudança.

O que **não** protege, e por isso não é feito como se protegesse:

- permissão `600`: segura outro usuário ou o container do n8n, não quem tem o
  disco;
- cifrar campo a campo, ou o arquivo inteiro, com a chave no mesmo disco: é só
  aparência, e ainda complica o backup e o diagnóstico (regra 24);
- o backup cifrado (cofre restic): protege a cópia fora do Dell, não o Dell.

O que protege de verdade é o disco cifrado (LUKS), que exige reinstalação ou
uma janela de manutenção e é decisão em aberto do Rômulo. Até lá, se o Dell
sumir, o que fazer é revogar tudo de fora, sem depender dele:

1. remover o nó da tailnet no console do Tailscale;
2. revogar o acesso do app em myaccount.google.com/permissions;
3. revogar os consentimentos no Meu Pluggy e trocar o Client Secret da Pluggy;
4. desconectar o aparelho vinculado no WhatsApp do celular;
5. `/revoke` do token do bot no @BotFather;
6. sair de todas as sessões do ChatGPT;
7. trocar os segredos guardados no cofre que vivam no Dell.

### Confiança no loopback

O header de identidade do Tailscale (regra 7) vale porque o processo escuta só
em `127.0.0.1` e só o Serve chega de fora. Qualquer processo que já roda no
Dell consegue falar com o loopback e forjar o header. Aceito: quem roda no Dell
já lê as credenciais direto do disco, e uma trava contra ele aqui seria
aparência, pelo mesmo motivo do disco acima.
