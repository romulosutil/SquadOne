# n8n da Mel

## Estado conferido em 03/11/2026

O n8n do Dell lista 22 workflows: 15 ativos e 7 inativos, incluindo o Radar PNCP
arquivado. Caçadores de Site, Íris e Estamparia, Acompanhamento, Funil semanal,
Fonte com IA e Radar permanecem pausados. Os motivos e os commits estão em
[limpeza e histórico das pausas](../../docs/referencia/limpeza-e-pausas-2026-11-03.md).

O Lead Scout e Preparar planilha abaixo são artefatos históricos; não aparecem
na instância atual. A captura do Caçador de 19/10 registra o estado daquela data:
o Caçador de Site foi pausado posteriormente, em 29/10. Não importar nem ativar
esses arquivos como parte da limpeza.

`workflow_limpeza.py`, último gancho do publicador, retira somente os quatro nós
Jev quando todos estão desabilitados, isolados e sem referências externas. Não
remove workflows, tabelas ou amostras da sombra, nem altera os estados de pausa.

Esta pasta **não é a fonte** dos fluxos. Cada fluxo é montado e publicado por um gerador em
`deploy/dell/claude-ops/`, pela API local do n8n da Mel; editar no editor do n8n sem mudar o gerador
se perde na próxima regeneração.

## O que há aqui

| Arquivo | Para quê |
|---|---|
| [`CATALOGO.md`](CATALOGO.md) | Fonte de verdade sobre o n8n: como se publica, a cadeia de ganchos do `n8n.py`, os 21 fluxos (id, gatilho, gerador, o que lê e grava, decisões), por que alguns não foram juntados, pendências e o mapa de scripts. Leia antes de mexer em qualquer fluxo. |
| [`NOVA-OFERTA.md`](NOVA-OFERTA.md) | Como criar uma oferta nova do PRUMO: regras da Prumo, decisões que o molde preserva, o passo a passo com arquivo:linha, o modelo do bloco em `prumo-ofertas.json` e a proposta para deixar barato. |
| [`workflows/01-Cacador.sanitizado.json`](workflows/01-Cacador.sanitizado.json) | Captura de auditoria do 01 · Caçador (ver abaixo). |
| [`workflows/01-Cacador.schema.json`](workflows/01-Cacador.schema.json) | Esquema dessa captura. |

## Arquivo do 01 · Caçador da Mel — somente auditoria

[`workflows/01-Cacador.sanitizado.json`](workflows/01-Cacador.sanitizado.json) foi obtido por GET da API local da Mel em **19/10/2026, 21:24:16 SP**. Fonte: workflow `oow8TkxrAf4fVvTj`, nome `01 · Caçador`. **A fonte estava ativa na captura; em 03/11/2026 está pausada.** O arquivo e seu subfluxo embutido estão com `active: false` para importação segura. A captura não registra a pausa posterior do Caçador de Site. Os estados atuais estão na seção acima.

A sanitização ocorreu **na própria Mel, antes de qualquer cópia**; o export bruto ficou somente em memória. Foram preservados o grafo principal de 7 nós e o `workflowJson` embutido de 32 nós, inclusive a leitura de leads existentes e o dedupe por `place_id`. Foram retirados estado de execução, `pinData`, `staticData`, compartilhamentos, metadados de versão e IDs de webhook. As nove referências de credencial e cinco referências de planilha foram substituídas por placeholders; nenhum dado de lead, paciente ou execução foi incluído. O código fonte próprio permanece auditável.

SHA-256 do JSON sanitizado: `a3a5582574e551317195411ed07e54749e4dff09767a32e56a85968236d7746a`. Esquema: [`workflows/01-Cacador.schema.json`](workflows/01-Cacador.schema.json); testes de estrutura, código e ausência de segredos em `src/operations-cacador-arquivo.test.ts`.

**Não publicar automaticamente este arquivo.** Ele não integra instalados.json e não deve ser enviado a um importador/deployer automático. Para uma restauração humana autorizada, conferir os dois grafos, restabelecer manualmente as referências de credencial/planilha no destino, revisar parâmetros e manter o fluxo inativo até aprovação específica. Esta captura não republicou nem ativou qualquer Caçador.

## Histórico

- **Exports antigos do PRUMO.** `workflows/prumo-lead-scout.json`, `prumo-preparar-planilha.json` e
  `prumo-diagnostico.json` descreviam o desenho anterior a 23/09/2026 (aba `Leads`, etapa `Contato
  aceito`, `Convite pronto`). Foram apagados em 19/10/2026 (commit `4d85412`, auditoria de fluxos),
  junto com o script que os regenerava; importá-los desfaria o fluxo vivo. Para consultar, use o Git.
  O questionário de 16 perguntas do Diagnóstico ficou só como fixture de teste, em
  `deploy/dell/claude-ops/testes/prumo-diagnostico.fixture.json` (lida por
  `workflow_confiabilidade.test.py`); não é importável nem representa o fluxo vivo.
- **Lead Scout** (convite frio a distribuidoras). Desligado em 08/10/2026 e **removido do n8n**: não
  está entre os 21 fluxos de 28/10/2026. Em 28/10/2026 saíram o import dele no bootstrap do compose de
  `licitacoes-automation` e a dica no `dell-status`. Sobram a entrada em `DESLIGADOS` (`n8n.py`), que
  não faz nada, e os remendos `prumo-porte-cnpj.*`, sem alvo, que ficam só porque o cartão `PRUMO-1-B1`
  de `docs/blueprint/servico.json` os cita (o teste do blueprint exige que o arquivo exista).
- **Diagnóstico por formulário.** Até 08/10/2026 o "sim" ao convite do PRUMO recebia o formulário de
  16 perguntas, e a pontuação de hora em hora gravava Índice e Briefing em Prospects (etapa
  "Diagnóstico pronto"). Desde então o sim recebe o Raio-X. O fluxo "PRUMO — Diagnóstico do dono" ainda
  lê o formulário, e o convite do PRUMO ainda tem o ramo `passo=diagnostico`; ambos estão nas pendências
  do `CATALOGO.md`.
