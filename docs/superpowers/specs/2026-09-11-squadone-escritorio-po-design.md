# SquadOne — Escritório que cresce, PO com capacidades

**Data:** 2026-09-11
**Status:** aprovado, pronto para implementação
**Escopo:** uso pessoal, 1 usuário, desktop. Não comercial.

---

## 1. Visão

Você digita uma demanda em português. Um PO (personagem num escritório pixel-art
top-down) recebe, quebra em 1..N eventos e cria no seu Google Calendar.

Dois eixos crescem com o tempo, e a arquitetura existe para tornar ambos baratos:

- **Eixo PO** — começa com 1. A IA sugere contratações; você aprova; o escritório
  ganha uma sala.
- **Eixo capacidade** — começa com "agendar". Depois "gerar spec", etc.

O que NÃO é: não é multi-agente hoje. É um PO com duas ferramentas.

---

## 2. Decisões e justificativas

| Decisão | Escolha | Por quê |
|---|---|---|
| Contrato com a IA | Function calling (tools), one-shot | `sugerir_contratacao` como campo JSON opcional é esquecida pelo modelo; como tool ela compete e é escolhida deliberadamente. Adicionar capacidade = +1 entrada no registry. |
| Loop agêntico | **Não.** Executa as calls e acaba. | Realimentar resultados traria gestão de histórico e risco de loop. Ganho zero no caso de uso. |
| Modelo | `gemini-3.7-flash`; fallback `gemini-2.5-flash` | O atual (`gemini-3.5-flash`) está marcado "legacy" na doc e custa 2x ($1.50/$9.00 vs $0.75/$3.75). |
| Verdade das quests | Google Calendar | Elimina sincronização duplicada. Editar/apagar no Google reflete no app. |
| Verdade do roster | `data/squad.json`, escrito pelo servidor | Contratação em runtime não cabe em arquivo commitado. |
| Auth | OAuth implícito no browser (GIS), token em memória | Sem refresh token, sem sessão no backend, sem credencial em disco. Custo: reconectar a cada ~1h. |
| Render | DOM + CSS, não canvas | 9 sprites + ~117 nós estáticos, tudo em `transform`, nada faz layout. Canvas custaria ~2 dias e ainda exigiria overlay DOM. |
| Crescimento do mapa | Grade fixa 3x3 de slots, ordem pré-definida | Máximo realista são 9 salas; packing dinâmico é over-engineering. Crescimento monótono ⇒ nada na tela se move ao desbloquear. |
| Sprites | IA gera só poses estáticas; animação derivada por script | 3 frames de caminhada gerados viram 3 pessoas diferentes. Derivar garante consistência pixel-perfeita. |
| Papéis novos | Palette-swap, zero geração | Silhueta e animação idênticas de graça. |

---

## 3. Arquitetura

### 3.1 Squad — `data/squad.json`

```json
{
  "version": 1,
  "unlockOrder": [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1],[0,2],[1,2],[2,2]],
  "members": [
    { "id":"po", "nome":"Rômulo", "papel":"PO", "escopo":"tudo",
      "sprite":"po", "slot":[0,0], "room":"ROOM_SOLO",
      "horario":{"inicio":"09:00","fim":"19:00"},
      "hiredAt":"2026-09-11T09:00:00-03:00" }
  ]
}
```

- Fora de `public/` (build sobrescreveria). Servido por `GET /api/squad`.
- Write atômico: escreve `.tmp`, depois `rename`.
- `data/` no `.gitignore`; `data/squad.seed.json` versionado, copiado se o arquivo não existir.
- `members.length` determina os slots desbloqueados. **Não** guardar "salas desbloqueadas" separado — estado duplicado diverge.

### 3.2 Capacidades (tools)

Registry `id → { declaration, handler }`.

```ts
agendar_evento(titulo, po_id, tipo: 'time_blocking'|'deadline',
               inicio?, duracao_min?, prazo_final?)
  → cria evento no Google Calendar

sugerir_contratacao(papel, justificativa, escopo)
  → NÃO executa nada; devolve proposta pra UI
```

Todo evento criado leva `extendedProperties.private.squadone = <po_id>`.
A Mochila lê com `events.list?privateExtendedProperty=squadone=*`.

Adicionar "gerar spec" depois = mais uma entrada. Nada mais muda.

### 3.3 Turno — `POST /api/orquestrar`

```
demanda + Authorization: Bearer <access_token>
  → lê data/squad.json
  → monta systemInstruction A PARTIR DO ROSTER  (ver §6, furo crítico)
  → 1 chamada Gemini, tools = capacidades habilitadas, mode AUTO
  → executa as functionCalls em paralelo, CADA UMA NO SEU try
  → { eventos_criados[], sugestoes[], erros[] }
```

**`try` por tarefa é requisito, não detalhe.** Hoje um `try` único faz uma tarefa
quebrada matar o lote inteiro.

### 3.4 Auth

```
GIS initTokenClient, scope: https://www.googleapis.com/auth/calendar.events
  → popup → access_token em memória (~1h)
  → enviado como Bearer em /api/orquestrar
  → servidor cria os eventos
```

Escopo mínimo: cria e lê eventos, não mexe em configuração de calendário.

---

## 4. Escritório

### 4.1 Sistema de tiles

```
TILE        = 32px fonte
SCALE       = 2 (padrão) | 1 (visão geral, tecla Tab)
VIEWPORT    = 960 x 640 px = 15 x 10 tiles @2x
```

`SCALE` aparece em **um** lugar: o `transform` do container `.world`. Toda a
matemática (path, câmera) roda em px-fonte.

Salas sempre 8x6 tiles, paredes compartilhadas, `pitch = [7,5]`:

```
worldTile(slot, local) = [slot.x*7 + local.x, slot.y*5 + local.y]
mapSize(N,M)           = [7N+1, 5M+1] tiles
```

| Salas | Slots | Tiles | Px @2x |
|---|---|---|---|
| 1 | 1x1 | 8x6 | 512x384 |
| 2 | 2x1 | 15x6 | 960x384 |
| 4 | 2x2 | 15x11 | 960x704 |
| 6 | 3x2 | 22x11 | 1408x704 |
| 9 | 3x3 | 22x16 | 1408x1024 |

*(aritmética verificada)*

Ordem de desbloqueio: `(0,0) (1,0) (0,1) (1,1) (2,0) (2,1) (0,2) (1,2) (2,2)`.
Monótona direita/baixo ⇒ nada que já está na tela se move.

Templates de sala em `src/office/rooms.ts` como matriz de strings
(`#` parede, `.` chão, `D` mesa, `c` cadeira, `P` planta, `▓` porta, `=` vidro).
Lida uma vez na montagem para extrair props e portas — **não** vira matriz global.

Renderização por sala: 1 div de chão (`background-repeat`) + 4 divs de parede +
~8 props ≈ **13 nós por sala**, 117 no mapa cheio.

Câmera: alvo = ator ativo, centrado, com clamp em `[0, max(0, mapa - viewport)]`;
se o mapa for menor que o viewport naquele eixo, centraliza. Suavização
`cam += (want-cam) * (1 - Math.exp(-8*dt))` — independente de framerate.

### 4.2 Movimento

**Bug atual, validado por teste em navegador:** `GameMap.vue:90` usa
`transition: grid-column-start / grid-row-start`. Medição: `getAnimations()`
retorna `[]` e a posição tem 1 valor único ao longo de 700ms. Não anima —
teleporta. O comentário nas linhas 80-84 afirma o contrário e sai junto.

Substituição: personagem sai do CSS Grid, vira `position:absolute` dentro de
`.world`, movido por `transform: translate3d()`. Um loop `requestAnimationFrame`
para todos os atores.

Três requisitos não-cosméticos:

1. `Math.round()` nas coordenadas de mundo. Sem isso, coordenada fracionária +
   `image-rendering:pixelated` + scale 2x = sprite cintila a cada frame.
2. Escrita **direta** em `el.style.transform`. Passar por `ref()` = 60
   re-renders/s do componente Vue.
3. Frame do ciclo de caminhada derivado da **distância percorrida**
   (`PINGPONG[(dist/STEP_PX)|0 % 4]`), não do relógio — senão os pés patinam.

Loop para sozinho quando ninguém anda (`raf = busy ? rAF(tick) : 0`).
Idle/working fica em CSS puro com `steps(2)`, sem gastar rAF.

Tailwind v4 não tem utility de `image-rendering`:
```css
@utility pixelated { image-rendering: pixelated; }
```

### 4.3 Pathfinding

Sem A*. BFS sobre o grafo de ≤9 slots + interpolação reta.

Válido porque toda sala é retângulo **convexo** — segmento entre dois pontos
interiores nunca sai. O único ponto côncavo do mundo é o vão da porta, resolvido
com 3 waypoints (`inner` → `center` → `outer`) que forçam travessia perpendicular.

Morre se surgirem obstáculos no meio da sala. Saída barata nesse caso: mais
waypoints autorais no template, não A*.

### 4.4 Desbloqueio de sala

```
IA sugere → card neo-brutalista "Contratar Designer?" [CONTRATAR]
  → POST /api/squad/hire {papel}
  → câmera pana ~700ms (tween existente)
  → sala materializa ~450ms
  → personagem entra pela porta e anda até a mesa (sistema existente)
  → toast "Ana entrou no squad"
```

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

---

## 5. Sprites

### 5.1 Inventário dia 1 — 7 arquivos

| Arquivo | Dim | Conteúdo |
|---|---|---|
| `char_po.png` | 96x128 | 3 poses x 4 direções. Col: 0 parado, 1 passo-esq, 2 passo-dir. Row: 0 baixo, 1 esq, 2 dir, 3 cima. Pés em y=30. |
| `tile_floor.png` | 32x32 | Piso, seamless nos 4 lados |
| `tile_wall.png` | 160x32 | canto-SE, borda-sup, canto-SD, lateral, borda-inf |
| `tile_door.png` | 64x32 | fechada, aberta |
| `prop_desk.png` | 64x48 | mesa+monitor, 16px estourando pra cima |
| `prop_chair.png` | 32x32 | |
| `prop_plant.png` | 32x48 | |

Não gerar: sombra (pseudo-elemento CSS), highlight, nameplate (DOM+Tailwind).

### 5.2 Pipeline — a ordem é obrigatória

```
chroma key magenta (na resolução ALTA)
  → despill da franja anti-aliased
  → downscale BOX (não NEAREST, não LANCZOS)
  → alpha binário (threshold 128)
  → quantize contra paleta CC0 fixa, dither=NONE
```

Quantizar antes de tirar o fundo mapeia o magenta pra paleta e destrói a chave
de cor. Dither em 32x32 vira ruído ilegível. Alpha parcial + `pixelated` a 2x
mostra pixels fantasmas nas bordas.

Implementação em Python/Pillow (`requirements.txt` já existe).

### 5.3 Consistência

O maior risco da geração por IA. Mitigações, em ordem de força:

1. **Paleta CC0 travada** (Endesga 32) citada no prompt **e** aplicada no
   quantizador. Cinto e suspensório: deriva de matiz deixa de existir.
2. **Ordem de geração ancorada:** paleta → `tile_floor` → `tile_wall` →
   `char_po` frente (**portão: se não ficar bom, não avance**) → demais direções
   usando a frente como imagem de referência → props.
3. **Frames de caminhada derivados por script**, não gerados.
4. **Papéis por palette-swap**, não gerados.

Modelo: `gemini-3.1-flash-lite-image` (~$0.034/imagem). Resolução mínima da API
é 512px — não existe saída 32x32 nativa, o downscale é obrigatório.

Custo dia 1: ~10 gerações x ~4 iterações ≈ **$1.40**. Não é fator de decisão.
Geração de imagem não tem free tier.

---

## 6. Furo crítico de integração

`server.ts:26` hardcoda `'TechLead', 'ProfissionalMaker' ou 'PessoalFamiliar'`
no `systemPrompt`.

**Contratar um QA no `squad.json` não faz a IA rotear nada pra ele.** O prompt
tem que ser derivado do roster:

```ts
const squad = await readSquad()
const roster = squad.members.map(m => `'${m.id}' (${m.papel}: ${m.escopo})`).join(', ')
```

Isso entra junto com o roster, não depois.

---

## 7. Bugs existentes que este design elimina

| Onde | Bug | Como morre |
|---|---|---|
| `server.ts:63`, `main.py:116` | `gemini-3.5-flash` — marcado "legacy", custa 2x | Troca para `gemini-3.7-flash` |
| `server.ts:100` | `endTime` usado fora do escopo onde é declarado (`const` no branch `time_blocking`) → `ReferenceError` no branch `deadline` | Reescrita do handler `agendar_evento` |
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
- Sprites fase 2 (sentado, bebedouro, café, rack, tapete, poeira)
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
| `gemini-3.1-flash-lite-image` existe | ✅ doc oficial |
| Parallel function calling suportado | ✅ doc oficial |
| Modos `auto` / `any` / `none` / `validated` | ✅ doc oficial |
| `endTime` fora de escopo | ✅ leitura do código |

**Não confirmado — tratar como hipótese, testar antes de projetar em cima:**

| Afirmação | Situação |
|---|---|
| `tools` + `responseMimeType: "application/json"` retorna **400** | ⚠️ Vem de uma issue no `python-genai`, **não** da doc oficial. A doc de function calling inclusive sugere "combine function calling with structured output". **Ação: testar com uma chamada real antes de assumir.** Se der 400, remover `responseMimeType`; se não der, manter os dois. |
| Alias `gemini-3.5-flash` retorna 404 ~68% das vezes | ⚠️ Relato de usuário em fórum, sem resposta do Google. Irrelevante na prática: a troca se justifica por preço e por ser legacy. |
| `VALIDATED` é o modo ideal para one-shot | ⚠️ Inferência. Começar com `AUTO`. **Nunca `ANY`** — forçaria `sugerir_contratacao` espúria em toda demanda. |
| Campos opcionais são ignorados por LLMs | ⚠️ Folclore, não documentado. Mitigação de qualquer jeito: `required` no que importa, default no servidor. |

---

## 10. Pré-requisitos que dependem de você

Não dá pra automatizar:

1. Google Cloud Console → habilitar **Google Calendar API** no projeto `gen-lang-client-0077848630`
2. Consent screen → adicionar escopo `.../auth/calendar.events`
3. OAuth Client → autorizar origem `http://localhost:3000`
4. Criar `.env` (não existe hoje, só `.env.example`) com `GEMINI_API_KEY=...`
5. Escolher e salvar a paleta CC0 em `scripts/palette.png`
