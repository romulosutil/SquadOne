# Testes: o que cada arquivo cobre

> Movido do `CLAUDE.md` em 11/10/2026 para a sessão não carregar isto toda vez.
> O texto é o original, sem alteração; o `CLAUDE.md` guarda só o resumo das regras.

Os testes são pontuais — só as regras puras que dá para fixar em tabela de casos
(hoje `server/baixa-prioridade.test.ts`,
`server/lembretes.test.ts`, `server/vigia.test.ts`, `server/auth-store.test.ts`,
`server/passos.test.ts`, `server/tasks.test.ts`, `server/passos-no-google.test.ts`,
`server/auth-escopos.test.ts`, `server/squad.test.ts`, `server/calendar.test.ts`,
`server/prompt-passos.test.ts`, `server/telegram.test.ts`,
`server/telegram-entrada.test.ts`, `server/telegram-resposta.test.ts`,
`server/telegram-bot.test.ts`, `server/avaliacoes-turno.test.ts`,
`server/operations.test.ts`, `server/auto-production.test.ts`,
`server/dell-status.test.ts`, `server/prumo-workflows.test.ts`,
`server/tarefa-avulsa.test.ts`, `server/horizonte.test.ts`,
`server/crm.test.ts`, `server/site-mensagem.test.ts` (roda o `site-mensagem.js` do n8n num `vm` e compara com o espelho), `server/acesso.test.ts`,
`server/avisos.test.ts`, `server/telegram-polling.test.ts`,
`server/sinal-de-vida.test.ts`, `server/agenda-no-dell.test.ts`,
`server/roster-historico.test.ts`,
`server/time.test.ts` (o time vivo agrupado por squad e o leitor com cache),
`server/luna-sombra.test.ts` (a saída da Luna como dado, a comparação com o
Gemini, as flags do `codex exec --help`, e a cola — teto do dia, fila serial,
cota, JSONL — com o `codex` dublado num diretório temporário),
`server/openrouter-decisoes.test.ts` (o transporte do Jev com `fetch` dublê e
chave inventada: `questions` é objeto, `provider` sempre com `data_collection:
"deny"` e ZDR, a máscara de telefone/e-mail/CPF/CNPJ/URL/segredo, a resposta
validada contra os rótulos enviados, 402/401 desligam até reiniciar, 429 sem
retry, timeout, corpo sem `usage`, config ilegível e a chave nunca em erro nem log),
os de finanças em `server/financas/` (`natureza`, `transferencias`, `dedupe`,
`parcelas`, `visoes` — com o obrigatório "o mesmo gasto nunca conta duas
vezes" —, `resumo`, `pluggy-mapa`, `fatura-santander`, `rotas` (as travas de acesso
e o "Explicar este mês": sem a flag 404, hash errado 409, o dublê do Gemini recebe o
texto da prévia, `ModeloOcupado` 503 — com um SQLite num diretório temporário),
`organizacao`, `alertas` (nenhum R$ sai), `gasto-falado`, `extrato`, `explicacao`
(o pacote padrão sem R$ nem estabelecimento, o que cada toggle acrescenta, o hash),
e `sync` e `organizar`, estes dois com um SQLite num diretório temporário),
`server/telegram-gasto.test.ts`,
`src/ajuste-do-usuario.test.ts`,
`src/operations-agenda-window.test.ts`, `src/operations-alertas.test.ts`,
`src/operations-fila-de-envio.test.ts` (marcas de envio no navegador, a fila por nicho, pular),
`src/operations-resultados.test.ts` (o placar do CRM: só enviados no período, robô não é resposta, recusa só entre enviados),
`src/operations-colinha.test.ts` (a colinha do PRUMO: o trecho de cada etapa e resposta, a objeção reconhecida no texto, a esteira vinda de `site-mensagem`, nenhum R$ fora do cardápio, o cardápio ver → arrumar → manter com o Mapa grátis, o convite para o Mapa só depois do Raio-X e com equipe, Respondido/Fonte "sob proposta" sem valor nas mensagens fora da proposta, e nenhum cliente fundador),
`src/office/postos.test.ts`, `src/office/trabalhadores.test.ts`,
`src/office/vista.test.ts` (Lista|Mapa e escala inteira), `src/office/salaFinancas.test.ts` e
`src/casca/casca.test.ts` (rotas por perfil, Ctrl+K, a ordem da Hoje com o
semáforo das finanças, estado do time só com fonte, com e sem `/api/time`,
linha do funil)). O monitor do Dell tem os seus em Python:
`python3 deploy/dell/dell-status.test.py`. Os de
`src/` cobrem módulos sem Vue, não componentes: nada monta o Vue nem toca o
Google, e o texto depende de locale/fuso passados por parâmetro para não variar
com a máquina. `auth-escopos`, `squad` e `agenda-no-dell` gravam num diretório
temporário (chdir/env antes do import) e nunca em `data/`; `avisos` e
`telegram-polling` gravam a fila e o offset em temporário; `fetch` é dublê em todos. A verificação
continua sendo typecheck + build + exercitar a rota.
