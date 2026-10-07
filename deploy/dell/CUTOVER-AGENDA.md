# Mudança da agenda para o Dell (cutover)

Passo 4 da transição do `ARCHITECTURE.md` ("App único no Dell"): a agenda
(roster, turno, Mochila, ajuste, lembretes, bot do Telegram) sai do Easypanel e
passa a morar no processo `operations` do Dell, em `127.0.0.1:9120`, com o motor
Gemini da chave paga. **Manual, com o Rômulo.** Cada passo diz como conferir e
como voltar. Os comandos rodam numa sessão **na Mel** (`ssh mel`), salvo onde
diz "no PC" ou "no Easypanel". Nenhum segredo vai para o chat, para log ou para
este arquivo: o Rômulo digita token, chave e URL do healthchecks direto no
`operations.env` (`nano`, permissão 600).

Ordem e motivo, em uma linha cada:

| Passo | O quê | Por que nesta ordem |
|---|---|---|
| 0 | preparar o Dell e mergear o PR | o código chega desligado: sem `SQUADONE_DATA_DIR` a agenda não liga |
| 1 | tirar `TELEGRAM_*` do Easypanel, congelar o roster | o Telegram recusa `getUpdates` enquanto houver webhook, e o boot do Easypanel o registra |
| 2 | copiar o `squad.json` de produção e ligar a agenda no Dell | o roster de produção é a verdade; o do Dell é arquivado, nunca mesclado |
| 3 | travar o Easypanel (`IPS_PERMITIDOS=127.0.0.1`) | a partir daqui só o Dell escreve; o Easypanel vira reserva fria implantável |
| 4 | `deleteWebhook` **sem** drop e ligar o polling | as mensagens pendentes passam a ser buscadas pelo Dell; a guarda de 10 min continua |
| 5 | vigia em sombra por 3 dias úteis | WhatsApp e ntfy juntos; tirar o ntfy antes deixaria a agenda sem lembrete |
| 6 | só com a sombra validada: o PR que remove o ntfy | `server/push.ts`, `/api/push/*`, `LEMBRETES_NTFY_URL` |

Os passos 1 a 4 vão numa sessão só (cerca de 1 h): entre o 1 e o 4 o bot não
responde, e o que o Rômulo mandar nesse meio espera no Telegram. Mensagem com
mais de 10 min quando o Dell a buscar recebe "⌛ Não processei … Reenvie se
ainda valer", nunca vira compromisso marcado tarde.

## Passo 0 — preparar (antes do merge)

O merge é inerte no Dell: sem `SQUADONE_DATA_DIR` no `operations.env` a agenda
fica desligada (`/api/runtime` diz `"agenda": false`) e a Central segue como
hoje. No Easypanel o perfil `app` continua igual (os lembretes do ntfy ganham
um emoji no título, nada mais). Antes de mergear:

1. **ACL do Tailscale** (login.tailscale.com → Access controls): a porta 8443 da
   Mel só para os aparelhos do Rômulo (regra 7). Confira que existe; se não,
   o Rômulo a edita lá (nenhum agente mexe na tailnet).
2. **Logins do Tailscale.** No `~/.config/squadone/operations.env`, acrescente
   `SQUADONE_LOGINS_TAILSCALE=<o login do Rômulo no Tailscale>` (o e-mail que
   aparece em Machines → usuário; vários por vírgula). Com a agenda ligada,
   lista vazia **fecha** a tailnet: todo pedido pelo Serve leva 403.
3. **Gemini pago.** `GEMINI_API_KEY=<chave do projeto com faturamento>` no
   mesmo arquivo. O Dell hoje não chama o Gemini; o boot avisa se faltar.
4. **healthchecks.io.** Crie um check `squadone-dell` (período 1 min,
   tolerância 5 min, integrações Telegram e e-mail) e ponha a URL de ping em
   `DEADMAN_URL=` (https, sem query). O sinal sai em todo processo
   `operations`, com ou sem a agenda, e vira `/fail` quando a sessão do
   WhatsApp fica fora de "aberta" por mais de 15 min (pelo `status.json` do
   dell-status; retrato velho conta como fora).
5. **Fila de avisos instalada** (`deploy/dell/README.md`, "Fila de avisos"):
   `ls -ld ~/.local/share/avisos/fila` mostra `drwxrws---`.
6. **Diretório da agenda**, fora do clone:

   ```bash
   install -d -m 700 ~/.local/share/squadone ~/.local/share/squadone/arquivo
   ```

Mergeie o PR. O `atualizar-central` reconstrói a Central em até 10 min; o
Easypanel implanta a `main` sozinho. Depois, instale o serviço com os novos
`ReadWritePaths` (o `-` deixa subir antes de o diretório existir):

```bash
cp ~/SquadOne/deploy/dell/squadone-operations.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart squadone-operations
```

**Confere:** `journalctl --user -u squadone-operations -n 30` mostra
`Agenda desligada neste processo: SQUADONE_DATA_DIR ausente…`,
`[acesso] identidade do Tailscale conferida (1 login(s))` e
`Sinal de vida: healthchecks a cada minuto`; o healthchecks.io fica verde.
`curl -s 127.0.0.1:9120/api/runtime` → `"agenda":false`. **No celular, a
Central continua abrindo** pela tailnet: com a lista preenchida a trava de
identidade já vale, e um login escrito errado dá 403 (journal:
`identidade do Serve recusada`). O CRM continua registrando nota (a escrita
agora exige a mesma origem, e o navegador a manda).

**Volta:** reverter o merge na `main` (PR de revert). Nada foi gravado. Se só o
login estiver errado, corrija `SQUADONE_LOGINS_TAILSCALE` e reinicie.

## Passo 1 — Telegram fora do Easypanel, roster congelado

No Easypanel (projeto `aladdin` → `squadone-app` → Ambiente):

- apague `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` e `TELEGRAM_CHAT_IDS`
  (guarde os valores no cofre antes, se ainda não estão lá);
- acrescente `SQUADONE_ROSTER_CONGELADO=true`;
- **Implantar**.

Sem o token, o boot do Easypanel não chama mais `setWebhook` (é o que
derrubaria o polling do Dell a cada implantação, regra 25), a rota do webhook
deixa de existir e o Telegram passa a guardar as mensagens. Com o
congelamento, contratar, editar ou arquivar no Easypanel responde 409: o roster
não muda mais lá, e é ele que vai para o Dell.

**Confere:** no log da implantação, `Bot do Telegram desligado` e `Roster
CONGELADO`. No app do Easypanel, "Contratar" responde que o roster está
congelado. De fora, sem segredo: `POST /api/telegram/webhook` responde 401
enquanto o bot existe (o portão recusa o segredo) e 403 quando ele saiu (a
rota não é montada e o porteiro responde).

**Apagar variável exige build, não só Implantar** (visto no cutover de
07/10/2026). Acrescentar uma variável e clicar **Implantar** vale na hora; apagar,
não: a implantação levou 2 s (reiniciou a imagem que já existia) e o bot seguiu
respondendo 401 sem nenhuma `TELEGRAM_*` no Ambiente. A explicação é o `.env`
que o build grava na imagem com o Ambiente da hora: o `dotenv.config()` do
servidor o carrega e completa o que falta no ambiente, então a variável apagada
volta por ele. Só um build novo (um push na `main`) a tira de vez. O mesmo vale
para `LEMBRETES_NTFY_URL` no passo 6 e para qualquer volta que apague variável.

**Volta:** devolver as três `TELEGRAM_*`, tirar `SQUADONE_ROSTER_CONGELADO` e
**Implantar**: o boot registra o webhook de novo, e o que ficou pendente chega
ao Easypanel (com a guarda de 10 min).

## Passo 2 — o roster de produção vira a agenda do Dell

1. Congele também o Dell: `SQUADONE_ROSTER_CONGELADO=true` no
   `operations.env` (a agenda ainda não liga, mas o próximo reinício já a
   liga congelada).
2. Copie o `squad.json` de produção com o procedimento de
   `deploy/dell/README.md`, "Cópia do roster do Easypanel" (base64 + sha256),
   para `~/Mel/Easypanel/squad-$(date +%F).json`. **O sha256 tem de bater com o
   do console.**
3. Compare, só lendo (nada é gravado nem mesclado):

   ```bash
   cd ~/SquadOne && npx tsx scripts/conferir-roster.ts ~/Mel/Easypanel/squad-$(date +%F).json ~/SquadOne/data/squad.json
   ```

   Tem de dizer `✔ v3 válido`. A parte "Só no retrato do Dell" é o que fica de
   fora, de propósito: o retrato de 14/09/2026 é arquivado, nunca mesclado. Se
   aparecer algo ali que o Rômulo quer, ele recontrata depois, no Dell, pela UI.
4. Arquive o retrato do Dell e instale o de produção e a credencial do Google
   do Dell no diretório novo (cópias; os originais ficam onde estão):

   ```bash
   cp -p ~/SquadOne/data/squad.json ~/.local/share/squadone/arquivo/squad-dell-2026-09-14.json
   install -m 600 ~/Mel/Easypanel/squad-$(date +%F).json ~/.local/share/squadone/squad.json
   install -m 600 ~/SquadOne/data/google-auth.json ~/.local/share/squadone/google-auth.json
   chmod 400 ~/.local/share/squadone/arquivo/squad-dell-2026-09-14.json
   ```

   A credencial do Dell é cifrada com o `TOKEN_ENC_KEY` do `~/SquadOne/.env`, o
   mesmo que o serviço lê; a do Easypanel **não** vem (é cifrada com outra
   chave e é da outra instalação).
5. Ligue a agenda: `SQUADONE_DATA_DIR=/home/<usuário>/.local/share/squadone`
   no `operations.env` (caminho absoluto: o systemd não expande `~`), e
   reinicie:

   ```bash
   systemctl --user restart squadone-operations
   ```
6. Backup: `install -m 600 ~/SquadOne/deploy/dell/backup/fontes.toml ~/.config/backup-dell/fontes.toml`
   (agora com `~/.local/share/squadone/*` nos obrigatórios).

**Confere:**

- `curl -s 127.0.0.1:9120/api/runtime` → `"agenda":true`;
- `curl -s 127.0.0.1:9120/api/auth/status` → `"conectado":true`. Com
  `"tasks":false`, autorize o Google Tasks **pelo PC**, com o túnel
  `Mel-Tuneis` ligado: abra `http://127.0.0.1:9120/api/auth/google` no navegador
  do PC (o consentimento pede Calendar e Tasks juntos; nunca "Sair", que revoga
  o Calendar). Pela tailnet a rota responde 409 de propósito: o callback volta
  só pelo loopback, nunca por `ts.net`;
- no celular, `https://<Mel>.ts.net:8443/squadone` abre os agentes **no Dell**
  com as squads de produção; um pedido de outro aparelho/usuário da tailnet
  leva 403;
- o journal mostra `Agenda ligada; lembretes pela fila de avisos` e
  `[acesso] identidade do Tailscale conferida (1 login(s))`.

A vigia do Dell já publica na fila daqui em diante (lembretes chegam pelo
WhatsApp e pelo ntfy do Easypanel: a sombra do passo 5 conta a partir do
passo 4, mas não faz mal começar antes).

**Volta:** tirar `SQUADONE_DATA_DIR` do `operations.env` e reiniciar. A agenda
desliga, a Central volta a ser só a Central, e o Easypanel continua sendo a
agenda (ainda aberto). Os arquivos copiados ficam, sem uso.

## Passo 3 — travar o Easypanel (reserva fria)

No Easypanel: `IPS_PERMITIDOS=127.0.0.1` (guarde o valor anterior) e
**Implantar**. O app continua implantável e rodando (é a volta ensaiada se o
Dell morrer, regra 25), mas ninguém de fora o alcança. `LEMBRETES_NTFY_URL`
**fica** até o passo 6: a vigia de lá ainda manda o ntfy na sombra.
`SQUADONE_ROSTER_CONGELADO=true` também fica, para sempre: uma escrita na
reserva divergiria do Dell.

**Confere:** abrir o endereço do Easypanel dá 403. A verificação
`squadone-app` do dell-status continua verde (403 é resposta). O
`/squadone` da Central abre o app do Dell, e os links "Agentes do SquadOne"
também.

**Volta:** devolver o `IPS_PERMITIDOS` anterior e **Implantar**.

## Passo 4 — o bot passa a ser buscado pelo Dell

1. **No PC**, no navegador (nunca colando o token em outro lugar):
   `https://api.telegram.org/bot<TOKEN>/deleteWebhook` — **sem**
   `drop_pending_updates`. As mensagens pendentes não se perdem: o Dell as
   busca no passo seguinte.
   Confira em `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`: `"url":""`
   (o `pending_update_count` diz quantas esperam).
2. No `operations.env`: `TELEGRAM_BOT_TOKEN=<o mesmo token>`,
   `TELEGRAM_TRANSPORTE=polling`, `TELEGRAM_CHAT_IDS=<o chat do Rômulo>`. **Não**
   ponha `TELEGRAM_WEBHOOK_SECRET`: no polling ele não existe, e a trava vira o
   token, que só existe no Dell. Reinicie.
3. O journal mostra `Bot do Telegram: polling (getUpdates), 1 chat(s)`.
   Pendentes com mais de 10 min recebem "⌛"; os recentes rodam.
4. Mande `/ajuda` e depois uma demanda de teste ("lembrar de testar o bot
   amanhã"). A resposta vem no Telegram; o compromisso aparece no Google.
5. **Descongele o Dell:** tire `SQUADONE_ROSTER_CONGELADO` do `operations.env`
   e reinicie (o `atualizar-central` não é preciso; o reinício espera o turno
   em curso se você esperar `"ocupado":false` em `/api/runtime`). Contratar
   volta a funcionar, só no Dell.

**Confere:** `ls -l ~/.local/share/squadone/telegram-offset.json` (600) existe
e muda a cada mensagem; o journal não repete `[telegram] polling: getUpdates
recusado (409)`. Esse 409 quer dizer webhook ainda registrado (refaça o 1) ou
outro processo buscando com o mesmo token.

**Volta:** tirar as três `TELEGRAM_*` do `operations.env` e reiniciar (o Dell
para de buscar; o offset fica). Se o Dell já foi descongelado e algo mudou no
roster, copie o `~/.local/share/squadone/squad.json` do Dell para o
`/app/data/squad.json` do Easypanel (o caminho inverso do passo 2) antes de
descongelar lá. Depois, no Easypanel: devolver as `TELEGRAM_*` e o
`IPS_PERMITIDOS`, tirar o congelamento, **Implantar** (o boot registra o webhook
de novo, sem drop).

## Passo 5 — sombra por 3 dias úteis

WhatsApp (Dell) e ntfy (Easypanel) avisam juntos. A cada lembrete, o Rômulo
confere que os dois chegaram, no mesmo minuto, com o mesmo compromisso. Para
olhar sem esperar o horário:

```bash
journalctl --user -u squadone-operations --since today | grep -E '\[vigia\]|\[avisos\]'
dell-status --stdout | grep -A3 -i 'fila de avisos'          # recusados: tem de ser zero
curl -s -X POST 127.0.0.1:9120/api/avisos/varrer \
  -H 'Origin: http://127.0.0.1:9120' -H 'Content-Type: application/json' \
  -d '{"agora":"2026-10-08T09:50:00-03:00"}'                # simulação: diz o que sairia, não grava nada
```

`/api/avisos/varrer` é uma varredura real contra o Google com relógio simulado
que **não envia**: o único caminho para a fila é a própria vigia. O `Origin`
no curl é a trava de escrita da mesma origem (regra 7).

Validado quando, em 3 dias úteis seguidos: todo lembrete do ntfy também chegou
pelo WhatsApp, nenhum aviso foi recusado pela fila, e o healthchecks.io ficou
verde (ou mandou `/fail` só quando o WhatsApp caiu de fato). **Quem valida é o
Rômulo.**

**Volta:** nada a desfazer. Se o WhatsApp falhar, o ntfy ainda está lá; o
problema vai para o dell-status ("Sessão do WhatsApp", "Fila de avisos").

## Passo 6 — o ntfy sai (PR separado, só depois da sombra)

O PR "remover o ntfy" (empilhado sobre este) apaga `server/push.ts`,
`server/push.test.ts`, as rotas `/api/push/*` e `LEMBRETES_NTFY_URL`, e as
menções no `CLAUDE.md`, `.env.example`, `src/operations/fluxos.ts` e no mapa
do Hermes. Depois do merge:

1. no Easypanel, apagar `LEMBRETES_NTFY_URL` e **Implantar** (sem ela, e sem o
   código, o Easypanel não roda vigia: regra 25);
2. apagar o serviço `ntfy` do projeto `aladdin` no Easypanel;
3. desinstalar o app ntfy do celular.

**Volta:** reverter o PR e devolver `LEMBRETES_NTFY_URL` (o serviço ntfy, se já
apagado, tem de ser recriado com o mesmo tópico e token).

## Religar a reserva (o Dell morreu)

Com o Dell fora, no Easypanel: restaurar o `squad.json` mais recente do cofre
(`deploy/dell/backup/RESTAURAR.md`, `~/.local/share/squadone/squad.json`) para
`/app/data/squad.json`, tirar `SQUADONE_ROSTER_CONGELADO`, devolver o
`IPS_PERMITIDOS` de casa e as `TELEGRAM_*` (com `TELEGRAM_WEBHOOK_SECRET`,
transporte webhook) e **Implantar**. O boot registra o webhook; quando o Dell
voltar, refaça os passos 1 a 4 nessa ordem.
