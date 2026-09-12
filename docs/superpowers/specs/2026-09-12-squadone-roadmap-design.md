# SquadOne — Roadmap das fases 0 a 4

**Data:** 2026-09-12
**Status:** Fase 0 implementada; fases 1–4 decididas, não implementadas
**Origem:** brainstorm com quatro investigações — A (contratação), B (agendamento),
C (agentes executam), D (multi-squad). Referências `arquivo:linha` são do código
anterior à Fase 0.

---

## 1. Princípio comum

**O modelo decide intenção; o servidor executa determinístico.**

O Gemini devolve *o quê* (tipo, esforço, responsável, proposta). Tudo que precisa
ser correto sempre — tipo gravado, horário alocado, id único, merge de texto — é
código do servidor. Instrução no prompt é pedido, não garantia.

Consequência: **sem loop multi-turn com o modelo.** `gerarComRetry` troca de modelo
no meio da tentativa (`gemini-3.7-flash` → `gemini-3.5-flash`), e uma conversa
multi-turn carrega thought signatures do modelo que a começou. Cada turno segue
one-shot; o que parece "conversa" vira gesto do usuário numa rota nova.

## 2. Fases

| Fase | Entrega | Depende de |
|---|---|---|
| 0 | Bugs baratos: toggle Auto/Foco/Prazo ligado, marca `squadone_tipo`, deadline transparente, data de dia inteiro, sugestões por id. Refresh do auth (sessão paralela). | — |
| 1 | Contrato do evento (marcas, `squadone_squad`, formato com `calendarId`) + roster v3 com squads e ids globais. | 0 |
| 2 | Contratação explícita pela UI + ciclo de vida (editar, arquivar, reativar). | 1 |
| 3 | Alocação de horário no servidor: próximo slot livre, prazo = marco + blocos. | 1 |
| 4 | Contribuição de agentes em quests (`colaboradores_ids`, botão na Mochila, proposta de ajuste). | 1; 3 quando a proposta mexe em horário |

Ordem aprovada: **fundação primeiro** — Fase 0 e Fase 1 antes de qualquer outra.
Ids globais precisam existir antes de mais contratações e mais marcas no Calendar.

## 3. Decisões do usuário

| Tema | Decisão |
|---|---|
| Squad | Nível novo **acima** do domínio: Pessoal, Pay4Fun, Freela. Cada squad é um escritório próprio com domínios dentro. |
| Prioridade | Fundação primeiro (Fases 0 e 1). |
| Eventos Pay4Fun | Calendário principal, marcados com `squadone_squad`. O formato guarda `calendarId` para mover a calendário secundário depois. |
| Treino do agente | Usuário escreve uma frase; Gemini redige `papel`/`escopo`; usuário edita e aprova. Escopo até ~1500 caracteres. |
| Fechar domínio / demitir | **Arquivar**: sai do prompt e do mapa, libera o slot, id fica reservado, eventos ficam no Calendar, reativável. |
| Focar Agora | Próximo slot livre a partir de agora, dentro da janela; pode cair em outro dia. |
| Prazo Final | Marco transparente no prazo + blocos de trabalho antes, alocados pelo servidor. O modelo estima o esforço. |
| Contribuição | PO marca `colaboradores_ids` no evento + botão na Mochila. Agente produz texto + proposta de ajuste aprovável (card). |

## 4. Defaults assumidos

Anunciados ao usuário; valem até ele derrubar.

- Quem inicia contratação: UI, e o modelo continua podendo propor card.
- Roteamento de squad: o seletor da UI manda; o modelo só sugere troca.
- Mapa e Mochila mostram a squad ativa. Conflito de horário é global (primary inteiro).
- Janela de agendamento: global única, 09–19 em dias úteis, configurável.
- Bloco de agente editado à mão no Google: o agente não sobrescreve.

## 5. Fase 0 — bugs baratos (implementada)

**Toggle.** Era morto: `CommandBar` emitia `tipo_agendamento` e `server.ts:167` só lia
`demanda`. Agora emite `modo: auto|foco|prazo` (default `auto`). `/api/orquestrar`
aceita `modo` ausente como `auto` e responde 400 para valor desconhecido. Em
`foco`/`prazo` o prompt ganha a regra do tipo forçado e o handler de `agendar_evento`
impõe `time_blocking`/`deadline` mesmo se o modelo divergir. Se o campo de horário
esperado falta, usa o outro: deadline sem `prazo_final` usa `inicio` como limite;
bloco sem `inicio` termina no `prazo_final`. Só com modo forçado. A semântica de
"próximo slot livre" e "marco + blocos" é Fase 3.

**Marca de tipo.** `squadone_tipo` em `extendedProperties.private`, junto de
`squadone_dominio` e `squadone_membro`. `paraQuest` lê a marca e só cai no prefixo
`⏰ DEADLINE:` do título quando ela não existe. Sem migração: eventos antigos
continuam lidos pelo prefixo. O prefixo segue no `summary` como rótulo.

**Deadline transparente.** Deadline era 15 min opaco e bloqueava a agenda. Agora
grava `transparency: "transparent"`.

**Dia inteiro.** `QuestBackpack:16` usava `fim` no deadline; `end.date` do Google é
exclusivo, e `"AAAA-MM-DD"` puro vira meia-noite UTC (dia anterior em -03:00). Agora
usa `inicio` montado como data local, e bloco de dia inteiro não exibe `1440m`.

**Sugestões.** `App.vue:157` só trocava a lista quando vinham sugestões (nunca
esvaziava) e `App.vue:232` usava `:key=index` (card seguinte herdava o nome digitado).
Agora o servidor carimba `id` (`randomUUID`) em cada sugestão; cada turno substitui a
lista, zera os erros; aprovar/descartar/`:key` usam o id.

**Refresh do auth** (`auth-store.ts:214-219`): refresh falho, inclusive por rede,
apaga a credencial; sem lock contra refresh concorrente. Em correção numa sessão
separada, fora deste pacote.

## 6. Fase 1 — contrato do evento + roster v3

Achados (D, B):

- Migração hoje detecta **forma**, não `version` (`squad.ts:196`). O `data/squad.json`
  local tem domínio id `po`; a seed tem `geral`. A migração não pode supor id fixo.
- Formato: `squad.json` v3 `{version: 3, squads: [{id, nome, escopo, calendarId:
  "primary", unlockOrder, dominios}]}`. v2 → `squads[0] = "pessoal"` com ids intactos;
  backup em `squad.v2.bak.json` antes de gravar.
- Squads novas: domínio id `<squad>--<slug>`; id de pessoa checado **globalmente**.
- `squadone_squad` é marca **informativa**, não filtro: o filtro continua por
  domínio, então eventos antigos não precisam de backfill.
- Arquivo por squad: descartado.
- Calendário secundário por squad: exige escopo `calendar.app.created` e novo
  consentimento (não é restrito; conferir no console se é sensível). Fica para ligar
  por squad depois.
- Reservar campo `conta` na squad: dados Pay4Fun passam pela conta pessoal e pelo Gemini.
- Squad nasce com 1 domínio + PO (o `GameMap` precisa de PO raiz). `GameMap :key=squadId`;
  seletor de "prédio" no header manda `squadId` em `/api/orquestrar` e `/api/mochila`.
  Capacidade `sugerir_troca_squad` só propõe.
- Ocupação de agenda é por usuário, não por squad (B): conflito lê o primary inteiro.

## 7. Fase 2 — contratação explícita + ciclo de vida

Achados (A):

- Única rota de escrita é `POST /api/squad/hire` (`server.ts:110`). Não há caminho
  manual: `GameMap` tem `pointer-events: none`. Não existe editar, demitir nem mover.
- `escopo` truncado em 200 caracteres (`hire.ts:128,164`); a decisão é ~1500.
- `proximoSlot` usa `dominios.length` (`squad.ts:211`): remover/arquivar domínio
  devolve slot já ocupado. Tem que contar slots ocupados, não domínios.
- `knownRooms` nunca esquece sala (`useOffice.ts:422`); `dominios[0]` é tratado como
  raiz (`GameMap.vue:137`) — arquivar o primeiro domínio precisa de outra regra de raiz.
- Reusar id de pessoa após demissão re-atribui eventos antigos: manter
  `idsAposentados` (arquivar já resolve se o id nunca sai do roster).
- Caminho: gesto na UI com `POST` direto (zero Gemini para contratar) e ajuste do
  prompt (regra de crescimento, `orchestrator.ts:75`); `PATCH` de pessoa e arquivamento
  de integrante/domínio; Gemini só redige `papel`/`escopo` a partir da frase do usuário.
- PO propor contratação dentro do turno (A3) só depois da Fase 4.

## 8. Fase 3 — alocação de horário no servidor

Achados (B):

- `Promise.all` em `orchestrator.ts:163`: eventos do mesmo turno são criados em
  paralelo e colidem entre si. Alocação tem que ser **em série**.
- `horario` da `Pessoa` é dado morto: `rosterTree` não o envia, `hire` não preenche.
- `events.list` com o escopo atual vê o primary inteiro — basta para ocupação.
  `freebusy.query` exigiria escopo novo e novo consentimento: evitar.
- Contrato novo do modelo: `{tipo, duracao_min, janela: agora|hoje|ate_prazo,
  preferencia?, inicio_fixo?, prazo_final?}`. Servidor lê ocupação uma vez e aloca em série.
- Foco = próximo slot livre desde agora na janela (09–19, dias úteis). Prazo = marco
  transparente em `prazo_final` + blocos antes, somando o esforço estimado.
- O toggle da Fase 0 já é o override desses dois modos; só a semântica muda.

## 9. Fase 4 — contribuição de agentes

Achados (C):

- Turno é one-shot; Mochila não lê `description` nem `etag`; o card da Mochila é um
  `<a>` inteiro, sem espaço para botão (precisa reestruturar o card).
- Responsável é 1 pessoa por evento: fan-out só no responsável não chamaria o
  colaborador. Daí `agendar_evento` ganhar `colaboradores_ids[]`.
- Rota `POST /api/quests/:eventId/contribuir {pessoaIds[]}`: N gerações paralelas
  (teto 3), 1 `GET` + 1 `PATCH` com merge e `If-Match` (etag), retry 1x em 412.
- `PATCH` troca arrays inteiros e `extendedProperties.private` parcial pode apagar
  marcas — a quest some da Mochila. Sempre reenviar as marcas completas.
- Limites: chave de extendedProperty ≤ 44, valor ≤ 1024, total 32 kB; `description`
  aceita HTML, ~8192 caracteres (não oficial).
- Formato na `description`: blocos `[[squadone:<id>]]…[[/squadone:<id>]]`; texto do
  usuário fora dos blocos fica intocado; hash em `squadone_h_<id>` detecta edição
  manual — bloco editado não é sobrescrito.
- Contexto do agente: `papel`/`escopo` + quest + `description` atual + títulos das
  quests do domínio. Sem memória nova.
- Mais chamadas paralelas ao Google multiplicam o risco do refresh concorrente:
  depende do lock de refresh estar no auth-store.
