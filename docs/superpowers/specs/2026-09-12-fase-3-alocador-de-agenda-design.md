# SquadOne — Fase 3: o servidor escolhe o horário (alocador de agenda)

**Data:** 2026-09-12
**Status:** design aprovado para implementação
**Depende de:** Fase 1 (roster v3, `CapabilityContext { token, roster, squad, agora, modo, demanda }`, `PedidoDeTurno`, `marcasDoEvento`, `urlDeEventos`, `ContextoDoPrompt`). Convive com a Fase 2, que também altera `server/orchestrator.ts` e `server/capabilities.ts`.
**Plano:** `docs/superpowers/plans/2026-09-12-fase-3-alocador-de-agenda.md`
**Origem:** roadmap §8 (`docs/superpowers/specs/2026-09-12-squadone-roadmap-design.md`), investigação B.

---

## 1. Objetivo

**O modelo decide a intenção; o servidor escolhe o horário.** Hoje o Gemini manda `inicio` exato e o servidor grava cego: eventos batem com a agenda do usuário e, pior, entre si (`Promise.all` em `executarTurno`). A Fase 3 troca isso por um alocador determinístico:

1. `agendar_evento` deixa de receber `inicio`. Recebe tipo, duração ou esforço, prazo e, só quando o usuário disse a hora, `inicio_fixo`.
2. O servidor lê a agenda **inteira** do calendário principal uma vez por turno e escolhe slots livres dentro de uma janela de trabalho global.
3. **Focar Agora** (`time_blocking`) = próximo slot livre a partir de agora.
4. **Prazo Final** (`deadline`) = marco transparente no prazo + blocos de trabalho antes dele, somando o esforço estimado pelo modelo.
5. Compromissos do mesmo turno são alocados **em série**; cada reserva desconta da ocupação.
6. O alocador é um módulo **puro** (`server/alocador.ts`), reusável pela Fase 4.
7. A Mochila mostra blocos ligados ao prazo ("Bloco 2/3 · para o prazo de 16/09") e o intervalo de datas de eventos de dia inteiro com vários dias.

## 2. Não-objetivos

- `freebusy.query` ou qualquer escopo OAuth novo. `calendar.events` já cobre `events.list` do primary.
- Ocupação de outros calendários (secundários, assinados, de outra conta). Só o `primary` conta.
- Feriados. Janela por pessoa (`Pessoa.horario` continua dado morto). Preferência manhã/tarde.
- Editar a janela pela UI.
- Mover, reagendar ou apagar eventos já existentes, inclusive quando parte de um prazo falha.
- Folga entre compromissos **diferentes** (só há pausa entre blocos do mesmo prazo).
- Recorrência criada pelo app.
- Squads (Fase 1), contratação (Fase 2), contribuição dos agentes e propostas de ajuste de duração (Fase 4).

## 3. Contrato novo de `agendar_evento`

### 3.1 Declaração

```ts
{
  name: "agendar_evento",
  description:
    "Registra um compromisso na agenda do usuário. Você decide a INTENÇÃO — o quê, " +
    "quem, quanto tempo e até quando; o servidor escolhe o horário livre. Use uma " +
    "chamada por compromisso: uma demanda com várias entregas vira várias chamadas. " +
    "Um prazo com blocos de trabalho é UMA chamada.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      titulo: {
        type: Type.STRING,
        description: "Título curto e acionável do compromisso.",
      },
      responsavel_id: {
        type: Type.STRING,
        description:
          "id da pessoa da squad atual responsável — pode ser o PO de um domínio " +
          "ou um integrante dele. Use exatamente um dos ids da árvore do roster. " +
          "O domínio do evento é derivado dela; não existe campo de domínio.",
      },
      tipo: {
        type: Type.STRING,
        enum: ["time_blocking", "deadline"],
        description:
          "'time_blocking' reserva UM bloco de execução no próximo horário livre. " +
          "'deadline' marca a data limite e reserva blocos de trabalho antes dela, " +
          "somando esforco_min.",
      },
      duracao_min: {
        type: Type.INTEGER,
        description: "time_blocking: duração do bloco em minutos. Padrão 60.",
      },
      esforco_min: {
        type: Type.INTEGER,
        description:
          "deadline: sua estimativa realista do trabalho TOTAL até o prazo, em " +
          "minutos. O servidor divide em blocos.",
      },
      prazo_final: {
        type: Type.STRING,
        description:
          "Obrigatório quando tipo='deadline'. AAAA-MM-DD se o usuário não disse " +
          "hora (o marco vira dia inteiro); ISO 8601 com offset se disse.",
      },
      a_partir_de: {
        type: Type.STRING,
        description:
          "Opcional. Só quando o usuário disse QUANDO começar sem dizer a hora " +
          "('amanhã', 'segunda'). AAAA-MM-DD ou ISO 8601 com offset. O servidor " +
          "procura horário livre a partir daí.",
      },
      inicio_fixo: {
        type: Type.STRING,
        description:
          "Opcional, só time_blocking. Só quando o usuário disse a HORA exata " +
          "('amanhã às 14h'). ISO 8601 com offset. É respeitado mesmo com conflito.",
      },
    },
    required: ["titulo", "responsavel_id", "tipo"],
  },
}
```

`inicio` sai da declaração. Um `inicio` que o modelo mande assim mesmo é ignorado.

### 3.2 Normalização (handler)

`tipo efetivo` = tipo forçado pelo toggle (`foco` → `time_blocking`, `prazo` → `deadline`) ou, em `auto`, `args.tipo` (`"deadline"` → deadline; qualquer outro → time_blocking).

Datas são lidas por `lerInstante(valor, fuso)`:

| Entrada | Leitura |
|---|---|
| `AAAA-MM-DD` válido | meia-noite local no fuso + `data` preenchida ("só data") |
| `AAAA-MM-DDTHH:MM[:SS[.fração]]` sem offset | hora de parede em `America/Sao_Paulo` (o container roda em UTC). Nenhuma string sem offset passa por `new Date`, que a leria no fuso do processo |
| ISO com offset (`±HH:MM`, `±HHMM`, até 14h) ou `Z` | o instante, montado pelas partes |
| qualquer outra coisa, inclusive dia ou hora inexistente (`2026-02-30`, `25:00`, que `Date` normalizaria calado) | inválida → erro nomeando o campo |

**time_blocking**

- `duracao` = `duracao_min` > 0; senão, só com toggle forçado, `esforco_min` > 0; senão 60. Arredondada **para cima** em múltiplo de 15. Acima de 720 → 720 + aviso.
- `inicio_fixo` com hora → slot `[inicio_fixo, +duracao)`, gravado como está. Avisos (não bloqueiam): conflito com a ocupação; fora da janela; já passou; além dos 60 dias lidos (conflito não verificado).
- `inicio_fixo` só com data → vale como `a_partir_de`.
- Sem hora fixa: `duracao` maior que a janela diária → erro. Senão `alocar(... { tipo: "foco", duracaoMin, aPartirDe, limite })`. `limite` só existe com toggle forçado e `prazo_final` preenchido (regra de fallback da Fase 0: o bloco termina antes do prazo).

**deadline**

- `prazo`: `prazo_final`; senão, só com toggle forçado, `inicio_fixo` (+ `duracao_min` quando tem hora — fallback da Fase 0); senão erro "`prazo_final` é obrigatório".
- Fim do marco = prazo (com hora) ou meia-noite seguinte (só data). Fim do marco ≤ agora → erro "já passou".
- `limite dos blocos` = prazo (com hora) ou **fim da janela no dia do prazo** (só data: "até sexta" inclui a sexta).
- `esforco` = `esforco_min` > 0; senão, só com toggle forçado, `duracao_min` > 0; senão **nenhum bloco** + aviso "Sem esforco_min estimado".
- `esforco` arredondado para cima em 15, mínimo 30, máximo 2400 (40h; acima → 2400 + aviso).
- `alocar(... { tipo: "blocos", esforcoMin, aPartirDe, limite })`.

### 3.3 Resultado

```ts
interface EventoCriado {
  kind: "evento";
  titulo: string;
  responsavel_id: string;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  inicio: string;        // ISO; "AAAA-MM-DD" quando dia_inteiro
  fim: string;           // ISO; "AAAA-MM-DD" EXCLUSIVO quando dia_inteiro
  dia_inteiro: boolean;
  papel: "foco" | "marco" | "bloco";
  prazo_ref?: string;    // eventId do marco, só em bloco
  eventId: string;
  htmlLink?: string;
}

interface CompromissoAgendado {
  kind: "compromisso";
  titulo: string;
  responsavel_id: string;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  eventos: EventoCriado[];   // foco: [foco]; prazo: [marco, ...blocos]
  avisos: string[];
  faltou_min: number;
}
```

`agendar_evento` devolve `CompromissoAgendado`. `executarTurno` achata `eventos` em `TurnoResult.eventos_criados` (o frontend continua lendo `eventos_criados[0].responsavel_id`) e `avisos` em `TurnoResult.avisos: { capacidade, titulo, aviso }[]`.

### 3.4 Gravação

- **Foco:** 1 POST opaco `[papel] titulo`. Sucesso → `agenda.reservar(slot)`.
- **Prazo:** POST do **marco primeiro** (`⏰ DEADLINE: [papel] titulo`, `transparency: "transparent"`; com hora: 15 min terminando no prazo; só data: `start.date = D`, `end.date = D+1`). Falha do marco → erro do compromisso, nada criado. Depois os blocos, **um POST por vez**, opacos, `[papel] titulo (bloco i/N)`, com `squadone_prazo_ref = <eventId do marco>`. Cada sucesso reserva. O primeiro bloco que falha **para a série**: o que já foi gravado fica (marco e blocos anteriores continuam corretos), os minutos restantes somam em `faltou_min`, e um aviso nomeia o bloco e o erro. Nada é apagado.

## 4. Algoritmo do alocador

### 4.1 Interface pura (`server/alocador.ts`)

```ts
interface Intervalo { inicio: number; fim: number }          // epoch ms, [inicio, fim)
interface Janela { inicioMin: number; fimMin: number; dias: number[]; fuso: string }
type PedidoDeSlot =
  | { tipo: "foco"; duracaoMin: number; aPartirDe?: number; limite?: number }
  | { tipo: "blocos"; esforcoMin: number; aPartirDe?: number; limite: number };
interface Alocacao { slots: Intervalo[]; faltouMin: number }

alocar(ocupacao: Intervalo[], janela: Janela, pedido: PedidoDeSlot, agora: number): Alocacao
```

Sem `fetch`, sem `Date.now()`, sem `process.env`, sem import de outro módulo do app. Não muta a entrada. Mesma entrada → mesma saída.

### 4.2 Constantes

| Constante | Valor | Por quê |
|---|---|---|
| `FUSO` | `America/Sao_Paulo` | único usuário |
| `GRADE_MIN` | 15 | todo slot começa e termina em múltiplo de 15 min |
| `BLOCO_MIN` | 30 | abaixo disso o bloco é só troca de contexto |
| `BLOCO_MAX` | 120 | trabalho contínuo acima de 2h rende menos; o resto vira outro bloco |
| `PAUSA_MIN` | 15 | folga entre dois blocos do MESMO prazo no mesmo dia |
| `BLOCOS_MAX` | 20 | cada bloco é um POST em série com o usuário esperando |
| `HORIZONTE_FOCO_DIAS` | 14 | Focar Agora procura até 14 dias corridos (≈10 úteis) |
| `HORIZONTE_DIAS` | 60 | quanto da agenda o turno lê; nada é alocado além disso |
| `ESFORCO_MAX_MIN` | 2400 | 40h num prazo só é compromisso que devia ser quebrado |
| `DURACAO_MAX_MIN` | 720 | foco de mais de 12h não é bloco |

### 4.3 Pseudocódigo

```
teto15(t), piso15(t): arredondam epoch ms para múltiplo de 15 min
  (todo fuso real tem offset múltiplo de 15 min, então a grade UTC é a grade local)

alocar(ocupacao, janela, pedido, agora):
  base      = teto15(max(agora, pedido.aPartirDe ?? agora))
  tetoAbs   = agora + 60 dias
  ocupado   = mesclar(ocupacao)                    // ordena e funde sobrepostos/encostados

  se pedido.tipo == "foco":
    fimBusca = min(base + 14 dias, pedido.limite ?? ∞, tetoAbs)
    para cada dia em janelasDosDias(base, fimBusca):
      para cada livre em livres(dia, ocupado):
        se livre.fim - livre.inicio >= duracao: devolve [livre.inicio, +duracao)
    lança SemHorarioLivre

  // blocos
  fimBusca = min(pedido.limite, tetoAbs)
  dias     = janelasDosDias(base, fimBusca)
  restante = esforco; slots = []

  passada 1 — no máximo UM bloco por dia, do dia mais cedo ao mais tarde:
    para cada dia (enquanto restante >= 30 e slots < 20):
      primeiro livre em que tamanho(livre, restante) > 0 → reserva, desconta, próximo dia

  passada 2 — o que sobrou vai onde couber:
    para cada dia:
      repete (enquanto restante >= 30 e slots < 20):
        ocupadoAgora = mesclar(ocupado ∪ {[s.inicio-15min, s.fim+15min) para s em slots})
        primeiro livre do dia em ocupadoAgora com tamanho > 0 → reserva; senão próximo dia

  devolve { slots ordenados, faltouMin: restante }

tamanho(livreMin, restante):
  se livreMin < 30 ou restante < 30: 0
  t = min(120, livreMin, restante)
  se 0 < restante - t < 30 e restante - 30 >= 30: t = restante - 30   // 135 → 105 + 30, nunca 120 + 15
  devolve t

janelasDosDias(de, ate):
  d = data local de `de`
  enquanto instanteLocal(d, 00:00) < ate:
    se diaSemanaISO(d) ∈ janela.dias:
      ini = max(instanteLocal(d, janela.inicioMin), de)
      fim = min(instanteLocal(d, janela.fimMin), ate)
      se fim > ini: emite [ini, fim)
    d = próximo dia do CALENDÁRIO (Date.UTC(ano, mes, dia+1)), nunca +24h

livres(dia, ocupado):
  trechos de dia fora de ocupado, cada um recortado para [teto15(inicio), piso15(fim))

instanteLocal(data, minutos, fuso):
  parede   = Date.UTC(data, minutos)                      // hora de parede tratada como UTC
  offA     = offset(parede - 12h); offB = offset(parede + 12h)
  se offA == offB: devolve parede - offA
  tA = parede - offA; tB = parede - offB
  ambos válidos (hora repetida, relógio atrasou): devolve o MENOR
  só um válido: devolve ele
  nenhum (hora inexistente, relógio adiantou): devolve tA  // empurra para depois do salto
```

`offset(t)` vem de `Intl.DateTimeFormat(..., { timeZone, timeZoneName: "longOffset" })`.

### 4.4 Casos de borda

| Caso | Comportamento |
|---|---|
| Agora 10:07 | busca começa 10:15 |
| Agora antes da janela (08:00) | 09:00 do mesmo dia útil |
| Agora depois da janela (19:30) | 09:00 do próximo dia útil |
| Sábado/domingo | 09:00 da segunda |
| Bloco que atravessaria o fim da janela (18:30 + 60) | não parte o bloco; vai para 09:00 do próximo dia útil |
| Evento terminando fora da grade (10:50) | próximo slot começa 11:00 |
| Evento de vários dias com hora | ocupa todos os minutos que cobre |
| Buraco menor que o pedido | pulado |
| Agenda cheia no horizonte (foco) | `SemHorarioLivre` |
| Prazo já passou (blocos) | `slots: []`, `faltouMin = esforço` (o handler recusa antes) |
| Esforço não cabe antes do prazo | aloca o que couber, `faltouMin > 0`, aviso |
| Dia com 23h/25h (DST) | janela medida em instantes reais; `America/Sao_Paulo` não tem DST desde 2019, mas o fuso é parâmetro e o teste usa `America/New_York` e São Paulo 2018 |
| Início da janela numa hora inexistente | primeiro instante válido depois do salto |

### 4.5 Decisões do alocador

- **Horizonte do Focar Agora: 14 dias corridos** a partir do início da busca, e nunca além de 60 dias de agora. Duas semanas sem 1h livre é sinal para o usuário, não para o alocador procurar mais longe. Não achar → `SemHorarioLivre` (classificado, vira `motivo: "semHorarioLivre"` só naquele compromisso).
- **Blocos: mínimo 30, máximo 120, pausa 15, teto 20.**
- **Espalhar antes de empilhar** (passada 1): prazo daqui a duas semanas não come o dia de hoje inteiro; prazo amanhã ainda enche o dia (passada 2).
- **Não coube antes do prazo: aloca o que couber e avisa.** O marco é o compromisso real e sempre é criado; horas parciais reservadas são informação honesta e útil ("faltaram 3h"). Recusar tudo perderia o marco e o trabalho que cabia, e o usuário ficaria sem saber quanto faltou. `faltou_min` fica no resultado para a Fase 4 propor ajuste.

## 5. Leitura de ocupação

Uma chamada lógica por turno, **preguiçosa** (só quando o primeiro `agendar_evento` executa; turno sem agendamento não toca o Google), memorizada em `AgendaDoTurno` (`server/agenda.ts`).

```
GET https://www.googleapis.com/calendar/v3/calendars/primary/events
  ?timeMin=<agora ISO>&timeMax=<agora + 60 dias ISO>
  &singleEvents=true            // recorrentes expandidos em instâncias
  &showDeleted=false
  &maxResults=2500              // máximo da API
  &maxAttendees=1               // com mais convidados o Google devolve só o próprio usuário
  &fields=nextPageToken,items(status,transparency,eventType,start,end,attendees(self,responseStatus))
  [&pageToken=<nextPageToken>]
```

- Sempre `primary`, qualquer que seja o `calendarId` da squad: conflito é **global** — eventos de todas as squads e eventos que o app não criou.
- Sem `privateExtendedProperty`: a ocupação não filtra por marca.
- `timeMin` é limite exclusivo do **fim** do evento e `timeMax` do **início** (doc do `events.list`): eventos em andamento entram.
- Paginação: segue `nextPageToken` até 10 páginas (25 000 eventos). Passou disso → erro, nada alocado (ocupação incompleta alocaria por cima de compromissos).
- Quota: 600 req/min por usuário. Um turno típico = 1 GET + 1–21 POST por compromisso, em série.

`eventoOcupa(ev)` — um evento **não** ocupa quando:

| Condição | Por quê |
|---|---|
| `status === "cancelled"` | não existe mais |
| `transparency === "transparent"` | o próprio Google diz que não bloqueia (inclui os marcos do app) |
| `start.dateTime` ou `end.dateTime` ausente | dia inteiro (feriado, aniversário, lembrete) |
| `eventType` `workingLocation` ou `birthday` | informativos |
| algum `attendees[]` com `self: true` e `responseStatus: "declined"` | o usuário recusou |

Todo o resto ocupa, inclusive `tentative`, `needsAction`, `outOfOffice` e `focusTime`: na dúvida, não marcar por cima.

Reservas do turno: `AgendaDoTurno.reservar(intervalo)` guarda cada slot gravado com sucesso; `ocupacao()` devolve leitura + reservas.

## 6. Série, prioridade e falha

Em `executarTurno`:

- Capacidades que **não** são `agendar_evento` continuam em paralelo, como hoje.
- As chamadas de `agendar_evento` rodam **uma por vez**, na ordem de `prioridadeDeAgendamento(args, tipoForcado, fuso)`:
  1. `[0, 0]` time_blocking com `inicio_fixo` com hora — o usuário já decidiu; os outros desviam dele;
  2. `[1, 0]` demais time_blocking — "agora" é o que mais perde esperando;
  3. `[2, limite efetivo]` deadline, prazo mais próximo primeiro — com hora o próprio prazo, só data o fim da janela daquele dia (prazo ilegível por último).
  Empate: ordem em que o modelo chamou.
- Resultados voltam na ordem original das chamadas.
- A regra da Fase 1 continua: turno com `sugerir_troca_squad` descarta todas as outras chamadas (inclusive agendamentos) antes de executar; descartadas não leem a agenda.
- Um `try` por compromisso: falha de um vira `ErroTarefa` e os seguintes continuam.

## 7. Marcas no evento

Contrato da Fase 1 + uma chave:

| Chave | Valor | Em quais eventos | Quem lê |
|---|---|---|---|
| `squadone_squad` | `Squad.id` | todos | Mochila (informativo) |
| `squadone_dominio` | `Dominio.id` | todos | filtro da Mochila |
| `squadone_membro` | `Pessoa.id` | todos | atribuição |
| `squadone_tipo` | `deadline` no marco; `time_blocking` no foco e nos blocos | todos | semântica |
| **`squadone_prazo_ref`** | **eventId do marco** | **só blocos** | `paraQuest` → `QuestCalendario.prazoRef` (`""` sem marca) |

- Chave com 18 caracteres (limite 44); eventId do Google bem abaixo de 1024.
- Por que o eventId do marco e não um uuid próprio: o marco é gravado primeiro, então o id existe; e a Mochila liga bloco e marco pelo `eventId` que já tem, sem um terceiro identificador.
- Por que não gravar "2/3" numa marca: posição e total são derivados da lista lida (§9); bloco apagado no Google some da contagem.
- `marcasDoEvento` ganha `prazoRef?: string` — continua sendo a única função que monta marcas.
- Blocos são `time_blocking` com as mesmas marcas de domínio/membro: aparecem na Mochila pelo filtro de domínio sem mudança.

## 8. Janela de trabalho

**Mora em variáveis de ambiente**, lidas a cada turno:

| Var | Formato | Padrão |
|---|---|---|
| `JANELA_TRABALHO` | `HH:MM-HH:MM` (00:00–24:00, fim ≥ início + 30 min) | `09:00-19:00` |
| `DIAS_TRABALHO` | dias ISO separados por vírgula, `1` = segunda … `7` = domingo, sem repetir | `1,2,3,4,5` |

Fuso fixo `America/Sao_Paulo` (constante `FUSO`).

Por que env e não campo no `squad.json` v3:

- A janela é do **usuário**, não de uma squad; o `squad.json` é o roster, e o roster é o prompt.
- A Fase 1 está implementando a migração e a validação do v3 agora; um campo novo mexeria nelas no meio.
- Não há UI para editá-la nesta fase. Editar JSON dentro do volume é pior que editar uma var no Easypanel.
- Nenhum arquivo novo: respeita a persistência V1 (só `squad.json` e `google-auth.json`).
- Custo aceito: trocar a janela exige **Implantar** (restart; não precisa rebuild, não é `VITE_`).

Var presente e ilegível → `JanelaMalConfigurada`, **nunca o padrão calado**: agendar fora da janela configurada é pior que não agendar. `/api/orquestrar` lê a janela **antes** do token e do Gemini. O boot loga a janela lida (ou o erro).

## 9. Prompt

`ContextoDoPrompt` (Fase 1) ganha `janela: string` (`descreverJanela(janela)`, ex.: `09:00–19:00 (seg, ter, qua, qui, sex)`).

O parágrafo de data e a regra de tipo passam a ser:

```
Agora são ${agoraISO} (fuso ${TIMEZONE}). Datas que você produzir: AAAA-MM-DD
quando o usuário não disse hora; com hora, ISO 8601 com offset no mesmo formato.

Você NÃO escolhe horário. O servidor lê a agenda do usuário e reserva o próximo
horário livre dentro da janela de trabalho ${contexto.janela}, sem colidir com o
que já está lá. Você diz a intenção: o quê, quem, quanto tempo e até quando.
```

```
- tipo='time_blocking' quando o usuário precisa de um bloco para executar: mande
  duracao_min. Se ele disse QUANDO sem hora ("amanhã", "segunda"), mande
  a_partir_de com a data. Só se ele disse a HORA ("amanhã às 14h"), mande
  inicio_fixo com data/hora.
- tipo='deadline' quando há uma data limite de entrega: mande prazo_final e
  esforco_min, sua estimativa realista do trabalho TOTAL até lá, em minutos. O
  servidor cria o marco no prazo e divide o esforço em blocos antes dele. Não
  chame agendar_evento de novo para os blocos.${regraModo}
```

`regraModo`:

- `foco`: `O usuário forçou tipo='time_blocking' para TODOS os compromissos desta demanda: use-o em toda chamada de agendar_evento, com duracao_min.`
- `prazo`: `O usuário forçou tipo='deadline' para TODOS os compromissos desta demanda: use-o em toda chamada de agendar_evento, com prazo_final e esforco_min.`
- `auto`: vazio.

O restante do prompt (árvore, outras squads, crescimento, troca de squad) fica como a Fase 1/2 deixou.

## 10. Erros

### 10.1 Sem credencial

Continua a regra atual: **o turno roda sem token.** A rota guarda por que não há token (`falhaDoToken`: a exceção de `tokenValido()`) e passa ao turno. `AgendaDoTurno.ocupacao()` lança, sem chamar o Google:

- a própria `PrecisaConectar` ou `ErroDeConfig` que veio do `tokenValido()`;
- `AgendaIndisponivel(credencial: false)` para outra falha (rede no refresh);
- `PrecisaConectar` própria quando não houve falha registrada.

Cada `agendar_evento` do turno vira `ErroTarefa` classificado; propostas de crescimento e troca de squad continuam funcionando. `responsavel_id` inválido é checado **antes** da agenda (erro sem tocar o Google).

### 10.2 Tabela

| Situação | Classe | Escopo | Saída |
|---|---|---|---|
| `JANELA_TRABALHO`/`DIAS_TRABALHO` ilegíveis | `JanelaMalConfigurada` | rota, antes do token/Gemini | HTTP 500 `{ error, configuracao: true }` |
| Sem credencial / Google recusou refresh | `PrecisaConectar` | cada agendar_evento | `ErroTarefa.motivo = "precisaConectar"` |
| Falta env do OAuth | `ErroDeConfig` | cada agendar_evento | `motivo = "configuracao"` |
| `events.list` 401/403 de credencial | `AgendaIndisponivel(credencial: true)` | todos os agendar_evento do turno (sem reler) | `motivo = "precisaConectar"` |
| `events.list` outro erro, >10 páginas, rede | `AgendaIndisponivel(credencial: false)` | idem | `motivo = "agendaIndisponivel"` |
| Foco sem slot no horizonte | `SemHorarioLivre` | um compromisso | `motivo = "semHorarioLivre"` |
| Data ilegível, prazo passado/ausente, duração > janela, título vazio | `Error` | um compromisso | `ErroTarefa` sem `motivo` |
| POST do marco ou do foco falha | `ErroCalendario` | um compromisso | `ErroTarefa` sem `motivo`; nada criado |
| POST de um bloco falha | — | um compromisso | aviso; série para; `faltou_min` soma o resto |
| Esforço parcial, conflito/fora da janela/passado/além do horizonte no fixo, esforço/duração acima do teto, prazo sem esforço | — | um compromisso | aviso |

```ts
type MotivoDeErro = "precisaConectar" | "configuracao" | "semHorarioLivre" | "agendaIndisponivel";
interface ErroTarefa { capacidade: string; args: Record<string, any>; erro: string; motivo?: MotivoDeErro }
interface AvisoTarefa { capacidade: string; titulo: string; aviso: string }
```

O status HTTP do turno não muda: 200 com `erros` e `avisos`.

## 11. UI

Mínimo necessário.

- **`src/mochila.ts`** (novo, sem Vue, testável com tsx): `diasDoEventoDiaInteiro(inicio, fim)` e `infoDePrazo(quest, quests)`.
- **`QuestBackpack.vue`:**
  - Linha de tipo: bloco → `⏰ Bloco 2/3: 120m`; marco com blocos na lista → `⏰ Deadline · 3 bloco(s) de trabalho`; demais como hoje.
  - Bloco ganha uma linha `🎯 Para o prazo de <data do marco>`, ou `🎯 Para um prazo fora da Mochila` quando o marco não está na lista lida (apagado, ou fora da janela de leitura −7/+90 dias).
  - Dia inteiro com vários dias: `12/09/2026 – 14/09/2026` (fim exclusivo menos um dia). Um dia só: só a data. Resolvido porque custa uma função.
  - O card continua um `<a>` (reestruturar é Fase 4).
- **`App.vue`:** o `alert` do turno lista erros e avisos (`Aviso — <título>: <aviso>`). Algum erro com `motivo === "precisaConectar"` → `conectado = false` (a Mochila volta a oferecer o botão).
- **`CommandBar.vue`:** dicas do toggle: Auto `O squad decide entre foco e prazo; o servidor escolhe o horário`; Focar Agora `Próximo horário livre na janela de trabalho`; Prazo Final `Marco no prazo + blocos de trabalho antes dele`.
- `src/types.ts` espelha `EventoCriado`, `AvisoTarefa`, `ErroTarefa.motivo`, `TurnoResponse.avisos`, `QuestCalendario.prazoRef`.

## 12. Riscos

| Risco | Mitigação / aceite |
|---|---|
| Reunião em calendário secundário ou de outra conta não é vista | não-objetivo declarado; `primary` é onde o usuário vive hoje |
| Evento criado no Google entre a leitura e o POST (segundos) | aceito: usuário único; o próximo turno vê |
| Dois turnos simultâneos (duas abas) leem antes um do outro gravar | aceito; mesma razão |
| Modelo estima esforço ruim | blocos visíveis e editáveis no Google; Fase 4 propõe ajuste (`faltou_min` já existe) |
| Modelo continua mandando hora sem o usuário ter dito (`inicio_fixo` indevido) | prompt explícito + aviso de conflito/fora da janela; efeito é o comportamento antigo, não pior |
| Prazo gera muitos POSTs (até 21) e o turno demora | teto de 20 blocos; série é exigida pela reserva; 600 req/min por usuário cobre folgado |
| Refresh concorrente do auth-store (`auth-store.ts:214`) | POSTs em série reduzem a concorrência; correção fica na sessão paralela |
| Bloco falha no meio e deixa prazo parcial | aviso explícito com minutos sem reserva; nada apagado automaticamente |
| `i/N` da Mochila muda quando blocos antigos saem da janela de leitura | derivado da lista de propósito; rótulo, não dado |
| Trocar a janela exige Implantar | documentado no CLAUDE.md |
| Feriado cai dentro da janela | não-objetivo; o usuário move o bloco no Google |
| Mudança de regra de fuso (DST volta ao Brasil) | tzdata do Node + algoritmo sem +24h; testado com NY e São Paulo 2018 |
| Página de >2500 eventos em 60 dias | paginação até 10 páginas; além disso erro, nunca alocação cega |

## 13. Critérios de aceite

Todos verificáveis sem Google e sem Gemini reais (fetch e cliente do Gemini falsos), com scripts fora do repo.

1. **Alocador — tabela** (`America/Sao_Paulo`, janela 09–19 seg–sex salvo indicado), resultado exato:
   - A1 agora seg 14/09 10:07, foco 60 → 10:15–11:15.
   - A2 agora 08:00 → 09:00–10:00. A3 agora 19:30 → ter 09:00–10:00. A4 sáb 12/09 10:00 → seg 09:00–10:00.
   - A5 agora 18:30, foco 60 → ter 09:00–10:00.
   - A6 ocupado 10–11 e 11:30–12, agora 10:00, foco 60 → 12:00–13:00.
   - A7 ocupado 10:00–10:50, foco 30 → 11:00–11:30.
   - A8 ocupado 14/09–01/10, foco 60 → `SemHorarioLivre`.
   - A9 `aPartirDe` ter 00:00 → ter 09:00–10:00. A10 foco com `limite` 12:00 e ocupado 10–12 → `SemHorarioLivre`. A11 evento dom 22:00 → seg 12:00, agora 08:00 → seg 12:00–13:00.
   - B1 esforço 240, limite qua 19:00, agora seg 09:00 → seg 09–11, ter 09–11, faltou 0.
   - B2 esforço 135 → seg 09:00–10:45, ter 09:00–09:30.
   - B3 esforço 360, limite ter 12:00 → seg 09–11, seg 11:15–13:15, ter 09–11.
   - B4 esforço 600, limite seg 12:00 → seg 09–11, seg 11:15–12:00, faltou 435.
   - B5 limite antes de agora → nenhum slot, faltou 120.
   - B6 só buracos de 30 min, esforço 45 → 09:00–09:30, faltou 15.
   - B7 janela 09:00–09:30 todos os dias, esforço 900 → 20 slots (14/09…03/10), faltou 300.
   - D1 `America/New_York`, janela 01–04 todos os dias, agora 08/03/2026 00:30 −05:00, foco 120 → 06:00Z–08:00Z do dia 08. D2 foco 180 → 09/03 05:00Z–08:00Z. D3 janela 00–03, agora 31/10 23:00 −04:00, foco 240 → 01/11 04:00Z–08:00Z. D4 janela 02:30–05:00, agora 08/03 00:00 −05:00, foco 60 → 07:30Z–08:30Z. D5 São Paulo janela 00–02, agora 03/11/2018 23:00 −03:00, foco 60 → 04/11/2018 03:00Z–04:00Z.
   - Nenhum caso muta `ocupacao`.
2. `lerJanela({})` = 09:00–19:00, `[1..5]`; `19:00-09:00`, `9-19`, `09:00-09:15`, `DIAS_TRABALHO=0,1` e `1,1` → `JanelaMalConfigurada`. `lerInstante` lê só data, sem offset (como São Paulo), `Z`; recusa `amanhã`, `2026-02-30` (com e sem hora) e `25:00`. Env presente mas vazia = padrão.
3. `server/alocador.ts` não contém `fetch(`, `process.env`, `Date.now(` nem `import`.
4. `eventoOcupa`: transparente, dia inteiro, cancelado, `workingLocation`, recusado pelo próprio usuário → não ocupa; tentativo, recusa de outro convidado, `outOfOffice` → ocupa.
5. `AgendaDoTurno`: duas `ocupacao()` fazem uma leitura (duas páginas = 2 GETs); URL em `/calendars/primary/events` com `singleEvents=true`, `timeMin=agora`, `timeMax=agora+60d`, `maxAttendees=1`, `maxResults=2500`, sem `privateExtendedProperty`; reserva entra na ocupação; 401 → `AgendaIndisponivel(credencial)` e nenhuma segunda leitura; sem token → erro classificado e zero `fetch`.
6. Foco: ocupado 09–10, agora 08:00, `duracao_min` 50 → 10:00–11:00 opaco com as quatro marcas; segundo foco do mesmo turno → 11:00.
7. `inicio_fixo` 14:30 sobre evento 14–15 → gravado 14:30 + aviso de conflito; `2026-09-14T20:00:00` sem offset → 20:00 −03:00 + aviso de fora da janela.
8. Prazo `2026-09-16`, esforço 240 → POSTs: marco `start.date 2026-09-16`/`end.date 2026-09-17` transparente sem `squadone_prazo_ref`; blocos seg 09:00 e ter 09:00 opacos com `squadone_prazo_ref = ev1`, `squadone_tipo = time_blocking`, título `(bloco 2/2)`.
9. Prazo `2026-09-14T18:00-03:00`, esforço 300, ocupado 11–19 → marco 17:45–18:00; 1 bloco 09–11; `faltou_min` 180; aviso começando com `Faltaram 3h`.
10. Terceiro POST falha num prazo de 3 blocos → 3 POSTs, eventos `[marco, bloco]`, `faltou_min` 240, aviso `O bloco 2/3 não foi criado`. Marco falha → erro, nenhum bloco.
11. Toggle `prazo` com `inicio_fixo` 15/09 14:00 + `duracao_min` 120 → marco termina 16:00 + 1 bloco. Toggle `foco` com `prazo_final` 12:00 e manhã ocupada → `SemHorarioLivre`.
12. **Turno** (Gemini falso devolvendo: prazo `2026-09-16` esforço 120; foco 60; `criar_po_dominio`; foco `inicio_fixo` 10:00), ocupação 09–10 opaco + 10–11 transparente + 11–12 recusado + dia inteiro, agora seg 08:00 → 1 GET; POSTs na ordem Reunião(10–11), Estudar(11–12), marco, bloco 12–14; nenhum par de POSTs opacos se sobrepõe; `eventos_criados` na ordem das chamadas; 1 sugestão; `avisos` e `erros` vazios.
13. Turno sem token com 2 `agendar_evento` + 1 `criar_po_dominio` → 2 erros `motivo: "precisaConectar"`, 1 sugestão, zero `fetch`. `events.list` 401 → 2 erros `precisaConectar`, 1 GET. Turno com 2 `agendar_evento` + `sugerir_troca_squad` → 2 erros `descartado: true`, 1 sugestão de troca, zero `fetch` (regra da Fase 1 intacta com a série). Turno com um `agendar_evento` de data ilegível entre dois válidos → 1 erro sem `motivo`, os outros 2 compromissos criados (falha isolada na série).
14. Declaração de `agendar_evento` tem exatamente `titulo, responsavel_id, tipo, duracao_min, esforco_min, prazo_final, a_partir_de, inicio_fixo`. Prompt contém a janela descrita, `Você NÃO escolhe horário`, `a_partir_de`, `inicio_fixo`, `esforco_min`; não contém `com inicio e duracao_min`; modo `prazo` contém `com prazo_final e esforco_min`.
15. **HTTP** (build rodando em diretório temporário, `GEMINI_API_KEY=fake`): com `JANELA_TRABALHO=19:00-09:00`, `POST /api/orquestrar {demanda:"x"}` → 500 `configuracao: true`; log do boot menciona `JANELA_TRABALHO`.
16. `infoDePrazo`: blocos ordenados por início dão `1/2`, `2/2` com o marco; marco com 2 blocos → `{ papel: "marco", blocos: 2 }`; marco ausente → `marco: null`. `diasDoEventoDiaInteiro("2026-09-30", "2026-10-03")` → último 02/10.
17. `npx vue-tsc --noEmit` e `npm run build` passam.
