# Mel: progresso (04/10/2026)

Prompt de origem: `~/PRUMO/PROMPT-MEL.md`. Agente: Claude Code no Dell. Início: 11:43 (Brasília), depois da janela do gerador (08:00–11:30).

## Estado das fases

| Fase | Estado | Quando |
|---|---|---|
| 0. Linha de base | **concluída** (só leitura) | 04/10 11:45–11:55 |
| 1. Acesso (SSH, ufw, Syncthing) | **concluída** (itens 1 a 7; verificação feita) | 04/10 12:00–12:32 |
| 2. Registro de projetos | **concluída**; PR #5 aberto, aguardando merge do Rômulo | 04/10 12:35–12:45 |
| 3. Arrumar o que sai do Dell | **concluída**, com 🛑 aberto (lixeira dos originais) e decisões do crm-silmer e do Silmer | 04/10 13:25–13:42 |
| 4. Graphify em todos os repositórios | **concluída**: PR #6 mergeado, instalada e verificada; 1ª execução do cron com o script novo é amanhã 03:00 | 04/10 14:20–15:00 |
| 5. Backup na `Estrutura` | **parte de sistema feita** (remote e `pc-incoming`); **PR #7 aberto**, nada instalado nem enviado; aguarda merge | 04/10 15:00–15:30 |
| 6. Entrada + cofre `age` + Hermes | não iniciada | |
| 7. Documentação | não iniciada | |

## Fase 0: o que foi feito

Criados só arquivos em `~/Arquivo/2026-10-04/baseline-mel/` (nada mais mudou no sistema):
`docker-ps`, `user-timers`, `user-failed`, `system-failed`, `tailscale-status`, `tailscale-serve-status`,
`ufw-status-numbered`, `sshd-T`, `sshd-resumo`, `rclone-listremotes` (só nomes), `syncthing-estado`,
`git-estado`, `ls-home`, `df-root`, `units-ativas`, `backup-dell-status`, `servicos-ultimo-resultado`, `hermes-cron-list`.

**Como desfazer:** `gio trash ~/Arquivo/2026-10-04/baseline-mel` (não há nada a reverter fora disso).

## Linha de base (resumo)

- Containers: 12 `Up` (7 `healthy`). Bancos publicados só em `127.0.0.1` e `100.68.136.88`.
- `tailscale serve`: `/` → 9119, `/webhook` → 5679, `:8443` → 9120 (3 linhas, tailnet only).
- Falhas: `systemctl --user --failed` e `systemctl --failed` vazios.
- Ativos: `dell-worker-healthwatch`, `atualizar-central.timer`, `backup-dell-espelho.timer`, `backup-dell-cofre.timer`, `silmer-drive-sync.timer`.
- Últimos resultados: `silmer-drive-sync`, `atualizar-central`, `gerador-de-sites`, `backup-dell-espelho`, `backup-dell-cofre` todos `success`.
- `backup-dell status`: cofre, consultoria, ensaio, entregas, sites, todos `ok`.
- `~/auto-site/CLAUDE.md` presente (sentinela do backup).
- Git: `~/SquadOne` main, **7 sujos** (6 `M` + `.planning/`), HEAD `6769d08`; `~/prumo` main, 0 sujos; `~/crm-silmer` master, 0 sujos.
- rclone: 2 remotes (`gdrive`, `gdrive-silmer`). Depois da Fase 5 devem ser 3.
- Disco: 376 GB livres de 468 GB.
- Hermes cron: job `Graphify — projetos` (`d43aaa681519`), `0 3 * * *`, `no-agent`, script `graphify_projetos.py`, último resultado ok. 7 de 8 jobs ativos.
- `~/Mel` não existe ainda.

## Divergências em relação ao manifesto / ao prompt

1. **Syncthing:** `Corporativo-dev` é `receiveonly` (o manifesto fala em `sendreceive` para as três). `Pessoal-dev` e `auto-site` são `sendreceive`. O dispositivo `Rômulo (LHPOUZN)` está desconectado, como esperado.
2. **`~/Sync` voltou a existir** (vazio). O manifesto diz que a pasta vazia `Sync` foi para a lixeira em 30/09; a pasta `Default Folder` do Syncthing aponta para ela e a recria. Remover essa pasta do Syncthing faz parte da Fase 1, item 6, e é decisão do Rômulo.
3. **`ufw`:** a regra do 8384 já é só `on tailscale0`. Mas o Syncthing escuta o 8384 em `*` (a GUI), então só o ufw protege hoje.
4. **`authorized_keys`:** as 2 linhas são a **mesma chave** (hash igual). A linha 2 tem BOM **e CRLF** (o manifesto citou só o BOM).
5. **Serviço do Syncthing:** é de sistema (`syncthing@romulo-sutil-corr-a.service`), config em `~/.local/state/syncthing/config.xml`. O prompt supõe interface/API local: serve, mas o serviço é de sistema.
6. `ufw` usa numeração que muda a cada exclusão: na Fase 1, reler a lista antes de cada `delete`.

## Fase 1: acesso

### Item 1: chave do PC novo (feito, 04/10)
- Chave pública recebida (`jarvis-pc`, ed25519, fingerprint `SHA256:6Kk5LVc8gneAlfLYkWUdegWNlRweqVgQaX6oYlV9qFA`). Validada: 1 linha, `ssh-ed25519`, sem BOM nem CRLF, `ssh-keygen -l` leu.
- `~/.ssh/authorized_keys` agora tem **2 linhas**: `sutil@Rômulo` (PC antigo, mantida) e `jarvis-pc` (nova). Removida só a linha duplicada com BOM+CRLF (mesma chave da linha 1). Permissões 700 em `~/.ssh` e 600 no arquivo. `sshd -t` OK.
- **Desfazer:** `cp -p ~/Arquivo/2026-10-04/backups-sistema/authorized_keys.bak-2026-10-04 ~/.ssh/authorized_keys`
- Ainda **não** mexi em sshd_config, ufw nem Syncthing.

### Item 1b: a chave do PC era outra (04/10 ~12:25)
- O 1º teste (`ssh mel hostname`) entrou **por senha**, não por chave (log: `Accepted password`). Host key conferida e correta.
- O agente do PC mostrou que a chave carregada é **`jarvis-pc-2`** (a que gravei antes era `jarvis-pc`; foi regerada). Log do Dell: `Connection reset … [preauth]` (chave desconhecida).
- Acrescentada a `jarvis-pc-2` (`SHA256:5B6D56ZCEyz0wvnDDP1/02eTjSQwJZa14APs5orGOGQ`). `authorized_keys` agora tem **3 linhas**: `sutil@Rômulo`, `jarvis-pc` (provavelmente órfã) e `jarvis-pc-2`.
- **Desfazer:** `cp -p ~/Arquivo/2026-10-04/backups-sistema/authorized_keys.bak2-2026-10-04 ~/.ssh/authorized_keys` (volta às 2 linhas; o `.bak-2026-10-04` é o original de 2 linhas com BOM).
- Pendente: tirar `jarvis-pc` se o Rômulo confirmar que não existe a privada dela; a antiga `sutil@Rômulo` só sai com ordem dele.

### Item 2: teste do PC (feito)
`ssh -o BatchMode=yes -o PasswordAuthentication=no mel hostname` do PC (`paiduben`) respondeu `romulo-sutil-corr-a-Latitude-7420` sem senha. Host key conferida (`SHA256:swCqeh1PfopBoFbGq5456BRakBWO/j39c3y50kOPzao`). O Rômulo confirmou ("Funcionou").

### Item 3: SSH só por chave (feito, 04/10)
- Criado `/etc/ssh/sshd_config.d/10-so-chave.conf` (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`). Antes, o `.d` estava vazio e o `Include` vem primeiro no `sshd_config`, então vale. `sshd -t` OK, `reload` feito, `sshd -T` mostra `passwordauthentication no`.
- **Desfazer:** `sudo mv /etc/ssh/sshd_config.d/10-so-chave.conf ~/Arquivo/2026-10-04/backups-sistema/ && sudo sshd -t && sudo systemctl reload ssh`
- Rede de segurança usada: a sessão local do Dell (reload não derruba sessões abertas).

### Item 4: ufw da 22 (feito, 04/10)
- Backup: `backups-sistema/user.rules` e `user6.rules`. Acrescentada `22/tcp on tailscale0` (v4 e v6); apagadas as duas `22/tcp ALLOW Anywhere`, uma de cada vez, relendo `ufw status numbered` (os números mudam a cada exclusão).
- **Desfazer:** `sudo ufw allow 22/tcp` (volta a abrir para todos; só se for preciso) ou restaurar `user.rules`/`user6.rules` em `/etc/ufw/` e `sudo ufw reload`.

### Item 5: Syncthing (feito em parte, 04/10)
- Backup: `backups-sistema/syncthing-config.xml.bak-2026-10-04` (600, contém a chave da API).
- Via API local: `listenAddresses = tcp://100.68.136.88:22000`; descoberta global, local e retransmissão **desligadas**. `restart-required: false`; `ss` confirma escuta só em `100.68.136.88:22000`.
- ufw da 22000: acrescentada `on tailscale0` (v4 e v6), apagadas as duas `Anywhere`. Estado final: 22, 22000 e 8384 só em `tailscale0`; nada aberto para o mundo.
- **NÃO feito: GUI em `100.68.136.88:8384`.** O `dell-status.py` (a cada minuto) lê `https://127.0.0.1:8384` (linhas 177–190); mover a GUI faria o monitor falhar e mandar WhatsApp. Decisão do Rômulo (opções no relatório da fase). Enquanto isso a GUI escuta em `*:8384`, mas o ufw só deixa a `tailscale0` chegar.
- **Desfazer:** restaurar o `config.xml` do backup com o serviço parado (`sudo systemctl stop syncthing@romulo-sutil-corr-a`, `cp -p`, `start`), ou pela API: `listenAddresses=["default"]` e os três `*Enabled=true`.

### Item 7: `~/.ssh/hermes_windows_ed25519` (revisto, nada feito)
- Par criado em **18/09 02:35 no próprio Dell** (comentário `hermes-agent@romulo-sutil-corr-a-Latitude-7420`): não é do PC antigo, apesar do nome.
- **Ninguém o referencia** (nem `~/.hermes`, nem `~/SquadOne/deploy`, nem `~/.config`, nem `~/.local/bin`). A pública **não está** no `authorized_keys` do Dell.
- Provavelmente era para o Hermes entrar no Windows. Sem PC antigo e sem uso, recomendação: arquivar em `~/Arquivo/<data>/` depois que o PC novo estiver em uso (se o Hermes for entrar no PC novo, gerar chave nova, com escopo menor).

### Verificação (04/10 12:24)
`systemctl --user --failed` e `systemctl --failed` vazios; Central 9120, Hermes 9119 e n8n 5679 respondem 200; 12 containers `Up`; `tailscale serve` com as 3 linhas; healthwatch ativo; `dell-status` rodou às 12:23:44 com `syncthing: ok (4 pastas sem erro)`.

### Fechamento da Fase 1 (04/10 12:25–12:32, com autorização do Rômulo)
- **Reteste do PC (ok):** `ssh -o BatchMode=yes mel hostname` entra sem senha; `ssh -o PubkeyAuthentication=no mel hostname` → `Permission denied (publickey)`.
- **Item 6 (feito):** removidos do Syncthing o dispositivo `Rômulo (LHPOUZN)` (desconectado) e a `Default Folder` (0 arquivos). As 3 pastas restantes (`auto-site`, `Corporativo-dev`, `Pessoal-dev`) só referenciam o próprio Dell. Os arquivos em disco não foram tocados. Backup: `syncthing-config.xml.bak2-2026-10-04`. **Nunca parear o PC novo nessas pastas** (são `sendreceive`, exceto `Corporativo-dev`).
- **GUI do Syncthing (opção A):** `gui.address = 127.0.0.1:8384` (antes `0.0.0.0`). A tailnet recusa a 8384. O `dell-status` segue vendo: `syncthing ok, 3 pastas sem erro` (12:31:57). Para abrir do PC: `ssh -L 8384:127.0.0.1:8384 mel` e `https://localhost:8384`. **Atualizar o manifesto e o LEIA-ME na Fase 7** (diziam `https://100.68.136.88:8384`).
- **`natEnabled = False`** no Syncthing (UPnP/NAT-PMP).
- **`authorized_keys`:** removida a `jarvis-pc` (órfã, achada pelo fingerprint). Restam `sutil@Rômulo` (mantida: o Rômulo não mandou remover) e `jarvis-pc-2` (em uso). Backup: `authorized_keys.bak3-2026-10-04`.
- **Desfazer GUI:** pela API (a partir de 127.0.0.1) `PATCH /rest/config/gui {"address":"0.0.0.0:8384"}`, ou restaurar o `config.xml` do backup com o serviço parado.
- **Sobra intencional:** as regras `8384 on tailscale0` do ufw (v4 e v6) continuam, mas hoje não abrem nada (a GUI está em loopback). Podem sair quando o Rômulo quiser.
- **Sobra:** a pasta vazia `~/Sync` (só marcador do Syncthing) ainda existe no disco; nada a recria mais.

### Verificação final da Fase 1 (12:32)
`systemctl --user --failed` e `systemctl --failed`: 0 e 0 (conferido com a opção correta); 12 timers (iguais à linha de base); Central 9120, Hermes 9119 e n8n 5679 respondem 200; 12 containers `Up` (7 `healthy`); `tailscale serve` com as 3 linhas; healthwatch, sshd e syncthing ativos; `dell-status` sem vermelho; `~/SquadOne` com 7 sujos, `~/prumo` e `~/crm-silmer` com 0; `~/auto-site/CLAUDE.md` presente; `sshd -T`: senha `no`; ufw: 22, 22000 e 8384 só em `tailscale0`.

## Fase 2: registro de projetos (04/10 12:35–12:45)

Combinado com o Rômulo: **checagem de saúde antes e depois de cada passo** (Central 9120, n8n, Drive). Script (somente leitura, fora do repositório): `/tmp/claude-1000/-home-romulo-sutil-corr-a/f82a4ae0-c1c1-4073-b780-e1611120c1e3/scratchpad/saude.sh` — cobre Central (`:9120`, `/crm`, tailnet `:8443`), n8n (`/healthz`, `/webhook` pela tailnet, container), Hermes, 12 containers/7 healthy, unidades falhas, healthwatch, `backup-dell status` + timers (sem chamar rclone), silmer-drive-sync, `tailscale serve`, `~/SquadOne` main/7 sujos e `auto-site/CLAUDE.md`. Resultado: **TUDO OK** na linha de base, depois do worktree, depois do `~/Sync`, depois do `PROJETOS.md` e no fechamento.

### O que foi feito
- **Worktree** `~/.cache/mel-work/SquadOne` (branch `mel/fase2-registro-de-projetos`, de `origin/main` = `6769d08`). Removido ao fim. O checkout `~/SquadOne` não foi tocado (HEAD `6769d08`, 7 sujos).
- **PR #5** (https://github.com/romulosutil/SquadOne/pull/5), commit `3dfaf1d`: `deploy/hermes/projetos.toml` (27 entradas), `deploy/hermes/scripts/projetos_verificar.py` (confere o registro; `--md` gera o PROJETOS.md do mesmo TOML) e `projetos_verificar.test.py` (23 testes). Sem CI configurado no repositório. **Quem faz o merge é o Rômulo.** Nada a instalar depois: roda do clone.
- **`~/PRUMO/PROJETOS.md`** criado (gerado do TOML; 82 linhas). **Desfazer:** `gio trash ~/PRUMO/PROJETOS.md`.
- **`~/Sync`** (vazia) para a lixeira, a pedido ("mude o que precisar mudar na estrutura"). Nada a referenciava (busca em deploy, systemd, hermes/scripts, backup, bin). **Desfazer:** restaurar pela lixeira (`gio trash --list`, `gio trash --restore`).
- Manifesto e LEIA-ME **ainda não** atualizados (Fase 7).

### Achados que mudaram o registro (em relação ao prompt)
1. **Corp:** o prompt manda "entrar só pelo espelho Git". Medido (arquivos em comum): `ds_auditor` 100%, `p4fhub` 98%, `p4f-site-institucional` ↔ `p4f` **18%**, `ds4fun` **0%** (GitHub tem 3 arquivos, a pasta tem 257). Só `ds_auditor` e `p4fhub` entram pelo espelho; `ds4fun` e `p4f-site-institucional` ficam também como `pasta` (`corp-*`, nomes distintos no grafo). Os 3 sem GitHub (`databasepay4fun`, `Vera`, `pay4fun-p4f-landpage-cms-*`) como `pasta`, como previsto. **Decisão do Rômulo no PR.**
2. **`~/workspace` entrou no registro** (o prompt não o listava; o manifesto o marca "não mover").
3. **`~/Silmer` tem um Git de verdade dentro**, `silmer-calendario-mobile` (1 commit de 01/10, sem remoto, só `dist/` e `.openai/`, não está no GitHub), e o bisync com o Drive o leva junto com o `.git` (regra 12). A `.git` da raiz de `~/Silmer` está vazia. **Nada feito**; decisão do Rômulo.
4. **Origins** (critério): nenhum repositório em mais de um clone. `crm-silmer` = 1 clone + 1 worktree (`~/crm-silmer-wt/tecnica-e-arte`); `Pessoal-dev/aladdin`→Aladdin, `iris`→Iris, `portfolio`→product_designer; `espectro`, `port`, `agent-context`, `crm-silmer`, `Silmer` (em `Pessoal-dev`) sem origin legível.
5. O repositório `romulosutil/DesignerSutil` existe (0 MB, público); o prompt dizia que a org `DesignerSutil` só tem `demo-repository`. Para a Fase 4: são 45 repos em `romulosutil`.
6. `crm-silmer` e `Iris` e `ds_auditor` são repositórios **públicos** no GitHub.

### Critério da fase
Arquivos existem; verificador no Dell: **27 projetos, 0 erros, 0 avisos**; todo caminho existe ou está `a-criar`; nenhuma pasta duas vezes; nenhum repositório repetido entre clones.

## Fase 3: arrumar o que sai do Dell (04/10 13:25–13:42)

Relatório completo: `~/Arquivo/2026-10-04/relatorio-saida-do-dell.md`. Saúde (Central, n8n, Drive...) `TUDO OK` no pré-voo, depois de cada bloco de tarballs e no fechamento (13:40).

### Feito
- **Tarballs** (todos com `.sha256`, permissão 600, `tar -t` = disco, zero avisos do tar), em `~/Arquivo/2026-10-04/`: `port` (373 entradas, 17,7 MB), `espectro` (1140, 58,7 MB), `Pessoal-dev-crm-silmer` (1792, 10,7 MB), `Pessoal-dev-Silmer` (411, 74,5 MB), `aladdin` (18764, 140,7 MB), `iris` (3893, 37,1 MB), `portfolio` (623, 12,9 MB) e `corp/Corporativo-dev` (983, 241,8 MB, para o PC por `scp`). Scripts em `/tmp/.../scratchpad/arquivar.sh` e `arquivar2.sh`. **Desfazer:** `gio trash` nos arquivos (nenhum original foi tocado).
- **Bundles do crm-silmer:** `crm-silmer-inbox-live-tests.bundle` (o do prompt) e `crm-silmer-todas-as-branches.bundle` (8,8 MB, `--all`, verificado), com `crm-silmer-bundles.sha256`.
- **`espectro-vs-github.diff`** (sem CRLF) e o relatório.
- **Subiu ao GitHub (só privado, só branch, nada na `main`):**
  - `romulosutil/espectro`: branch `dell/docs-recuperados-2026-10-04` (commit `9089976`: 2 resumos diários e 2 planos, sem segredo). `main` intacta em `955e5e1`. *Houve um tropeço: o 1º push criou a branch idêntica à `main` porque o commit falhou por falta de identidade Git no clone; corrigido com a identidade do SquadOne, só naquele commit, e o push seguinte avançou a branch.*
  - `romulosutil/silmer-calendario-mobile` (**repositório novo, privado**): o commit `4255e4db` que só existia dentro de `~/Silmer`. Push direto pela URL; o `.git` da pasta sincronizada **não** ganhou remoto.
  - PR #5 do SquadOne: mais 1 commit (`71543cf`, mapa do Silmer) e um comentário.
- **Não subiu:** `ci.yml` do portfolio (o token do `gh` não tem o escopo `workflow`; está no tarball); nada ao `Iris` e ao `crm-silmer` (públicos).
- **Silmer:** `~/PRUMO/SILMER.md` (as 3 frentes, achados, proposta de organização do `~/Silmer`, NÃO aplicada) e o registro com `grupo` (30 entradas); `~/PRUMO/PROJETOS.md` regenerado (98 linhas).
- **Limpeza:** clones temporários (`verif`, `espectro`, `product_designer`) e um JSON de rascunho foram para a lixeira (`gio trash`).

### Achados que contrariam o prompt/manifesto
1. **`espectro`:** "30 arquivos mais novos que o GitHub" é falso em conteúdo. Ignorando CRLF: 469 comparáveis, só `CLAUDE.md` e `.gitignore` diferem (GitHub mais novo); os arquivos citados são idênticos. Era data de modificação + CRLF.
2. **`crm-silmer`:** **46 commits em 12 branches** só locais, não 1. Público; nada enviado.
3. **`iris`:** a branch `fix/pequenos-ajustes-2` tem o commit da ponta inexistente (repositório danificado), mas o código é igual ao `main` (só 4 arquivos de config diferem). Os `.env*` e `docs/legal` só existem aqui (tarball).
4. **`Pessoal-dev/Silmer`** não é só o `silmer-web` (66% em comum, 57 só locais). `romulosutil/Silmer` é outro projeto.
5. As referências `origin/*` das réplicas estavam velhas; tudo foi conferido contra o GitHub real.

### Pendente (🛑)
- **Item 7:** mandar para a lixeira os originais de `~/Pessoal-dev/port`, `espectro`, `crm-silmer` e `Silmer`? (tarballs verificados; a lista dos "~30 arquivos" é vazia). **Nada foi apagado.**
- **`crm-silmer`:** o que fazer com os 46 commits (publicar em repo público, tornar privado e publicar, ou manter só local com o bundle).
- **Silmer:** aprovar (ou ajustar) a organização de `~/Silmer` em `SILMER.md`; qual cópia dos posts da política manter; as 4 imagens de `.sync-conflicts`; tirar o `.git` de `silmer-calendario-mobile`.
- **Corp** (no PR #5) e **merge do PR #5.**
- `ci.yml` do portfolio: precisa do escopo `workflow` no `gh` (login no navegador; decisão do Rômulo).

### Rodada 14:00–14:20: respostas do Rômulo ao relatório da Fase 3
1. **Lixeira dos originais: "Sim" (feito).** `~/Pessoal-dev/{port,espectro,crm-silmer,Silmer}` foram para a lixeira (`gio trash`, restaurável) depois de reconferir `sha256` e listagem dos 4 tarballs. `~/crm-silmer` e `~/Silmer` (vivos) intactos; as 17 branches do `~/crm-silmer` têm as mesmas pontas do bundle. **Desfazer:** `gio trash --list`, `gio trash --restore`.
2. **"Apague o velho" das duplicatas (feito, pelo que achei).** Interpretei como "a cópia velha de cada duplicata": o velho do `crm-silmer` e do `Silmer` já estava no item 1. O outro caso real foi `agent-context+` (casca vazia: 0 arquivos, só as pastas `claude/` e `codex/`): arquivado (`agent-context-mais.tar.zst`) e para a lixeira. O `agent-context` é projeto de verdade (982 arquivos, `.git` inválido) e **não tinha tarball**: criado (`agent-context.tar.zst`, 15 MB, verificado). Restam em `~/Pessoal-dev`: `agent-context`, `aladdin`, `iris`, `portfolio` (redundantes com os tarballs, até o PC pegar). **O Rômulo não respondeu a pergunta dos 46 commits do crm-silmer**: padrão adotado = manter só local, o PC clona do bundle (instruções no `SILMER.md`); nada publicado.
3. **Silmer: "verifique" (feito: NADA foi movido).** O `AGENTS.md` de `~/Silmer` (mapa da pasta + regras fixas) manda **não mover nem renomear** e não mexer em `.sync-conflicts/` e `silmer-calendario-mobile/`; `Politica/` e `drive-download-…/` são cópias conhecidas e documentadas. Os guias citam ~50 caminhos. Minha proposta de reorganização ia contra isso: **retirada**. Correções: o `silmer-drive-sync` exclui `**/.git/**`, então o `.git` do `silmer-calendario-mobile` **não** vai ao Drive (eu tinha afirmado o contrário em `SILMER.md` e no registro: corrigido nos dois). Também descoberto: `--max-delete 10` é **porcentagem** (10% de 249 = 24 arquivos); mover mais que isso aborta e a rodada seguinte faz `--resync` e traz os caminhos antigos de volta.
4. **"Pode mergear tudo": PR #5 mergeado** (commit `e14442e`, 14:14). Era o único PR aberto. O `atualizar-central` sempre reconstrói e reinicia o `squadone-operations`; rodei-o na hora (4 s). **Medido por sonda a cada 0,5 s: 1 amostra fora do ar (~0,5 s) no restart**, 153 amostras no total. `~/SquadOne` em `main` (`e14442e`), os mesmos 7 arquivos sujos (idênticos), fila de avisos do WhatsApp sem itens novos, saúde `TUDO OK`. Antes: `dist` salvo em `central-dist-antes-do-merge.tar.zst` (caminho de volta: untar em `~/SquadOne/dist` + `systemctl --user restart squadone-operations`; não foi preciso). **Atenção:** o restart carregou pela primeira vez o servidor construído em 01/10 com os arquivos sujos do CRM (o serviço rodava desde 30/09); subiu normalmente.
5. **`ci.yml`: "por enquanto não"**: fica para a atualização. Está em `portfolio.tar.zst`.
6. **O desenho do Rômulo** (PC no centro; Claude, Antigravity e Codex/GPT; GitHub, Graphify, G.Drive, Easypanel; Dell com N8N, Docker e Hermes; celular, WhatsApp, SquadOne, Calendar; `127.0.0.1:9120`): comparado com o plano. Bate quase tudo; **perguntas abertas** (ver a conversa): como o PC recebe o graphify, se o Hermes deve criar automações, o que a marca no `127.0.0.1:9120` quer dizer, e se o PC sobe para o Drive direto ou via Dell.

### Respostas ao desenho (14:20)
Graphify no PC: **o PC puxa do Dell por SSH**. Hermes: **cria rascunhos de automação (workflows inativos), o Rômulo aprova** (ainda não implementado; fica para depois da Fase 6). Central `:9120`: **só o painel que ele abre**. Drive: **a pasta `Estrutura` é o destino final de tudo**, e ele acessa Claude, Codex, Antigravity, Figma, Silmer e os repositórios **pelo PC** (Dell = organização e backup). Memória atualizada (`mel-decisoes-04-10`).

## Fase 4: graphify em todos os repositórios (14:20–14:40)

**Estado: PR #6 aberto, NADA instalado.** https://github.com/romulosutil/SquadOne/pull/6 (commit `14bbe78`, branch `mel/fase4-graphify-todos-os-repos`). Worktree removido. Aguarda o merge do Rômulo (a autorização "pode mergear tudo" valeu para o PR #5).

### O que o PR faz
- `graphify_projetos.py` reescrito: lê `projetos.toml`; `gh repo list` descobre os repositórios; **3 clones vivos + 6 pastas (auto-site e 5 do Corp) + 42 espelhos** (46 repos; fora: `Silmer` legado e os 3 já vivos). Espelhos rasos em `~/Mel/Repos/<nome>` (`fetch --depth 1` + `reset --hard`, nunca merge nem `clean -x`; recusa pasta que não seja o clone esperado). Limite de 300 MB configurável no registro.
- **Hermes mata script de cron em 1 h** (`_DEFAULT_SCRIPT_TIMEOUT = 3600`): orçamento de 50 min, resto na noite seguinte; primeira rodada grande é manual.
- **Para o PC:** cópias reais em `~/Mel/Grafos/<nome>/graphify-out/{graph.json,GRAPH_REPORT.md,graph.html}` + `global-graph.json`, `RESUMO.md`, `indice.json`. No PC: `scp -r mel:Mel/Grafos/ .`
- Silêncio: só falha vira WhatsApp. Avisos (grande demais, pasta fora do registro, repositório em 2 pastas, origin errado) vão uma vez à fila do `dell-status`, só se novos; nunca agem. Diário e RESUMO com teto. GitHub fora do ar: não limpa nada.
- `fontes.toml`: cofre sem `~/Mel/Repos` e `~/Mel/Grafos`. `SOUL.md`, `CLAUDE.md`, `run-graphify.sh` e `fluxos.ts` atualizados.

### Verificado antes do PR
30 testes novos + 25 do registro + 36 do monitor + 14 da Central, `vue-tsc` limpo. **Rodada real** em 3 repos reais (home temporária, global interceptado): 15,8 s (clone raso, `git status` limpo, grafos de 1.355/271/451 nós, stdout vazio), 5,7 s na 2ª (só `fetch`). `gh` e `git` (repo privado) autenticam dentro de um serviço systemd. `graphify update`: 1.386 arquivos de código = 20 s e 500 MB de RAM.

### Para depois do merge (cada instalação com `.bak-<data>` do instalado)
1. **Merge** reinicia a Central (`:9120`) ~0,5 s (o `atualizar-central` reconstrói a cada mudança na `main`; este PR mexe em `fluxos.ts`). Sonda a cada 0,5 s como no PR #5.
2. Instalar: `~/.hermes/scripts/graphify_projetos.py`; `~/.config/backup-dell/fontes.toml` (o instalado == `main`, conferido); **só a cópia** do `~/.hermes/SOUL.md` (instalado == repositório, conferido), **sem** `aplicar-hermes.py`, que reinicia o `hermes-gateway` (WhatsApp) e reaplica skills e cron.
3. Rodada manual: `graphify_projetos.py silmer-web ds_auditor p4fhub` (ou 2–3 outros), depois a completa; medir tempo, disco de `~/Mel/Repos`, tamanho do `global-graph.json`, e conferir: repositórios clonados == elegíveis (42), grafos com mais de 0 nós, nenhum nome duplicado no global, `git status` dos clones vivos inalterado. Só então deixar para as 03:00 (não usar `hermes cron run` fora de hora sem avisar).
4. Passar `Mel/Repos` e `Mel/Grafos` de `a-criar` para `existe` no registro (e os 4 espelhos do Corp).
5. Pendência do PC (Anexo B): script que roda `scp -r mel:Mel/Grafos/ .` e põe cada `<nome>/graphify-out` em `Dev/<nome>/graphify-out`.

### Fase 4: merge, instalação e rodada (14:52–15:00, "Pode mergear e seguir com a instalação")
**Estado: INSTALADA e VERIFICADA.** O job das 03:00 de amanhã já usa o script novo.

- **Merge do PR #6** (commit `ed9263f`). O `atualizar-central` rodou na hora (4 s, Central no ar). Sonda do `:9120` a cada 0,5 s: **480 amostras, 0 fora do ar**; `~/SquadOne` em `main`, os mesmos 7 arquivos sujos; fila de avisos vazia. `dist` anterior em `central-dist-antes-do-merge-6.tar.zst` (não foi preciso).
- **Instalado, cada um com `.bak-2026-10-04` e troca atômica** (antes, conferido que o instalado era idêntico à versão anterior do repositório): `~/.hermes/scripts/graphify_projetos.py`; `~/.config/backup-dell/fontes.toml` (TOML ok, `backup-dell status` ok); `~/.hermes/SOUL.md` (só a cópia: **`hermes-gateway` NÃO foi reiniciado**, segue ativo desde 30/09 10:21; o texto novo vale no próximo reinício natural). **Desfazer:** `cp -p <arquivo>.bak-2026-10-04 <arquivo>`.
- **Backup do grafo global antes da rodada:** `backups-sistema/global-graph.json.bak-2026-10-04` (14,5 MB) e `global-manifest.json.bak-2026-10-04`. Para voltar: copiar de volta para `~/.graphify/`.
- **Varredura de duplicatas (prévia, sem escrever):** 0 avisos hoje.
- **Rodada manual de 3 repositórios** (`silmer-web`, `ds_auditor`, `p4fhub`), dentro de `systemd-run --user` (ambiente de serviço, como o cron do Hermes): 15 s, stdout e stderr vazios, global de 4 para 7 entradas.
- **Rodada completa**: **3 min 41 s**, rc=0, stdout e stderr vazios, 51 alvos. **Critérios do prompt:**
  - repositórios clonados == elegíveis: **42/42**; `git status` dos espelhos limpo;
  - grafos com mais de 0 nós: **37**. Os outros **14 não têm código que o AST leia** (não é falha): `DesignerSutil`, `aladdin-pitch`, `corp-vera`, `ds4fun` (GitHub: só HTML e CSS), `espectro-pitch`, `jornada-no-espectro-jogo-`, `model-advocacia`, `model-consultorio`, `model-doc`, `model-estetica`, `model-people`, `model-pilates`, `model-varejo`, `silmer-calendario-mobile`. Nenhum erro, nenhum vazio, nenhum acima do limite;
  - **global-graph.json: 88,2 MB** (era 15 MB), 37 entradas, **nenhum nome repetido**. Consulta de verdade: 4,2 s e 395 MB de memória (aceitável). Limite de aviso: 300 MB;
  - maiores grafos: Iris 17.617 nós, Aladdin 14.993, crm-silmer 4.887, auto-site 4.720, espectro 4.353;
  - `git status` dos clones vivos: SquadOne 7 (os mesmos), prumo 0, crm-silmer 0;
  - disco: `~/Mel/Repos` 1,3 GB, `~/Mel/Grafos` 201 MB (166 MB em `.json`, 32 MB em `.html`), `~/.graphify` 151 MB; 374 GB livres;
  - fila de avisos (WhatsApp): 0 itens novos.
- **Rodada noturna simulada** (2ª completa, tudo já clonado): **53 s**, silenciosa, `fetch` nos 42 espelhos, nenhum grafo refeito.
- **Job `Graphify — projetos`:** inalterado (`0 3 * * *`, `no_agent`). Última execução registrada: hoje 03:00, `ok` (script antigo). **A 1ª execução real com o script novo é amanhã 03:00; conferir `hermes cron list`** (não usei `hermes cron run`).
- Registro: o verificador avisa 7 vezes que `Mel/Repos`, `Mel/Grafos` e 5 espelhos do Corp/Silmer estão `a-criar` mas já existem. **Ajustar no PR da Fase 5.**

### Guia do PC (entregue 15:00)
`~/PRUMO/PC-COMECAR.md` (enviado ao Rômulo como arquivo): o PC **já pode começar** a baixar. Seções: clonar os 46 repositórios (`gh repo list`, Corp em `Dev\Corp`), Corp-origem (tarball 242 MB com `.sha256`; `ds4fun` e `p4f` do tarball entram como `ds4fun-completo` e `p4f-site-institucional`), `crm-silmer` pelo bundle (17 branches, sem publicar), `.env`/docs/`agent-context` extraindo **só os arquivos** (nunca o tar inteiro por cima do clone: traz o `.git` antigo), grafos (`scp -r mel:Mel/Grafos`), Silmer pelo Drive, `age` (Fase 6) e o backup diário do PC (depende da Fase 5). Todos os caminhos citados foram conferidos dentro dos tarballs.

## Fase 5: backup na pasta `Estrutura` (15:00–15:30)

**Estado: parte de sistema FEITA; PR #7 aberto, NADA instalado, NADA enviado ao Drive.** https://github.com/romulosutil/SquadOne/pull/7 (commit `4225e87`, branch `mel/fase5-backup-estrutura`). Worktree removido. Aguarda o merge do Rômulo.

### Feito no sistema (fora do Git)
- **Id confirmado** (janela segura: logo depois do `silmer-drive-sync` e do espelho, segurando a trava do backup): 1 só pasta `Estrutura`, id `1wcQ-aNwmYp0YnAgy-Y9QAnYc7aUqvHQ`, entre 14 pastas na raiz do Meu Drive.
- **Remote `gdrive-estrutura`** = cópia da seção `[gdrive-silmer]` só com o `root_folder_id` trocado; escrita atômica, modo 600, segurando a trava; backup em `~/.config/rclone/rclone.conf.bak-2026-10-04` (600). `rclone about` ok (5,4 TB livres). `listremotes`: 3. A `Estrutura` estava **vazia**. Depois disso o `silmer-drive-sync` e o backup seguem `success`. **Desfazer:** `cp -p ~/.config/rclone/rclone.conf.bak-2026-10-04 ~/.config/rclone/rclone.conf` (com a trava) e nunca imprimir o arquivo.
- **`~/.local/share/mel/estrutura/pc-incoming`** (700; pais 700): o PC deixa o backup dele aqui (`latest/`).
- **`~/.local/share/mel/estrutura/dell`** (71 arquivos): gerado pelo `--dry-run` real (o coletor roda como `preparo`). Regenerável.

### O que o PR faz
`estrutura-coletar.py` (lista de permissão + filtro de segredos + **prova com os valores reais dos `.env` e do `rclone.conf`**), `backup-dell.py` com `remoto`/`lixeira` por bloco (compatível), `incluir` (com `--filter` ordenado), `janela`, `preparo`; bloco `estrutura` no `fontes.toml` (`janela` 04:00–06:00, **`intervalo_h = 12` e não 24**, porque com janela uma rodada manual empurraria o dia seguinte para fora dela); `estrutura-coletar.service` (sem `NoNewPrivileges`, para o `sudo ufw status`; o serviço do espelho tem essa trava); registro: 7 blocos `a-criar` → `existe`; `fluxos.ts` com a Estrutura; README.

### Verificado
- **45 testes novos** (31 coletor, 14 runner) + 25 + 30 + 36 + 14 existentes, `vue-tsc` limpo. **Prova de mutação** (desligar a prova final, a regra chave=valor, a exclusão de chave privada e as guardas): 3, 14, 2 e 3 testes falham.
- **Coletor no Dell real** (modo seco e escrita em pasta temporária): 71 arquivos, 9 valores ocultados nos 5 `compose`, 0 excluídos (os 15 fluxos do n8n entram), 21 valores reais conferidos; permissões 700/600. Conferência **independente**: das 11 linhas de senha/segredo nos compose e units gerados, as 11 estão ocultas ou são referência. (Uma 1ª versão da minha prova independente deu "4 vazamentos": eram senhas curtas e só de letras que coincidem com palavras comuns da prosa, não vazamento.)
- Falsos positivos que corrigi no caminho: `credentials`/`maxOutputTokens`/`passo` (palavra inteira), valor `{`, expressão `={{ }}` do n8n, `${i-1}` de template JS, ID de planilha do Google (sem entropia no n8n), `RCLONE_CONFIG=/caminho` (o `=` separa).
- **`--dry-run` real** do bloco contra o Drive: rc=0; a `--backup-dir` dentro do destino foi aceita; plano de 71 cópias + 8 ajustes de pasta, todas em `dell/`, nada em `pc-incoming`, nada para apagar. O 1º dry-run mostrou o aviso do `rclone` sobre `--include` + `--exclude` ter ordem indefinida: troquei por `--filter` ordenado e refiz (0 erros).

### Achado de segurança (não é do coletor; sem ação minha)
**4 senhas de banco são curtas e só de letras** (4 a 8 caracteres): `iris` `POSTGRES_PASSWORD` (4), `espectro` `MYSQL_ROOT_PASSWORD` (4) e `MYSQL_PASSWORD` (8), `p4f` `POSTGRES_PASSWORD` (8). Os bancos estão publicados no IP da tailnet (qualquer aparelho do Rômulo alcança a porta) e as do `espectro` também ficaram no histórico do GitHub (commit `955e5e1` só as tirou do `main`). As de `aladdin` (8, alfanumérica), `crm-silmer` (14) e o `MINIO` do iris (10) são melhores. **Trocar mexe no `infra-docker`: só com ordem do Rômulo** (fora do prompt). Valores não foram impressos nem gravados em lugar nenhum.

### Para depois do merge (cada instalação com `.bak-2026-10-04`)
1. **Merge** reinicia a Central ~0,5 s (`fluxos.ts`). Sonda a cada 0,5 s como nos PRs 5 e 6.
2. Instalar: `~/.local/bin/backup-dell` (o instalado == `main`: **conferido hoje**), `~/.config/backup-dell/fontes.toml`, `~/.local/bin/estrutura-coletar` (+x), `~/.config/systemd/user/estrutura-coletar.service` + `daemon-reload`.
3. **Primeira rodada à mão:** `backup-dell espelho --fonte estrutura --forcar` (fora do minuto do `silmer-drive-sync`); conferir `rclone lsf gdrive-estrutura:`, procurar segredo na área de preparo e em 2 ou 3 arquivos lidos com `rclone cat`, `backup-dell status`, `dell-status` mostrando `backup:estrutura`.
4. Avisar o Rômulo/agente do PC: o backup diário do PC (Anexo B5) já pode ser ligado (`mel:.local/share/mel/estrutura/pc-incoming/latest/`).

## Próximo passo

Merge do PR #7 (decisão do Rômulo); depois a instalação e a primeira rodada acima. Depois: Fase 6 (Entrada + cofre `age` + Hermes organiza), que também acrescenta `~/.config/mel/age/identity.txt` e `~/Mel/Cofre` aos `obrigatorios` do cofre.
