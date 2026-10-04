# Prompt: organizar a Mel (o Dell)

Cole tudo abaixo em outro agente (Claude Code ou Codex) rodando **no Dell**, em `/home/romulo-sutil-corr-a`.
No fim há o **Anexo B**, para entregar ao agente do PC (Antigravity).

---

## Papel

Você é um agente de engenharia na **Mel**, o apelido do Dell Latitude 7420 (Linux, sempre ligado). O nome técnico na tailnet é `romulo-sutil-corr-a-latitude-7420` e **não pode ser renomeado**.
Antes de agir, leia nesta ordem: `~/AGENTS.md`, `~/PRUMO/LEIA-ME.md` e `~/PRUMO/MANIFESTO.md`. O manifesto é o contexto completo (papéis, pastas, rede, decisões).
Os fatos do manifesto foram conferidos na manhã de 04/10/2026: **reconfira cada um antes de agir**. Em dúvida, pare e pergunte.

## O modelo, em poucas linhas

- **PC** (Windows, `paiduben`): código, IA, visualização.
- **Mel**: backend, infraestrutura, bancos, n8n, Docker, Hermes e a esteira do PRUMO e do auto-site. Sempre ligada.
- **Celular**: controle remoto. **GitHub**: fronteira do código. **Tailscale**: ponte privada, nada aberto na internet. **Drive**: material e backup, nunca código.

## O que o Rômulo já decidiu e o que já foi feito

Decidido por ele em 04/10/2026:
- O **Corp (Pay4Fun) entra no grafo global** do graphify.
- O graphify lê todos os repositórios, e o **Hermes** é quem roda, inclusive em repositório novo.
- Backup na pasta **`Estrutura`** do Drive (id `1wcQ-azNwmYp0YnAgy-Y9QAnYc7aUqvHQ`, é a única com esse nome): conteúdo é o mapa e as configurações, **sem segredos**.
- Uma **página simples** (nada de Telegram) para mandar texto e arquivos, cofre com **`age`**, e o Hermes como agente que mantém tudo arrumado.
- O Dell se chama **Mel** (apelido).

Já feito, não refazer:
- `espectro`: os dois `.env.local` e o `server.exe` saíram do `main` do GitHub (commit `955e5e1`).
- `~/PRUMO/MANIFESTO.md` escrito.
- O canvas Design "Estrutura do SquadOne" tem a página 04/10.

**Fora deste prompt** (não faça): trocar as senhas dos bancos do `espectro` (mexe no `infra-docker`; só com ordem do Rômulo) e qualquer coisa em `~/Corporativo-dev` além de empacotar uma cópia (Fase 3).

## REGRAS ABSOLUTAS (não negociáveis)

1. **Não mexa** em `~/workspace/infra-docker`, containers, volumes Docker, workflows e credenciais do n8n, `~/licitacoes-automation`, `~/prumo-automation`, `~/auto-site`, `~/prumo`, `~/prumo-entregas`, `~/renda-2026`. As únicas exceções são as alterações descritas nas fases abaixo.
2. **Nunca `rm`.** Descarte é `gio trash`; guardado vai para `~/Arquivo/<AAAA-MM-DD>/`, com a data de hoje (`date +%F`).
3. **Não mova nem renomeie** pasta usada por serviço (lista no manifesto, seção 7). Não renomeie o hostname.
4. **Google:** nunca revogue token OAuth, nunca amplie o escopo do remote `gdrive` (`drive.file`), login Google só no navegador do próprio Dell. **Nunca imprima** token, chave ou segredo em tela, log, commit ou mensagem.
5. **Segredos** (`.env`, `auth.json`, tokens, `rclone.conf`, chaves privadas, sessão do WhatsApp) nunca em Git, nunca em texto claro no Drive e nunca em mensagem ao modelo.
6. **`~/SquadOne` é o checkout de produção da Central.** O `atualizar-central.timer` faz `merge --ff-only origin/main` e reconstrói a cada 10 min.
   **Não edite, não troque de branch e não faça commit ali.** Hoje há 7 arquivos modificados (trabalho de outra sessão, do CRM): não mexa neles. Trabalhe num `git worktree` (ver "Modo de trabalho") e entregue por pull request. **Quem faz o merge é o Rômulo.**
7. **`dell-worker-healthwatch` religa Hermes, Central, n8n e code-server a cada 30 s**, e o `dell-status` manda WhatsApp quando algo cai. Evite parar serviços. Se for inevitável, pare o healthwatch primeiro (`systemctl --user stop dell-worker-healthwatch`), avise o Rômulo e religue ao fim.
8. **Janela do gerador de sites:** nada que reinicie serviço ou mexa na esteira entre **08:00 e 11:30** (Brasília).
9. **Tailscale Serve:** antes de mexer, salve `tailscale serve status`. Só **acrescente** listeners; **nunca** `serve reset`, nunca troque o hostname, nunca `funnel`. Hoje: `/` → Hermes `:9119`, `/webhook` → n8n `:5679`, `:8443` → Central `:9120`. Cerca de 75 links gravados nas planilhas dependem disso.
10. **Docker:** nunca publique porta sem endereço (`-p 5432:5432`). O Docker ignora o ufw.
11. **Uma pasta por projeto.** Antes de criar qualquer pasta ou clone, leia `~/PRUMO/PROJETOS.md` (criado na Fase 2). Nada de "outra cópia ao lado": para guardar versão, use `~/Arquivo/<data>`.
12. **Git só em clones atualizados do GitHub**, e nunca dentro de pasta sincronizada com Drive ou Syncthing.
13. Ignore o projeto "Studio Class Pilates".

## Modo de trabalho

- **Fases em ordem.** No fim de cada uma, **pare e relate**. Só siga quando os pontos 🛑 estiverem resolvidos.
- **Arquivo de progresso:** `~/Arquivo/<hoje>/mel-progresso.md`. Atualize a cada passo (o que fez, quando, estado, o que falta, como desfazer), para outro agente poder retomar.
- **Worktree de trabalho:** `git -C ~/SquadOne fetch origin && git -C ~/SquadOne worktree add ~/.cache/mel-work/SquadOne -b mel/<fase> origin/main`. Ao terminar, `git worktree remove` e registre. Nunca use `~/SquadOne` como área de trabalho.
- **Arquivos instalados vêm do repositório.** Conferido em 04/10: `~/.hermes/scripts/graphify_projetos.py`, `~/.local/bin/backup-dell` e `~/.config/backup-dell/fontes.toml` são iguais aos de `~/SquadOne/deploy/`. **Edite no repositório, depois instale a cópia**, guardando um `.bak-<data>` do instalado.
- **Um pull request por fase de código** (4, 5 e 6). Abra o PR com `gh pr create`, **pare**, e só instale depois do merge do Rômulo.
- **Toda mudança de sistema** (sshd, ufw, Syncthing, `rclone.conf`) leva backup do arquivo antes e o comando de desfazer no arquivo de progresso.
- Se algo falhar: reverta e relate. Não improvise.

---

## Fase 0: linha de base (somente leitura)

Salve em `~/Arquivo/<hoje>/baseline-mel/`:
`docker ps`, `systemctl --user list-timers --all`, `systemctl --user --failed`, `systemctl --failed`, `tailscale status`, `tailscale serve status`, `sudo ufw status numbered`, `sudo sshd -T`, `rclone listremotes` (**só os nomes, nunca a configuração**), Syncthing (dispositivos conectados e estado das pastas pela API local, sem imprimir a chave), branch e `git status --porcelain | wc -l` de `~/SquadOne`, `~/prumo` e `~/crm-silmer`, `ls -la ~`, `df -h /`.
Confirme ativos: `dell-worker-healthwatch`, `atualizar-central.timer`, `backup-dell-espelho.timer`, `backup-dell-cofre.timer`, `silmer-drive-sync.timer`.
**Critério:** arquivos criados, nada mudou.

## Fase 1: acesso (SSH, firewall, Syncthing)

Situação conferida: o SSH aceita senha e a porta 22 está liberada para qualquer origem. O Syncthing escuta em todas as interfaces, com relays e descoberta global e local ligados. O `~/.ssh/authorized_keys` só tem a chave do PC antigo (`sutil@Rômulo`), duplicada, e uma das linhas começa com um BOM invisível (o SSH a ignora).

1. **Chave do PC novo.** O Rômulo vai colar a linha **pública** (`ssh-ed25519 AAAA… comentário`). Valide: uma linha só, começa com `ssh-ed25519 `, sem BOM nem CRLF. **Se começar com `-----BEGIN`, é chave privada: recuse, avise e não grave em lugar nenhum.** Acrescente a linha com `printf '%s\n'` ao `authorized_keys`, sem tocar nas outras; permissões 600 e 700. Remova só a linha duplicada com BOM. Não apague a chave antiga ainda.
2. Peça ao Rômulo (ou ao agente do PC, Anexo B) para testar `ssh mel hostname`. **Aguarde a confirmação.**
3. 🛑 **Só depois dessa confirmação:** SSH só por chave. Crie `/etc/ssh/sshd_config.d/10-so-chave.conf` com `PasswordAuthentication no` e `KbdInteractiveAuthentication no`; rode `sudo sshd -t && sudo systemctl reload ssh`. **Mantenha uma sessão aberta** enquanto testa uma segunda conexão por chave.
4. ufw: `sudo ufw allow in on tailscale0 to any port 22 proto tcp`; depois apague as duas regras `22/tcp ALLOW Anywhere` (v4 e v6), **uma de cada vez**, relendo `ufw status numbered`. Teste uma nova conexão antes de encerrar a sessão de segurança.
5. Syncthing (interface ou API local): endereço de escuta `tcp://100.68.136.88:22000`, GUI em `100.68.136.88:8384`, **desligar** descoberta global, descoberta local e retransmissão. No ufw, troque `22000/tcp ALLOW Anywhere` por `allow in on tailscale0 to any port 22000 proto tcp`.
6. 🛑 **Remover o dispositivo antigo** `Rômulo (LHPOUZN)` do Syncthing (PC que queimou, desconectado). Recomendação: remover. **Nunca** parear o PC novo nas pastas atuais, que são `sendreceive`.
7. Reveja (não apague, não abra o conteúdo) `~/.ssh/hermes_windows_ed25519`: descubra quem a usa (`grep -r hermes_windows ~/.hermes ~/SquadOne/deploy`) e recomende.

**Critério:** login por chave pela tailnet funciona; `ufw status` sem 22 e 22000 "Anywhere"; Syncthing sem relays nem descoberta; `systemctl --user --failed` vazio; Central, Hermes e n8n respondendo.

## Fase 2: registro de projetos (contra pastas duplicadas)

Crie dois arquivos com o mesmo conteúdo: `~/PRUMO/PROJETOS.md` (para humanos) e `~/SquadOne/deploy/hermes/projetos.toml` (para máquinas, **via PR**, no worktree). Campos: nome, caminho canônico, repositório, tipo (`clone-vivo`, `espelho`, `pasta`, `congelado`), dono (Rômulo ou Hermes), papel.

Registre, depois de reconferir:
- **clones vivos:** `~/SquadOne`, `~/prumo`, `~/crm-silmer` (`~/crm-silmer-wt` são worktrees dele);
- **pastas sem Git:** `~/auto-site`, `~/prumo-entregas`, `~/licitacoes-automation`, `~/prumo-automation`, `~/Licitacoes`, `~/renda-2026`, `~/Silmer`;
- **congelados:** `~/Pessoal-dev` e `~/Corporativo-dev`. Do Corp, `ds4fun`, `ds_auditor`, `p4fhub` e `p4f` existem no GitHub e entram pelo espelho Git; `databasepay4fun`, `Vera` e `pay4fun-p4f-landpage-cms-*` não, e entram como `pasta`;
- **áreas da Mel (a criar nas fases 4 e 6):** `~/Mel/Repos/<nome>` (espelhos do Hermes, **ninguém edita**), `~/Mel/Cofre`, `~/Mel/Entrada`.

**Critério:** arquivos existem; todo caminho do registro existe (ou está marcado "a criar"); nenhuma pasta aparece duas vezes; nenhum repositório remoto repetido entre caminhos (liste o `origin` de cada pasta e compare).

## Fase 3: arrumar o que sai do Dell (arquivar, nunca apagar)

Premissa: o PC faz a cópia dele. Aqui só se **prepara** e se **arquiva**.

1. **`~/Pessoal-dev/port`:** `tar --zstd` sem `node_modules`, `graphify-out`, `.output` e `dist` → `~/Arquivo/<hoje>/port.tar.zst`; verifique (`tar -tf`, contagem) e gere `sha256`. Contexto: virou o repositório `product_designer` (263 commits), e o `portfolio` é o clone dele, em dia. Só existem nesta pasta: `pdf_exports/` (13 MB), `_to_delete/`, 7 dos 26 arquivos de `docs/` e versões diferentes de `ABOUT.md`, `ARCHITECTURE.md`, `RULES.md` e `agents.md`.
2. **`~/Pessoal-dev/espectro`:** `tar --zstd` sem `node_modules`, `.gomodcache`, `.gomodcache-test`, `.gocache*`, `graphify-out`, `.nuxt`, `.output`, `bin` → `~/Arquivo/<hoje>/espectro.tar.zst`. O `.git` dessa pasta está **corrompido**: não rode comandos git que escrevam nela.
   Gere também `espectro-vs-github.diff`: clone do GitHub em `~/.cache/mel-work/` (apague depois com `gio trash`) e `LC_ALL=C diff -ru`, só dos arquivos **locais mais novos** que o último commit do GitHub (conferido: cerca de 30, entre eles `cmd/server/main.go`, `internal/clinic/drift.go`, `drift_test.go`, as migrations 042 a 044, `frontend/clinic/components/CalendarCard.vue`, `composables/useClinic.ts` e `shared/types.ts`) e os dois resumos `docs/daily-summary/2026-07-07.md` e `2026-07-08.md`. Referência do dia: 159 arquivos diferentes (30 com o local mais novo, 127 com o GitHub mais novo) e 24 só no local, a maioria logs.
3. **`~/Pessoal-dev/crm-silmer`** (cópia antiga, sem `.git`) e **`~/Pessoal-dev/Silmer`** (sem Git): `tar` de cada um para `~/Arquivo/<hoje>/`. Verifique se `Silmer` é o `silmer-web` e se existe repositório no GitHub (`gh repo list`).
4. **`~/Corporativo-dev`: não toque.** Prepare `~/Arquivo/<hoje>/corp/Corporativo-dev.tar.zst` e o `.sha256` para o PC puxar por `scp`. Relate quais subprojetos têm GitHub.
5. **Relatório** `~/Arquivo/<hoje>/relatorio-saida-do-dell.md`: para `aladdin`, `iris` e `portfolio`, o remoto, a branch, os commits sem push (`git log @{u}..`) e os arquivos sujos, para o PC clonar sem perder nada (`iris` está em `fix/pequenos-ajustes-2`).
6. **Commit só local do `crm-silmer`:** a branch `fix/inbox-live-tests` tem 1 commit que não está em nenhum remoto (worktree em `/tmp`). Crie um `git bundle` em `~/Arquivo/<hoje>/` com `origin/master..fix/inbox-live-tests`. **Não dê push**: o repositório `crm-silmer` é público.
7. 🛑 Com os arquivos verificados, **pergunte** antes de mandar para a lixeira as originais de `port`, `espectro` e `Pessoal-dev/{crm-silmer,Silmer}`. O Rômulo já disse que `espectro` pode sair, mas **mostre a lista dos ~30 arquivos mais novos**.

**Critério:** tarballs íntegros, relatório escrito, nada apagado sem confirmação.

## Fase 4: graphify em todos os repositórios (Hermes)

Hoje o job `Graphify — projetos` (cron do Hermes, 03:00, `no_agent`, script `graphify_projetos.py`) lê 4 pastas fixas e roda sem gastar IA. Ele passa a cobrir **todos** os repositórios do Rômulo e as pastas sem Git do registro, inclusive repositório novo.

1. **Descoberta:** `gh repo list romulosutil --limit 200 --json name,isArchived,isFork,defaultBranchRef,diskUsage,url` (conferido: 45 repositórios, 405 MB no total; os maiores são `linkedin_bot`, 148 MB, e `Aladdin`, 57 MB). A organização `DesignerSutil` só tem `demo-repository`: ignore. Ignore arquivados e forks. Tenha um limite de tamanho configurável (sugestão: 300 MB) com aviso.
2. **Espelhos:** os que já são clone vivo (`SquadOne`, `prumo`, `crm-silmer`) usam o caminho vivo. Cada um dos outros ganha **um clone raso** em `~/Mel/Repos/<nome>` (`--depth 1 --single-branch`). Atualize com `fetch --depth 1` e `reset --hard FETCH_HEAD`, **nunca merge** e **nunca `clean -x`** (apagaria `graphify-out`). Coloque `graphify-out/` em `.git/info/exclude`.
3. **Sem duplicar:** os repositórios do Corp que também estão em `~/Corporativo-dev` entram só pelo espelho Git. Os 3 sem GitHub entram como `pasta`.
4. Para cada pasta: `graphify update` (AST, sem LLM) e `graphify global add`, como hoje. Mantenha o limite de 40 MB do grafo global. (O grafo do `espectro` chegou a 157 MB por causa do `.gomodcache`; o clone limpo deve caber.)
5. **Silêncio:** só falha vira mensagem no WhatsApp. `RESUMO.md` e `diario.jsonl` não podem crescer sem limite com 45 repositórios.
6. Rode com `nice -n 10`. Mantenha o timeout por repositório. A primeira rodada pode demorar: **meça** e informe, e confira o timeout do job no cron do Hermes (`hermes cron --help`).
7. **Varredura de duplicatas (barata):** duas pastas com o mesmo `origin`, ou pasta nova de topo em `~` fora do registro, gera **aviso** na fila `~/.local/share/avisos/fila/*.json` (mesmo formato do `atualizar-central`). **Nunca** ação automática.
8. Em `fontes.toml`, ponha `~/Mel/Repos` no `excluir` do cofre (é regenerável).

**Entrega:** PR. Depois do merge, instale o script (com `.bak`), rode **manualmente** primeiro com 2 ou 3 repositórios (`graphify_projetos.py <nome>`) e depois com todos. Só então deixe para as 03:00. Não use `hermes cron run` fora de hora sem avisar.
**Critério:** repositórios clonados = elegíveis; grafos com mais de 0 nós; `global-graph.json` de tamanho razoável; job `ok`; `git status` dos clones vivos inalterado; uso de disco de `~/Mel/Repos` informado; nenhum nome duplicado no global.

## Fase 5: backup na pasta `Estrutura`

Contexto: `backup-dell` (subcomandos `iniciar`, `espelho`, `cofre`, `ensaio`, `status`), configuração em `fontes.toml`, **uma trava única** (`ESTADO/trava`) porque o rclone regrava o `rclone.conf`. O remote `gdrive` tem escopo `drive.file` e **não enxerga pastas criadas à mão**: por isso um remote novo.

1. **Confirme o id:** `rclone lsjson gdrive-silmer: --drive-root-folder-id root --dirs-only 2>/dev/null` deve mostrar uma única pasta `Estrutura`, id `1wcQ-azNwmYp0YnAgy-Y9QAnYc7aUqvHQ`. Se houver mais de uma ou o id mudou, **pare**.
2. **Crie o remote `gdrive-estrutura` copiando a seção `[gdrive-silmer]`** do `~/.config/rclone/rclone.conf` e trocando **só** o `root_folder_id`. Não precisa de login novo. Não mexa em `[gdrive]` nem em `[gdrive-silmer]`. Faça `cp -p` do arquivo antes, escreva de forma atômica **segurando a trava do backup** e evite o minuto em que o `silmer-drive-sync` roda (a cada 5 min). Depois: `rclone about gdrive-estrutura:` e `rclone listremotes` (devem ser 3). Nunca imprima o conteúdo.
3. **Coletor `estrutura-coletar`** (no repositório, em `deploy/dell/backup/`): copia por **lista de permissão** para `~/.local/share/mel/estrutura/dell/` (e usa `.../pc/` para o que vem do PC):
   - `~/PRUMO/MANIFESTO.md`, `LEIA-ME.md`, `PROJETOS.md` e `~/AGENTS.md`;
   - units, timers e paths de `~/.config/systemd/user/` (sem `.bak-*`);
   - `~/.config/backup-dell/fontes.toml`;
   - os `docker-compose.yml` de `~/workspace/infra-docker/*`, `~/workspace/moneyprinterturbo` e `~/licitacoes-automation`;
   - lista de repositórios (`gh repo list`), `git remote -v` e branch de cada clone vivo;
   - `tailscale status`, `tailscale serve status`, `docker ps`, `sudo ufw status`, `systemctl --user list-timers`, `apt-mark showmanual`;
   - dos jobs do cron do Hermes, **só nome, agenda e script** (não os prompts);
   - os fluxos do n8n exportados **sem credenciais** (`n8n export:workflow` dentro do container; `~/licitacoes-automation/workflows/` pode ter os mesmos).

   **Antes de copiar, passe todo arquivo por um filtro de segredos:** `CHAVE=valor`, `password:`, `token`, `secret`, `Authorization`, chaves PEM e OpenSSH, `AGE-SECRET-KEY-`, cadeias longas de alta entropia. Achou: troque o valor por `<oculto>` (compose e env) **ou exclua o arquivo** (fluxo do n8n com token literal) e liste no relatório do job. **O job falha se sobrar padrão suspeito.** Os `docker-compose.yml` do `infra-docker` provavelmente têm senhas de banco escritas dentro: redija.
   **Nunca entram:** `.env*`, `auth.json`, `rclone.conf`, `~/.ssh/*` (exceto `config`), `~/.hermes/.env`, `*.db`, sessão do WhatsApp.
4. **Integração ao `backup-dell.py`** (PR): bloco novo `[[espelho]] id = "estrutura"` com **`remoto` e `lixeira` por bloco** (hoje `g['remoto']` é global: mude com compatibilidade, o global continua sendo o padrão). `origem` = a área de preparo; `destino` na raiz do remote; `intervalo_h = 24`, `atencao_h = 30`, `falha_h = 72`; sentinela `dell/MANIFESTO.md`; `max_apagar` baixo; versões antigas por 30 dias no próprio remote. Deve aparecer como **`backup:estrutura`** no `status.json` e na Central, e o `dell-status` deve avisar atraso. Prefira de madrugada (por volta das 04:00); se o runner só tiver `intervalo_h`, é aceitável.
5. Acrescente em `obrigatorios` do cofre: `~/.config/mel/age/identity.txt` e `~/Mel/Cofre` (Fase 6).
6. **Teste:** rode só esse bloco (veja `backup-dell espelho --help`); confira no Drive com `rclone lsf gdrive-estrutura:`; procure segredo na área de preparo e em 2 ou 3 arquivos lidos com `rclone cat`; `backup-dell status`.
7. **PC:** o Dell recebe do PC em `~/.local/share/mel/estrutura/pc-incoming/` (por SSH, Anexo B) e inclui em `Estrutura/pc/`. Crie a pasta com permissão 700.

**Critério:** remote criado; `Estrutura/dell/` com conteúdo; `backup:estrutura` ok no status; varredura de segredos limpa.

## Fase 6: Entrada (página privada) + cofre `age` + Hermes organiza

**Objetivo:** uma página simples, **só pela tailnet**, onde o Rômulo manda **texto e arquivos**; o Hermes mantém tudo arrumado; **segredo nunca chega ao modelo**.

**Princípio inegociável:** a garantia vem do **código antes do modelo**. O modelo só **propõe** (JSON); o código **valida e executa** dentro de uma lista de permissão. Prompt nenhum é barreira.

1. **Áreas** (permissão 700): `~/Mel/Entrada/` (`chegou/` bruto, `organizado/` por destino, `diario.jsonl`) e `~/Mel/Cofre/` (`*.age` e `indice.json` com id, rótulo, tipo e data, **nunca valores**).
2. **age:** `sudo apt install age` (sem senha de sudo; versão 1.2.1, gratuita). Identidade da Mel em `~/.config/mel/age/identity.txt` (600; nunca em texto claro no Drive; entra no cofre restic por `obrigatorios`). Lista de destinatários em `~/Mel/Cofre/recipients.txt` com a chave pública **da Mel e a do Rômulo** (ele gera no PC com `age-keygen` e cola só a linha `age1…`): assim ele decifra no PC mesmo se a Mel morrer. Criptografe sempre para todos os destinatários.
3. **Serviço `entrada`** (pequeno, em `deploy/dell/entrada/`, unit de usuário): escuta **só em `127.0.0.1:9130`**. Exponha com `tailscale serve`, **acrescentando** um listener HTTPS (confira em `tailscale serve --help` quais portas são permitidas; 443 e 8443 já estão em uso, a 10000 costuma estar livre). Sem `funnel`, sem `reset`. Aceite só origens da tailnet e loopback (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`, `127.0.0.1`, `::1`), cheque `Origin`, limite o tamanho (sugestão: 200 MB por envio) e nunca execute nada que for enviado.
   Página simples, acessível, que funcione no celular: um campo de texto, um seletor de arquivos e **três botões explícitos**:
   - **Guardar no cofre (segredo):** o servidor cifra com `age` **na hora**, grava em `Cofre/` e indexa pelo rótulo digitado. **Nada disso vai ao modelo.** O texto bruto não é gravado em disco nem em log.
   - **Organizar:** o conteúdo passa pelo filtro de segredos. Se achar segredo, **bloqueia** e pede para usar "cofre"; se não, entra na fila do agente.
   - **Só guardar (sem IA):** vai para `Entrada/chegou/`.

   A página **nunca mostra segredo de volta**. A leitura é por linha de comando na Mel: `cofre listar` e `cofre ler <id>` (script em `~/.local/bin`, com confirmação).
4. **Filtro de segredos** (um módulo só, com testes): chaves PEM e OpenSSH, `AGE-SECRET-KEY-`, `ghp_`, `sk-`, `AKIA`, JWT, `password=`, `token=`, `secret=`, `Authorization: Bearer`, URLs com credencial, mais entropia. O valor vira `{{SEGREDO:<id>}}` e é guardado no cofre. Teste com amostras **falsas**, incluindo casos negativos.
5. **Agente = Hermes.** Investigue como ele expõe o modelo: `hermes --help`, `hermes cron create --help`, `hermes -z`, as skills em `~/.hermes/skills` e `~/.hermes/config.yaml` (**sem imprimir segredos**). Veja também `hermes secrets` e `hermes egress` (um firewall que injeta credenciais para o modelo nunca vê-las): se atenderem "o modelo nunca vê o segredo" usando `age` como fonte, prefira-os; senão, mantenha o desenho acima.
   Job do cron do Hermes a cada 5 min: **fila vazia → silêncio e zero token**. Com itens, o agente recebe **só texto já redigido e metadados** e devolve um plano JSON `{destino, nome, rótulo, ação: mover | resumir | registrar-projeto}`. **Um executor determinístico** valida e executa: raízes permitidas só `~/Mel/Entrada/organizado/*` e `~/Arquivo/<hoje>/`; sem `..`, sem sobrescrever, sem apagar, sem links. Tudo vai ao `diario.jsonl`, e o resumo (só o que mudou) vai ao WhatsApp.
   Isso relaxa "o Hermes só informa" **apenas dentro da Entrada**: registre no `AGENTS.md` e no manifesto.
6. **Se em cerca de 30 minutos a integração com o Hermes não ficar clara**, entregue de 1 a 4 (página, age, filtro, fila, guardar sem IA) e deixe o item 5 como pendência documentada. **Não improvise um agente com acesso solto.**
7. A varredura de duplicatas da Fase 4 (item 7) também alimenta o agente: ele **propõe**, não move.

**Critério:** com um arquivo **falso** `chave-teste.txt` contendo `AGE-SECRET-KEY-…` falso:
- "Organizar" **bloqueia**;
- "Cofre" cifra, e o `indice.json` não tem o valor;
- log e `diario.jsonl` não têm o valor;
- `age -d` com a identidade da Mel recupera o arquivo;
- o texto enviado ao modelo tem só `{{SEGREDO:id}}` (prove com o registro da requisição);
- a página só abre pela tailnet (teste do celular);
- `tailscale serve status` mantém as 3 linhas anteriores;
- os 12 containers continuam `Up`.

## Fase 7: documentação

Atualize **sem inventar o que não foi feito**:
- `~/AGENTS.md`: Mel como apelido, regra "uma pasta por projeto", `~/Mel/*`, Hermes dentro da Entrada, e mantenha a lista de "não mova";
- `~/PRUMO/LEIA-ME.md`: link do MANIFESTO e do PROJETOS, onde abrir a Entrada;
- `~/PRUMO/MANIFESTO.md`: marque o que virou "feito";
- `fluxos.ts` (no PR da fase respectiva): Backup `Estrutura`, graphify de todos os repositórios e Entrada.

Rode `graphify update .` **só dentro dos repositórios alterados**, nunca em `~`.
**Avise** o Rômulo: o canvas Design "Estrutura do SquadOne" e o artefato "Fluxos da operação" ficam defasados, e a regeneração é pedida por ele.

## Verificação ao final de cada fase

- `systemctl --user --failed` vazio; `systemctl --failed` sem novidade; `list-timers` com os mesmos mais os novos.
- `docker ps`: 12 containers `Up` (7 com `healthy`).
- `tailscale serve status`: as 3 linhas originais intactas.
- `~/auto-site` intacta, com `CLAUDE.md` (sentinela do backup).
- `backup-dell status` sem falha; último resultado ok de `silmer-drive-sync`, `atualizar-central` e `gerador-de-sites`.
- `git status --porcelain` de `~/SquadOne` continua em **7**; `~/prumo` e `~/crm-silmer` sem sujeira nova.
- `dell-worker-healthwatch` ativo no fim.
- Relate: o que mudou, o que foi pulado, o que falhou e o que precisa de decisão 🛑.

## Formato de resposta

Para cada fase: (1) o que vai fazer, (2) comandos principais, (3) resultado real das verificações, (4) pendências 🛑. Em português, direto. **Nunca diga que algo foi concluído sem ter rodado a verificação.**

---

# Anexo B: parte do PC (entregar ao agente do PC, o Antigravity)

**Objetivo:** SSH por chave pelo Tailscale até a Mel, o `age` do Rômulo e o backup diário do PC.

**Limites:**
- No Dell, só comandos de leitura, até a Mel liberar.
- Não crie pastas no Dell fora de `~/.local/share/mel/estrutura/pc-incoming/`.
- Não mexa em sshd, ufw, Tailscale, Docker, n8n, Hermes nem Syncthing.
- Nunca imprima chave privada.
- Se usar Remote-SSH, abra uma pasta de projeto específica, **nunca `~`**.
- Se algo falhar, pare e relate.

**B1. Chave.** Já foi gerada. Entregue ao Rômulo **só a linha `.pub`** (começa com `ssh-ed25519`). Nunca a privada.

**B2. Atalho** em `%USERPROFILE%\.ssh\config`:
```
Host mel
  HostName romulo-sutil-corr-a-latitude-7420
  User romulo-sutil-corr-a
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 30
```
(Se o nome não resolver, use `100.68.136.88`.)

**B3. Teste:** `ssh mel hostname` deve responder `romulo-sutil-corr-a-Latitude-7420`. Na primeira conexão, a impressão digital do Dell é `SHA256:swCqeh1PfopBoFbGq5456BRakBWO/j39c3y50kOPzao` (ED25519). Se for diferente, **pare**.
Para a chave pública chegar ao Dell enquanto a senha ainda funciona, o Rômulo cola a linha `.pub` na conversa com o agente do Dell. No PowerShell, **não** use `>>` para gravar arquivo (grava UTF-16 ou com BOM).

**B4. age no PC:** `winget install FiloSottile.age`; `age-keygen -o %USERPROFILE%\.config\age\key.txt`. Entregue ao Rômulo **só a linha `age1…` (pública)**. A privada fica fora do Drive e do Git, com cópia no gerenciador de senhas.

**B5. Backup diário do PC:** script `Backup-Estrutura-PC.ps1` e Tarefa Agendada (ao entrar no Windows e a cada 24 h; "executar assim que possível se perdeu o horário"). Coleta, por **lista de permissão**:
- `~/.ssh/config` (nunca chaves e nunca `known_hosts`);
- `settings.json` e `keybindings.json` do editor;
- `code --list-extensions`;
- `winget export`;
- o perfil do PowerShell;
- a lista de repositórios em `Dev\` com `git remote -v` e `git status -sb`;
- a exportação da própria tarefa agendada.

Envia por `scp -r` para `mel:~/.local/share/mel/estrutura/pc-incoming/` (sobrescreve `latest`; as versões ficam no Drive). **Nunca envie** chave privada, `.env`, tokens, chave do `age`, dados de navegador.

**B6. Depois da Fase 3 do Dell:** puxe `scp mel:Arquivo/<data>/corp/Corporativo-dev.tar.zst` e o `.sha256`, **confira o hash**, extraia em `Dev\Corp\` e faça `git clone` dos repositórios (Aladdin, Iris, product_designer como `portfolio`, e os demais) em `Dev\Pessoal\`.
