## Máquina de controle (desde 28/09/2026)

- O PC Windows do Rômulo queimou (NVMe); o Dell o viu pela última vez em 25/09/2026. O que não sincronizou com o Dell nem foi ao GitHub foi perdido: não procure, não reconstrua, não cite como pendência.
- Até o PC novo chegar, **este Dell é a máquina de controle**: Claude e Codex rodam aqui. Git só em clones próprios atualizados do GitHub (ex.: `~/SquadOne`); `~/Pessoal-dev` e `~/Corporativo-dev` são réplicas congeladas em 25/09. Sem túnel: as URLs `127.0.0.1` são locais.
- **O PRUMO é dono de tudo** (o Site antes da venda é a frente "Vender mais"). Fonte da verdade do PRUMO: `~/prumo` (`romulosutil/prumo`).
- **`~/PRUMO` é o índice (30/09/2026):** atalhos para as pastas de verdade, com os mesmos nomes do Drive, e um `LEIA-ME.md` com o mapa. Nunca mova nem renomeie as pastas de verdade (`~/auto-site`, `~/prumo`, `~/prumo-entregas`, `~/SquadOne`, `~/licitacoes-automation`, `~/prumo-automation`, `~/renda-2026`, `~/workspace`): n8n, containers, gerador, Hermes e backup dependem dos caminhos. Guardado por via das dúvidas vai para `~/Arquivo/<data>/`; descarte vai para a Lixeira (`gio trash`), nunca `rm`.
- `~/Pessoal-dev` ficou só com os projetos que não têm clone no Dell (port, Silmer, aladdin, espectro, iris…); as cópias de SquadOne e prumo saíram em 30/09 (o que era só delas está em `~/Arquivo/2026-09-30/pc-2509`).
- `~/auto-site` é a pasta de verdade da esteira. O Dell faz backup direto no Drive (`backup-dell`, `~/SquadOne/deploy/dell/backup/`): espelho só de leitura em `PRUMO/Sites antes da venda`, `PRUMO/Consultoria` e `PRUMO/Entregas`, cofre cifrado em `Backups/dell-worker`. Fonte nova de backup = bloco novo em `fontes.toml`.
- A Central do SquadOne roda do clone `~/SquadOne` e se atualiza sozinha quando a `main` anda (`atualizar-central.timer`). Os agentes do SquadOne moram no app do Easypanel; a Central não serve mais `/squadone`.
- Google: nunca revogue token OAuth; os clientes do Hermes, n8n, backup e SquadOne são do mesmo projeto e caem juntos. Login do Google desses serviços só no navegador do próprio Dell (o retorno aponta para 127.0.0.1).
- O PC novo vai receber a organização do SquadOne. Estado e checklist: `~/SquadOne` → `deploy/pc/README.md` (no GitHub `romulosutil/SquadOne`).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
