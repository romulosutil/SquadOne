# SquadOne

Escritório isométrico onde squads de agentes de IA (Pessoal, Pay4Fun...) recebem demandas em linguagem natural e as transforma em eventos no Google Calendar. Uso pessoal, um usuário só.

## Comandos

```bash
npm run dev      # tsx server.ts — Express + Vite em middleware mode, porta 3000
npm run build    # vite build + esbuild do server para dist/server.cjs
npm start        # node dist/server.cjs — o que roda em produção
npx vue-tsc --noEmit   # typecheck (o script `lint` chama isto)
npm test         # tsx --test server/*.test.ts server/financas/*.test.ts src/*.test.ts src/office/*.test.ts src/casca/*.test.ts (node:test, sem framework extra)
```

Os testes são pontuais: só as regras puras que dá para fixar em tabela de casos, em
`node:test`, sem montar o Vue e sem tocar o Google (`fetch` é dublê; o que grava usa
diretório temporário, nunca `data/`). Inventário arquivo a arquivo em
`docs/referencia/testes.md`. O monitor do Dell tem os seus em Python
(`python3 deploy/dell/dell-status.test.py`). A verificação continua sendo typecheck +
build + exercitar a rota.

### Grafo do código (Graphify)

- **Quem gera:** o Dell, todo dia às 03:00 (`graphify-projetos.timer` do systemd desde
  11/10/2026; era o job "Graphify — projetos" do Hermes, hoje pausado): só AST, **não gasta
  token**. Nunca construir, indexar ou rodar `graphify update` no PC.
  `dev/_grafos/` no PC é um retrato de 04/10/2026: não é fonte, não confie nele.
- **Como perguntar** (roda no Dell por SSH, sem copiar grafo; `global` no lugar do projeto
  cruza todos): `scripts/grafo.sh explain SquadOne "orchestrator.ts"` lista quem importa o
  arquivo e o que ele importa, ou seja, o raio de impacto de uma mudança (barato, preciso);
  `scripts/grafo.sh path SquadOne "telegram-bot.ts" "calendar.ts"` dá o caminho mais curto
  entre dois módulos (duas linhas); `scripts/grafo.sh query SquadOne "pergunta" [orçamento]`
  é busca livre: trunca (centenas de nós) e mistura testes, deixe por último.
- **Quando vale:** impacto de mudança, "quem chama X", "como A chega em B" fora do mapa
  abaixo, projetos grandes sem mapa (`auto-site`, `Iris`, `Aladdin`) e perguntas entre
  projetos. **Quando não vale:** para achar onde algo mora no SquadOne, o mapa de
  "Arquitetura" e o Grep resolvem mais barato. O grafo é de AST: não vê rota montada em
  runtime nem regra que só está em texto.

## Arquitetura

Um processo Express serve a API e a SPA Vue. Sem banco.

```
server.ts                 Express: monta o webhook do Telegram antes do porteiro, o porteiro, as rotas e o Vite/estáticos
  server/acesso.ts        porteiro de IP (403 antes de qualquer rota); no Dell, identidade do Serve e escrita da mesma origem
  server/dados.ts         SQUADONE_DATA_DIR e a trava que só liga a agenda no Dell com ele fora do clone
  server/auth-store.ts    credencial do Google: code flow, refresh, cifra em disco
  server/squad.ts         roster v3 em árvore, migração, regras de id; única fonte de verdade das squads
  server/roster-historico.ts  cópia datada do squad.json anterior a cada gravação, poda 30/90 dias (PURO: nome e poda; I/O: cópia)
  server/hire.ts          contratação (card ou UI), nova squad, substituição de PO
  server/ciclo-de-vida.ts editar, arquivar e reativar pessoa/domínio/squad
  server/redacao.ts       Gemini redige papel + escopo (não grava)
  server/orchestrator.ts  um turno: demanda -> 1 chamada ao Gemini -> capacidades
  server/turno.ts         demanda já validada -> um turno; ponto único usado por /api/orquestrar e pelo bot do Telegram
  server/capabilities.ts  as capacidades que o modelo pode invocar (agendar_evento, criar_tarefa, crescimento, troca de squad)
  server/alocador.ts      PURO: ocupação + janela + pedido + agora -> slots
  server/agenda.ts        ocupação do turno: 1 leitura do primary + reservas
  server/agendamento.ts   compromisso -> eventos (foco, ou marco + blocos)
  server/quest.ts         recusa classificada e validação comum das rotas de quest
  server/plano-de-ajuste.ts  PURO: duração/esforço aprovados sobre o alocador
  server/ajuste.ts        aplica o ajuste aprovado no Google
  server/calendar.ts      leitura/escrita no Google Calendar (listar, GET/PATCH/POST de um evento)
  server/avisos.ts        Aviso no schema da fila de avisos do Dell, gravação atômica, P0 também no Telegram, cartões, sem R$
  server/lembretes.ts     PURO: quais eventos avisar, quando e com que texto (um Aviso)
  server/vigia.ts         laço de 60 s: relê a agenda e publica os lembretes devidos
  server/sinal-de-vida.ts ping ao healthchecks.io (DEADMAN_URL); /fail com o WhatsApp fora há > 15 min
  server/time.ts          time vivo da Hoje: agruparTimePorSquad (PURO) + leitor de /api/time (1 leitura por calendário, cache 60 s)
  server/passos.ts        PURO: normaliza os passos, título da lista, notas e due da tarefa-mãe, escopo concedido
  server/tasks.ts         transporte do Google Tasks: lista, tarefa, ErroTasks classificado, timeout 10 s
  server/passos-no-google.ts  lista por squad (single-flight) + tarefa-mãe + subtarefas + vínculo no evento
  server/telegram.ts      transporte da Bot API: lê a config do ambiente, segredo do webhook em tempo constante, sendMessage/sendChatAction/setWebhook
  server/telegram-entrada.ts  PURO: update do Telegram -> comando/demanda/ignorar, dedupe de update_id em memória
  server/telegram-resposta.ts PURO: TurnoResult -> texto do chat (sem parse_mode), reusa linhasDosEventosCriados
  server/telegram-bot.ts  cola: portão (segredo) + receber/processar (allowlist via telegram-entrada, 200 imediato, fila serial, áudio, botões de contratação)
  server/telegram-polling.ts  entrada por getUpdates (Dell): offset persistido ao enfileirar, nunca setWebhook
  server/transcricao.ts   áudio do Telegram -> texto da demanda (uma chamada ao Gemini)
  server/avaliacoes-turno.ts  nota do usuário sobre um turno recém-entregue (desligada por padrão)
  server/luna-sombra.ts   Luna em sombra (desligada): prompt, leitura da saída e comparação PUROS; cola com fila, teto/dia, codex exec sem shell, JSONL 600
  server/openrouter-decisoes.ts  transporte do Jev (OpenRouter /alpha/decisions): pedido, máscara, validação e erro PUROS; deny + ZDR, sem retry, chave nunca em log
  server/jev-sombra.ts    Jev em sombra (desligado, RULES 27): 4 perguntas por demanda e comparação com o Gemini PURAS; fila, teto/dia e de US$, JSONL 600; finanças nunca vão
  server/operations.ts    perfil `operations` (só Dell): SQUADONE_MODE, bind loopback, rotas /api/operations/*
  server/auto-production.ts   Central: leitura das pastas de ~/auto-site para o CRM (somente leitura)
  server/crm.ts           Central: CRM (/crm) a partir do retrato das planilhas que o n8n grava; registro pelo webhook do n8n
  server/site-mensagem.ts PURO: espelho do site-mensagem.js do n8n (follow-up e segunda mensagem, EN nos EUA) para os links do CRM
  server/dell-status.ts   Central: lê o status.json gravado pelo monitor deploy/dell/dell-status.py (o_que_fazer, acao, sozinho)
  server/financas/        Central: finanças (Meu Pluggy + fatura em PDF do Santander), banco financas.db; ver ARCHITECTURE "Finanças"
    tipos, comum, natureza, categoria, transferencias, dedupe, parcelas, visoes, processar, resumo, pluggy-mapa, fatura-santander: PUROS
    organizacao (categorias, semáforo, orçamento, recorrentes), alertas (70/90/100%), gasto-falado, extrato (OFX/CSV): PUROS
    explicacao (PURO): o texto exato do "Explicar este mês", o hash da prévia e o prompt fixo; só sai a pedido (SQUADONE_FINANCAS_IA)
    pluggy.ts (transporte), banco.ts (better-sqlite3, 600, migrações), sync.ts (polling), pdf-texto.ts (pdfjs), rotas.ts (/api/financas)
    servico.ts (cola: resumo com a organização, depois de cada escrita, avisador, gasto anotado)
src/main.ts -> src/RootApp.vue  pergunta /api/runtime (perfil e `agenda`) e monta a casca com { perfil, agentes }
src/App.vue               a casca (07/10/2026): rota atual, barra inferior/lateral, Ctrl+K, folhas do roster, aviso
  src/casca/              destinos.ts (PURO: rota por perfil, barra, Ctrl+K), hoje.ts (PURO: ordem da Hoje,
                          semáforo das finanças, estado do time só com fonte, linha do funil), rota.ts (pushState sem roteador),
                          overview.ts (retrato do Dell), ditado.ts (microfone do Pedir), pilhaDeFolhas.ts;
                          BarraInferior, BarraLateral, CascaTopo, PedirFolha, Paleta, DellAlerta, FinancasAlerta
  src/rotas/              HojeRota (/), AgendaRota (/agenda), EscritorioRota (/squadone), MaisRota (/mais)
  src/agentes/estado.ts   estado e ações dos agentes (era o <script> do App.vue): roster, squad ativa, Mochila,
                          turno, cartões, folhas; um por aba (`useAgentes`), com as guardas de isLoading e abertura
  src/agentes/ListaDeQuests.vue  compromissos da Mochila: "próximos 3" na Hoje e a Agenda por dia
  src/operations/         Central de Operações (só perfil operations), montada como rotas da casca
    ComoFuncionaPanel.vue os fluxos da operação, um por vez, e "Um dia"; conteúdo em fluxos.ts (estático, versionado)
    alertas.ts            PURO: separa falha / fila / vale olhar / resolve sozinho; links só do Dell; contagem das filas
    AccessPanel.vue, DellConferePanel.vue (tudo que o Dell confere, fechado): em Mais; agenda-window.ts: a agenda do dia na Hoje sem os agentes
    Crm*.vue, crm-formato.ts  CRM: Hoje, Funil (no celular: Site/Organizar, abas de etapa, lista), Resultados e Ficha (folha cheia)
    fila-de-envio.ts      PURO: "Enviar um por um" (CrmFilaDeEnvio.vue): a mensagem antes do toque, nicho, pular; o toque
                          lembrado no localStorage por 30 min só para a lista não repetir o envio (a planilha é a verdade)
    resultados.ts         PURO: Resultados (?ver=resultados): enviados no período por nicho, mensagem, versão do site e horário;
                          avisoDeHorario: a fila avisa fora do expediente, com a taxa medida dentro e fora
    ab-video.ts           PURO: A/B do vídeo no envio (coluna braco_video, sorteio pelo place_id, Fisher, veredito);
                          só mede, nada ligado sem a coluna; ver docs/referencia/perfis-e-experimentos.md
    colinha.ts            PURO: colinha de atendimento do PRUMO (cardápio, roteiro, objeções, CDL; texto do plano de 08/10/2026,
                          cardápio na hierarquia de 09/10/2026: ver → arrumar → manter, Raio-X e Mapa grátis, Fonte só depois do Mapa);
                          colinhaDoLead escolhe pela etapa e pela resposta. Bloco "Colinha" na Ficha e /crm?ver=colinha
                          (CrmColinha, CrmTrecho, CrmMomento, CrmObjecao). Esteira importada de server/site-mensagem.ts; R$ só do cardápio;
                          Respondido, Fonte e Fonte em dia "sob proposta" para o cliente (o valor fica como base interna);
                          sem cliente fundador nem desconto em troca de depoimento (08/10/2026)
    financas/             Finanças: Visão (tenho, devo, gastei, orçamento, todo mês), Lançamentos (editor de categoria) e Organizar; saúde e "dados até" em toda tela
  src/estilos/            tokens.css (paleta + modo escuro), casca.css (layout), agentes.css (cartões, botões, campos), design.md
  src/auth/google.ts      invólucro fino sobre /api/auth/*
  src/squadAtiva.ts       squad ativa da aba (localStorage)
  src/mochila.ts          sem Vue: "Bloco i/N" e intervalo de dia inteiro, derivados da lista
  src/rosterApi.ts        escritas do roster com erro classificado
  src/contribuicao.ts     sem Vue: formata minutos, resume o turno e o ajuste, monta o ajuste do usuário
  src/components/         Sheet (folha acessível), GameMap (import dinâmico), GrowthCard, AjusteCard,
                          TrocaSquadCard, SquadSelector, SalasPainel, SalaCartao,
                          ContratarFolha, EditarFolha, NovaSquadFolha, ArquivoFolha
  src/office/             geometria isométrica, salas, sprites
  src/office/vista.ts     PURO: Lista|Mapa (localStorage com try/catch) e a escala inteira do mapa
  src/office/salas.ts     diferença de salas (abrir/fechar/trocar dono), pura
  src/office/postos.ts    PURO: posto de cada pessoa na sala (cadeiras, depois espalhado); tiles livres
  src/office/trabalhadores.ts  catálogo versionado: trabalhador automático (n8n, timer) → sala; FORA do prompt (RULES 26)
  src/office/salaFinancas.ts  PURO: Sala Finanças (domínio "Finanças") e o balão do PO com % do cartão e do orçamento
  src/office/pixelProps.ts  SVG pixel art dos móveis (mesa, cadeira, planta, estante...)
  src/office/useOffice.ts loop rAF, câmera, atores; passeio ambiente vs. movimento por comando
seed/squad.seed.json      roster inicial — FORA de data/, ver "Volume" abaixo
data/                     volume em produção; nada aqui é versionado
```

### Quatro invariantes que o código assume

**1. O roster é uma árvore de três níveis.** `roster → squad → domínio → { po, integrantes }`. Uma squad = um escritório 3x3; uma sala = um domínio. Contratar um integrante entra na sala existente; criar um domínio ocupa o primeiro slot livre de `unlockOrder` (derivado dos slots ocupados, não de `dominios.length`). Máximo 9 domínios por squad. Squad nasce com 1 domínio + PO (o `GameMap` precisa de `dominios[0].po`). Ids de domínio e de pessoa são únicos entre **todas** as squads e `idsAposentados`; domínio novo é `<squad>--<slug>`, os legados (`po`, `geral`) ficam como estão.

**2. O roster é o prompt.** A árvore **da squad ativa** vai literal para o `systemInstruction` em `orchestrator.ts`; as outras squads entram só por id, nome e escopo, para o modelo poder chamar `sugerir_troca_squad` sem conseguir agendar nelas (o servidor então troca e reprocessa sozinho — ver "Redirecionamento automático de squad"). A squad ativa é escolha da aba (`localStorage`), mandada como `squadId` em `/api/orquestrar` e `/api/mochila`; a rota resolve a squad antes de pedir token e antes do Gemini. Não existe "treinamento do agente" guardado em outro lugar: `papel` + `escopo` de cada `Pessoa` *são* o treino. Persistir o roster já persiste os agentes. O escopo de pessoa (até 1500 caracteres, cinco linhas: Missão, Cuida de, Não cuida de, Ao opinar sobre um compromisso, Sinais de alerta) é o treino; entra em bloco recuado na árvore.

**3. As quests vivem no Google Calendar, não aqui.** `GET /api/mochila` lê do Google a cada chamada. Editar ou apagar no Google reflete na próxima leitura. `quests` no frontend é cache da última resposta, nunca fonte de verdade. A leitura vai 7 dias para trás, mas o card some quando a quest **termina** (`questTerminou` em `src/mochila.ts`, relógio de 30 s): filtro só da vista, a lista cheia segue alimentando "Bloco i/N".

**4. Arquivar não apaga.** Pessoa, domínio e squad arquivados ficam na árvore com `arquivado: true` e somem do prompt, do mapa e da vista (`paraVista` só põe ativos em `dominios`/`squads`; o resto vai em `arquivo`/`squadsArquivadas`). Arquivar grava o id em `idsAposentados` (só acréscimo, e reativar não tira). O PO não se arquiva: substitui-se, e o anterior vira integrante arquivado. `dominios[0]` e a última squad ativa nunca se arquivam. Helpers de turno, Mochila, prompt e slots veem só ativos; os de unicidade de id veem tudo. `agendar_evento` tira a cor do índice no array **cru**, para a cor de um domínio não mudar quando outro é arquivado. Nada no ciclo de vida chama o Google (a rota de renomear squad chama o Tasks depois, fora dele — ver "Passos no Google Tasks").

## Detalhes por assunto

O texto completo de cada assunto está em `docs/referencia/`. **Leia o arquivo antes de
mexer nos módulos da coluna do meio**; abaixo ficam só as regras que não podem se perder.

| Assunto | Módulos | Arquivo |
|---|---|---|
| Marcas, modos, agendamento, Tasks, ajuste | `orchestrator`, `capabilities`, `alocador`, `agenda`, `agendamento`, `calendar`, `ajuste`, `passos*`, `tasks`, `turno` | `agenda-e-turno.md` |
| Agenda no Dell, avisos, lembretes | `acesso`, `dados`, `avisos`, `lembretes`, `vigia`, `sinal-de-vida` | `agenda-no-dell.md` |
| Bot do Telegram | `telegram*`, `transcricao`, `financas/gasto-falado` | `telegram.md` |
| Roster, contratação, Escritório | `squad`, `hire`, `ciclo-de-vida`, `roster-historico`, `src/office/*` | `roster-e-escritorio.md` |
| Perfis, avaliação de turno, Luna, Jev | `operations`, `RootApp`, `casca/*`, `avaliacoes-turno`, `luna-sombra`, `jev-sombra`, `openrouter-decisoes` | `perfis-e-experimentos.md` |
| Persistência, Google, porteiro, env | `auth-store`, `dados`, `acesso`, `.env` | `persistencia-e-acesso.md` |
| Inventário de testes | todos os `*.test.ts` | `testes.md` |

**Agenda e turno.** O modelo decide a intenção (tipo, duração ou esforço, prazo); o servidor
escolhe o horário. `alocador.ts` é PURO (sem `fetch`, relógio, env ou import): mantenha.
`foco` e `baixa_prioridade` gravam `time_blocking`; a baixa prioridade busca até o 7º dia útil
e entra por último na série. Todo evento criado leva as marcas `squadone_*`
(`marcasDoEvento`) e todo PATCH passa por `atualizarPreservandoMarcas` (`If-Match`,
`sendUpdates=none`, `extendedProperties.private` completo). Janela ilegível
(`JANELA_TRABALHO`, `DIAS_TRABALHO`) é 500 `configuracao`, nunca o padrão calado. Os
`agendar_evento` de um turno rodam em série. Falha do Tasks nunca desfaz um compromisso
(vira aviso); em `criar_tarefa` a falha é erro. Redirecionamento de squad: um salto por
turno, 2ª chamada ao Gemini só nesse caso. O ajuste só roda com aprovação e relê tudo do
Google. Gemini: 45 s por tentativa, pior caso de uma geração ≈ 3 min.

**Agenda no Dell.** A agenda só liga no `operations` com `SQUADONE_DATA_DIR` fora do
checkout; no Dell nunca semeia o roster (`RosterAusente`). `SQUADONE_ROSTER_CONGELADO=true`
recusa escrita (409). Acesso: identidade do Tailscale Serve em todo pedido e escrita só da
mesma origem (curl local de escrita precisa de `-H 'Origin: http://127.0.0.1:9120'`). OAuth do
Google só pelo loopback. Avisos: schema da fila do Dell, gravação atômica, nenhum "R$" passa,
P0 também vai ao Telegram. Lembretes: a vigia relê a agenda a cada 60 s e nada é agendado
para o futuro; só o `operations` roda vigia (dois processos duplicariam cada aviso).
`POST /api/avisos/varrer` simula sem gravar.

**Telegram.** Webhook (Easypanel) ou polling (Dell, obrigatório no `operations`; nunca chama
`setWebhook`). A rota do webhook é a única fora do porteiro de IP; segredo no header, em tempo
constante, antes de ler o corpo. Allowlist de `chat_id` **fecha quando vazia**; chat fora da
lista recebe 200 sem resposta; só chat privado. Responde 200 na hora e roda o turno numa fila
serial; `update_id` deduplicado; demanda com mais de 10 min de atraso não roda. Resposta em
texto puro. Contratação por botão (uso único, só em memória). Áudio custa uma geração a mais.
"gastei 30 no mercado" é gasto, não demanda, e a resposta não repete o valor.

**Roster e Escritório.** Toda mutação do roster passa por `atualizarRoster()` (fila única);
`writeRoster` grava `.tmp` e renomeia, e copia o anterior para `historico/`. O formato do
arquivo não muda (o Easypanel, reserva fria, o lê). Contratação aplica na squad da proposta.
O Escritório é só frontend e não grava nada; estado de pessoa só com fonte, nunca inventado.

**Perfis.** `SQUADONE_MODE`: `app` (Easypanel) ou `operations` (Dell, só loopback); valor
desconhecido derruba o boot. A Central é somente leitura para serviços. A Hoje mostra no
máximo 3 cartões (RULES 13). Avaliação de turno e Luna em sombra estão **desligadas** por
padrão; a Luna é medição, nunca motor, e nunca vai ao Easypanel. O Jev em sombra
(RULES 27) também: desligado, só mede, nunca no Easypanel, finanças nunca vão a ele.
Na config da Central, `tools.syncthing` é opcional (aposentado em 12/10/2026): ausente, some do painel.

**Persistência e acesso.** Persistência só em `squad.json` e `google-auth.json` (mais o que o
Dell acrescenta); a seed fica fora de `data/`. O browser nunca vê token do Google; `prompt=consent`
é obrigatório; ampliar escopo é refazer `/api/auth/google`, **nunca logout**; só `invalid_grant`
apaga a credencial. Rollback da Fase 1: implantar o commit anterior **e depois** restaurar
`squad.v2.bak.json`. `IPS_PERMITIDOS` vazia desliga o porteiro. Tabela de variáveis de ambiente
no arquivo.

## Deploy

Easypanel, projeto `aladdin`, app `squadone-app`, em `https://aladdin-squadone-app.jicnzg.easypanel.host`. Nixpacks a partir do GitHub (`romulosutil/SquadOne`, branch `main`). **Implantação automática ligada** (24/09/2026): todo push/merge em `main` dispara o build no Easypanel — não existe mais "clicar Implantar" como passo. Dois merges seguidos disparam dois builds e o segundo pode cancelar o primeiro ("context canceled" no log): confira em Implantações se o último ficou verde, e se não ficou clique **Implantar** uma vez. Onde este arquivo ainda diz "clicar **Implantar**", leia "fazer push em `main`". **Apagar** uma variável do Ambiente só vale depois de um build novo: **Implantar** sem commit novo só reinicia a imagem, e o `.env` que o build gravou nela traz a variável de volta pelo `dotenv` (visto em 07/10/2026; ver `deploy/dell/CUTOVER-AGENDA.md`, passo 1).

## Convenções

- Comentários e identificadores em **português**. Comentário explica *por quê*, não *o quê* — a maioria dos blocos aqui documenta a decisão e o que aconteceria sem ela.
- Erros carregam classificação, não só mensagem: `ErroDeDominio.credencial`, `PedidoInvalido` (400) vs `ConflitoDeRoster` (409), `SquadInexistente` (409 + `squadInexistente: true`: a UI recarrega e cai na primeira squad), `SquadArquivada` (filha dela, mesmo 409 + flag), `RedacaoInvalida` (502 + `redacaoFalhou`), `ModeloOcupado` (503 + `modeloOcupado`), `RosterIlegivel` (500), `PrecisaConectar` vs `ErroDeConfig`, `JanelaMalConfigurada` (500 + `configuracao`), `ErroTarefa.motivo` (`precisaConectar`, `configuracao`, `semHorarioLivre`, `agendaIndisponivel`), `ErroTasks` (`ehCredencial` só 401, `escopoInsuficiente`, `apiDesligada`), `ListaSumiu`, `TasksSemResposta`, `EscopoNegado` (callback → `?auth=escopo_calendar_negado`), `AvisoTarefa.motivo: "ampliarAcesso"` (`server/orchestrator.ts`; carregado internamente em `AvisoDoCompromisso`, passos sem o escopo do Tasks: toast com "Autorizar Google Tasks", nunca logout), `TelegramMalConfigurado` (env do bot presente e ilegível: log de erro no boot, bot desligado, resto do app igual), `ErroDeTelegram` (`status` da Bot API, `null` quando nem houve resposta; só `console.error`, nunca derruba o turno nem a rota), `RosterAusente` (503 + `rosterAusente`: Dell sem o roster de produção), `RosterCongelado` (409 + `rosterCongelado`), `AvisoInvalido` (fora do schema da fila ou com R$: o aviso não é gravado), `SinalMalConfigurado` (`DEADMAN_URL` ilegível: log, sem sinal). A UI decide o que fazer pelo tipo.
- Falha de uma parte não derruba o resto: um domínio com erro no Calendar não zera a Mochila inteira; um turno sem credencial ainda roda as capacidades que não tocam o Google; um compromisso que falha não impede os seguintes da série; a checklist do Tasks que falha não desfaz o compromisso.
- Ao terminar tarefa: `git commit` + `git push`. O grafo é do Hermes no Dell (job "Graphify — projetos", às 03:00, sobre os clones vivos e os espelhos de todos os repositórios do GitHub; o PC consulta por SSH com `scripts/grafo.sh`); no Dell, `graphify update .` depois de mudar código; nunca no Windows. Depois do push, a Central do Dell se atualiza sozinha em até 10 min (`atualizar-central.timer`).

### Remote Infrastructure Directives
- **O PC novo (Jarvis, Windows, `paiduben` na tailnet) é a máquina de controle desde 04/10/2026**; o Dell é a Mel (`romulo-sutil-corr-a-latitude-7420`, sempre ligado). De 28/09 a 04/10 o próprio Dell controlou, porque o PC antigo queimou (NVMe): o que não tinha sincronizado foi perdido, não procure nem reconstrua. Estado, túneis e checklist: `deploy/pc/README.md`.
- **No PC:** o apelido SSH é `mel` (`ssh mel`, só chave); o antigo `dell-worker` não existe no PC novo. Editor do n8n e code-server só pelo túnel (`deploy/pc/instalar-tuneis.ps1`). Git em clones do GitHub em `C:\Users\sutil\dev`, fora de pasta sincronizada.
- **Numa sessão que roda no Dell** (local ou sessão SSH do app Claude do PC): `docker` direto; `~/SquadOne` é o checkout de produção da Central (não edite nem troque de branch: worktree em `~/.cache/mel-work/` e PR); nunca Git na réplica congelada `~/Pessoal-dev`. Instalar, systemd, Docker, n8n e rclone só numa sessão no Dell. Arquivo do repo que roda no Dell a partir de uma cópia (`~/.local/bin`, `claude-ops`, units...) entra em `deploy/dell/instalados.json` no mesmo PR; depois do merge, reinstale a cópia (`dell-status --instalados` diz o que está atrás).
- Local Windows Docker service is disabled by design. All containers run exclusively on the Dell.
- Never search Windows paths for container binaries or Nginx executables.
- From the PC, run container commands via `ssh mel "docker ..."` or `DOCKER_HOST="ssh://mel"`.
- Container mounts map to `~/workspace/` on the Dell. Nothing is mirrored from the PC anymore (Syncthing has no paired device since 04/10/2026 and was retired on 12/10/2026; `~/Pessoal-dev` is a frozen replica): code reaches the Dell through GitHub.
