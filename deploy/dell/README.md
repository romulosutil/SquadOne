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
systemctl --user daemon-reload
systemctl --user enable --now squadone-operations.service
```

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

O playbook do Hermes é versionado em
`deploy/hermes/skills/dell-operations-manager/SKILL.md`. Instale-o no Dell em
`~/.hermes/skills/dell-operations-manager/SKILL.md`. A pasta sincronizada
`~/Pessoal-dev` é contexto de leitura e troca de arquivos; use um clone Git
próprio para qualquer operação de branch, commit ou push.
