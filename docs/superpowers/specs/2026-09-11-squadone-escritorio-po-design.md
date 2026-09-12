# SquadOne — Escritório que cresce, PO com capacidades

**Data:** 2026-09-11 (revisada em 2026-09-12: roster em árvore, render isométrico)
**Status:** implementada; este documento reflete o código em `feat/office-renderer`
**Escopo:** uso pessoal, 1 usuário, desktop. Não comercial.

---

## 1. Visão

Você digita uma demanda em português. Um PO (personagem num escritório isométrico)
recebe, quebra em 1..N eventos e cria no seu Google Calendar.

O squad é uma **árvore**, não uma lista:

```
squad
 └── domínio            ← um tema; tem um PO dono; ocupa UMA sala do escritório
       ├── PO           ← dono do domínio
       └── integrantes  ← designer, tech lead, QA... contratados pelo PO
```

Três eixos crescem com o tempo, e a arquitetura existe para tornar todos baratos:

- **Eixo domínio** — começa com 1. Surge um tema que ninguém cobre, a IA propõe
  um domínio com PO próprio; você aprova; o escritório ganha **uma sala**.
- **Eixo integrante** — dentro de um domínio, o PO contrata papéis. O integrante
  entra **na sala do domínio**, junto com o PO. Nenhuma sala nova.
- **Eixo capacidade** — começa com "agendar". Depois "gerar spec", etc.

O que NÃO é: não é multi-agente hoje. É um PO raiz com três ferramentas.

---

## 2. Decisões e justificativas

| Decisão | Escolha | Por quê |
|---|---|---|
| Contrato com a IA | Function calling (tools), one-shot | Uma proposta de contratação como campo JSON opcional é esquecida pelo modelo; como tool ela compete e é escolhida deliberadamente. Adicionar capacidade = +1 entrada no registry. |
| Loop agêntico | **Não.** Executa as calls e acaba. | Realimentar resultados traria gestão de histórico e risco de loop. Ganho zero no caso de uso. |
| Modelo | `gemini-3.7-flash`; fallback `gemini-2.5-flash` | O atual (`gemini-3.5-flash`) está marcado "legacy" na doc e custa 2x ($1.50/$9.00 vs $0.75/$3.75). |
| Verdade das quests | Google Calendar | Elimina sincronização duplicada. Editar/apagar no Google reflete no app. |
| Verdade do roster | `data/squad.json`, escrito pelo servidor | Contratação em runtime não cabe em arquivo commitado. |
| Forma do roster | **Árvore** domínio → { po, integrantes } | Lista plana não distingue "falta um papel neste tema" de "falta um tema inteiro" — e foi exatamente isso que fez o roster v1 abrir uma sala por pessoa. |
| Níveis de crescimento | Duas tools: `criar_po_dominio` e `contratar_integrante` | Uma tool só obrigaria o modelo a decidir num campo booleano o que ele decide melhor escolhendo entre duas funções com descrições opostas. |
| Auth | OAuth implícito no browser (GIS), token em memória | Sem refresh token, sem sessão no backend, sem credencial em disco. Custo: reconectar a cada ~1h. |
| Projeção | Isométrica 2:1 (tile 32x32 → 64x32 na tela) | Decisão do PO em 11/09. Custo contido: o isométrico vive só em `toScreen()` e nas matrizes CSS; todo o resto (BFS, rotas, colisão) continua no mundo ortogonal. |
| Render | DOM + CSS, não canvas | ~18 nós por sala, tudo em `transform`, nada faz layout. Canvas custaria ~2 dias e ainda exigiria overlay DOM. |
| Crescimento do mapa | Grade fixa 3x3 de slots, ordem pré-definida | Máximo realista são 9 **domínios**; packing dinâmico é over-engineering. Crescimento monótono ⇒ nada na tela se move ao desbloquear. |
| Dono do slot | O **domínio**, nunca a pessoa | Contratar um QA não pode abrir sala: ele senta na sala do PO que o contratou. Slot por pessoa daria 9 pessoas no teto em vez de 9 temas. |
| Sprites | Arte pronta CraftPix (CC0), não geração por IA | Consistência sai de graça e o custo por papel novo é zero. Geração por IA foi avaliada (§5.4) e abandonada: 3 frames gerados viram 3 pessoas diferentes. |
| Papéis novos | Reuso de sheet + `hue-rotate` | Silhueta e animação idênticas de graça. |

---

## 3. Arquitetura

### 3.1 Squad — `data/squad.json`

O roster é uma **árvore de domínios**, não uma lista de pessoas.

```json
{
  "version": 2,
  "unlockOrder": [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1],[0,2],[1,2],[2,2]],
  "dominios": [
    {
      "id": "geral",
      "nome": "Geral",
      "escopo": "tudo que ainda não tem um domínio próprio",
      "slot": [0,0],
      "room": "ROOM_SOLO",
      "criadoEm": "2026-09-11T09:00:00-03:00",
      "po": { "id":"po", "nome":"Rômulo", "papel":"PO", "escopo":"...",
              "sprite":"wraith_01",
              "horario":{"inicio":"09:00","fim":"19:00"},
              "hiredAt":"2026-09-11T09:00:00-03:00" },
      "integrantes": [
        { "id":"qa-geral", "nome":"Bia", "papel":"QA", "escopo":"testes",
          "sprite":"wraith_03", "hiredAt":"2026-09-12T09:20:00-03:00" }
      ]
    }
  ]
}
```

Quem é dono do quê:

| Campo | Dono | Por quê |
|---|---|---|
| `slot`, `room` | **domínio** | Uma sala inteira é de um domínio. PO e integrantes dividem o mesmo slot. |
| `id` do domínio | **domínio** | É o slug e vai para `squadone_dominio` no Calendar — eixo de **filtro**. |
| `id` da pessoa | **pessoa** | Vai para `squadone_membro` — eixo de **atribuição**. |
| `sprite`, `hue` | **pessoa** | Aparência. Sem efeito no mapa. |

- Fora de `public/` (build sobrescreveria). Servido por `GET /api/squad`, que
  anexa `unlockedSlots`.
- Write atômico: escreve `.tmp`, depois `rename`.
- `data/` no `.gitignore`; `data/squad.seed.json` versionado, copiado se o
  arquivo não existir.
- **`dominios.length` determina os slots desbloqueados.** Não `members.length`:
  contar pessoas abriria uma sala ao contratar um QA. E **não** guardar "salas
  desbloqueadas" em separado — estado duplicado diverge.

**Migração v1 → v2.** O roster v1 era uma lista plana de `members`, cada um com
o seu próprio `slot` — ou seja, já era de fato um domínio de uma pessoa só.
`readSquad()` detecta `members` sem `dominios`, converte cada membro num domínio
com ele como PO e nenhum integrante, e **persiste** o resultado. O slot de cada
um é o mesmo de antes: nada se move na tela.

### 3.2 Capacidades (tools)

Registry `id → { declaration, handler }`.

```ts
agendar_evento(titulo, responsavel_id, tipo: 'time_blocking'|'deadline',
               inicio?, duracao_min?, prazo_final?)
  → cria evento no Google Calendar

criar_po_dominio(dominio, papel_po, justificativa, escopo)
  → tema que NENHUM domínio cobre. Sala nova + PO novo.
  → NÃO executa nada; devolve proposta pra UI

contratar_integrante(dominio_id, papel, justificativa, escopo)
  → tema já tem dono, falta um PAPEL dentro dele. Mesma sala.
  → NÃO executa nada; devolve proposta pra UI
```

**Por que duas tools e não uma `sugerir_contratacao(papel)`.** A decisão que
importa não é "contratar alguém", é *em que nível*: abrir um tema novo ou
reforçar um que já existe. Com uma tool só, esse nível vira um campo — e um
campo opcional é exatamente o que o modelo ignora (§2, primeira linha). Com duas
funções de descrições opostas, ele escolhe entre elas, e cada uma valida o que
lhe cabe:

- `criar_po_dominio` rejeita domínio cujo slug já existe (dois domínios com o
  mesmo slug misturariam os eventos dos dois no Calendar) e rejeita o 10º
  domínio, porque não há slot. A proposta devolve o `slot` onde a sala nasceria.
- `contratar_integrante` rejeita `dominio_id` fora da árvore, e a mensagem de
  erro aponta a outra tool. O erro sai no `erros[]` do turno (um `try` por
  tarefa, §3.3): o lote sobrevive e o usuário lê o que falhou.

Nenhuma das duas escreve no roster: a contratação é decisão do usuário, no card
de aprovação (§4.4). O endpoint que aplica a aprovação ainda não existe (§8).

**`responsavel_id`, não `po_id`.** O responsável por um evento pode ser um
integrante; só existe um campo porque o domínio é **derivado** da pessoa — ela
pertence a exatamente um. Passar domínio junto abriria espaço para o modelo
mandar um par inconsistente.

Todo evento criado leva **duas** chaves em `extendedProperties.private`:

- `squadone_dominio = <id do domínio da pessoa>` — eixo de **filtro**.
- `squadone_membro = <id da pessoa>` — eixo de **atribuição**.

A hierarquia é literalmente isso: o domínio filtra, a pessoa atribui.

`events.list` só casa `privateExtendedProperty=chave=valor` **exato**: não
existe wildcard (`squadone=*` não funciona). Por isso o filtro tem que cair
sobre um valor estável e de baixa cardinalidade — o domínio — enquanto o
responsável, que muda sem mudar o domínio, fica na segunda chave. Com uma
chave só os dois eixos colidiriam.

A Mochila (`GET /api/mochila`) faz um `events.list` por domínio do roster
(`privateExtendedProperty=squadone_dominio=<dom>`; repetir o parâmetro seria
AND, não OR), cada um no seu `try`, e devolve `{ quests, erros }`. São
`dominios.length` chamadas — não uma por pessoa.

`colorId` é por **domínio**: no calendário a sala é a unidade que se lê de
relance.

Adicionar "gerar spec" depois = mais uma entrada. Nada mais muda.

### 3.3 Turno — `POST /api/orquestrar`

```
demanda + Authorization: Bearer <access_token>
  → lê data/squad.json
  → monta systemInstruction A PARTIR DA ÁRVORE DO ROSTER  (ver §6)
  → 1 chamada Gemini, tools = capacidades habilitadas, mode AUTO
  → executa as functionCalls em paralelo, CADA UMA NO SEU try
  → { eventos_criados[], sugestoes[], erros[] }
```

**`try` por tarefa é requisito, não detalhe.** Hoje um `try` único faz uma tarefa
quebrada matar o lote inteiro.

### 3.4 Auth

```
GIS initTokenClient, scope: https://www.googleapis.com/auth/calendar.events
  → popup → access_token em memória (~1h)   src/auth/google.ts
  → enviado como Bearer em /api/orquestrar E em /api/mochila
  → servidor cria e lê os eventos
```

Escopo mínimo: cria e lê eventos, não mexe em configuração de calendário. O
mesmo token serve para os dois sentidos — não há um segundo escopo de leitura.

O token vive em memória e **só** em memória: sem refresh token, sem sessão no
backend, sem credencial em disco. Persistir o `access_token` em `localStorage`
trocaria exatamente a propriedade que justifica este desenho. Custo aceito:
reconectar a cada ~1h e a cada reload.

Três detalhes que não são cosméticos:

1. **Tentativa silenciosa no mount** (`prompt: ''`): só devolve token se o
   usuário já consentiu neste browser. Se o Google recusar, nada abre — o botão
   Conectar, que é gesto do usuário, é que pode abrir popup. Popup sem gesto é
   bloqueado pelo navegador.
2. **O turno pede o token ANTES de chamar o Gemini.** Pedir depois gastaria uma
   chamada de modelo para descobrir, no handler, que não há credencial.
3. **401 do Google não pode virar lista vazia.** Se todo domínio falha em
   401/403, `/api/mochila` responde 401 em vez de `{ quests: [] }` — senão a UI
   diria "nenhuma quest" quando o problema é a credencial. No frontend o 401
   derruba o estado de conectado e o botão Conectar reaparece.

Margem de renovação de 60s: um token que expira em voo vira 401 no meio do turno.

---

## 4. Escritório

### 4.1 Sistema de tiles e projeção

```
TILE        = 32px fonte (mundo ortogonal)
TILE_W/H    = 64x32 px  (losango isométrico 2:1, na tela)
WALL_H      = 40px de tela
SCALE       = 1 (padrão) | 2 (tecla Tab)
```

Duas malhas de coordenadas, de propósito:

| malha | quem vive nela |
|---|---|
| **mundo**, ortogonal, tile 32px | templates, BFS, rotas, colisão, câmera |
| **tela**, isométrica 2:1 | só a pintura — saída de `toScreen()` |

Trocar a projeção é trocar `toScreen()` e as matrizes CSS de `rooms.ts`. Nenhuma
lógica de caminho conhece o isométrico. `SCALE` aparece em **um** lugar: o
`transform` do container `.world`.

**Uma sala = um domínio** (§3.1). Salas sempre 8x6 tiles, paredes compartilhadas,
`pitch = [7,5]`:

```
worldTile(slot, local) = [slot.x*7 + local.x, slot.y*5 + local.y]
mapSize(N,M)           = [7N+1, 5M+1] tiles
```

| Domínios | Slots | Tiles |
|---|---|---|
| 1 | 1x1 | 8x6 |
| 2 | 2x1 | 15x6 |
| 4 | 2x2 | 15x11 |
| 6 | 3x2 | 22x11 |
| 9 | 3x3 | 22x16 |

*(aritmética verificada)*

Ordem de desbloqueio: `(0,0) (1,0) (0,1) (1,1) (2,0) (2,1) (0,2) (1,2) (2,2)`.
Monótona direita/baixo ⇒ nada que já está na tela se move.

Templates de sala em `src/office/rooms.ts` como matriz de strings
(`#` parede, `.` chão, `D` mesa, `c` cadeira, `P` planta, `▓` porta, `=` vidro).
Lida uma vez na montagem para extrair props e portas — **não** vira matriz global.

**Postos de trabalho são vários por sala**, um por cadeira `c` do template, na
ordem da árvore: PO primeiro, integrantes na sequência. Domínio com mais gente
que cadeira espalha o excedente por `EXTRA_STATIONS`, tiles do miolo do
retângulo convexo — a alternativa seria empilhar duas pessoas no mesmo pixel.

Renderização por sala: 1 div de base + 1 de chão + até 10 tiles de parede +
props + a placa ≈ **~18 nós por sala**. Duas camadas: `.ground` leva a matriz
isométrica e desenha os retângulos de chão; `.objects` fica sem skew e recebe
paredes, props e atores já projetados, ordenados por `z-index` = diagonal do
mundo (algoritmo do pintor). Só as paredes de trás (norte e oeste) são
desenhadas — as da frente esconderiam a sala — e **um tile de parede por div**,
porque a profundidade de uma parede longa não cabe num único z-index. O vão da
porta é simplesmente o tile que não existe.

A placa da sala nomeia o **domínio**, não uma pessoa, e é UI: não entra no
algoritmo do pintor, senão o ator da própria sala a cobriria.

Câmera: alvo = ator ativo, centrado, com clamp na caixa isométrica do mapa; se o
mapa for menor que o viewport naquele eixo, centraliza. Suavização
`cam += (want-cam) * (1 - Math.exp(-8*dt))` — independente de framerate.

### 4.2 Movimento

**Bug eliminado, validado por teste em navegador:** a versão antiga usava
`transition: grid-column-start / grid-row-start`. Medição: `getAnimations()`
retornava `[]` e a posição tinha 1 valor único ao longo de 700ms. Não animava —
teleportava.

Substituição: o personagem sai do CSS Grid, vira `position:absolute` dentro de
`.world`, movido por `transform: translate3d()`. Um loop `requestAnimationFrame`
para todos os atores e para a câmera.

Três requisitos não-cosméticos:

1. `Math.round()` antes de virar px — aqui, nas coordenadas de **tela**, que são
   as que viram px. Sem isso, coordenada fracionária + `image-rendering:pixelated`
   + scale 2x = sprite cintila a cada frame.
2. Escrita **direta** em `el.style.transform`. Passar por `ref()` = 60
   re-renders/s do componente Vue.
3. Frame do ciclo de caminhada derivado da **distância percorrida**
   (`(dist/STEP_PX)|0 % frames`), não do relógio — senão os pés patinam.

O sprite é um **billboard**: sempre de frente, espelhado com `scaleX(-1)`
conforme o sinal de `dx` **na tela**. A arte do CraftPix só tem a vista frontal
(§5), então não existem 4 direções para escolher.

Loop para sozinho quando ninguém anda (`raf = busy ? rAF(tick) : 0`).
Idle fica em CSS puro com `steps(frames)`, sem gastar rAF.

Tailwind v4 não tem utility de `image-rendering`:
```css
@utility pixelated { image-rendering: pixelated; }
```

### 4.3 Pathfinding

Sem A*. BFS sobre o grafo de ≤9 slots + interpolação reta, **tudo no mundo
ortogonal**.

Válido porque toda sala é retângulo **convexo** — segmento entre dois pontos
interiores nunca sai. O único ponto côncavo do mundo é o vão da porta, resolvido
com 3 waypoints (`inner` → `center` → `outer`) que forçam travessia perpendicular.

Morre se surgirem obstáculos no meio da sala. Saída barata nesse caso: mais
waypoints autorais no template, não A*. (É também por isso que `EXTRA_STATIONS`
fica no miolo limpo: posto de trabalho não pode virar obstáculo.)

Visitar alguém é ir ao **domínio** dele: quem anda é o PO raiz, e o destino é o
slot do domínio da pessoa ativa, não uma coordenada pessoal.

### 4.4 Crescimento do escritório

```
IA propõe → card neo-brutalista (GrowthCard.vue, vocabulário da Mochila)
  · criar_po_dominio     → "Abrir domínio Financeiro?"  → sala NOVA
  · contratar_integrante → "Contratar QA em Produto?"   → MESMA sala, + 1 ator
  → [APROVAR]  (+ nome opcional: o modelo propõe o papel, não a pessoa)
  → POST /api/squad/hire  → server/hire.ts escreve o roster
  → resposta traz o squad inteiro; trocar `squad.value` é o único gatilho
    que o escritório precisa
```

O endpoint é o **único** lugar que escreve o roster, e revalida tudo contra o
`squad.json` atual — nunca contra o que a proposta afirma. O slot, em especial,
sai de `proximoSlot()` na hora do APROVAR: a proposta pode ter sido feita antes
de outro domínio ocupar aquele slot. Erro de forma → 400; proposta que não cabe
mais no roster (domínio duplicado, escritório cheio) → 409, e o card mostra a
mensagem em vez de sumir.

Toda escrita passa por `atualizarSquad()`, que serializa read-modify-write: duas
aprovações quase simultâneas leriam o mesmo arquivo e a segunda apagaria a
primeira.

Só o primeiro caso mexe no mapa:

```
câmera pana 700ms (tween existente; a sala já conta para o mapa, invisível)
  → sala materializa 450ms
  → personagem entra pela porta e anda até a mesa (sistema existente)
  → toast "Ana entrou no squad"
```

Os três tempos são sequenciais de propósito: a sala não pode nascer fora do
enquadramento, nem o ator andar dentro de uma sala invisível. Enquanto a câmera
pana não existe ator para seguir — ela persegue um ponto de mundo (`lookPoint`,
o miolo do slot novo) e só volta a seguir um ator quando alguém entra.

Único código novo, ~12 linhas:
```css
@keyframes room-build {
  0%   { clip-path: inset(50% 50% 50% 50%); filter: brightness(4); }
  60%  { clip-path: inset(0 0 0 0);          filter: brightness(4); }
  100% { clip-path: inset(0 0 0 0);          filter: brightness(1); }
}
.room--new { animation: room-build 450ms steps(6, end) both; }
```
`steps(6)` faz a sala abrir em saltos discretos, coerente com pixel art.

Paredes, props e placa **não** podem usar esse keyframe: `clip-path` recorta
pela caixa do elemento, e o wrapper de objetos não tem caixa própria (os filhos
são todos `position: absolute`). Eles entram com `room-build-objects`, o mesmo
flash um degrau depois do chão terminar de abrir.

Contratar um integrante não anima sala nenhuma: aparece mais um ator na sala que
já estava lá — mas ele também **entra pela porta**, não aparece sentado. A rota
de chegada nasce fora da sala e reusa os waypoints perpendiculares de §4.3
(a porta é o único ponto côncavo do mundo; entrar em diagonal atravessaria a
parede). Origem é a primeira sala vizinha já desbloqueada; um domínio isolado
recebe pela porta sul, vinda de fora do mapa.

Quem já estava no roster quando o app abriu começa sentado: o primeiro roster
que chega não é crescimento, o escritório já existia antes do app.

---

## 5. Sprites

### 5.1 Arte: CraftPix, não geração por IA

Personagens vêm do pacote gratuito CraftPix já em `assets/craftpix/`
(`public/sprites/CREDITS.md` guarda a atribuição). É arte **vetorial com
contorno grosso**, não pixel art.

| Arquivo | Conteúdo |
|---|---|
| `public/sprites/<char>_idle.png` | strip horizontal, 12 frames |
| `public/sprites/<char>_walk.png` | strip horizontal, 12 frames |
| `public/sprites/craftpix.manifest.json` | `{ chars: { <char>: { frameW, frameH, anims } } }` |

Três personagens no pacote para N papéis: o excedente reusa um sheet com
`hue-rotate` (o campo `hue` da pessoa no roster).

Chão e paredes são CSS chapado; props são emoji. Coerente com o contorno grosso
da arte, e custo zero.

Não existe sprite para: sombra (pseudo-elemento CSS), highlight, nameplate
(DOM+Tailwind).

### 5.2 Pipeline — `scripts/craftpix-sheets.py`

```bash
python scripts/craftpix-sheets.py --height 64
# assets/craftpix/PNG/<Char>/PNG Sequences/{Idle,Walking}
#   -> public/sprites/<char>_{idle,walk}.png + craftpix.manifest.json
```

Duas regras que não são detalhe:

1. **Recorte pelo bbox de UNIÃO** de todos os frames do personagem, nunca o bbox
   de cada frame — senão o personagem pula de posição a cada troca de frame.
2. **LANCZOS e alpha preservado.** Nada de quantizar contra paleta, nada de
   alpha binário, nada de dither: a arte é vetorial e esses passos destroem o
   contorno.

### 5.3 Consistência

Sai de graça: os frames vêm todos do mesmo pacote, desenhados pela mesma mão.
Papel novo custa zero — reusa sheet e troca o matiz.

### 5.4 O que foi abandonado (e por quê fica registrado)

A versão original desta spec gerava pixel art 32x32 por IA:
`gemini-3.1-flash-lite-image`, paleta CC0 Endesga 32 travada no prompt **e** no
quantizador, ordem de geração ancorada, frames de caminhada derivados por script,
pipeline `chroma key → despill → downscale BOX → alpha binário → quantize`.
`scripts/gen-sprites.ts` e `scripts/spritify.py` são o resto disso.

Motivo do abandono: decisão do PO em 11/09/2026 por isométrico + arte CraftPix
pronta. O maior risco daquele caminho — 3 frames gerados virarem 3 pessoas
diferentes — deixa de existir quando a arte já vem consistente. Os scripts
continuam válidos **só** para props e tiles, se um dia a decisão for ter
mobília em pixel art.

---

## 6. O prompt sai da árvore do roster

O furo original: `server.ts` hardcodava `'TechLead', 'ProfissionalMaker' ou
'PessoalFamiliar'` no `systemPrompt`. Contratar alguém no `squad.json` não fazia
a IA rotear nada pra ele.

A correção não é só "derive do roster" — é **derive a árvore**, porque a
hierarquia é o que faz o modelo escolher entre as três tools:

```ts
const squad = await readSquad()
const arvore = rosterTree(squad)   // server/squad.ts
```

```
- domínio 'produto' — Produto (escopo: app, roadmap, releases)
    PO: 'po-produto' Ana (PO Produto: prioridade e escopo)
    integrante: 'tl-produto' João (Tech Lead: arquitetura e código)
    integrante: 'qa-produto' Bia (QA: testes e regressão)
```

Uma lista plana de pessoas apagaria exatamente a distinção de que as tools
dependem:

| O que o modelo precisa decidir | O que a árvore dá |
|---|---|
| `agendar_evento`: quem é o responsável | pessoas, e sob qual domínio cada uma está |
| `contratar_integrante`: onde | os `dominio_id` válidos |
| `criar_po_dominio`: se cabe | a evidência de que **nenhum** ramo cobre o tema |

Isso entra junto com o roster, não depois.

---

## 7. Bugs existentes que este design elimina

| Onde | Bug | Como morre |
|---|---|---|
| `server.ts:63`, `main.py:116` | `gemini-3.5-flash` — marcado "legacy", custa 2x | Troca para `gemini-3.7-flash` |
| `server.ts:100` | `endTime` usado fora do escopo onde é declarado (`const` no branch `time_blocking`) → `ReferenceError` no branch `deadline` | Reescrita do handler `agendar_evento` |
| `data/squad.json` v1 | Lista plana: um slot por PESSOA. Contratar um QA abriria uma sala, e o teto do escritório virava 9 pessoas em vez de 9 temas | Roster em árvore (§3.1) + migração automática v1→v2 |
| `server.ts:85-113` | `try` único: uma tarefa quebrada mata o lote | `try` por tarefa |
| `App.vue:21` | Nunca manda `Authorization` → integração de calendário é código morto | GIS token client |
| `GameMap.vue:90` | `transition` em propriedade não-interpolável | `translate3d` + rAF |
| `main.py` | Implementação paralela morta, nunca executada | Deletar (ou reaproveitar só o pipeline de sprites) |
| `src/*.vue` | `<script setup>` sem `lang="ts"` num projeto TS | Adicionar ao reescrever |
| `package.json` | `"lint": "tsc --noEmit"` não checa `.vue` | Trocar por `vue-tsc` |

---

## 8. Fora do escopo do MVP

Explicitamente adiado, para não inflar:

- Refresh token / sessão persistente de OAuth
- Capacidade "gerar spec" (o seam existe; a implementação não)
- Salas além das 9; sala de reunião envidraçada
- Sprites fase 2: props e mobília ainda são emoji; sem sombra projetada real,
  sem oclusão de ator atrás de parede alta. Animações do pacote ainda não usadas
  (`Attacking`, `Casting Spells`, `Taunt`, `Hurt`, `Dying`) são candidatas a
  estado "trabalhando" e "erro".
- Templates com mais cadeiras: só `ROOM_DEV` tem duas, então um domínio com 3+
  pessoas manda o excedente para `EXTRA_STATIONS`. `salaPara()` promove
  `ROOM_SOLO → ROOM_DEV` na segunda contratação e para por aí.
- Desfazer uma contratação pela UI (o roster é um arquivo; dá para editar).
- Mobile / responsivo
- Testes automatizados (avaliar depois que a mecânica estabilizar)
- Firestore / sync entre dispositivos

---

## 9. Estado de validação das afirmações

Verificado nesta sessão:

| Afirmação | Status |
|---|---|
| `@google/genai` resolve para **2.22.0** (não 2.4) | ✅ confirmado em `bun.lock` |
| Aritmética da grade de salas e do viewport | ✅ conferida |
| `transition: grid-column-start` não anima | ✅ **medido em navegador**: `getAnimations()` = `[]`, 1 posição única em 700ms |
| `gemini-3.7-flash` existe e é estável; `gemini-3.5-flash` é "legacy" | ✅ doc oficial |
| `gemini-3.1-flash-lite-image` existe | ✅ doc oficial — histórico: a geração de sprites foi abandonada (§5.4) |
| Parallel function calling suportado | ✅ doc oficial |
| Modos `auto` / `any` / `none` / `validated` | ✅ doc oficial |
| `endTime` fora de escopo | ✅ leitura do código |
| Sequência pan → build → entrada roda na ordem | ✅ **medida no navegador**: `room--pending` em 0ms, `room--new` em ~700ms, ator visível andando em ~1150ms |
| `POST /api/squad/hire` serializa escritas concorrentes | ✅ duas aprovações em paralelo → slots `1,0` e `1,1`, nenhuma perdida |
| Escritório cheio devolve 409 e o card mostra o erro | ✅ medido com 9 domínios |

**Não confirmado — tratar como hipótese, testar antes de projetar em cima:**

| Afirmação | Situação |
|---|---|
| `tools` + `responseMimeType: "application/json"` retorna **400** | ⚠️ Vem de uma issue no `python-genai`, **não** da doc oficial. A doc de function calling inclusive sugere "combine function calling with structured output". **Ação: testar com uma chamada real antes de assumir.** Se der 400, remover `responseMimeType`; se não der, manter os dois. |
| Alias `gemini-3.5-flash` retorna 404 ~68% das vezes | ⚠️ Relato de usuário em fórum, sem resposta do Google. Irrelevante na prática: a troca se justifica por preço e por ser legacy. |
| `VALIDATED` é o modo ideal para one-shot | ⚠️ Inferência. Começar com `AUTO`. **Nunca `ANY`** — forçaria uma proposta de crescimento espúria em toda demanda. |
| Campos opcionais são ignorados por LLMs | ⚠️ Folclore, não documentado. Mitigação de qualquer jeito: `required` no que importa, default no servidor — e o nível de crescimento virou duas tools em vez de um campo (§3.2). |
| O modelo escolhe certo entre `criar_po_dominio` e `contratar_integrante` | ⚠️ Não medido com chamada real. Os handlers validam e devolvem erro acionável apontando a outra tool, então errar custa uma mensagem, não um roster corrompido. |

---

## 10. Pré-requisitos que dependem de você

Não dá pra automatizar:

1. Google Cloud Console → habilitar **Google Calendar API** no projeto `gen-lang-client-0077848630`
2. Consent screen → adicionar escopo `.../auth/calendar.events`
3. OAuth Client → autorizar origem `http://localhost:3000`
4. Criar `.env` (não existe hoje, só `.env.example`) com `GEMINI_API_KEY=...`
5. ~~Escolher e salvar a paleta CC0 em `scripts/palette.png`~~ — morto: a arte
   vem pronta do CraftPix (§5.1), não há mais quantização contra paleta.
