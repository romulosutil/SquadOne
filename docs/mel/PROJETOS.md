# Projetos da Mel: um caminho por projeto

**Gerado** de `~/SquadOne/deploy/hermes/projetos.toml`: para mudar algo, edite o TOML (por pull request) e gere de novo com
`python3 deploy/hermes/scripts/projetos_verificar.py --md > ~/PRUMO/PROJETOS.md`. Não edite este arquivo.

Regras, para qualquer agente (Claude, Codex, Hermes), no Dell e no PC:

1. **Antes de criar pasta ou clonar, leia este registro.** Se o projeto existe, trabalhe nele; nada de "outra cópia ao lado".
2. **Projeto novo entra no registro primeiro.** Só depois nasce a pasta.
3. **Cópia de leitura é espelho** e ninguém edita nela.
4. **Para guardar uma versão, use `~/Arquivo/<AAAA-MM-DD>`**, nunca uma pasta ao lado. Descarte vai para a lixeira (`gio trash`), nunca `rm`.

`Grafo` diz se o graphify lê a pasta. `Dono`: Rômulo edita; Hermes é a Mel mantendo sozinha.

## Silmer: mapa por frente

| Parte | Projeto | Caminho | Repositório | Papel |
|---|---|---|---|---|
| CRM | **crm-silmer** | `~/crm-silmer` | `romulosutil/crm-silmer` | O CRM do cliente Silmer (branch master; banco no container crm-silmer-postgres, porta 5434 na tailnet). Os worktrees de ~/crm-silmer-wt são deste mesmo repositório. |
| Marketing | **Silmer** | `~/Silmer` | — | Marketing do cliente Silmer (marca, planejamento do Instagram, conteúdo por mês, relatório de Meta Ads, vídeos), sincronizado nos dois sentidos com o Drive a cada 5 minutos (silmer-drive-sync). |
| Marketing | **silmer-calendario-mobile** | `~/Silmer/silmer-calendario-mobile` | — | Página estática do calendário de Instagram de outubro (dist/ com o PDF). Só o resultado publicado; sem código-fonte. |
| Site | **silmer-web** | `~/Mel/Repos/silmer-web` *(a criar)* | `romulosutil/silmer-web` | O site atual da Silmer (monorepo: apps, packages, design tokens, Meta Pixel; último push 23/09). Privado. |
| Site | **silmer-legado** | `~/Mel/Repos/Silmer` *(a criar)* | `romulosutil/Silmer` | Site antigo (React/Vite, último push 27/04/2026). Outro projeto, não o silmer-web. Fica como histórico; privado. |

## Clones vivos (Git atualizado do GitHub; edita-se por worktree e pull request)

| Projeto | Caminho | Repositório | Dono | Grafo | Papel |
|---|---|---|---|---|---|
| **SquadOne** | `~/SquadOne` | `romulosutil/SquadOne` | Rômulo | sim | Código da Central, dos agentes, do Hermes e dos scripts do Dell. É o checkout que a Central roda: não editar nem trocar de branch aqui; trabalhar num worktree (~/.cache/mel-work/SquadOne) e entregar por pull request. |
| **prumo** | `~/prumo` | `romulosutil/prumo` | Rômulo | sim | O método, a marca, as propostas e os modelos do PRUMO (aparece no Drive como PRUMO/Consultoria). |
| **crm-silmer** | `~/crm-silmer` | `romulosutil/crm-silmer` | Rômulo | sim | O CRM do cliente Silmer (branch master; banco no container crm-silmer-postgres, porta 5434 na tailnet). Os worktrees de ~/crm-silmer-wt são deste mesmo repositório. |

- **crm-silmer**: worktrees: `~/crm-silmer-wt/tecnica-e-arte`; Repositório PÚBLICO no GitHub: nunca dar push de segredo nem de dado de cliente. Em 04/10 havia 46 commits em 12 branches locais que o GitHub não tem (30/09 a 03/10: ficha v3, itens do pedido, inbox, bot do n8n, RFC 006); nada foi enviado. Backup: ~/Arquivo/2026-10-04/crm-silmer-todas-as-branches.bundle (17 branches, com .sha256). Para o PC trazer tudo sem publicar: scp do bundle e git clone dele, depois git remote set-url origin para o GitHub. Decidir se o repositório continua público antes de publicar.

## Pastas (sem Git, ou sem repositório próprio; os serviços dependem do caminho)

| Projeto | Caminho | Repositório | Dono | Grafo | Papel |
|---|---|---|---|---|---|
| **auto-site** | `~/auto-site` | — | Rômulo | sim | A esteira Site antes da venda: uma pasta por lead, com o site gerado. Backup: espelho de hora em hora no Drive (PRUMO/Sites antes da venda). |
| **prumo-entregas** | `~/prumo-entregas` | — | Rômulo | não | Rascunhos do Mapa gerados quando um diagnóstico fecha. |
| **licitacoes-automation** | `~/licitacoes-automation` | — | Rômulo | não | O n8n do Dell (Docker) e o coletor do PNCP, com os fluxos exportados. |
| **prumo-automation** | `~/prumo-automation` | — | Rômulo | não | Fluxos antigos do PRUMO; o n8n ainda monta esta pasta, então fica. |
| **Licitacoes** | `~/Licitacoes` | — | Rômulo | não | Dossiês de edital da R SUTIL CORREA LTDA. |
| **renda-2026** | `~/renda-2026` | — | Rômulo | não | Notas da operação de receita; o Hermes lê às segundas. |
| **Silmer** | `~/Silmer` | — | Rômulo | não | Marketing do cliente Silmer (marca, planejamento do Instagram, conteúdo por mês, relatório de Meta Ads, vídeos), sincronizado nos dois sentidos com o Drive a cada 5 minutos (silmer-drive-sync). |
| **silmer-calendario-mobile** | `~/Silmer/silmer-calendario-mobile` | — | Rômulo | não | Página estática do calendário de Instagram de outubro (dist/ com o PDF). Só o resultado publicado; sem código-fonte. |
| **workspace** | `~/workspace` | — | Rômulo | não | infra-docker (os bancos dos projetos), moneyprinterturbo e os agentes. Os containers dependem do caminho. |
| **PRUMO** | `~/PRUMO` | — | Rômulo | não | Índice: atalhos para as pastas de verdade, com os nomes do Drive, mais o LEIA-ME, o MANIFESTO e este registro. |
| **Arquivo** | `~/Arquivo` | — | Rômulo | não | Guardado por via das dúvidas, uma pasta por data (~/Arquivo/AAAA-MM-DD). Descarte vai para a lixeira, nunca rm. |
| **corp-ds4fun** | `~/Corporativo-dev/ds4fun` | — | Rômulo | sim | Corp: ds4fun, o design system completo (storybook, specs, changelog). O GitHub não o cobre. |
| **corp-p4f-site-institucional** | `~/Corporativo-dev/p4f-site-institucional` | — | Rômulo | sim | Corp: site institucional da P4F (client, server, docker-compose). Só 18% bate com o repositório p4f. |
| **corp-databasepay4fun** | `~/Corporativo-dev/databasepay4fun` | — | Rômulo | sim | Corp: databasepay4fun. Não existe no GitHub. |
| **corp-vera** | `~/Corporativo-dev/Vera` | — | Rômulo | sim | Corp: Vera. Não existe no GitHub. |
| **corp-pay4fun-p4f-landpage-cms** | `~/Corporativo-dev/pay4fun-p4f-landpage-cms-c56450cf8060` | — | Rômulo | sim | Corp: landpage com CMS da P4F. Não existe no GitHub. |
| **Mel/Cofre** | `~/Mel/Cofre` *(a criar)* | — | Hermes | não | Segredos cifrados com age (*.age) e o indice.json (id, rótulo, tipo e data; nunca valores). |
| **Mel/Entrada** | `~/Mel/Entrada` *(a criar)* | — | Hermes | não | A caixa de entrada da Mel: chegou/ (bruto), organizado/ (por destino) e diario.jsonl. O Hermes organiza aqui dentro, e só aqui. |

- **auto-site**: O n8n, o gerador e o observador escrevem aqui. O CLAUDE.md da raiz é a sentinela do backup: sem ele a rodada para.
- **prumo-entregas**: Dado de cliente: fica fora do Git e fora do grafo.
- **licitacoes-automation**: Os fluxos só existem aqui e no cofre do backup. Se entra no grafo, decidir na Fase 4.
- **Silmer**: A pasta tem mapa e regras próprios no AGENTS.md dela, que mandam NÃO mover nem renomear (roteiros e o sincronismo dependem dos caminhos): a estrutura não foi mexida. As cópias Politica/ e drive-download-…/ (parte dos 114 MB repetidos em 41 grupos de arquivos idênticos) são conhecidas e estão documentadas lá, e o .sync-conflicts também é para não mexer. .git, .agents e .codex são vazios (sandbox do Codex) e ficam fora do sincronismo. Mover a raiz exigiria rclone bisync --resync (--max-delete 10 é em porcentagem): só com ordem do Rômulo.
- **silmer-calendario-mobile**: Tem um .git de verdade (1 commit, 4 arquivos), mas o sincronismo exclui **/.git/**, então ele não vai ao Drive. O AGENTS.md do ~/Silmer manda não mexer nesta pasta. O commit foi enviado em 04/10 ao repositório PRIVADO romulosutil/silmer-calendario-mobile (push direto pela URL, sem gravar remoto no .git daqui).
- **workspace**: Não mexer em infra-docker sem ordem do Rômulo. Se entra no grafo, decidir na Fase 4.
- **Mel/Cofre**: Nunca no grafo, nunca no Git, nunca em texto claro no Drive.

## Espelhos (clone raso mantido pelo Hermes; ninguém edita)

| Projeto | Caminho | Repositório | Dono | Grafo | Papel |
|---|---|---|---|---|---|
| **ds_auditor** | `~/Mel/Repos/ds_auditor` *(a criar)* | `romulosutil/ds_auditor` | Hermes | sim | Corp: auditor do design system ds4fun. Entra pelo espelho Git; a cópia local em ~/Corporativo-dev/ds_auditor é igual. |
| **p4fhub** | `~/Mel/Repos/p4fhub` *(a criar)* | `romulosutil/p4fhub` | Hermes | sim | Corp: P4Fhub. Entra pelo espelho Git; a cópia local em ~/Corporativo-dev/p4fhub tem 1 arquivo a mais. |
| **ds4fun** | `~/Mel/Repos/ds4fun` *(a criar)* | `romulosutil/ds4fun` | Hermes | sim | Corp: o repositório ds4fun do GitHub, que tem só 3 arquivos (index.html, ds4fun-library.css e .gitattributes). |
| **p4f** | `~/Mel/Repos/p4f` *(a criar)* | `romulosutil/p4f` | Hermes | sim | Corp: o repositório p4f do GitHub (api, client, server, src, vercel.json). |
| **silmer-web** | `~/Mel/Repos/silmer-web` *(a criar)* | `romulosutil/silmer-web` | Hermes | sim | O site atual da Silmer (monorepo: apps, packages, design tokens, Meta Pixel; último push 23/09). Privado. |
| **silmer-legado** | `~/Mel/Repos/Silmer` *(a criar)* | `romulosutil/Silmer` | Hermes | não | Site antigo (React/Vite, último push 27/04/2026). Outro projeto, não o silmer-web. Fica como histórico; privado. |
| **Mel/Repos** | `~/Mel/Repos` *(a criar)* | `romulosutil/*` | Hermes | sim | Um clone raso (--depth 1) por repositório do GitHub, mantido pelo Hermes para o graphify. Ninguém edita. Atualiza com fetch + reset --hard, nunca merge, nunca clean -x. |

- **ds_auditor**: o GitHub cobre 100% da pasta local; Repositório PÚBLICO no GitHub.
- **p4fhub**: o GitHub cobre 98% da pasta local
- **ds4fun**: o GitHub cobre 0% da pasta local; NÃO é a pasta local ~/Corporativo-dev/ds4fun (257 arquivos): esta entra como corp-ds4fun.
- **p4f**: o GitHub cobre 18% da pasta local; Não é o mesmo conteúdo da pasta local p4f-site-institucional (18% dos arquivos em comum): pode ser outro projeto ou outra versão; a pasta local entra como corp-p4f-site-institucional.
- **silmer-web**: Onde o site é hospedado e quem publica: conferir (o registro não afirma). ~/Pessoal-dev/Silmer é o workspace antigo dele: 66% dos arquivos em comum e 57 só locais (social/, crm/, post/, docs/, historico-datacrazy/, _tmp_certificado), arquivado em ~/Arquivo/2026-10-04/Pessoal-dev-Silmer.tar.zst.
- **silmer-legado**: A pasta se chama Silmer, igual a ~/Silmer (marketing): num sistema sem distinção de maiúsculas elas colidem. Por isso o nome do registro é silmer-legado e ele fica fora do grafo.
- **Mel/Repos**: Fora daqui, porque já são clones vivos: SquadOne, prumo e crm-silmer. Ignora arquivados e forks. Fora do cofre do backup (é regenerável).

## Congelados (réplicas do PC que queimou; só consulta)

| Projeto | Caminho | Repositório | Dono | Grafo | Papel |
|---|---|---|---|---|---|
| **Pessoal-dev** | `~/Pessoal-dev` | — | Rômulo | não | Réplica de 25/09 do PC antigo. Hoje contém agent-context, aladdin, iris e portfolio, até o PC novo pegar. port, espectro, Silmer, crm-silmer e a casca vazia agent-context+ foram para a lixeira em 04/10, depois de arquivados. |
| **Corporativo-dev** | `~/Corporativo-dev` | — | Rômulo | não | Réplica de 25/09 dos projetos Pay4Fun (sem .git). Só consulta; o PC novo recebe um pacote pronto na Fase 3. |

- **Pessoal-dev**: Quem tem GitHub (Aladdin, Iris, espectro, product_designer, silmer-web) entra pelo espelho Git. O .git do espectro está corrompido (o do iris também perdeu objetos): não rodar comando git que escreva neles. A Fase 3 arquivou tudo em ~/Arquivo/2026-10-04 (port, espectro, aladdin, iris, portfolio, Silmer, crm-silmer e agent-context). Conferido em 04/10: o código local de espectro, aladdin, iris e portfolio é igual ao do GitHub (a diferença era só CRLF).
- **Corporativo-dev**: É da Pay4Fun: confira a política da empresa. Por decisão de 04/10 o Corp entra no grafo global, pelos projetos abaixo e não por esta pasta.

## Fora do registro de propósito

Pastas de topo da home que não são projeto: `Documentos`, `Downloads`, `Imagens`, `Modelos`, `Músicas`, `Público`, `Vídeos`, `Área de trabalho`, `snap`.
