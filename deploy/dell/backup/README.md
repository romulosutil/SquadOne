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
└── Backups/dell-worker/restic/  cofre cifrado, diário às 03:30
```

- **Espelho:** legível no Drive e no PC novo, **só leitura**. O Dell é a
  verdade: editar ou apagar no Drive é desfeito na rodada seguinte (a versão
  anterior vai para a `_lixeira`).
- **Cofre:** restic cifrado com a home inteira menos o que se reinstala, mais
  dumps consistentes (Postgres do n8n, pasta `/home/node/.n8n` do container,
  7 SQLite do Hermes). Leva os segredos, por isso é cifrado. Refaz o Dell.
- **Ensaio:** depois do cofre, quando o último ensaio tem mais de 30 dias,
  restaura o essencial numa pasta à parte e sobe um Postgres e um n8n
  descartáveis, sem rede, para provar que as credenciais do n8n decifram com a
  chave do cofre. O resultado chega pelo WhatsApp.

Tudo vem de `fontes.toml`. **Fonte nova = bloco novo no manifesto**; o runner
`backup-dell.py` não conhece fonte pelo nome.

## Alertas

O runner grava `~/.local/state/backup-dell/status.json`, e o `dell-status` cria
um `backup:<fonte>` por fonte, pela idade do último sucesso:

- **Espelho:** rodada ruim isolada vira `atencao` (só na Central). Mais de
  3 h sem sucesso (30 h na consultoria) também é `atencao`, e mais de 24 h
  (72 h) vira `falha`, com WhatsApp pelo Hermes.
- **Cofre:** mais de 50 h sem sucesso, ou `restic check` falho, vira `falha`.
  Dump do n8n que falhou também é `falha`. Arquivo `obrigatorios` sumido ou
  rodada com mais de 500 MB novos viram `atencao`.
- **Ensaio:** com mais de 35 dias, `atencao`.

## Decisões que não são óbvias

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
