# Integração comercial ao n8n e aos agentes

Data local: 23/10/2026. Fase de implementação do piloto assistido. Objetivo: dar uma próxima ação confiável para conduzir respostas até proposta, contrato e pagamento. A cena isométrica, personagens, mesas, quadros, navegação e câmera do escritório ficam preservados; os controles são acrescentados à ficha existente.

## Caminho implementado

1. Observador PRUMO preserva a mensagem no JSONL e coloca no lote existente apenas identidade, horários reais e hash SHA256 do conteúdo. Não inventa ID para filas antigas.
2. Classificador n8n conserva sua classificação e persistência aguardada. Depois envia um envelope por evento à ponte privada existente, que repassa ao endpoint loopback autenticado da Central. Nenhuma segunda chamada de modelo é acrescentada.
3. A Central só confirma HTTP202 depois da gravação durável da inbox. Repetição do mesmo evento não duplica trabalho; conteúdo diferente com a mesma identidade é conflito. ACK não confirma projeção comercial.
4. O controlador confere a linha original, sua conta, ID, horário e hash, relê o CRM e prepara uma pergunta faltante ou tarefa interna para Rômulo. Preço, negociação, proposta, aceite, cobrança, pagamento, recusa, pausa ou contexto divergente exigem conferência humana. O resultado persistido contém só referências, nunca texto do cliente.
5. A tarefa entra na fila de decisões já existente e na ficha. Os avisos do vendedor continuam dependentes da configuração, expediente e fila existentes. Tarefa interna não oferece WhatsApp/Enviei, não incrementa mensagens e rejeita callback antigo de envio.
6. O botão Assumir conversa grava uma nota humana na aba CRM. A autoridade é compartilhada por conta e conversa, enquanto as oportunidades mantêm escopo e valores separados. O journal veta novas reservas da mesma conversa enquanto a troca aguarda projeção. Devolver para rascunhos não ativa respostas autônomas.
7. Proposta versionada, aceite/documento, condição, cobrança e pagamento continuam no caminho humano já implementado. Evento técnico, classificação, clique, aviso ou rascunho nunca confirmam esses marcos.

## Limites deliberados

Este piloto não envia novas respostas comerciais automaticamente. Grok continua suspenso conforme declaração do usuário; esta integração não controla a VM nem modifica suas tarefas. Os caçadores que estavam pausados não são reativados. Primeiros contatos existentes mantêm suas regras; o novo veto é por conversa e não constitui pausa global.

O envelope suporta tipos adicionais, mas o observador nesta fase emite somente respostas de entrada. Não declarar nova captura de entrega/leitura/saída. Não há importação histórica em massa, recontato de leads frios ou fusão de oportunidades. O ciclo comercial exige confirmação humana e não integra banco, assinatura ou gateway.

Inbox: `data/operations/atendimento-comercial-inbox.json`, conforme diretório operacional configurado, arquivo privado e substituição atômica. Processamento interrompido fica ambíguo e não obtém repetição automática. Não apagar a inbox/journal para liberar uma ação. Verificar a fonte e o resultado antes de recuperação manual.

## Publicação e verificação

Antes da publicação, suíte Linux completa: 3.964 testes passaram, zero falhas/pulados; tipagem e build passaram. Testes Python: 101 observador,25 entrada durável,5 envelopes,7 transformador,8 ponte,16 confiabilidade, todos passaram no Linux. Os testes usam fixtures e não representam venda ou confirmação de pagamento.

Backup privado no Dell preserva os 22 arquivos alterados e10 não rastreados pré-existentes e os dois workflows atuais. A versão instalada do observador é registrada em commit de baseline separado antes do delta. Somente CRM08 e classificador são alvos da publicação; comparar21 workflows/18 ativos e estados individuais antes/depois. Não regenerar os demais fluxos.

Publicação verificada na passagem de23 para24/10: backend e ficha instalados; ambos os workflows atualizados e com versão ativa igual à versão salva. CRM08 mantém20 nós; classificador passa de17 para22. Inventário permanece21 workflows/18 ativos, com todos os estados individuais preservados. Ponte, observadores e Central ativos. O observador instalado coincide com a fonte publicada;31 arquivos pré-existentes permanecem byte a byte e o baseline do observador é recuperável no stash0ab97a38c2084630af507dbb038b481c8396ca4a.

Transporte real container n8n→ponte existente→Central exercitado com UM evento técnico fictício (tipo mensagem/saída, fora da qualificação): primeiro202 pendente, repetição202 repetido. Sem credencial403. Esse metadado de teste permanece identificado na inbox e não produz tarefa comercial. Não foi disparado classificador/modelo nem mensagem a cliente para este teste. Zero novas notas humanas de responsável, qualificação ou ciclo no CRM depois da inspeção.

Interface desktop publicada inspecionada: escritório preservado; ficha apresenta Assumir conversa, Devolver para rascunhos, qualificação e ciclo. Nenhum botão de gravação real foi acionado. A ligação de precedência também alcança Agora, BI e Minhas decisões, inclusive tarefas internas durante pausa/desfecho, com testes dedicados. O vendedor existente está ligado e possui origem da Central configurada; não houve envio artificial de aviso pelo Telegram. Mapa AST atualizado no Dell após a publicação.

Permanece pendente a homologação operacional com3–5 conversas elegíveis: primeira resposta real no novo percurso, recebimento prático do handoff no Telegram pelo Rômulo, adoção da tomada de responsabilidade e condução até contrato/pagamento. Não declarar esse aceite nem uma venda a partir de testes sintéticos. Dispositivo móvel real não foi homologado nesta fase. Nenhum sucesso de testes substitui evidência de adoção ou de uma primeira venda.

## Homologação realizada em 24/10

A etapa técnica foi exercitada com ControEco, Casa do Bordado e TPrint, usando envelopes históricos reais, deduplicação, controlador e avisos automáticos em produção. Estampa Cor foi corretamente bloqueada como controle de origem pessoal. O usuário confirmou recebimento e abertura móvel após nova tentativa. Relatório e limites: `PRUMO-HOMOLOGACAO-PILOTO-2026-10-24.md`. Permanecem pendentes a resposta nova espontânea de cliente, qualificação humana, adoção da responsabilidade e condução real até contratação/pagamento.
