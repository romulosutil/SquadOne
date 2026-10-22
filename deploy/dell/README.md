# Central de Operações no Dell

## Retomada de 22/10/2026 e sessão independente do Grok

Autorizada a retomada com 50% do esforço anterior: 5 primeiros contatos/dia,
2/h e 30 min entre contatos, compartilhados entre executor, Central e Telegram.
A proteção automática continua ativa. Estes limites não garantem ausência de bloqueio.

O Grok usa o mesmo telefone em uma sessão própria do WhatsApp Web, numa VM sem
acesso de administração disponível. As mensagens `fromMe=true` de qualquer aparelho
são saídas da nossa conta; não comprovam autoria humana ou do Grok. Hermes e Evolution
arquivam por ID/direção, evitando duplicar a mesma mensagem. Esta instalação não
controla os dois ciclos diários do Grok nem garante o limite de envios dessa VM.

O histórico dirigido preserva âncoras reais dos eventos de leads, inclusive saídas
de outros aparelhos, e consulta o identificador confirmado pela sessão quando o
telefone do CRM usa outra forma do nono dígito. Com telefone conferido, consulta a
janela recente por padrão; uma âncora antiga só retorna mensagens anteriores a ela
(`anteriores=true`). Assim, a recuperação após uma queda não fica presa no passado.
Menus e rodapés de atendimento são
lidos como texto, sem inferir humanidade pela ausência de `papel`. Grupos ficam fora.
Retornos solicitados aguardam até 10 min; `somenteConsultar=true` lê o estado sem
reenviar pedidos. `diagnostico` contém só contagens de eventos, correlação e janela.
Um HTTP 202 não confirma recuperação nem cobertura completa. Aplicar com
`python3 deploy/hermes/scripts/patch_bridge_historico.py` e reiniciar `hermes-gateway`.

## Contagem e ritmo após a restrição de 21/10/2026

A Central confere a proteção a cada 60 s, sem depender de painel aberto, e antes de reservar
um envio. A janela é móvel de 24 h: pelo menos 5 destinatários enviados há 60 min ou mais,
com 80% ou mais sem resposta humana, pausam novos primeiros contatos. Robôs entram como
sem resposta humana; envios recentes e reservas sem recibo não entram. A mesma classificação
do painel calcula a regra. `prospeccao-pausa.json` (600/atômico) guarda motivo, hora e amostra
agregada, e a configuração do time é desligada sem apagar outros campos.

Estado fechado da Evolution pausa por desconexão; estado explícito de restrição/bloqueio
ou recusa HTTP 403/429 também pausa. O executor grava primeiro `prospeccao-sinal.json`
(somente sinal e hora), depois avisa a rota local `/crm/frente/sinal`. Número destinatário
inexistente não é bloqueio da conta. Não há envio de teste, reenvio ou reconexão automática.
Um aviso que exista só na tela do celular, sem reflexo na integração, não é detectável por ela.

A pausa sobrevive à meia-noite, reconexões e reinícios; bloqueia reservas do executor,
os links de primeiro contato na Ficha/Triagem e os novos avisos do Telegram. Conversas
existentes continuam disponíveis. A ativação manual relê conta e CRM e recusa se a causa
continuar; restrição informada exige ainda ao menos 24 h internas antes da revisão.
Após o push, reinstale `deploy/dell/frente-comercial.py` em `~/.local/bin/frente-comercial`
(já cadastrado em `instalados.json`). Não ative o time durante a instalação.

`GET /api/operations/crm/frente` calcula `respostasHoje` a partir da visão atual do CRM:
somente `marcos.enviado` no dia de São Paulo, um destinatário por número, separado em
`humanas`, `robos` (somente automação) e `semResposta`. Humana tem prioridade sobre robô;
retorno hoje de um disparo de ontem fica fora. Reservar ou abrir link não confirma envio.
Sem CRM atual, a métrica é indisponível, sem reaproveitar o antigo `respondidos` do serviço.

A regra compartilhada `REGRAS_DO_RITMO` passa a 10 primeiros contatos por dia, 4 por
hora móvel e 15 minutos entre contatos, para Central, Telegram e executor. São limites
internos conservadores, sem garantia contra restrições. A pausa operacional `ativo=false`
foi preservada; a publicação e a revisão de 24h não reativam o executor.

## PRUMO: medição e Fonte com Luna (18/10/2026)

O site consulta uma fila pública persistente no serviço Easypanel
`aladdin/prumo-automacoes`, nunca expõe o n8n ou o Hermes. O workflow
`PRUMO · Fonte com IA (Luna do Hermes)` (`yNLwUy5bdEmC4Qss`) consulta a fila a cada
30 s (eram 5 s, 17.280 execuções por dia para um trabalho raro; desde 19/10/2026) e chama a rota autenticada `/fonte` do `luna-workflows:8766`. O modelo é
`gpt-6-luna-900k`, sem pesquisa, escrita ou memória entre perguntas. As fichas não
autorizadas são removidas do prompt; fontes, responsável e revisão são conferidos
no servidor. Credenciais de cliente fixam empresa e perfil no servidor.

`PRUMO · Medição de eventos` (`qA5R9UXZj4UgIjFi`) lê o retrato de contagens a cada minuto e só
reenvia a lista de origens dos sites publicados quando ela muda (ou a cada 30 min, por garantia). A Fonte
não guarda dados de execução, nem as com erro (privacidade das perguntas); a Medição só conta eventos e guarda
as execuções com erro, para a falha deixar rastro. Instalador idempotente: `claude-ops/prumo-publico.py`.
Tokens e IDs das credenciais ficam em `~/.config/claude-ops/prumo-publico-*` (600).

Painel privado:
https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/prumo/metricas
(`prumo-metricas.service`, loopback 8767; Tailscale Serve). Filtros, total e CSV
usam contagens reais; eventos não representam visitantes únicos ou vendas.

Base pública fictícia em `prumo-fonte/bases/vale-norte-demo.json`, instalada em
`~/.local/share/prumo-fonte/bases/`. Cliente real usa base aprovada e
`prumo-fonte-cliente.py --base empresa.json --perfil vendedor --dias 90`; código
privado só em arquivo 600. Nunca versionar regras ou acessos reais de clientes.
Guia completo, limites, retenção e validação: repositório PRUMO,
`automacao-publica/README.md`.

Após o push, reinstalar `luna_workflows.py`, `fonte_luna.py`, `prumo-publico.py`,
`prumo-fonte-cliente.py`, `prumo-metricas.py`, a base de exemplo, `raio-x` e
`prumo-mapa/modelo_raio_x.py`, conforme `instalados.json`. Recarregar o systemd,
reiniciar `luna-workflows` e `prumo-metricas`; executar o instalador dos workflows.
Testes: `fonte_luna.test.py`, `luna_workflows.test.py`,
`workflow_confiabilidade.test.py` e `raio-x --testar`. Sem envio de mensagens.

## A Central (`squadone-operations`)

O serviço usa o build do clone Git `~/SquadOne` e escuta apenas em
`127.0.0.1:9120`. Até 28/09/2026 usava a réplica `~/Pessoal-dev/SquadOne`, que
congelou com o PC; o `.env` (o build lê `VITE_GOOGLE_CLIENT_ID`, e o
`TOKEN_ENC_KEY` abre o `data/google-auth.json`) e o `data/` foram copiados de
lá e ficam no clone, fora do Git.

Para atualizar a Central (fast-forward da `main`, build e reinício com teste):

Desde 18/10/2026, antes do build, o atualizador também executa os 53 testes de
`lead-quente-sombra.test.ts` e `roster-historico.test.ts`. Os dois casos POSIX que
o Windows pula são obrigatórios aqui no Linux: arquivo `600`, pasta `700`,
inclusive quando já existiam com permissões mais abertas. Uma falha para a
atualização antes de substituir o build ou reiniciar. A suíte completa (`npm test`)
também deve ser validada no Linux antes do push; a diferença entre plataformas
está explicada em `docs/referencia/testes.md`.

```bash
install -m 755 deploy/dell/atualizar-central.sh ~/.local/bin/atualizar-central
atualizar-central
```

Desde 29/09/2026 isso roda sozinho: `atualizar-central.timer` confere a
`main` a cada 10 min e só reconstrói quando ela andou (`--se-mudou`). Uma falha
vira aviso na fila do `dell-status`, que chega pelo Telegram (origem `atualizar-central`; o WhatsApp é a reserva), uma vez por
commit (`chave` = o commit da `main`), com o motivo quando o merge para por arquivos não rastreados que colidem.

**O que vale como "atualizado" (19/10/2026, HC-1).** O sha **construído**, que o script grava em `~/.local/state/atualizar-central/construido`
só depois do build, do reinício e de `/api/runtime` responder; comparar com o `HEAD` do clone não servia, porque o merge vem antes do
`npm install`/testes/build e uma falha ali deixava `HEAD == origin/main` e o ciclo seguinte saía calado, com a Central presa na versão velha.
Agora o timer retenta a cada 10 min até construir. Só roda install/testes/build e reinicia se algo que entra no build mudou desde o construído
(tudo menos `docs/`, `ops/`, `prototypes/`, `*.md` e `deploy/`, salvo `prumo-ofertas.json` e `entrada/pagina.html`, que o servidor lê): mudança só
de documentação não derruba um turno do Assistente nem o bot. A **primeira rodada depois desta versão reconstrói uma vez** (sem o arquivo
`construido`). O `dell-status` confere o construído contra a `origin/main` (check `central-atualizada`).

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
`autoNotificationStateFile` deixaram de ser lidos em 30/09/2026 (a chave saiu do `operations.example.json` em 19/10/2026); o arquivo
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

**O que o healthwatch religa (19/10/2026):** o painel do Hermes, a Central, o code-server e o n8n, a cada 30 s, com duas
consultas de 8 s antes de agir. **Sem o gateway do Hermes**: o `hermes-gateway.service` tem `Restart=always`, e o
healthwatch só conseguia desfazer uma parada de propósito (exit 78, ou o `stop` para trocar o chip) a cada 30 s; o
socorro tem o remédio dele. Por serviço há **teto de 3 reinícios em 10 min** (passou disso, registra uma vez no
journal "not restarting" e deixa o `dell-status` acusar a falha), **carência de 90 s** depois de cada reinício e a
**marca de pausa** `~/.local/state/dell-status/pausa-<serviço>` (`squadone-operations`, `hermes-dashboard`, `code-server`,
`n8n`) para parar de propósito sem ser religado. O estado fica em `~/.local/state/healthwatch/`. O n8n sobe com
`docker compose up -d --no-deps n8n`, para não reviver o collector do Radar PNCP pausado.

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

## Time de primeiros contatos (18–19/10/2026; ativo no config, timer parado)

**Estado em 19/10/2026:** o `frente-comercial-config.json` diz `ativo: true` (autorizado em 18/10) e o
`frente-comercial.timer` está parado na Mel, então nada roda nem é enviado; a tela mostra "ativo, mas o ciclo está
parado" (`GET /crm/frente` devolve `cicloParado` e `ultimaRodadaEm`). Ligar o timer ou pausar o config é decisão do
Rômulo (`install` e `enable --now` abaixo; `POST /crm/frente/config {"ativo":false}` pausa).

Diego, Elisa e Carla avaliam os leads; o executor sem modelo manda só o primeiro contato pelo número
do PRUMO (pela Evolution: o adaptador e o observador só leem, quem envia é este), e a conversa depois fica com o Rômulo. Desde 19/10/2026 o `.py` não tem ritmo nem expediente
próprios: cada envio pede `POST /api/operations/crm/frente/reservar` e a Central decide com a mesma janela
e a mesma trava de ritmo das telas e do Telegram. Regras, elegibilidade e o porquê:
`docs/referencia/perfis-e-experimentos.md`, "Time comercial".

Fase 0 (19/10): as cinco linhas compartilham 30 primeiros contatos/dia, 12/h e
5 minutos entre contatos, sem cotas por linha. Plus é rede quente: teste de 20
envios feitos apenas pelo Rômulo, fora do executor automático. Iris e CRM de
estamparia são produtos prontos; seus caçadores continuam pausados (AC-11).

Envio ambíguo e parada (20/10/2026): um `incerto` espera 15 min pelo observador e, com ele vivo e sem a saída na conversa, vira
`sem_confirmacao` (nunca reenviado); o time avisa pelo Telegram (origem `frente-comercial`, exclusiva do Telegram) quando um
envio fica sem confirmação, quando o Rômulo deve conferir o WhatsApp e quando o time passa de 10 min `bloqueado` no expediente
(`~/.local/share/squadone-operations/frente-comercial-alertas.json`). Depende da lib `aviso.py` em `~/.local/lib/mel/`.

Estado privado: `~/.local/share/frente-comercial/registro.sqlite` (avaliações, orçamento de inferência,
plano e recibos) e `~/.local/share/squadone-operations/frente-comercial{,-config}.json`. O app lê
`/api/operations/crm/frente` e pausa/ativa em Mais › Primeiros contatos; nenhuma credencial ou comando
de infraestrutura vai ao navegador.

Instalação: o Python vai para `~/.local/bin/frente-comercial`; service/timer vão para
`~/.config/systemd/user/`. Validar com `python3 deploy/dell/frente-comercial.test.py`. O timer não
substitui o observador nem o n8n: os dois precisam estar no ar.

## Monitor do Dell (`dell-status`)

Roda a cada minuto e faz duas coisas: grava
`~/.local/share/squadone-operations/status.json`, que a página inicial da
Central lê, e avisa o Rômulo quando uma verificação passa a falhar, a cada 12 h enquanto continuar falhando e
quando volta ao normal: **só pelo bot do Telegram** (OT-14; desde a Fase 5.3, 19/10/2026, o "Quebrou" é gravado na fila com
`origem: dell-status` e a drenagem o entrega; bot fora = o aviso espera a próxima rodada, nunca vai ao WhatsApp do Hermes).
Estados `atencao` só aparecem na Central. Também esvazia
`~/.local/share/avisos/fila/*.json`, a fila que os containers e os scripts do
Dell usam para avisar sem abrir rede nem firewall (formato e regras em "Fila de
avisos", abaixo).

**Auditoria de 19/10/2026 (HC-nn, DELL-nn, VIVO-nn nos comentários do código).**

- **Prazos:** toda verificação roda numa thread com prazo (`com_prazo`): 70 s cada e `PRAZO_TOTAL_S` = 100 s no conjunto
  (`executar_verificacoes`); a que trava vira `erro:<função>` e as seguintes ainda rodam, e as que ficam sem tempo vêm em
  `erro:prazo`. Os `subprocess` das verificações têm timeout. O laço de fluxos do n8n gasta no máximo 20 s (`TETO_DOS_FLUXOS_S`); os que
  sobram ficam "não verificados neste minuto" e guardam a memória que tinham. O **`status.json` é gravado antes de qualquer
  aviso** (`antes_de_enviar`), para um aviso lento ou preso não deixar a Central sem retrato; o `TimeoutStartSec` é 150 s.
- **Checks novos:** `central` (a própria Central responde em `/api/runtime`), `telegram` (o canal dos alertas: 3 envios
  seguidos falhando é vermelho, e com falha o monitor sonda o `getMe` a cada minuto; estado em
  `~/.local/state/dell-status/telegram.json`), `central-atualizada` (o sha CONSTRUÍDO, que o `atualizar-central` grava em
  `~/.local/state/atualizar-central/construido`, contra a `origin/main`; atenção se a main não está no ar há mais de 30 min
  ou se a última rodada do atualizar-central falhou; memória em `central-vista.json`) e `units-falhas` (o que o systemd
  marca como falho e nenhuma outra verificação cobre). A **internet** passou a ser uma conexão TLS de verdade a
  `api.telegram.org` (DNS com prazo, TCP, handshake), não só `getaddrinfo`, que vinha do cache.
- **Removida** a verificação de idade dos dados (`idade:asmr-metricas` e a lista `DADOS_COM_IDADE`): a coleta do ASMR está
  pausada, e a lista tinha um único item.
- **Serviços HTTP em duas rodadas:** `hermes`, `hermes-navegador`, `n8n`, `terminal` e `central` são conferidos com 5 s e
  uma tentativa; a **primeira** falha vira atenção ("confirma no próximo minuto") e só a segunda seguida é falha e avisa
  (o healthwatch tolera 8 s e uma segunda tentativa; sem a mesma tolerância aqui, um instante lento virava "Quebrou").
- **Parado de propósito tem marca:** daemon (`Restart=` e sem timer/path) `inactive`, `.path` fora do ar e container
  parado são atenção, a menos que exista `~/.local/state/dell-status/pausa-<nome>` (o `.service` perde o sufixo; o `.path`
  o mantém). Container fora do ar é **falha**, e o resumo "Containers" acompanha o pior dos individuais.
- **Prioridade:** falha de `disco`, `monitor`, `dns`, `docker`, `backup:cofre` ou de qualquer `container:*` toca com som
  mesmo das 22h às 7h (P0); as demais seguem a prioridade padrão.
- **O socorro só é prometido quando roda:** o "Quebrou" só grava o pedido e só diz "vou tentar religar" ou "diagnóstico do
  Hermes a caminho" para o que tem remédio ou leitura própria (`IDS_COM_REMEDIO`, `IDS_COM_LEITURA`, replicados do
  `socorro.py` de propósito); com o `socorro.path` parado não grava pedido.
- **Avisos pelo Telegram:** `ORIGENS_PELO_TELEGRAM` = `socorro`, `dell-status`, `backup-dell`, `atualizar-central`,
  `silmer-drive-sync`, `frente-comercial` (e todo P0): **exclusivos**, só pelo Telegram, sem `expira_em` e sem WhatsApp mesmo com o bot fora.
  A mesma lista está em `lib/aviso.py` (`ORIGENS_TELEGRAM_EXCLUSIVO`) e em `server/avisos.ts`
  (`ORIGENS_QUE_EXIGEM_TELEGRAM`); `aviso.test.py`, `dell-status.test.py` e `server/avisos.test.ts` falham se divergirem.
  **Falha de fluxo do n8n (prefixo `n8n:`) é diferente, e é decisão de produto em aberto:** `sai_pelo_telegram` o manda
  ao Telegram primeiro, mas ele NÃO é exclusivo (`telegram_exclusivo` olha só as 5 origens e P0): com o bot fora, o aviso
  segue para o WhatsApp do Hermes e expira como aviso comum. `dell-status.test.py`
  (`test_falha_de_fluxo_do_n8n_hoje_cai_no_whatsapp_se_o_telegram_falha`) fixa isso; torná-lo exclusivo é acrescentar o
  prefixo a `telegram_exclusivo` e à lib e ao servidor (ajustando esse teste). O fluxo "00 · Avisar falha pelo Hermes", que não manda `chave`,
  ganha uma por fluxo (`n8n-falha:<fluxo>`, 24 h); o "Quebrou" do `dell-status` (`fluxo:<id>`) ainda repete a mesma
  falha com a causa até 1 min depois (a duplicata só sai mexendo no próprio fluxo 00).
- **Links que existem:** os botões `acao` das filas apontam para telas da Central de hoje (Vendas › Primeiros contatos,
  Conversas para você, Funil); o texto de "Enviados esperando resposta" diz que só o observador marca o envio.

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

- **Parear de novo no MESMO número (16/10/2026, sem terminal interativo):** `systemctl --user stop hermes-gateway`;
  `mv ~/.hermes/whatsapp/session ~/.hermes/whatsapp/session.antiga-<número>-<data>` e `mkdir -m 700` uma `session` nova;
  `cd ~/.hermes/hermes-agent/scripts/whatsapp-bridge && setsid nohup ~/.hermes/tools/node-*/bin/node bridge.js
  --pair-only --pair-json --session ~/.hermes/whatsapp/session > /tmp/hermes-pair/saida.jsonl &`. Com `--pair-json` a
  bridge escreve uma linha JSON por evento e o texto bruto do QR em `{"event":"qr","qr":"..."}`; dá para desenhar o QR
  como imagem (a matriz sai do `qrcode-terminal/vendor/QRCode`) em vez de depender do terminal. Terminou em
  `{"event":"connected"}`. Como a conta é a mesma, o `me.lid` não muda e o `WHATSAPP_HOME_CHANNEL` fica; depois
  `systemctl --user start hermes-gateway`, `curl 127.0.0.1:3000/health` (`status: connected`) e `hermes send --to
  whatsapp "teste"`. Apague o `/tmp/hermes-pair` (tem o texto do QR). O aviso `link-preview-js` no `bridge.log`
  é antigo e inofensivo (sem prévia de link).

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

### Socorro: a falha nova tenta se resolver (`socorro.*`, 16/10/2026)

Pedido do Rômulo: "as falhas têm que disparar o Hermes para resolver". Exceção limitada da RULES 10
(e do SOUL do Hermes), com a lista fechada em `REMEDIOS` do `socorro.py`:

```
dell-status (1 min) --falha NOVA--> ~/.local/state/socorro/pedidos/pedido-*.json   ("Quebrou" sai igual, + 1 linha)
socorro.path (DirectoryNotEmpty) --> socorro.service (oneshot, outro processo; o laço de 1 min não espera)
  1. espera 60 s e reconfere (dell-status --stdout): voltou sozinho (healthwatch) = fim, sem aviso
  2. remédio da lista branca (no máximo 2 por verificação a cada 6 h), espera 90 s, reconfere
  3. continua fora: UMA chamada `hermes -z -t todo -s mapa-do-ecossistema` com a leitura já coletada
     (journal, systemctl status, docker ps/logs; telefone e token mascarados); 1 por verificação a cada
     6 h, 6 por dia, 5 min. O Hermes devolve JSON: diagnóstico, um remédio OPCIONAL (só vale se estiver
     na lista; quem executa é o socorro, com o mesmo teto) e o pedido pronto para o Claude Code
  4. um aviso pela fila (lib/aviso.py, "🛟 Socorro do Dell"): "resolvido sozinho, <remédio>" (P2) ou
     "continua fora ... Hermes: ... Peça ao Claude: ..." (P1). A drenagem o manda pelo bot do
     Telegram (origem "socorro"; WhatsApp só se o bot falhar; ver "Fila de avisos")
```

- **O que mudou em 19/10/2026:** o mesmo remédio roda **uma vez por atendimento** (duas verificações da mesma queda, como
  `hermes` e `whatsapp-sessao`, ou `n8n` e o container, não reiniciam o serviço duas vezes seguidas); falha **sem remédio nem
  leitura própria** (fluxo, rotina, Radar PNCP, fila de avisos, idade...) não chama o Hermes nem gasta o teto, e o aviso leva o
  "o que fazer" da Central; as units lidas para `backup` e `backup:<fonte>` são `backup-dell-cofre`, `backup-dell-espelho` e
  `estrutura-coletar` (o `backup-dell.service` nunca existiu); e o dell-status só grava o pedido com o `socorro.path` ativo
  (sem ele o pedido ficaria parado na pasta).
- **A lista branca** (o único que muda estado): `systemctl --user restart` de `hermes-gateway`,
  `hermes-dashboard`, `hermes-google-browser`, `code-server`, `evolution-adaptador`,
  `whatsapp-observador`, `whatsapp-observador-prumo`; `docker restart licitacoes-automation-n8n-1` (o
  mesmo do healthwatch) e `docker start` dos três containers da Evolution. Remédio automático por
  verificação: `hermes` (gateway parado ou painel), `hermes-navegador`, `terminal`, `n8n` e o container
  dele, `whatsapp-sessao` só quando a bridge não responde (sessão desconectada pede QR, não remédio),
  `whatsapp-prumo` só para unit ou container fora (número caído pede QR) e `container:evolution-*`. O
  resto (fluxos, rotinas, gerador, disco, PNCP, backup, fila de avisos...) vai direto ao diagnóstico.
- **Por que `-t todo`:** o `hermes -z` aprova sozinho qualquer ferramenta que tiver; sem terminal,
  arquivo, navegador nem mensagens, ele não muda nada nem fala com ninguém. A leitura é coletada pelo
  socorro, por uma tabela fixa só de leitura. `SOCORRO_HERMES_TOOLSETS` e `SOCORRO_HERMES_SKILLS` mudam
  isso (drop-in da unit); dar `terminal` ao Hermes tira a garantia: não faça sem decidir com o Rômulo.
- **Chave:** `socorro --desligar "motivo"` (cria `~/.config/socorro/desligado`) ou `SOCORRO_DESLIGADO=1`.
  Desligado, o dell-status não grava pedido (o "Quebrou" sai sem a linha do socorro) e o socorro descarta
  o que houver. `socorro --ligar` volta.
- **Ver:** `socorro --estado` (chave, tentativas e Hermes nas últimas 24 h, a lista branca), `socorro
  --simular ID --detalhe "..."` (que remédio seria usado e se o teto deixa; não age), `journalctl --user
  -u socorro` (cada passo; nunca o texto de conversa). Uso de modelo do último Hermes:
  `~/.local/state/socorro/ultimo-uso-do-hermes.json`.

Instalar (sessão no Dell, depois do merge e do `git pull` do `~/SquadOne`; nesta ordem, para o "Quebrou"
nunca prometer um socorro que não vai rodar):

```bash
install -m 644 ~/SquadOne/deploy/dell/socorro.service ~/SquadOne/deploy/dell/socorro.path ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now socorro.path
install -m 755 ~/SquadOne/deploy/dell/socorro.py ~/.local/bin/socorro
install -m 755 ~/SquadOne/deploy/dell/dell-status.py ~/.local/bin/dell-status     # vale no próximo minuto
python3 ~/SquadOne/deploy/dell/socorro.test.py && python3 ~/SquadOne/deploy/dell/dell-status.test.py
socorro --estado
# Ensaio (opcional): o navegador do Hermes não está no healthwatch, então só o socorro o religa.
systemctl --user stop hermes-google-browser   # em ~1 min: "Quebrou" com a linha do socorro; ~3 min: "resolvido sozinho"
```

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
  16:06) — e religue-o depois. **Desde 19/10/2026 o healthwatch não toca mais no gateway** (o `Restart=always` do systemd o
  sobe) e tem teto, carência e marca de pausa (ver acima); parar o gateway de propósito já não exige parar o healthwatch.
- **Idade dos dados** (`idade:<id>`, grupo Dados; **removida em 19/10/2026**, com a lista `DADOS_COM_IDADE` e o único item dela; o texto
  abaixo é o do que ela fazia): um arquivo que
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
- **Units do repositório** (`units`, grupo Serviços): o que o systemd registrou de cada
  `.service` que o `instalados.json` leva a `~/.config/systemd/user/` e está instalado
  (`systemctl --user show`: `Result`, `ActiveState`, `ExecMainStatus`). Os jobs que saíram
  do cron do Hermes para timers (Graphify, Sites e pendências, Entrada, 10–12/10/2026)
  avisam pela fila quando falham, mas um processo morto por SIGKILL ou pelo limite de
  memória não grava nada. **Amarelo** com `Result` diferente de `success` ou
  `ActiveState=failed` (`signal`, `oom-kill`, `timeout`, `exit-code`, `core-dump`...), com o
  motivo, a hora e o `journalctl --user -u <unit> -n 50`; nunca "resolve sozinho". Oneshot
  de timer `inactive`/`success` entre rodadas é ok, e a próxima rodada com sucesso apaga a
  queda (o systemd zera o `Result` no start). Unit que o systemd não conhece (`not-found`,
  `masked`) fica de fora. O `gerador-de-sites`, o `funil-aprendizado`, o `prumo-mapa` (service e path), os dois backups e o
  `atualizar-central` também ficam: as verificações deles já leem o `Result` (HC-14). Desde 19/10/2026 a verificação cobre
  também o **daemon parado** (`Restart=` e sem timer/path, `inactive`) e o **`.path` fora do ar**, atenção "parada" com
  o comando que religa e a marca de pausa que apaga o amarelo; o que o systemd marca como falho fora disso vem em `units-falhas`. No verde, o detalhe cita quem o systemd religou
  sozinho (`NRestarts`).
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
- **Falhas pelo Telegram (16/10/2026, OT-14, exceção da RULES 20):** o WhatsApp
  do Hermes é o número que fala com os leads (restrição de 24 h em 15/10), então
  as falhas do Dell saem pelo bot da Central. O "Quebrou / Continua fora / Voltou
  ao normal" do próprio `dell-status` (`enviar_pessoal`) e os avisos da fila com
  `origem` em `ORIGENS_PELO_TELEGRAM` (`socorro`, `dell-status`, `backup-dell`, `atualizar-central`, `silmer-drive-sync`, `frente-comercial`; e o prefixo `n8n:`, que prefere o Telegram mas tem reserva no WhatsApp, ver "Avisos pelo Telegram" acima) vão por `sendMessage` ao
  chat do dono, em texto puro, cortados em 4096 caracteres: na hora, **sem som
  das 22h às 7h** (`disable_notification`) salvo P0, sem contar no teto de 20 por
  hora (que protege o número) e com a chave de 24 h valendo igual. Bot desligado,
  mal configurado ou com falha: as origens exclusivas e o P0 **esperam** a próxima rodada (sem WhatsApp, sem
  expirar; Fase 5.3, 19/10/2026); só o prefixo `n8n:` e as demais origens pessoais caem no WhatsApp. Uma tentativa de bot por
  drenagem, 10 s cada. O resto da fila (scripts como o gerador e o observador, a reserva dos lembretes da
  Central) segue no WhatsApp; o cartão de decisão com link da tailnet saiu em 19/10/2026. Cada envio ao bot
  é anotado em `telegram.json` (a conta das falhas seguidas do check `telegram`).
  - **Segredo:** o `dell-status` lê `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_IDS` do
    ambiente ou, a cada envio, do `~/.config/squadone/operations.env` (o mesmo do
    `squadone-operations`), como o `raio-x-ia` faz com a chave do Gemini. Nada é
    copiado para a unit nem para o repo, e o log nunca leva a URL (ela tem o token).
    Lista de chats vazia, chat de grupo ou token fora do formato = sem bot.
  - **Desfazer:** `SQUADONE_LEMBRETES_PELO_TELEGRAM=false` no `operations.env` volta
    só os lembretes e o alerta de finanças da Central ao WhatsApp (depois de reiniciá-la). O
    `dell-status` não lê essa variável: as falhas e o P0 nunca voltam ao WhatsApp por ela.

**Scripts Python gravam pela lib** `deploy/dell/lib/aviso.py` (11/10/2026),
instalada em `~/.local/lib/mel/aviso.py`: valida contra este formato (mais "R$"
e 16 KB), corta com segurança o que passa do teto, grava `.tmp` oculto +
rename com nome único, não cria a pasta e nunca levanta (devolve `gravado`,
`recusado`, `fila_ausente` ou `falhou`; o que não gravou vai ao journal). Sem a
lib instalada, o script NÃO grava (desde 19/10/2026 não há mais o fallback "jeito antigo", que gravava o JSON direto sem validar): registra no stderr "lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: <título>" e segue (o `funil-aprendizado` sai com 1, para regravar na rodada seguinte). A regra do "R$" não tem mais como ser contornada por um script. Gravam pela lib (instalados em
11 e 12/10/2026): `auto-entrada`, `site-pastas`, `site-demos-limpeza`,
`prumo-mapa` (aviso ao cliente: "R$" é recusado e vai ao
journal, não escondido), `backup-dell` (o aviso do ensaio nunca muda o código de
saída; `BACKUP_DELL_SEM_AVISO` continua calando antes de gravar), `gerador-de-sites`
(o aviso nunca derruba um lead; a colisão de nome no mesmo segundo acabou),
`site-acompanhamento --enviar` (fila ausente vira mensagem e saída 1),
`funil-aprendizado` (o `conferir_aviso` de dado pessoal continua dele; a lib só
grava e confere o schema, com modo 660), `whatsapp-observador` ("R$" de lead
vira `[valor]` para a resposta não se perder; a lib é carregada a cada aviso, então
uma cópia nova vale sem reiniciar) e `patch_bridge_envios` (roda do clone). Em aviso
interno, "R$" vira `[valor]`; em aviso ao cliente, é recusado. Faltam o
`graphify_projetos` e os 3 jobs sem agente do Hermes (ver o plano). O inventário das
cópias e a ordem da troca estão em `docs/superpowers/plans/2026-10-11-aviso-unico.md`.

```bash
python3 deploy/dell/lib/aviso.test.py && python3 deploy/dell/auto-entrada.test.py && python3 deploy/dell/site-pastas.test.py && python3 deploy/dell/site-demos-limpeza.test.py
python3 deploy/dell/prumo-mapa/prumo_mapa.test.py && python3 deploy/dell/backup/backup-dell.test.py && python3 deploy/dell/gerador-de-sites.test.py && python3 deploy/dell/claude-ops/site-acompanhamento.test.py
python3 deploy/dell/funil-aprendizado.test.py && python3 deploy/dell/whatsapp-observador/observador.test.py && python3 deploy/hermes/scripts/patch_bridge_envios.test.py
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
python3 deploy/dell/dell-status.test.py   # cron, rotinas, gerador, fluxos, filas, fila de avisos, WhatsApp, backup, arquivos instalados, timers, healthwatch, rotinas caladas, pastas, prazos, central atualizada, telegram e "o que fazer"
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

## Luna em sombra (fase 8c, desde 07/10/2026, desligada por padrão)

**Estado em 19/10/2026:** segundo a auditoria (a flag está no `operations.env` da Mel, não no repositório), a sombra está **ligada**, mas desde que o
Assistente substituiu o Pedir não há tráfego novo (só uma demanda mandada pelo Telegram passa por `rodarDemanda`, onde ela observa); desligar
ou apontá-la para o Assistente é decisão do Rômulo. Não confunda com a Luna do `luna-workflows.service` (mais abaixo), que **opera**: classifica o Caçador
e responde a Fonte do PRUMO. A "medição, nunca motor" é só desta sombra.

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

## Jev em sombra (desde 11/10/2026, desligado por padrão)

**Estado em 19/10/2026:** como a Luna, segundo a auditoria está ligado na Mel (`jev.env` + `operations.env`) e sem tráfego novo desde que o
Assistente substituiu o Pedir; decisão do Rômulo (desligar ou apontar).

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
o Syncthing a espelhava em `G:\Meu Drive\auto` pelo PC. O Syncthing foi
aposentado em 12/10/2026 (sem aparelho pareado desde 04/10; o `dell-status` não o
verifica mais); desligar: `ssh -t mel 'sudo systemctl disable --now
syncthing@romulo-sutil-corr-a'`, reverter: `... enable --now ...`.

```bash
install -m 755 deploy/dell/auto-entrada.py ~/.local/bin/auto-entrada
mkdir -p ~/.local/share/auto-entrada && chmod 777 ~/.local/share/auto-entrada
cp deploy/dell/auto-entrada.path deploy/dell/auto-entrada.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now auto-entrada.path
```

O `auto-entrada.path` dispara por `PathExistsGlob=…/auto-entrada/*.json`, não por "diretório não vazio": o serviço só consome `.json`, e uma sobra de outro tipo reacionava o serviço em laço até o limite de início, deixando o `.path` em `failed` calado (DELL-17, 19/10/2026). O mesmo vale para o `site-pastas.path`.

Desde 29/09/2026 as pastas também mudam de lugar sozinhas. A cada hora o
Balcão grava em `~/.local/share/n8n-estado/site-pastas.json` o que mover, e
`site-pastas` (disparado por `site-pastas.path`) move: respondeu no WhatsApp
→ `_em-conversa/`; `expirado` (7 dias sem resposta, o mesmo prazo da Central desde 19/10/2026; eram 10) → `_concluidos/`. Só vale
para resposta ou envio a partir de 29/09/2026 (o acervo fica onde está), só
tira pasta da raiz (ou de `_concluidos/` quando um expirado responde), confere
o `place_id` do `publicado.json` e nunca sobrescreve. `site-pastas --listar`
mostra o que faria.

Desde 30/09/2026 o `site-pastas` também atende os botões da página do lead
(ver "Página do lead e limpeza dos demos"): um pacote por toque em
`~/.local/share/n8n-estado/site-acoes/` (segundo gatilho do `.path`,
`PathExistsGlob` em `*.json`; o pacote lido é apagado, o ilegível vai para
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
decisões e alertas em `backup/README.md`; restauração em `backup/RESTAURAR.md`. Os avisos do backup (ensaio que falha, com a chave
`backup-dell:ensaio-falhou`) saem pelo Telegram (origem `backup-dell`).

**Sync da pasta Silmer** (`silmer/silmer-drive-sync.{sh,service,timer}`): `rclone bisync ~/Silmer gdrive-silmer:`, **a cada 15 min** (eram 5: 578
execuções em 48 h para 1 mudança; VIVO-7). Auditoria de 19/10/2026 (DELL-9): depois de qualquer falha o ciclo seguinte rodava `--resync
--resync-mode newer`, que reconstrói a base e **anula o `--max-delete`**; se o que falhou foi justamente a trava (`too many deletes`), o
ciclo seguinte aplicava as exclusões que ela segurou. Agora a falha por max-delete **para o sync** (marca `parado-max-delete` no estado, sem
resync automático) e avisa pelo Telegram (origem `silmer-drive-sync`, a chave limita a 1 por dia); só volta depois que o Rômulo confere o
que ia ser apagado e remove a marca. As outras falhas seguem com o resync de antes. No bisync `--max-delete` é **percentual** (10 = 10% dos
arquivos), não contagem. A saída do rclone vai ao journal e a `ultima-saida.log`; a unit usa `%h` e só define `RCLONE_CONFIG`.

## Scripts de operação do n8n (`claude-ops/`)

Copiados para `~/.local/share/claude-ops` no Dell. `n8n.py` é o cliente da
API (chave de operações em `~/.config/claude-ops/n8n-api-key`);
`aviso-de-falha.py` liga o Error Workflow em todos os fluxos;
`site-antes-da-venda.py` aplica as mudanças do Site (os scripts-remendo do PRUMO, `prumo-ajustes`, `prumo-ajuste-planilha`, `prumo-rodizio`,
`prumo-escolha`, `prumo-aviso-fila` e `prumo-desfazer-saudacao`, foram apagados em 19/10/2026: aplicados uma vez, rodar de novo desfazia o
desenho vivo; apague as cópias antigas de `~/.local/share/claude-ops`); `prumo-aviso-unico.py` faz a resposta do formulário fora dos
prospects avisar uma vez só (memória em `~/.local/share/n8n-estado/prumo-avisados.json`,
24/09/2026; apagar o arquivo faz cada resposta avisar mais uma vez). A memória
do fluxo (`$getWorkflowStaticData`) não serve aqui: o n8n só a grava quando o
id do fluxo tem até 21 caracteres, e os fluxos importados do PRUMO usam UUID;
`rodar-agora.py <id>` executa um workflow agora.

## Links rastreados e pendências (`claude-ops/fecha-ciclos.py`)

`wa_link` (Site antes da venda) e "Enviar convite" (PRUMO) apontam para
`https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook/enviar` e
`/webhook/convite`: o clique **só abre o canal**, nunca marca envio (regra `[abrir-nao-envia]`, 18/10/2026). O do Site
grava `clique_em` no fluxo "04 · Clique no wa_link (registra o clique)" (era "(marca enviado)", e o nó "Marcar como enviado" virou
"Gravar clique_em"; ao publicar, `fecha-ciclos.py` acha o fluxo pelo nome velho e o renomeia pelo id, sem criar um segundo com o
mesmo path); o do PRUMO ("PRUMO — Clique em Enviar convite") só redireciona, sem "Primeiro clique?" nem "Marcar como enviado". Quem marca
`enviado` é o observador do WhatsApp, quando a mensagem sai de verdade. Desde
29/09/2026 o `tailscale serve` do Dell publica `/webhook` do n8n nesse
endereço, **só para a tailnet** (não é Funnel; `/` continua sendo o Hermes).
O link abre em qualquer aparelho logado na tailnet com a conta do Rômulo:
no celular, instale o Tailscale e entre com a mesma conta. Até 29/09 a base
era `127.0.0.1:5679`, que só abria no Dell.

```bash
sudo tailscale serve --bg --set-path /webhook http://127.0.0.1:5679/webhook
tailscale serve status   # / -> 9119 (Hermes), /webhook -> 5679/webhook
cd ~/.local/share/claude-ops && python3 fecha-ciclos.py   # refaz só o 04 do Site (a opção --tailnet e o Lead Scout antigo saíram do script em 19/10/2026)
```

O Balcão remonta o `wa_link` dos leads `pronto` a cada hora
(`balcao-cruzar.js`); os textos das mensagens ficam em `site-mensagem.js`.

**Mensagens do PRUMO** (08/10/2026, plano PRUMO seção 5). A primeira mensagem
tem duas variações: **A** (controle, "Encontrei vocês no Google…") e **B** (a
nota e o número de avaliações do Google, das colunas `nota` e `avaliacoes` que
o Caçador grava). A B só entra no sorteio do lead com nota **4,3 ou mais** e
**15 avaliações ou mais**; sem os dois, o lead sai na A. Entre os que têm nota
boa, metade A e metade B (desde 14/10/2026 por alocação balanceada no nicho, ver
abaixo; até então, pela letra do `place_id`). A **C** oferece o Raio-X
(`<demo>/raio-x`, `raio-x.py`) e só entra para o lead cujo `publicado.json` tem
`raio_x_url` e `raio_x_pontos` (1 a 3): o texto diz quantos pontos a página
mostra ("1 ponto que faz", "2 pontos que fazem"), nunca "3" fixo. O Balcão grava
o `raio_x_url` na coluna de mesmo nome (o `--balcao` cria) porque a segunda
mensagem e o follow-up são montados da linha: quem recebeu a C ganha o raio-x e
o site na segunda, e o follow-up lembra o raio-x. Sem a coluna preenchida, a
segunda é a do site. Um lead `pronto` que o Raio-X alcança é sorteado de novo
no conjunto com a C (pode ir para a C). A segunda mensagem termina com o preço do
Encontrado (R$ 690 + R$ 39/mês, pago depois de ver no ar; em inglês, sem
número), e os dois follow-ups do 3º dia são os do plano. O CRM espelha a
segunda e os follow-ups em `server/site-mensagem.ts` (teste compara com o JS).
Ao comparar A e B no funil, lembre que a A também recebe os leads de nota baixa:
por isso, desde 14/10/2026, o CRM compara as letras no bloco "A × B (mesmo
sorteio, por nicho)" de Resultados, só entre leads com o mesmo conjunto elegível.

**A/B estratificado** (14/10/2026; desenho completo em
`docs/referencia/perfis-e-experimentos.md`). A letra sai de `alocarRodada`
(`site-mensagem.js`): no estrato nicho (coluna `vertical`) × letras elegíveis, a
de **menos** leads já atribuídos na planilha (toda linha com letra A/B/C e
`ab_elegiveis` válidos; `manual`, `EN` e vazio não contam), empate pelo hash
antigo do `place_id`, os leads da rodada em ordem de `place_id` e somados um a
um. A letra congela enquanto o `ab_elegiveis` salvo for o de agora; mudou o
conjunto (Raio-X chegou ou sumiu) ou a linha não tem conjunto, sorteia de novo.
Só lead `pronto` é reescrito: o que saiu nunca muda. O lead sem demo (Raio-X
avulso) tem o conjunto `C`, sem sorteio e fora dos pares; sem raio-x ou nos EUA
não há mensagem (null) e ele não vira `pronto`. O histórico (150 envios sem
letra e os sorteados pelo hash, sem `ab_elegiveis`) e o aviso do 05 ·
Acompanhamento (follow-up) não entram no teste.

**O que cada lead recebeu** (07/10/2026, para o funil aprender comparando).
Colunas no fim da aba Leads, gravadas pelo Balcão (`python3
site-antes-da-venda.py --colunas` cria; o `--balcao` também):

- `mensagem_variante`: a letra do texto que o `wa_link` leva (`A`, `B`, `C` de
  `VARIACOES`; `EN` nos EUA; vazio sem telefone). Até 14/10/2026 a letra saía do
  `place_id`; desde então sai da alocação balanceada acima e fica guardada na
  própria coluna, então um lead `pronto` não troca de variação entre duas
  rodadas enquanto o conjunto não mudar; com B e C `null`, todo lead é `A`. É gravada enquanto o lead está
  `pronto`: o clique no `wa_link` grava `clique_em` (não marca `enviado`), e o observador, ao ver a saída até 15 min depois do
  clique, marca `enviado` e a letra fica. Quando o envio aparece sem o clique recente (o observador vê `owner_sent`, a leitura ou a
  resposta de um lead ainda `novo`/`pronto`), o observador grava `manual`: o texto foi o que
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
- `ab_elegiveis` (14/10/2026): as letras que o lead podia receber no sorteio
  (`A`, `AB`, `AC`, `ABC`), gravada na mesma escrita de `mensagem_variante`
  enquanto o lead está `pronto` e congelada com ela depois do envio; vazia nos
  EUA e sem telefone. É ela que diz com quem a letra pode ser comparada; o CRM a
  lê como `abordagem.elegiveis`. Linhas de antes ficam vazias (fora do teste).
- `gate_de_envio` (18/10/2026; **o Balcão deixou de escrevê-la em 19/10/2026**): a coluna segue na planilha, mas ninguém a escreve, nem o `--balcao` a cria.

**Gate de pré-envio da 1ª mensagem** (18/10/2026; **fonte única desde 19/10/2026**). O gate PURO em TypeScript
(`server/gate-de-envio.ts`) confere o texto já montado, sem modelo: marca sem preencher (`{NOME}`, `[x]`, `undefined`), frase de IA ou de agência,
emoji, mais de 600 caracteres, link (a 1ª mensagem não leva), nome da empresa vazio/com lixo/repetido e "R$" fora dos preços abertos do cardápio.
Ele roda onde a mensagem é oferecida: na Central e no vendedor do Telegram (em `avisar` ou `bloquear`, conforme a origem do texto) e quando o time
comercial pede a reserva (`bloquear`). **O Balcão não o confere mais:** a cópia em JS (`gate-de-envio.js`), o modo `GATE_DE_ENVIO` e o
`server/gate-de-envio-balcao.test.ts` saíram, porque no modo padrão (`avisar`) só escreviam uma coluna que ninguém lia. Nunca reescreve o texto
nem mexe no sorteio das letras.

```bash
cd ~/.local/share/claude-ops
python3 site-antes-da-venda.py --testar       # cruzamento no node, planilha de mentira, sem n8n
python3 site-antes-da-venda.py --testar-n8n   # cópia do Balcão: recibos reais, planilha de mentira, nada gravado
python3 site-antes-da-venda.py --balcao       # colunas que faltam + publica o Balcão
```
O texto do convite do PRUMO fica em `prumo-simples.py` (função `convite`) e é
montado a cada clique; `python3 prumo-simples.py --convite` publica só esse
fluxo, sem mexer na planilha nem na Pontuação. A abertura das mensagens **mudou**: a decisão de 30/09/2026 ("Me chamo Rômulo e
represento o Prumo", em `romulosutil/prumo`, `00-contexto/decisoes.md`) foi trocada em 05 e 19/10/2026 pelo guia do topo das
`VARIACOES` em `site-mensagem.js`. Hoje: o Site abre com "Oi, tudo bem? Aqui é o Rômulo." (sem "do PRUMO") e o follow-up com "Oi, é o
Rômulo de novo."; o convite do PRUMO com "Aqui é o Rômulo, do Prumo"; o do Iris e o das estamparias com "Aqui é do Prumo"; o Plus com a
saudação da Ordem. O aviso "Site publicado" do Hermes (`site_antes_venda_watcher.py`) **foi aposentado em 19/10/2026** (o texto divergia do
guia e ficava fora da fila: duas mensagens para o mesmo fato); a unit `site-antes-venda-watcher` e o script em `~/.hermes/scripts` saem da Mel.

Depois do envio (`claude-ops/site-acompanhamento.py`, 29/09/2026):

- **05 · Acompanhamento** (todo dia, 09:00): `enviado` sem `respondeu_em`, enviado a partir de 29/09, **só expira**: no 7º dia
  (`EXPIRA_DIAS`, o mesmo `DIAS_SEM_RESPOSTA` da Central; era o 10º) vira `expirado`, com um aviso só dos expirados. Vale também para
  lead sem pasta nenhuma (a mensagem A vai a lead sem recibo); quem tem pasta em `_recusados/` ou `_em-conversa/` não expira. O que foi
  enviado antes é acervo: saiu um resumo único (`--resumo-backlog`) e nada é automático. **O follow-up do 3º dia não é mais daqui**
  (19/10/2026): o 05 não grava mais `followup_em` (a coluna segue na planilha, ninguém a escreve) e, desde 17/10 (OT-01), também não avisa.
  A Central é a dona do follow-up e do Perdido (`server/crm.ts`): calcula o dia sozinha a partir do envio, vale do 3º ao 6º dia, só para
  quem leu, e aparece em Vendas › Conversas para você e no "Envie para X" do Telegram.
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
  "Gerador de sites") e o script não reescreve mais a cópia. **O `site-nichos.py` de hoje só troca a
  lista `FEMININOS`** (o artigo da mensagem, "da Desentupidora X", "do Escritório Y") em todo nó Code do n8n que a copia, lida do
  `site-mensagem.js`; a pausa das buscas, a troca da regra 1 e do Pontuar e a escrita do `CLAUDE.md` foram apagadas dele em 19/10/2026
  (rodar a pausa hoje desligaria as ~80 buscas que o `site-buscas-ampliar.py` acrescentou). Rodar de novo não muda nada; `--testar` não grava.
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
resposta" conta só quem ainda está na raiz de `~/auto-site`. (O `prumo-rodizio.py`, que punha o Lead Scout em rodízio de buscas, foi apagado em
19/10/2026 com o Lead Scout desligado.) `claude-ops/prumo-porte-cnpj.py` liga o filtro de porte (código do nó
em `prumo-porte-cnpj.js`): acha o CNPJ no site, consulta a Receita pela
BrasilAPI e descarta MEI, microempresa, rede, CNPJ baixado e quem não é
comércio. Quem passa leva o resumo do CNPJ na coluna Briefing.

## Página do lead e limpeza dos demos (`claude-ops/site-lead-acoes.py`, `site-demos-limpeza.*`)

Decisões do Rômulo de 29/09/2026: o Hermes **não manda mensagem a lead**
(risco de banimento do WhatsApp), mas o desfecho de cada lead se marca com um
toque no celular; e demo de quem recusou ou expirou saía do ar da Vercel 15 dias depois (a **pausa**, "nunca apagado"). A
pausa foi trocada pela **limpeza** em 08/10/2026 e o `site-demos-pausa` foi aposentado em 19/10/2026 (ver abaixo).

**Página do lead** (fluxo `07 · Lead: página e ações`, id `Kf5IWNdEFFnuSOy2`):
`…/webhook/lead?id=<place_id>` pela tailnet (mesma base do `wa_link`) mostra
nome, link do demo, estado e os botões. Nada é enviado a ninguém.

Os botões são **Recusou**, **Fechou**, **Desfazer** e, para quem pediu, **Gerar demo**. **Desde 19/10/2026 abrir o link não grava
nada** (regra `[confirmacao-http]`, `workflow_confiabilidade.confirmar_acao`): o `GET /webhook/lead-acao?id=…&acao=…` só mostra uma página de
confirmação com o formulário, e quem grava é o **POST** do botão Confirmar, que precisa vir da mesma origem (tailnet ou loopback) e com o
contexto (o estado do lead) igual ao da página: origem errada dá 403, lead que mudou dá 409 (reabra). Um link aberto, recarregado ou
pré-visualizado pelo WhatsApp nunca escreve. O que cada ação faz:

- **Recusou**: `status` = `recusado`, `recusado_em`, pasta → `_recusados/`;
- **Fechou**: `status` = `fechado`, `fechado_em`, pasta → `_fechados/`;
- **Desfazer** (só em recusado/fechado): volta a `status_anterior` (sem ele,
  `enviado`), apaga a data, a pasta volta para onde estava. **Não traz de volta o demo que a limpeza já apagou da Vercel** (só
  republicando), e a página avisa isso.

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

**Pausa dos demos: aposentada em 19/10/2026.** Desde 08/10/2026 a limpeza (abaixo) **apaga** o demo de todo lead em Perdido no
CRM dois dias depois, então a pausa de 15 dias (`site-demos-pausa`, timer das 09:40, estado em `~/.local/state/site-demos-pausa/`) só agia
no que a limpeza não pega e, por isso, ficou duplicando a regra com datas próprias (15 dias de `recusado_em`, `enviado_em` + 10 para
expirado) e outro conjunto de pastas. O script, o teste, a unit e o timer saíram do repositório; na Mel: `systemctl --user disable --now
site-demos-pausa.timer` e apagar as cópias e o estado (comandos na seção de instalação da auditoria, `docs/auditoria-de-fluxos-2026-10-19.md`).
A página do lead diz hoje: quem está em Perdido há 2 dias (recusou, não respondeu em 7 dias, parou de responder) tem o demo **apagado** da
Vercel; a pasta e o conteúdo ficam no Dell.

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
dela confirmando o projeto. A pasta fica; o `publicado.json` ganha `apagado_em`
e o CRM tira "Ver o demo" e a segunda
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

**Registros novos da aba CRM (19/10/2026, Fases 2 a 4 do diagnóstico de vendas).** `spiced` (qualificação SPICED confirmada pelo Rômulo, JSON de
até 1000 caracteres; dor + impacto + decisor confirmado liberam a proposta), `cadencia_enviada` (o toque de acompanhamento da proposta ou da
conversa, confirmado à mão) e os fatos do AARRR: `valor_proposta`, `pagamento_confirmado`, `receita_desfeita`, `origem`, `motivo_perda`,
`retencao_3m`, `indicacao_pedida`, `indicacao_recebida`. O `crm.py` valida o formato de cada um antes de gravar (`python3 crm.py --testar`).
A **Estrela-guia** é o número de `pagamento_confirmado` da semana de São Paulo (as cinco linhas): "ganhou" não é pagamento, e sem registro é
"não medida". Regras e telas em `docs/referencia/perfis-e-experimentos.md`, "Diagnóstico de vendas: Fases 2 a 5".

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
`expirado` pelo 05 —; uma **proposta** também; e uma mensagem nova do lead o
traz de volta sozinho. O CRM só calcula: a planilha continua com o status que
tem. **Proposta tem relógio próprio (19/10/2026, `src/operations/cadencia.ts`):** perde no 10º dia corrido sem retorno, com
retornos no 1º e no 3º dia úteis; a conversa recebe um toque no 2º dia útil e revisão no 7º corrido. **Desde 19/10/2026 o 05 · Acompanhamento expira no mesmo 7º dia** (era o 10º, e as duas contas se desencontravam: o CRM
tirava o lead no 7º e a planilha só no 10º). Quem sai pela regra cai na limpeza dos demos dois dias depois.

"Entregue sem lido" é **não sei**, nunca "não viu": quem desliga a confirmação
de leitura nunca aparece como lido; quem respondeu aparece como "leu
(respondeu)". Sinais: **follow-up hoje** (Em contato há 3 a 6 dias sem resposta, só quem leu;
no Site só envio a partir de 29/09; desde 19/10/2026 o dia é da Central, sem depender do `followup_em` do 05; desde
08/10/2026 o link "Mandar o follow-up" abre o WhatsApp com o mesmo texto do
aviso do 05, de `server/site-mensagem.ts`, espelho testado do
`site-mensagem.js`), **resposta
nova** (respondeu nas últimas 48 h; exato quando houver colunas de última
entrada/saída), dias na etapa e desde o último evento, **divergência**
(planilha e pasta discordam depois de 2 h de folga: nota na ficha, nunca
correção).

> **Nota de 19/10/2026 sobre os dois blocos seguintes.** O que segue descreve o CRM de 14–16/10. Hoje: abrir o WhatsApp ("Mandar o link",
> "Mandar o follow-up", "Enviar pelo WhatsApp") **nunca anota nada**; quem anota é o "Enviei" explícito na missão da conversa (ou o observador,
> quando a mensagem sai). A "Hoje" e a folha "Enviar um por um" saíram; a vista inicial de Vendas é **Conversas para você** (a fila inteira de
> quem já foi contatado) e o primeiro contato mora em **Primeiros contatos** e na Ficha de um lead Novo, com as travas de horário e ritmo
> (hoje 5 min entre um e outro, 12 por hora e 100 por dia). `server/crm.ts` guarda a visão por 20 s (`TTL_DA_VISAO_MS`).

**Loop fechado (14/10/2026).** Dos 221 envios, 5 de interesse e 0 propostas:
"Manda aí" e "Pode sim" de 08–09/10 saíram da Hoje em 48 h sem o CRM saber se
o link foi mandado, e os 65 lembretes de follow-up não diziam se algum saiu.
Agora o toque em "Mandar o link" (2ª mensagem) e em "Mandar o follow-up", na
Hoje, no Funil ou na Ficha, abre o WhatsApp como antes e, em segundo plano,
anota `segunda_enviada`/`followup_enviado` na aba CRM (idempotente por 2 min;
se falhar, a tela pede "anote à mão"). **Interesse parado** (resposta
classificada `interesse` sem 2ª mensagem anotada depois dela, ou sem
`ultima_saida_em` posterior) fica em "Respostas para responder" sem o limite
de 48 h, na frente e o mais antigo primeiro; passadas 2 h, a ação diz "Quer ver
há N dias — o link ainda não foi mandado". Sai com a 2ª mensagem ou com a saída
normal da etapa (recusa, proposta, ganho, regra dos 7 dias). O follow-up
anotado depois do envio apaga o "follow-up hoje". O **regime** da 1ª mensagem
(`curta_com_link` até 29/09, `prumo_com_link` 30/09–04/10, `duas_mensagens`
desde 05/10, a regra de `regime_da_mensagem` do `funil-aprendizado.py`) vai em
`abordagem.regime`, à parte da letra.

**As vistas** (celular primeiro; `?ver=funil`, `?ver=resultados`,
`?produto=site|prumo`, `?lead=site:<place_id>`):

- **Resultados** (desde 08/10/2026): quem foi **enviado** no período (14 dias,
  30 dias, tudo; pela data de envio) e o que rendeu, por nicho, pela variação
  da primeira mensagem (`mensagem_variante`) e pela versão do site
  (`site_versao`): respondeu (gente; robô não conta), viu (só com confirmação
  de leitura), quis ver, recusou, fechou. Recusa só entre enviados (o acervo
  de `_recusados/` não recebeu mensagem rastreada); menos de 10 enviados leva
  o aviso "amostra pequena". Envios sem a letra (até 07/10) entram pelo regime
  da data ("Com link na 1ª mensagem", "Pedido de licença, sem link"); sem data,
  "Sem registro". Desde 14/10/2026, também o follow-up anotado e quantos
  responderam depois dele, e a 2ª mensagem anotada entre quem quis ver.
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
  desfazer); os envios anotados ao tocar no link aparecem como "2ª mensagem
  enviada" e "Follow-up enviado".

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
resposta completa de um prospect ou de um lead do Raio-X, grava um pacote em
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

**Lead do Raio-X (15/10/2026).** O convite do Mapa de cada Raio-X do Dell
leva o formulário com a Empresa preenchida (`entry.171063854` =
`<place_id>::<nome>`, `mapa_link_do_lead` no `raio-x.py`). O fluxo procura o
ID que não é prospect no retrato da planilha do Balcão
(`n8n-estado/site-leads.json`, de hora em hora aos :20; tem todo lead com
Raio-X publicado). Achado, a resposta completa vira pacote (cidade do retrato,
segmento vazio, `lead_do_site: true`) e o "Calcular diagnóstico" não manda o
aviso de "fora dos prospects" (trecho marcado `[mapa-leads-do-site]`). Nada
escreve na planilha de prospects: ela continua só do funil B2B.

`prumo-mapa-n8n.py --teste` ensaia o ramo e o "Calcular diagnóstico" numa
cópia temporária do fluxo (prospects, retrato e respostas de exemplo, com um
lead do Raio-X; fila `mapa-teste/`, memória e retrato de teste, sem planilha).
`prumo-simples.py` recria o fluxo sem o ramo: depois dele, rode
`prumo-mapa-n8n.py` de novo.

## Gerador de sites (`gerador-de-sites.*`)

**Demo sob pedido (14/10/2026).** Ideia do Rômulo: de ~230 demos publicados, 7 viraram
conversa e nenhum fechou, e cada demo custava ~18 min de Claude (~100 chamadas). Com o
arquivo `~/auto-site/.demo-sob-pedido`, nada é gerado antes da resposta:

1. O Caçador cria a pasta, como sempre. O `raio-x.timer` (11:15 e 17:15) faz o **Raio-X
   avulso** dos leads novos do Brasil (só código e Places, sem modelo) e o publica em
   `raio-x-prumo.vercel.app/<nome>`, no projeto `prumo-raio-x` (o mesmo dos feitos à mão;
   ver "Raio-X do PRUMO"). O recibo nasce **sem `site_url`**: é assim que toda a esteira
   sabe que ainda não há demo. Lead abaixo do padrão do modelo (sem 3 pontos) ganha
   `raio-x-sem-padrao.json` e não é abordado.
2. O Balcão marca `pronto` com a variação **A** ou **C** (conjunto `AC`, sorteio balanceado).
   Até 14/10 só a C ia sem demo, porque a A diz "montei uma demonstração"; desde 15/10/2026,
   por decisão do Rômulo, a A também vai, e o demo é feito se o lead responder (passo 4). A B
   continua só para quem já tem demo. Lead dos EUA não tem Raio-X (é só em português) e segue
   na fila de sempre do gerador.

   **A sem demo para quem não tem recibo nenhum (15/10/2026).** Lead do Brasil `novo` (ou
   `pronto`) sem `publicado.json` (gerador que falhou, fila antiga, Raio-X sem padrão) também
   vira `pronto` com a A, conjunto `A`, sem `site_url`. Fora: EUA, sem telefone, o que tem
   qualquer recibo (até cópia ou descartado) e o descarte do gerador. No CRM a sub-etapa diz
   "sem demo (gere quando ele pedir)", e quem responde "quero ver" ganha só o **Gerar demo**
   (não há segunda mensagem até o demo sair). O `site-pastas` acha a pasta desse lead pelo
   `place_id` do `content.md`, e o fluxo 07 manda o pedido mesmo sem recibo conhecido.
3. Ele responde: a segunda mensagem é só o raio-x, oferecendo a demonstração, sem preço
   (`SEGUNDA_RAIO_X_SEM_DEMO`).
4. Ele quer o site: **"Gerar demo"** na ficha do CRM (ou na página do lead, fluxo 07). O
   `site-pastas` grava `PEDIDO-DEMO.json` na pasta, onde ela estiver (quem respondeu está em
   `_em-conversa/`), e acorda o `gerador-de-sites-pedido.service` (`--pedidos`), que espera
   a trava de uma execução em andamento. O pedido sai personalizado, sem triagem (o lead já
   conversa), com o recibo do Raio-X guardado à parte durante a geração e mesclado no fim.
   Uma tentativa por toque: falhou, o pedido sai e o aviso diz para tocar de novo.
5. O demo no ar: aviso no WhatsApp, o Raio-X avulso é republicado citando o endereço do
   demo, e a ficha oferece "Mandar o demo" (`DEMO_DEPOIS_DO_RAIO_X`, com o preço; desde 15/10
   é o mesmo texto da `SEGUNDA`).

Sob pedido, a fila das 08:00 só leva lead de fora do Brasil e os pedidos; o `lote-continuo`
não roda (sai na hora). Desligar: `rm ~/auto-site/.demo-sob-pedido`, e tudo volta a ser
como antes (os recibos avulsos já publicados continuam valendo).

```bash
touch ~/auto-site/.demo-sob-pedido              # liga
python3 ~/.local/bin/gerador-de-sites --listar   # mostra os pedidos e quem espera o Raio-X
raio-x --pendentes --simular                     # os leads novos que o timer pegaria
systemctl --user start gerador-de-sites-pedido.service   # roda os pedidos já gravados
```

**Um shot do Dribbble por lead (14/10/2026).** Pedido do Rômulo: os demos
estavam "focados demais em mobile" (coluna de celular no meio da tela de
1440 px), e a biblioteca fixa de 13/10 só tinha primeiras telas de celular.
Agora o passo 1.6 do `auto-site-CLAUDE.md` busca no Dribbble a cada lead e a
cada refazer: `dribbble buscar` (miniaturas dos populares + `indice.txt`) e
`dribbble shot <link>` (as imagens do shot e, se for vídeo, 6 quadros pelo
ffmpeg), lidos numa folha da `folha-de-contato`. O curl leva 202 sem corpo; o
Chrome headless passa, sem login. O desktop segue a composição do shot; o
celular continua em até 6 telas. Saíram `auto-site/REFERENCIAS.md` e
`auto-site/referencias/`. Exemplo aprovado (Jéssica Barbosa Advocacia, shot
"Alden & Vale"): `auto-site/_exemplos/`, instalado em `~/auto-site/_exemplos/`
(pasta com `_`: nenhuma varredura de fila entra nela). O Raio-X **não** segue
o Dribbble: o padrão é o Raio-X aprovado do piloto CDL
(https://prumo-piloto-cdl.vercel.app/raio-x, gerado pelo
`04-venda/piloto-cdl/gerar.py` do repo `prumo`). Uma versão 5 do `raio-x.py`
com outra cara entrou e saiu no mesmo dia (14/10/2026), antes de ser instalada:
o Rômulo apontou que ela não coincidia com o aprovado. O Raio-X da Jéssica no ar
saiu do `gerar.py`. No mesmo dia o `raio-x.py` passou a desenhar com o molde do
`gerar.py` (`prumo-mapa/modelo_raio_x.py`): é a versão 5 de verdade, descrita
em "Raio-X do PRUMO".

**Clareza antes de conceito (13/10/2026).** A auditoria dos 54 demos no ar em
13/10 achou cara de IA em quase todos (título-aforismo, menu I-II-III, campo de
texto em 39, vidro fosco em 34, 11 telas de mediana) e configuração errada
(código do modo `?qa` publicado em 29, WhatsApp com número fora do
`content.md` em 4, 19 acima de 450 KB). O que mudou:

- `auto-site/auto-site-CLAUDE.md`: as cinco perguntas do visitante no lugar de
  "metáfora e Atos" (a metáfora fica só no visual), seção "Cara de IA",
  movimento sóbrio, um WhatsApp só e de fonte certa, e a biblioteca
  `auto-site/REFERENCIAS.md` (3 sites reais por nicho) no lugar do Refero, que
  é acervo de produto SaaS (trocada pelo Dribbble em 14/10, acima);
- `qa-numerico`: reprova título em duas frases, entre aspas ou sem ofício nem
  cidade, menu numerado, frase de gaveta, campo de texto, código de teste
  publicado e WhatsApp fora do `content.md`; mede a página a 390 px de verdade
  (iframe numa moldura) e reprova mais de 8 telas, rolagem lateral, toque
  abaixo de 40 px e texto abaixo de 12 px. As capturas do Ato I passaram para a
  moldura: com `--window-size=390,844` o Chrome desenhava a página com ~500 px
  (medido no Chrome do Windows; o gate avisa a largura real da janela do Dell
  em "Largura das capturas"). `qa-numerico --celular URL SAIDA.png` tira uma
  captura de celular de verdade;
- modo premium **apagado** (desligado em 13/10/2026 e removido em 19/10/2026, com `--premium`, `--nota`, `GERADOR_PREMIUM_LIGADO` e
  `instrucoes_premium`; os sites que ele fez têm `personalizado.json` com `versao` 3 e seguem valendo, e o lote só refaz quem tem versão menor
  que a atual; o `lote-continuo` segue no personalizado).

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

Desde 15/10/2026 **o demo tem SEO técnico** (`seo-do-site.py`, instalado em
`~/.local/bin/seo-do-site`). Antes, só `<title>` e `og:image`; agora a página
tem uma seção de perguntas (`<section id="perguntas">`, 3 a 5 `<details
data-fonte>` tiradas dos temas das avaliações) e, depois do `og.jpg`, o
Claude roda `seo-do-site <pasta> --url <demo> --exigir-faq`: JSON-LD
LocalBusiness (subtipo pelo `Vertical:`) + FAQPage no `<head>`, e
`robots.txt`, `sitemap.xml` e `llms.txt` na pasta, que sobem junto. Nenhum
valor é escrito à mão: nome, telefone e nota do `content.md`; endereço
estruturado, coordenadas e horário do Places (um pedido por lead, cache
`seo-places.json` de 30 dias, a chave do raio-x); perguntas do texto visível.
`aggregateRating` só com a nota exata, só se a página a mostra e nunca em
advocacia ou saúde. `seo-do-site <pasta> --conferir` refaz o esperado e acusa
campo sem fonte ou diferente da fonte. Se o Claude publicar sem rodar, o
runner aplica e republica (`garantir_seo`); o deploy de reserva aplica antes
de subir; o Raio-X leva os três arquivos de novo no deploy dele. Demo antigo
não é regerado: ganha o SEO só num refazer.

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
"R$ 690 + R$ 39/mês, paga depois de ver funcionando". Alimenta a variação C da
primeira mensagem do Balcão. Desde a versão 4 (abaixo) a página é em três atos
(veredito, por quê, o que fazer) e termina no WhatsApp do PRUMO; desde a versão 5,
é o Raio-X aprovado do piloto CDL; desde 15/10/2026, termina no convite para o Mapa (abaixo).

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
- **Publicação.** Um deploy a mais por lead: `index.html` + `og.jpg` (+
  `robots.txt`, `sitemap.xml` e `llms.txt` do SEO técnico, quando o demo os tem) +
  `raio-x/index.html`. Antes, o `index.html` e o `og.jpg` (e os do SEO) da pasta são
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
- **Versão 4 (PR #74, no ar desde 14/10/2026): três atos.** O teste de
  usabilidade e a análise de funil de 09/10 mostraram que o dono decide no
  Raio-X, e a página tinha 13 blocos, a nota só no 6º e nenhum botão no fim.
  *Veredito* (cabe na primeira tela a 390×844): nome, nota e avaliações do
  Google, a faixa da Nota de presença (Pouco visível, Em construção, Bem
  visível; o "X de 18" sai da frente, `calculo_prumo.bloco_faixa_html`) e o que
  segura e o que perde cliente. *Por quê*: os pontos abertos; o resto em
  `<details>` fechados (o que já está bom, quem aparece antes na busca, o que os
  clientes dizem, o perfil item por item e "Como fizemos", com o "X de 18" e a
  calculadora). *O que fazer*: a demonstração, o Encontrado com preço e "só
  pagam depois de ver funcionando", o botão **Quero o site no ar** (WhatsApp do
  PRUMO, `WHATSAPP_PRUMO`, com o nome da empresa na mensagem) e "Quero conversar
  sobre produtos digitais", **sem preço**: o Respondido só na conversa.
  No celular, uma barra fixa com o botão quando o terceiro ato entra na tela.
  Saem o caminho do cliente e o bloco com os dois serviços e o preço do
  Respondido. Medição sem cookie preparada e desligada (`URL_EVENTOS` vazia).
  Com a versão 4 instalada, o `--pendentes` refaz quem está `pronto` na versão 3
  (até 6 por rodada, um deploy cada); lead já `enviado` só muda com
  `raio-x <slug>` à mão, e a URL (`<site_url>/raio-x`) não muda.
- **Versão 5 (14/10/2026): o modelo aprovado do piloto CDL.** O Raio-X da
  Jéssica Barbosa feito pelo Dell não coincidia com o aprovado
  (prumo-piloto-cdl.vercel.app/raio-x, `gerar.py` do repo `prumo`). Agora o
  `raio-x.py` só junta os dados e o desenho é o do piloto, no
  `prumo-mapa/modelo_raio_x.py`: o diagnóstico vira um JSON no esquema de
  `modelos/raio-x.json` do piloto (`dados_do_modelo`) e o módulo desenha. Com um
  JSON feito à mão, o módulo dá a página do `gerar.py` byte a byte (conferido no
  exemplo da Odonto Maré e na Jéssica); o que o automático precisa a mais são
  ganchos opcionais (`GANCHOS`: o lede e o método dizem que só se leu o Google;
  as avaliações são "as que o Google mostra primeiro"; o checklist do perfil
  marca "não conferido"). O que entra:
  - **Três buscas** (`consultas_das_buscas`, escolhidas antes de ver o
    resultado): o termo do ramo, a área achada no nome ou no tipo do Google com
    o serviço de valor dela ("advogado previdenciário" e "advogado INSS"), ou,
    sem área, o outro jeito de pedir ("escritório de advocacia") e "melhor
    advogado". Ramo fora da tabela `RAMOS`: o termo, "melhor <termo>" e o termo
    no bairro (`addressComponents`). Quatro chamadas ao Places por lead em vez
    de duas (US$ 35/1.000 cada busca; o cache de 30 dias continua); o cache da
    versão 1 (uma busca) não vale e é pedido de novo. As buscas pedem também
    `regularOpeningHours`, para comparar o horário.
  - **"Vocês e os 3 primeiros"** da primeira busca: nota, avaliações (o número
    do meio dos 3), site próprio e horário, só linhas com o dado dos dois
    lados, e a frase que fecha ("A nota está no nível dos 3 primeiros. A
    diferença está…").
  - **3 pontos, 3 coisas que estão boas e "3 coisas, nesta ordem"**, cada coisa
    com quem faz ("Vocês mesmos, hoje.", "Um fornecedor de site de vocês, ou o
    PRUMO."). Os pontos na ordem do aprovado: a busca, o site, a nota, as
    avaliações (abaixo da metade dos 5 primeiros ou, mais leve, abaixo do meio
    dos 3), o horário e as fotos; cada um com um número que o dono confere.
  - **Redes sociais e Anúncios** aparecem, marcados "não conferido": o Dell não
    abre Instagram, Biblioteca de Anúncios da Meta nem a página de resultados
    do Google. Também não confere se o dono responde às avaliações (o Places não
    entrega), então a linha "Responde às avaliações" e a frase das respostas
    não aparecem. Nada disso é inventado.
  - **O fim: o convite para o Mapa, em todo Raio-X (15/10/2026).** Pedido do
    Rômulo: o Raio-X precisa dizer que o Mapa existe. É a variante "com equipe"
    do molde do piloto: "Agora, o olhar por dentro: o Mapa", o botão para as 16
    perguntas (o formulário do exemplo, `MAPA_LINK`, com a Empresa preenchida
    `<place_id>::<nome>` para o n8n achar o lead; ver "Mapa do PRUMO"), o link do Mapa de exemplo
    (prumo-piloto-cdl.vercel.app/mapa) e a barra do celular indo ao Mapa. Os
    quatro serviços vêm abaixo, sem preço ("Os preços vêm no fim do Mapa"), cada
    um com o link do WhatsApp. O Places não diz quantas pessoas são, então o
    convite fala de "equipe" sem número. O motivo de cada serviço só sai quando
    há dado (site e anúncios sempre; WhatsApp com o horário; redes, não). Até
    15/10, sem equipe conhecida, não havia convite e os serviços vinham com o
    preço do `prumo-mapa/precos.json`.
  - **A trava do piloto** (`conferir_raio_x`, `conferir_pagina`,
    `conferir_esqueleto`): exatamente 3 buscas, 3 pontos com 150+ letras e um
    número, 3 bons, 3 coisas, 3 avaliações lidas, 4 linhas na comparação, nada
    de vocabulário interno, e os mesmos blocos, na mesma ordem, da página do
    exemplo do piloto com o convite do Mapa (o JSON dele em `prumo-mapa/exemplo-raio-x.json`).
    Abaixo disso, `AbaixoDoPadrao` e não há Raio-X (o `--pendentes` passa para
    o próximo; o Raio-X da versão anterior, se existe, continua no ar). Lead
    com só 2 pontos verificáveis fica sem Raio-X novo.
  Com a versão 5 instalada, o `--pendentes` refaz aos poucos quem está
  `pronto` (até 6 por rodada).

```bash
raio-x --simular higor-ferreira-advogado   # o diagnóstico, sem publicar nem gravar
raio-x --html higor-ferreira-advogado --saida /tmp/x.html   # só a página (chama o Places se o cache venceu)
raio-x higor-ferreira-advogado             # publica e grava o recibo
raio-x --pendentes --simular               # quem o timer pegaria
HOME=/tmp/home-teste python3 deploy/dell/raio-x.py --testar
python3 deploy/dell/prumo-mapa/calculo_prumo.test.py   # o método: limiares, Vale Norte, a calculadora (JS no node)
```

Instalar (numa sessão no Dell, ou `dell-status --instalados`; o `calculo_prumo.py`,
o `modelo_raio_x.py`, o `precos.json` e o `exemplo-raio-x.json` antes do raio-x, que os lê):

```bash
install -D -m 644 deploy/dell/prumo-mapa/calculo_prumo.py ~/.local/share/prumo-mapa/calculo_prumo.py
install -D -m 644 deploy/dell/prumo-mapa/modelo_raio_x.py ~/.local/share/prumo-mapa/modelo_raio_x.py
install -D -m 644 deploy/dell/prumo-mapa/precos.json ~/.local/share/prumo-mapa/precos.json
install -D -m 644 deploy/dell/prumo-mapa/exemplo-raio-x.json ~/.local/share/prumo-mapa/exemplo-raio-x.json
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
- revisão de um demo feita fora do Dell (14/10/2026) chega em
  `deploy/dell/auto-site/revisoes/<slug>/index.html`, fora do `instalados.json`:
  copia-se uma vez para a pasta do lead e publica-se pelo passo 5, com o
  `raio-x <slug>` logo depois (`revisoes/README.md`).

A cópia versionada é a do Dell de 05/10/2026 (sha256 `7fa99464…` e
`a101c085…`) com duas mudanças: o número de WhatsApp de um negócio citado num
exemplo foi trocado por `<número do negócio>`, e o fim do arquivo diz que a
regra nova vai no resumo final (execução automática) ou num PR (sessão com o
Rômulo), não numa edição da cópia. As skills de `~/.claude/skills` e o
`settings.local.json` (hooks do impeccable) continuam fora do repositório.

### Direção dos sites: metáfora e Atos (08/10/2026)

A direção do "redesign conceitual e de movimento" do site do PRUMO virou a dos
demos, em todos os modos (fila comum e `--personalizado`; o `--premium` foi apagado em 19/10/2026). Leitura
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
  autoral aos Atos; o laço de crítica do premium (apagado em 19/10/2026) respondia a um checklist de 20
  itens; o refazer guarda o `CONCEITO.md` anterior no `_vN/`.

As versões (`VERSAO_PERSONALIZADO`; a `VERSAO_PREMIUM` saiu com o modo) não subiram: o
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

**Nota de 19/10/2026:** o modo premium (e o laço "V" com as referências do Refero) foi apagado do gerador; a tabela e as estimativas por lead
premium abaixo são a medição de 11/10 que justificou as duas ferramentas, e o que vale hoje é o `qa-numerico` no personalizado.

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
`novo`/`pronto` também grava `manual`. Desde 17/10/2026 há também `licenca` (o
"pode mandar" que só autorizou o Rômulo a mandar o material que ele ofereceu:
mesmo efeito do interesse na planilha e no aviso, que manda enviar o material,
mas o tipo gravado é `licenca`), o classificador vê as últimas mensagens do
Rômulo e as anteriores do lead, e o áudio chega transcrito quando dá (ver
"Áudio, papel e contexto" em "Observador do número do PRUMO").

**Quanto demora o aviso** (medido em 08/10/2026, um "Sim, sou a Jackeline" de PRUMO: a resposta entrou na planilha na hora, o aviso com o texto e o link saiu ~2 min 20 s depois): o observador espera `ESPERA_DA_CONVERSA_S` sem mensagem nova do lead antes de mandar ao n8n (era 90 s, agora 45 s), o n8n classifica com o Gemini (~10–20 s) e a fila de avisos só era esvaziada pelo timer do `dell-status` (até 1 min). Desde 08/10/2026 quem grava o aviso (`avisar`, ex-`avisar_pelo_hermes`) também manda `dell-status --drenar` 6 s depois (a fila ignora arquivo com menos de 5 s); o timer continua valendo, então falha ali não perde aviso, e silêncio das 22h às 7h, teto por hora e chave de 24 h valem igual. A espera de 45 s é o preço do "Oi" + "não temos interesse" virar uma conversa só: quem escreve devagar pode gerar dois avisos. Depois do merge, reinstale o observador (`instalados.json`) e reinicie o serviço.

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
existiam. O `prumo-desfazer-saudacao.py` devolveu essas marcas antigas
a "Só resposta automática" (aplicado uma vez; o script foi apagado em 19/10/2026).

Por que o log e não um segundo aparelho: o pareamento por código falhou (no
DDD 27 o WhatsApp registra o número sem o 9). O remendo da bridge é pequeno,
idempotente e marcado (`// >>> squadone:` ... `// <<< squadone:`); o
`hermes update` guarda e reaplica mudanças locais, mas pode perdê-lo se a bridge
mudar perto das âncoras. O `aplicar-hermes.py` reaplica (o remendo de envios/recibos/respostas e, desde 19/10/2026, o da leitura dirigida do histórico, `patch_bridge_historico.py`, com a marca conferida no fim; ele não mexe mais em jobs do cron do Hermes), e o observador avisa
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
só manda ao n8n os que são lead (DDD + 8 dígitos) e, até 16/10/2026, não
gravava nada além da posição no log (ver a conversa do lead, abaixo).

**A conversa do lead em disco (16/10/2026).** Pedido do Rômulo: o "em contato"
não mostrava o que estava acontecendo, e a etapa era adivinhada pelo trecho de 200
caracteres da planilha. Agora as duas instâncias do observador gravam cada
mensagem de **lead**, nas duas direções, em
`~/.local/share/whatsapp-conversas/<chave>.jsonl` (`WHATSAPP_CONVERSAS_DIR`;
pasta 700, arquivo 600; `<chave>` = a mesma DDD + 8 dígitos que vai ao n8n). Uma
linha por mensagem: `{"em" (UTC ISO), "direcao": "entrada"|"saida", "texto" (até
2000), "origem": "pessoal"|"prumo", "id"?}`; recibo de leitura não é linha. É o
contrato que a Central lê (Ficha do CRM) e que o Hermes lê pela skill
`conversa-do-lead`; ninguém envia nada a lead a partir dele (RULES 17).

- **De onde vem cada direção.** `entrada`: o `respostas.jsonl` (o texto que a
  bridge e o adaptador já gravavam), agora com o `id` da mensagem. `saida`: um
  arquivo novo, `enviadas.jsonl` na mesma pasta de estado, que o remendo
  `squadone:envios` da bridge e o `evolution-adaptador` gravam **só para lead**
  (`{"chave","ts","texto","id"}`); o observador lê, grava na conversa e apaga, e
  não manda ao n8n (o envio já é marcado pela linha `owner_sent`, que passa a levar
  o `id`). Bridge com o remendo antigo (`owner_sent` sem `id`): a saída entra com
  `texto` vazio.
- **Deduplicação.** Desde 16/10 o Hermes e a Evolution estão no MESMO chip: a
  mesma mensagem chega pelas duas instâncias, com o mesmo id. Por isso a
  deduplicação lê o arquivo (sob flock em `.trava` na pasta), não a memória do
  processo; sem id, vale direção + hora + texto. Um reinício que relê o log não
  duplica.
- **Poda e falha.** Uma vez por dia por arquivo, na primeira escrita, sai o que
  passou de 120 dias. Erro ao gravar vai ao journal (sem o texto) e o resto do
  observador segue igual.
- **Leads do Plus (17/10/2026, OT-13).** Os do Catálogo de Negócios Maçônicos
  não estão em planilha, então o n8n não devolvia os números deles e a resposta
  de um Plus só existia se o Rômulo a anotasse na Ficha. O observador lê também
  `~/prumo-entregas/plus/leads.json` (`OBSERVADOR_PLUS`; o mesmo arquivo do
  `lerPlus` da Central, fora do git) a cada 10 min, guarda só a chave de cada
  número e a junta ao `leads.json` da bridge e do adaptador: o texto é gravado e a
  conversa entra em `whatsapp-conversas/` como a dos outros leads, e a Central a
  mostra pelo número. De quem é **só** Plus nada vai ao n8n (não há linha para
  marcar, e cada conversa custaria uma classificação do Gemini); o `plus_respondeu`
  continua sendo o toque na Ficha. Quem está no Plus e numa planilha segue igual.
  Arquivo ausente ou ilegível = sem Plus, o resto igual.
- **Instalar** (depois do merge e do `git pull`, nesta ordem: o observador antes,
  para ninguém gravar `enviadas.jsonl` sem leitor):

```bash
install -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/observador.py ~/.local/bin/whatsapp-observador
cp ~/SquadOne/deploy/dell/whatsapp-observador/whatsapp-observador.service \
   ~/SquadOne/deploy/dell/whatsapp-observador/whatsapp-observador-prumo.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart whatsapp-observador whatsapp-observador-prumo
install -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/evolution-adaptador.py ~/.local/bin/ && systemctl --user restart evolution-adaptador
python3 ~/SquadOne/deploy/hermes/scripts/patch_bridge_envios.py --testar       # numa cópia
~/.hermes/hermes-agent/venv/bin/python ~/SquadOne/deploy/hermes/scripts/aplicar-hermes.py   # SOUL, skill conversa-do-lead, remendo e restart do gateway
python3 ~/SquadOne/deploy/dell/whatsapp-observador/observador.test.py && python3 ~/SquadOne/deploy/dell/whatsapp-observador/evolution-adaptador.test.py
ls -la ~/.local/share/whatsapp-conversas/    # aparece com a primeira mensagem de lead
``` Risco de banimento: o remendo só registra, no Dell, eventos que
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

### Observador do número do PRUMO (Evolution API; 16/10/2026, instalado e conectado; observador do PRUMO ligado)

> **CORREÇÃO (16/10/2026, 11:50): a Evolution está no MESMO número do Hermes.** A instância `prumo` foi conectada
> ao chip **27 99976-2786** (conta WhatsApp Business "Prumo"), o mesmo em que o Hermes está pareado desde 09/10
> (ver "Trocar o chip", acima; o `creds.json` do Hermes e o `ownerJid` da Evolution terminam em …86 e batem nos
> 8 últimos dígitos). Durante a instalação eu comparei o número só com o antigo (…0954) e anunciei, errado, "um
> número separado". Então **o objetivo de separar a prospecção do número do Hermes (Fase 2) NÃO foi atingido**: se
> esse número for restrito ou banido, o Hermes cai junto, como em 15/10. A bridge do Hermes estava
> **"Logged out" de 15/10 às 08:32 até 16/10 às 12:02**; **foi pareada de novo em 16/10 às 12:02** neste mesmo
> número (a Evolution e o Hermes convivem como aparelhos conectados), com a sessão antiga em
> `session.antiga-5527999762786-20261016` (o Rômulo a apagou depois). **Decisão do Rômulo em 16/10/2026: não haverá
> segundo número.** A Evolution e o Hermes ficam neste chip, e a proteção é a trava de horário mais a trava de ritmo
> (Fase 0, 19/10/2026: 5 min entre primeiros contatos, 12 por hora, teto interno de 30 por dia,
> follow-up só de quem leu). Esses valores não garantem ausência de restrições e não substituem
> autorização do destinatário. Envios diretos no celular podem ficar fora da contagem. Se um dia mudar:
> `DELETE /instance/logout/prumo` e um QR novo no celular do outro número. Onde este texto diz "número novo" ou
> "número só do PRUMO", leia "o número da Evolution".

**Entrada durável (19/10/2026, Fase 5 do diagnóstico de vendas).** O `evolution-adaptador.py` só responde 200 à Evolution depois de guardar: com
a lista de leads velha ou o LID ainda sem telefone, o evento mínimo 1:1 fica em `entrada-pendente.json` (600, atômico; 2000 itens / 2 MiB;
cheio ou com falha devolve 503) e é reentregue pela hora original quando o vínculo chega. Os pares LID para telefone ficam em
`lid-telefone.json` (600) e sobrevivem ao reinício. Cada evento útil vira uma captura imutável em `capturas-adaptador/<sha256>.json`, que o
`observador.py` confirma em disco antes de remover (uma guarda por pasta impede dois consumidores). Grupos e ruído nunca entram.

Fase 2 do plano `docs/superpowers/plans/2026-10-15-envio-whatsapp-sem-bloqueio.md`: a
prospecção sai do número pessoal (onde mora o Hermes) para um número só do PRUMO no
WhatsApp Business, e esse número não tem bridge. O gateway é a **Evolution API**
(Apache 2.0, em Docker no Dell, conexão Baileys; a mesma API troca para a Cloud API oficial
se um dia houver opt-in). O `evolution-adaptador.py` recebe o webhook dela e escreve, no
formato da bridge, o que o observador já sabe ler:

```
Evolution API --webhook--> evolution-adaptador.py --> evolution.log + respostas.jsonl
                                (172.28.77.1:9131)         |
                       whatsapp-observador-prumo (o MESMO observador.py) --> n8n (whatsapp-conversa / -resposta)
```

- **Só leitura (o adaptador e o observador).** O adaptador nunca envia, marca como lido nem chama a Evolution. **Quem envia pela Evolution é
  outro processo:** o `frente-comercial.py` (time comercial, ver o começo deste arquivo) chama `POST /message/sendText/prumo` direto, só para o
  primeiro contato, sob a reserva da Central; nada disso passa pelo adaptador. Nada em
  `observador.py` (fora do silêncio do log, ver abaixo), `whatsapp-conversa.py` ou no n8n muda de
  contrato; o número pessoal e o Hermes seguem como estão. A pasta é própria:
  `~/.local/state/whatsapp-observador-prumo/` (`evolution.log`, `respostas.jsonl`, `leads.json`, `posicao.json`).
- **Mapa de eventos.** `MESSAGES_UPSERT` com `fromMe:false` = `entrada` (e o texto, só de lead, em
  `respostas.jsonl`); `fromMe:true` = `owner_sent`; `MESSAGES_UPDATE` com status `READ`/`PLAYED` (ou 4/5)
  sobre mensagem `fromMe:true` = `owner_receipt` lido; `DELIVERY_ACK` fica só nos contadores (como o "entregue"
  da bridge). Reação, edição, apagar, grupo, canal, status e quem não é lead não deixam rastro.
- **Privacidade.** Só entra no log e no `respostas.jsonl` quem está em `leads.json` (a lista que o próprio
  observador grava a cada leitura do n8n). Sem a lista, nada é gravado. O log não tem texto. O journal mostra
  DDD + 2 últimos dígitos. O webhook exige o header `X-Adaptador` (tempo constante, antes de ler o corpo).
- **Ensaio de 16/10/2026 (11:27, telefone que não é lead, modo ensaio): passou.** Mensagem enviada, `DELIVERY_ACK`
  às 11:27:28 e `READ` às 11:29:33, os dois em `@lid` e os dois resolvidos pelo id da mensagem (`nao_e_lead` = 3,
  `lid_sem_telefone` = 0). Não exercitado ao vivo: o `owner_receipt` de um **lead de verdade** chegando ao n8n
  (os testes cobrem com os formatos reais; falta o primeiro lead ler uma mensagem do número do PRUMO). Quem
  desligou a confirmação de leitura nunca gera `READ`.
- **Formato real do recibo de leitura (visto em 16/10/2026, Evolution 2.3.7).** `MESSAGES_UPDATE` chega como
  `{fromMe, instanceId, keyId, remoteJid, status}`: **só o `@lid` no `remoteJid`, sem telefone**. O `MESSAGES_UPSERT`
  de uma mensagem chega com `key.{addressingMode, fromMe, id, participant, remoteJid, remoteJidAlt}`: com
  `addressingMode: "lid"` o `remoteJid` é o `@lid` e o telefone vem em `remoteJidAlt`. Por isso o adaptador
  **lembra, só de lead e só em memória**, o `@lid` -> telefone e o id de cada mensagem nossa -> telefone
  (`Mapas`), e resolve o recibo pelo `keyId` ou pelo `@lid`. Reiniciar o adaptador esquece: um recibo de mensagem
  anterior ao reinício não resolve (conta em `lid_sem_telefone`). O journal tem `evento: ...` com fromMe, estado
  do recibo e só o domínio dos ids (nenhum número, nome ou texto), as primeiras 60 por execução, e `GET /saude` tem o
  contador `recibos` por estado. Ensaio: `journalctl --user -u evolution-adaptador | grep -E "forma nova|evento:"`.
- **Endurecimento (revisão adversarial de 16/10/2026, 12 achados, os acionáveis corrigidos com teste):** só conta
  como conversa 1:1 o `remoteJid` em `@lid`/`@s.whatsapp.net` (em grupo e status o `participantAlt` é o remetente);
  reação/apagar/edição dentro de mensagem temporária é ruído; o id só é lembrado depois de produzir saída (um
  placeholder cifrado não engole a mensagem decifrada); mensagem recebida com mais de 10 min não gera a linha de
  "respondeu" (o texto segue, com a hora certa); `respostas.jsonl` e `evolution.log` saem com `ensure_ascii` (U+2028,
  U+2029 e NEL quebravam o `splitlines()` do observador); `leads.json` com mais de 30 min vale como ausente
  (falha fechada se o observador do PRUMO parou) e `respostas.jsonl` tem teto de 2 MB; o servidor tem tempo de 10 s
  por conexão, teto de 32 conexões e recusa `Content-Length` negativo; nomes de campo que parecem id não vão ao
  journal; `receber` roda sob trava. `GET /saude` ganhou `rejeitados` (401/400/413) e `respostas_descartadas`: um
  segredo trocado só de um lado aparece ali e numa linha do journal por minuto. **Aceito, não corrigido:** as
  janelas de microssegundos entre a troca de nome do `respostas.jsonl` e a rotação do log (a rotação só ocorre a
  cada ~50 mil linhas) e os eventos que a Evolution emitir nos ≤15 s do boot em que o bind em 172.28.77.1 ainda falha
  (o `Restart` tenta de novo a cada 15 s; a Evolution não reentrega).
- **Modo ensaio (`EVOLUTION_ENSAIO=1`, desligado por padrão).** Para provar a resolução do recibo com um telefone que
  **não é lead**, o adaptador passa a lembrar também de quem não é lead (só em memória, com o mesmo teto). Prova sem
  usar número de ninguém: o recibo deixa de cair em `lid_sem_telefone` e passa a `nao_e_lead` em `GET /saude`. Liga por
  drop-in e **apague ao terminar**: `~/.config/systemd/user/evolution-adaptador.service.d/ensaio.conf` com
  `[Service]` / `Environment=EVOLUTION_ENSAIO=1`, depois `systemctl --user daemon-reload && systemctl --user restart
  evolution-adaptador`.
- **LID.** `remoteJid` em `@lid` vale com `remoteJidAlt`/`senderPn`/`participantAlt` ou com o que `Mapas` já
  aprendeu; senão o evento conta em `lid_sem_telefone` e some. Nada é adivinhado.
- **Queda do número.** `CONNECTION_UPDATE` com `close` vira UM aviso pelo Hermes até a conexão voltar. Por
  isso o `whatsapp-observador-prumo` roda com `OBSERVADOR_SILENCIO_S=0` (log parado à noite não é erro).
- **Mensagem enviada pela API** (quando houver resposta automática) também chega como `fromMe:true` e conta como
  `saida`: marca o lead como `enviado` com a letra `manual`, igual a uma mensagem digitada.
- **Na Central: "WhatsApp do PRUMO (Evolution)"** (`dell-status`, grupo Serviços; só aparece onde existe
  `~/workspace/evolution/docker-compose.yml`). Confere os três containers (`evolution-api-1`, `-postgres-1`, `-redis-1`),
  as units `evolution-adaptador` e `whatsapp-observador-prumo` e o `GET /saude` do adaptador (com o segredo, lido só dentro
  do coletor; timeouts de 2 a 3 s). Sem a marca `conectou`, o máximo é **atenção** ("QR não lido"; o observador do PRUMO
  desligado é o esperado). Com a marca: número `desconectado` = **falha** ("o número do PRUMO caiu: reconectar lendo o
  QR"), peça fora ou `/saude` mudo = falha, adaptador sem `lista_de_leads` = atenção. O resultado nunca leva segredo,
  chave da API, telefone nem texto de conversa.

**Estado em 19/10/2026 (instalado e conectado desde 16/10; a tabela de 16/10 de manhã, "nada conectado a número nenhum", ficou obsoleta no mesmo dia):**

| Peça | Onde | Estado |
|---|---|---|
| Evolution API **v2.3.7** + Postgres 17 + Redis | `~/workspace/evolution/` (compose em `deploy/dell/evolution/`, `.env` 600 fora do Git), API só em `127.0.0.1:8081`, rede `evolution_rede` (172.28.77.0/24) | no ar, `restart: unless-stopped` |
| Instância `prumo` (Baileys) | dentro da Evolution | **conectada** ao chip 27 99976-2786 (o mesmo do Hermes, ver a correção acima); leitura e "marcar como lido" desligados, grupos ignorados |
| `evolution-adaptador` | `~/.local/bin/evolution-adaptador.py`, escuta `172.28.77.1:9131` | ligado e habilitado; segredo em `~/.config/claude-ops/evolution-adaptador-segredo` (600) |
| `whatsapp-observador-prumo` | unit instalada | **ligado** (grava `leads.json`, lê o que o adaptador escreve e transcreve áudio); desligado, o adaptador, que falha fechado, não grava nada |
| Regra do ufw | `172.28.77.0/24 -> 172.28.77.1:9131/tcp` | a única aberta; sem ela o ufw (política DROP) corta o container do host |

- **Evolution 2.4 não, por enquanto.** A 2.4.x pede ativação de licença no primeiro acesso (e-mail e telefone do
  operador, mais heartbeats com versão, contadores e o IP do servidor para a Evolution Foundation) e responde 503
  até ativar; testada em 16/10/2026 (2.4.0-rc2). A 2.3.7 não pede. Custo: é de dez/2025 e o WhatsApp muda o
  protocolo; ela gerou QR normalmente nesse dia. Subir de versão é decisão do dono (dados pessoais).
- **O que faltava, na ordem (feito em 16/10, com a ressalva de que o chip é o do Hermes: não haverá segundo número; o roteiro serve para parear de novo):** (1) chip/eSIM com WhatsApp Business e perfil completo;
  (2) gerar o QR e ler no celular do número novo: `curl -s -H "apikey: $(grep ^EVOLUTION_APIKEY ~/workspace/evolution/.env | cut -d= -f2)" http://127.0.0.1:8081/instance/connect/prumo`
  devolve `base64` (imagem do QR) e `code`; o QR vale poucos segundos e a instância só tenta `QRCODE_LIMIT` (30) vezes,
  depois fecha: peça outro com o mesmo comando (o painel em `http://127.0.0.1:8081/manager`, pelo túnel, mostra o
  QR); (3) `systemctl --user enable --now whatsapp-observador-prumo`; (4) o ensaio de um dia (abaixo); (5) só então a
  fila "Enviar um por um" e a trava de ritmo contam por número.
- **Segredo do webhook.** Troca: gere outro valor, grave em `evolution-adaptador-segredo`, mande o mesmo valor na
  Evolution (`POST /webhook/set/prumo` com `headers.X-Adaptador`) e reinicie o adaptador. A resposta de
  `/instance/create` **ecoa o header em claro**: nunca cole essa saída em lugar nenhum.
- **Aviso de queda** só depois de o número ter conectado ao menos uma vez (marca `conectou` na pasta do PRUMO); o
  `close` de uma instância cujo QR nunca foi lido não é queda.
- **Reinstalar o adaptador ou o compose:** `install -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/evolution-adaptador.py
  ~/.local/bin/ && systemctl --user restart evolution-adaptador`; `install -D -m 644
  ~/SquadOne/deploy/dell/evolution/docker-compose.yml ~/workspace/evolution/ && (cd ~/workspace/evolution && docker
  compose up -d)`. A entrada do adaptador em `instalados.json` usa curinga de propósito
  (`evolution-adaptador.p?`): só é comparada depois de instalada. Depois de atualizar o `observador.py`, reinicie as
  **duas** instâncias: `systemctl --user restart whatsapp-observador whatsapp-observador-prumo` (desde 17/10/2026 o
  `reiniciar` do `instalados.json` já traz as duas, e o comando do `dell-status --instalados` reinicia ambas; é a do
  PRUMO que transcreve áudio).
- **Apagar tudo** (a pilha só tem a sessão do número, nenhum texto de conversa): `cd ~/workspace/evolution &&
  docker compose down -v`, `systemctl --user disable --now evolution-adaptador whatsapp-observador-prumo` e
  `sudo ufw delete allow from 172.28.77.0/24 to 172.28.77.1 port 9131 proto tcp`.

#### Áudio, papel e contexto (17/10/2026; código pronto, instalar na Mel)

O caso: um **áudio de recusa** chegava como `[áudio]` e ninguém o ouvia, e o "CLaro, pode enviar sim" dado a
"posso mandar o vídeo? Sem compromisso" foi gravado como `interesse`, porque o Gemini do n8n só via as mensagens do
lead, nunca a pergunta do Rômulo.

- **Adaptador** (`evolution-adaptador.py`, continua sem rede): áudio vira `[áudio 27s]` (com a duração; sem duração,
  o `[áudio]` de sempre). Para áudio de **lead** com até **120 s**, a linha do `respostas.jsonl` ganha
  `audio: {seg, msg}`, com `msg` = a chave da mensagem + o `audioMessage` **só com os campos do download** (url,
  directPath, mimetype, mediaKey, hashes, fileLength, seconds, ptt, mediaKeyTimestamp): sem miniatura, waveform,
  contextInfo nem bytes do arquivo. A mensagem vai **inteira** porque a Evolution roda com
  `DATABASE_SAVE_DATA_NEW_MESSAGE=false`: ela não guarda a mensagem, e o `getBase64FromMediaMessage` só pelo id não
  acharia nada. Áudio de lead que não dá para baixar (mais de 120 s, sem duração, sem chave de mídia) leva só a marca
  `audio: {seg}` (ou `{}`), desde a revisão de 17/10/2026: ela diz "esta instância recebeu o áudio e responde por ele"
  (ver "Um aviso por áudio"). Mídia do Rômulo (vídeo, documento, imagem) segue com os marcadores de antes.
- **Observador** (a instância do PRUMO, a única que recebe `audio`): baixa o áudio da Evolution
  (`POST http://127.0.0.1:8081/chat/getBase64FromMediaMessage/prumo`, `apikey` lida a cada áudio do
  `~/workspace/evolution/.env`, 600, nunca em log), transcreve com o Gemini (`gemini-3.7-flash`, a chave
  `GEMINI_API_KEY` do ambiente ou do `~/.config/squadone/operations.env`, como o `raio-x-ia.py`; o mesmo pedido de
  `server/transcricao.ts`, com `SEM_FALA` quando não há fala) e grava `[áudio 27s] <transcrição>` na conversa e no
  lote do n8n. O áudio fica só em memória. **Teto: 20 por dia de São Paulo** (`transcricoes.json`, 600, na pasta do
  observador do PRUMO), **120 s, 5 MB, 25 s por pedido**. A cota só é gasta depois do download dar certo (Evolution fora
  do ar ou mídia vencida não consome o dia). Conta ilegível (JSON quebrado, `usadas` que não é número) recomeça a conta
  do dia e o journal diz `contador_ilegivel`; conta que não se consegue GRAVAR não gasta (`contador_sem_gravar`). Para
  zerar à mão: apague o `transcricoes.json`. Qualquer falha
  (sem chave, teto, tempo, HTTP, `SEM_FALA`, `longo`) grava só `[áudio 27s]` e o journal leva só o motivo
  (`áudio de 27******66 sem transcrição: teto_do_dia`), nunca o texto. `OBSERVADOR_TRANSCREVER=0` desliga (drop-in na
  unit). Variáveis opcionais: `OBSERVADOR_EVOLUTION_URL`, `OBSERVADOR_EVOLUTION_INSTANCIA`, `OBSERVADOR_EVOLUTION_ENV`.
  Este é o único pedido que um serviço nosso faz à Evolution (o adaptador segue sem chamá-la); ele não envia nada a
  ninguém.
- **Corrida das duas instâncias:** a do número pessoal grava o `[áudio]` da bridge do Hermes com o mesmo id; se ela
  chegar antes, a do PRUMO **troca** aquela linha pela transcrita (só quando a antiga é só o marcador; texto de gente
  nunca é trocado).
- **Um aviso por áudio** (revisão de 17/10/2026): as duas instâncias postam no n8n, e a da bridge mandava o `[áudio]`
  sem transcrição antes do lote transcrito: o aviso "ouça no WhatsApp" gastava um dos 2 avisos de 6 h. Agora a
  instância que NÃO tem `audio` no registro (a bridge) grava o marcador na conversa, mas não manda ao n8n um lote que
  seja SÓ marcador de áudio (journal: `lote só de áudio sem ouvinte`); com texto junto, manda como antes. Quem responde
  pelo áudio é a instância do PRUMO: o lote transcrito ou, se a transcrição não sair (falha, teto, `SEM_FALA`, longo),
  o marcador, uma vez, e o n8n registra `neutra` sem sobrescrever a classificação de gente. Evolution fora do ar: o
  áudio só-marcador não dá aviso nenhum (fica na conversa em disco e no "respondeu" pelo log).
- **Reinício no meio da transcrição** (revisão de 17/10/2026): o observador grava primeiro TODAS as linhas do
  `respostas.jsonl` na conversa (texto e marcador), só depois transcreve, e só apaga o `respostas.lendo.jsonl` com o
  lote montado. Um reinício relê o `.lendo`: a conversa não duplica (id) e a transcrição já gravada não é paga de novo.
  Ao parar o serviço com áudio por transcrever, a conversa recebe o marcador e o `.lendo` fica para o próximo início.
- **`papel`** (determinístico, no observador, a MESMA regra da Central em `src/operations/marcadores-da-conversa.ts`,
  com a mesma tabela de casos nos dois testes, `whatsapp-observador/papel-da-mensagem.casos.json`):
  `^\*\[[^\]\n]{1,80}\]\*` = `recepcao`; `^\[\s*(atendimento|bot)` como palavra inteira, sem caixa, até o `]` = `robo`
  (`[Botafogo]` e `[Botão]` não são robô); ausente = gente. Vai na linha da conversa e em cada mensagem do lote.
- **`contexto` no lote:** as últimas 3 mensagens do Rômulo (até a última do lote) e as últimas 3 do lead antes do lote,
  com o papel, lidas da conversa em disco (500 caracteres cada).
- **Classificador** (`claude-ops/whatsapp-conversa.py`, nó "Montar pergunta"): o prompt mostra o contexto em ordem e
  ganhou o tipo **`licenca`**, as recusas educadas ("agradeço, mas no momento não" = negativa; "qualquer coisa eu
  aviso", "vou passar para o responsável e retornamos" = neutra, nunca interesse), o áudio e as regras de desempate.
  Em "Decidir pela resposta", sem modelo (`TIPO_FINAL_JS`): lote só de áudio sem transcrição = `neutra` (aviso "ouça no
  WhatsApp") e não sobrescreve tipo de gente; lote só de ROBÔ não vira `interesse` nem `licenca`; a recepção, desde a
  revisão de 17/10/2026, fica com o modelo (é gente; rebaixá-la apagava interesse de verdade); `neutra` não apaga
  `negativa`/`exclusao`.
  Quem consome `licenca`: `funil-aprendizado.py` (resposta de gente), `site-funil-regra.js` (conta como sinal
  "licença" na pausa do 06, para separar o tipo não pausar nicho que antes ficava ligado), `jev-respostas-resumo.py`
  (revisão humana). O Jev em sombra segue com os 5 tipos; o `jev-respostas-resumo.py` compara a `licenca` do Gemini (e
  da revisão) como `interesse` (sem isso a promoção de 95 % ficava inalcançável, e uma licença que o Jev chamasse de
  negativa escaparia da regra 3), e o registro ganhou `tipo_final` (o tipo que o fluxo gravou, depois de só-áudio e
  só-robô) ao lado do `tipo_gemini` bruto. A coluna só é gravada quando a Data Table a tem: tabela criada antes de
  17/10 precisa da coluna `tipo_final` (string) acrescentada no editor do n8n; sem ela, o `whatsapp-conversa.py` avisa
  e publica o ramo sem gravá-la (o insert não quebra).

**Instalar na Mel** (depois do merge; o `~/SquadOne` se atualiza sozinho em até 10 min, ou `git -C ~/SquadOne pull`).
A ordem não importa: cada peça nova aceita a antiga do outro lado (campos a mais são ignorados).

```bash
# 1. testes no Dell (nada toca a Evolution, o Gemini nem o n8n de verdade)
python3 ~/SquadOne/deploy/dell/whatsapp-observador/observador.test.py
python3 ~/SquadOne/deploy/dell/whatsapp-observador/evolution-adaptador.test.py
cd ~/SquadOne/deploy/dell/claude-ops && python3 whatsapp-conversa.py --testar && python3 site-acompanhamento.py --testar-regra
# 2. as cópias (instalados.json) e as TRÊS units
install -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/observador.py ~/.local/bin/whatsapp-observador
install -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/evolution-adaptador.py ~/.local/bin/
install -m 755 ~/SquadOne/deploy/dell/funil-aprendizado.py ~/.local/bin/funil-aprendizado
install -m 644 ~/SquadOne/deploy/dell/claude-ops/whatsapp-conversa.py ~/SquadOne/deploy/dell/claude-ops/site-acompanhamento.py \
  ~/SquadOne/deploy/dell/claude-ops/site-funil-regra.js ~/SquadOne/deploy/dell/claude-ops/jev-respostas-resumo.py \
  ~/.local/share/claude-ops/
systemctl --user restart evolution-adaptador whatsapp-observador whatsapp-observador-prumo
# 3. republicar os fluxos no n8n (o prompt novo e o "licenca"; o 06 · Funil com o sinal "licença")
cd ~/.local/share/claude-ops && python3 whatsapp-conversa.py && python3 site-acompanhamento.py
# 4. conferir: a chave da Evolution e a do Gemini são legíveis pelo usuário do serviço (sem imprimir o valor)
grep -c '^EVOLUTION_APIKEY=' ~/workspace/evolution/.env; grep -c '^GEMINI_API_KEY=' ~/.config/squadone/operations.env
journalctl --user -u whatsapp-observador-prumo -f | grep -E "áudio|resposta classificada"
```

**Riscos aceitos:** o download e a transcrição rodam no laço do observador do PRUMO (até ~50 s por áudio no pior
caso, 20 por dia): o log espera, nada se perde (nem num reinício no meio: ver acima). A chave de mídia do áudio fica no `respostas.jsonl` (600) só até o
observador ler e apagar o arquivo. Se o áudio já expirou no servidor do WhatsApp, a Evolution pode pedir o reenvio
da mídia ao aparelho do lead (protocolo do WhatsApp, invisível na conversa); na prática o áudio é baixado segundos
depois de chegar. O áudio passa pelo Google (Gemini), como o texto das respostas já passa no n8n.

### Jev em sombra nas respostas (11/10/2026; código pronto, NADA aplicado no n8n)

O Rômulo autorizou medir o Jev (`typesafe/jev-1.13`, da TypeSafe, pela Decisions
API da OpenRouter) na classificação das respostas de lead, **em sombra e só com
máscara e recorte**. O Jev é medição: nunca decide, nunca muda a planilha, o
aviso nem a resposta ao observador. O PR deixa o ramo pronto em
`claude-ops/whatsapp-conversa.py`; **nada disso está no n8n** até o Rômulo criar
a credencial e a tabela e republicar o fluxo. É independente do "Jev em sombra"
das demandas (seção própria, no servidor): outra chave (dedicada ao n8n, com
limite de crédito próprio; nunca a do `jev.env`), outra máscara (em JS no nó
Code: o n8n não importa `server/openrouter-decisoes.ts`) e outro registro (Data
Table, não JSONL). Nunca no n8n do Easypanel (RULES 27).

**O ramo.** Sai de "Decidir pela resposta", em paralelo ao "Responder ao
observador", e fica embaixo no canvas: na execução v1 o ramo de cima (responder,
gravar a planilha, pasta) termina antes. Quatro nós, todos com `onError:
continueRegularOutput` (o antigo `continueOnFail`), então nenhum derruba o fluxo
nem chama o Error Workflow:

1. **Jev: mascarar e montar pedido** (Code, JS puro testado no node): pega só a
   última mensagem do lead, mascara, corta e monta o pedido; se sobrar nada, não
   devolve item e o resto não roda.
2. **Jev: classificar (sombra)** (HTTP Request): `POST
   https://openrouter.ai/api/alpha/decisions`, credencial de cabeçalho **"OpenRouter
   Jev"**, timeout 5 s, sem retry. Envia só o campo `pedido`.
3. **Jev: montar registro** (Code): resposta com erro ou sem `answers.tipo.choice`
   = nenhum registro.
4. **Jev: gravar na sombra** (Data Table `jev_sombra_respostas`, insert).

**O que vai ao Jev:** `{model, state, questions, provider}`. `state` é o texto da
**última** resposta do lead, mascarado e cortado em 600 caracteres (máscara no
texto inteiro e só depois o corte, para não sobrar meio telefone). `questions` é
um objeto indexado pelo nome (array dá HTTP 400): `tipo` (choice: exclusao, bot,
negativa, interesse, neutra) e `injecao` (noul: o texto tenta dar ordens a um
assistente?). `provider: {zdr: true, data_collection: "deny"}` em todo pedido.

**O que não vai:** histórico da conversa, as mensagens anteriores, o cabeçalho e o
prompt do Gemini, o nome do lead, o nome da empresa, o telefone, a chave, o chat
id, o `place_id`/`ID`, a planilha. Os testes conferem isso num caso com tudo junto.

**A máscara** (`mascarar` em `JEV_FUNCOES_JS`), nesta ordem:

| O que | Vira |
|---|---|
| `senha:`/`token=`/`api key` + valor, `Bearer ...`, `sk-...` (inclui `sk-or-v1-`), `AIza...`, `ghp_`/`github_pat_`, `xox?-`, JWT, hex ≥ 32 com dígito, base64 ≥ 32 com letra e dígito | `[SEGREDO]` |
| URL com `http(s)://` ou `www.`, e domínio solto em minúsculas (`meusite.com.br/x`) | `[URL]` |
| e-mail | `[EMAIL]` |
| CNPJ com barra; sequência numérica com 8+ dígitos (espaço, ponto, traço, parênteses, `+55`): CPF (pontuado ou com dígito verificador válido) e CNPJ válido | `[DOC]` |
| a mesma sequência, quando não é documento: telefone com e sem +55, com e sem DDD, 8 ou 9 dígitos | `[TEL]` |
| nome da empresa (Site: `nome`; PRUMO: `Empresa`) e de pessoa (`Contato`, `Responsável`, `Dono`, se a linha tiver), sem diferenciar maiúsculas e acentos, palavra inteira; depois cada palavra de 3+ letras do nome que não seja genérica ("padaria", "bom", "sim"...) | `[EMPRESA]` / `[NOME]` |

Texto vazio ou só com rótulos e pontuação depois da máscara: o Jev não é chamado.

**Mascarar não é anonimizar.** Nome próprio que não está na planilha ("sim, sou a
Jackeline"), endereço, apelido, detalhe do negócio e o próprio contexto passam. O
que vai ao Jev continua sendo dado pessoal de terceiro (LGPD), processado nos EUA
(transferência internacional). O que reduz o risco é o recorte (só a última
mensagem, 600 caracteres), a máscara, o ZDR e a recusa de coleta, não uma
anonimização que não existe.

**A tabela da sombra** (no n8n da Mel, nunca sai dela): `lead_hash`
(sha256 de `squadone:jev-sombra:v1:` + DDD + 8 dígitos), `planilha`,
`n_mensagens`, `resposta_em`, `tipo_gemini` (o mesmo que "Decidir" usou),
`jev_choice`, `jev_probabilities`, `jev_confidence`, `jev_injecao`, `jev_model`
(a versão datada que a API devolve), `input_tokens`, `output_tokens`, `cost`,
`latencia_ms`, `em` e `revisao_humana` (o Rômulo preenche). Nunca o telefone, o
`place_id` nem o texto. O sal é fixo e está no repositório e a chave tem 10
dígitos: o hash é pseudônimo (dá para refazer o vínculo testando números), por isso
a tabela não sai da Mel. O vínculo lead ↔ resultado se refaz só do lado do Rômulo,
com `jev-respostas-resumo.py --revisar` (casa hash e hora com o `crm.json` local) ou
`--hash <número>`.

**Risco aceito e o que falta antes de sair da sombra.** O endpoint do Jev está na
lista ZDR da OpenRouter e a TypeSafe diz que não treina com os prompts, mas não
publica prazo de retenção nem DPA. Antes de o Jev decidir qualquer coisa, pedir a
`privacy@typesafe.ai`: DPA, lista de subprocessadores, prazo de retenção e ZDR
Enterprise. Sem isso, fica em sombra mesmo que a regra abaixo passe.

**Regra de promoção** (`claude-ops/jev-respostas-resumo.py`, só lê): pelo menos 60
respostas revistas por humano (coluna `revisao_humana`), concordância do Jev com
a revisão ≥ 95 % e **nenhum** "interesse" (do Gemini, ou da revisão) que o Jev
tenha chamado de `negativa` ou `exclusao`. A concordância Jev × Gemini aparece só
para informação (o Gemini também erra), separada para conversas de uma mensagem:
o Gemini vê a conversa inteira e o Jev só a última mensagem, então conversa longa
discorda mais.

**Desligar:** desativar o nó "Jev: classificar (sombra)" no editor (nó
desativado no n8n repassa a entrada: o pedido chega ao "montar registro" sem
resposta e nada é chamado nem gravado; desative este nó, não o da máscara), ou
republicar sem o ramo (`python3
whatsapp-conversa.py --sem-jev`), ou apagar a credencial "OpenRouter Jev" e
republicar (sem ela o fluxo sai sem o ramo). Revogar a chave na OpenRouter corta
na hora: o HTTP falha e nada é registrado.

```bash
cd ~/.local/share/claude-ops
python3 whatsapp-conversa.py --testar       # inclui a classe Jev (máscara, pedido, registro, isolamento)
python3 jev-respostas-resumo.py --testar
python3 whatsapp-conversa.py --jev-tabela   # cria a Data Table (o Rômulo roda; nada roda sozinho)
python3 whatsapp-conversa.py --jev-exemplo  # item ANÔNIMO para fixar (pin) na saída de "Jev: mascarar e
                                            # montar pedido" e rodar só o ramo no editor (lead_hash "teste")
python3 jev-respostas-resumo.py                # resumo e veredito (GET na API do n8n)
python3 jev-respostas-resumo.py --revisar      # linhas sem revisão, com o trecho do crm.json
python3 jev-respostas-resumo.py --arquivo jev.csv   # se a chave da API não ler Data Tables: CSV baixado do editor
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
(sem esconder a coleta, que ainda roda).

**A pausa mora no compose (19/10/2026, DELL-18/HC-13).** O serviço `collector` ganhou `profiles: ["radar"]`, então `docker compose up -d` **não o sobe**;
o `depends_on` dele no n8n virou `required: false` (Compose 2.20 ou mais novo), e o n8n, que é o n8n geral da Mel (PRUMO, Site, CRM), sobe sem o radar.
O healthwatch usa `docker compose up -d --no-deps n8n`, por isso religar o n8n deixou de reviver o collector (antes sim, via `depends_on`).
Para religar o radar: `COMPOSE_PROFILES=radar docker compose up -d collector` (mais os passos reversos 1 a 3 acima). Na instalação, valide com
`docker compose config --quiet` e `up -d --no-deps n8n`. O `pncp-catchup.service` não repete mais para sempre: no máximo 4 inícios em 6 h
(`StartLimitIntervalSec=6h`, `StartLimitBurst=4`; antes o `Restart=on-failure` a cada 15 min martelava o PNCP o dia todo quando a fonte caía) e
`RuntimeMaxSec=20min` limita a execução (`TimeoutStartSec` não vale para `Type=simple`). O estado dos passos 3 a 5 da tabela não foi conferido na Mel
nesta revisão: confira antes de assumir "pendente".

Desde 29/09/2026 a coleta das 07:30 não qualifica item cujo prazo de proposta
encerra antes de coleta + 3 h: o resumo do Hermes chega às 08:00 e naquele dia
trouxe um pregão que encerrava às 07:59. Esses itens saem da lista (o Hermes
não mostra descartes) e ficam só em `counts.deadline_dropped` e
`deadline_dropped` do `latest-run.json` e numa linha de contagem no relatório.


### Luna nos workflows do Caçador (18/10/2026)

Autorizado pelo Rômulo após erros 503 do Gemini: `luna-workflows.service` executa o Luna
`gpt-6-luna-900k` do Hermes só para qualificação com pesquisa e resumo. O serviço aceita
apenas `/inferir`, tarefas fixas e o contrato de resposta existente; não aceita modelo,
ferramenta ou comando do cliente. Qualificação: `web,clarify`; resumo: `clarify`;
`--ignore-rules`, pasta vazia, ambiente limpo, sessão removida antes/depois, 140 s por
inferência e 200 tentativas/dia. O teto conta falhas. Não envia mensagem a lead.

A porta 8766 escuta só a ponte `172.23.0.1`; UFW aceita exclusivamente entrada pela
`br-ecef3b89e8bc`, origem `172.23.0.0/16`, destino `172.23.0.1:8766`. O hostname interno
`luna-workflows` é a exceção explícita de SSRF junto com `collector`; demais privados,
loopback e tailnet seguem bloqueados. Se recriar a rede Docker com outro endereço,
alinhe `N8N_LUNA_HOST_IP` no compose, `LUNA_BIND`/`LUNA_REDE_N8N` na unit e a regra UFW.

O token (600) fica em `~/.config/claude-ops/luna-workflows-token`; a credencial
`httpHeaderAuth` no n8n o guarda cifrado. Só o ID fica em `luna-workflows-cred` (600).
`n8n.py` aplica `workflow_luna.usar_luna` nas reconstruções do Caçador. Copie os módulos
pelo registro `instalados.json`, instale a unit, faça `systemctl --user daemon-reload`
e reinicie `luna-workflows`. Testes: `luna_workflows.test.py` e
`workflow_confiabilidade.test.py`. Backup anterior à troca em
`~/.local/share/claude-ops/backups/auditoria-20261018T201438Z/`.

O Caçador só atualiza `ultima_rodada` depois do subfluxo inteiro; erro de pesquisa,
resposta inválida ou falha de gravação conserva a busca para nova tentativa. Os
observadores HTTP também esperam a persistência. Links de envio só abrem o WhatsApp;
quem confirma envio é o observador ou um gesto explícito do operador. Ações do lead
por GET mostram confirmação; POST de outra origem ou com contexto antigo falha.
