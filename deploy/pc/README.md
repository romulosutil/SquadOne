# Máquina de controle

## Estado em 05/10/2026: o PC novo (Jarvis) controla a Mel

| | Quem é |
|---|---|
| **PC** | o **Jarvis**: Windows 11, nome na tailnet `paiduben` (100.124.120.127), usuário `sutil`, pastas em `C:\Users\sutil\dev`. Em uso desde 04/10/2026. Código, IA e visualização acontecem aqui. |
| **Mel** | o Dell (`romulo-sutil-corr-a-latitude-7420`, 100.68.136.88, Ubuntu), sempre ligado. Continua servindo tudo: Central, n8n, Hermes, Docker, esteira, backup. O nome técnico **não muda** (cerca de 75 links das planilhas dependem dele). |

De 28/09 a 04/10/2026 o próprio Dell foi a máquina de controle, porque o PC
antigo (aparelho `Rômulo` no Syncthing) queimou o NVMe; o Dell o viu pela
última vez em 25/09/2026 às 19:18. O que não tinha chegado ao Dell nem ao
GitHub foi perdido e **não se recupera**: não procure, não reconstrua, não cite
como pendência.

## Como o PC controla a Mel

Conferido da Mel em 05/10/2026 (o lado do PC só dá para ver pelo que ele manda:
logins SSH e o backup diário).

| O quê | Como, do PC | Estado |
|---|---|---|
| Terminal na Mel | `ssh mel` (chave `jarvis-pc-2` no `ssh-agent`; a Mel só aceita chave e só pela tailnet) | ok: dezenas de logins por chave desde 04/10 |
| Comando avulso | `ssh mel dell-status`, `ssh mel 'backup-dell status'`, `ssh mel 'hermes cron list'` | ok desde 05/10 (antes o shell não interativo da Mel não tinha `~/.local/bin` no PATH e esses comandos davam "command not found") |
| Claude Code rodando **na** Mel | app Claude do PC → **Code** → menu de ambiente → **+ Add SSH connection** → SSH Host `mel` | ver "Claude na Mel" abaixo |
| Central | `https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/` | ok |
| Entrada | o mesmo endereço + `/entrada/` (com a barra final) | ok |
| Hermes (painel) | `https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/` | ok |
| Webhooks do n8n | o mesmo endereço + `/webhook/...` | ok |
| Editor do n8n e code-server | só escutam em `127.0.0.1` na Mel: **túnel SSH** (`instalar-tuneis.ps1`), e aí `http://127.0.0.1:5679/` e `http://127.0.0.1:8080/` no navegador do PC | instalar no PC (abaixo) |
| Bancos dos projetos | direto pela tailnet em `100.68.136.88` (portas no `MANIFESTO.md`) | ok |
| Backup do PC | tarefa `Backup-Estrutura-PC` (logon e 03:30) → `mel:.local/share/mel/estrutura/pc-incoming/latest/` → Drive `Estrutura/pc/` | ok: chegou em 05/10 às 03:30 |
| Grafos do graphify | `scp -r mel:Mel/Grafos Dev\_grafos` (só leitura; nunca rodar o graphify no Windows) | disponível |

### Túneis (uma vez, no PC)

O editor do n8n só abre em `http://127.0.0.1:5679` (o login do Google do n8n
volta para esse endereço) e o code-server em `127.0.0.1:8080`. O túnel faz o
mesmo endereço funcionar no navegador do PC. De quebra, os links antigos da
planilha que ainda apontam para `http://127.0.0.1:5679/webhook/...` passam a
abrir no PC também.

```powershell
cd C:\Users\sutil\dev\Pessoal\SquadOne
git pull
powershell -ExecutionPolicy Bypass -File deploy\pc\instalar-tuneis.ps1
```

O instalador confere o `ssh-agent` e o `ssh mel` sem senha; tira a tarefa
antiga `DellWorker-LocalPortForwards` se existir; exige a porta 5679 livre no
PC (sem ela o editor do n8n não abre) e só avisa se 9120, 9119 ou 8080 estiverem
ocupadas; copia `mel-tuneis.ps1` para `%LOCALAPPDATA%\Mel\` (trocar de branch
no clone não muda o que roda) com um lançador `.vbs` que o abre **sem janela**
(com o Windows Terminal como padrão, `-WindowStyle Hidden` deixa uma janela que,
fechada, derrubaria os túneis); registra a tarefa `Mel-Tuneis` (no logon, só do
seu usuário, sem limite de tempo) e testa as portas por até 30 s cada. Não
precisa de administrador, salvo se o Windows negar a tarefa (aí, PowerShell de
administrador com o **mesmo** usuário). Logs: `%LOCALAPPDATA%\Mel\tuneis.log`
(quedas e portas puladas) e `ssh.log` (o erro do ssh).
Desfazer: `instalar-tuneis.ps1 -Desfazer`.

Porta ocupada por outro programa no PC (um servidor de desenvolvimento na 8080,
por exemplo) fica de fora só daquela rodada; os outros túneis sobem e ela volta
quando liberar. Só roda uma instância por vez: para testar à mão, pare a tarefa
antes (`Stop-ScheduledTask Mel-Tuneis`).

### Ligou o PC, conectou

Depois do instalador, nada a fazer a cada vez: ao entrar no Windows a tarefa
`Mel-Tuneis` sobe sem janela, espera a Mel aparecer na rede (olha a cada 3 s,
só TCP, sem login, enquanto a Tailscale sobe) e conecta na hora; se cair (rede,
sono, Mel reiniciando), religa sozinha. O instalador deixa pronto o que isso
exige:

- **ssh-agent automático:** se não estiver, ele pede o UAC uma vez e liga o
  início automático do serviço **OpenSSH Authentication Agent**.
- **Chave no agente:** se o agente estiver vazio e o terminal for interativo,
  roda `ssh-add` (pede a senha da chave **uma vez**; o agente do Windows a
  guarda entre reinícios). O túnel roda com `BatchMode=yes`: sem chave no
  agente ele falha em vez de pedir senha e tenta de novo com espera crescente
  (até 5 min), para não martelar a Mel.
- **Confere e avisa** (não mexe): serviço da Tailscale automático, Tailscale
  em **Run unattended** (conecta antes do login; sem isso os túneis esperam o
  login e a Tailscale subir) e a tarefa `Backup-Estrutura-PC`.

Fora do PC, uma vez, no painel da Tailscale (login.tailscale.com → Machines →
⋯ → **Disable key expiry**) para a Mel e para o PC: hoje as chaves vencem em
17/03/2027 (Mel) e 02/04/2027 (PC), e ao vencer o PC perde a Mel até alguém
relogar.

Antes, o script era `dell-worker-tunnels.ps1`, com o apelido `dell-worker` e a
tarefa `DellWorker-LocalPortForwards` do PC antigo. O PC novo usa o apelido
`mel` (`Host mel` no `~/.ssh/config`); `dell-worker` não existe nele.

### Claude na Mel

O app Claude do PC abre sessões do Claude Code que **rodam na Mel** por SSH
(documentação: <https://code.claude.com/docs/en/desktop.md>, "SSH sessions"):

1. No app, aba **Code**, menu de ambiente do campo de texto → **+ Add SSH
   connection**.
2. SSH Host: `mel` (o app resolve pelo `~/.ssh/config`). Identity File: vazio.
3. Pasta: `~` para operar a Mel (é onde está o `AGENTS.md` com as regras da
   Mel); para código, um worktree em `~/.cache/mel-work/`, nunca o `~/SquadOne`
   (é o checkout de produção da Central).

A Mel já tem o `claude` em `~/.local/bin` (e o app instala sozinho se faltar).
A documentação **não diz** como o app trata chave com senha no Windows: se a
conexão falhar pedindo a senha, confira se o `ssh-agent` está com a chave
(`ssh-add -l`) e teste `ssh -o BatchMode=yes mel hostname` no PowerShell.

As regras não mudam por a sessão vir do PC: instalar, mexer em systemd, Docker,
n8n, rclone ou tailnet continua sendo trabalho de uma sessão **na Mel**, com
`saude.sh` antes e depois, `.bak` e desfazer anotado; código por PR; merge só
com "pode mergear" explícito do Rômulo.

## Checklist do PC novo (estado em 05/10/2026)

1. **Acesso à Mel:** Tailscale e OpenSSH ok; `ssh mel` ok. Túneis: rodar
   `instalar-tuneis.ps1` (acima).
2. **Código:** o backup de 05/10 lista no PC `Corp\` (`ds_auditor`, `ds4fun`,
   `p4f`, `p4fhub` do GitHub e as 5 pastas do tarball do Corp) e `Pessoal\`
   (`crm-silmer`, `Iris`, `product_designer`, `prumo`, `Silmer`, `silmer-web`,
   `SquadOne`). Os outros repositórios (o laço da seção 1 do `PC-COMECAR.md`
   clona todos) e os `.env` dos tarballs (`aladdin`, `iris`, `espectro`,
   `agent-context`) ainda não foram trazidos. `~/Pessoal-dev` só sai da Mel
   depois disso.
3. **Drive:** o Google Drive para Desktop não aparece no `winget export` do PC;
   conferir se está instalado (os sites e a consultoria aparecem em
   `G:\Meu Drive\PRUMO\`, **só leitura**: o que se edita ali o espelho da Mel
   desfaz). Apagar `auto (até 25-09)` quando o Rômulo decidir.
4. **Syncthing (aposentado em 12/10/2026):** a Mel não tem nenhum aparelho
   pareado desde 04/10/2026 (o `Rômulo` antigo saiu) e as 3 pastas dela
   (`auto-site`, `Pessoal-dev`, `Corporativo-dev`) não sincronizavam com
   ninguém; o serviço foi desligado. A réplica `~/Pessoal-dev` está congelada
   e o código chega à Mel pelo GitHub. O PC tem o SyncTrayzor instalado, sem
   par: pode desinstalar. Pela regra "código por Git, material pelo Drive" não
   há o que parear; se um dia precisar editar sites no PC, use uma pasta à
   parte, com o PC começando **vazio** e recebendo (nunca "Override changes" do
   lado novo), e **nunca** sincronize `auto-site` (ressuscita leads na fila do
   gerador). Desligar: `ssh -t mel 'sudo systemctl disable --now
   syncthing@romulo-sutil-corr-a'`; reverter: `ssh -t mel 'sudo systemctl enable
   --now syncthing@romulo-sutil-corr-a'` (a config e as chaves em
   `~/.local/state/syncthing` ficam intactas).
5. **Monitor:** a verificação `syncthing` saiu do `dell-status` junto com o
   serviço (desligado, ela viraria `falha` sem motivo). Se o Syncthing voltar
   com um aparelho pareado, recoloque a verificação, incluindo "desconectado
   há mais de 24 h vira atenção".
6. **Documentação:** feita em 05/10 (`CLAUDE.md`, `ARCHITECTURE.md`,
   `deploy/dell/README.md`, `SOUL.md` e o mapa do Hermes, este arquivo e o
   `~/AGENTS.md` da Mel).
