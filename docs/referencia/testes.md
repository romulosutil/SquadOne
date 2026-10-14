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
`server/operations.test.ts` (inclui a config das ferramentas com e sem o Syncthing
opcional e o `/overview` num servidor de saúde dublê em loopback), `server/auto-production.test.ts`,
`server/dell-status.test.ts`, `server/prumo-workflows.test.ts`,
`server/tarefa-avulsa.test.ts`, `server/horizonte.test.ts`,
`server/crm.test.ts` (inclui, desde 14/10/2026, o loop fechado: interesse parado além de 48 h que só some
com a 2ª mensagem anotada depois da resposta, `followup_enviado` que apaga o follow-up do dia, o regime da
mensagem pelas mesmas datas de corte do `funil-aprendizado.py`, a validação do envio por etapa e a
idempotência de 2 min com `fetch` dublê: clique duplo, toques simultâneos e retrato já refeito; e o reenvio do
só-robô: elegível do dia seguinte ao envio pelo calendário de São Paulo ao 6º dia, fora do dia do `followup_em`,
some com o `followup_enviado`, EUA e Site sem demo no follow-up de sempre, ação e rótulo na Hoje com quem sai
antes na frente, e o prazo que recomeça no reenvio só para o só-robô, inclusive com a planilha já "expirado"),
`server/site-mensagem.test.ts` (roda o `site-mensagem.js` do n8n num `vm` e compara com o espelho; o reenvio do
só-robô, que é só do CRM: artigo e nome, a versão do raio-x para quem recebeu a C, sem R$/saudação/"ontem", EUA sem reenvio),
`server/prumo-mensagem.test.ts` (o reenvio do só-robô do PRUMO: nome como o dono escreve, artigo, só número 55), `server/acesso.test.ts`,
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
`server/jev-sombra.test.ts` (as quatro perguntas com a ordem embaralhada e gravada,
nada de finanças nas opções nem na demanda, o resumo do Gemini e a comparação, e a
cola com `fetch` dublê num diretório temporário: fila serial, teto do dia que
sobrevive a reinício, teto total de gasto, JSONL 600, 402 desliga, observação
sem `await` que não segura o turno, falha que nunca lança, e null fora do `operations`),
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
`src/operations-fila-de-envio.test.ts` (marcas de envio no navegador, a fila por nicho, pular, o passo e a marca "vídeo enviado" do A/B),
`src/operations-resultados.test.ts` (o placar do CRM: só enviados no período, robô não é resposta, recusa só entre enviados;
sem letra, a linha da mensagem pelo regime; follow-up anotado e quem respondeu depois, com amostra pequena),
`src/operations-anotacao-de-envio.test.ts` (a anotação do toque na 2ª mensagem e no follow-up: qual link anota, o primeiro
toque vale, storage que lança, poda quando o retrato confirma, anotados no fim do grupo da Hoje),
`src/operations-trava-de-horario.test.ts` (a trava do envio fora do expediente: só com aviso, liberação por lead sem mutar o conjunto, 19h e domingo travam, 10h não;
o que trava em tabela: envio, convite e o reenvio do só-robô, nunca o follow-up de sempre nem a 2ª mensagem; o rótulo "Pedir o responsável"),
`src/operations-ab-video.test.ts` (A/B do vídeo: hash estável em tabela e ~50/50 em 1000 ids, Fisher exato contra o R, veredito com +20 pontos e p < 0,10, amostra insuficiente, leitura só depois dos 7 dias, quem entra no teste, braço trocado),
`src/operations-colinha.test.ts` (a colinha do PRUMO: o trecho de cada etapa e resposta, a objeção reconhecida no texto, a esteira vinda de `site-mensagem`, o lead do Site que recebeu a C só com textos do raio-x (segunda e follow-up), nenhum R$ fora do cardápio, o cardápio ver → arrumar → manter com o Mapa grátis, o convite para o Mapa só depois do Raio-X e com equipe, Respondido/Fonte "sob proposta" sem valor nas mensagens fora da proposta, e nenhum cliente fundador),
`src/office/postos.test.ts`, `src/office/trabalhadores.test.ts`,
`src/office/vista.test.ts` (Lista|Mapa e escala inteira), `src/office/salaFinancas.test.ts` e
`src/casca/casca.test.ts` (rotas por perfil, Ctrl+K, a ordem da Hoje com o
semáforo das finanças, estado do time só com fonte, com e sem `/api/time`,
linha do funil, o cartão de respostas com o interesse parado na frente)). O monitor do Dell tem os seus em Python:
`python3 deploy/dell/dell-status.test.py`; a lib da fila de avisos,
`python3 deploy/dell/lib/aviso.test.py` (formato igual ao do dell-status, cortes,
recusas, R$, gravação atômica, nunca levanta) e o primeiro script que a usa,
`python3 deploy/dell/auto-entrada.test.py`, `python3 deploy/dell/site-pastas.test.py`,
`python3 deploy/dell/site-demos-limpeza.test.py` e `python3 deploy/dell/site-demos-pausa.test.py`
(aviso idêntico byte a byte ao jeito antigo, aceito pelo dell-status, o jeito
antigo sem a lib, a fila ausente sem derrubar a rodada; na limpeza e na pausa
também o texto do aviso do acervo inteiro dentro de 4000 caracteres e, na limpeza,
o estado "avisado" só quando o aviso ficou na fila; a pausa roda o `main` inteiro
com a Vercel dublada). Os demais scripts trocados para a lib (12/10/2026) têm os
seus, todos rodados à mão no Dell: `deploy/dell/prumo-mapa/prumo_mapa.test.py`
(18; "R$" recusado com linha no journal, `[teste]` preservado, pacote ruim não
derruba os outros), `deploy/dell/backup/backup-dell.test.py` (42, só no Dell por
causa do `fcntl`; o código de saída do ensaio não muda com fila ausente, estragada ou
lib que levanta), `deploy/dell/gerador-de-sites.test.py` (72; inclui o `main()` sem
login), `deploy/dell/claude-ops/site-acompanhamento.test.py` (20; `__main__` ponta a
ponta com dublês), `deploy/dell/funil-aprendizado.test.py` (72; modo 660 sob umask
022 e dado pessoal ainda recusado com a lib), `deploy/dell/whatsapp-observador/observador.test.py`
(49; nada sobe o serviço nem lê o `bridge.log` real) e
`deploy/hermes/scripts/patch_bridge_envios.test.py` (19). Os de
`src/` cobrem módulos sem Vue, não componentes: nada monta o Vue nem toca o
Google, e o texto depende de locale/fuso passados por parâmetro para não variar
com a máquina. `auth-escopos`, `squad` e `agenda-no-dell` gravam num diretório
temporário (chdir/env antes do import) e nunca em `data/`; `avisos` e
`telegram-polling` gravam a fila e o offset em temporário; `fetch` é dublê em todos. A verificação
continua sendo typecheck + build + exercitar a rota.
