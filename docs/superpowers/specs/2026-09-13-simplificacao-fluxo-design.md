# Simplificação do fluxo: squad automático, dica na criação, baixa prioridade, duração explícita

Data: 2026-09-13. Status: aprovado em chat, pendente de plano de implementação.

## Motivação

Uso real do produto (dono único) pede fluxo mínimo: escrever a demanda, squad
certa assume sozinha, agente certo cuida, evento nasce com dica de execução,
horário escolhido pelo servidor. Levantamento de UX identificou 4 atritos
concretos nesse caminho (ver conversa de 2026-09-13): seleção manual de squad,
dica de execução dependente de um fluxo assíncrono separado (Contribuição/Fase
4), semântica de "Prazo Final" invertida em relação ao que o usuário quer
(baixa prioridade, não urgência), e ausência de feedback/edição de duração.

## 1. Squad automático

Hoje: usuário escolhe squad ativa manualmente antes de digitar. O modelo pode
chamar `sugerir_troca_squad` (vê outras squads só por id/nome/escopo, não
consegue agendar nelas), mas a troca exige clique em `TrocaSquadCard`
(Trocar / Trocar e reenviar / Descartar).

Decisão: turno continua com 1 chamada ao Gemini, squad ativa com árvore
completa no prompt (mantém a invariante de custo do CLAUDE.md: outras
squads seguem leves, só id/nome/escopo). Se o resultado do turno for
`sugerir_troca_squad`, o servidor:
1. Troca a squad ativa da sessão para o destino.
2. Reprocessa a MESMA demanda nessa squad (uma 2ª chamada ao Gemini, só
   nesse caso).
3. Devolve o resultado da 2ª chamada como se fosse o turno original; a UI só
   vê um toast dizendo em qual squad caiu.

Limite: no máximo 1 redirecionamento automático por turno. Se a squad de
destino também sugerir troca, o servidor para e cai no fluxo manual de hoje
(`TrocaSquadCard` continua existindo só para esse caso de empate/loop).

Arquivos: `server/orchestrator.ts` (laço de redirecionamento),
`server/capabilities.ts` (sem mudança de schema), `src/App.vue`
(`aceitarTroca`/`sugestoesDeTroca` deixam de ser o caminho principal, viram
fallback).

## 2. Dica de execução na criação (substitui a Contribuição — Fase 4)

Hoje: dica de execução só existe via Contribuição — fluxo assíncrono
separado, até 6 agentes, fila em série na aba, até ~6min de espera, disparado
por um botão manual (`ContribuirModal`, "Pedir contribuição"/"Tentar de
novo").

Decisão: `agendar_evento` ganha um campo novo, preenchido pelo próprio modelo
no MESMO turno que decide data e duração: `nota_de_execucao` (curto, mesmo
espírito de "Ao opinar sobre um compromisso" do escopo da pessoa). No POST que
cria o evento no Google, a descrição nasce com essa nota — texto puro, sem
marcador de bloco e sem hash: a nota é escrita uma única vez, na criação;
nada volta a reescrevê-la depois, então o protocolo de proteção de edição
manual da Fase 4 (necessário lá porque um evento podia receber várias
contribuições ao longo do tempo) não se aplica aqui.

Remover por completo: `src/components/ContribuirModal.vue`, botão "Pedir
contribuição"/"Tentar de novo" em `QuestBackpack.vue`, `server/contribuicao.ts`,
rota `POST /api/quests/:eventId/contribuir`, os campos `contribuicoes`/
`questParaContribuir`/`fila` em `App.vue`, `src/contribuicao.ts` (fila e
estado — o que sobrar de útil pro Ajuste em §4 migra, o resto sai).

Fora de escopo: nada nesta atividade mexe no Ajuste (`AjusteCard`,
`/ajustar`) — esse fluxo é sobre tempo, não sobre texto, e continua existindo
(ver §4).

## 3. Modos: Auto / Focar Agora / Baixa Prioridade

Hoje: 3 modos (`auto`/`foco`/`prazo`). `foco` e `prazo` forçam o tipo do
evento mesmo se o modelo divergir (`server/agendamento.ts`).

Decisão: `prazo` sai da `CommandBar` e vira `baixa_prioridade`. Alocador:
mesmo algoritmo de "primeiro slot livre" do Foco, mas busca numa janela de
**7 dias úteis** (respeitando `DIAS_TRABALHO`) em vez de a partir de agora —
e roda por ÚLTIMO na série do turno (depois de fixo e foco), pegando o que
sobrou.

O motor de deadline+blocos de hoje (marco transparente + blocos de preparo,
`squadone_prazo_ref`, "Bloco i/N" na Mochila, alvo `esforco` do Ajuste)
**não é removido**: o modo `auto` já tinha liberdade de escolher o tipo
`deadline` quando a própria frase describe um prazo real ("entrega até
sexta"); só o botão que FORÇAVA esse tipo sai da UI. Nenhuma mudança em
`server/alocador.ts` é necessária para isso — é puro, e YAGNI aqui é não
tocar o que não quebrou.

Arquivos: `src/components/CommandBar.vue` (rótulos/valor do toggle),
`src/types.ts` (`Modo`), `server/agendamento.ts` (regra de forçar tipo:
`baixa_prioridade` força `time_blocking` com janela de 7 dias úteis, em vez
da regra atual de `prazo` forçar `deadline`).

## 4. Duração explícita

Hoje: duração só existe dentro da frase livre interpretada pelo Gemini; toast
de sucesso não informa o que foi marcado (só erros/avisos aparecem em
`alert`); só um agente pode propor mudança de duração/esforço via Ajuste,
usuário nunca inicia um ajuste.

Decisão (duas partes independentes, ambas aprovadas):
- Toast de sucesso do turno passa a informar o que foi marcado por evento
  criado: título, dia/hora e duração (ex.: "Bloco de 45min, terça 14h–14h45").
  O modelo já decide isso; só faltava aparecer.
- Mochila ganha um gesto do PRÓPRIO usuário para abrir um ajuste de
  duração/horário em qualquer quest visível — reusa a rota `POST
  /api/quests/:eventId/ajustar` e o `AjusteCard` que já existem (hoje só
  chegam lá por proposta de agente). O card mostra a mesma UI de
  aprovar/mover que já existe; muda só quem pode abrir o card.

Arquivos: `src/App.vue` (`handleDelegation` monta o resumo pro toast;
novo estado tipo `ajustes` mas de origem "usuário" em vez de
`receberPropostas`), `src/components/QuestBackpack.vue` (novo botão por
quest, ex. "⏱ Ajustar horário").

## Testes

Cada atividade tem sua própria suíte a estender: orquestrador
(redirecionamento e limite de 1 salto), capabilities/agendamento (schema de
`agendar_evento` com `nota_de_execucao`; `baixa_prioridade` força
`time_blocking` com janela de 7 dias úteis), CommandBar/App (toast de
sucesso, gesto de ajuste iniciado pelo usuário). Sem suíte de testes E2E no projeto: verificação é typecheck + build +
exercitar a rota (padrão já usado nas fases 0-4).

## Fora de escopo

Não mexe em: autenticação, porteiro de IP, GameMap/apresentação isométrica,
hire/ciclo de vida de pessoa-domínio-squad, multi-squad (criar/arquivar/
reativar), formato de marcas no Calendar (`squadone_*`) além do já descrito.
