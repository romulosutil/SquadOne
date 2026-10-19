# PRUMO: da conversa à primeira venda

Auditoria no Dell por SSH `mel`, em 17–18/10/2026. Fontes: CRM, mensagens originais recuperadas pelo Hermes, observador e prints do Rômulo. Preço padrão: **Encontrado por R$ 690 + R$ 39/mês**. Condições antigas diferentes continuam preservadas como fatos históricos.

## O que foi medido

Consultamos **266 contatos distintos já abordados**, correspondentes a 267 relações contato/oferta: Site 201, Organizado 59, Iris 3, Estamparia 4. O levantamento finito pediu até 50 mensagens por contato, com duas consultas simultâneas. Relatório privado: `~/.local/share/squadone-operations/leitura-historicos-20261017-233635.json`.

O lote registrou 20 retornos, 243 sem retorno durante a consulta e 3 erros de filtro. Os três foram solicitados novamente após corrigir o escopo; aceitação do pedido não comprova recuperação. Jéssica foi recuperada separadamente. Há mensagens originais do Hermes para **21 contatos distintos**. Os históricos disponíveis foram lidos, mas continuam parciais. Não afirmar que todos os históricos foram conferidos ou que ausência no arquivo prova ausência no WhatsApp.

No CRM, há algum histórico para Site 19/201; Organizado 2/59; Iris 2/3; Estamparia 1/4. Esse indicador inclui transcrições anteriores de prints e não equivale a conversas originais completas. Site + Organizado passaram de 5/260 para **21/260** com mensagens disponíveis.

Nos 20 pedidos do lote que retornaram mensagens, pedido→retorno teve mediana **1,19 s**, máximo **1,94 s**. Isso não mede a latência ponta a ponta nem garante completude. A conta atual pode não conter conversas da conta anterior bloqueada; a causa de cada ausência ainda não foi demonstrada.

## As cinco visões

| Visão | Evidência | Direção |
|---|---|---|
| Otimista | Roda respondeu o formulário e elogiou o Raio-X. Jéssica aceitou recebê-lo. Comece perguntou preço e explicou como decide. | Existe abertura. Converter permissão em entrega e próximo compromisso, sem confundir com compra. |
| Pessimista | Jéssica disse que não viu. Comece rejeitou links, foi marcada negativa e teve a demo apagada apesar de conversar sobre contratação. Roda recebeu sete saídas após a última resposta. | O processo conclui com contexto incompleto e pode contrariar a conversa. Conferir antes de retomar ou descartar. |
| Produto | Contagens divergentes, texto repetido e ações concorrentes escondiam a decisão. | Uma próxima ação, um botão principal, contexto primeiro e cobertura visível. Abrir WhatsApp não confirma envio. |
| CEO | Não há pagamento confirmado no funil analisado nem margem por entrega medida. Elogio e leitura não são receita. | Uma oferta com preço estável. Medir necessidade, decisor, aceite, pagamento e horas/custo. Qualificar antes de produzir extras. |
| Juiz | Perda de contexto comprovada; objeção ao preço não demonstrada para Roda/Jéssica. | Corrigir a entrega de Jéssica primeiro. Repetir a sequência em até dez oportunidades elegíveis. Depois avaliar escala e infraestrutura. |

## Primeiro teste: entregar o que Jéssica aceitou receber

Em 14/10, Jéssica respondeu “Sim” ao convite do Raio-X. Em 15/10, após “Gostou, Jéssica?”, respondeu por áudio: **“Oi, meu querido, eu nem vi.”** Somente esse áudio foi transcrito pela API do Google, com autorização específica do Rômulo.

Nas oito mensagens recuperadas, não aparece o link entre autorização e cobrança: envio não comprovado nesse trecho, não certeza de que nunca foi enviado. A marcação de 2ª mensagem no CRM é posterior e não substitui a conferência da conversa atual.

O [Raio-X de Jéssica](https://demo-jessica-barbosa-advocacia-advo.vercel.app/raio-x) retornou HTTP 200 e título correto. O conteúdo é datado de 14/10; rankings e conclusões não foram novamente aferidos nesta auditoria. Não repetir como fato atual que o site dela está vazio sem conferir.

1. Conferir WhatsApp atual e eventual entrega/retomada posterior. Respeitar a conversa e não duplicar.
2. Se ainda couber entregar, mandar somente o prometido e uma pergunta sobre a necessidade. Rascunho para revisão humana, **não enviado**:

   > Jéssica, ficou faltando eu facilitar a entrega do Raio-X que você pediu. Está aqui: https://demo-jessica-barbosa-advocacia-advo.vercel.app/raio-x . Hoje vocês já têm alguém cuidando do site do escritório?

3. Se responder, confirmar problema atual e quem decide. Se já tiver solução ou não precisar, registrar e encerrar. Havendo necessidade e decisão, apresentar só Encontrado: demo, escopo vigente, R$ 690 + R$ 39/mês, pagamento após ver funcionando. Combinar decisão ou data.
4. Não mandar outro “bom dia”, pacote de propostas ou desconto. Sem resposta nem data combinada, no máximo um retorno contextual em 2–3 dias úteis; depois, inconclusivo e pausa. Retomadas anteriores contam nesse limite.

Sinal intermediário: resposta sobre necessidade e conversa com quem decide; depois, autorização para publicar/proposta aceita. **Sucesso: contratação e pagamento conferido**, após funcionamento conforme acordado. Registrar horas e custo. É teste de execução, não prova estatística. Manter preço, nicho e oferta durante o teste.

## Decisão por lead

| Lead | Fato | Próximo passo |
|---|---|---|
| Roda Mais | 20 mensagens: formulário, elogio, Mapa + site + preço, sete saídas nossas sem retorno visível. | Manter pausado. Dispersão de oferta é hipótese. Só retomar com resposta ou data combinada; aplicar aprendizado em outro lead. |
| Comece Caçambas | “Não clico em link nenhum”; depois pede preço, diz que não decide sozinha e precisa comparar a proposta concorrente. A classificação antiga levou à remoção da demo. | Corrigido em 18/10: avaliação pendente, proposta real de R$ 90/mês registrada, pausa mantida. Esperar comparação e decisão conjunta; revisão interna em 19/10 sem nova cobrança. Demo e Raio-X originais restaurados e verificados com HTTP 200. |
| AC Advocacia | Autorização, resposta automática com site já existente, demo e preço depois. | Conferir histórico e qualificar ganho concreto sobre o site atual. “Sim” não prova decisor/compra. |
| Kulniski / Gaius | Retomadas existentes; parte da evidência é de prints. | Não gerar cobrança porque a classificação ficou velha; conferir o combinado. |
| Arlete | “No momento não tenho interesse”. | Respeitar e encerrar. |
| JCF | “Segue o contato”, sem cartão/número no trecho recuperado. | Conferir indicação sem inventar contato/decisor. |
| Baobá / Iris | Permissão para vídeo e entrega. | Validar necessidade e decisor; vídeo aceito não é contratação. |

Não atribuir intenção aos contatos com apenas mensagem nossa ou saudação de robô. Ddetize tem áudios ainda não transcritos: não inferir a objeção nem transcrever outros áudios com a autorização restrita a Jéssica.

## Melhorias materializadas

- Central com uma prioridade comercial; escritório e demais pendências abaixo e recolhidos.
- Vendas com Próxima ação, Novos contatos, Funil, Diagnóstico e Resultados. Contagem da mesma fila, nomes e roteiros sem competir com o título.
- Ficha com histórico antes da retomada, busca direcionada no Hermes e aviso de cobertura parcial. Exportação do WhatsApp como alternativa. Conferência humana invalidada por conversa nova.
- Aprendizado na própria aba CRM: fato, hipótese, próximo teste, resultado e pausa até resposta. Não muda automaticamente estratégia, preço ou mensagens.
- Fluxo 08 corrigido: gravava 1000 caracteres, mas devolvia 500. O retrato agora preserva os 1000, inclusive aprendizado/proposta.
- Pausa respeitada na tela e fila do vendedor. Recibo ou mensagem nossa não a libera.
- Preço público corrigido em `prumo.services`, `www.prumo.services` e no endereço antigo `prumo-site-gray.vercel.app`: R$ 690 + R$ 39/mês. O endereço antigo precisou ser atualizado separadamente; a primeira publicação manteve nele a versão anterior. A oferta histórica de Comece permanece preservada no CRM.

## Hermes, Evolution e n8n

Evolution conectada, mas persistência de mensagens/histórico desabilitada: consulta e tabelas vazias. Hermes já conectado à mesma conta. A recuperação usa essa sessão por consulta local autenticada, limitada aos contatos do CRM. Não se criou outra sessão nem arquivo geral de conversas privadas.

Não há evidência de que outra sessão no n8n resolveria a ausência ou aceleraria a leitura. O problema observado é principalmente cobertura/associação. O observador ainda agrupa mensagens por 45 s antes de classificar, e a tela depende do retrato: são esperas distintas. Recuperar histórico não reclassifica o passado nem envia mensagem ao lead.

Próxima medição técnica: correlacionar id de mensagem real entre chegada, arquivo, classificação, retrato e tela, sem enviar teste a lead. Medir captura/associação antes de otimizar segundos. Pedido aceito, mensagens recebidas, transcrição e conferência continuam estados distintos.

## Ordem depois do primeiro teste

1. Executar entrega de Jéssica com revisão humana; registrar resultado literal.
2. Rever os casos sinalizados de classificação antiga ou conversa sem retorno. As proteções abaixo já estão instaladas; não liberar descarte por ausência de histórico.
3. Repetir uma oferta/uma decisão em até dez leads elegíveis do mesmo nicho, respeitando recusas e prazos. Não completar lote com inelegíveis.
4. Rever o lote ao decidirem ou após cinco dias úteis do retorno único: parou em entrega, necessidade, decisor, proposta ou pagamento? Mudar uma coisa por vez conforme as respostas.
5. Medir custo/margem da primeira entrega paga antes de aumentar prospecção ou criar produtos.

## Correção da classificação e da expiração — 18/10/2026

Demanda explícita do Rômulo: corrigir classificação e expiração para não perder outros leads como Comece. As 33 mensagens disponíveis da Comece foram conferidas novamente no Dell antes da alteração. A resposta de 15/10 termina com a necessidade de verificar a proposta concorrente; o Rômulo respondeu “Ótimo, fico no aguardo”. Não há aceite, recusa definitiva ou autorização para cobrar novamente nesse fechamento.

- A fonte do CRM foi corrigida pelo n8n, somente nas seis células conferidas da linha desse lead. A classificação agora é neutra/avaliação pendente, com o último trecho original. A oferta real de R$ 90/mês, enviada em 15/10, foi registrada separadamente na aba CRM com o texto original, sem presumir escopo adicional, aceite ou pagamento. A etapa final é Proposta, aguardando comparação; o link de reenvio da oferta padrão deixou de ser sugerido. Pasta preservada em `_em-conversa/`, pausa mantida e próximo passo visível no topo da ficha.
- O classificador diferencia objeção ao canal e avaliação pendente de recusa à oferta. Há proteção determinística para os padrões testados, além da instrução ao modelo. Recusas explícitas e pedidos de exclusão continuam valendo; não se promove o lead automaticamente a interessado.
- Conversas humanas não viram perda só por sete dias de silêncio: entram em revisão de próximo passo. Classificação terminal anterior a novas mensagens humanas também gera revisão, sem rascunho ou confirmação de envio.
- A limpeza e a pausa de demos consultam a mesma proteção. Conversa humana, próximo passo, proposta, espera ou classificação pendente impedem a ação, salvo encerramento manual atual quando aplicável. Sem arquivo de conversa também preserva: histórico ausente não prova ausência de resposta. Antes de cada exclusão/pausa, há nova leitura do CRM; falha fecha a operação.
- Demo original da Comece e Raio-X restaurados no endereço anterior. A remoção foi preservada no histórico do recibo e em nota de auditoria. Somente arquivos públicos do site foram publicados; dossiê e críticas ficaram no Dell. Nenhuma mensagem foi enviada ao lead.

Validação na versão atual do Dell: **3.167 testes do aplicativo**, **68 de classificação**, **53 de limpeza**, **28 de pausa** e **13 de acompanhamento** passaram; tipos e compilação também. Na simulação com o mesmo retrato final, a regra anterior escolheria 10 demos e a nova escolheu 1: **9 demos preservadas**. A simulação não executou exclusões. Os cenários incluem resposta/compromisso chegando entre seleção e ação e CRM indisponível. Um encerramento humano posterior resolve compromissos antigos e reinicia a folga de dois dias; compromisso novo posterior volta a proteger.

O histórico continua parcial e o modelo ainda exige supervisão nos casos ambíguos. A correção impede usar essa incerteza como autorização de apagar ou pausar. Não houve reclassificação retroativa em massa.
