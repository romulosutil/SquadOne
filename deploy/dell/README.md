# Central de Operações no Dell

O serviço usa o build do checkout em `~/Pessoal-dev/SquadOne` e escuta apenas
em `127.0.0.1:9120`.

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
`http://127.0.0.1:9120/`; nenhuma porta pública é necessária.

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

```bash
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
`~/auto-site/<caminho>`. O Syncthing leva `~/auto-site` para `G:\Meu Drive\auto`.

```bash
install -m 755 deploy/dell/auto-entrada.py ~/.local/bin/auto-entrada
mkdir -p ~/.local/share/auto-entrada && chmod 777 ~/.local/share/auto-entrada
cp deploy/dell/auto-entrada.path deploy/dell/auto-entrada.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now auto-entrada.path
```

## Scripts de operação do n8n (`claude-ops/`)

Copiados para `~/.local/share/claude-ops` no Dell. `n8n.py` é o cliente da
API (chave de operações em `~/.config/claude-ops/n8n-api-key`);
`aviso-de-falha.py` liga o Error Workflow em todos os fluxos;
`prumo-ajustes.py` e `site-antes-da-venda.py` aplicam as mudanças de
23/09/2026; `rodar-agora.py <id>` executa um workflow agora.

## Links rastreados e pendências (`claude-ops/fecha-ciclos.py`)

`wa_link` (Site antes da venda) e "Enviar convite" (PRUMO) apontam para
`http://127.0.0.1:5679/webhook/enviar` e `/webhook/convite`: o clique marca o
envio e redireciona ao canal. Balcão e Lead Scout gravam contagens em
`~/.local/share/n8n-estado/*.json`, que o `dell-status` mostra em "Esperando
você" na Central. `claude-ops/prumo-rodizio.py` põe o Lead Scout em rodízio de
buscas.

## Gerador de sites (`gerador-de-sites.*`)

Desde 23/09/2026 a fila do "Site antes da venda" é gerada no Dell, não no PC:
a tarefa `EsteiraLeads08h` do PC só rodava com ele ligado às 08h e não gerava
nada desde 17/09 (ficou **desativada**; `Enable-ScheduledTask EsteiraLeads08h`
a volta). O runner é o porte do `executar-fila-leads.ps1`, na mesma pasta
(`~/auto-site`, sincronizada com o Drive pelo Syncthing): até 4 leads por dia,
45 min por lead, timer persistente (Dell desligado às 08h roda quando voltar).
Lead com 2 falhas em `falha.log` sai da fila; apagar o arquivo o devolve.
`python3 ~/.local/bin/gerador-de-sites --listar` mostra a fila sem gerar nada.

Instalação (uma vez, pelo Rômulo: o Claude roda autônomo, sem pedir
permissão, então a decisão de ligá-lo é dele):

```bash
claude            # login da conta Claude (uma vez) — /login dentro dele
vercel login      # conta da Vercel com o escopo romulodesigns
install -m 755 ~/Pessoal-dev/SquadOne/deploy/dell/gerador-de-sites.py ~/.local/bin/gerador-de-sites
cp ~/Pessoal-dev/SquadOne/deploy/dell/gerador-de-sites.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now gerador-de-sites.timer
```

## Observador do WhatsApp (`whatsapp-observador/`)

O Rômulo aborda os leads direto no WhatsApp, sem os links rastreados. O
observador é mais um dispositivo vinculado no número dele (independente do
Hermes) e, para cada mensagem numa conversa 1:1 com um número que está nas
planilhas, avisa o n8n (`claude-ops/whatsapp-conversa.py`):

- PRUMO: mensagem dele com Etapa "Revisar" → "Convite enviado"; resposta do
  lead com Etapa "Convite enviado" → Próxima ação "Respondeu no WhatsApp ...";
- Site antes da venda: mensagem dele com status `pronto` → `enviado`.

Só número (DDD + 8 últimos dígitos), direção e hora saem do processo: o
conteúdo nunca é gravado, logado nem enviado, e conversa com quem não é lead
não sai dele. Grupos, status e canais são ignorados; mensagem com mais de 15
min (sincronização) também. Um aviso por número e direção a cada 6 h. Webhooks
com header `X-Observador` (segredo em `~/.config/claude-ops/whatsapp-observador-segredo`).

Instalação em `~/.local/share/whatsapp-observador` (`npm install`), pareamento
por código (sem QR) e serviço:

```bash
cd ~/.local/share/whatsapp-observador && node observador.mjs --parear 55DDDNUMERO
cp whatsapp-observador.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now whatsapp-observador
```

Desconectado pelo celular: sai com código 3 (o systemd não insiste) e avisa
pelo Hermes; é parear de novo.
