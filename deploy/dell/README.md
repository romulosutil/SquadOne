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
  corrigir quem gravou e apagar os arquivos. Antes um aviso ilegível virava um
  "Aviso ilegível na fila" no WhatsApp.
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
python3 deploy/dell/dell-status.test.py   # cron, rotinas, gerador, fluxos, filas, fila de avisos, WhatsApp, backup, arquivos instalados e "o que fazer"
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

**O que cada lead recebeu** (07/10/2026, para o funil aprender comparando). Duas
colunas no fim da aba Leads, gravadas pelo Balcão (`python3
site-antes-da-venda.py --colunas` cria; o `--balcao` também):

- `mensagem_variante`: a letra do texto que o `wa_link` leva (`A`, `B`, `C` de
  `VARIACOES`; `EN` nos EUA; vazio sem telefone). A letra sai do `place_id`, não
  da ordem da rodada, então um lead `pronto` não troca de variação entre duas
  rodadas; com B e C `null`, todo lead é `A`. É gravada enquanto o lead está
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
  advocacia; B2B com "Pedir orçamento"; urgência com botão fixo). Rodar de novo
  não muda nada; `--testar` e `--testar-vivo` não gravam.
- `python3 site-acompanhamento.py --testar` roda cópias dos dois sem gravar;
  `--testar-regra`, `python3 site-cacador-escolha.py --testar` e
  `python3 site-cacador-site-no-ar.py --testar` (HTTP de mentira, mais o
  `node --check` do código) rodam só o código dos nós no node, sem n8n nem
  planilha.

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

**Limpeza dos demos sem interação** (`site-demos-limpeza`, desde 07/10/2026, todo
dia às 09:50): a outra ponta da pausa, só para quem **nunca interagiu**. A
Vercel hobby limita projetos e demo parado ocupa a vaga do gerador, então
`enviado`/`expirado` sem `respondeu_em`, `fechado_em` nem `recusado_em`, na raiz
de `~/auto-site` ou em `_concluidos/`, com `enviado_em` + 10 dias já passado,
tem o projeto `demo-*` **apagado** na Vercel (a pasta fica; o `publicado.json`
ganha `apagado_em` e o `site-demos-pausa` passa a ignorá-lo). Recusado não entra
(recusar é interação; esses seguem a pausa de 15 dias, que é reversível), nem
`_em-conversa/`, `_fechados/` ou `_recusados/`. O retrato da planilha com mais
de 3 h invalida a rodada: uma resposta de hoje poderia estar de fora. **O timer
só lista e avisa** (um aviso quando aparece candidato novo); apagar é ordem sua:

```bash
site-demos-limpeza --simular             # quem entra e por que os outros não, sem aviso nem estado
site-demos-limpeza --apagar              # apaga todos os que entram
site-demos-limpeza --apagar demo-a demo-b   # só esses (têm de estar entre os que entram)
```

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

**Ciclo de vida (as 6 etapas, iguais para os dois produtos).** Regras em
`server/crm.ts` (`etapaDoSite`, `etapaDoPrumo`); nomes de coluna em
`COLUNAS_DO_SITE`/`COLUNAS_DO_PRUMO` (coluna ausente = vazia, com aviso na tela).
A primeira linha que casar, de cima para baixo, decide:

| Etapa | Site antes da venda (aba Leads + pasta) | PRUMO (aba Prospects) |
|---|---|---|
| **Ganho** | `status` fechado | Etapa Concluído |
| **Perdido** | `recusado`; pasta em `_recusados/` (recusa anotada à mão); `expirado` sem resposta; `descartado`; pasta em `_descartados/` | Etapa Sem interesse |
| **Proposta** | "Proposta enviada" marcada na Central (aba CRM), até ser desfeita | idem |
| **Conversando** | `respondeu_em`, ou pasta em `_em-conversa/` | "Respondeu no WhatsApp em ..." na Próxima ação; Etapa Diagnóstico pronto / `Diagnóstico em` (formulário respondido; Mapa, se houver, na linha do tempo) |
| **Contatado** | `enviado` (ou `enviado_em`) sem resposta: "Viu" com `visto_em`, senão "leitura desconhecida" | Convite enviado: "Leu o convite em ..." ou "leitura desconhecida" |
| **Novo** | `pronto` ("Pronto, não enviado"); `novo` com pasta na raiz ("Na fila do gerador", com os artefatos) | Etapa Revisar |

"Entregue sem lido" é **não sei**, nunca "não viu": quem desliga a confirmação
de leitura nunca aparece como lido; quem respondeu aparece como "leu
(respondeu)". Sinais: **follow-up hoje** (Contatado há 3+ dias sem resposta;
no Site só envio a partir de 29/09 e uma vez por lembrete do 05), **resposta
nova** (respondeu nas últimas 48 h; exato quando houver colunas de última
entrada/saída), dias na etapa e desde o último evento, **divergência**
(planilha e pasta discordam depois de 2 h de folga: nota na ficha, nunca
correção).

**As três vistas** (celular primeiro; `?ver=funil`, `?produto=site|prumo`,
`?lead=site:<place_id>`):

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
  divergência dono × time, 6 blocos, Índice do Prumo X/18; a planilha segue
  com o Índice /100 do fluxo, e o pacote leva os dois);
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
cp -r ~/SquadOne/deploy/dell/prumo-mapa/{prumo_mapa.py,prumo_pdf.py,modelo_mapa.py,archivo.woff2,exemplos} ~/.local/share/prumo-mapa/
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
  gastar o teto do dia. Gravar o arquivo à mão também descarta.

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
Rômulo; ver "Depois do envio"). O gerador os deixa na raiz, fora da fila
(`--listar` mostra o motivo); religar a busca os devolve na segunda seguinte.
Sem o arquivo, ou ilegível, a fila é a de sempre.

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

Desde 29/09/2026 a coleta das 07:30 não qualifica item cujo prazo de proposta
encerra antes de coleta + 3 h: o resumo do Hermes chega às 08:00 e naquele dia
trouxe um pregão que encerrava às 07:59. Esses itens saem da lista (o Hermes
não mostra descartes) e ficam só em `counts.deadline_dropped` e
`deadline_dropped` do `latest-run.json` e numa linha de contagem no relatório.
