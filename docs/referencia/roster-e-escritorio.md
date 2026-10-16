# Roster, contratação e Escritório

> Movido do `CLAUDE.md` em 11/10/2026 para a sessão não carregar isto toda vez.
> O texto é o original, sem alteração; o `CLAUDE.md` guarda só o resumo das regras.

## Escrita no roster

Toda mutação passa por `atualizarRoster()`, que serializa read-modify-write numa fila. Um arquivo para todas as squads, então uma fila só: duas aprovações quase simultâneas, mesmo em squads diferentes, leriam o mesmo `squad.json` e a segunda apagaria a primeira. `writeRoster` grava num `.tmp` e renomeia por cima — crash no meio deixa o `.tmp` pela metade, nunca o `squad.json`. Contratação aplica na squad da proposta (`sugestao.squad_id`), não na que a tela mostra. Antes do rename, `writeRoster` copia o `squad.json` atual para `historico/` e, depois dele, poda (ver "Persistência"); o formato do arquivo não muda, porque o Easypanel (reserva fria) o lê — foi por isso que o SQLite com Litestream foi descartado.

## Contratação e ciclo de vida

Contratar: botão por sala e **+ Abrir sala** (na Lista do Escritório, `SalasPainel`, ou na folha que abre ao tocar num personagem do Mapa), ou card do modelo (Aprovar/Ajustar). O prompt manda o modelo sempre chamar a capacidade de crescimento quando o pedido é explícito. Redigir (`POST /api/squad/redigir`) é uma chamada de function calling restrita (`ANY` + um nome), via `gerarComRetry`, e não grava nada: `responseMimeType` é instável na troca de modelo do retry. Falha dela nunca impede contratar à mão.

| Rota | Efeito |
|---|---|
| `PATCH /api/squad/{pessoas,dominios,squads}/:id` | edita texto (400 acima do limite, sem cortar); ids nunca mudam |
| `POST /api/squad/{pessoas,dominios,squads}/:id/arquivar` | arquiva (idempotente) |
| `POST /api/squad/{pessoas,dominios,squads}/:id/reativar` | reativa; domínio volta ao slot antigo se livre, senão ao primeiro livre, senão 409 |
| `POST /api/squad/dominios/:id/po` | substitui o PO (`integranteId` ou pessoa nova) |
| `POST /api/squad/hire` | card do modelo corta texto (escopo 1500); `escopo_po` separa o treino do PO do escopo do domínio |

Ids de pessoa e domínio são globais, então as rotas não levam `squadId`. Id inexistente é 409, não 404: é aba com roster velho. Mochila: domínio arquivado some (um `events.list` só por domínio ativo); quest de integrante arquivado continua, com "(arquivado)". Squad arquivada em `/api/orquestrar`, `/api/mochila`, hire ou redigir é `SquadArquivada`, mesmo 409 + `squadInexistente` de squad sumida.

## Escritório: gente demais e gente andando

Só frontend; nada disto grava.

- **Legível sem clicar é a SALA, não a pessoa.** Placa "NOME · N". O rótulo "nome · papel" do ator fica oculto e só aparece em hover, com `.actor--focus` (andando por comando, câmera junto) ou `[data-ativo]` (responsável da demanda). No `.actor` nada de `:class`: `useOffice` escreve `actor--walk`/`actor--focus` por `classList` e o patch de classe do Vue apagaria.
- **Postos (`postos.ts`):** cadeiras do template primeiro, excedente espalhado maximizando distância de tela, nunca em porta nem no tile logo dentro dela. O posto depende só da sala e do índice: contratar não reassenta quem já estava. O teste fixa ≥ 40 px até 8 pessoas em todo template — encher um template de móveis quebra o teste de propósito.
- **Passeio vs. comando:** ator parado passeia (6–16 s, 80% na própria sala, 20% na vizinha pela porta, no máximo 1/3 fora ao mesmo tempo). `moveTo`/entrada de contratado cancelam o passeio; visita do PO raiz segura o ator lá até o próximo comando. A câmera só segue quem anda por comando. `prefers-reduced-motion` desliga o passeio, os ciclos idle em CSS e a suavização da câmera (o ator comandado ainda anda: é ele que diz quem atende).
- **Lista | Mapa (07/10/2026):** o Escritório (`/squadone`) abre em Lista no celular e em Mapa a partir de 1024 px; a escolha fica no `localStorage` (`squadone:escritorio:vista`, try/catch em `office/vista.ts`). A Lista (`SalasPainel` → `SalaCartao`) é texto e tem todos os gestos; o Mapa só carrega quando aberto (`defineAsyncComponent`, pedaço próprio do bundle). Um andar (squad) por vez, `:key` pela squad.
- **Escala inteira, sem Tab:** o GameMap escolhe a maior escala inteira em que o andar cabe (`escalaInteira`, até 3×) e oferece Afastar/Aproximar/Encaixar. A tecla Tab, que alternava 1×/2× e prendia quem navega por teclado, não faz mais nada no mapa.
- **Toque:** cada personagem tem um `<button>` de 44×44 px de TELA (`calc(44px / var(--escala))`) com o estado no nome acessível; tocar abre a sala numa folha, com os gestos da Lista.
- **Estado com texto e só com fonte** (`estadoDaPessoa`, `estadoDaSquad` em `casca/hoje.ts`): bloco em curso ou próximo compromisso (da agenda lida desta squad), responsável pelo último pedido desta aba, ou `Sem sinal` por extenso. Nada de "ocioso"/"trabalhando" inventado.
- **Time vivo (07/10/2026):** `GET /api/time` (em `rotasDoApp`) dá agenda a TODAS as squads ativas na Hoje, não só à da Mochila. `server/time.ts`: lê o roster, pede o token, faz **um** `listarQuestsDaJanela` por `calendarId` distinto (`alvosDoRoster`, os mesmos da vigia) em `[agora − 1 dia, agora + 7 dias]` e `agruparTimePorSquad` (PURO) devolve por squad `{ id, emBlocoAgora: {pessoaId, titulo}[], proxima }`. A squad vem do **domínio** ativo (evento sem marca, de domínio ou squad arquivados fica fora; dedupe por `eventId`, porque duas squads no mesmo calendário leem o mesmo evento). Resposta `{ squads, lidoEm, erros }`: squad cujo calendário falhou sai de `squads` e vai a `erros` com o motivo (agenda não lida não é agenda vazia); todo calendário recusando o token, ou sem credencial = 401 `precisaConectar`. Cache de 60 s em memória e single-flight, nada em disco (o Google é a verdade). Na Hoje, `estadoDaSquad` recebe o `time` lido: `atendendo` (turno nesta aba) > `com_agenda`/`livre` (a Mochila da ativa, que vai 90 dias à frente e manda no "próximo", ou o `/api/time`) > `sem_sinal` (com o motivo da falha). A linha mostra "Em bloco agora: <pessoa> — <título>" e "lido do Google às HH:MM". Lido no mount e a cada 5 min com a aba visível; a Mochila das outras squads nunca é lida no front.
- **rAF pausado** com a aba em segundo plano (`visibilitychange`) ou o mapa fora da tela (`IntersectionObserver`): nem loop, nem passeio, nem ciclo idle (`animation-play-state`); ao voltar, a câmera encaixa.
- **A operação da sala (15/10/2026, antes "Automáticos da sala"):** sob cada sala do PRUMO, na Lista e na folha que o Mapa abre (slot `rodape` do `SalaCartao`, componente `SalaOperacao`), em texto: os leads da sala por passo da jornada, os parados com você e os robôs com o estado do `status.json`. Tudo sai pronto de `operacaoDaSala` (`src/office/operacao.ts`, PURO); o recorte de cada sala está em `JORNADA_DAS_SALAS` e os robôs no campo `trabalhador` dos passos de `src/operations/fluxos.ts` (o catálogo único, de onde `trabalhadores.ts` deriva). A contagem abre `/crm?ver=jornada&produto=…`, o parado abre a Ficha (`&lead=`), o robô abre o passo dele em Como funciona (`/mais?fluxo=…&passo=…`, que o destaca). A rota lê `/api/operations/crm` só se a squad ativa tem sala com operação, e usa o retrato do Dell que a casca já lê (`useOverview`). Sem fonte, "Sem sinal" por extenso; no Easypanel as duas rotas não existem e tudo fica assim.
