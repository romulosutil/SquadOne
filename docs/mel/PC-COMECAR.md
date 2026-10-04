# PC: como começar (04/10/2026)

Para o Rômulo e para o agente do PC (Antigravity). O Dell é a **Mel**: aqui você só puxa; o trabalho é no PC. Os comandos são do PowerShell.

## Pode começar? Sim, quase tudo já

| O quê | Pode agora? | Observação |
|---|---|---|
| Clonar os repositórios do GitHub | **Sim** | Seção 1 |
| Corp (`Corporativo-dev`) | **Sim** | Tarball pronto; seção 2 |
| `crm-silmer` | **Sim, clone normal** | Seção 3. A `master` do GitHub já tem o trabalho de 30/09 a 03/10; só 3 commits de docs ficam no Dell |
| `.env`, `docs` e `agent-context` que não estão no GitHub | **Sim** | Seção 4 |
| Grafos do graphify | **Sim** | Seção 5 (`scp -r mel:Mel/Grafos`) |
| Marketing do Silmer | **Sim, pelo Drive** | Seção 6 |
| Chave do `age` | Pode gerar já | Só será usada na Fase 6 (seção 7) |
| Backup diário do PC para a `Estrutura` | **Espere o aviso** | Depende da pasta `pc-incoming`, que a Fase 5 cria hoje (seção 8) |

## Configuração do PC (uma vez)

1. **SSH:** `ssh mel hostname` deve responder `romulo-sutil-corr-a-Latitude-7420`. (Já funciona: chave `jarvis-pc-2`, passphrase no `ssh-agent`.) O Dell só aceita chave.
2. **GitHub:** repositórios privados pedem login. `gh auth login` (HTTPS) ou o Git Credential Manager. Teste: `gh repo list romulosutil --limit 3`.
3. **Git:** use o mesmo nome e e-mail de antes (`git config --global user.name` e `user.email`).
4. **`.zst`:** teste `tar --version`. Se o `tar` do Windows não abrir `.tar.zst`, instale o `zstd` (`winget search zstd`).
5. **Pastas:** `Dev\Corp` e `Dev\Pessoal`, **fora** de qualquer pasta sincronizada com Drive. Git dentro de pasta sincronizada estraga o repositório.
6. **Antes de criar pasta ou clonar algo novo,** leia `PROJETOS.md` (`scp mel:PRUMO/PROJETOS.md .`): um caminho por projeto.

## 1. Clonar do GitHub

São 46 repositórios (os arquivados e forks ficam de fora). Os 4 do Corp vão para `Dev\Corp`, o resto para `Dev\Pessoal`. O `crm-silmer` entra como os outros (seção 3 tem os detalhes).

```powershell
$dono = "romulosutil"
$corp = "ds4fun","ds_auditor","p4fhub","p4f"
New-Item -ItemType Directory -Force Dev\Corp, Dev\Pessoal | Out-Null
gh repo list $dono --limit 200 --json name,isArchived,isFork --jq '.[] | select(.isArchived|not) | select(.isFork|not) | .name' |
  ForEach-Object {
    $pasta = if ($corp -contains $_) { "Dev\Corp" } else { "Dev\Pessoal" }
    if (-not (Test-Path "$pasta\$_")) { gh repo clone "$dono/$_" "$pasta\$_" }
  }
```

- `product_designer` é o que o PC antigo chamava de `portfolio`. O `port` do GitHub é outro repositório (vazio).
- `espectro`: o GitHub tem tudo. Os 4 documentos que só existiam no Dell estão na branch `dell/docs-recuperados-2026-10-04`.

## 2. Corp: o que não está no GitHub

`Corporativo-dev` é da Pay4Fun: confira a política da empresa antes de copiar para outro lugar. O tarball (242 MB, sem `node_modules`) traz 5 projetos que **não** são o que o GitHub tem:

```powershell
scp mel:Arquivo/2026-10-04/corp/Corporativo-dev.tar.zst .
scp mel:Arquivo/2026-10-04/corp/Corporativo-dev.tar.zst.sha256 .
$esperado = (Get-Content Corporativo-dev.tar.zst.sha256).Split(' ')[0]
(Get-FileHash Corporativo-dev.tar.zst -Algorithm SHA256).Hash.ToLower() -eq $esperado   # tem que dar True
mkdir Dev\_origem | Out-Null
tar --zstd -xf Corporativo-dev.tar.zst -C Dev\_origem
$o = "Dev\_origem\Corporativo-dev"
Move-Item "$o\ds4fun" "Dev\Corp\ds4fun-completo"
Move-Item "$o\p4f-site-institucional","$o\databasepay4fun","$o\Vera","$o\pay4fun-p4f-landpage-cms-c56450cf8060" Dev\Corp\
```

- **`ds4fun` e `p4f` do GitHub não são essas pastas** (o GitHub cobre 0% do `ds4fun` e 18% do `p4f-site-institucional`). Por isso a pasta do tarball entra como `ds4fun-completo` e `p4f-site-institucional`, e as do GitHub ficam como `ds4fun` e `p4f`.
- `ds_auditor` (100%) e `p4fhub` (98%) são iguais ao GitHub: use os clones da seção 1 e ignore as cópias do tarball.
- `databasepay4fun`, `Vera` e `pay4fun-p4f-landpage-cms-*` só existem no tarball.

## 3. `crm-silmer`

**Clone normal do GitHub** (já feito pelo laço da seção 1). Conferido por **conteúdo** em 04/10: dos 46 commits que o Dell tinha em branches locais, **43 já estão na `master`** do GitHub (o Codex na nuvem faz os merges lá, com outros SHAs). Uma 1ª versão deste guia dizia "46 commits só no Dell": estava errada.

O que de fato só existe no Dell:
- **3 commits de docs do RFC 006** (decisões do PO, ADR 009, "drop seller names"), na branch `docs/rfc-006-decisoes-do-po`, em `crm-silmer-todas-as-branches.bundle`. O repositório é **público** e o 1º commit tem os nomes de vendedores que o 3º tira: **não publique o histórico como está**; revise antes.
- **68 arquivos de trabalho da pasta antiga** `Pessoal-dev/crm-silmer` (editada até 03/10), que não estão em nenhum ponto do GitHub: pacote de revisão de 2,3 MB em `~/Arquivo/2026-10-04/crm-silmer-so-na-pasta-velha/` (`LEIA-ME.md`, `arquivos/`, `versoes-da-velha/` e `velha-contra-viva.diff`). Para trazer: `scp -r mel:Arquivo/2026-10-04/crm-silmer-so-na-pasta-velha .`

## 4. O que só existe no Dell (`.env`, docs, `agent-context`)

**Extraia só os arquivos listados, nunca o tarball inteiro por cima de um clone:** ele traz o `.git` antigo (corrompido no `iris` e no `espectro`) e estraga o clone novo. Cada tarball tem `.sha256` ao lado (`scp mel:Arquivo/2026-10-04/<nome>.tar.zst .` e `...sha256`).

```powershell
# na mesma pasta onde está a pasta Dev:
scp mel:Arquivo/2026-10-04/aladdin.tar.zst mel:Arquivo/2026-10-04/iris.tar.zst mel:Arquivo/2026-10-04/espectro.tar.zst mel:Arquivo/2026-10-04/agent-context.tar.zst .
cd Dev\Pessoal
tar --zstd -xf ..\..\aladdin.tar.zst   aladdin/.env aladdin/backend/.env aladdin/frontend/.env aladdin/frontend/.env.local
tar --zstd -xf ..\..\iris.tar.zst      iris/.env iris/.env.local iris/.env.e2e iris/.env.bak-consent iris/docs/legal
tar --zstd -xf ..\..\espectro.tar.zst  espectro/.env.local espectro/frontend/clinic/.env.local
tar --zstd -xf ..\..\agent-context.tar.zst --exclude=agent-context/.git      # sem GitHub: a pasta inteira, sem o .git inválido
```

- Os `.env` são segredos: ficam no PC, **nunca** no Git nem no Drive.
- O **Iris é público**: `docs/legal` (pareceres e briefings jurídicos) e os `.env*` não estão no GitHub. Confira o `git status` antes de qualquer commit.
- `portfolio.tar.zst` só tem a mais o `.github/workflows/ci.yml` (329 bytes, não subiu ao GitHub porque o token do `gh` do Dell não tem o escopo `workflow`; no PC, se quiser, é só copiar).
- `Pessoal-dev-Silmer.tar.zst` (a pasta antiga do Silmer) tem 57 arquivos que o `silmer-web` não tem: `social/` (40), `crm/`, `post/`, `docs/`, `historico-datacrazy/` e `_tmp_certificado` (um certificado: **não vá para o Git**).
- `port.tar.zst` guarda `pdf_exports/`, `_to_delete/` e 7 docs da pasta antiga `port`.

## 5. Grafos do graphify (de todos os repositórios)

O Dell atualiza os grafos todo dia às 03:00. O PC **só lê**: nunca rode o graphify no Windows (os `CLAUDE.md` dos repositórios mandam isso).

```powershell
scp -r mel:Mel/Grafos Dev\_grafos        # ~200 MB na primeira vez. A pasta Dev\_grafos NÃO pode existir ainda (se existir, o scp aninha: Dev\_grafos\Grafos)
Get-Content Dev\_grafos\indice.json      # nome, nós e quando foi atualizado
```

Cada `Dev\_grafos\<nome>\graphify-out\` vai para `Dev\<Corp|Pessoal>\<nome>\graphify-out\` (é onde os `CLAUDE.md` mandam ler). Exceções de nome: `corp-ds4fun` → `Dev\Corp\ds4fun-completo`, `corp-p4f-site-institucional`, `corp-databasepay4fun`, `corp-vera` e `corp-pay4fun-p4f-landpage-cms` → a pasta com o mesmo final em `Dev\Corp`. `auto-site` não tem pasta no PC. O `global-graph.json` (88 MB) responde perguntas que cruzam projetos.

## 6. Marketing do Silmer

É a pasta `Silmer` do Drive (sincronizada com o Dell a cada 5 minutos). Ela tem um `AGENTS.md` com o mapa e uma regra: **não mover nem renomear** nada, porque os roteiros e a sincronização dependem dos caminhos. O site (`silmer-web`) e o CRM (`crm-silmer`) estão nas seções 1 e 3.

## 7. `age` (para a Fase 6)

```powershell
winget install FiloSottile.age
mkdir $env:USERPROFILE\.config\age
age-keygen -o $env:USERPROFILE\.config\age\key.txt
```

Cole para mim **só a linha `age1…`** (pública). A privada (`key.txt`) fica fora do Drive e do Git, com cópia no gerenciador de senhas. Serve para você decifrar no PC o que a Mel guardar no cofre, mesmo se a Mel morrer.

## 8. Backup diário do PC

Espere o meu aviso (fim da Fase 5). O destino será `mel:.local/share/mel/estrutura/pc-incoming/` e o conteúdo, por lista de permissão: `~/.ssh/config` (nunca chaves nem `known_hosts`), `settings.json` e `keybindings.json` do editor, `code --list-extensions`, `winget export`, o perfil do PowerShell, a lista de repositórios em `Dev\` com `git remote -v` e `git status -sb`, e a exportação da tarefa agendada. Nunca: chave privada, `.env`, tokens, a chave do `age`, dados de navegador. A especificação completa está no Anexo B5 de `PROMPT-MEL.md`.

## Regras no PC

- **Remote-SSH:** abra uma pasta de projeto específica, nunca `~`.
- **Nunca** imprima chave privada, token nem `.env` em tela, log ou mensagem.
- Código vai por Git, material pelo Drive, nada fica aberto para a internet.
- Dúvida sobre onde algo mora: `PROJETOS.md` (e `SILMER.md` para o Silmer).

## O que ainda não está pronto

- **Publicar os 46 commits do `crm-silmer`:** decisão sua (o repositório é público).
- **A pasta `Estrutura` no Drive** (Fase 5, em andamento hoje) e o **cofre e a Entrada** (Fase 6).
- **O Hermes criar rascunhos de automação:** decidido, ainda não feito.
