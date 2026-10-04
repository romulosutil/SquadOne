# PRUMO: tudo num lugar

Esta pasta junta, com atalhos, tudo o que o PRUMO usa no Dell. Os nomes são
os mesmos das pastas `PRUMO/` no Google Drive.

**Pode abrir e editar arquivos por aqui à vontade.** Só não mova nem renomeie
os atalhos nem as pastas originais: serviços do Dell (n8n, gerador de sites,
Hermes, backup, Central) procuram cada pasta pelo caminho de verdade.

## O que tem aqui

| Atalho | Pasta real | O que é |
|---|---|---|
| Sites antes da venda | `~/auto-site` | Uma pasta por lead, com o site gerado. `_em-conversa`, `_recusados`, `_fechados`, `_concluidos` e `_descartados` são o destino de cada lead. |
| Consultoria | `~/prumo` | O método, a marca, as propostas e os modelos do PRUMO (Git: romulosutil/prumo). |
| Entregas | `~/prumo-entregas` | Rascunhos do Mapa gerados quando um diagnóstico fecha. Dado de cliente: fica fora do Git. |
| Licitações | `~/Licitacoes` | Dossiês de edital da R SUTIL CORREA LTDA. |
| Renda | `~/renda-2026` | Notas da operação de receita; o Hermes lê às segundas. |
| Sistema / SquadOne | `~/SquadOne` | Código da Central, dos agentes, do Hermes e de todos os scripts do Dell (Git: romulosutil/SquadOne). |
| Sistema / n8n e radar | `~/licitacoes-automation` | O n8n do Dell (Docker) e o coletor do PNCP. |
| Sistema / n8n PRUMO (antigo) | `~/prumo-automation` | Fluxos antigos do PRUMO; o n8n ainda monta a pasta, então fica. |
| Clientes / Silmer | `~/crm-silmer` | O CRM do cliente Silmer (Git: romulosutil/crm-silmer). |
| Arquivo | `~/Arquivo` | Coisas antigas guardadas por via das dúvidas, por data. |
| Arquivo do PC | `~/Pessoal-dev` | Cópia congelada do PC que queimou (25/09). Só consulta. |

## Onde abrir cada coisa

- **Central** (saúde do Dell, o que precisa de você, fluxos): https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/ (no Dell: http://127.0.0.1:9120/)
- **CRM** (Site antes da venda e PRUMO): a mesma Central, em `/crm`
- **Agentes do SquadOne**: https://aladdin-squadone-app.jicnzg.easypanel.host/
- **n8n**: http://127.0.0.1:5679/ (só no Dell)
- **Hermes**: no seu WhatsApp
- **Mapa dos fluxos**: https://claude.ai/artifact/Cq7R8yYVTbwoN8Bn2Gp9fW

## Arrumação de 30/09/2026

- **Lixeira** (dá para restaurar pelo gerenciador de arquivos até você esvaziar):
  - as cópias `Pessoal-dev/SquadOne`, `Pessoal-dev/SquadOne-publish-20260916` e `Pessoal-dev/prumo`, que eram versões antigas do que está no GitHub;
  - as capturas de tela soltas (`vc-*.png`, `shots`, `esteira-shots`, `qa-shots`, `tmp-shots`);
  - o instalador `.deb` do Claude e a pasta vazia `Sync`.
- **Arquivo** (`~/Arquivo/2026-09-30`):
  - o que só existia na cópia do SquadOne (`CHECKPOINT.md`, `.superpowers`, `assets`, um fluxo e um teste);
  - o snapshot antigo do n8n, o `prumo-lead-engine` e `backups`;
  - o crontab e o script do Windows.
- Os backups do Drive de 29 e 30/09 também guardam tudo isso.
