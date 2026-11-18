# Backup do Dell para o Google Drive

Desde 28/09/2026. O PC queimou em 25/09 e com ele o único caminho até o Drive
(Syncthing → `G:\Meu Drive\auto`). O Dell virou a única cópia dos sites, do
PRUMO, do n8n e do Hermes; este backup devolve uma cópia fora dele.

## O que vai para onde

```
Meu Drive/
├── PRUMO/                       o negócio (o PRUMO é dono de tudo)
│   ├── Sites antes da venda/    espelho de ~/auto-site, a cada hora
│   ├── Consultoria/             espelho de ~/prumo (romulosutil/prumo), diário
│   └── _lixeira/<fonte>/<AAAA-MM-DDTHH>/   o que o espelho apagou ou trocou (30 dias)
├── Backups/dell-worker/restic/  cofre cifrado, diário às 03:30
└── Estrutura/                   o mapa e as configurações da Mel e do PC, sem segredo (remote gdrive-estrutura)
    ├── dell/                    gerado todo dia às 4h pelo estrutura-coletar
    ├── pc/                      enviado pelo PC, passando pelo Dell
    └── _lixeira/estrutura/<AAAA-MM-DDTHH>/   o que o espelho trocou (30 dias)
```

- **Espelho:** legível no Drive e no PC novo, **só leitura**. O Dell é a
  verdade: editar ou apagar no Drive é desfeito na rodada seguinte (a versão
  anterior vai para a `_lixeira`).
- **Cofre:** restic cifrado com a home inteira menos o que se reinstala, mais
  dumps consistentes (Postgres do n8n, pasta `/home/node/.n8n` do container,
  cada banco Docker dos projetos desde 06/10/2026: aladdin, crm-silmer, p4f e
  iris em `pg_dumpall`, o MinIO do iris em tar, o MySQL do espectro,
  7 SQLite do Hermes). Leva os segredos, por isso é cifrado. Refaz o Dell.
- **Estrutura:** espelho (só dell/ e pc/) do que descreve a operação: manifesto,
  projetos, units do systemd, `docker-compose` (sem as senhas), fluxos do n8n,
  repositórios, estado da rede. É o destino final de tudo que o Rômulo lê pelo
  PC. **Sem segredos**: ver o filtro abaixo.
- **Ensaio:** depois do cofre, quando o último ensaio tem mais de 30 dias,
  restaura o essencial numa pasta à parte e sobe um Postgres e um n8n
  descartáveis, sem rede, para provar que as credenciais do n8n decifram com a
  chave do cofre. O resultado chega pela fila de avisos do dell-status; o de falha leva a chave
  `backup-dell:ensaio-falhou` (um por 24 h), para um ensaio que falha todo dia não
  virar uma mensagem por dia.

Tudo vem de `fontes.toml`. **Fonte nova = bloco novo no manifesto**; o runner
`backup-dell.py` não conhece fonte pelo nome.

## Alertas

O runner grava `~/.local/state/backup-dell/status.json`, e o `dell-status` cria
um `backup:<fonte>` por fonte, pela idade do último sucesso:

- **Espelho:** rodada ruim isolada vira `atencao` (só na Central). Mais de
  3 h sem sucesso (30 h na consultoria) também é `atencao`, e mais de 24 h
  (72 h) vira `falha`, com o "Quebrou" do dell-status pelo Telegram (o WhatsApp do Hermes só entra de
  reserva, se o bot falhar; desde 16/10/2026).
- **Cofre:** mais de 50 h sem sucesso, ou `restic check` falho, vira `falha`.
  Dump de banco que falhou (n8n ou projeto: todo `postgres`/`mysql`, e o que
  tiver `critico = true`) também é `falha`. Arquivo `obrigatorios` sumido ou
  rodada com mais de 500 MB novos viram `atencao`.
- **Ensaio:** com mais de 35 dias, `atencao`.
- **Estrutura** (`backup:estrutura`): `atencao` com mais de 30 h sem sucesso,
  `falha` com mais de 72 h. Coletor que falha (segredo achado, manifesto
  ausente) também vira `falha`, com a causa no detalhe.

## Decisões que não são óbvias

- **Downloads do acesso remoto do Claude ficam fora do cofre.** As pastas
  `~/.claude/remote/ccd-cli`, `plugins` e `srv` contêm binários e plugins que
  o cliente baixa novamente. Em 18/10/2026 acrescentaram cerca de 376 MB numa
  rodada e dispararam o alerta de volume. Históricos de sessões, configurações
  e dumps consistentes continuam incluídos. A exclusão só vale para novas
  rodadas; não remove snapshots anteriores.

- **Estrutura: o filtro de segredos é o centro do bloco.** O
  `estrutura-coletar.py` copia só o que está numa lista de permissão e passa
  tudo por um filtro (valor de `CHAVE=`, `senha:`, URL com senha, Bearer,
  prefixos como `ghp_`, cadeias de alta entropia → `<oculto>`; chave privada
  exclui o arquivo; fluxo do n8n com segredo é excluído, nunca remendado).
  Além das regras há uma **prova**: os valores de verdade dos `.env` e do
  `rclone.conf` são carregados em memória, e a coleta falha se qualquer um
  aparecer no que vai para o Drive. O relatório (`dell/COLETA.md`) lista
  arquivos e regras, nunca valores. Falhou, nada é enviado.
  - Os testes usam só segredos falsos, montados em tempo de execução.
  - `.env`, `auth.json`, `rclone.conf`, chaves privadas e bancos nunca entram.
- **Estrutura mora na raiz de um remote próprio.** O remote `gdrive` (escopo
  `drive.file`) não enxerga pasta criada à mão, então `gdrive-estrutura` é uma
  cópia do `gdrive-silmer` só com o `root_folder_id` trocado. No bloco:
  `incluir = ["/dell/**", "/pc/**"]` deixa intocado o que o dono guardar fora
  dessas pastas, e é o que permite a `_lixeira` morar dentro da mesma pasta sem
  o `rclone` reclamar de sobreposição com o destino.
- **`janela` e `preparo` por bloco.** `janela = ["04:00", "06:00"]` faz um
  bloco diário rodar de madrugada mesmo com o timer de hora em hora; com ela o
  `intervalo_h` é 10 e não 24, senão uma rodada manual no meio do dia empurraria
  o dia seguinte para fora da janela (o bloco só roda com o intervalo vencido
  **e** o relógio na janela: uma rodada manual às T h exige T + 10 ≤ 06:00, ou
  seja, até as 20h; com 12 h o limite era 18h e a rodada de 04/10 às 18:23 fez a
  coleta de 05/10 não rodar). `preparo` roda antes do sync; se falhar, não
  sincroniza.
- **O coletor tem unidade própria** (`estrutura-coletar.service`): o
  `backup-dell-espelho.service` tem `NoNewPrivileges`, que impede o `sudo ufw
  status` do coletor. O espelho o chama com `systemctl --user start`.
- **`remoto` e `lixeira` por bloco**, com o de `[geral]` como padrão: os blocos
  antigos não mudam.

- **Escopo do rclone:** `drive.file`, com cliente OAuth próprio publicado em
  produção. Em modo de teste o token expira a cada 7 dias.
  - O rclone só vê o que ele mesmo criou: um defeito não alcança o resto do
    Drive.
  - Pastas criadas à mão com o mesmo nome ficam invisíveis para ele, e ele
    criaria outras. Não crie `PRUMO/` à mão.
- **Sentinela** (`CLAUDE.md`, `README.md`) e `max_apagar`: origem vazia ou
  desmontada não apaga o espelho.
  - Mover muitos leads de uma vez passa do limite de propósito. Confira e
    rode `backup-dell espelho --fonte sites --sem-limite`.
- **Gerador escrevendo** (`.logs/gerador.lock` com menos de 4 h): o espelho dos
  sites fica "adiado" e tenta na hora seguinte.
- **Trava única** para espelho, cofre e ensaio: o rclone regrava o
  `rclone.conf` quando o token renova.
- **Lixeira apagada pela data no nome da pasta:** o arquivo movido guarda a
  data original, então `--min-age` apagaria na hora.
- **Manutenção sozinha:**
  - `forget --prune` (7 diários, 4 semanais, 6 mensais) + `check` a cada 7
    dias;
  - `check --read-data-subset=<mês>/12` a cada 30 (o repositório inteiro é
    lido em um ano);
  - `rclone check` por MD5 do espelho a cada 7.

## Instalação

```bash
# Ferramentas: restic do apt; rclone do .deb oficial (o do apt é antigo demais).
sudo apt install restic
V=$(curl -fsSL https://downloads.rclone.org/version.txt | awk '{print $2}')
curl -fsSLO "https://downloads.rclone.org/$V/rclone-$V-linux-amd64.deb"
curl -fsSL "https://downloads.rclone.org/$V/SHA256SUMS" | grep " rclone-$V-linux-amd64.deb$" | sha256sum -c -
sudo apt install "./rclone-$V-linux-amd64.deb"

# Cliente OAuth "App para computador" no Google Cloud (Drive API ativa, app em
# produção). O JSON baixado fica fora do Git.
rclone config create gdrive drive scope=drive.file use_trash=false \
  client_id=<id> client_secret=<segredo>      # autoriza no navegador do Dell

install -m 755 deploy/dell/backup/backup-dell.py ~/.local/bin/backup-dell
install -d -m 700 ~/.config/backup-dell
install -m 600 deploy/dell/backup/fontes.toml ~/.config/backup-dell/fontes.toml
backup-dell iniciar          # pastas no Drive, repositório restic e kit de recuperação

# Estrutura: o remote é a cópia do gdrive-silmer com a raiz na pasta Estrutura (não precisa de
# login novo). Copie a seção [gdrive-silmer] do rclone.conf para [gdrive-estrutura] e troque SÓ o
# root_folder_id, segurando a trava do backup (flock ~/.local/state/backup-dell/trava) e fora do
# minuto do silmer-drive-sync. Nunca imprima o conteúdo do arquivo.
install -m 755 deploy/dell/backup/estrutura-coletar.py ~/.local/bin/estrutura-coletar
cp deploy/dell/backup/estrutura-coletar.service ~/.config/systemd/user/ && systemctl --user daemon-reload
install -d -m 700 ~/.local/share/mel/estrutura/pc-incoming    # onde o PC deixa o backup dele
```

`iniciar` grava `~/.config/backup-dell/KIT-DE-RECUPERACAO.txt`, com as duas
senhas do cofre. **Copie para o gerenciador de senhas e para o papel e apague
o arquivo.** Sem uma delas o cofre não abre, nem para você. A senha 1 fica no
Dell (`restic.senha`, modo 600) para as rodadas; a senha 2 só existe com você.

Primeiras rodadas, à mão e conferidas, antes de ligar os timers:

```bash
backup-dell espelho --dry-run            # revisar o que vai subir
backup-dell espelho --forcar             # primeiro envio (~3.000 arquivos, 25–40 min)
backup-dell cofre                        # primeiro cofre (~2,3 GB lidos) e ensaio
backup-dell status
cp deploy/dell/backup/backup-dell-*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now backup-dell-espelho.timer backup-dell-cofre.timer
```

## No dia a dia

- `backup-dell status`: último sucesso de cada fonte.
- `journalctl --user -u backup-dell-espelho -n 50` (ou `-cofre`): o que a
  rodada disse.
- `backup-dell ensaio`: prova a restauração agora.
- **Fonte nova:** um bloco `[[espelho]]` (ou uma regra em `[cofre]`) em
  `fontes.toml`. Depois:
  `install -m 600 deploy/dell/backup/fontes.toml ~/.config/backup-dell/fontes.toml`.
- **Restaurar:** `RESTAURAR.md`.
