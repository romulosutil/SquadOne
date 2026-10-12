# Central de Operações no Dell

O serviço usa o build do clone Git `~/SquadOne` e escuta apenas em
`127.0.0.1:9120`. Até 28/09/2026 usava a réplica `~/Pessoal-dev/SquadOne`, que
congelou com o PC; o `.env` (o build lê `VITE_GOOGLE_CLIENT_ID`, e o
`TOKEN_ENC_KEY` abre o `data/google-auth.json`) e o `data/` foram copiados de
lá e ficam no clone, fora do Git.

Para atualizar a Central (fast-forward da `main`, build e reinício com teste):

```bash
install -m 755 deploy/dell/atualizar-central.sh ~/.local/bin/atualizar-central
atualizar-central
```

Desde 29/09/2026 isso roda sozinho: `atualizar-central.timer` confere a
`main` a cada 10 min e só reconstrói quando ela andou (`--se-mudou`). Uma falha
vira aviso na fila do `dell-status`, que chega pelo WhatsApp (uma vez por
commit: `chave` = o commit da `main`).

Desde 06/10/2026 o reinício espera a Central ficar ociosa: depois do build,
`atualizar-central` lê `GET /api/runtime` a cada 10 s e só reinicia com
`"ocupado": false` (nenhum turno rodando nem mensagem na fila do bot do
Telegram), no máximo 10 min; passou disso, reinicia assim mesmo e registra no
journal. Reiniciar no meio de um turno perderia a resposta de um compromisso que
talvez já tenha nascido no Google. Por isso `TimeoutStartSec` do serviço subiu
para 25 min.

**Só as rotas da Central (06/10/2026).** No perfil `operations` o servidor
monta `/api/runtime`, `/api/operations/*`, `/entrada/` e, do Google, só
`/api/auth/google` e `/api/auth/callback` (o "Conectar calendário" da agenda).
Todo o resto de `/api` (roster, Mochila, turno, ajuste, push, avaliação,
`/api/auth/status` e `/logout`) responde **404 JSON**, como `/api/operations`
no perfil `app`. Antes ficavam montadas sobre o `~/SquadOne/data/squad.json` do
Dell, um retrato de 14/09/2026: um POST na Central criaria agentes e eventos a
partir dele. Confira: `curl -s -X POST -H 'Origin: http://127.0.0.1:9120' 127.0.0.1:9120/api/quests/x/ajustar`
→ `404 {"error":"Rota do app indisponível no perfil operations."}`.

**A agenda no Dell (cutover, em `CUTOVER-AGENDA.md`).** As rotas do app voltam
ao `operations` só com `SQUADONE_DATA_DIR` no `operations.env`, apontando para
`~/.local/share/squadone` (fora do clone), onde o runbook põe o roster de
**produção** e a credencial do Google do Dell; o retrato de 14/09/2026 é
arquivado, nunca mesclado. Com a agenda: bot do Telegram por `getUpdates`
(`TELEGRAM_TRANSPORTE=polling`), lembretes pela fila de avisos, conferência do
`Tailscale-User-Login` (`SQUADONE_LOGINS_TAILSCALE`), escrita só da mesma
origem (curl de escrita leva `-H 'Origin: http://127.0.0.1:9120'`) e sinal de
vida para o healthchecks.io (`DEADMAN_URL`). Conectar ou ampliar o Google é
sempre pelo PC, no túnel: `http://127.0.0.1:9120/api/auth/google`.

```bash
cp deploy/dell/atualizar-central.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now atualizar-central.timer
```

Arquivos privados no Dell, fora do Git:

- `~/.config/squadone/operations.env`;
- `~/.config/squadone/operations.json`;
- `~/.local/share/squadone-operations/projects.json`;
- `~/.config/claude-ops/crm-segredo` (segredo do registro do CRM, 600; ver "CRM").

Em `operations.json`, `autoDirectory` é o caminho absoluto de `~/auto-site`. O
bloco `crm` é opcional (os padrões são os do Dell): `retrato`
(`~/.local/share/n8n-estado/crm.json`), `registroUrl`
(`http://127.0.0.1:5679/webhook/crm-registro`, só loopback), `segredoArquivo`
e `entregasPrumo` (`~/prumo-entregas`). A Central só lê pastas e retrato.
`auto-production.json` (marcos manuais da antiga Produção Auto) e
`autoNotificationStateFile` deixaram de ser lidos em 30/09/2026; o arquivo
ficou no disco, sem uso.

O arquivo de ambiente deve definir pelo menos:

```dotenv
NODE_ENV=production
PORT=9120
SQUADONE_MODE=operations
IPS_PERMITIDOS=127.0.0.1,::1,100.64.0.0/10,fd7a:115c:a1e0::/48
SQUADONE_OPERATIONS_CONFIG=/home/usuario/.config/squadone/operations.json
SQUADONE_OPERATIONS_DATA_DIR=/home/usuario/.local/share/squadone-operations
```

Depois do cutover da agenda (`CUTOVER-AGENDA.md`), o mesmo arquivo ganha, com
os valores digitados pelo Rômulo (nunca pelo chat):

```dotenv
SQUADONE_DATA_DIR=/home/usuario/.local/share/squadone
SQUADONE_LOGINS_TAILSCALE=<login do Tailscale>
GEMINI_API_KEY=<chave paga>
DEADMAN_URL=<URL de ping do healthchecks.io>
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_TRANSPORTE=polling
TELEGRAM_CHAT_IDS=<chat do Rômulo>
```

O serviço fixa `APP_URL=http://127.0.0.1:9120` para que a autorização Google da
Central retorne ao processo local. O cliente OAuth precisa aceitar exatamente
`http://127.0.0.1:9120/api/auth/callback` como URI de redirecionamento. Essa
credencial fica no Dell e é independente da credencial usada pelo app público.

Instalação do serviço de usuário:

```bash
mkdir -p ~/.config/systemd/user ~/.config/squadone ~/.local/share/squadone-operations
cp deploy/dell/squadone-operations.service ~/.config/systemd/user/
cp deploy/dell/dell-worker-healthwatch.service ~/.config/systemd/user/
cp deploy/dell/dell-worker-healthwatch.sh ~/.local/bin/
chmod 0755 ~/.local/bin/dell-worker-healthwatch.sh
systemctl --user daemon-reload
systemctl --user enable --now squadone-operations.service dell-worker-healthwatch.service
```

O healthwatch consulta o n8n pela porta publicada no host, `5679`. A porta
interna `5678` existe somente dentro do container; usá-la no host cria um ciclo
de reinício falso e interrompe operações da interface.

**A home (30/09/2026)**, pedido do Rômulo ("um botão que abra os agentes do
SquadOne" e "coloque aqui os fluxos e como são, e o que fazer com cada
alerta"), de cima para baixo:

- **Precisa de você**: o vermelho (falhou), a sua fila (pendências do CRM) e o
  que vale olhar, cada um com **O que fazer** (texto do `dell-status`), o botão
  que resolve (ex.: "Abrir no CRM") e o link da fonte ("Abrir no Dell" quando o
  endereço é loopback e só abre no navegador do próprio Dell). Falhas com o
  mesmo remédio (ex.: reconectar a mesma credencial do Google) ganham uma
  linha "N falhas, um gesto só". O que resolve sozinho fica fechado embaixo;
- **Como funciona**: um fluxo por vez (Site antes da venda, PRUMO, CRM, Radar
  PNCP, Alertas e saúde, Backup, WhatsApp, Código e Central, Agenda e agentes)
  com onde roda, quando, "Com você" ou "Automático", e "Um dia" com os
  horários. O conteúdo é `src/operations/fluxos.ts` (mudou um fluxo, mude lá);
  o retrato vivo acrescenta "Falhou agora" e "N esperando" no passo;
- **Agenda** e **Abrir** (CRM, Agentes do SquadOne, Terminal, n8n, Hermes...);
- **Tudo que o Dell confere**, fechado.

O botão **Agentes do SquadOne** (também no topo, em qualquer página da
Central) abre o app do Easypanel (https://aladdin-squadone-app.jicnzg.easypanel.host/), onde moram
as squads e pessoas. Desde 30/09/2026 a Central não serve mais uma cópia do app
em `/squadone`; link antigo redireciona para lá.

**No celular (30/09/2026):** a Central abre em
`https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/` (o CRM em
`/crm`) em qualquer aparelho da tailnet do Rômulo, com o Tailscale ligado. O
processo continua só em loopback; quem publica é o Tailscale Serve, só na
tailnet (nunca Funnel), numa porta própria para não mexer em `/` (Hermes) e
`/webhook` (n8n) da 443. O Serve reescreve o `X-Forwarded-For` com o IP do
aparelho, por isso `IPS_PERMITIDOS` leva as faixas da tailnet (o porteiro
aceita CIDR). Aparelho novo na tailnet entra sem mudar nada.

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:9120
tailscale serve status   # 443: / -> 9119, /webhook -> 5679; 8443: / -> 9120 (tailnet only)
sudo tailscale serve --https=8443 off   # desfaz
```

Do PC (o Jarvis, desde 04/10/2026), a Central, o Hermes e os webhooks abrem
pela tailnet (acima); nenhuma porta pública é necessária. No próprio Dell as
URLs `127.0.0.1` abrem direto, sem túnel.

O editor do n8n e o code-server só escutam em loopback; no PC, um túnel SSH
põe as superfícies operacionais no mesmo endereço local:

```bash
ssh -N \
  -L 9120:127.0.0.1:9120 \
  -L 9119:127.0.0.1:9119 \
  -L 5679:127.0.0.1:5679 \
  -L 8080:127.0.0.1:8080 \
  mel
```

No PC, `mel` é o `Host` do `~/.ssh/config` que aponta para o nome MagicDNS do
Tailscale (o PC antigo usava `dell-worker`). A tarefa agendada `Mel-Tuneis`
(`deploy/pc/instalar-tuneis.ps1`) inicia no logon, mantém o SSH vivo e recria
os túneis depois de uma falha. As portas locais são:

- `http://127.0.0.1:9120/`: Central do SquadOne;
- `http://127.0.0.1:9119/chat`: Hermes;
- `http://127.0.0.1:5679/`: n8n;
- `http://127.0.0.1:8080/`: code-server.

O Dell mantém `linger` ativo, ignora fechamento da tampa e tem os alvos de
suspensão e hibernação mascarados. Wake-on-LAN continua como recuperação de
melhor esforço: energia removida, falha do roteador ou uma limitação de
Wake-on-WLAN ainda exigem intervenção física.

O playbook do Hermes é versionado em
`deploy/hermes/skills/dell-operations-manager/SKILL.md`. Instale-o no Dell em
`~/.hermes/skills/dell-operations-manager/SKILL.md`. A pasta sincronizada
`~/Pessoal-dev` é contexto de leitura e troca de arquivos; use um clone Git
próprio para qualquer operação de branch, commit ou push.

Instale também `deploy/hermes/scripts/validate-dell-operations.sh` como
`~/.local/bin/dell-validate`. O comando é somente leitura, não imprime segredos
e valida systemd, Docker, n8n, credenciais OAuth, GitHub, Chromium e SquadOne.

## Monitor do Dell (`dell-status`)

Roda a cada minuto e faz duas coisas: grava
`~/.local/share/squadone-operations/status.json`, que a página inicial da
Central lê, e manda WhatsApp pelo Hermes (`hermes send`) quando uma verificação
passa a falhar, a cada 12 h enquanto continuar falhando e quando volta ao normal.
Estados `atencao` só aparecem na Central. Também esvazia
`~/.local/share/avisos/fila/*.json`, a fila que os containers e os scripts do
Dell usam para avisar sem abrir rede nem firewall (formato e regras em "Fila de
avisos", abaixo).

Desde 29/09/2026 também confere:

- **Rotinas do Hermes**, uma por uma, lendo `~/.hermes/cron/jobs.json` a cada
  minuto (rotina nova ou horário mudado no Hermes não exige mexer aqui). Falha
  quando a última rodada deu erro ou quando não rodou: cron sem rodada depois do
  último horário previsto + 30 min (o Hermes grava `last_run_at` no fim da
  rodada); intervalo sem rodada há mais de 3 intervalos. Pausadas ficam de fora.
  Horário mudado ou rotina que voltou da pausa só é cobrado a partir do disparo
  seguinte (memória em `~/.local/state/dell-status/agendas.json`). O avaliador
  de cron aceita números, `*`, `,`, `-`, `/` e `@daily` etc., na hora do Dell.
- **Gerador de sites**, pelo resumo que o próprio runner grava em
  `~/auto-site/.logs/status.json`: falha quando a execução teve falha e nenhum
  site, quando o runner registrou `erro` (sem login, SIGTERM, bug), quando morreu
  no meio de um lead (status "processando" sem o processo da trava) ou quando o
  systemd registrou falha depois do último resumo. Falha com algum site ou pasta
  sumida é atenção; lead descartado pelo Claude é normal.
- **Rascunho do Mapa** (`prumo-mapa`, desde 07/10/2026), pelo rastro em disco,
  porque o `prumo-mapa` não grava resumo: falha com o `prumo-mapa.path` parado
  ou com pacote na `mapa-fila` há mais de 30 min (a unit tem 20 min de teto;
  o detalhe traz o `Result` do systemd quando a última execução caiu). Pacote
  em `~/.local/share/prumo-mapa-erro` é atenção, não WhatsApp: o próprio
  `prumo-mapa` já avisou com o motivo. O ok conta os rascunhos de
  `~/prumo-entregas` (pastas `-teste-` fora) e a data do último, sem nome de
  empresa.

Desde 30/09/2026 cada verificação que não está ok diz **o que fazer**
(`o_que_fazer`, uma ou duas frases; `acao` com o link que resolve; `sozinho`
quando resolve sem o Rômulo). O texto também vai no WhatsApp, e o link do aviso
passou a ser o da tailnet (`…ts.net:8443`), que abre no celular. Vermelho quer
dizer "você precisa agir ou está quebrado agora"; amarelo, "vale olhar". Para
isso, menos ruído:

- **Fluxos do n8n pela agenda de cada um** (`avaliar_fluxo`): o Schedule
  Trigger vira cron e o fluxo é cobrado pelo último horário + 15 min, só a
  partir da versão atual (fluxo recém-ativado não é cobrado pelo passado).
  Fluxo só de webhook/clique/formulário é ok sem rodar ("espera um clique").
  Horário que caiu com o Dell ou o n8n fora do ar é atenção que resolve
  sozinha (o n8n não repete rodada perdida). A última execução que falhou é
  vermelho, com a causa (nó e mensagem; "credencial do Google precisa ser
  reconectada" diz qual credencial reconectar) e o que acontece depois (a
  próxima rodada, ou Retry para webhook). Fluxo que não guarda as execuções
  boas (`saveDataSuccessExecution: none`) só é vermelho por 30 min depois da
  falha. A memória (`~/.local/state/dell-status/fluxos.json`) guarda a última
  execução vista, porque o n8n apagava as execuções com mais de 14 **horas**
  (`EXECUTIONS_DATA_MAX_AGE` é em horas; corrigido para 336 no compose, vale
  quando o container for recriado) e o Caçador aparecia como "ainda não rodou".
- **Rotinas do Hermes**: horário perdido com o Dell desligado é atenção que
  resolve sozinha; intervalo conta desde que o Dell ligou.
- **Radar PNCP**: antes das 09:00 a coleta de ontem ainda vale; PNCP fora do
  ar há menos de 3 dias é atenção que resolve sozinha.
- **Backup**: token do Google recusado pelo rclone (`invalid_grant`) é
  vermelho na hora, com o comando `rclone config reconnect gdrive:`; adiado
  e ensaio atrasado resolvem sozinhos. O cofre registra quais arquivos não
  conseguiu ler (antes era só "alguns arquivos").
- **Filas** (`pend:*`): cada uma diz o que fazer e leva ao CRM
  (`/crm?produto=site|prumo`); "Sites na fila do gerador" e "Enviados
  esperando resposta" andam sozinhas.

- **Sessão do WhatsApp** (`whatsapp-sessao`, desde 06/10/2026): `GET
  http://127.0.0.1:3000/health` da bridge do Hermes precisa responder `status:
  "connected"` (a bridge diz `connected`/`disconnected`; `open`, o nome cru do
  Baileys, também vale). O gateway `active` não basta: em 06/10/2026 a sessão foi desconectada
  ("Logged out" em `~/.hermes/whatsapp/bridge.log`) e a bridge morria em laço
  com o gateway de pé. Vermelho; o aviso desse vermelho, claro, não chega pelo
  WhatsApp — aparece na Central, e o remédio é parear de novo.

- **Trocar o chip (ou parear de novo)**, como em 09/10/2026: o número antigo
  (…97780954) passou a levar 403 em laço desde as 11:01 e o Hermes foi pareado
  no chip novo, **27 99976-2786** (conta "Prumo"). Passos: `systemctl --user stop
  hermes-gateway`; mover (não apagar) `~/.hermes/whatsapp/session` para
  `session.antiga-<número>-<data>`; num terminal interativo, `cd
  ~/.hermes/hermes-agent/scripts/whatsapp-bridge && ~/.hermes/tools/node-*/bin/node
  bridge.js --pair-only --session ~/.hermes/whatsapp/session` e ler o QR no
  celular (Aparelhos conectados; o `515` depois da leitura é normal); trocar
  `WHATSAPP_HOME_CHANNEL` no `~/.hermes/.env` pelo `me.lid` sem o `:N` do
  `session/creds.json` novo; `systemctl --user restart hermes-gateway` e `hermes
  send --to whatsapp "teste"`. `hermes whatsapp` faz o mesmo, mas apaga a sessão
  antiga. Os avisos (`dell-status`, `AVISOS_DESTINO`) e o vigia do Site antes da
  venda mandam para `whatsapp`, o canal principal: um nome como `whatsapp:Rômulo
  Sutil` vem do diretório de canais e ficaria preso ao chat da conta antiga. Com
  o chip novo, a conversa com o Hermes é o "Você" (mensagem para si mesmo) da
  conta pareada, e o observador só vê as conversas desse número.

### O que a auditoria de 11/10/2026 achou invisível

Verificações que nasceram da auditoria da Mel: coisas que já tinham acontecido e a
Central não mostrava. Nenhuma acende vermelho com o estado da Mel de 11/10/2026.

- **Religamentos do healthwatch** (`healthwatch`, grupo Serviços): lê o journal do
  `dell-worker-healthwatch` (7 dias, `journalctl --user -o json`) e conta as linhas
  `healthwatch: restarting …`/`starting …`. Nos 7 dias até 11/10 foram 16 do gateway do
  Hermes e 2 do n8n, e nenhum aparecia. Religamento nos primeiros 10 min depois de o Dell
  ligar não conta (os serviços ainda estão subindo; pelo relógio monotônico do journal,
  que vale para os boots anteriores). Qualquer outro nas últimas 24 h é **amarelo**:
  "resolve sozinho" com até 2 episódios (religamentos do mesmo serviço a até 5 min um do
  outro são um episódio); sem o "sozinho" com 3 episódios ou mais, ou com 10 religamentos
  num episódio (07/10 00:00: o gateway do Hermes ficou 6 min sem subir, 13 tentativas).
  Nunca vermelho: o serviço que continua fora já é vermelho na verificação dele. Para
  parar o gateway **de propósito** (trocar o chip), pare antes o healthwatch
  (`systemctl --user stop dell-worker-healthwatch`), senão ele religa a cada 30 s (09/10,
  16:06) — e religue-o depois.
- **Idade dos dados** (`idade:<id>`, grupo Dados; lista `DADOS_COM_IDADE`): um arquivo que
  uma rotina do Hermes deveria renovar. Hoje só **Métricas do ASMR**
  (`~/.local/share/asmr-fullbringer/shorts-metrics.json`, renovado pela coleta
  `79a04dbf2d81`), parado desde 05/10/2026 21:42 sem ninguém ver: a coleta rodava de hora
  em hora e respondia "bloqueado" (feed público com erro e sem o navegador do Hermes). Com
  a rotina **pausada** (`hermes cron pause`) é ok, "Coleta pausada de propósito em dd/mm"
  (o estado de 11/10). Ativa, o dado vale 72 h (o portão `asmr_coleta_gate.py` só acorda
  o modelo com Short de até 72 h no ar), contadas também desde que a rotina voltou da
  pausa. Mais velho que isso: **vermelho** se o modelo rodou depois da última gravação
  (saída com `## Response` em `~/.hermes/cron/output/<id>/`, 15 min depois da gravação) e
  não gravou; **amarelo que resolve sozinho** se o portão nem precisou acordá-lo (não saiu
  Short novo). Rotina que sumiu do Hermes é amarelo até alguém tirar o dado da lista.
- **Rotinas caladas** (`rotinas-caladas`, grupo Dados): "Rotina · …" só diz se a rodada
  rodou; não diz se ela tinha algo a dizer. A revisão diária do ASMR respondeu `[SILENT]`
  em todas as rodadas de 26/09 a 11/10 (o dado que ela lê tinha parado) e ficava verde.
  Lê as saídas em `~/.hermes/cron/output/<id>/` (o Hermes guarda as 50 últimas) e conta
  as respostas `[SILENT]` seguidas no fim (a seção `## Response`). Portão que pulou
  (`wakeAgent=false`), script sem saída e erro não contam para nenhum lado. **Amarelo** com
  5 ou mais seguidos cobrindo 3 dias ou mais. Ficam de fora as rotinas **pausadas** (as do
  ASMR, o Radar e o "SquadOne — aprender", pausadas de propósito em 11/10), as só-script
  (`no_agent`: Entrada, Graphify, Sites e pendências) e os ids listados em
  `~/.local/state/dell-status/silencio-esperado` (um por linha, `#` comenta), para um vigia
  que só fala quando há o que dizer.
- **Timers do repositório** (`timers`, grupo Serviços): todo `.timer` de `deploy/dell/`
  que o `instalados.json` leva a `~/.config/systemd/user/` **e está instalado** tem de
  estar ligado (`ActiveState=active`). O `gerador-de-sites.timer` foi desligado de
  propósito em 10/10/2026 e nada dizia isso; um desligado por engano ficaria igual.
  Desligado **sem marca de pausa** é amarelo, com o comando que liga. Para pausar de
  propósito, marque (o conteúdo é a nota que aparece no detalhe, por exemplo a data):

  ```bash
  systemctl --user disable --now gerador-de-sites.timer
  date +%d/%m/%Y > ~/.local/state/dell-status/pausa-gerador-de-sites   # pausa-<timer sem .timer>
  # para voltar: systemctl --user enable --now gerador-de-sites.timer
  #              find ~/.local/state/dell-status -name pausa-gerador-de-sites -delete
  ```

  A marca `pausa-pncp` do Radar também vale para o `pncp-catchup.timer`. Marca de um timer
  que voltou a ligar não acende nada, mas aparece no detalhe ("marca de pausa sobrando")
  para ser apagada.
- **Cache e ~/.local** (`pastas`, grupo Máquina): em 11/10/2026 o `~/.cache` tinha 34 GB de
  perfis temporários do Chrome headless do QA (`google-chrome-headless/scoped_dir*`) e o
  "Disco" seguia verde (500 GB, longe dos 85%). Mede `~/.cache` e `~/.local` com
  `du -x --max-depth=1` **uma vez por hora** (a medida e as 3 subpastas maiores ficam em
  `~/.local/state/dell-status/tamanhos.json`, 8 dias). **Amarelo** com `~/.cache` acima de
  25 GB ou `~/.local` acima de 15 GB (no dia: 12,2 e 2,7 GB), ou com qualquer uma crescendo
  mais de 2 GB por dia (comparada com a medida mais perto de 24 h atrás, entre 20 e 48 h; a
  primeira diz "crescimento: medindo"). O detalhe diz a subpasta maior. du que falha (60 s
  de teto) é amarelo e só tenta de novo na hora seguinte. Nunca vermelho: disco cheio já é
  vermelho em "Disco".

### Fila de avisos (06/10/2026)

Um arquivo JSON por aviso em `~/.local/share/avisos/fila/`:

```json
{"titulo": "🌐 Sites", "texto": "…", "origem": "gerador-de-sites",
 "chave": "gerador:2026-10-06", "prioridade": 2, "expira_em": "2026-10-06T18:00:00-03:00",
 "link": "https://…"}
```

| Campo | Regra |
|---|---|
| `titulo` | obrigatório, até 120 caracteres, uma linha |
| `texto` | obrigatório, até 4000 caracteres |
| `origem` | obrigatório, até 80, uma linha: quem gravou (`n8n:<fluxo>`, nome do script) |
| `chave` | opcional, até 200: a mesma chave enviada nas últimas 24 h é descartada |
| `prioridade` | opcional, inteiro 0 (urgente) a 3 (baixa); padrão 2 |
| `expira_em` | opcional, ISO 8601 (sem fuso = São Paulo): vencido é descartado sem enviar |
| `link` | opcional, URL http(s), até 500; vai numa linha no fim da mensagem |

Arquivo de até 16 KB, sem outros campos. Grave em `.tmp` e renomeie (o nó do
n8n grava direto: arquivo com menos de 5 s espera a rodada seguinte).

- **Fora do formato é recusado**: não vai ao WhatsApp. O arquivo e o motivo
  (`….motivo.txt`) ficam em `~/.local/state/dell-status/avisos-recusados/`, o
  journal registra, e a verificação **Fila de avisos** fica vermelha até alguém
  corrigir quem gravou e dar o **visto**. Antes um aviso ilegível virava um
  "Aviso ilegível na fila" no WhatsApp.
- **Visto (11/10/2026)**: `dell-status --visto-recusados todos` (ou um ou mais
  nomes de arquivo, como estão em `avisos-recusados/`) move o `.json` e o
  `.motivo.txt` para `~/.local/state/dell-status/avisos-recusados/vistos/` e o
  vermelho apaga no minuto seguinte. Mover guarda a prova; o comando é
  idempotente, nome inexistente (ou caminho) é listado em `inexistentes` com
  saída 1 e nada fora da pasta é tocado. Um recusado **novo** acende de novo; a
  verificação verde passa a dizer "N recusado(s) já visto(s)". Só dê o visto
  depois de conferir que quem gravou já manda `origem` (senão o próximo aviso
  dele é recusado e o alerta volta).
- **Silêncio das 22h às 7h** (São Paulo): só P0 sai; o resto espera e sai às 7h.
- **Teto de 20 envios por hora** (janela móvel). Quando a fila tem mais do que
  cabe, saem os de maior prioridade (e mais antigos) e o resto vai num
  **resumo** só ("📦 N avisos agrupados", com título e origem de cada). Sem vaga
  nenhuma, sai no máximo um resumo por hora e o excedente espera.
- Estado (envios da última hora, chaves das últimas 24 h, último resumo) em
  `~/.local/state/dell-status/fila.json`; trava em `fila.lock` (`flock`): a
  rodada de cada minuto e um `dell-status --drenar` avulso nunca mandam o mesmo
  arquivo duas vezes.
- Hermes fora do ar: o aviso fica na fila e a drenagem para no primeiro envio
  que falha (cada tentativa leva até 2 min); tenta de novo no minuto seguinte.

**Scripts Python gravam pela lib** `deploy/dell/lib/aviso.py` (11/10/2026),
instalada em `~/.local/lib/mel/aviso.py`: valida contra este formato (mais "R$"
e 16 KB), corta com segurança o que passa do teto, grava `.tmp` oculto +
rename com nome único, não cria a pasta e nunca levanta (devolve `gravado`,
`recusado`, `fila_ausente` ou `falhou`; o que não gravou vai ao journal). Sem a
lib instalada, o script volta ao jeito antigo. Por enquanto só o `auto-entrada`
usa; o inventário das outras cópias e a ordem da troca (um PR por script) estão
em `docs/superpowers/plans/2026-10-11-aviso-unico.md`.

```bash
python3 deploy/dell/lib/aviso.test.py && python3 deploy/dell/auto-entrada.test.py
install -D -m 644 deploy/dell/lib/aviso.py ~/.local/lib/mel/aviso.py   # antes do script que a usa
```

Os fluxos do n8n montam o aviso em nós Code (`claude-ops/n8n.py`,
`aviso_nodes`, com `origem: 'n8n:' + $workflow.name`). Fluxos publicados antes
de 06/10/2026 não mandam `origem`: `claude-ops/aviso-origem.py --aplicar` os
ajusta (sem `--aplicar` só lista). **Rode-o antes de instalar este
`dell-status`**: o antigo ignora o campo a mais, o novo recusa aviso sem ele.

A pasta é `770` com o grupo do usuário `node` do container do n8n (gid 1000,
o mesmo do Rômulo no Dell), e não mais `777`: qualquer processo do Dell podia
gravar aviso em nome de quem quisesse. O `2` (setgid) mantém o grupo nos
arquivos novos.

```bash
python3 deploy/dell/dell-status.test.py   # cron, rotinas, gerador, fluxos, filas, fila de avisos, WhatsApp, backup, arquivos instalados, timers, healthwatch, idade dos dados, rotinas caladas, pastas e "o que fazer"
(cd deploy/dell/claude-ops && python3 aviso-origem.py --aplicar)   # antes do dell-status novo
install -m 755 deploy/dell/dell-status.py ~/.local/bin/dell-status
mkdir -p ~/.local/share/avisos/fila
chgrp "$(docker exec licitacoes-automation-n8n-1 id -g)" ~/.local/share/avisos/fila && chmod 2770 ~/.local/share/avisos/fila
cp deploy/dell/dell-status.service deploy/dell/dell-status.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now dell-status.timer
dell-status --stdout   # confere sem gravar nem avisar
dell-status --drenar   # só esvazia a fila agora (com a mesma trava)
```

### Arquivos instalados (`instalados.json`, 07/10/2026)

O `atualizar-central` só refaz a Central: o resto que roda no Dell (scripts em
`~/.local/bin`, `claude-ops`, `prumo-mapa`, `entrada`, units do systemd, o que o
`aplicar-hermes.py` copia) é uma **cópia** instalada à mão, e um merge não chega
nela sozinho. Em 07/10/2026 o fix que pôs `origem` nos avisos do observador do
WhatsApp estava na `main` desde 06/10, mas a cópia em `~/.local/bin` era de
05/10: a fila recusou 8 avisos de respostas de leads e nenhum chegou ao
WhatsApp.

A verificação **Arquivos instalados** compara cada cópia listada em
`deploy/dell/instalados.json` com o `~/SquadOne` (byte a byte, a cada minuto) e
fica em atenção, sem aviso no WhatsApp, enquanto houver diferença. Quando a cópia
foi gravada **depois** da versão do repo chegar ao clone, o texto pede para
comparar antes: pode ser mudança feita direto no Dell que falta levar ao repo.
O manifesto é lido do `~/SquadOne`, então acrescentar um arquivo nele não exige
reinstalar o `dell-status`. **Script novo instalado fora do `~/SquadOne` entra
no `instalados.json` no mesmo PR.**

```bash
dell-status --instalados   # o que está diferente do repo, com o comando que instala cada um
```

## Cópia do roster do Easypanel (`squad.json`)

O roster de verdade (squads, pessoas e o treino de cada uma) mora no volume do
app do Easypanel, em `/app/data/squad.json`. O `~/SquadOne/data/squad.json` do
Dell é um retrato velho de 14/09/2026, que a Central não usa (ver "Só as rotas
da Central"): **não o sobrescreva**; o que fazer com ele é decisão do cutover
da agenda. Para o cofre do Dell (restic cifrado no Drive, às 03:30) ter o roster
atual, copie-o pelo console do Easypanel para `~/Mel/Easypanel/`, que entra no
cofre e está nos `obrigatorios` do `backup/fontes.toml` (faltando, o cofre fica
em atenção). Refaça depois de contratar, editar ou arquivar alguém.

1. No Easypanel: projeto **aladdin** → serviço **squadone-app** → **Console**
   (shell `sh`). Rode e deixe a saída na tela:

   ```bash
   sha256sum /app/data/squad.json
   base64 /app/data/squad.json
   ```

   Base64, e não `cat`: o console quebra linha longa ao copiar, e JSON com
   quebra no meio de uma string não volta igual.
2. No Dell (terminal local ou `ssh mel` do PC), cole o bloco base64 e feche com
   Ctrl-D:

   ```bash
   mkdir -p ~/Mel/Easypanel && chmod 700 ~/Mel/Easypanel
   f=~/Mel/Easypanel/squad-$(date +%F).json
   base64 -d > "$f"        # cole o bloco, Enter, Ctrl-D
   chmod 600 "$f"
   sha256sum "$f"          # tem de bater com o do console
   python3 -m json.tool "$f" > /dev/null && cp -p "$f" ~/Mel/Easypanel/squad.json
   ```

3. A rodada seguinte do cofre leva o arquivo (ou rode já: `backup-dell cofre
   --sem-ensaio`). Conferir que está lá:
   `restic ls latest ~/Mel/Easypanel` (variáveis do `backup/RESTAURAR.md`).

O `google-auth.json` do Easypanel **não** vem junto: é cifrado com o
`TOKEN_ENC_KEY` de lá, e o Dell tem a credencial própria (ver acima).

## Luna em sombra (fase 8c, desde 07/10/2026, desligada)

Medição de ~30 dias para saber se a Luna (`gpt-6-luna`, pelo `codex exec` com
o login ChatGPT Pro do Dell) substituiria o Gemini como motor do turno. Depois
de cada turno real do Gemini o servidor roda a Luna com o **mesmo** prompt e a
mesma demanda, pede só as chamadas de capacidade em JSON, **não executa nada**,
compara e grava. Nenhum comportamento do app muda; o que ela responde nunca
vira evento, tarefa, proposta ou mensagem. Decisão e desenho em
`ARCHITECTURE.md`, "Luna em modo sombra".

**Antes de ligar:**

1. Na conta ChatGPT (Configurações → Controles de dados), conferir que
   **"Melhorar o modelo para todos" está desligado**: o prompt leva o roster
   inteiro da squad ativa (nomes, papéis e o treino de cada pessoa) e a
   demanda.
2. Saber que `~/.codex` (login do ChatGPT e as sessões do `codex`, que guardam
   o prompt em texto) já era um risco aceito do disco sem cifra do Dell
   (`ARCHITECTURE.md`, "Riscos aceitos"); com a sombra ligada, o roster e as
   demandas passam a existir também ali. O serviço ganhou `-%h/.codex` em
   `ReadWritePaths` só por isso (reinstale a unit).
3. `codex login status` numa sessão no Dell: a sombra não faz login e não
   pede; sem sessão o `codex` falha e cada linha sai com `falha`.

**Ligar** (no `~/.config/squadone/operations.env`, valores digitados pelo
Rômulo):

```dotenv
SQUADONE_LUNA_SOMBRA=true
# opcionais:
# SQUADONE_LUNA_TETO_DIA=10              # turnos observados por dia (São Paulo); padrão 10
# SQUADONE_LUNA_GUARDAR_DEMANDA=true     # grava a demanda em claro no JSONL; padrão só sha256 + tamanho
# SQUADONE_CODEX_BIN=/home/usuario/.npm-global/bin/codex   # padrão: `codex` no PATH do serviço
```

```bash
cp deploy/dell/squadone-operations.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart squadone-operations
journalctl --user -u squadone-operations -n 50 | grep '\[luna\]'
```

**A primeira coisa a fazer ao ligar é ler esse log.** O PC não tem o `codex`
e as flags usadas (`--model`, `--sandbox`, `--skip-git-repo-check`,
`--output-last-message`) não foram conferidas contra o binário do Dell: no
boot a sombra roda `codex exec --help` e, se alguma flag faltar, desliga com
`[luna] sombra desligada: codex exec --help não lista …`. Binário fora do PATH
do serviço (systemd não lê o `.bashrc`) dá `[luna] sombra desligada: binário
'codex' não encontrado` — aponte `SQUADONE_CODEX_BIN` para o caminho
absoluto. Ligada, o log diz `[luna] sombra ligada: teto N/dia, registro em …`.

**Teto e custo:** no máximo `SQUADONE_LUNA_TETO_DIA` turnos observados por
dia (zera à meia-noite de São Paulo; o contador sobrevive a reinício porque
conta as linhas de hoje no JSONL); um turno com redirecionamento de squad
são dois turnos do Gemini e duas observações; o excedente é só ignorado (log
uma vez por dia). Erro de cota do `codex` para a sombra até o dia seguinte.
Cada observação é uma execução do `codex` de até 120 s, numa fila própria de
um por vez, fora da fila do bot e fora do `ocupado` de `/api/runtime`: o
`atualizar-central` não a espera, e um reinício no meio perde só uma medição.

**Onde fica o registro:** `~/.local/share/squadone/luna-sombra/AAAA-MM.jsonl`
(600, dentro do `SQUADONE_DATA_DIR`; entra no cofre com o resto do diretório).
Uma linha por turno observado: `quando`, `squad`, `modo`, `hashDaDemanda`,
`tamanhoDaDemanda`, as chamadas do Gemini e da Luna resumidas aos campos
comparados (nunca título, nota ou notas), `veredito` (`igual`, `parcial`,
`diferente` ou `falhou`), `detalhes`, `duracaoMs` e `falha?`. Ao lado, o
`cwd/` vazio em que o `codex` roda (700), com o arquivo da última mensagem
apagado depois de lido. Nada disso vai a aviso, WhatsApp, Telegram ou
`status.json`.

**Ler o resumo** (só lê, nunca grava; sem a demanda, a não ser que ela esteja
gravada):

```bash
cd ~/SquadOne && npx tsx scripts/luna-sombra-resumo.ts ~/.local/share/squadone/luna-sombra
```

Imprime o total, a contagem por veredito, a concordância por capacidade
(`agendar_evento`, `criar_tarefa`, …: quantas casaram iguais, com divergência,
só no Gemini, só na Luna) e as 10 divergências mais recentes.

**Desligar:** apagar (ou pôr `false` em) `SQUADONE_LUNA_SOMBRA` no
`operations.env` e reiniciar o serviço. O registro fica; apagar é decisão à
parte (`rm -r ~/.local/share/squadone/luna-sombra`). Não há nada a desfazer no
Google, no Telegram ou no roster: a sombra nunca escreveu neles.

## Jev em sombra (desde 11/10/2026, desligado)

Medição do roteamento de demandas pelo Jev (`typesafe/jev-1.13`, TypeSafe pela
OpenRouter). Depois de cada demanda, sem `await`, o servidor pergunta ao Jev
qual squad, qual sala, se é agenda ou tarefa e se pede contratação, compara com
o Gemini e grava. Nada do que ele responde é executado (RULES 27). Desenho,
retenção (ZDR é classificação da OpenRouter; a TypeSafe não publica prazo;
processamento nos EUA) e critérios de promoção em
`docs/referencia/perfis-e-experimentos.md`, "Jev em sombra".

**Ligar** (numa sessão no Dell, depois do merge e do `atualizar-central`). O
`~/.config/squadone/jev.env` (600) já tem a `OPENROUTER_API_KEY`, digitada
pelo Rômulo; nada abaixo a lê nem a imprime:

```bash
F=~/.config/squadone/jev.env
stat -c '%a' "$F"                                   # tem de dizer 600
grep -q '^SQUADONE_JEV_SOMBRA=' "$F" \
  && sed -i 's/^SQUADONE_JEV_SOMBRA=.*/SQUADONE_JEV_SOMBRA=true/' "$F" \
  || echo 'SQUADONE_JEV_SOMBRA=true' >> "$F"
# opcionais no mesmo arquivo: SQUADONE_JEV_TETO_DIA=50  SQUADONE_JEV_TETO_USD=1
#   SQUADONE_JEV_TIMEOUT_MS=5000  SQUADONE_JEV_GUARDAR_DEMANDA=true (padrão: só sha256 + tamanho)
cp ~/SquadOne/deploy/dell/squadone-operations.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart squadone-operations
journalctl --user -u squadone-operations -n 80 --no-pager | grep '\[jev\]'
```

Ligado, o log diz `[jev] sombra ligada: typesafe/jev-1.13, teto 50/dia e US$ 1
no total, timeout 5000 ms, ZDR exigido, US$ 0.00000 já gasto, registro em …`.
`[jev] sombra desligada: …` diz o que está ilegível (nunca a chave);
`[jev] desligado até reiniciar o processo: semCredito|credencial` é saldo ou
chave. A unit nova só acrescenta `EnvironmentFile=-%h/.config/squadone/jev.env`.

**Ler o resumo** (só lê):

```bash
cd ~/SquadOne && npx tsx scripts/jev-sombra-resumo.ts ~/.local/share/squadone/jev-sombra
```

**Desligar:** pôr `SQUADONE_JEV_SOMBRA=false` (ou apagar a linha) no
`jev.env` e `systemctl --user restart squadone-operations`. **Reverter de vez:**
apagar `~/.config/squadone/jev.env` e revogar a chave no painel da OpenRouter;
o registro (`~/.local/share/squadone/jev-sombra`) fica até decisão à parte, e
apagá-lo zera o contador do teto de gasto. Nada a desfazer no Google, no
Telegram ou no roster.

## Finanças (`/financas`, desde 07/10/2026)

Visão geral do que o Rômulo tem, deve e gasta, só no perfil `operations`.
Código em `server/financas/` (regras puras com testes) e
`src/operations/financas/`; regras de privacidade na RULES 24.

**Fonte:** Meu Pluggy (API da Pluggy, `api.pluggy.ai`, conector 200), uso
pessoal e gratuito. As conexões (Santander, Nubank, Mercado Pago) se fazem e
renovam no app Meu Pluggy; o SquadOne só lê. Leitura por **polling**: uma vez
por dia depois das 7h (`iniciarLeituraDiaria`, confere a cada 30 min; falhou,
tenta de novo depois de 2 h) e no botão **Atualizar agora** da tela. O webhook
da Pluggy exigiria URL pública, e o Funnel é proibido (RULES 7). Cada leitura
grava a cópia `financas.copia.db` com `VACUUM INTO` (é ela que vai ao cofre).

**Instalação (uma vez, numa sessão no Dell):**

1. O Rômulo digita a credencial no Dell, nunca pelo chat. O arquivo é só
   chaves, 600, fora do repo, do n8n e de `data/`:

   ```bash
   install -m 600 /dev/null ~/.config/squadone/financas.env   # se ainda não existe
   nano ~/.config/squadone/financas.env
   # PLUGGY_CLIENT_ID=...
   # PLUGGY_CLIENT_SECRET=...
   # PLUGGY_ITEM_IDS=id1,id2,id3
   ```

2. A lista de logins do Tailscale no `~/.config/squadone/operations.env`
   (RULES 7; a mesma do passo 0 de `CUTOVER-AGENDA.md`). Sem ela, finanças pela
   tailnet respondem 403 (de propósito); com ela, **toda** a Central passa a
   exigir o `Tailscale-User-Login` de quem chega pelo Serve:

   ```bash
   SQUADONE_LOGINS_TAILSCALE=sutil.romulo@gmail.com
   ```

3. O serviço novo (lê o `financas.env` e cria tudo 600 com `UMask=0077`):

   ```bash
   cp deploy/dell/squadone-operations.service ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user restart squadone-operations
   ```

4. O manifesto do cofre (`deploy/dell/backup/fontes.toml`) tira o
   `financas.db` vivo e passa a exigir a cópia; reinstale-o em
   `~/.config/backup-dell/fontes.toml`.

**Conferir sem ver valor** (nada disto imprime R$ nem estabelecimento):

```bash
ls -l ~/.config/squadone/financas.env ~/.local/share/squadone-operations/financas*.db   # -rw-------
journalctl --user -u squadone-operations | grep '\[financas\]'                         # contagens e status
```

**O cartão Santander Unique** vem da Pluggy com as faturas (total, vencimento,
pagamentos, encargos) e 0 lançamentos, e sem os cartões digitais. O "devo"
funciona pelas faturas; o "em quê gastei" vem da fatura em PDF importada na
tela (Visão → "Fatura do Santander em PDF"): o servidor lê o texto, mostra a
conferência contra o total da fatura da Pluggy (saldo anterior + débitos −
créditos, no centavo) e só grava no segundo toque. O PDF não é salvo.

## Pasta auto (Site antes da venda)

O n8n não cria diretórios. O Caçador grava pacotes
`{"caminho", "base64", "pastas"?}` em `~/.local/share/auto-entrada`, e
`auto-entrada` (disparado por `auto-entrada.path`) materializa cada um em
`~/auto-site/<caminho>`. `~/auto-site` é a pasta de verdade. A esteira não lê
o Drive: o espelho no Drive (`PRUMO/Sites antes da venda`, a cada hora) é feito
pelo backup, só no sentido Dell → Drive (ver "Backup no Drive"). Até 25/09/2026
o Syncthing a espelhava em `G:\Meu Drive\auto` pelo PC.

```bash
install -m 755 deploy/dell/auto-entrada.py ~/.local/bin/auto-entrada
mkdir -p ~/.local/share/auto-entrada && chmod 777 ~/.local/share/auto-entrada
cp deploy/dell/auto-entrada.path deploy/dell/auto-entrada.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now auto-entrada.path
```

Desde 29/09/2026 as pastas também mudam de lugar sozinhas. A cada hora o
Balcão grava em `~/.local/share/n8n-estado/site-pastas.json` o que mover, e
`site-pastas` (disparado por `site-pastas.path`) move: respondeu no WhatsApp
→ `_em-conversa/`; `expirado` (10 dias sem resposta) → `_concluidos/`. Só vale
para resposta ou envio a partir de 29/09/2026 (o acervo fica onde está), só
tira pasta da raiz (ou de `_concluidos/` quando um expirado responde), confere
o `place_id` do `publicado.json` e nunca sobrescreve. `site-pastas --listar`
mostra o que faria.

Desde 30/09/2026 o `site-pastas` também atende os botões da página do lead
(ver "Página do lead e pausa dos demos"): um pacote por toque em
`~/.local/share/n8n-estado/site-acoes/` (segundo gatilho do `.path`,
"diretório não vazio"; o pacote lido é apagado, o ilegível vai para
`~/.local/share/site-acoes-erro/` com aviso). Recusou → `_recusados/`, Fechou →
`_fechados/` (pasta nova), de onde a pasta estiver; Desfazer devolve para onde
estava (pilha em `~/.local/state/site-pastas/acoes.json`; sem histórico, de
`_recusados/` vai para `_em-conversa/`). Cada mudança por botão ganha uma linha
no `registro.md` (`**Recusou.**`, `**Fechou.**`, `**Recusa desfeita.**`...).
`_descartados/` nunca entra.

```bash
install -m 755 deploy/dell/site-pastas.py ~/.local/bin/site-pastas
cp deploy/dell/site-pastas.path deploy/dell/site-pastas.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now site-pastas.path
```

## Backup no Drive (`backup/`)

Desde 28/09/2026 o Dell manda direto ao Drive, sem PC:
- espelho só de leitura em `PRUMO/Sites antes da venda` (de `~/auto-site`, a
  cada hora) e em `PRUMO/Consultoria` (de `~/prumo`, diário);
- cofre restic cifrado em `Backups/dell-worker` (home, n8n e chave, Hermes,
  segredos), às 03:30, com ensaio de restauração mensal.

Um manifesto (`backup/fontes.toml`) e um runner (`backup-dell`). Instalação,
decisões e alertas em `backup/README.md`; restauração em `backup/RESTAURAR.md`.

## Scripts de operação do n8n (`claude-ops/`)

Copiados para `~/.local/share/claude-ops` no Dell. `n8n.py` é o cliente da
API (chave de operações em `~/.config/claude-ops/n8n-api-key`);
`aviso-de-falha.py` liga o Error Workflow em todos os fluxos;
`prumo-ajustes.py` e `site-antes-da-venda.py` aplicam as mudanças de
23/09/2026; `prumo-aviso-unico.py` faz a resposta do formulário fora dos
prospects avisar uma vez só (memória em `~/.local/share/n8n-estado/prumo-avisados.json`,
24/09/2026; apagar o arquivo faz cada resposta avisar mais uma vez). A memória
do fluxo (`$getWorkflowStaticData`) não serve aqui: o n8n só a grava quando o
id do fluxo tem até 21 caracteres, e os fluxos importados do PRUMO usam UUID;
`rodar-agora.py <id>` executa um workflow agora.

## Links rastreados e pendências (`claude-ops/fecha-ciclos.py`)

`wa_link` (Site antes da venda) e "Enviar convite" (PRUMO) apontam para
`https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook/enviar` e
`/webhook/convite`: o clique marca o envio e redireciona ao canal. Desde
29/09/2026 o `tailscale serve` do Dell publica `/webhook` do n8n nesse
endereço, **só para a tailnet** (não é Funnel; `/` continua sendo o Hermes).
O link abre em qualquer aparelho logado na tailnet com a conta do Rômulo:
no celular, instale o Tailscale e entre com a mesma conta. Até 29/09 a base
era `127.0.0.1:5679`, que só abria no Dell.

```bash
sudo tailscale serve --bg --set-path /webhook http://127.0.0.1:5679/webhook
tailscale serve status   # / -> 9119 (Hermes), /webhook -> 5679/webhook
cd ~/.local/share/claude-ops && python3 fecha-ciclos.py --tailnet   # base no Lead Scout e convites em Revisar
```

O Balcão remonta o `wa_link` dos leads `pronto` a cada hora
(`balcao-cruzar.js`); os textos das mensagens ficam em `site-mensagem.js`.

**Mensagens do PRUMO** (08/10/2026, plano PRUMO seção 5). A primeira mensagem
tem duas variações: **A** (controle, "Encontrei vocês no Google…") e **B** (a
nota e o número de avaliações do Google, das colunas `nota` e `avaliacoes` que
o Caçador grava). A B só entra no sorteio do lead com nota **4,3 ou mais** e
**15 avaliações ou mais**; sem os dois, o lead sai na A. Entre os que têm nota
boa, metade A e metade B, pela letra do `place_id`. A **C** oferece o Raio-X
(`<demo>/raio-x`, `raio-x.py`) e só entra para o lead cujo `publicado.json` tem
`raio_x_url` e `raio_x_pontos` (1 a 3): o texto diz quantos pontos a página
mostra ("1 ponto que faz", "2 pontos que fazem"), nunca "3" fixo. O Balcão grava
o `raio_x_url` na coluna de mesmo nome (o `--balcao` cria) porque a segunda
mensagem e o follow-up são montados da linha: quem recebeu a C ganha o raio-x e
o site na segunda, e o follow-up lembra o raio-x. Sem a coluna preenchida, a
segunda é a do site. Um lead `pronto` que o Raio-X alcança pode trocar de letra
uma vez. A segunda mensagem termina com o preço do
Encontrado (R$ 990 + R$ 69/mês, pago depois de ver no ar; em inglês, sem
número), e os dois follow-ups do 3º dia são os do plano. O CRM espelha a
segunda e os follow-ups em `server/site-mensagem.ts` (teste compara com o JS).
Ao comparar A e B no funil, lembre que a A também recebe os leads de nota baixa.

**O que cada lead recebeu** (07/10/2026, para o funil aprender comparando). Duas
colunas no fim da aba Leads, gravadas pelo Balcão (`python3
site-antes-da-venda.py --colunas` cria; o `--balcao` também):

- `mensagem_variante`: a letra do texto que o `wa_link` leva (`A`, `B`, `C` de
  `VARIACOES`; `EN` nos EUA; vazio sem telefone). A letra sai do `place_id`, não
  da ordem da rodada, então um lead `pronto` não troca de variação entre duas
  rodadas (nem com a B, porque a nota da linha não muda depois do Caçador);
  com B e C `null`, todo lead é `A`. É gravada enquanto o lead está
  `pronto`: o clique no `wa_link` marca `enviado` e a letra fica. Quando o envio
  aparece sem o clique (o observador vê `owner_sent`, a leitura ou a resposta de
  um lead ainda `novo`/`pronto`), o observador grava `manual`: o texto foi o que
  o Rômulo escreveu ou colou (o aviso "Site publicado" do Hermes sugere o texto
  A sem o detalhe dos elogios, mas não dá para saber se ele editou). Limite: o
  clique com `marcar=nao` (operador do Dell) não deixa rastro para o observador,
  e esse envio também vira `manual`. Envios de antes de 07/10 ficam vazios.
- `site_versao`: `padrão`, `personalizado-v1`, `personalizado-v2`... lida do
  `personalizado.json` da pasta do lead (`gerador-de-sites.py`; sem o arquivo, o
  site saiu no modo padrão). Gravada a cada hora para o lead `pronto` e, para o
  resto, só quando a coluna ainda não diz a da pasta (lead enviado nunca é
  refeito). As cópias `<slug>/_v1/` do modo personalizado têm `publicado.json` com
  o mesmo `place_id` e são ignoradas (até 07/10 elas faziam o lead "morar" em
  `slug/_v1` no retrato e nas contas do Balcão).

```bash
cd ~/.local/share/claude-ops
python3 site-antes-da-venda.py --testar       # cruzamento no node, planilha de mentira, sem n8n
python3 site-antes-da-venda.py --testar-n8n   # cópia do Balcão: recibos reais, planilha de mentira, nada gravado
python3 site-antes-da-venda.py --balcao       # colunas que faltam + publica o Balcão
```
O texto do convite do PRUMO fica em `prumo-simples.py` (função `convite`) e é
montado a cada clique; `python3 prumo-simples.py --convite` publica só esse
fluxo, sem mexer na planilha, no Lead Scout nem na Pontuação. Desde 30/09/2026
todas as mensagens abrem com "Me chamo Rômulo e represento o Prumo" (decisão em
`romulosutil/prumo`, `00-contexto/decisoes.md`), e o aviso do Hermes
(`site_antes_venda_watcher.py`) repete a abordagem do Site.

Depois do envio (`claude-ops/site-acompanhamento.py`, 29/09/2026):

- **05 · Acompanhamento** (todo dia, 09:00): `enviado` sem `respondeu_em`,
  enviado a partir de 29/09 e com a pasta na raiz ganha, no 3º dia, um aviso
  com o follow-up pronto (link `wa.me` com o texto) e a data em `followup_em`;
  no 10º dia vira `expirado`. O que foi enviado antes é acervo: saiu um resumo
  único (`--resumo-backlog`) e nada é automático.
- **06 · Funil semanal** (segunda, 08:00): por nicho (vertical + cidade)
  leads, sites, enviados, responderam, em conversa, recusados e concluídos.
  Aviso pelo Hermes e `n8n-estado/site-funil.json`, sem `itens` (não vira
  pendência).
- **Nicho sem sinal de compra é pausado** (08/10/2026, decisão do Rômulo:
  "parar qualquer coisa que seja ruim de lead"). A regra mora em
  `claude-ops/site-funil-regra.js` (funções puras, coladas no nó Funil) e vale
  para a busca (segmento × cidade) e para o **nicho inteiro** (a coluna
  `vertical` da aba Buscas, somando as cidades): 20+ enviados e nenhum sinal
  de compra pausa. Sinal de compra = resposta `interesse` (o classificador já
  põe "quanto custa?" ali), pedido de preço no `resposta_trecho` de resposta que
  não é negativa nem robô, proposta aberta na aba CRM ou `status` `fechado`.
  Negativa, exclusão, robô e neutra **não** são sinal: pousada chegou a 35
  enviados, 8 respostas (6 negativas, 2 neutras) e nenhum interesse, e a regra
  do silêncio não a pegava por causa das neutras. Nicho sem sinal pausa as
  buscas ligadas dele, inclusive as que ainda não enviaram, e os leads `novo`
  dele vão para `nao_gerar` mesmo sem busca dona. Uma busca do nicho religada
  (TRUE em `ativa` com `pausada_em`) religa o nicho: as buscas novas dele não
  caem na regra do nicho. Envio só conta para qualquer pausa depois de 3 dias
  (o follow-up): em 08/10 os 13 envios de advocacia eram do mesmo dia, e o
  silêncio pausaria "advogado" em Brasília com 5 mensagens de poucas horas.
  Sinal de compra conta na hora. Sem a aba CRM lida, a regra do sinal fica
  parada na semana e o aviso diz. O aviso de segunda lista os nichos sem sinal
  ("pausado agora", "já estava pausado", "religado por você") com o porquê, e
  o `site-funil.json` ganha `segmentos` (enviados, sinais, tipos de resposta).
  Simular com as abas reais, sem gravar: `python3 site-acompanhamento.py
  --simular`. Em 08/10/2026 a simulação deu só pousada (33 enviados maduros, 4
  negativas, 2 neutras, 0 sinal), já pausada à mão na migração.
- **Busca que não paga o site é pausada** (desde 05/10/2026; antes o funil só
  a listava como candidata e o Caçador seguia rodando): ativa, 5+ enviados e
  nenhuma resposta humana (`respondeu_em` a 5 min ou mais do envio, ou pasta
  em `_em-conversa/`) vira `ativa` FALSE na aba Buscas, com `pausada_em` e
  `pausa_motivo`, e o aviso diz quais. Religar é pôr TRUE em `ativa`: com
  `pausada_em` preenchida a regra não pausa de novo. O retrato ganha
  `nao_gerar` (leads `novo` de busca desligada), que o gerador de sites deixa
  fora da fila.
- **A vez entre as buscas ativas** (`claude-ops/site-cacador-escolha.py`, desde
  05/10/2026): o Caçador roda uma busca por dia, a mais atrasada, e o atraso
  das `PREFERIDAS` (advocacia, desde a migração abaixo) conta em dobro. Nunca
  rodada continua primeiro.
- **Site no ar não vira pasta** (`claude-ops/site-cacador-site-no-ar.py`,
  código do nó em `site-cacador-site-no-ar.js`, 07/10/2026): o "Checar site
  próprio" do Caçador era um GET de 10 s na raiz do domínio, e 74 leads
  ganharam o +40 de "site próprio fora do ar" assim; 22 terminaram em
  `_descartados/` com o site respondendo (Baby School: o `www` deu timeout, a
  raiz respondia com WordPress completo, e ela respondeu "hoje já temos uma
  agência"). Agora o nó é um Code que testa o link do Google (Wix, Canva e
  landing page moram no caminho) e a raiz em https e http, com e sem www,
  seguindo redirecionamento e com User-Agent de navegador, em até 3 rodadas
  espaçadas de 30 s. O IF "Site no ar?" manda quem tem conteúdo real (2 mil
  caracteres de texto visível; não é estacionamento, "Hello world", página
  padrão de hospedagem nem redirecionamento para rede social ou diretório) para
  o "Linha descartada" **antes do Gemini e do gerador**, com o motivo e a URL
  no `briefing` ("tem site: …"); crédito no rodapé ("Desenvolvido por <link>")
  vira "tem site e agência (<domínio>)". O +40 só vem depois das 3 rodadas sem
  nada. Responde mas não dá para ler (anti-robô, página só de JavaScript, menos
  de 2 mil caracteres; com caminho, raiz que não cita o nome do negócio) fica
  de fora sem planilha, como o site no ar ficava antes; link que só leva a
  anúncio em diretório (`*.traveleto.com`) segue sem o +40, como quem não tem
  site. Quem já está na planilha não muda. O que muda de comportamento: site
  no ar passa a ir para a planilha (antes saía calado e era reconferido a cada
  rodada da busca), então um site que cair depois não volta sozinho. Ensaio de
  08/10/2026 nas 82 URLs que tinham ganhado o +40: das 22 que o gerador
  descartou, 8 viram "tem site" e 10 ficam de fora; as outras 4 seguem fora do
  ar (DNS sumiu). `--ensaiar URL[::Nome]` roda o código contra os sites de
  verdade e mostra o estado de cada link testado, sem n8n nem planilha.
  Aplicar (Rômulo de acordo): `cp ~/SquadOne/deploy/dell/claude-ops/site-cacador-site-no-ar.{py,js} ~/.local/share/claude-ops/ && cd ~/.local/share/claude-ops && python3 site-cacador-site-no-ar.py`
  (guarda o fluxo anterior em `backups/cacador-<data>.json`). Voltar:
  `python3 -c 'import json, sys; from n8n import api, put; put(json.load(open(sys.argv[1]))); api("POST", "/workflows/oow8TkxrAf4fVvTj/activate")' backups/cacador-<data>.json`
  na mesma pasta.
- **Resposta negativa não segura a busca** (05/10/2026): para a pausa, só conta
  resposta com `resposta_tipo` que não seja `negativa`, `exclusao` (desde
  07/10/2026) nem `bot` (ou pasta em
  `_em-conversa/`). Antes, "não tenho interesse" mantinha pousada e eventos
  ativas.
- **Migração de nicho** (`claude-ops/site-nichos.py`, 05/10/2026): 83 envios
  para B2C de vitrine (pousada, eventos, estética, academia...) deram 11
  respostas, todas negativas, e 0 vendas. O script pausou as 11 buscas ativas
  (`pausa_motivo` "migração de nicho") e ligou 16 buscas novas, de serviço que
  o cliente procura no Google para contratar: desentupidora, dedetizadora,
  caçamba, contabilidade, advocacia (4 buscas; é o dono que mais procura "site
  para advogado" no Google Trends), usinagem, caldeiraria, locação de andaimes,
  reformas e engenharia, em cidades médias. No Caçador, a regra 1 do Gemini
  passou a aceitar escritório, indústria, empresa que atende na casa do cliente
  e profissional liberal com escritório; o Pontuar dá +15 a esses ramos e não
  tira 10 de quem não posta no Instagram. O `~/auto-site/CLAUDE.md` ganhou a
  seção do gerador para eles (OAB sóbria, sem avaliações na página de
  advocacia; B2B com "Pedir orçamento"; urgência com botão fixo); desde
  08/10/2026 ela vive no arquivo versionado (`deploy/dell/auto-site/`, ver
  "Gerador de sites") e o script não reescreve mais a cópia. Rodar de novo
  não muda nada; `--testar` e `--testar-vivo` não gravam.
- `python3 site-acompanhamento.py --testar` roda cópias dos dois sem gravar;
  `--testar-regra`, `python3 site-cacador-escolha.py --testar` e
  `python3 site-cacador-site-no-ar.py --testar` (HTTP de mentira, mais o
  `node --check` do código) rodam só o código dos nós no node, sem n8n nem
  planilha.

**Lead Scout desligado** (08/10/2026): o convite frio a distribuidoras deu 57
convites, 21 respostas de robô e nenhum dono interessado; a empresa com equipe
chega pela CDL ao Mapa, grátis, e a Fonte só vem depois dele (09/10). O fluxo `e02c6f43-…` fica no n8n, inativo, e `n8n.DESLIGADOS`
(`claude-ops/n8n.py`) faz o `POST /activate` dos `prumo-*.py` e do
`fecha-ciclos.py` virar um aviso em vez de religá-lo. Religar: tirar o id de
lá (PR), instalar e ativar no n8n.

Balcão e Lead Scout gravam contagens em `~/.local/share/n8n-estado/*.json`,
que o `dell-status` mostra em "Esperando você" na Central. "Enviados esperando
resposta" conta só quem ainda está na raiz de `~/auto-site`. `claude-ops/prumo-rodizio.py` põe o Lead Scout em rodízio de
buscas. `claude-ops/prumo-porte-cnpj.py` liga o filtro de porte (código do nó
em `prumo-porte-cnpj.js`): acha o CNPJ no site, consulta a Receita pela
BrasilAPI e descarta MEI, microempresa, rede, CNPJ baixado e quem não é
comércio. Quem passa leva o resumo do CNPJ na coluna Briefing.

## Página do lead e pausa dos demos (`claude-ops/site-lead-acoes.py`, `site-demos-pausa.*`)

Decisões do Rômulo de 29/09/2026: o Hermes **não manda mensagem a lead**
(risco de banimento do WhatsApp), mas o desfecho de cada lead se marca com um
toque no celular; e demo de quem recusou ou expirou é **pausado** na Vercel 15
dias depois, nunca apagado.

**Página do lead** (fluxo `07 · Lead: página e ações`, id `Kf5IWNdEFFnuSOy2`):
`…/webhook/lead?id=<place_id>` pela tailnet (mesma base do `wa_link`) mostra
nome, link do demo, estado e três botões. Nada é enviado a ninguém:

- **Recusou**: `status` = `recusado`, `recusado_em`, pasta → `_recusados/`;
- **Fechou**: `status` = `fechado`, `fechado_em`, pasta → `_fechados/`;
- **Desfazer** (só em recusado/fechado): volta a `status_anterior` (sem ele,
  `enviado`), apaga a data, a pasta volta para onde estava.

Repetir um toque não muda nada; id desconhecido mostra "lead não encontrado" e
não grava. Lead em `_recusados/` sem `recusado` na planilha (acervo de 25/09)
já conta como recusado; Desfazer nele só tira a pasta de lá. O fluxo grava a
planilha (colunas `status_anterior`, `recusado_em`, `fechado_em`,
acrescentadas no fim da aba Leads) e o pacote do `site-pastas`, espera 2 s e
volta para a página. A cada hora (:20) grava o retrato
`n8n-estado/site-leads.json` (sem `itens`: não é pendência) e preenche a coluna
`acoes_link` de quem tem site. Desde 07/10/2026 cada lead do retrato leva também
`resposta_tipo`, `mensagem_variante` e `site_versao` (o que recebeu e o que
respondeu; ver "Links rastreados"), e `pasta` não cai mais na cópia `_v1/` do
modo personalizado. `python3 site-lead-acoes.py --testar-retrato` confere o
código do retrato no node, sem n8n (o `--testar` roda ele antes). O resumo das 10:30
(`deploy/hermes/scripts/sites_e_pendencias.py`) lê esse retrato e põe uma linha
com o link para cada enviado sem resposta e cada lead em conversa (até 15 por
grupo, os mais antigos primeiro).

Desde 08/10/2026 a limpeza (abaixo) **apaga** o demo de todo lead em Perdido no
CRM dois dias depois, então a pausa de 15 dias quase não chega a agir: fica
para o que a limpeza não pega (Central fora do ar, lead fora do teto da rodada).

**Pausa dos demos** (`site-demos-pausa`, todo dia às 09:40, depois do 05 e do
Balcão): a pasta diz quem está fora (`_recusados/` = recusado, `_concluidos/` =
expirado; `fechado` na planilha veta). Conta 15 dias desde `recusado_em` (ou
`enviado_em` + 10 dias para expirado) do retrato; sem isso (acervo), a data
mais recente entre a linha `**Recusou.**` do `registro.md` e a ctime da pasta,
congelada no estado; sem nada, o primeiro dia em que viu. Só toca em projeto
`demo-*` de um `publicado.json`, só despausa o que ele pausou, nunca apaga.
Quem volta (Desfazer, expirado que responde) tem o demo de volta no ar: o
`site-pastas` acorda o serviço logo depois de um botão. Estado em
`~/.local/state/site-demos-pausa/` (`estado.json`, `historico.jsonl`); um aviso
por rodada, só quando algo mudou. Token: o da Vercel CLI (`auth.json`),
renovado pela CLI quando está para vencer; a API de pausa só aceita o id
`prj_…`. Em 30/09/2026 os 74 leads de `_recusados/` (73 projetos) contam desde
25/09 (ctime + balanço do `registro.md`): pausa em 10/10/2026.

**Limpeza dos demos de leads perdidos** (`site-demos-limpeza`, desde 07/10/2026;
critério de 08/10/2026, todo dia às 09:50 e uma vez por dia no `lote-continuo`).
Decisão do Rômulo (08/10): lead que entrou em **Perdido** no CRM não fica com o
demo no ar ("já temos o backup dele no Dell"); a Vercel hobby limita projetos e
demo de lead perdido ocupa a vaga do gerador. O script não refaz as regras de
etapa: lê a visão da Central (`GET http://127.0.0.1:9120/api/operations/crm`) e
apaga o projeto `demo-*` de todo lead do Site em Perdido há **2 dias ou mais**
(recusou, 7 dias sem mensagem do lead, parou de responder, sem contato fácil,
descartado), com a pasta na raiz, em `_recusados/`, `_concluidos/`,
`_em-conversa/` ou `_descartados/` (`_fechados/` nunca) e o `publicado.json`
dela confirmando o projeto. A pasta fica; o `publicado.json` ganha `apagado_em`,
o `site-demos-pausa` passa a ignorá-lo e o CRM tira "Ver o demo" e a segunda
mensagem (levariam a um link morto) e diz na ficha para republicar antes. Os
2 dias de folga são para desfazer um "Recusou" tocado errado ou para a resposta
de amanhã. Central fora do ar, visão sem retrato válido, sem as pastas lidas ou
com retrato de mais de 1 h = nada é apagado. No máximo **60 por rodada**, os
mais antigos em Perdido primeiro: um erro de regra não leva a Vercel inteira de
uma vez. **O timer apaga sozinho** (`--apagar`) e manda um aviso com o que saiu:

```bash
site-demos-limpeza --simular             # quem entra e por que os outros perdidos não, sem aviso nem estado
site-demos-limpeza --apagar              # apaga os que entram (o timer e o lote-continuo)
site-demos-limpeza --apagar demo-a demo-b   # só esses (têm de estar entre os que entram)
```

Em 08/10/2026 a simulação contra a Central de então (antes da regra dos 7 dias
chegar a ela) dava 88 demos, todos de quem recusou (o acervo de 25/09 incluso):
o teto de 60 os leva em duas rodadas, junto com os que a regra dos 7 dias põe
em Perdido.

**Pedido de exclusão** (`--exclusao`, 07/10/2026). A regra acima não serve a
quem pediu para apagar: o lead foi marcado `recusado`, e recusado nunca entra.
O classificador do WhatsApp grava `resposta_tipo` `exclusao` e o aviso pelo
Hermes traz o comando; **nada apaga sozinho** (RULES 10: mensagem recebida
propõe). O comando confere o pedido no retrato, então só vale depois do
próximo `:20` (o aviso diz a hora):

```bash
site-demos-limpeza --exclusao                  # lista os pedidos com o demo ainda no ar e o comando de cada um
site-demos-limpeza --exclusao demo-baby-school # apaga esse demo (só pelo nome)
```

Só entra projeto `demo-*` de um lead com `resposta_tipo` `exclusao` no retrato
(de até 3 h), que não está fechado, com a pasta na raiz, em `_recusados/`,
`_em-conversa/` ou `_concluidos/` e o `publicado.json` dela confirmando o
projeto. Um nome que não entra = nada é apagado. A pasta fica (o
`publicado.json` ganha `apagado_em`); se o pedido for de apagar tudo, apague a
pasta à mão. No histórico, `apagou_a_pedido`.

Pelo `vercel project rm` à mão (pede confirmação; o `y` vem do `printf`):
`printf 'y\n' | vercel project rm demo-x --scope romulodesigns`. Para trazer um
demo de volta basta republicar a pasta (`vercel link` + `vercel deploy`, como o
passo 5 do gerador). Estado e histórico em `~/.local/state/site-demos-limpeza/`.

```bash
install -m 755 deploy/dell/site-demos-limpeza.py ~/.local/bin/site-demos-limpeza
cp deploy/dell/site-demos-limpeza.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now site-demos-limpeza.timer
python3 deploy/dell/site-demos-limpeza.test.py
```

```bash
cp deploy/dell/claude-ops/site-lead-acoes.py ~/.local/share/claude-ops/
cd ~/.local/share/claude-ops
python3 site-lead-acoes.py --testar        # cópia com planilha de mentira, não grava nada
python3 site-lead-acoes.py                 # colunas que faltam + publica e ativa o 07
python3 site-lead-acoes.py --retrato-agora # retrato + acoes_link agora
python3 site-lead-acoes.py --verificar ChIJ64zCC14ZqwcRJ2DcIs-rioA   # id falso + I&C (já recusada): nada muda

install -m 755 deploy/dell/site-demos-pausa.py ~/.local/bin/site-demos-pausa
cp deploy/dell/site-demos-pausa.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now site-demos-pausa.timer
site-demos-pausa --simular   # o que pausaria agora e depois, com a evidência de cada data
```

## CRM (`/crm`, fluxo `08 · CRM`, `claude-ops/crm.py`)

Pedido do Rômulo (30/09/2026): "não sei quem viu, quem não viu, quem já
respondeu, quem recusou" e um CRM simples para o Site antes da venda e o
PRUMO. **A fonte da verdade são as planilhas**; todo sinal já escreve nelas
sozinho (clique no `wa_link`/"Enviar convite" e o que o Rômulo escreve →
enviado; recibo de leitura → `visto_em` ou "Leu o convite em ..."; resposta →
`respondeu_em`/"Respondeu no WhatsApp em ..."; 05 → `followup_em` e
`expirado`; página do lead → `recusado`/`fechado`). As pastas espelham a
planilha (`site-pastas`). A Central não tem etapa própria.

**Ciclo de vida (as 5 etapas, iguais para os dois produtos).** Regras em
`server/crm.ts` (`etapaDoSite`, `etapaDoPrumo`, `comPrazoDoContato`); nomes de coluna em
`COLUNAS_DO_SITE`/`COLUNAS_DO_PRUMO` (coluna ausente = vazia, com aviso na tela).
A primeira linha que casar, de cima para baixo, decide:

| Etapa | Site antes da venda (aba Leads + pasta) | PRUMO (aba Prospects) |
|---|---|---|
| **Ganho** | `status` fechado | Etapa Concluído |
| **Perdido** | `recusado`; pasta em `_recusados/` (recusa anotada à mão); `expirado` sem resposta; `descartado`; pasta em `_descartados/`; a regra dos 7 dias (abaixo) | Etapa Sem interesse; a regra dos 7 dias |
| **Proposta** | "Proposta enviada" marcada na Central (aba CRM), até ser desfeita | idem |
| **Em contato** | `enviado` (ou `enviado_em`): "Viu" com `visto_em`, senão "leitura desconhecida"; `respondeu_em`, ou pasta em `_em-conversa/` | Convite enviado ("Leu o convite em ..." ou "leitura desconhecida"); "Respondeu no WhatsApp em ..."; Etapa Diagnóstico pronto / `Diagnóstico em` (Mapa, se houver, na linha do tempo) |
| **Novo** | `pronto` ("Pronto, não enviado"); `novo` com pasta na raiz ("Na fila do gerador", com os artefatos) | Etapa Revisar |

**Em contato tem prazo (08/10/2026; eram Contatado e Conversando, e a segunda
coluna passava dias vazia).** Sem mensagem do lead por `DIAS_SEM_RESPOSTA` (7)
dias, contados da última mensagem dele (`respondeu_em`, `resposta_em` que não
seja robô, `Diagnóstico em`) ou do envio/convite se nunca respondeu, o lead vai
para Perdido: "Sem resposta em 7 dias" (`expirou`) ou "Parou de responder"
(`esfriou`). Vale para o acervo e para o PRUMO, que não expiravam. O cartão
mostra "Perdido em N dias". Um **próximo passo** registrado na ficha segura o
lead (é o Rômulo dizendo que ainda vale) — inclusive o que a planilha já marcou
`expirado` no 10º dia —; uma **proposta** também; e uma mensagem nova do lead o
traz de volta sozinho. O CRM só calcula: a planilha continua com o status que
tem (o 05 · Acompanhamento segue expirando no 10º dia). Quem sai pela regra
cai na limpeza dos demos dois dias depois.

"Entregue sem lido" é **não sei**, nunca "não viu": quem desliga a confirmação
de leitura nunca aparece como lido; quem respondeu aparece como "leu
(respondeu)". Sinais: **follow-up hoje** (Em contato há 3 a 6 dias sem resposta;
no Site só envio a partir de 29/09 e uma vez por lembrete do 05; desde
08/10/2026 o link "Mandar o follow-up" abre o WhatsApp com o mesmo texto do
aviso do 05, de `server/site-mensagem.ts`, espelho testado do
`site-mensagem.js`), **resposta
nova** (respondeu nas últimas 48 h; exato quando houver colunas de última
entrada/saída), dias na etapa e desde o último evento, **divergência**
(planilha e pasta discordam depois de 2 h de folga: nota na ficha, nunca
correção).

**As vistas** (celular primeiro; `?ver=funil`, `?ver=resultados`,
`?produto=site|prumo`, `?lead=site:<place_id>`):

- **Resultados** (desde 08/10/2026): quem foi **enviado** no período (14 dias,
  30 dias, tudo; pela data de envio) e o que rendeu, por nicho, pela variação
  da primeira mensagem (`mensagem_variante`) e pela versão do site
  (`site_versao`): respondeu (gente; robô não conta), viu (só com confirmação
  de leitura), quis ver, recusou, fechou. Recusa só entre enviados (o acervo
  de `_recusados/` não recebeu mensagem rastreada); menos de 10 enviados leva
  o aviso "amostra pequena". Envios até 07/10 ficam em "Sem registro".
  Também por **horário do envio** (hora de São Paulo, na ordem do dia): até
  08/10/2026, 26 envios depois das 18h tiveram 0 respostas e, das 8h às 18h,
  15 de 65 (23%). Por isso a fila "Enviar um por um" avisa, fora do expediente
  de quem recebe (seg–sex 8h–18h, sáb 8h–12h), com a taxa medida dentro e fora
  dele; só avisa, enviar continua possível;

- **Hoje** (padrão): próximos passos vencendo, follow-ups, respostas para
  responder, prospects para revisar, propostas esperando e sites prontos para
  enviar, cada linha com a ação e o link que a resolve (`wa_link`, "Enviar
  convite", conversa no WhatsApp, site). Desde 08/10/2026 os sites prontos têm
  **Enviar um por um** (`?fila=envio`): uma folha com um site por vez, o demo, a
  mensagem que vai sair (o `?text=` do `wa_me`, lido antes do toque, porque o
  toque no `wa_link` já marca o envio), filtro por nicho e "Pular por agora".
  O toque fica lembrado no navegador por 30 min (`localStorage`, nunca na
  planilha) e o lead vai para o fim da lista com a hora, até o retrato
  confirmar; sem confirmação em 15 min, a linha pede para conferir a conversa;
- **Funil**: as 6 colunas com contagem, resumo do funil no topo, filtros por
  produto, nicho, cidade e busca; cartão com nicho · cidade, subetapa, dias na
  etapa, marcos (enviado → leitura → resposta, com data) e links. Novo mostra o
  estado do gerador e os artefatos de quem está na fila; Perdido mostra os
  motivos e esconde os descartados antes do contato até pedir;
- **Ficha**: etapa e subetapa, valor cru da planilha e pasta, linha do tempo
  com data e origem (automático: planilha, pasta, `publicado.json`, Mapa;
  manual: aba CRM), ações (Recusou/Fechou/Desfazer na página do lead do fluxo
  07; no PRUMO, a linha na planilha para mudar a Etapa) e os três registros
  manuais: **nota**, **próximo passo + data** e **proposta enviada** (e
  desfazer).

**Caminho dos dados.** O fluxo `08 · CRM: retrato e registros (Site antes da
venda + PRUMO)` (id `AsjxktRCqRJSmj9P`) lê Leads, Prospects e a aba **CRM**
da planilha do Site a cada 10 min e grava `~/.local/share/n8n-estado/crm.json`
(linhas como vieram, sem briefing, endereço, telefone e nota do Google; sem
`itens`, então não vira pendência no `dell-status` nem no Hermes). Leitura que
falha não apaga o retrato: vai para `crm-falha.json`, e a Central mostra o
retrato anterior com o motivo. Registro: ficha → `POST /api/operations/crm/registro`
→ servidor da Central → `POST 127.0.0.1:5679/webhook/crm-registro` com o
header `X-CRM` (credencial "CRM Central"; segredo em
`~/.config/claude-ops/crm-segredo`) → uma linha na aba CRM
(`em, produto, id, empresa, tipo, texto, data, origem`, gravada como RAW) → o
retrato é refeito na hora. Outro fluxo que queira atualizar o retrato depois de
um evento: `POST http://127.0.0.1:5678/webhook/crm-atualizar` com a credencial
"CRM Central".

```bash
cp deploy/dell/claude-ops/crm.py ~/.local/share/claude-ops/
cd ~/.local/share/claude-ops
python3 crm.py --testar   # cópia com planilhas de mentira: retrato, leitura caída, registro ok/inválido/sem segredo
python3 crm.py            # aba CRM (se faltar) + credencial + publica e ativa o 08 (backup em claude-ops/backups/<dia>/)
python3 crm.py --aba      # só a aba CRM (precisa da credencial do Google viva)
python3 crm.py --agora    # retrato agora
curl -s http://127.0.0.1:9120/api/operations/crm | head -c 300
```

## Mapa do PRUMO (`prumo-mapa/`)

Pendência P3 de `~/prumo` (29/09/2026): diagnóstico pronto vira o rascunho do
Mapa, sem montar à mão. O fluxo "PRUMO — Diagnóstico do dono" tem um ramo
`Mapa: ...` (aplicado por `claude-ops/prumo-mapa-n8n.py`) que, para cada
resposta completa de um prospect, grava um pacote em
`~/.local/share/n8n-estado/mapa-fila/`, uma vez por resposta (memória em
`n8n-estado/prumo-mapa-feitos.json`). `prumo-mapa.path` dispara
`prumo-mapa --fila`, que:

- consolida pelo método de `~/prumo/05-entrega-mapa` (regra do MIN,
  divergência dono × time, 6 blocos, Índice do Prumo X/18, que o documento
  chama de **Nota de autonomia** desde 09/10/2026; a planilha segue com o
  Índice /100 do fluxo, e o pacote leva os dois). A conta (IDs, rollup, MIN,
  kit de fórmulas, arredondamento) é a do `calculo_prumo.py`, o mesmo módulo do
  Raio-X; `python3 deploy/dell/prumo-mapa/calculo_prumo.test.py` confere a Vale
  Norte (5,0/18, R$ 15.232/mês, R$ 182.784/ano);
- grava `~/prumo-entregas/<AAAA-MM-DD>-<empresa>/` com `dados.json`, o HTML e
  o PDF (7 páginas A4, visual do exemplo Vale Norte, Archivo embutida);
- avisa o Rômulo pela fila de avisos. Pacote ruim vai para
  `~/.local/share/prumo-mapa-erro/`, com aviso; resposta repetida é descartada.

O `dell-status` confere o gatilho, a fila e a pasta de erro (verificação
`prumo-mapa`, ver "Monitor do Dell"); a Central mostra o estado no passo
"Rascunho do Mapa em PDF" e na sala Organizar.

O formulário só tem as respostas do dono: mapa de dependência, inventário,
travas em reais e recomendação saem como `[PREENCHER]` (página que estoura
sai com faixa vermelha). Completar o `dados.json` (travas pelo kit de
fórmulas: `tempo_dono`, `margem`, `retrabalho`) e rodar
`prumo-mapa <pasta>/dados.json` refaz HTML e PDF, sem aviso. Nada vai ao
cliente, e `~/prumo-entregas` fica fora dos repositórios (dado de cliente).
`exemplos/vale-norte-completo.json` reproduz o documento Vale Norte inteiro;
`exemplos/pacote-n8n-vale-norte.json` é o pacote como o n8n grava.

`prumo-pdf <arquivo.html> [saida.pdf] [--param chave=valor]` imprime qualquer
peça HTML do PRUMO (proposta; apresentação com `--param empresa=...`) num
Chrome headless com perfil descartável, sem encostar no Chrome do Hermes.
Substitui o "Chrome → Ctrl+P" e o `gerar-pdf.ps1`.

```bash
mkdir -p ~/.local/share/prumo-mapa
cp -r ~/SquadOne/deploy/dell/prumo-mapa/{prumo_mapa.py,prumo_pdf.py,modelo_mapa.py,calculo_prumo.py,archivo.woff2,exemplos} ~/.local/share/prumo-mapa/
ln -sf ~/.local/share/prumo-mapa/prumo_mapa.py ~/.local/bin/prumo-mapa
ln -sf ~/.local/share/prumo-mapa/prumo_pdf.py ~/.local/bin/prumo-pdf
cp ~/SquadOne/deploy/dell/prumo-mapa/prumo-mapa.{path,service} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now prumo-mapa.path
cp ~/SquadOne/deploy/dell/claude-ops/prumo-mapa-n8n.py ~/.local/share/claude-ops/
cd ~/.local/share/claude-ops && python3 prumo-mapa-n8n.py --teste && python3 prumo-mapa-n8n.py
```

`prumo-mapa-n8n.py --teste` ensaia o ramo numa cópia temporária do fluxo
(prospects e respostas de exemplo, fila e memória de teste, sem planilha).
`prumo-simples.py` recria o fluxo sem o ramo: depois dele, rode
`prumo-mapa-n8n.py` de novo.

## Gerador de sites (`gerador-de-sites.*`)

Desde 23/09/2026 a fila do "Site antes da venda" é gerada no Dell, não no PC:
a tarefa `EsteiraLeads08h` do PC só rodava com ele ligado às 08h e não gerava
nada desde 17/09 (ficou desativada e se perdeu com o PC em 25/09/2026). O
runner é o porte do `executar-fila-leads.ps1`, na mesma pasta
(`~/auto-site`): até 4 leads por dia,
45 min por lead, timer persistente (Dell desligado às 08h roda quando voltar).
Lead com 2 falhas em `falha.log` sai da fila; apagar o arquivo o devolve.
`python3 ~/.local/bin/gerador-de-sites --listar` mostra a fila sem gerar nada.

Desde 29/09/2026 nenhum erro de um lead derruba o lote (naquele dia o Claude
achou site no ar, moveu o lead para `_descartados/` e o `falha.log` na pasta
sumida matou a execução, com 3 leads sem tentar):

- lead que o Claude move para uma `_*/` durante a geração é **descartado**:
  não é falha, vai para o log (`.logs/execucao-fila.log`) e o lote segue;
  pasta que some sem ir para nenhuma `_*/` é **sumida** (log de erro, atenção
  na Central);
- descartados e sumidos não contam nos 4 sites do dia, mas têm teto de 4 por
  execução; não começa lead que passaria do teto de 4 h do systemd;
- exceção dentro de um lead vira falha dele (com traceback no log do lead);
  SIGTERM e erro fora de um lead gravam `erro` no resumo;
- `.logs/status.json` ganhou `tentativas`, `descartados`, `sumidos`, `inicio` e
  `erro` no `ultimo_resumo`; o `dell-status` lê esse resumo (ver "Monitor do
  Dell"). `python3 deploy/dell/gerador-de-sites.test.py` testa isso numa pasta
  temporária, sem Claude nem Vercel.

Desde 05/10/2026 **quem move o lead descartado é o runner**. Naquele dia o
Claude concluiu que o `baby-school-bercario-maternal` já tinha site no ar, mas
a lista de permissão só o deixa escrever na pasta do lead: não moveu para
`_descartados/`, o lead contou como falha duas vezes (2/2 no `falha.log`,
serviço FAILED, aviso no WhatsApp). Agora:

- o Claude grava `<slug>/DESCARTAR.md` (primeira linha = motivo; depois as
  evidências) e a linha `— (não publicado)` no `registro.md`, e termina sem
  `index.html`/`publicado.json` (as instruções da execução dizem isso);
- o runner, quando o Claude sai, move a pasta para `_descartados/` (slug que já
  está lá ganha sufixo `--AAAAMMDD-HHMMSS`, nunca sobrescreve) e conta como
  **descartado**, com o motivo no log do lead. `DESCARTAR.md` vence até um
  `index.html` completo: lead descartado nunca vai para a Vercel;
- pasta com `DESCARTAR.md` nunca entra na fila; se o movimento falhar, conta uma
  falha (atenção na Central) e o começo da próxima execução tenta de novo, sem
  gastar o teto do dia. Gravar o arquivo à mão também descarta;
- o runner não escreve na planilha: desde 08/10/2026 o **Balcão** (de hora em
  hora) lê o `content.md` das pastas em `_descartados/` e marca **descartado**
  quem ainda está `novo` (antes ficavam `novo` para sempre, e o CRM apontava
  divergência). Reabrir um descartado é voltar a pasta para a raiz **e** pôr
  `novo` na planilha.

Também desde 05/10/2026 **o demo tem cartão de prévia**. O Rômulo manda só o
link no WhatsApp, e o WhatsApp mostra o cartão (og:*) antes de o dono abrir;
nenhum dos demos de 03-04/10 tinha `og:image` (o cartão saía sem foto) e 3 de
4 não tinham favicon. As instruções da execução pedem `<slug>/og.jpg`
(1200x630, da melhor foto real do negócio), as metas og/twitter com
`https://demo-<slug>.vercel.app/og.jpg` e um favicon SVG inline. Sobe para a
Vercel o `index.html` e, se existir, o `og.jpg`; nada mais da pasta (o deploy
de reserva do runner faz o mesmo).

Também desde 05/10/2026 **lead de busca pausada não é gerado**: o "06 · Funil
semanal" lista em `nao_gerar` (`~/.local/share/n8n-estado/site-funil.json`) os
leads `novo` cuja busca está com `ativa` desligada (pausada por ele ou pelo
Rômulo; ver "Depois do envio") e, desde 08/10/2026, os `novo` de nicho sem
sinal de compra que nenhuma busca ligada reclama. O gerador os deixa na raiz, fora da fila
(`--listar` mostra o motivo); religar a busca os devolve na segunda seguinte.
Sem o arquivo, ou ilegível, a fila é a de sempre.

### Raio-X do PRUMO (`raio-x.*`, 08/10/2026)

A porta de entrada do PRUMO (plano de 08/10/2026): uma página em `<site_url>/raio-x`,
**no mesmo projeto `demo-<slug>`** (o hobby limita projetos), com como o negócio
aparece no Google, o que já está bom, até 3 pontos que mandam cliente para o
concorrente (cada um com o porquê em linguagem de dono), o link do demo e
"R$ 990 + R$ 69/mês, paga depois de ver funcionando". Alimenta a variação C da
primeira mensagem do Balcão.

- **Feito por código, sem modelo.** A única fonte é o `content.md` do Caçador:
  nota e avaliações, telefone (celular ou fixo, pela regra do nó "Pontuar"),
  situação do site no Google (fora do ar, rede social, nenhum) e as linhas de
  "Por que este lead" que vêm de campo do Places com regra exata (horário
  preenchido, fotos com o nome do negócio, avaliação nos últimos 30 dias). Sem
  essa seção nada disso é afirmado. O que vem da busca do Gemini (WhatsApp
  "achado", Instagram "achado", "dono atende", o briefing) nunca entra. A página
  diz a data em que os dados foram lidos e leva ao perfil no Google Maps.
- **O que a revisão de 08/10/2026 tirou, por ser falso em lead real:** telefone
  fixo não é ponto (o Caçador só deixa passar fixo com WhatsApp publicado);
  "site fora do ar" é conferido de novo na hora (o Caçador checa uma vez e erra:
  wixsite e páginas de reserva voltam) e só vira ponto se não responde 200 ou
  responde sem nenhuma palavra própria do nome (domínio estacionado); horário
  não é ponto para pousada, hotel e espaço de eventos (o Google não mostra
  horário comum para eles); "nenhuma foto é de vocês" só com fotos em `Fotos/`.
- **Quantos pontos o dado sustenta, nunca inventados.** Em 08/10/2026, dos 88
  demos no ar, só 5 tinham 3 pontos verificáveis; a maioria tem 1 ou 2, e sem
  ponto não há Raio-X. O Caçador escolhe justamente perfis bons (celular,
  horário, fotos, nota alta). A página e o `raio_x_pontos` dizem
  quantos são; a mensagem não pode prometer "3".
- **Versão 2 (08/10/2026, "raso demais"): Places, avaliações, caminho do cliente.**
  Com a chave do Google Places em `~/.config/prumo/places.env` (600, linha
  `PLACES_API_KEY=`; `RAIO_X_CHAVE` troca o caminho), duas chamadas por lead,
  guardadas em `<slug>/raio-x-places.json` por até 30 dias (o limite dos termos
  do Google para conteúdo do Places; só os campos usados, sem coordenada nem
  telefone): **Place Details** (nota e avaliações de hoje, horário, o link "Site"
  que o perfil mostra agora e as até 5 avaliações que o Google mostra primeiro,
  com o nome de quem escreveu) e **Text Search** "<tipo do perfil> em <cidade>"
  (20 primeiros; tipo genérico como "Serviços" vira o ramo do Caçador). Daí: a
  posição do lead na busca (ponto se fora dos 3 primeiros), quantos dos 5
  primeiros mostram site próprio (entra no ponto do site), a mediana de
  avaliações deles (ponto se o lead tem menos da metade), a nota comparada (o
  que já está bom) e os temas das avaliações contados por palavra, só nas de 4 e
  5 estrelas, com até 3 trechos de pessoas diferentes. A página ganha também o
  perfil item por item (✓, ✕ ou "não conferido"), o caminho do cliente
  (procura, compara, conhece, chama, espera) ligado às seções do próprio demo
  (lidas do `index.html`: âncoras, WhatsApp, ligar, mapa), os dois serviços com
  preço (Encontrado e Respondido e Acompanhado) e "como fizemos", com o que não
  dá para conferir de fora (se o dono responde às avaliações: o Places não
  entrega; tempo de resposta). Sem chave, ou com a API fora, essas seções não
  aparecem e o resto sai como na versão 1. Assinatura: PRUMO, sem nome de pessoa.
  Custo (tabela do Google de 2025; conferir no console): Place Details
  Enterprise + Atmosphere US$ 25/1.000 e Text Search Enterprise US$ 35/1.000, cada
  SKU com 1.000 pedidos grátis por mês; no ritmo de hoje (até 12 por dia pelo
  timer, mais o gancho do gerador) fica dentro do grátis, e o cache impede pagar
  duas vezes no mesmo mês. PageSpeed ficou de fora: o Caçador só deixa passar
  quem não tem site próprio no ar, então não há site para medir.
- **Publicação.** Um deploy a mais por lead: `index.html` + `og.jpg` +
  `raio-x/index.html`. Antes, o `index.html` e o `og.jpg` da pasta são
  comparados byte a byte com o que está no ar e são esses bytes que sobem; se
  diferem, nada sobe (o Raio-X nunca troca o demo). O `vercel link` tem de ligar
  o palco ao `vercel_project` do recibo (sem isso, `vercel deploy` criaria um
  projeto novo) e a linha `Aliased:` tem de ser o `site_url`. Depois, `/raio-x`
  tem de responder exatamente a página gerada e o demo tem de continuar igual.
  Uma cópia fica em `<slug>/raio-x.html` (o refazer a guarda no `_vN/`).
- **Recibo.** O `publicado.json` ganha (gravação atômica, os outros campos
  intactos) `raio_x_url` (a URL que o Balcão manda, `<site_url>/raio-x`),
  `raio_x_pontos` (1 a 3: quantos pontos a página mostra), `raio_x_versao` e
  `raio_x_em`. O Balcão já lê o recibo inteiro (`item.json.recibo`).
- **Quando sai.** O gerador chama `raio-x <slug>` depois de cada demo validado
  (também no refazer, cujo deploy do Claude tira o `/raio-x` do ar); falha só
  vai ao log do lead. O `raio-x.timer` (11:15 e 17:15) roda `--pendentes --max 6`:
  leads `pronto` na raiz (retrato da planilha com até 26 h) sem Raio-X da versão
  atual ou com ele fora do ar, o publicado mais recente primeiro; quem não teria
  Raio-X (sem ponto, demo apagado) não ocupa vaga. Com o gerador rodando
  (`gerador.lock` de processo vivo) não faz nada: um refazer pode trocar o demo
  de um lead `pronto` a qualquer momento. A saída do `vercel` vai para `.logs/execucao-<slug>.log`, onde o
  `lote-continuo` procura o limite de deploys; o próprio raio-x para no limite.
- **Versão 3 (09/10/2026): Nota de presença e a conta aberta em R$.** Pelo
  cálculo PRUMO (`prumo-mapa/calculo_prumo.py`, o mesmo módulo do Mapa; método
  em `~/prumo/05-entrega-mapa/calculo-prumo.md`): seis blocos de 0 a 3 (aparece
  na busca, nota, avaliações contra a mediana dos 5 primeiros, responde às
  avaliações, perfil completo, site e WhatsApp), nota de 0 a 18 e a faixa. Bloco
  sem dado sai "não medimos" e fica fora da conta (a nota é proporcional aos
  medidos); "responde às avaliações" é sempre não medido, porque o Places não
  entrega a resposta do dono. Com menos de 4 blocos medidos (sem a chave do
  Places) a seção não aparece. Para o bloco do site, a página do botão "Site" é
  lida na mesma conferência de sempre: meta viewport (celular) e link de
  WhatsApp (sem link mas com a palavra no HTML = não conferido). Abaixo dos
  blocos, até 3 cenários das distâncias medidas e o campo "Quanto vale um
  cliente fechado?": a página faz "1 cliente a mais por mês × valor" e "× 12",
  num JS inline gerado pelo módulo; sem valor, a conta fica com o espaço em
  branco. Nenhum valor típico do ramo, nada se soma. Sem o
  `calculo_prumo.py` instalado, o raio-x sai como na versão 2 (e fica na 2, sem
  refazer ninguém) e avisa no log.

```bash
raio-x --simular higor-ferreira-advogado   # o diagnóstico, sem publicar nem gravar
raio-x --html higor-ferreira-advogado --saida /tmp/x.html   # só a página (chama o Places se o cache venceu)
raio-x higor-ferreira-advogado             # publica e grava o recibo
raio-x --pendentes --simular               # quem o timer pegaria
HOME=/tmp/home-teste python3 deploy/dell/raio-x.py --testar
python3 deploy/dell/prumo-mapa/calculo_prumo.test.py   # o método: limiares, Vale Norte, a calculadora (JS no node)
```

Instalar (numa sessão no Dell; o `calculo_prumo.py` antes do raio-x, que o importa):

```bash
install -D -m 644 deploy/dell/prumo-mapa/calculo_prumo.py ~/.local/share/prumo-mapa/calculo_prumo.py
install -m 755 deploy/dell/raio-x.py ~/.local/bin/raio-x
install -m 755 deploy/dell/gerador-de-sites.py ~/.local/bin/gerador-de-sites
cp deploy/dell/raio-x.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now raio-x.timer
```

### O como-fazer-o-site é versionado (`deploy/dell/auto-site/`, 08/10/2026)

O processo que o Claude segue em cada lead mora em dois arquivos do
`~/auto-site`: o `CLAUDE.md` (triagem, direção visual, publicação; ~36 KB) e o
comando `.claude/commands/lead-novo.md`. Até 07/10 eles existiam só no Dell e
mudavam à mão, sem histórico nem como voltar — e mudar a forma de criar sites é
exatamente o que as lições do funil vão propor. Desde 08/10/2026:

- a fonte é o repositório: `deploy/dell/auto-site/auto-site-CLAUDE.md` →
  `~/auto-site/CLAUDE.md` e `deploy/dell/auto-site/lead-novo.md` →
  `~/auto-site/.claude/commands/lead-novo.md`, as duas no `instalados.json` em
  modo **444**. O nome no repo não é `CLAUDE.md` de propósito: o Claude Code
  carrega um `CLAUDE.md` aninhado como instrução, e toda sessão no SquadOne
  passaria a receber "você produz index.html";
- mudança só por PR. Depois do merge (o `atualizar-central` traz o clone em até
  10 min, mas **não** instala cópias), numa sessão no Dell:
  `install -D -m 444 ~/SquadOne/deploy/dell/auto-site/auto-site-CLAUDE.md ~/auto-site/CLAUDE.md`
  e o mesmo para o `lead-novo.md` (o `dell-status --instalados` mostra os
  comandos). Nada a reiniciar: cada lead é um `claude -p` novo, que relê os
  arquivos; o lote contínuo pega a versão nova no lead seguinte;
- voltar atrás = reverter o PR e reinstalar;
- a cópia do Dell não é editada: o 444 barra Edit/Write e `>` por cima, a
  lista de permissão do gerador já negava o `CLAUDE.md` e o `.claude/` ao
  Claude, e o `site-nichos.py` pula a cópia versionada (era o único script que
  reescrevia uma seção dele). O que escapar disso (`sed -i` troca o arquivo
  por rename) o `dell-status` acusa como "diferente" em até 1 min;
- nunca symlink: o `rclone sync` do espelho pula symlinks (a sentinela do
  espelho é justamente o `CLAUDE.md`) e o Claude headless não lê `~/SquadOne`.

A cópia versionada é a do Dell de 05/10/2026 (sha256 `7fa99464…` e
`a101c085…`) com duas mudanças: o número de WhatsApp de um negócio citado num
exemplo foi trocado por `<número do negócio>`, e o fim do arquivo diz que a
regra nova vai no resumo final (execução automática) ou num PR (sessão com o
Rômulo), não numa edição da cópia. As skills de `~/.claude/skills` e o
`settings.local.json` (hooks do impeccable) continuam fora do repositório.

### Direção dos sites: metáfora e Atos (08/10/2026)

A direção do "redesign conceitual e de movimento" do site do PRUMO virou a dos
demos, em todos os modos (fila comum, `--personalizado`, `--premium`). Leitura
de cinco demos no ar em 08/10/2026: o fluxo comum saía em ordem de template
(hero, serviços, diferenciais, orçamento, contato); quando havia ideia, ela
morava num brinquedo isolado; os arquivos pesavam 440 a 905 KB (75-90% de foto
em base64, a do hero terminando depois do byte 200 000); um hero esperava o JS
para aparecer; efeito de cursor sem `pointer: fine`; e havia frase que soava
como alarme ou deboche do ramo. O que mudou:

- `auto-site-CLAUDE.md`, passo **1.5.1**: a metáfora vem do ofício (família
  por nicho, com exemplos de advocacia, odontologia, climatização,
  desentupidora, dedetizadora, reformas, escola infantil e estética
  automotiva; instância pelo lead), representa o cuidado e nunca o problema, e
  é a navegação. A página são **cinco Atos** (chegada, reconhecimento, como
  funciona, prova, chamado), e o `<slug>/CONCEITO.md` traz a tabela "efeito →
  Ato → o que significa": efeito sem linha não entra;
- "Barra de excelência" 2.1: o vocabulário de movimento (esticamento por
  velocidade, paralaxe 3D, transição líquida, magnetismo, máscara tipográfica,
  levitação, lag elástico) com dose, teto e porquê; regras do motor; cursor só
  com `pointer: fine`; `prefers-reduced-motion` completo;
- "Regras do arquivo": orçamento de bytes (fim do Ato I ≤ 200 KB, arquivo ≤
  450 KB, fontes ≤ 80 KB, hero ≤ 80 KB, CSS ≤ 35 KB, JS ≤ 25 KB), fotos em
  WebP, Ato I visível sem JS; "Experiência sem inventar" e "Nada que gere medo
  ou desconfiança";
- `gerador-de-sites.py`: o prompt pede a direção; as instruções da execução
  pedem o `CONCEITO.md`, o script de bytes e as capturas com
  `--force-prefers-reduced-motion` e sem JS; o personalizado amarra o conceito
  autoral aos Atos; o laço de crítica do premium responde a um checklist de 20
  itens; o refazer guarda o `CONCEITO.md` anterior no `_vN/`.

As versões (`VERSAO_PERSONALIZADO`, `VERSAO_PREMIUM`) não subiram: o
`lote-continuo` refaz todo demo `pronto` com versão menor que a alvo, e subir
agora refaria a fila inteira. Para medir a direção nova como versão no funil,
suba-as num PR à parte, junto com o `VERSAO_ALVO` do `lote-continuo`, se
quiser o refazer em massa.

Instalar (numa sessão no Dell, depois do merge):

```bash
install -D -m 444 ~/SquadOne/deploy/dell/auto-site/auto-site-CLAUDE.md ~/auto-site/CLAUDE.md
install -D -m 444 ~/SquadOne/deploy/dell/auto-site/lead-novo.md ~/auto-site/.claude/commands/lead-novo.md
install -m 755 ~/SquadOne/deploy/dell/gerador-de-sites.py ~/.local/bin/gerador-de-sites
```

### QA com uma imagem por rodada: folha de contato e gate numérico (11/10/2026)

A cota do Claude aperta, e o QA era o que mais lia imagem. Medido nas transcrições dos leads
de 08-10/10/2026 (`~/.claude/projects/-home-romulo-sutil-corr-a-auto-site/*.jsonl`, contando
os `Read` de imagem por sessão, sem duplicar a mesma chamada):

| modo | leads | capturas lidas | em chamadas | referências lidas | chamadas ao modelo | cache lido por lead |
|---|---|---|---|---|---|---|
| premium (lote contínuo) | 97 | 44 | 18 | 28 (em 5) | 136 | ~41 M tokens |
| comum | 1 | 13 | 8 | 0 | 86 | ~15 M tokens |

Cada chamada relê o contexto inteiro (~300 mil tokens no premium) e cada imagem lida fica nele
até o fim. Além disso, todo lead escrevia o próprio script de bytes e descobria sozinho que o
`--blink-settings=scriptEnabled=false` **não grava captura** no Chrome do Dell (154), fazendo à
mão uma cópia sem `<script>`. Duas ferramentas, instaladas em `~/.local/bin` e chamadas pelo
Claude com `python3 <caminho>` (o `Bash(python3 *)` da lista já cobre; o teste confere):

- **`folha-de-contato`** (`deploy/dell/folha-de-contato.py`): junta as capturas de uma rodada
  (`--pasta <rascunho>/qa`, menos `folha*` e ocultos) e, no premium, as 4 referências escolhidas
  (`--refs`) numa imagem só, rotulada `#N Ato · viewport · modo` a partir do nome
  (`m-ato1-rm.png`, `d-ato3-p0.3.png`). Celular no dobro da escala do desktop (até 100%), lado
  longo até 2000 px: é o que o `Read` do Claude Code entrega sem reduzir (uma folha de 1266x2575
  chegou como 983x2000). Imprime a legenda e a estimativa de tokens (~3,7 mil por folha cheia).
- **`qa-numerico`** (`deploy/dell/qa-numerico.py`): o gate antes do deploy, com os tetos das
  "Regras do arquivo" do `auto-site-CLAUDE.md` (fim do Ato I ≤ 200 KB, arquivo ≤ 450 KB, CSS ≤
  35 KB e JS ≤ 25 KB sem base64, fontes ≤ 80 KB em até 2 famílias e sem url externa, hero ≤
  80 KB, foto de conteúdo ≤ 60 KB e no máximo 5), `<img>` sem `width`/`height` ou sem `alt`,
  `prefers-reduced-motion` no CSS (e no JS que usa `requestAnimationFrame`), contraste AA dos
  pares cor/fundo declarados na mesma regra do CSS (tokens resolvidos; fundo translúcido,
  gradiente e tema escuro ficam "sem medir") e o Ato I visível sem JS e com reduced-motion
  (desvio da luminância ≥ 10 e ≥ 3% de pixels longe da cor dominante; demos reais dão 60-76 e
  26-38%, tela lisa dá 0). Com `--capturas` ele mesmo tira, do `index.html` de agora, as duas
  capturas 390x844 do Ato I (a sem JS de uma cópia sem `<script>`), com perfil temporário próprio
  (nada em `~/.cache`). O Ato I é a primeira `<section>` dentro de `<main>`. Código 0 = passou,
  1 = falhou (cada FALHA diz o que cortar), 2 = erro de uso; Chrome que falha vira AVISO, não
  reprova. Nos 10 demos mais recentes, 8 passam; os 2 que falham excedem a regra de verdade
  (3 famílias de fonte; JS de 25,5 KB).

As instruções da execução (`instrucoes_da_execucao`, o "E" do personalizado e o "V" do premium)
só mandam usar as duas se `~/.local/bin/folha-de-contato` e `~/.local/bin/qa-numerico`
existirem (`ferramentas_de_qa()`); sem elas, o texto é o de antes. Assim, o gerador novo
instalado sem os scripts não manda o Claude chamar o que não existe. O `auto-site-CLAUDE.md`
(passo 4.5, "Regras do arquivo" e checklist) e o `lead-novo.md` citam as ferramentas.

Estimativa por lead premium: das 44 capturas em 18 chamadas para 3-4 folhas em 3-4 chamadas
(~42 mil tokens de imagem para ~15 mil), menos ~14 chamadas que releriam ~300 mil tokens de cache
cada (~4 M dos ~41 M), mais os turnos do script de bytes e da descoberta do Chrome sem JS. As 28
referências da etapa R continuam lidas uma a uma (é aprendizado, não QA); juntá-las em folhas
é o próximo corte possível, se a qualidade aguentar.

Instalar (numa sessão no Dell, depois do merge; os dois scripts **antes** do gerador):

```bash
install -m 755 ~/SquadOne/deploy/dell/folha-de-contato.py ~/.local/bin/folha-de-contato
install -m 755 ~/SquadOne/deploy/dell/qa-numerico.py ~/.local/bin/qa-numerico
install -m 755 ~/SquadOne/deploy/dell/gerador-de-sites.py ~/.local/bin/gerador-de-sites
install -D -m 444 ~/SquadOne/deploy/dell/auto-site/auto-site-CLAUDE.md ~/auto-site/CLAUDE.md
install -D -m 444 ~/SquadOne/deploy/dell/auto-site/lead-novo.md ~/auto-site/.claude/commands/lead-novo.md
dell-status --instalados   # nada atrás
```

Conferir sem gerar lead: `python3 ~/.local/bin/qa-numerico ~/auto-site/<slug>/index.html` (só
lê) e, com capturas, `--capturas /tmp/qa-x` (escreve só lá; apague depois). Voltar atrás:
apagar as duas cópias de `~/.local/bin` devolve o QA antigo no lead seguinte, sem reinstalar o
gerador.

Medir antes e depois (1 lead real, com aprovação do Rômulo): anote o último lead premium antes
da instalação e o primeiro depois; para cada um, no `execucao-<slug>.log` está o id da sessão
e os minutos ("Claude Code finalizado ... em N min"); na transcrição
`~/.claude/projects/-home-romulo-sutil-corr-a-auto-site/<sessão>.jsonl`, some o `usage` de cada
mensagem do assistente **uma vez por `message.id`** (input, output, cache lido, cache criado) e
conte os `Read` de `.png`/`.jpg` (capturas em `/tmp/gerador-*/qa/`, referências em `refs/`). A
qualidade se confere no demo publicado e nos `CRITICA-N.md` da pasta do lead.

### Permissões do Claude (lista de permissão, desde 30/09/2026)

Até 29/09 o Claude rodava com `--dangerously-skip-permissions`: podia fazer
qualquer coisa no Dell. Agora roda com `--permission-mode dontAsk` e uma lista
de permissão que o runner monta para cada lead (`permissoes_do_claude` em
`gerador-de-sites.py`, passada em `--settings`), mais `--strict-mcp-config`
(nenhum MCP). O que não está na lista é negado na hora, sem pergunta; o Claude
segue pelo caminho permitido. A lista saiu das transcrições dos leads de
24-30/09 (o que o `/lead-novo` de fato usa):

- **escrita** (Edit/Write e redirecionamento `>`): só a pasta do lead,
  `registro.md`, `_build/` e um rascunho próprio do lead
  (`/tmp/gerador-XXXX`, que vira o `$TMPDIR` e é apagado no fim do lead).
  `CLAUDE.md`, `.claude/` e `.logs/` de `~/auto-site` e todo `~/.claude/` ficam
  negados; `~/.claude/skills` é só leitura (as skills de design);
- **leitura**: `~/auto-site`, o rascunho e as skills. Fora disso nada; `~/.ssh`,
  `~/.config`, `~/.hermes`, `~/SquadOne`, credenciais do Claude e da Vercel
  estão também em `deny`;
- **Bash**: `python3`, `node`, Chrome/Chromium headless (captura e DOM
  renderizado), `pyftsubset`/`fonttools`, `curl` só para ler, o script do
  `impeccable` e utilitários de texto e arquivo (`mkdir`, `cp`, `mv`, `sed`,
  `sort`...), que o Claude Code só aceita dentro de `~/auto-site` e do
  rascunho. `rm` só na pasta do lead e no rascunho, e nunca em `registro.md`,
  `content.md`, `publicado.json` nem nas pastas `_*`. `vercel` só nos dois
  comandos do passo 5, com `--cwd` no palco do deploy e projeto `demo-<slug>`
  (o runner passa os comandos exatos ao Claude em `--append-system-prompt`,
  porque o roteiro do `CLAUDE.md` usa variável de shell, que o Claude Code nega
  em caminho). Negados: `git`, `sudo`, `ssh`, `wget`, `pip`/`npm`/`npx`,
  `chmod`, `systemctl`, `crontab`, `curl` que envia dados (`-d`, `-F`, `-T`,
  `-X`...) ou grava em `~/`, e `pkill` fora do Chrome;
- **web**: `WebFetch` (qualquer domínio: Instagram, Refero, site do negócio) e
  `WebSearch`; `Skill` liberado.

**Onde ver o que foi negado:** cada negação vai para o log do lead
(`~/auto-site/.logs/execucao-<slug>.log`) como `[NEGADO] <ferramenta>:
<comando ou arquivo>`, com o id da sessão (a transcrição completa fica em
`~/.claude/projects/-home-romulo-sutil-corr-a-auto-site/`). A linha "Claude Code
finalizado" do `execucao-fila.log` diz quantas foram negadas.

**Como afinar:** se uma negação fez falta ao site, acrescente a regra em
`permissoes_do_claude` (`PROGRAMAS_LIVRES` para um programa novo; `allow`/`deny`
para o resto; sintaxe em code.claude.com/docs/en/permissions, ex.
`Bash(programa *)`, `Edit(//caminho/absoluto/**)`), rode o teste e reinstale
com o `install` abaixo. Negação que não fez falta não precisa de regra.

Negações que aparecem sempre e não fazem falta (o Claude Code as nega por não
conseguir analisar o comando, com qualquer regra): laço `for`/`while` com
variável, variável de shell em caminho, `python3 - <<EOF` e `python3 -c` de
várias linhas, `grep`/`sed` com `{n,m}` e `mkdir -p X && <usa X>` na mesma
chamada. O Claude contorna com um script Python no rascunho.

**Cache do Chrome headless (11/10/2026).** O Chrome sem `--user-data-dir` abre um perfil
temporário em `~/.cache/google-chrome-headless/scoped_dir*` e só o apaga se sair sozinho. O
`matar_grupo` e o timeout o matam à força, então cada captura do QA deixava ~3 MB: 34 GB em
quatro dias (~14 GB por dia com o gerador ligado). Duas defesas: ao fim de cada lead,
`limpar_cache_chrome()` apaga os `scoped_dir*` parados há mais de 10 min (nunca levanta; o
teste usa `CHROME_HEADLESS_CACHE`, nunca o cache real); e o `refero-aprender` abre o Chrome
com `--user-data-dir` num diretório temporário próprio (que cai no rascunho, pelo `TMPDIR`).
Depois do merge, reinstale as duas cópias (`dell-status --instalados` diz o que está atrás).

Teste de 30/09/2026 (3 leads, um por vez, pela lista): `pousada-valle-do-luar`
publicou em 16 min, mas o Claude tentou `chrome` (nome do `CLAUDE.md`, que não
existe no Dell), levou a negação como "Chrome proibido" e publicou sem captura
de QA, com fonte de sistema e 1 das 5 skills. Daí `chrome` na lista e a linha
"a lista não muda o processo" nas instruções. `absolute-estetica-automotiva`
foi descartado em 3 min (o site Wix voltou ao ar; confirmado com o DOM
renderizado no `google-chrome`). `estetica-automotiva-dominic` publicou em 25
min com 4 skills, capturas de desktop e celular, fontes embutidas e deploy
pelo próprio Claude; 13 negações, todas do tipo acima.

**O que a lista não resolve:** não é sandbox. `python3`, `node` e o Chrome
rodam qualquer código, então um Claude enganado por uma página (injeção de
prompt no Instagram ou no site de um lead) ainda consegue ler e mandar arquivos
por eles; a lista fecha os caminhos diretos e deixa rastro. Isolamento de
verdade é o sandbox do Claude Code (`sandbox.enabled`, bubblewrap), que no
Ubuntu precisa também do `socat` (`sudo apt install socat`, não instalado em
30/09/2026) e de um teste com o Chrome dentro do sandbox.

Instalação (uma vez, pelo Rômulo, que decide ligar o gerador; o Claude roda sem
pedir nada a ninguém, mas só dentro da lista acima):

```bash
claude            # login da conta Claude (uma vez) — /login dentro dele
vercel login      # conta da Vercel com o escopo romulodesigns
install -m 755 ~/SquadOne/deploy/dell/gerador-de-sites.py ~/.local/bin/gerador-de-sites
cp ~/SquadOne/deploy/dell/gerador-de-sites.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now gerador-de-sites.timer
```

## Observador do WhatsApp (`whatsapp-observador/`)

O Rômulo aborda os leads direto no WhatsApp, sem os links rastreados. O Hermes
já está vinculado ao número dele (aparelho conectado), e a bridge escreve em
`~/.hermes/whatsapp/bridge.log`, **sem conteúdo**:

- para toda mensagem recebida, uma linha `self_chat_mode_rejects_non_self`
  (chat e remetente; é da própria bridge);
- desde 30/09/2026, com o remendo `deploy/hermes/scripts/patch_bridge_envios.py`,
  `owner_sent` (chat e hora) quando o Rômulo escreve a alguém numa conversa
  1:1, pelo celular ou outro aparelho (eco do Hermes, reação, edição, apagar e
  voto não contam), e `owner_receipt` (`entregue` ou `lido`, chat e hora) quando
  a mensagem dele chega ou é lida: uma linha por chat e estado a cada 30 min.

O `observador.py` acompanha esse log (tail -F; na primeira vez começa do fim,
depois continua de onde parou, guardado em `~/.local/state/whatsapp-observador`)
e, quando o número é das planilhas, avisa o n8n (`claude-ops/whatsapp-conversa.py`).
Só começa a ler depois de receber a lista de números: em 29/09/2026 um boot com
o n8n ainda subindo perdeu três respostas.

- **O Rômulo escreveu** (`saida`): Site antes da venda `novo`/`pronto` →
  `enviado` + `enviado_em` (como o clique no `wa_link`); `recusado`/`expirado`
  → `enviado` com `enviado_em` de agora (retomou a conversa; o acompanhamento
  conta de novo, a pasta fica onde está); `enviado`/`fechado` → nada (conversa
  normal). PRUMO: Etapa "Revisar" → "Convite enviado" (como o clique em "Enviar
  convite"). Abordagem nova vira um aviso pelo Hermes, juntando o que acontecer
  em 5 min: "Registrado: você abordou <Nome> (Site antes da venda) às HH:MM".
  Conversa com quem já estava `enviado` não avisa.
- **O lead leu** (`lido`): Site → `visto_em`, só a primeira vez (lido em
  `novo`/`pronto` também marca `enviado`: prova um envio que passou batido);
  PRUMO com "Convite enviado" → Próxima ação "Leu o convite em ..." (se ainda
  não diz "Respondeu"). Sem aviso. **Quem desligou a confirmação de leitura
  nunca aparece como lido: "entregue sem lido" é "não sei", não "não viu".**
  `entregue` fica só no log.
- **O lead escreveu** (`entrada`): PRUMO com Etapa "Revisar" → "Convite
  enviado" + "Respondeu no WhatsApp em ..."; com "Convite enviado" → Próxima
  ação "Respondeu no WhatsApp em ..." só se a mensagem veio 5 min ou mais depois
  de "Convite enviado em" (desde 05/10/2026; antes qualquer mensagem valia); Site
  `novo`/`pronto` → `enviado` (+ `enviado_em`); resposta a 5 min ou mais do
  envio → `respondeu_em` (`expirado` volta a `enviado`), e a pasta vai para
  `_em-conversa/` (ver "Pasta auto").

Desde 07/10/2026, todo lead do Site que vira `enviado` por um desses três
sinais (e não pelo clique no `wa_link`, que já marca `enviado`) ganha
`mensagem_variante` `manual`: o texto não foi o da variação do Balcão (ver
"Links rastreados").

**O texto da resposta** (fluxo "WhatsApp — resposta de lead", 05/10/2026): o
observador manda o que o lead escreveu e o Gemini classifica em `bot` (só
mensagem automática: não é resposta), `negativa` (recusou: Site → `recusado`,
como o botão Recusou; PRUMO → "Sem interesse"), `exclusao` (desde 07/10/2026:
pediu para apagar o site ou o conteúdo, como a Baby School: "se puder excluir
esse conteúdo por gentileza"), `interesse` (o aviso traz a segunda mensagem,
com o link) ou `neutra`. Grava `resposta_tipo`, `resposta_trecho` e
`resposta_em` e avisa o Rômulo pelo Hermes. `exclusao` conta como negativa no
funil (sai da busca igual) e o aviso propõe apagar o demo com
`site-demos-limpeza --exclusao demo-<slug>`, a partir do próximo retrato das
`:20`; nada é apagado sozinho (RULES 10, ver "Página do lead e pausa dos
demos"). No PRUMO, que não tem demo, vira "Sem interesse" com "Pediu exclusão
no WhatsApp" na Próxima ação. Resposta de gente a quem ainda estava
`novo`/`pronto` também grava `manual`.

**Quanto demora o aviso** (medido em 08/10/2026, um "Sim, sou a Jackeline" de PRUMO: a resposta entrou na planilha na hora, o aviso com o texto e o link saiu ~2 min 20 s depois): o observador espera `ESPERA_DA_CONVERSA_S` sem mensagem nova do lead antes de mandar ao n8n (era 90 s, agora 45 s), o n8n classifica com o Gemini (~10–20 s) e a fila de avisos só era esvaziada pelo timer do `dell-status` (até 1 min). Desde 08/10/2026 quem grava o aviso (`avisar_pelo_hermes`) também manda `dell-status --drenar` 6 s depois (a fila ignora arquivo com menos de 5 s); o timer continua valendo, então falha ali não perde aviso, e silêncio das 22h às 7h, teto por hora e chave de 24 h valem igual. A espera de 45 s é o preço do "Oi" + "não temos interesse" virar uma conversa só: quem escreve devagar pode gerar dois avisos. Depois do merge, reinstale o observador (`instalados.json`) e reinicie o serviço.

Por que 5 min: em 28/09/2026 dez leads "responderam" segundos depois de cada
envio, na ordem em que o Rômulo mandava. É a saudação automática do WhatsApp
Business. Então a primeira mensagem só prova o envio, e o observador manda um
segundo aviso (`"seguinte": true`) quando o lead volta a escrever 5 min ou mais
depois; o Site usa esse segundo aviso e o PRUMO continua marcando uma vez por
janela. Resposta única dentro dos 5 min passa despercebida: o follow-up do 3º
dia lembra, e `respondeu_em` pode ser preenchido à mão.

O PRUMO só ganhou a regra dos 5 min em 05/10/2026. Até então toda mensagem de
quem tinha "Convite enviado" virava "Respondeu no WhatsApp": 20 prospects, todos
até cerca de 5 min depois do convite e 17 em menos de 1 min (saudação), e a tela
Hoje do CRM mostrava "Conversando" e "Respostas para responder" que não
existiam. `claude-ops/prumo-desfazer-saudacao.py` devolve essas marcas antigas
a "Só resposta automática" (simula por padrão; só grava com `--aplicar`).

Por que o log e não um segundo aparelho: o pareamento por código falhou (no
DDD 27 o WhatsApp registra o número sem o 9). O remendo da bridge é pequeno,
idempotente e marcado (`// >>> squadone:` ... `// <<< squadone:`); o
`hermes update` guarda e reaplica mudanças locais, mas pode perdê-lo se a bridge
mudar perto das âncoras. O `aplicar-hermes.py` reaplica, e o observador avisa
uma vez quando as marcas somem do `bridge.js`. Âncora não encontrada = o script
sai com erro sem tocar no arquivo (e, com `--avisar`, avisa pelo Hermes).
LID vira telefone pelo mapa da sessão do Hermes (`lid-mapping-*_reverse.json`,
só leitura). Até dois avisos de resposta por número a cada 6 h; um de escrita a
cada 30 min; um de leitura a cada 6 h; log parado 6 h avisa pelo Hermes.
Webhooks com header `X-Observador` (segredo em
`~/.config/claude-ops/whatsapp-observador-segredo`); o de conversa responde
depois de ler as planilhas e antes de gravar, com o que vai marcar.

n8n com erro (30/09/2026): o evento não se perde. Fica numa fila, na ordem, e o
observador tenta de novo depois de 1 min, 4, 16 e então de hora em hora (cada
tentativa que falha dentro do n8n vira um aviso de falha); a posição gravada não
passa do primeiro pendente, então um reinício relê dali. O que foi escrito com o
observador parado é "atrasado": envio e leitura têm hora na linha; mensagem
recebida ganha a última hora conhecida do log, para uma saudação relida depois
não virar resposta. Para reprocessar um trecho, pare o serviço e ponha em
`posicao.json` o byte de onde recomeçar e `salvo_em` (epoch) da hora dele.

Privacidade: desde 30/09/2026 o `bridge.log` guarda também os números para quem
o Rômulo escreve e de quem leu o que ele mandou, nunca o conteúdo; o observador
só manda ao n8n os que são lead (DDD + 8 dígitos) e não grava nada além da
posição no log. Risco de banimento: o remendo só registra, no Dell, eventos que
o aparelho conectado já recebe; não envia, não marca como lido e não muda
presença. O risco de usar um cliente não oficial (Baileys) já existia antes.

```bash
python3 ~/SquadOne/deploy/hermes/scripts/patch_bridge_envios.py --verificar   # 0 = aplicado
python3 ~/SquadOne/deploy/hermes/scripts/patch_bridge_envios.py --reiniciar   # aplica; reinicia o hermes-gateway se mudou
python3 ~/SquadOne/deploy/hermes/scripts/patch_bridge_envios.py --testar      # numa cópia
install -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/observador.py ~/.local/bin/whatsapp-observador
cp ~/SquadOne/deploy/dell/whatsapp-observador/whatsapp-observador.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now whatsapp-observador
python3 ~/SquadOne/deploy/dell/whatsapp-observador/observador.test.py
cd ~/.local/share/claude-ops && python3 whatsapp-conversa.py --testar && python3 whatsapp-conversa.py --testar-n8n
python3 whatsapp-conversa.py            # publica os dois fluxos e cria a coluna visto_em
python3 whatsapp-conversa.py --colunas  # só a coluna (precisa da credencial Google)
```

## Lições do funil (`funil-aprendizado.*`, `funil-revisao.*`, 08/10/2026)

Fase 1 da auto-melhoria do Site antes da venda: as respostas dos leads viram
lições, e as lições que se repetem viram **propostas** de mudança na triagem,
na mensagem e na forma de criar sites. Até 07/10 isso era feito à mão e sem
conferência: a docstring do gerador registrou que a Baby School achou que o
demo "não parecia feito para ela", mas o que ela escreveu foi "hoje já temos
uma agência, fiquei curioso mesmo para ver o resultado" — o gargalo era a
qualificação (WordPress no ar, descartado duas vezes pela triagem e reaberto à
mão), não o site. **Nada é aplicado sozinho** (RULES 10): o Rômulo lê o
arquivo de propostas e pede o PR a uma sessão do Claude.

**Coleta** (`funil-aprendizado coletar`, todo dia às 06:40):

- lê o `crm.json` (recusa retrato com mais de 3 h) e acha os desfechos com
  **palavras do lead**: resposta negativa, neutra, interesse ou exclusão com
  texto, e todo fechamento. Resposta sem texto ("marcada à mão…"), Recusou pelo
  botão sem texto e silêncio (com ou sem leitura, 10 dias) viram só **contagem**
  em `contagens.json`: sem palavras do lead o modelo especularia, e desde 05/10
  o recibo azul é da 1ª mensagem, que vai sem link;
- para cada desfecho novo, o script monta um dossiê com as fontes do lead
  (resposta, colunas permitidas da planilha, `content.md`, `DOSSIE.md`,
  `REVISAO.md`, `DESCARTAR.md`, as linhas dele no `registro.md`; nunca
  `wa_me`/`wa_link`), troca telefone e e-mail por `[tel]`/`[email]` e rotula as
  seções "Decisão do Rômulo" como decisão manual por cima da triagem;
- o Claude roda **sem ferramenta nenhuma** (`--tools ""`, `--safe-mode`,
  dontAsk com tudo negado, cwd fixo e vazio em `~/.local/state/funil-aprendizado/cwd`,
  prompt pelo stdin) e devolve uma lição em JSON. Do `permissoes_do_claude`
  do gerador vem o desenho, não o código: aquela lista abre escrita e Vercel;
- a lição só é gravada se passar no validador: cada evidência é **literal** da
  fonte declarada (comparada com o texto que o modelo viu), nenhum dado
  pessoal, enums, `sem_sinal` sem mudança, e a regra de princípio "recusa de quem
  diz que já tem fornecedor (site, agência…) não é etapa `site`". Recusada: uma
  nova chamada com os motivos; duas rodadas recusadas e o desfecho é desistido
  (a saída vai, redigida, para `rejeitadas.jsonl`);
- chave da lição = `place_id` + hash do trecho: reclassificar o mesmo texto não
  duplica, texto novo do mesmo lead é lição nova (e leva as anteriores como
  contexto). Teto de 10 lições e 70 min por rodada; limite de uso do Claude
  encerra a rodada sem contar tentativa;
- lição: `{chave, place_id, slug, nicho, cidade, desfecho, desfecho_em,
  mensagem_regime, mensagem_variante, site_versao, etapa (qualificacao |
  mensagem | site | oferta | timing | sem_sinal), evidencia [{fonte, trecho}],
  o_que_funcionou, hipotese, nao_se_conclui, mudanca_proposta {alvo (cacador |
  mensagem | claude_md | gerador | decisao_manual), texto}, confianca (baixa |
  media | alta)}`. `decisao_manual` é recomendação ao Rômulo, nunca diff.

**Revisão** (`funil-aprendizado revisar`, segunda às 08:30, depois do "06 ·
Funil semanal"):

- lições dos últimos 28 dias, uma por lead, cujo desfecho ainda está na
  planilha; grupo = (etapa, alvo). Vira proposta com **2 ou mais leads**
  (confiança média/alta) ou **1 caso forte** (confiança alta + palavras do lead
  que casam um sinal fixo da etapa, como "já temos uma agência"), e só se o
  grupo tem lição ainda não citada. No máximo 3 por semana, 1 de mensagem;
- para cada grupo o Claude (sem ferramentas) redige a troca a partir do arquivo
  inteiro do `~/SquadOne`; o script confere que o trecho de antes aparece uma
  vez, numa região permitida (no gerador, só `PROMPT*`, `CLICHES` e as
  instruções; no Caçador, só `PREFERIDAS`), sem URL, comando nem R$, que o
  Python alterado compila, e monta o diff. Mensagem nova entra como variante B
  (senão C) em `VARIACOES`; proposta de site diz para subir a versão do site no
  mesmo PR (a revisão nunca mexe em `VERSAO_*`);
- grava `~/.local/share/funil-aprendizado/propostas/PROPOSTAS-<AAAA-MM-DD>.md`
  (com o funil por `mensagem_variante` e `site_versao` tirado do `crm.json` e as
  contagens) e `propostas/<data>/<n>.patch`, e manda **um** aviso (origem
  `funil-aprendizado`, prioridade 3, rótulos fixos, nenhum texto de lead). Semana
  sem proposta: só o arquivo, sem aviso. Erro inesperado: aviso P2 com o tipo
  do erro;
- aprovar: peça a uma sessão do Claude "faça o PR da proposta 1 de
  PROPOSTAS-<data>"; ela aplica o `.patch`, e o arquivo diz como cada mudança
  entra em vigor (install, `--balcao` ou `site-cacador-escolha.py`).

O `dell-status` mostra "Lições do funil" (falha com `erro` na rodada ou unit
caída; atenção sem rodada há 36 h) a partir do momento em que o timer está
instalado. Testes: `python3 deploy/dell/funil-aprendizado.test.py` (raiz
temporária, HOME isolado, Claude dublado; a Baby School é o caso fixo).

Instalar (sessão no Dell) e conferir antes de ligar:

```bash
install -D -m 755 ~/SquadOne/deploy/dell/funil-aprendizado.py ~/.local/bin/funil-aprendizado
cp ~/SquadOne/deploy/dell/funil-{aprendizado,revisao}.{service,timer} ~/.config/systemd/user/
funil-aprendizado coletar --listar                      # desfechos e contagens; não chama nem grava
set -a; . ~/.config/claude-ops/gerador.env; set +a
funil-aprendizado testar-vivo --saida /tmp/funil-vivo   # 3 chamadas reais na Baby School; não grava nada
funil-aprendizado coletar --saida /tmp/funil-fumaca --teto 2   # fumaça: grava só em /tmp
funil-aprendizado revisar --saida /tmp/funil-fumaca            # idem, aviso em /tmp/funil-fumaca/fila
systemctl --user daemon-reload && systemctl --user enable --now funil-aprendizado.timer funil-revisao.timer
```

Rode o `testar-vivo` de novo a cada `PROMPT_VERSAO` novo: as 3 respostas
precisam validar, com etapa `qualificacao` e sem culpar a personalização.

## Radar PNCP

Os arquivos não sensíveis do Compose do radar ficam em
`deploy/dell/licitacoes-automation/`. Para atualizar o diretório operacional,
copie esse conteúdo para `~/licitacoes-automation` sem remover `.env`, `data/`,
`backups/` ou `graphify-out/`, valide com `docker compose config --quiet` e
recrie apenas os serviços alterados. O workflow versionado usa gatilho manual
para testes no editor e agenda diária para produção; ambos recebem confirmação
rápida do collector, sem aguardar a resposta do PNCP.

O `collector` só lê `scripts/collect-pncp.mjs` ao subir: mudou o script,
`docker compose restart collector` (o n8n não precisa reiniciar). Testes sem
rede: `node --test scripts/*.test.mjs`.

### Pausado em 11/10/2026

A frente de licitações estava subutilizada (auditoria da Mel de 11/10/2026) e foi
pausada, não removida: nenhum dado, volume, imagem ou fluxo foi apagado. **O n8n
(`licitacoes-automation-n8n-1`) e o `db` são o n8n geral da Mel (PRUMO, Site antes da
venda, CRM): nunca pare nem reinicie por causa do radar.**

| # | Passo | Comando (na Mel) | Como reverter | Estado |
|---|---|---|---|---|
| 1 | Rotina do Hermes "Radar diário de licitações" (`f6e7da0f8558`) | `hermes cron pause f6e7da0f8558` | `hermes cron resume f6e7da0f8558` | feito em 11/10/2026 |
| 2 | Timer da repescagem | `systemctl --user disable --now pncp-catchup.timer` | `systemctl --user enable --now pncp-catchup.timer` | feito em 11/10/2026 |
| 3 | Fluxo `Radar PNCP — coleta diária` (`c8d62107-67db-4a1e-b6a9-211f9d9ef0df`) | `docker exec licitacoes-automation-n8n-1 n8n unpublish:workflow --id=c8d62107-67db-4a1e-b6a9-211f9d9ef0df` **e depois** `docker restart licitacoes-automation-n8n-1` | `docker exec licitacoes-automation-n8n-1 n8n publish:workflow --id=c8d62107-67db-4a1e-b6a9-211f9d9ef0df` e o mesmo restart (ou ligar pelo editor, por túnel) | **pendente**: a chave de API do monitor (`N8N_API_KEY`) é só de leitura (`/deactivate` dá 403) e a CLI só vale com o n8n reiniciado; o restart derruba por ~30 s os webhooks de PRUMO/CRM/WhatsApp, por isso espera um momento aprovado |
| 4 | Container `licitacoes-automation-collector-1` (33 MB) | `docker stop licitacoes-automation-collector-1 && docker update --restart=no licitacoes-automation-collector-1` | `docker update --restart=unless-stopped licitacoes-automation-collector-1 && docker start licitacoes-automation-collector-1` | **pendente, só depois do 3**: com o fluxo ativo e o collector parado, às 07:30 o fluxo falha, o `00 · Avisar falha` manda WhatsApp e o `fluxo:c8d62107…` fica vermelho |
| 5 | Marca do monitor | `date +%d/%m/%Y > ~/.local/state/dell-status/pausa-pncp` | `find ~/.local/state/dell-status -name pausa-pncp -delete` | **pendente, junto do 4** (precisa do `dell-status` novo instalado: `dell-status --instalados`) |

Ordem para concluir: 3 (com o restart), 4, 5. Reverter na ordem inversa. O container
parado com `restart=no` não é problema para o `dell-status` (a verificação
`containers` ignora `exited` com política `no`) nem para o `dell-validate` (agora diz
"parado de propósito"). Sem a marca do passo 5 o `Radar PNCP` em "Dados" viraria
amarelo ("A coleta de hoje não aconteceu") a partir das 09:00 do dia seguinte e ficaria
assim; com ela diz "Pausado de propósito (data)" e fica ok. A mesma marca apaga o
amarelo de "Timers do repositório" pelo `pncp-catchup.timer` desligado no passo 2; até
o passo 5, `date +%d/%m/%Y > ~/.local/state/dell-status/pausa-pncp-catchup` apaga só esse
(sem esconder a coleta, que ainda roda). Cuidado: o
`dell-worker-healthwatch` usa `docker compose up -d n8n` quando o n8n não existe, e
isso sobe o `collector` de volta (`depends_on`); `docker restart` do n8n não.

Desde 29/09/2026 a coleta das 07:30 não qualifica item cujo prazo de proposta
encerra antes de coleta + 3 h: o resumo do Hermes chega às 08:00 e naquele dia
trouxe um pregão que encerrava às 07:59. Esses itens saem da lista (o Hermes
não mostra descartes) e ficam só em `counts.deadline_dropped` e
`deadline_dropped` do `latest-run.json` e numa linha de contagem no relatório.
