# SquadOne

Escritório isométrico onde um squad de agentes de IA recebe demandas em linguagem natural e as transforma em eventos no Google Calendar. Uso pessoal, um usuário só.

## Comandos

```bash
npm run dev      # tsx server.ts — Express + Vite em middleware mode, porta 3000
npm run build    # vite build + esbuild do server para dist/server.cjs
npm start        # node dist/server.cjs — o que roda em produção
npx vue-tsc --noEmit   # typecheck (o script `lint` chama isto)
```

Não existe suíte de testes. Verificação é typecheck + build + exercitar a rota.

## Protocolo de contexto

Antes de vasculhar código, use o grafo em `graphify-out/`:

```bash
graphify query "<pergunta>"        # subgrafo escopado, bem menor que grep
graphify path "<A>" "<B>"          # relação entre dois símbolos
graphify explain "<conceito>"
```

`graphify-out/GRAPH_REPORT.md` só para revisão ampla de arquitetura. Depois de mexer no código, `graphify update .`.

## Arquitetura

Um processo Express serve a API e a SPA Vue. Sem banco.

```
server.ts                 Express: monta o porteiro, as rotas e o Vite/estáticos
  server/acesso.ts        porteiro de IP (403 antes de qualquer rota)
  server/auth-store.ts    credencial do Google: code flow, refresh, cifra em disco
  server/squad.ts         roster em árvore; única fonte de verdade do squad
  server/hire.ts          aplica uma contratação aprovada ao roster
  server/orchestrator.ts  um turno: demanda -> 1 chamada ao Gemini -> capacidades
  server/capabilities.ts  as capacidades que o modelo pode invocar
  server/calendar.ts      leitura/escrita no Google Calendar
src/App.vue               orquestra a tela; dono do estado de squad e quests
  src/auth/google.ts      invólucro fino sobre /api/auth/*
  src/components/         GameMap, CommandBar, QuestBackpack, GrowthCard
  src/office/             geometria isométrica, salas, sprites
seed/squad.seed.json      roster inicial — FORA de data/, ver "Volume" abaixo
data/                     volume em produção; nada aqui é versionado
```

### Três invariantes que o código assume

**1. O roster é uma árvore, não uma lista.** `squad → domínio → { po, integrantes }`. Uma sala do escritório = um domínio inteiro. Contratar um integrante entra na sala existente; criar um domínio consome o próximo slot de `unlockOrder`. Máximo 9 domínios (grade 3x3).

**2. O roster é o prompt.** A árvore inteira vai literal para o `systemInstruction` em `orchestrator.ts`. Não existe "treinamento do agente" guardado em outro lugar: `papel` + `escopo` de cada `Pessoa` *são* o treino. Persistir o roster já persiste os agentes.

**3. As quests vivem no Google Calendar, não aqui.** `GET /api/mochila` lê do Google a cada chamada. Editar ou apagar no Google reflete na próxima leitura. `quests` no frontend é cache da última resposta, nunca fonte de verdade.

### Escrita no roster

Toda mutação passa por `atualizarSquad()`, que serializa read-modify-write numa fila. Duas aprovações quase simultâneas leriam o mesmo `squad.json` e a segunda apagaria a primeira. `writeSquad` grava num `.tmp` e renomeia por cima — crash no meio deixa o `.tmp` pela metade, nunca o `squad.json`.

## Persistência

Volume Docker do Easypanel montado em `/app/data`. Dois arquivos, ~1KB somados:

| Arquivo | Conteúdo |
|---|---|
| `data/squad.json` | árvore do roster = os agentes com seu treino |
| `data/google-auth.json` | `refresh_token` cifrado em AES-256-GCM |

**A seed não pode morar em `data/`.** Um volume novo sobe vazio e sombreia o que a imagem tinha naquele caminho. Por isso `seed/squad.seed.json` fica fora do mount; `SEED_PATHS` em `squad.ts` ainda tenta o caminho antigo para não quebrar checkout velho.

Sem banco de propósito: dois blobs de 1KB não justificam Postgres, e o escopo da V1 é explicitamente só estes dois.

## Autenticação

**O browser não vê token do Google.** O servidor conduz o authorization code flow:

```
/api/auth/google    -> redireciona para o consentimento (access_type=offline, prompt=consent)
/api/auth/callback  -> troca o code, grava o refresh cifrado, volta para /?auth=ok
/api/auth/status    -> { conectado: bool }
/api/auth/logout    -> apaga o arquivo e revoga no Google
```

`tokenValido()` devolve um access_token, renovando pelo refresh quando preciso. Lança `PrecisaConectar` (vira 401 + `precisaConectar: true`) quando não há credencial ou o Google respondeu `invalid_grant` — o único caso em que a UI deve pedir gesto do usuário, e o único em que `data/google-auth.json` é apagado. `ErroDeConfig` vira 500 + `configuracao: true`: é ambiente (env faltando, `invalid_client`), nenhum clique conserta. `GoogleIndisponivel` (rede, timeout de 10s, 5xx, 429) vira 503 + `transitorio: true` e não toca na credencial. Refreshes simultâneos compartilham a mesma Promise.

`prompt=consent` é obrigatório. Sem ele o Google omite o `refresh_token` quando já houve consentimento antes, e a credencial nasce sem como se renovar.

### O prazo de 7 dias (resolvido em 12/09/2026)

Em **Externo + Testando** o Google expirava o refresh_token em **7 dias**. Política do Google, não bug. O app foi **publicado (Em produção)** em 12/09/2026 e o prazo caiu. O código não muda em nenhum dos dois casos.

Para publicar, o Google exigia os três links da página Branding preenchidos — sem eles o botão **Publicar app** fica desabilitado com *"you must complete your configuration on the Branding page"*. Os três apontam para a raiz do app (`https://aladdin-squadone-app.jicnzg.easypanel.host/`), o que basta porque o app segue **não verificado**:

- consentimento mostra a tela "o Google não verificou este app" — clicar em *Avançado* passa;
- teto vitalício de 100 usuários concedendo permissão. Um usuário, irrelevante.

**Não subir logotipo.** Logo, mais de 10 domínios autorizados, ou escopo restrito forçam enviar o app para verificação — aí os links precisariam ser páginas reais e acessíveis, e o porteiro de IP bloqueia o rastreador do Google.

Status em console.cloud.google.com/auth/audience (projeto `gen-lang-client-0086006291`); o botão de lá agora é **Voltar para o teste**, que reverte.

### Porteiro de IP

Substitui login. `IPS_PERMITIDOS` (lista por vírgula) é checada antes de qualquer rota, inclusive estáticos. Vazia **desliga** o porteiro — default em dev. Em produção o IP real vem do primeiro item de `X-Forwarded-For`, porque o Traefik é o único caminho até o container.

Perdeu o acesso porque o IP residencial mudou: esvaziar `IPS_PERMITIDOS` no Easypanel e implantar.

## Variáveis de ambiente

| Var | Onde | Para quê |
|---|---|---|
| `GEMINI_API_KEY` | servidor | chamadas ao Gemini |
| `VITE_GOOGLE_CLIENT_ID` | **build + servidor** | OAuth client; o servidor lê a mesma var |
| `GOOGLE_CLIENT_SECRET` | servidor | code flow. **Nunca prefixar com `VITE_`** |
| `TOKEN_ENC_KEY` | servidor | 32 bytes base64; cifra o refresh_token |
| `IPS_PERMITIDOS` | servidor | allowlist; vazia desliga |
| `APP_URL` | servidor | monta o `redirect_uri` |
| `NODE_ENV` | servidor | `production` serve `dist/` em vez do Vite |

`VITE_*` é embutida no bundle no `vite build`, **não lida em runtime**. Mudar o client ID exige rebuild. Uma string qualquer passa por `if (!CLIENT_ID)` e o Google recusa sem erro legível — por isso há validação de formato.

## Deploy

Easypanel, projeto `aladdin`, app `squadone-app`, em `https://aladdin-squadone-app.jicnzg.easypanel.host`. Nixpacks a partir do GitHub (`romulosutil/SquadOne`, branch `main`). Push em `main` não implanta sozinho: é preciso clicar **Implantar** no painel.

## Convenções

- Comentários e identificadores em **português**. Comentário explica *por quê*, não *o quê* — a maioria dos blocos aqui documenta a decisão e o que aconteceria sem ela.
- Erros carregam classificação, não só mensagem: `ErroDeDominio.credencial`, `ConflitoDeRoster` (409 vs 400), `PrecisaConectar` vs `ErroDeConfig`. A UI decide o que fazer pelo tipo.
- Falha de uma parte não derruba o resto: um domínio com erro no Calendar não zera a Mochila inteira; um turno sem credencial ainda roda as capacidades que não tocam o Google.
- Ao terminar tarefa: `git commit` + `git push` + `graphify update .`.
