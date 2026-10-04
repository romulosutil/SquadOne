# Saída do Dell: o que o PC precisa clonar, e o que só existe aqui (04/10/2026)

Tudo abaixo foi conferido contra o GitHub **de verdade** (clone `--bare` ou `ls-remote`), não contra as referências locais, que estavam velhas. Comparações de conteúdo ignoram o fim de linha do Windows (CRLF), que fazia arquivos iguais parecerem diferentes.

## Resumo

| Projeto | GitHub | Commits sem push | Trabalho que só existe no Dell | Arquivado em |
|---|---|---|---|---|
| `aladdin` | `romulosutil/Aladdin` (privado) | 0 | `.env` (raiz, backend, frontend) | `aladdin.tar.zst` |
| `iris` | `romulosutil/Iris` (**público**) | 0 (mas o repositório local está danificado) | docs (16, com `docs/legal`), `.env*`, 4 arquivos de config | `iris.tar.zst` |
| `portfolio` (= `product_designer`) | `romulosutil/product_designer` (privado) | 0 | `.github/workflows/ci.yml` (329 B, não subiu) | `portfolio.tar.zst` |
| `espectro` | `romulosutil/espectro` (privado) | n/a (`.git` corrompido) | 4 docs (subiram em branch); `.env.local` | `espectro.tar.zst` |
| `port` | virou `product_designer` | n/a (sem commits) | `pdf_exports/`, `_to_delete/`, 7 docs, 4 versões de `ABOUT/ARCHITECTURE/RULES/agents.md` | `port.tar.zst` |
| `crm-silmer` (`~/crm-silmer`, clone vivo) | `romulosutil/crm-silmer` (**público**) | **46 commits em 12 branches** | todo o trabalho de 30/09 a 03/10 | `crm-silmer-*.bundle` |

## aladdin

- Origin `romulosutil/Aladdin`, branch `main` = `origin/main` (`6ea96469`), 0 commits sem push, 0 arquivos sujos, 0 branches com commit que o GitHub não tenha.
- O objeto `refs/stash` está corrompido (`bad object refs/stash`): efeito da réplica; não há stash a recuperar.
- Só aqui (ignorados pelo Git): `.env`, `backend/.env`, `frontend/.env`, `frontend/.env.local`. Estão no `aladdin.tar.zst` (permissão 600). O PC clona do GitHub e recria os `.env` a partir do tarball.

## iris

- Origin `romulosutil/Iris` (**repositório público**). Branch local `fix/pequenos-ajustes-2`, **sem upstream**, e o commit da ponta (`6c7ab238`) **não existe** no banco de objetos (`git fsck`: `invalid sha1 pointer`; também `refs/codex/turn-diffs/...` e a reflog). O GitHub não tem essa branch.
- Isso não perdeu código: comparando a pasta de trabalho com o `main` do GitHub (`545b548`, 10/09), só **4 arquivos** diferem de verdade: `AGENTS.md`, `CLAUDE.md`, `.agents/rules/graphify.md` e `.husky/pre-push`. Todo o código do produto é igual.
- Só aqui: `docs/` (16 arquivos, entre eles `docs/legal/*` com pareceres e briefings jurídicos e `docs/arquitetura/levantamento-controles-de-seguranca.md`), `.agents` (288 arquivos de skills), `ds-bundle` e `storybook-static` (gerados), `brag-output`, `scratch`, logs e os `.env`, `.env.local`, `.env.e2e`, `.env.bak-consent`.
- **Não subi nada para o Iris**: é público, e `docs/legal` e os `.env` não podem ir para lá. Está tudo no `iris.tar.zst`. Para o PC: clonar o GitHub e levar do tarball só o que quiser (`docs/`, `.env*`).

## portfolio (= `romulosutil/product_designer`)

- `main` = `origin/main` (`16cd6f1`), branch `feat/portfolio-review` também sem nada a mais que o GitHub. 0 commits sem push.
- Sujo: `.github/workflows/ci.yml` (329 B: roda `npm run check` e `npm run build` em push na `main` e em PR; os dois scripts existem no `package.json`). **Não subiu**: o GitHub recusou, porque o token do `gh` não tem o escopo `workflow`. Está no `portfolio.tar.zst`.

## espectro

- O `.git` local está corrompido; nenhum comando git que escreva foi rodado nele.
- **O manifesto dizia "30 arquivos mais novos que o GitHub". Não é verdade em conteúdo.** Ignorando CRLF: 469 arquivos comparáveis, só 2 diferem (`CLAUDE.md` e `.gitignore`, e nos dois o **GitHub** é o mais novo). `cmd/server/main.go`, `internal/clinic/drift.go`, `drift_test.go`, as migrations 042 a 044, `CalendarCard.vue`, `useClinic.ts` e `frontend/shared/types.ts` são **idênticos** ao GitHub; só mudava o fim de linha (CRLF local, LF no GitHub), o que fez a data de modificação parecer mais nova.
- Só no local: 4 docs úteis (`docs/daily-summary/2026-07-07.md` e `2026-07-08.md`, `docs/superpowers/plans/2026-05-06-collaborator-photo-upload.md` e `...history-empty-state.md`). **Subiram** para a branch `dell/docs-recuperados-2026-10-04` do repositório privado (commit `9089976`, 4 arquivos, sem segredo); a `main` não foi tocada (`955e5e1`).
- Não subiram, de propósito: `.env.local` (2) e `server.exe` (segredos e binário, já removidos do `main` em 04/10), 11 logs, `.superpowers/sdd/*` (40 arquivos de trabalho de agente) e os `.err`. Estão no `espectro.tar.zst`.
- Os arquivos do `espectro.tar.zst`: 59 MB, sem `node_modules`, `.gomodcache*`, `.gocache*`, `graphify-out`, `.nuxt`, `.output` e `bin` da raiz.
- `espectro-vs-github.diff`: o diff (sem CRLF) dos arquivos citados, dos 2 que diferem e dos 4 docs.

## port

- Sem commits (HEAD sem nascer) e sem remoto. Virou `product_designer` (263 commits no GitHub; `portfolio` é o clone). Só existem aqui: `pdf_exports/` (13 MB), `_to_delete/`, 7 dos 26 `docs/`, e versões diferentes de `ABOUT.md`, `ARCHITECTURE.md`, `RULES.md` e `agents.md`. Tudo em `port.tar.zst` (sem `node_modules`, `graphify-out`, `.output`, `dist`).

## crm-silmer (clone vivo `~/crm-silmer`)

> **CORREÇÃO (04/10, 15:40):** o texto abaixo diz que o `crm-silmer` tinha 46 commits só locais. Por conteúdo (`git cherry`), 43 já estão na `master` do GitHub com outro SHA; só 3 commits de docs do RFC 006 não estão. E a pasta antiga `Pessoal-dev/crm-silmer` NÃO era cópia velha: tinha 68 arquivos que não existem no GitHub (pacote em `crm-silmer-so-na-pasta-velha/`).

O prompt falava em **1 commit** só local (`fix/inbox-live-tests`). Confirmado contra o GitHub: são **46 commits em 12 branches** que o GitHub (público) não tem. O trabalho é de 30/09 a 03/10 (ficha v3 de sete pontos, itens do pedido, inbox, bot do n8n, RFC 006, ADRs).

| Branch | Commits |
|---|---|
| `feat/ficha-impressa-sete-pontos` | 13 |
| `feat/itens-com-os-sete-pontos` | 8 |
| `feat/pedido-abre-no-primeiro-ponto` | 8 |
| `feat/cliente-acompanha-contato` | 4 |
| `docs/rfc-006-decisoes-do-po` | 3 |
| `feat/conversa-nao-volta-para-o-bot` | 3 |
| `feat/bot-ficha-sete-pontos` | 2 |
| `fix/bot-arte-com-estampa`, `fix/chat-inbox-homologation`, `fix/imprimir-pedido`, `fix/inbox-list-scroll`, `fix/inbox-live-tests` | 1 cada |

- **Nada foi enviado ao GitHub** (repositório público). Backups: `crm-silmer-todas-as-branches.bundle` (8,8 MB, `--all`, verificado, `sha256` em `crm-silmer-bundles.sha256`) e `crm-silmer-inbox-live-tests.bundle` (o do prompt, só o commit `231064c`).
- Filtro de segredos nas linhas novas dos 46 commits: 119 arquivos, nenhum com nome sensível; 5 arquivos com palavras como `token`, `authorization`, `password`, todas referências a variáveis de ambiente, uma coluna SQL e variáveis de teste. Sem valor de segredo.
- `~/crm-silmer-wt/tecnica-e-arte`: 0 sujos.
- **Decisão do Rômulo:** publicar isso exige decidir antes se o repositório continua público (ver o relatório da fase).

## Corporativo-dev

- `corp/Corporativo-dev.tar.zst` (242 MB, sem `node_modules` e `graphify-out`) com `.sha256`, para o PC puxar por `scp`. A pasta não foi tocada.
- GitHub cobre (arquivos em comum): `ds_auditor` 100%, `p4fhub` 98%, `p4f` ↔ `p4f-site-institucional` 18%, `ds4fun` 0%. `databasepay4fun`, `Vera` e `pay4fun-p4f-landpage-cms-*` não existem no GitHub: só no tarball. Detalhes e o raciocínio estão no PR #5.

## Silmer (visão geral; o mapa completo está no relatório da fase)

- `Pessoal-dev/Silmer` **não é só o `silmer-web`**: 66% dos arquivos batem com `romulosutil/silmer-web`, e há 57 só locais (`social/` com 40, `crm/`, `post/`, `docs/`, `historico-datacrazy/` e um `_tmp_certificado`). O repositório `romulosutil/Silmer` (abril, React/Vite) é **outro projeto** (1% em comum). `Pessoal-dev/crm-silmer` é a cópia antiga do CRM, sem `.git`.
- Tarballs: `Pessoal-dev-Silmer.tar.zst` (75 MB) e `Pessoal-dev-crm-silmer.tar.zst` (11 MB).

## Conferência dos arquivos (todos com `sha256`, permissão 600, `tar -t` igual ao disco)

`port` 373 entradas, `espectro` 1140, `Pessoal-dev-crm-silmer` 1792, `Pessoal-dev-Silmer` 411, `Corporativo-dev` 983, `aladdin` 18764, `iris` 3893, `portfolio` 623. Zero avisos do `tar`.
