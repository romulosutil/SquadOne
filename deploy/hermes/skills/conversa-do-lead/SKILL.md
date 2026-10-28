---
name: conversa-do-lead
description: Consultar os estados comerciais atuais da Central para Site, PRUMO, Iris, estamparias e Plus, com qualificação, ciclo, responsável e bloqueios. Use quando o Rômulo perguntar "em que pé está a conversa com X?", "o que eu respondo para X?", "X respondeu o quê?", ou antes de sugerir qualquer mensagem a um lead. Só leitura; você nunca envia nada a lead.
---

# Conversa do lead

## Modelo geral e consulta individual — 25/10/2026

Para perguntas sobre o funcionamento comercial, comece por **Como vender e
operar** na Central, acessível em Configurações e no topo de Vendas
(`/mais?abrir=operacao#modelo-operacional`). O modelo reúne catálogo, passagens,
rotina, capacidade, indicadores e gates; não é outra base de clientes.

Só depois, quando houver uma oportunidade específica, use a leitura GET abaixo.
O modelo geral explica o procedimento; a leitura atual informa regra aplicada,
frescor, autoridade, lacunas, dono e bloqueios daquela oportunidade. Não copie
catálogo, preço, conversa ou fatos humanos para memória como substituto da fonte.

Resuma ao Rômulo: fonte/frescor, estado e evidência, lacuna, próxima ação interna,
quem confirma e condição de conclusão/espera. A disponibilidade qualitativa dele
está confirmada; não invente horas ou prazo. A pausa de aquisição não proíbe seu
atendimento manual legítimo e não libera envio automático ou negociação Hermes.

## Escopo comercial atual — 24/10/2026

Esta seção rege o atendimento comercial quando houver divergência com a descrição
histórica. Antes de sugerir uma ação, consulte a projeção atual da
ficha na Central/SquadOne, que também é o CRM operacional. Os registros na aba CRM
existente são a fonte dos fatos confirmados; não crie uma base ou memória paralela.

1. Confira a revisão `[qualificacao-comercial-v1]`, o ciclo `[ciclo-comercial-v1]`,
   a responsabilidade `[responsavel-conversa-v2]` e a tarefa `atendimentoComercial`
   quando presentes. Nota nova explícita governa; SPICED só é fallback sem nota
   nova. Nota nova inválida significa revisar a fonte, sem recuperar uma anterior
   como se fosse atual. Não interprete sozinho o JSON como confirmação humana.
2. Separe necessidade, adequação, intenção, participantes/processo de decisão e
   próximo passo aceito das interpretações e lacunas. Quando houver abertura,
   sugira uma pergunta faltante por vez. Não exija impacto financeiro, reunião ou
   um decisor único; decisão com sócios pode estar suficientemente esclarecida.
3. Pedido de preço, proposta, contratação, negociação ou pagamento vai a Rômulo,
   mesmo com qualificação incompleta. A proposta final depende do contexto e das
   confirmações da ficha. Hermes não marca envio, aceite, cobrança, pagamento ou
   responsabilidade e não atribui esses fatos a um modelo.
4. Preserve condições individualizadas confirmadas antes do catálogo. Campo em
   aberto continua desconhecido; divergência ou preço incompleto pede revisão
   humana. Não invente implantação, mensalidade zero, desconto, escopo ou resultado.
5. Recusa, exclusão, pausa, espera e conversa assumida por humano exigem preservar
   a restrição. Nesses casos, ofereça orientação interna, sem novo rascunho de
   contato ou agradecimento automático. Nossa última saída não cria nova abertura;
   permissão para material não é intenção de compra. Confira a entrega observada
   antes de sugerir reenviar o que já saiu.
6. Origem do coletor não identifica conta emissora nem concede permissão de envio.
   Telegram e fila da Central entregam o aviso de passagem, nunca uma mensagem ao
   cliente. Links de ficha vêm da origem e da Central HTTPS `8443`, não do painel
   Hermes `9119`. Sem link verificável, informe a falta em vez de montar um.

Hermes permanece em leitura e diagnóstico. Luna do n8n é serviço separado; n8n é
executor dos fluxos autorizados; Grok externo fica em rascunhos sob pedido e sem
controle técnico presumido. Esta skill não escreve notas/estados nem muda tarefas,
rotinas pessoais, cron da Visão semanal ou serviços da Silmer.

## Consultar a mesma leitura da Central

Use o leitor instalado, somente GET no loopback `9120`:

```bash
python3 ~/.hermes/scripts/ler_comercial.py
python3 ~/.hermes/scripts/ler_comercial.py --nome "nome da empresa"
python3 ~/.hermes/scripts/ler_comercial.py --referencia "referencia retornada pela consulta"
```

O comando não recebe URL, credencial ou caminho de arquivo; não segue
redirecionamentos, não chama modelos, não envia, não registra fatos comerciais e
não grava notas. A leitura normal da Central pode reconciliar seu índice derivado
de responsabilidade, sem modificar os fatos humanos da aba CRM. Não execute o
aplicador do Hermes, workflows ou geradores para responder a uma consulta.

- `lista` é um conjunto limitado de oportunidades; não é autorização nem ranking
  de compradores. `ambiguo` exige escolher explicitamente a oportunidade pela
  referência e pelo produto. Não selecione a primeira nem funda conversas/contas.
- `prioridadeTrabalho` ordena o trabalho pelos mesmos critérios da Central.
  `grupo`, `ordem`, `acao` e `resultado` são orientação interna; `evidencia` e `em`
  distinguem fonte humana, classificação atual e indício histórico. Destaque é
  preparação/revisão e não probabilidade de compra, proposta pronta ou envio.
  `urgente` só fica verdadeiro em evento atual confirmado há até 15 minutos pelo
  horário original. Não use a hora de importação, da consulta ou do recebimento
  de um aviso para renovar essa urgência. Pausa/espera/recusa ficam sem destaque.
- `individual` traz só o contexto mínimo: autoridade, estados, campos confirmados,
  lacunas, bloqueios e orientação interna. Sem textos, valores contratuais,
  referências de recibos, telefones, links WhatsApp ou notas JSON brutas. Referência
  opaca e revisão de contexto não comprovam identidade ou compra.
- Leia `fonte.geradoEm`, `idadeMs` e `atual`. O limite é 15 minutos; erro, retrato
  velho, fonte parcial ou servidor indisponível significam **não verificado**.
  Não substitua pelo `crm.json`, JSONL, memória ou impressão de uma consulta antiga.
- `ficha` individual é fornecida pela própria Central a partir da origem HTTPS
  `8443` configurada e do lead encontrado. Se vier `null`, informe que falta link
  verificável. Não use o antigo `/webhook/lead`, o painel Hermes ou monte hostname.
- Qualificação nova inválida pede revisão. Qualificação negativa, ciclo comercial,
  responsável humano, conflito de identidade, áudio/autoria pendentes e atendimento
  interno preservam a conferência com Rômulo. Pausa/espera são para aguardar;
  recusa/exclusão/desfecho são para preservar a restrição, sem agradecimento ou
  rascunho automático. Nem uma resposta sem bloqueios autoriza contato.

## Responder ao Rômulo

Diga em poucas linhas o estado verificado, a data da fonte, o que está confirmado
ou falta conferir e a próxima ação **interna**. Perguntas sobre preço, proposta,
contratação, negociação, contrato e pagamento passam ao Rômulo. Não transforme
lacunas legadas de SPICED em exigência de reunião, impacto financeiro ou decisor
único; uma decisão com sócios pode estar esclarecida na qualificação nova.

Este leitor não devolve a conversa nem libera mensagem pronta. Se Rômulo pedir
rascunho, explique primeiro as restrições atuais. Uma condição individual deve
ser conferida na ficha pelo humano; não preencha preço em aberto com catálogo ou
zero. Se o conteúdo mínimo não resolver uma pergunta específica sobre a conversa,
informe o limite e peça a conferência da fonte na Central, sem despejar o histórico
bruto para um modelo, canal, memória ou arquivo paralelo.

## O que você nunca faz

- Nunca envia a lead: nem `hermes send`, navegador ou WhatsApp Web.
- Não confirma envio, qualificação, aceite, cobrança, pagamento ou responsável.
- Não escreve planilhas, notas, JSONL ou snapshots do CRM; não altera rotinas.
- Não transforma a origem do coletor em prova de conta ou permissão de contato.
- Não preenche a ausência de fonte com interpretação ou memória.
