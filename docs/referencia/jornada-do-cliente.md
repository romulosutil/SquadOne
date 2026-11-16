# Jornada do cliente do PRUMO

> Gerado de `src/operations/jornada.ts` e `src/operations/colinha.ts` por `npx tsx scripts/jornada-guia.ts`.
> Não edite à mão: mude o código e refaça (o teste `src/operations-jornada.test.ts` falha se este arquivo ficar para trás).
> A fonte do negócio é o repositório prumo (`00-contexto/negocio.md`); os preços valem os de `04-venda/piloto-cdl/precos.json`.

**Leia isto antes de atender, escrever para, ou montar qualquer coisa para um lead do PRUMO.** Diz em que ordem as coisas
acontecem, quem faz cada passo e o que oferecer a quem. Em Vendas (`/crm`), a Ficha de cada lead mostra o passo em que ele está,
o próximo passo e o que oferecer, com estas mesmas regras.

## Conceito institucional do Prumo

- O Prumo é consultoria digital e produtos digitais. Arruma o caminho do cliente até o caixa. A entrada é pela necessidade concreta, sem uma nova marca ou diagnóstico institucional obrigatório.
- A experiência em produto, engenharia e design, com passagens por Caixa, Pay4Fun e Qintess, é de Rômulo Sutil Corrêa. Essas organizações não são clientes atribuídos ao Prumo.
- O SquadOne sustenta a operação interna. A Fonte da própria Prumo é piloto em homologação, com conclusão do aceite pendente. Vale Norte é uma demonstração fictícia. Nenhuma dessas provas comprova ganho de vendas ou economia.
- Íris: Em uso, diário de sessão e dossiê para clínicas de terapia, com revisão do terapeuta. A IA não pontua protocolos nem toma decisões clínicas. CRM de estamparia: Em implantação, conversas, clientes e pedidos; WhatsApp sujeito à homologação. Esses estados não são liberação de qualidade.
- Direção de 16/11/2026: Rômulo confirmou softban por spam após os disparos de 13/11 e autorizou a reconstrução comercial. Primeiros contatos automáticos bloqueados; reconexão não autoriza retomada. Este conceito não atesta deploy dos controles.
- Site/Encontrado e implantação delimitada de um fluxo comercial são hipóteses iniciais, não limite eterno do portfólio. SaaS tem avaliação dirigida, fora da aquisição ampla, com prontidão e comprador demonstrados. O fundador conduz descoberta e venda.
- Raio-X e Mapa são opcionais quando ajudam uma decisão suficiente. Fonte conserva método, conferência com a equipe e escopo contratado. Preços, contratos e autorizações de suporte permanecem.
- Permissão para material, resposta e demonstração não são venda. Separar cadastro, conversa, oportunidade, proposta, contratação e recebimento; avaliar economia com custos e horas observados, sem fundir empresas por telefone.

Fonte canônica: `prumo/00-contexto/organizacao.md`, `negocio.md` e `produtos.md`. Apresentação e provas: `prumo/04-venda/apresentacao/README.md`.

## O desenho

```
 NECESSIDADE → Conversa suficiente → Proposta com escopo → Aceite
                                                        ↓
 ENTREGA e conferência → Cobrança e recebimento → Suporte contratado
 Raio-X e Mapa: opcionais quando ajudam a decisão, sem passagem obrigatória.
```

Íris e estamparia têm avaliação dirigida, fora da aquisição ampla. Os passos abaixo preservam o histórico das fontes; não obrigam cada oportunidade a passar por todos eles.

## Os passos

| # | Passo | Trilho | Quem | Como | Quando o lead está aqui | O que o tira daqui | Prazo | Blueprint |
|---|---|---|---|---|---|---|---|---|
| 1 | **Achado** | Descoberta e conversa | robô | Caçador (n8n 01, 06:00: Google Places + nota do Gemini); Iris e estamparias pelos caçadores próprios (pausados desde 17/10/2026; não religar nesta rodada; acervo na Triagem); Plus pelo Catálogo de Negócios Maçônicos | O caçador gravou a empresa na planilha (ou, no Plus, no leads.json). | Uma conversa elegível confirma a necessidade; Raio-X e demonstração são opcionais quando ajudam a decisão. |  | `SITE-1`, `OFERTAS-1` |
| 2 | **Raio-X pronto** | Descoberta e conversa | robô | raio-x.py (11:15 e 17:15) e o Balcão (n8n 03, de hora em hora) marcam "pronto" e sorteiam a mensagem; no PRUMO, o Raio-X à mão (projeto prumo-raio-x) | Raio-X produzido para uma observação útil; não é requisito de toda venda nem autorização de contato. | Apresentar somente quando pertinente e no canal permitido. Material pronto não comprova interesse ou envio. |  | `SITE-2` |
| 3 | **Primeira mensagem** | Descoberta e conversa | você | Primeiros contatos automáticos bloqueados após o softban por spam de 13/11/2026. Reconexão, configuração ativa ou passagem do tempo não liberam a fila. Descoberta começa por contato elegível e necessidade, com Rômulo responsável. | Enviada (ou convite enviado), sem resposta de gente. | Resposta humana inicia descoberta. Silêncio e robô não confirmam recusa ou necessidade. Estados de expiração do histórico precisam de revisão; não autorizam retomada. | Próximo passo conforme o combinado; sem cobrança automática por silêncio. | `SITE-3`, `PRUMO-1`, `OFERTAS-3` |
| 4 | **Respondeu** | Descoberta e conversa | você | O observador lê a resposta e o Gemini classifica (interesse, neutra, negativa, robô, exclusão); você responde com o Roteiro | Respondeu e a 2ª mensagem ainda não saiu. | Atender o pedido recebido e confirmar a necessidade. Permissão para material não é compra. Recusa interrompe a abordagem; exclusão segue o procedimento de proteção dos dados. | interesse respondido em até 2 h; parado com 1 dia no passo | `SITE-4`, `OFERTAS-4` |
| 5 | **Recebeu a 2ª mensagem** | Descoberta e conversa | você | Entregar somente o material pertinente solicitado. Abrir WhatsApp não confirma envio; conferir recibo ou confirmação explícita antes de registrar. | Material realmente enviado e registrado com evidência. | Confirmar necessidade, adequação e processo de decisão. Mapa é opcional quando sua investigação ajuda a escolher o escopo. | Resposta útil ao pedido; proposta quando houver contexto suficiente, não por um "gostei".; parado com 2 dias no passo | `SITE-5`, `PRUMO-2` |
| 6 | **Conversa** | Por fora (o caminho do cliente) | você | Rômulo entende um caso real, a solução atual, quem decide e o próximo passo. Use mensagem ou reunião conforme a necessidade; não exigir ligação para uma compra simples. | A pessoa descreveu o que quer resolver ou pediu condições de uma entrega específica. | Proposta de uma entrega pertinente com escopo, condições e próximo passo; esclarecer lacunas antes de prometer. | Prazo combinado com o cliente e compatível com a capacidade de entrega.; parado com 2 dias no passo | `PRUMO-2-P1`, `OFERTAS-5` |
| 7 | **Convite para o Mapa** | Por dentro (empresa com equipe) | você | Convite do Roteiro: Mapa gratuito e opcional quando a rotina da equipe exige investigação; confirmar utilidade e aceite | A empresa tem equipe, existe necessidade de investigar regras/processos e o dono aceitou o Mapa. Não é passagem obrigatória de toda oportunidade. | O dono responde as 16 perguntas no formulário: "Mapa respondido". |  | `PRUMO-3-E1` |
| 8 | **Mapa respondido** | Por dentro (empresa com equipe) | você | O formulário dispara o fluxo "PRUMO — Diagnóstico do dono" e o prumo-mapa gera o rascunho em PDF em ~/prumo-entregas; você completa os [PREENCHER] | O dono respondeu as 16 perguntas (sinal "diagnóstico" em Vendas). | Documento completo e a devolutiva de 45 min marcada. | parado com 2 dias no passo | `PRUMO-3` |
| 9 | **Devolutiva do Mapa** | Por dentro (empresa com equipe) | você | Conversa de 45 min sobre o documento (o documento é do dono, contrate ou não) | Devolutiva marcada como próximo passo na Ficha. | Confirmar necessidade, decisão e escopo; propor a entrega pertinente quando houver contexto suficiente. | Próximo passo e prazo combinados, sem obrigação de proposta; parado com 2 dias no passo | `PRUMO-4` |
| 10 | **Proposta enviada** | Fechamento | você | Proposta de escopo definido, com preço vigente, dependências, entrega e suporte; registrar a versão e a evidência do envio. | Envio da proposta confirmado. Proposta preparada não é enviada. | Registrar aceite da versão, cobrança e recebimento como fatos distintos. Acompanhar conforme o compromisso, respeitando espera e recusa. | parado com 3 dias no passo | `SITE-7`, `PRUMO-5` |
| 11 | **Ganho** | Fechamento | você | Encontrado: no ar e pago depois de ver; Fonte: 2 semanas, 50/50; depois, as mensalidades | Ganho legado ou contratação registrada; conferir o aceite e as condições, sem inferir pagamento. | Entrega, aceite, cobrança e recebimento verificados separadamente; manutenção apenas nas condições contratadas. |  | `SITE-7-C1`, `PRUMO-5-C1` |
| 12 | **Perdido** | Fechamento | robô | Conserva recusas, exclusões, dispensas e expirações das fontes legadas. A Carteira distingue encerramento explícito de revisão por tempo. | Encerramento explícito ou estado legado que exige revisão; silêncio não comprova venda perdida. | Revisão interna preserva o histórico e não autoriza contato. Nova conversa elegível precisa respeitar recusas e contexto atual. |  | `SITE-7-B1` |

## O que oferecer a quem

1. Começar pela necessidade e pela oferta pedida. Raio-X e Mapa são instrumentos opcionais; não impedem informar condições ou contratar um serviço simples.
2. A oferta/canal do cadastro orienta uma hipótese de conversa, não confirma necessidade. Categoria pública, porte, ausência de URL e avaliações não comprovam problema, orçamento ou decisor.
3. Achados do Raio-X são contexto verificável. Nota baixa ou poucas avaliações não demonstram falha de atendimento; já ter site não implica precisar de automação, anúncios ou redes.
4. Site/Encontrado e implantação de um fluxo são as hipóteses iniciais. Não ampliar catálogo ou aquisição por inferência; outros produtos podem ganhar foco com prontidão, comprador e economia demonstrados.
5. Responder perguntas de preço diretamente com a tabela e as condições vigentes; quando houver variação, explicar o escopo. Não exigir diagnóstico, reunião ou preenchimento completo de qualificação para responder.
6. Interesse, licença e permissão para material não são compra. Preparar proposta quando necessidade, processo de decisão e escopo forem suficientes; não por um gostei isolado.
7. Mapa só quando uma investigação da rotina da equipe ajudar a decisão e o interessado aceitar. A Fonte não exige Mapa prévio como etapa comercial; mantém método e conferência com a equipe. Manutenção apenas nas condições contratadas, após os ajustes incluídos.
8. Íris e CRM de estamparia seguem conversa própria e avaliação dirigida, fora da aquisição ampla. Estado de uso/implantação não é prova de produto pronto; preservar dependências, qualidade e condições específicas.
9. Recusa, exclusão e encerramento não recebem sugestão de abordagem. Revisar expiração histórica internamente não autoriza retomada. Primeiros contatos automáticos permanecem bloqueados.

## O cardápio

| Serviço | Etapa | Tipo | O que o cliente recebe | Preço (tabela) | Para quem |
|---|---|---|---|---|---|
| **Raio-X** | ver | diagnostico | Uma página feita pelo Prumo, só com dados públicos: como a empresa aparece no Google, o que já está bom, até 3 coisas que mandam cliente para o concorrente (só as que o dado confirma) e, quando faz sentido, a demonstração do site. O dono não preenche nada. | grátis | Quando uma análise da presença pública ajuda a decidir o que fazer. Opcional, inclusive para quem já tem site; não autoriza contato. |
| **Mapa** | ver | diagnostico | O Raio-X mostra a empresa por fora; o Mapa, por dentro. O dono responde 16 perguntas (uns 10 minutos, com números aproximados informados pelo dono, sem extratos nem senhas) e recebe um documento: Índice do Prumo X/18, os 6 blocos, o que passa pelo dono, onde a informação mora, as travas estimadas e o que fazer primeiro. Mais uma conversa de 45 minutos sobre o resultado. O documento é do dono, contrate ou não. | grátis | Empresa com equipe e problema de regras ou rotina que justifique investigação. Opcional, com aceite do interessado; porte não garante retorno. |
| **Encontrado** | arrumar | produto | Site no ar com o endereço da empresa, perfil do Google revisado e botão de WhatsApp. A mensalidade cobre domínio, hospedagem e um ajuste por mês. | R$ 690 + R$ 39/mês (paga só depois de ver no ar) | Quem confirma necessidade de apresentar serviços, trabalhos e contato em um site. Ausência de URL pública não comprova essa necessidade. |
| **Respondido e Acompanhado** | arrumar | produto | WhatsApp que responde na hora, faz as primeiras perguntas e marca horário; retorno automático de orçamento parado; painel simples de quem chamou e de quem fechou. Antes e depois medidos: contamos o WhatsApp antes de ligar e mostramos a diferença em 30 dias. | R$ 2.400 + R$ 290/mês (só depois de uma conversa, nunca no WhatsApp frio) · *sob proposta para o cliente* | Quem demonstra problema no atendimento ou acompanhamento de demandas recebidas. Ter site não é requisito nem prova de necessidade. |
| **Anúncios** | arrumar | produto | Criamos e cuidamos dos anúncios no Google ou no Instagram, e todo mês mostramos quantas pessoas chamaram por causa deles. A verba do anúncio vai direto para a plataforma, sem passar pelo Prumo. | R$ 590/mês (Google ou Instagram; R$ 390 a mais pelos dois; mínimo de 3 meses) | Quem confirma necessidade de aquisição, capacidade de atendimento e orçamento de mídia. Fora da aquisição ampla desta rodada; avaliar por demanda específica. |
| **Redes sociais** | arrumar | produto | Instagram e Facebook em dia: 8 posts por mês e stories toda semana, feitos com as fotos e os serviços da empresa e publicados depois da aprovação do dono. | R$ 790/mês (mínimo de 3 meses; depois, cancela quando quiser) | Quem confirma necessidade de manter conteúdo e dispõe de material e aprovação. Fora da aquisição ampla desta rodada; perfil parado não comprova perda de vendas. |
| **Fonte** | arrumar | projeto | A construção, em cerca de 2 semanas depois da conversa sobre as regras. Na primeira, conferimos o diagnóstico suficiente com o time, usando o Mapa quando pertinente; depois, as regras da casa (como a empresa vende, compra, entrega e cobra, e quem faz o quê) saem da cabeça do dono para uma pasta no Google Drive, manual no Notion, caderno no Gemini, robô no WhatsApp ou chat próprio, conforme o escopo. Até 6 assuntos e 15 pessoas. O uso de IA e a assinatura da plataforma, quando aplicáveis, ficam à parte; a liberação do número do WhatsApp depende da Meta e pode levar até 20 dias. | R$ 1.500 (a partir de, 50/50, escopo confirmado) · *sob proposta para o cliente* | Empresa com equipe e necessidade demonstrada de regras consultáveis. Diagnóstico suficiente para definir o escopo; Mapa prévio não é obrigatório. |
| **Manutenção da Fonte** | manter | mensalidade | Incluir, mudar ou tirar regras e dados da Fonte: até 10 mudanças por mês, pedidas pelo WhatsApp e feitas em até 2 dias úteis. Começa depois dos 30 dias de ajustes; cancela quando quiser. Assunto novo inteiro tem condição própria na tabela. | R$ 190/mês (opcional, até 10 mudanças por mês, depois dos 30 dias de ajustes) · *sob proposta para o cliente* | Quem construiu a Fonte e quer mantê-la em dia. Opcional: nunca condição para fechar a Fonte. |

Fora do cardápio, ofertas próprias:

- **Iris**: Íris — Em uso. Diário de sessão e dossiê para clínicas de terapia e saúde mental. A IA organiza evidências rastreáveis, o terapeuta revisa e aprova; a IA não pontua protocolos nem toma decisões clínicas. Inclui relatório da família em PDF. O estado de uso não substitui a avaliação de qualidade da versão. Clínicas de terapia e saúde mental (aba Clínicas). Conversa própria sobre a rotina, sem exigir Raio-X ou Mapa; condições da assinatura na ficha vigente da Íris.
- **CRM de estamparia**: CRM de estamparia — Em implantação. Conversas, clientes e pedidos reunidos para quem vende camisetas e uniformes por conversa. O assistente no WhatsApp depende de liberação e homologação; o estado de implantação não substitui a avaliação de qualidade da versão. Estamparias e confecções (aba Estamparias). Confirmar necessidade, impacto, decisor, escopo, titularidade e condições próprias antes de ampliar a venda; sem inventar prazo ou preço e sem exigir Raio-X ou Mapa.

## Onde ver e onde mudar

- **Em que passo está um lead:** a Ficha em Vendas (`/crm`, bloco "Jornada"). A etapa vem do retrato das planilhas (`server/crm.ts`, a cada 10 min).
- **O funil inteiro por passo** (quem espera quem, quem está parado): o filtro Passo do Funil (`/crm?ver=funil&passo=`).
- **O texto de cada momento** (mensagens, objeções, roteiro da conversa): o Roteiro (`/mais?abrir=roteiro`, `src/operations/colinha.ts`).
- **O que roda por trás de cada passo** (robôs, travas, telas, terceiros): o service blueprint, `docs/blueprint/servico.json`; a coluna Blueprint acima dá o código do passo ou do cartão.
- **Mudou a ordem, um passo ou uma regra de oferta:** `src/operations/jornada.ts`, depois `npx tsx scripts/jornada-guia.ts`.
- **Mudou um preço ou um serviço:** `prumo/04-venda/piloto-cdl/precos.json` e o caminho descrito no `CLAUDE.md` do prumo (inclui `colinha.ts`).
