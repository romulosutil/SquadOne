# Silmer: Site, CRM e marketing

Atualizado em 04/10/2026. O cliente Silmer tem **três frentes** que moram em lugares diferentes. Os caminhos e repositórios de cada uma estão no registro (`PROJETOS.md`, seção "Silmer: mapa por frente"); este arquivo diz como elas se ligam, o que foi encontrado e como o PC traz cada uma.

## As três frentes

| Frente | O que é | Onde mora no Dell | GitHub | Como o PC pega |
|---|---|---|---|---|
| **Site** | O site da Silmer (monorepo: apps, packages, design tokens, Meta Pixel). Último push 23/09. | Espelho de leitura em `~/Mel/Repos/silmer-web` (nasce na Fase 4). Dev é no PC. | `romulosutil/silmer-web` (privado) | `git clone` |
| **Site (legado)** | Site antigo em React/Vite, abril de 2026. **Outro projeto**: só 1% dos arquivos em comum com o `silmer-web`. | Espelho em `~/Mel/Repos/Silmer` (Fase 4) | `romulosutil/Silmer` (privado) | `git clone`, se quiser o histórico |
| **CRM** | O CRM do cliente (pedidos, inbox, bot do n8n). | `~/crm-silmer` (clone vivo, branch `master`) e os worktrees em `~/crm-silmer-wt`. Banco: container `crm-silmer-postgres`, porta 5434 na tailnet. | `romulosutil/crm-silmer` (**público**) | `git clone` normal; só 3 commits de docs ficam no Dell (abaixo) |
| **Marketing** | Instagram: marca, planejamento, conteúdo por mês, relatório de Meta Ads, vídeos. | `~/Silmer`, sincronizada nos dois sentidos com o Drive (`gdrive-silmer:`) a cada 5 minutos | `romulosutil/silmer-calendario-mobile` (privado, novo) só para a página do calendário | Pelo próprio Drive |

Onde o site é **hospedado** e quem publica: não confirmei (o `README` do workspace antigo cita Vercel). Conferir antes de documentar.

## O CRM: o que está e o que não está no GitHub (corrigido em 04/10)

Uma 1ª versão deste arquivo dizia que o GitHub não tinha "46 commits em 12 branches". **Estava errado**: comparei por SHA, e o GitHub recebe os patches reescritos (o Codex na nuvem faz os merges). Por **conteúdo** (`git cherry`), 43 dos 46 já estão na `master`. O PC faz **clone normal**.

Só existe fora do GitHub:
1. **3 commits de docs do RFC 006** (`ba09ed5`, `b8c27c7`, `4c021a9`, de 30/09), na branch `docs/rfc-006-decisoes-do-po`, no bundle `~/Arquivo/2026-10-04/crm-silmer-todas-as-branches.bundle`. O 1º tem nomes de vendedores que o 3º remove: num repositório **público** isso exige reescrever antes de publicar.
2. **68 arquivos de trabalho da pasta antiga** `~/Pessoal-dev/crm-silmer` (que mandei para a lixeira achando que era cópia velha; foi editada até 03/10 03:08): 8 que a pasta viva nem tem (RFC 006 de estampa e Dropbox, 2 PDFs da ficha v3, 2 testes, 1 componente Vue) e 60 versões diferentes (~14% das linhas, nos arquivos amostrados, não existem na viva). Pacote de revisão em `~/Arquivo/2026-10-04/crm-silmer-so-na-pasta-velha/`. É provável que boa parte seja versão intermediária da ficha v3, superada pelo v4 que a `master` já tem; quem decide é você ou a sessão do CRM.

## A pasta de marketing já tem dono e regras: não foi mexida

`~/Silmer` tem um `AGENTS.md` com **mapa da pasta e regras fixas**, e a regra diz: *"Não mova nem renomeie arquivos ou pastas existentes, porque roteiros e a sincronização com o Drive dependem dos caminhos"* e *"Não mexa em `.sync-conflicts/` nem em `silmer-calendario-mobile/`"*. Os guias (`direcao.md`, `criacao.md`, `design.md/`, `estilo.md`) citam por caminho `Outubro/Política/`, `Outubro/Fotos/`, `Setembro/Outubro Rosa/`, `output/…`, `brand.svg` e o planejamento. Reorganizar quebraria o fluxo dos agentes e exigiria reescrever cerca de 50 referências. Por isso **nenhum arquivo foi movido**.

O que foi só **observado**:
- **Repetições:** 41 grupos de arquivos idênticos (114 MB). As maiores, `Politica/` e `drive-download-…/` (e o `.zip`), já estão documentadas no `AGENTS.md` como cópias de `Setembro/política`. Os dois `.zip` de stories iguais em `output/dia-03-v3/` (15,7 MB) e `lula-photo.png` em três pastas de `output/` não estão.
- **`.sync-conflicts/`:** 4 imagens (`silmer-zema|lula|cury|flavio-politica.png`), versões guardadas quando Drive e Dell divergiram. O `AGENTS.md` manda não mexer; ninguém decidiu qual vale.
- **`.git`, `.agents`, `.codex`** na raiz: vazios, vieram do sandbox do Codex e ficam fora do sincronismo (o script exclui `**/.git/**`, `.agents` e `.codex`).
- **`silmer-calendario-mobile/`** tem um `.git` com 1 commit. Como o sincronismo exclui `.git`, ele **não** vai ao Drive. O commit foi enviado a um repositório privado novo, pela URL, sem gravar remoto na pasta.
- **Sincronismo:** `--max-delete 10` é **em porcentagem** (10% de 249 arquivos = 24). Mover mais do que isso faz o bisync abortar, e a rodada seguinte faz `--resync`, que traria de volta os caminhos antigos do Drive. Mexer na estrutura só com ordem sua, parando antes o `silmer-drive-sync.timer`.

## O que ainda falta decidir

1. **`crm-silmer`:** o que fazer com os 3 commits de docs do RFC 006 (reescrever sem os nomes antes de publicar, ou deixar só no bundle) e se algo dos 68 arquivos da pasta velha vale rever. O repositório é público: se algum deploy o baixa sem credencial, torná-lo privado quebra o deploy.
2. **As 4 imagens de `.sync-conflicts`:** qual versão vale? (Só se quiser limpar; hoje não atrapalha.)
3. **Onde o site é hospedado** e quem publica, para constar aqui.
