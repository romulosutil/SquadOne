# n8n da Mel

O [Estado atual](../../ESTADO-ATUAL.md#n8n) reúne o inventário conferido pela
API e a evidência mais recente dos fluxos. As autorizações ficam nas
[regras do repositório](../../RULES.md).

A [auditoria de 18/11](AUDITORIA-2026-11-18.md) registra os chamadores, as
versões ativas, a evidência por fluxo e a reversão. Para investigar uma
execução, comece pelo ID do workflow e pelo comprovante ou retrato que a
Central lê.

## Primeiros contatos diários — 18/11/2026

- **WhatsApp** (`TunkKi3HnYLXJati`). A agenda entrega um pedido a cada dois
  minutos. `whatsapp-agenda.path` aciona a reposição e a frente comercial no
  Dell. A frente registra até dez primeiros contatos por dia de São Paulo.
  Reservas existentes e fichas rejeitadas ficam fora do estoque disponível.
- **LinkedIn** (`Sk4A9PMCD35y6rrJ`). A agenda entrega um pedido a cada dez
  minutos. `linkedin-agente` executa a rodada com o perfil Hermes
  `prumo-linkedin`, o navegador dedicado e o ledger de até dez contatos por dia.

As agendas rodam todos os dias. O n8n registra a entrega do pedido. O registro
local de cada canal confirma os envios. O WhatsApp usa o recibo da Evolution e
o LinkedIn usa a saída observada na conversa, registrada no ledger. Os timers
antigos de frente e reposição do WhatsApp foram substituídos pela agenda do n8n.

### Conferir uma entrega

1. Leia `~/.local/share/n8n-estado/whatsapp-prospeccao/ultima-entrega.json`
   ou `~/.local/share/n8n-estado/linkedin/ultima-entrega.json` no Dell. O
   comprovante contém somente `versao`, `workflowId`, `execucaoId` e
   `criadoEm` em UTC.
2. Abra a execução de `execucaoId` no n8n. Na execução de agenda, procure a
   preparação do pedido, a escrita da fila e **Salvar comprovante no Dell**.
   `criadoEm` registra o horário do pedido.
3. No LinkedIn, procure o mesmo ID em `rodadas.sqlite`; `sem-candidato`
   indica busca válida com zero envios. No WhatsApp, confira a execução dos
   serviços e a contagem de recibos da Evolution no ledger
   `~/.local/share/frente-comercial/registro.sqlite`. Concilie o resultado
   com a Central pelo vínculo de contato e pelo recibo do canal.
4. Se o comprovante estiver ausente ou desatualizado, confira a etapa da
   falha e o que o executor já registrou. A fila pode ter recebido o pedido
   antes da falha de gravação do comprovante. Consulte o histórico em
   leitura e aguarde a próxima rodada natural.

## LinkedIn no Dell

O workflow `Sk4A9PMCD35y6rrJ` coloca pedidos na fila local. O timer
`linkedin-agente.timer` chama o worker do Dell, que usa o perfil
`prumo-linkedin` do Hermes e o navegador dedicado. A página da Central
`/linkedin.html` mostra o acompanhamento. O ledger privado
`~/.local/share/squadone-operations/linkedin/linkedin.sqlite` guarda
reservas e confirmações. A cota, a elegibilidade e a passagem das respostas
para Rômulo estão nas [regras vigentes](../../RULES.md).

Para conferir sem rodar uma campanha, leia as execuções do n8n, o estado do
timer e do `linkedin-browser.service`, e os totais do ledger. O login inicial
foi confirmado em 17/11. Em caso de perda de sessão, Rômulo confirma a conta
no navegador do Dell antes que uma nova rodada possa enviar.

## Auditoria de consumidores — 18/11/2026

Foram conferidos os 25 workflows da Mel, incluindo subworkflows embutidos, e
os consumidores no código instalado e nos registros locais.

| Workflow | Quem usa a saída | Decisão |
| --- | --- | --- |
| Pesquisa de empresas (`pwNiZI1rBGzMJ2dP`) | A agenda chama a pesquisa e higiene pelo serviço local. O executor publica o retrato de pesquisa, o arquivo de critérios para o filtro de leads e uma leitura para a Central. O retrato foi gerado às 18h10. A entrada RSS sob demanda devolve evidências ao solicitante autenticado. | Mantido ativo. |
| Pesquisa diária para WhatsApp (`OhFg51gIIWnmIF6r`) | O relatório atende à revisão humana e o próprio workflow lê os relatórios anteriores para datar a primeira observação dos sinais. A busca RSS é embutida no grafo. O relatório das 17h00 registrou dois sinais novos. A leitura humana segue sem confirmação; a busca de consumidores não encontrou outro leitor automatizado nem ligação com a agenda de envio. | Mantido ativo para revisão. |
| Medição de eventos (`qA5R9UXZj4UgIjFi`) | O serviço público recebe a lista de origens autorizadas. O painel privado `/prumo/metricas` lê o retrato. A lista tinha 312 origens na última publicação conferida, às 16h48, e o painel respondeu HTTP 200 com dados atualizados. O painel não registra acessos individuais. | Mantido ativo. |
| Fonte — falha sem dados (`9wCjxg7rcPRLONDe`) | Único chamador encontrado: a Fonte com IA (`yNLwUy5bdEmC4Qss`), inativa e protegida pela política de pausa. O aviso tem somente um gatilho de erro. | Pausado às 17h07 e arquivado às 18h01, com grafo e vínculo sanitizado preservados. |

A pausa está em `~/.config/claude-ops/workflow-operacao.json`, que bloqueia
reativação pelos publicadores e protege o ID. Os exports e o recibo estão no
Dell em `~/.local/state/squadone-n8n-pausas/20261118T200711-759664Z/`. O
arquivamento tem backup e recibo em
`~/.local/state/squadone-limpeza-etapa4/lote-qtojuPiz/`. O instalador
`prumo-publico.py` publica apenas a Medição e preserva o workflow de falhas
configurado nela. Se a Fonte for retomada, desarquivar o aviso, conferir o
grafo sanitizado, retirar somente a pausa do aviso e ativá-lo antes da Fonte.

## Histórico da agenda inicial do LinkedIn — 17/11/2026

> Consulte a [execução atual](#linkedin-no-dell). A agenda e o teto desta
> seção foram substituídos em 18/11.

Workflow adicional **PRUMO · LinkedIn — prospectar e primeiro contato**
(`Sk4A9PMCD35y6rrJ`), gerado por `linkedin-n8n.py` no Dell.
A agenda inicial era seg–sex às 9h, 11h, 13h, 15h
e 17h, em São Paulo. O n8n entrega metadados da rodada pelo bind mount de
estado já existente; `linkedin-agente` executa no Dell com Chromium exclusivo,
ledger de cinco primeiros contatos/dia e passagem de respostas para Rômulo.
Não executa no PC nem neste chat. O agendamento anterior do Codex foi removido.

A primeira verificação registrou a entrega do pedido à fila e o consumo pelo
worker. O login humano foi concluído mais tarde no mesmo dia.

## Retomada conferida — 17/11/2026

> Registro da retomada. Em 18/11, o n8n assumiu a agenda dos timers de frente e
> reposição do WhatsApp.

Hermes e Evolution conectados por pedido explícito de Rômulo. Núcleo, pesquisa,
campanha e timers de primeiro contato ativos; mensagens confirmadas por recibos
e captura nas conversas, com passagem das respostas para Rômulo. Os quinze
aposentados e a Fonte com IA permanecem sem reativação. Pesquisa nova mantém o
corte de 16/11 às 20h UTC e não drena a carteira histórica.

O `/enviar` do CRM teve sua cadeia reconectada e a montagem de endereço corrigida
para o sandbox do n8n. A política operacional fica em
`~/.local/bin/aquisicao-comercial.json`; a Central a lê pelo espelho de caminhos
de `preparar-central-runtime` e `operacao-runtime.conf`, mantendo a política
de produção fora dos arquivos rastreados.
Backups e roteiro de reversão em `~/.local/state/retomada-20261117/` na Mel.

## Histórico da operação mínima preparada e pausada — 16/11/2026

> A retomada de 17/11 substituiu a pausa operacional descrita abaixo. Os
> contratos do núcleo e a proteção dos fluxos arquivados continuam aplicáveis.

Estado publicado: **22 workflows, 6 ativos, 15 arquivados e a Fonte pausada**.
Quatro funções centrais: Pesquisa de empresas (`pwNiZI1rBGzMJ2dP`), CRM
(`AsjxktRCqRJSmj9P`), Entrada WhatsApp e passagem para Rômulo
(`fd8gz4uDQkJtEd9W`) e Falhas (`5FlXnne7lTMihLic`). Medição e falha privada
da Fonte continuam como apoio. Os webhooks anteriores de conversa, resposta,
números, registros e ações foram preservados dentro dos consolidados. Convites
aposentados levam à Central.

A geração do núcleo é `deploy/dell/claude-ops/workflow_minimo.py`. As fontes
auditadas e seus hashes ficam privadas em `~/.local/share/operacao-minima/` no
Dell. Use a [conferência de publicação](#conferência-de-publicação) para
comparar ou revisar um workflow existente. A guarda
`workflow-minimo.json`, a política operacional e o sincronizador impedem que os
publicadores antigos recriem os aposentados ou substituam o núcleo.

A abertura aprovada está em `config/mensagem-inicial.json`. A política v2 está
em `preparado-pausado`; campanha e timers de envio continuam desligados.
Pesquisa tem uma agenda própria, sem autorizar envio. Geração de Site, Raio-X
e Mapa exige pedido humano. O histórico de 03/11 abaixo permanece como auditoria.

## Inventário histórico de 03/11/2026

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

Os fluxos publicados vêm dos geradores em `deploy/dell/claude-ops/` e das
configurações privadas da Mel. Uma mudança apenas no editor se perde na próxima
regeneração.

## Fontes de manutenção

| Função | Workflow | Fonte |
| --- | --- | --- |
| CRM, entrada, pesquisa de empresas e falhas | `AsjxktRCqRJSmj9P`, `fd8gz4uDQkJtEd9W`, `pwNiZI1rBGzMJ2dP`, `5FlXnne7lTMihLic` | [Composição do núcleo](../../deploy/dell/claude-ops/workflow_minimo.py) e fontes privadas da Mel |
| Pesquisa RSS e relatório diário | `pwNiZI1rBGzMJ2dP`, `OhFg51gIIWnmIF6r` | [Triagem RSS](../../deploy/dell/claude-ops/pesquisa_google.py) e [relatório diário](../../deploy/dell/claude-ops/pesquisa_whatsapp_n8n.py) |
| Agenda WhatsApp | `TunkKi3HnYLXJati` | [Gerador WhatsApp](../../deploy/dell/claude-ops/whatsapp-n8n.py) |
| Agenda LinkedIn | `Sk4A9PMCD35y6rrJ` | [Gerador LinkedIn](../../deploy/dell/claude-ops/linkedin-n8n.py) |
| Medição | `qA5R9UXZj4UgIjFi` | [Instalador da Medição](../../deploy/dell/claude-ops/prumo-publico.py) |
| Falha sanitizada da Fonte | `9wCjxg7rcPRLONDe` | Grafo arquivado e backup privado da Mel |

### Conferência de publicação

No Dell, execute `python3 ~/.local/share/claude-ops/operacao-minima-publicar.py`.
O modo padrão consulta os oito workflows por GET e compara nome, nós,
conexões e opções de execução. Usa o grafo de `activeVersion`, o contexto
canônico e os hashes das fontes privadas. O relatório inclui os IDs de versão,
os hashes e a indicação de divergência. A sincronização de contexto segue
seu próprio timer e pode atualizar os hashes depois de uma revisão.

Para publicar uma revisão autorizada, compare o delta no Git e as diferenças
do relatório. Selecione um único ID ativo e passe
`--aplicar ID --anterior SHA_ATUAL --revisado SHA_DA_FONTE`. O publicador
guarda o export anterior no Dell, grava o rascunho com publicação automática
desabilitada e verifica o hash após cada etapa. A ativação aponta para a
versão revisada. Aguarde uma execução natural para confirmar o resultado.
Os geradores das agendas apenas imprimem o grafo. Os instaladores e a
migração de 16/11 são caminhos históricos para suas finalidades originais.

Para reverter uma publicação individual, consulte as versões anteriores na
[auditoria](AUDITORIA-2026-11-18.md#reversão). Os estados de pausa e arquivo
têm os procedimentos próprios registrados na auditoria de consumidores.

## O que há aqui

| Arquivo | Para quê |
|---|---|
| [`CATALOGO.md`](CATALOGO.md) | Catálogo histórico de 28/10 para localizar IDs, contratos legados, fontes e chamadores. |
| [`NOVA-OFERTA.md`](NOVA-OFERTA.md) | Guia histórico das ofertas no funil anterior à operação mínima. |
| [`workflows/01-Cacador.sanitizado.json`](workflows/01-Cacador.sanitizado.json) | Captura de auditoria do 01 · Caçador (ver abaixo). |
| [`workflows/01-Cacador.schema.json`](workflows/01-Cacador.schema.json) | Esquema dessa captura. |

## Arquivo do 01 · Caçador da Mel — somente auditoria

[`workflows/01-Cacador.sanitizado.json`](workflows/01-Cacador.sanitizado.json) foi obtido por GET da API local da Mel em **19/10/2026, 21:24:16 SP**. Fonte: workflow `oow8TkxrAf4fVvTj`, nome `01 · Caçador`. A fonte estava ativa na captura e foi pausada antes da conferência de 03/11. O arquivo e seu subfluxo embutido estão com `active: false`.

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
