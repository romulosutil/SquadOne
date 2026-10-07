# Restaurar o Dell a partir do cofre

Precisa de: uma das duas senhas do kit de recuperação, acesso à conta Google
(sutil.romulo@gmail.com) e uma máquina Linux com `restic` e `rclone`.

## 1. Chegar ao repositório

**Com o Dell de pé**, é o remote de sempre:

```bash
export RESTIC_REPOSITORY=rclone:gdrive:Backups/dell-worker/restic
export RESTIC_PASSWORD_FILE=~/.config/backup-dell/restic.senha
restic snapshots
```

**Sem o Dell** (máquina nova), há dois jeitos:

- **Remote novo:** crie um remote com escopo `drive` (não `drive.file`: o
  cliente novo não "criou" os arquivos e não os veria) e use
  `RESTIC_REPOSITORY=rclone:<remote>:Backups/dell-worker/restic`.
- **Pelo Drive para Desktop:** espere
  `Meu Drive/Backups/dell-worker/restic` baixar inteiro e use
  `restic -r "<caminho local da pasta>"`.

Nos dois casos, a senha vem do kit
(`read -s RESTIC_PASSWORD && export RESTIC_PASSWORD`).

## 2. Ver e restaurar

```bash
restic snapshots --host dell-worker
restic ls latest /home/romulo-sutil-corr-a/.hermes/memories   # conferir antes
restic restore latest --target /tmp/restaurado \
  --include /home/romulo-sutil-corr-a/auto-site          # um pedaço
restic restore latest --target /                          # a home inteira (máquina nova)
```

Restaure **em pasta à parte** e copie o que precisa. Restaurar por cima de uma
home viva mistura estados.

## 3. Os dumps (em `~/.local/state/backup-dell/preparo/`)

- **`n8n.sql`:** o banco do n8n (fluxos, execuções, credenciais cifradas).
  - Com o Compose novo de pé (`~/licitacoes-automation`, o `.env` restaurado
    e o mesmo `N8N_ENCRYPTION_KEY`), pare o n8n e carregue o dump:
    `docker compose exec -T db psql -U "$POSTGRES_USER" -d n8n < n8n.sql`.
  - Suba o n8n de novo. Sem a mesma chave, as credenciais não abrem.
- **`n8n-home.tar`:** a pasta `/home/node/.n8n` do container (o `config` tem a
  `encryptionKey`; `nodes/` guarda os pacotes da comunidade).
  - `docker compose run --rm -T --entrypoint tar n8n -C /home/node/.n8n -xf - < n8n-home.tar`
- **Bancos dos projetos** (desde 06/10/2026), um arquivo por `[[cofre.preparo]]`:
  - `aladdin-pg.sql`, `crm-silmer-pg.sql`, `p4f-db.sql`, `iris-pg.sql`:
    `pg_dumpall` do cluster inteiro (todos os bancos e os papéis, com o hash das
    senhas). Suba o compose do projeto com um volume **novo** e carregue no banco
    `postgres`; os erros "role … already exists" do usuário que o próprio
    container criou são esperados:
    `docker compose exec -T <servico> sh -c 'psql -U "$POSTGRES_USER" -d postgres' < aladdin-pg.sql`.
  - `espectro-mysql.sql`: `mysqldump` de todos os bancos menos os de sistema
    (o usuário do app o compose recria a partir do `.env`):
    `docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' < espectro-mysql.sql`.
  - `iris-minio.tar`: a pasta `/data` do MinIO (buckets e `.minio.sys`). Com o
    MinIO parado e o volume novo:
    `docker run --rm -i --volumes-from <container do minio> --entrypoint tar postgres:17-alpine -C /data -xf - < iris-minio.tar`.
  - Prova sem tocar o banco vivo: `backup-dell ensaio-dump <nome>` faz um dump
    novo, carrega num container descartável da mesma imagem, sem rede, e
    compara as linhas de cada tabela com o banco vivo.
- **`sqlite/.hermes/…`:** cópias consistentes dos bancos do Hermes. Com o
  Hermes parado, copie cada uma para o lugar de origem, sem os `-wal`/`-shm`
  antigos.
- **Finanças** (não é dump do preparo: já vem na home): a
  `~/.local/share/squadone-operations/financas.copia.db` é a foto que o
  SquadOne grava com `VACUUM INTO` depois de cada leitura da Pluggy. O
  `financas.db` vivo fica fora do cofre. Com o `squadone-operations` parado:
  `install -m 600 financas.copia.db financas.db` na mesma pasta, sem `-wal`/`-shm`
  antigos. O que faltar desde a cópia volta na próxima leitura da Pluggy; só a
  fatura em PDF importada depois dela precisa ser reimportada.

## 4. Depois de restaurar

- O Syncthing volta com as chaves de `~/.local/state/syncthing` (mesmo ID de
  aparelho).
- O WhatsApp do Hermes (`~/.hermes/whatsapp/session`) é "melhor esforço". Se
  não reconectar, pareie de novo.
- O `rclone.conf` restaurado tem o token do Drive. Se o cliente OAuth foi
  revogado, rode `rclone config reconnect gdrive:`.
- Reinstale o que o cofre não leva de propósito: `~/.hermes/hermes-agent`,
  venvs, `node_modules` e navegadores.
- Rode `backup-dell ensaio` e `dell-status --stdout` para conferir.
