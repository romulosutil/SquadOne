# Checkpoint — Passos no Google Tasks

Plano de tarefas: `docs/superpowers/plans/2026-09-14-passos-google-tasks.tasks.md` (11 tarefas, commit dd0e6bd).

## C1 — Google Cloud Console (14/09/2026, via Claude in Chrome)

Conta: sutil.romulo@gmail.com (e-mail de suporte/contato do projeto). Projeto `gen-lang-client-0086006291` ("squadOne").

| Passo | Antes | Depois |
|---|---|---|
| 1. Google Tasks API | desativada (botão "Ativar") | **Ativada** (status "Ativado" em `apis/api/tasks.googleapis.com`) |
| 2. Acesso a dados (escopos) | **nenhum escopo declarado** (nem `calendar.events`) | **inalterado** — ver divergência abaixo |
| 3. Público-alvo | Em produção, Externo, 1/100 usuários | inalterado (só leitura) |
| 4. Branding | sem logotipo | inalterado (só leitura) |
| extra: client "SquadOne Web" | redirect URIs: produção + `http://localhost:3000/api/auth/callback` | inalterado (só leitura) |

**Divergência do passo 2:** o prompt supunha `calendar.events` já listado em Acesso a dados; a lista está vazia e o Calendar funciona mesmo assim (app não verificado pede os escopos em runtime). A página avisa que escopos confidenciais adicionados exigem enviar o app para verificação — o que o prompt proíbe. Decisão: **não declarar** `tasks` (consistente com o Calendar hoje). Se o consentimento em dev (C2) recusar o escopo não declarado, revisitar.

## Fases

- [x] Fase A — Tasks 1–2 (92dd7f0 `server/passos.ts` + testes; c8e3634 `server/tasks.ts` + `ErroTasks` + `comToken` generalizado)
- [x] Fase B (código) — Tasks 3–5 (c9bd665 escopos no auth-store; f5de982 status/callback; 24fe18e chip + toast com ação). Verificação em dev junto com os cenários, depois da Fase C.
- [x] Fase C — Tasks 6–10 (a752f59 tasksListaId; 70bca6a chaves do vínculo; 4ba0797 passos-no-google; e3459f4 ligação no turno + prompt; 3046ec5 toast)
- [x] Fase D — Task 11 (6e32a11 CLAUDE.md)
- [x] Verificação em dev (cenários 1–9) — ver abaixo
- [x] C4 limpeza
- [x] Revisão final do branch (opus): pronto para merge, 0 Critical/Important. Corrigidos 2 textos de retorno da autorização (d717d82). Ficaram de propósito: outros avisos do Tasks ainda usam `alert()` (convenção atual), contagem "cerca de N + 4" não conta o PATCH de restauração, e os minors de teste listados no ledger.
- [x] commit + push + graphify update

## Verificação em dev (14/09/2026, conta real, `npm run dev` na 3000)

Consentimento: a 1ª ida a `/api/auth/google` concedeu os dois escopos sem mostrar caixas (conta já tinha concedido). Para os cenários 1 e 8, a URL de consentimento foi montada à mão (mesmo `state` do servidor, um escopo só, sem `include_granted_scopes`), o que reproduz fielmente o `scope` que o Google devolveria com uma caixa desmarcada.

| # | Resultado |
|---|---|
| 1 | ✅ credencial só Calendar (`tasks:false`): eventos criados, aviso `ampliarAcesso`, `squad.json` sem `tasksListaId`; Mochila leu as quests normalmente |
| 2 | ✅ chip "Autorizar Google Tasks" → consentimento → `tasks:true`, sem logout, Mochila intacta |
| 3 | ✅ lista `SquadOne · Pessoal` criada, `tasksListaId` gravado; mãe com `due` = dia local (18/09 e 17/09), 3 subtarefas na ordem, sem `due`; notas = htmlLink + `squadone_evento=`; marco com `squadone_tasks_lista`/`_pai`; blocos sem as chaves; `passos: 3` no evento principal |
| 4 | ✅ "foca 1h em revisar o contrato": sem `passos`, evento sem chaves de Tasks |
| 5 | ✅ duas demandas com passos em paralelo numa squad sem lista → **uma** lista só |
| 6 | ✅ (com "ok" do usuário) lista `ZGs5…` apagada pela API → turno "planejar as compras do mês" criou lista nova `c0FZM2I5SkU1dFMxX1pQeQ` e sobrescreveu `tasksListaId`; conferido visualmente em tasks.google.com (mãe com link e chip "Amanhã", 2 subtarefas aninhadas na ordem) |
| 7 | ✅ foco com passos, Ajuste 60→90 min: HTTP 200, `squadone_tasks_*` preservadas |
| 8 | ✅ consentimento sem Calendar: sha256 de `data/google-auth.json` idêntico antes/depois, status continua `tasks:true`, toast "o Calendar foi desmarcado na autorização, então nada mudou…" |
| 9 | coberto pelo teste puro (`dueDaTarefa` 22:30 SP); não marcado na API real para não criar evento fora da janela |

Observação: o modelo reordenou os itens do cenário 3 ("dados" antes de "slides"), coerente com a regra "em ordem de execução".

### Criado pelos testes (para C4)

Lista Tasks: `ZGs5TndRUnZ2OFhDOVlQYQ` "SquadOne · Pessoal" — mães `NXRYTTVwQ1lPOFZYVU05SQ`, `bDdMOG1TLUNvUlBBUUozQQ`, `Yy1lVGp3OGhfaUdlWXVfWQ` (+ 9 subtarefas).

Eventos (primary):
- cen. 1 "Preparar apresentação": `tkljgp71jf4nlg497upep689f0` (marco 18/09), `5dcem4qimigciqsoc6fknkpv6k` (15/09 09–11), `mt1n0puo7j72kgkgkt6qr969ts` (16/09 09–10)
- cen. 3 "Preparar apresentação de sexta-feira": `aggk7n53k297opcgahl3vsm3p4` (marco 18/09), `v6ib5hb3cm21ts2n4vtt03lhfc` (15/09 11–13), `fkpn0kdu6blouopmsmmbbh3ba0` (16/09 10–11)
- cen. 5 "Organizar mudança de quarto": `5bsh1ivgj91d3cl6g3dlbdcurc` (marco 17/09), `bhgj5s65uqvnemo7uk1igvbqho` (15/09 13–15), `jik5l77rd301ibn6tj47p8udbc` (16/09 11–12)
- cen. 4 "Revisar o contrato": `lde2rm96j09r53c8rtrl78g758` (15/09 15–16)
- cen. 7 "Conferir fatura do cartão de crédito": `cesqkes3qnkjbk0i90j6k99uc8` (15/09 16–17:30)
- cen. 6 "Planejar as compras do mês": `fk1cc8hm81u0dsjvhor20idei0` (15/09 17:30–18:30); lista `c0FZM2I5SkU1dFMxX1pQeQ`

### C4 — limpeza (feita, com "ok" do usuário)

- Apagados pela API, por ID: as 2 listas de teste (`ZGs5…` no cenário 6, `c0FZM2…` no fim — com elas as tarefas) e os 12 eventos acima (HTTP 204; no Calendar vão para a lixeira).
- `data/squad.json` de dev restaurado do backup (conferido: só `tasksListaId` diferia).
- Ficou: `data/google-auth.json` de dev com os dois escopos (antes não existia credencial em dev); `GOOGLE_CLIENT_SECRET` no `.env` de dev. Nada tocado em `/app/data` de produção.
- O container `p4f-client` (porta 3000) foi desligado pelo usuário para a verificação e não foi religado por mim.

- [x] Verificação em dev: typecheck ok, `npm test` 217/217, `npm run build` ok (14/09, após a limpeza)

## Pendências para verificação em dev

- `.env` de dev não tinha `GOOGLE_CLIENT_SECRET`; copiado do Easypanel (autorizado pelo usuário) em 14/09. `APP_URL` ausente = `http://localhost:3000` (redirect registrado no client). `data/google-auth.json` de dev não existe: cenário 1 ("só Calendar") precisa de um consentimento só com Calendar primeiro, ou é testado desmarcando Tasks no consentimento granular.
- `.claude/launch.json` usa porta 3199; o OAuth só aceita `localhost:3000` → subir dev na 3000 para os cenários.
