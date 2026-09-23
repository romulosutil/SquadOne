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
