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
vira aviso na fila do `dell-status`, que chega pelo WhatsApp.

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
`~/.local/share/avisos/fila/*.json` (`{"texto", "titulo"?}`), a fila que os
containers usam para avisar sem abrir rede nem firewall.

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

```bash
python3 deploy/dell/dell-status.test.py   # cron, rotinas, gerador, fluxos, filas, backup e "o que fazer", sem tocar no Dell
install -m 755 deploy/dell/dell-status.py ~/.local/bin/dell-status
mkdir -p ~/.local/share/avisos/fila && chmod 777 ~/.local/share/avisos/fila
cp deploy/dell/dell-status.service deploy/dell/dell-status.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now dell-status.timer
dell-status --stdout   # confere sem gravar nem avisar
```

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
  leads, sites, enviados, responderam, em conversa, recusados e concluídos, e
  as buscas ativas com 5+ enviados e nenhuma resposta como candidatas a
  desativar (a aba Buscas não muda sozinha). Aviso pelo Hermes e
  `n8n-estado/site-funil.json`, sem `itens` (não vira pendência).
- `python3 site-acompanhamento.py --testar` roda cópias dos dois sem gravar.

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
`acoes_link` de quem tem site. O resumo das 10:30
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
  convite", conversa no WhatsApp, site);
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
  enviado"; com "Convite enviado" → Próxima ação "Respondeu no WhatsApp em
  ..."; Site `novo`/`pronto` → `enviado` (+ `enviado_em`); resposta a 5 min ou
  mais do envio → `respondeu_em` (`expirado` volta a `enviado`), e a pasta vai
  para `_em-conversa/` (ver "Pasta auto").

Por que 5 min: em 28/09/2026 dez leads "responderam" segundos depois de cada
envio, na ordem em que o Rômulo mandava. É a saudação automática do WhatsApp
Business. Então a primeira mensagem só prova o envio, e o observador manda um
segundo aviso (`"seguinte": true`) quando o lead volta a escrever 5 min ou mais
depois; o PRUMO ignora esse segundo aviso. Resposta única dentro dos 5 min
passa despercebida: o follow-up do 3º dia lembra, e `respondeu_em` pode ser
preenchido à mão.

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
