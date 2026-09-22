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

## Radar PNCP

Os arquivos não sensíveis do Compose do radar ficam em
`deploy/dell/licitacoes-automation/`. Para atualizar o diretório operacional,
copie esse conteúdo para `~/licitacoes-automation` sem remover `.env`, `data/`,
`backups/` ou `graphify-out/`, valide com `docker compose config --quiet` e
recrie apenas os serviços alterados. O workflow versionado usa gatilho manual
para testes no editor e agenda diária para produção; ambos recebem confirmação
rápida do collector, sem aguardar a resposta do PNCP.
