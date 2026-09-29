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
- `~/.local/share/squadone-operations/auto-production.json`.

Em `operations.json`, ajuste `autoDirectory` para o caminho absoluto da pasta
sincronizada `auto` no Dell e `autoNotificationStateFile` para
`~/.hermes/leads-notificados.json` usando o caminho absoluto. A Central somente
lê esses artefatos; os marcos manuais ficam no diretório de dados acima.

O arquivo de ambiente deve definir pelo menos:

```dotenv
NODE_ENV=production
PORT=9120
SQUADONE_MODE=operations
IPS_PERMITIDOS=127.0.0.1,::1
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

O login do Windows acessa a Central por túnel SSH local em
`http://127.0.0.1:9120/`; nenhuma porta pública é necessária. Sem PC desde
28/09/2026 (ver `deploy/pc/README.md`), as mesmas URLs abrem direto no
navegador do próprio Dell, sem túnel; o que segue vale para o PC novo.

O mesmo túnel pode expor somente em loopback as superfícies operacionais:

```bash
ssh -N \
  -L 9120:127.0.0.1:9120 \
  -L 9119:127.0.0.1:9119 \
  -L 5679:127.0.0.1:5679 \
  -L 8080:127.0.0.1:8080 \
  dell-worker
```

No Windows, o alias `dell-worker` deve apontar para o nome MagicDNS do
Tailscale. A tarefa agendada `DellWorker-LocalPortForwards` inicia no logon,
mantém o SSH vivo e recria os túneis depois de uma falha. As portas locais são:

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

```bash
python3 deploy/dell/dell-status.test.py   # cron, rotinas e gerador, sem tocar no Dell
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
o `place_id` do `publicado.json` e nunca sobrescreve. `_recusados/` continua à
mão. `site-pastas --listar` mostra o que faria.

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
`prumo-simples.py` e `prumo-ajuste-planilha.py` ainda têm a base antiga em
`CONVITE_URL`: rodá-los sem trocar volta os convites novos para loopback.

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

Instalação (uma vez, pelo Rômulo: o Claude roda autônomo, sem pedir
permissão, então a decisão de ligá-lo é dele):

```bash
claude            # login da conta Claude (uma vez) — /login dentro dele
vercel login      # conta da Vercel com o escopo romulodesigns
install -m 755 ~/SquadOne/deploy/dell/gerador-de-sites.py ~/.local/bin/gerador-de-sites
cp ~/SquadOne/deploy/dell/gerador-de-sites.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now gerador-de-sites.timer
```

## Observador do WhatsApp (`whatsapp-observador/`)

O Rômulo aborda os leads direto no WhatsApp, sem os links rastreados. O Hermes
já está vinculado ao número dele, e a bridge registra em
`~/.hermes/whatsapp/bridge.log` uma linha `self_chat_mode_rejects_non_self`
(chat e remetente, **sem conteúdo**) para toda mensagem recebida. O
`observador.py` acompanha esse log (tail -F; na primeira vez começa do fim,
depois continua de onde parou, guardado em `~/.local/state/whatsapp-observador`)
e, quando quem escreveu é um número das planilhas, avisa o n8n
(`claude-ops/whatsapp-conversa.py`). Só começa a ler depois de receber a lista
de números: em 29/09/2026 um boot com o n8n ainda subindo perdeu três respostas.

- PRUMO: resposta com Etapa "Revisar" → "Convite enviado"; com "Convite
  enviado" → Próxima ação "Respondeu no WhatsApp em ...";
- Site antes da venda: resposta com status `novo` ou `pronto` → `enviado`
  (+ `enviado_em`); resposta a 5 min ou mais do envio → `respondeu_em`
  (`expirado` volta a `enviado`), e a pasta vai para `_em-conversa/` (ver
  "Pasta auto").

Por que 5 min: em 28/09/2026 dez leads "responderam" segundos depois de cada
envio, na ordem em que o Rômulo mandava. É a saudação automática do WhatsApp
Business. Então a primeira mensagem só prova o envio, e o observador manda um
segundo aviso (`"seguinte": true`) quando o lead volta a escrever 5 min ou mais
depois; o PRUMO ignora esse segundo aviso. Resposta única dentro dos 5 min
passa despercebida: o follow-up do 3º dia lembra, e `respondeu_em` pode ser
preenchido à mão.

Por que o log e não um segundo aparelho: o pareamento por código falhou (no
DDD 27 o WhatsApp registra o número sem o 9) e a bridge muda a cada
`hermes update`; ler um log que ela já escreve não depende de nenhum dos dois.
**Limite:** mensagem ENVIADA pelo Rômulo não aparece no log com o número, então
o que marca é a resposta do lead (que prova o contato); o envio continua
marcado pelos links rastreados. LID vira telefone pelo mapa da sessão do
Hermes (`lid-mapping-*_reverse.json`, só leitura). Até dois avisos por número
a cada 6 h; log parado 6 h avisa pelo Hermes. Webhooks com header `X-Observador`
(segredo em `~/.config/claude-ops/whatsapp-observador-segredo`).

```bash
install -m 755 ~/SquadOne/deploy/dell/whatsapp-observador/observador.py ~/.local/bin/whatsapp-observador
cp ~/SquadOne/deploy/dell/whatsapp-observador/whatsapp-observador.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now whatsapp-observador
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
