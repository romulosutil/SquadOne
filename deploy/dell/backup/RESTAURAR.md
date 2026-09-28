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
- **`sqlite/.hermes/…`:** cópias consistentes dos bancos do Hermes. Com o
  Hermes parado, copie cada uma para o lugar de origem, sem os `-wal`/`-shm`
  antigos.

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
