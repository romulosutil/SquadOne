# Operação comercial do piloto Prumo

Data: 23/10/2026. Objetivo: conduzir respostas elegíveis até uma contratação e um recebimento verificáveis, enquanto a operação técnica é reorganizada. Não há promessa de primeira venda em determinado prazo.

Este roteiro foi confrontado com o código local em alteração. Existência de implementação não comprova publicação no Dell, adoção pelo VENDAS/Grok ou funcionamento de todos os emissores. Este documento não envia mensagens, registra fatos de clientes ou modifica os controles em produção.

## Uma oportunidade, uma próxima ação

A conversa pode ter mais de uma oferta, mas precisa de um responsável pelo atendimento. A oportunidade conserva oferta, condições e histórico próprios. Não juntar propostas distintas só porque compartilham o mesmo WhatsApp.

Antes de qualquer ação externa, conferir a última conversa nas duas direções, envios posteriores, pausas, recusa, material prometido e responsável atual. Histórico incompleto gera uma tarefa interna de recuperação, não uma mensagem baseada em suposição. Permissão, elogio, preço solicitado, proposta, aceite e pagamento são fatos diferentes.

Para cada caso do piloto, deixar uma única ação principal com responsável, condição ou data de conferência e resultado esperado. Usar as filas existentes: **Precisa de você**, **Time em execução** ou **Aguardando cliente**. Uma data interna de revisão não autoriza retomar o contato nem equivale a reunião aceita.

## Qualificação suficiente para a próxima decisão

Perguntar uma coisa de cada vez e aproveitar o que já foi respondido. Não exigir ligação para responder uma pergunta simples nem produzir diagnóstico adicional para todo interessado.

| Informação | Evidência suficiente | O que não basta |
|---|---|---|
| Necessidade | A pessoa descreve algo que quer resolver ou obter; registrar a frase e a data. | Nossa análise do Google, silêncio ou dor sugerida pelo agente. |
| Adequação | A entrega proposta atende à necessidade e às restrições conhecidas; dependências e limites estão claros. | Produto pronto ou demo bonita sem relação com a necessidade. |
| Intenção | Quer entender condições, avaliar uma solução, receber uma proposta específica ou contratar. | Saudação, identidade confirmada ou licença para enviar material. |
| Decisão | Quem participa, o que precisa ser comparado e como chegarão à decisão estão esclarecidos. | Presumir que o nome no WhatsApp é o decisor. |
| Próximo passo | Ação compreensível e responsável; quando depender do cliente, registrar seu aceite da ação/data. | Pedido nosso sem resposta ou tarefa interna vencida. |

Guardar o fato e a referência da mensagem; separar interpretação e dúvida. Use o formulário de qualificação da ficha para os cinco itens e sua evidência. O exemplo legível abaixo serve para organizar a conferência, sem inventar campos confirmados nem uma base paralela:

```text
Qualificação do piloto — oferta: {oferta}
Necessidade: {frase confirmada ou desconhecida}
Adequação: {entrega pertinente e dependências a conferir}
Intenção: {fala recebida e data}
Decisão: {pessoas/processo confirmados ou lacuna}
Próximo passo: {ação, responsável, aceite/condição e conferência}
Evidência: {referência das mensagens; sem senhas ou dados bancários}
```

Impacto pode ser qualitativo: por exemplo, o cliente relata ter de explicar as mesmas informações várias vezes. Não inventar economia, receita perdida, urgência ou orçamento. Se o cliente ainda não conhece o efeito do problema, registrar a lacuna e perguntar somente se isso ajudar a escolher a entrega.

### Regra implementada de qualificação

A ficha registra a revisão humana estruturada de necessidade, adequação, intenção, participantes/processo de decisão e próximo passo aceito, com fonte e evidência. A nota nova governa inclusive quando parcial, negativa ou inválida. O SPICED permanece apenas como compatibilidade de oportunidades ainda sem revisão nova. Não exigir impacto financeiro, reunião nem um único decisor. Os agentes recebem somente o resumo dos critérios e a pergunta faltante; notas privadas e referências de documentos não são copiadas ao contexto comercial do modelo.

O atendimento assistido usa o mesmo formulário e os marcos versionados. A classificação técnica do n8n nunca preenche uma revisão humana nem confirma aceite ou pagamento. Veja `PRUMO-INTEGRACAO-COMERCIAL-N8N-AGENTES-2026-10-23.md` para publicação e limites.

## Sequência de uma oportunidade

| Passo | Trabalho e responsável | Registro e critério de avanço |
|---|---|---|
| Resposta recebida | Time identifica o pedido, a oferta e quem falou; confere se há material devido ou restrição. | Entrada com data/direção; pergunta atendida ou tarefa de recuperação atribuída. |
| Descoberta | Time prepara uma pergunta curta sobre o que falta na qualificação; Rômulo intervém nas exceções. | Resposta literal e lacuna restante. Permissão não vira compra. |
| Apresentação pertinente | Mostrar apenas a entrega relacionada à necessidade, no formato permitido. Conferir demo antes de afirmar que existe. | Material realmente enviado e pergunta seguinte coerente; abrir WhatsApp não confirma envio. |
| Passagem ao Rômulo | Escalar intenção de contratar, preço fora das condições aprovadas, desconto, negociação, escopo incerto ou dúvida de pagamento. | Resumo pronto e responsável confirmado na fonte. Aviso emitido não significa repasse recebido. |
| Proposta preparada | Rômulo confirma oferta, escopo, prazo/dependências, valores, recorrência, suporte e condição de cobrança. | Evento `proposta` com referência e versão. Preparada não significa enviada. |
| Proposta enviada | Entregar a versão exata no canal permitido; esclarecer comparação e decisão. | `proposta_enviada` ligado à versão e à evidência do envio. Sem resposta, registrar espera ou condição de revisão. |
| Aceite/contratação | Rômulo confirma quem aceitou, a qual versão e sob quais condições. Documento comercial precisa refletir o combinado. | `aceite` ligado à proposta enviada, com evidência e referência do documento. “Gostei”, “ok” a um aviso ou pedido de informação não bastam. |
| Cobrança | Rômulo confere que a condição de cobrança foi cumprida e combina forma/vencimento. | `cobranca` ligada ao aceite. Para Encontrado, exigir também `entrega_vista`. Não presumir taxa inicial para todas as ofertas. |
| Recebimento e início | Rômulo verifica o recebimento real e seu vínculo; time prepara o início conforme as condições contratadas. | `pagamento` ligado à cobrança, referência única e saldo. Registrar responsável/dependências da entrega; cobrança enviada ou comprovante recebido não substituem conferência do recebimento. |

### Resumo mínimo da passagem

```text
Precisa de Rômulo: {decisão concreta}
Cliente/oferta: {referência interna}
Necessidade e intenção: {evidência recebida}
Material já entregue: {referência ou pendência}
Quem decide e como: {confirmado ou lacuna}
Condições já oferecidas: {versão real; não substituir pelo catálogo atual}
Próximo compromisso: {aceito ou ainda não combinado}
Situação do atendimento: {time aguardando / Rômulo assumiu na fonte}
```

O controle de responsável existente vale para as oportunidades do mesmo número. “Assumir conversa” deve ser confirmado no retrato antes de considerar a passagem concluída. O próprio componente informa que a interrupção alcança **as rotinas que consultam esse controle**. Não pressupor que a VM externa o consulta; enquanto isso não estiver verificado, a pausa desse emissor deve ser conferida na própria rotina. Liberação ao time é explícita e não amplia a autorização de preço.

## Rascunhos para descoberta e apresentação

Todos os textos abaixo são rascunhos para a etapa indicada. Escolher um conforme a resposta atual; não enviar as linhas como sequência automática. Substituir chaves somente por fatos conferidos. Não expor instruções internas ao cliente.

| Oferta | Necessidade / descoberta | Adequação e apresentação, depois da resposta |
|---|---|---|
| Site | “Hoje, o que você gostaria que uma pessoa conseguisse encontrar ou fazer no site da empresa?” | “Pelo que você explicou, o site precisa ajudar com {necessidade}. Posso mostrar {demo ou material realmente disponível} para você conferir se atende?” |
| Automação de WhatsApp | “Quando chega uma mensagem e ninguém pode atender, como vocês fazem para responder e acompanhar depois?” | “Podemos avaliar a automação de {etapa confirmada}, com encaminhamento para uma pessoa em {exceções}. Antes de fechar, precisamos conferir {integração ou dependência real}. Isso corresponde ao que você precisa?” |
| Tráfego pago | “Qual serviço vocês querem divulgar e como atendem quem chama depois de ver o anúncio?” | “O escopo pode incluir {canal e trabalho aprovados}. A verba de mídia fica separada da gestão. Posso detalhar o trabalho e como vamos acompanhar os contatos?” |
| Redes sociais | “O que está mais difícil hoje: manter as informações atualizadas, produzir conteúdo ou organizar as aprovações?” | “Para {necessidade confirmada}, podemos propor {escopo aprovado}, com fotos/informações de vocês e aprovação antes da publicação. Quem participaria dessa aprovação?” |

Se a pessoa pediu preço, responder à pergunta com a condição aprovada aplicável; não esconder preço atrás de um questionário. Se o valor depende do escopo ou há conflito com oferta histórica, levar a Rômulo antes de afirmar um número. Pedido de formato específico, como imagens no WhatsApp sem link, prevalece sobre o template de apresentação.

## Rascunhos comuns para decisão, proposta e recebimento

Estes textos servem às quatro ofertas acima; os trechos específicos impedem generalizar condições do site para os demais serviços.

| Etapa | Rascunho e condição de uso |
|---|---|
| Intenção e decisão | “Você quer avaliar essa solução para contratar agora ou está conhecendo as opções? Quem mais participa dessa decisão?” Usar a primeira ou a segunda pergunta, conforme a lacuna; não repetir o que já foi informado. |
| Comparação | “Qual ponto vocês precisam comparar para decidir: o que está incluído, a forma de pagamento ou o acompanhamento?” Somente quando o cliente já informou que está comparando. Não desqualificar concorrente nem inventar urgência. |
| Passagem externa | “Vou levar {dúvida ou condição} ao Rômulo para ele confirmar com você. O que já combinamos está registrado.” Não prometer horário de retorno sem capacidade confirmada; o repasse interno precisa ocorrer. |
| Proposta | “Organizei a proposta de {oferta} para atender {necessidade}: {escopo}, com {prazo e dependências}, por {valor e recorrência aprovados}, nas condições {condições}. Está em {referência da versão}. O que ainda precisamos esclarecer para vocês decidirem?” Só usar com todos os dados confirmados e conteúdo realmente enviado. |
| Proposta de site | Acrescentar: “Você só paga depois de ver o site funcionando no ar, conforme a proposta.” Não aplicar isso como entrada zero ou regra financeira de automação, tráfego ou redes. |
| Proposta de automação | Explicitar implantação, recorrência, limites, integrações, atendimento humano e eventuais custos externos conforme o escopo real. “O funcionamento inclui {fluxos aprovados}; situações fora disso vão para {responsável confirmado}.” |
| Proposta de tráfego | “A gestão inclui {escopo}. A verba de anúncios é {condição combinada}, separada do nosso serviço.” Não confundir investimento em mídia com receita da Prumo. |
| Proposta de redes | “A entrega inclui {conteúdos e frequência aprovados}. Para começar, precisamos de {materiais e aprovação}; a condição de pagamento é {condição confirmada}.” Não reutilizar quantidade de posts de outra proposta. |
| Aceite | “Para confirmar o que combinamos: vocês aprovam a proposta {referência/versão}, com {escopo resumido}, {valores/recorrência} e {condições}? Se faltar algum ajuste, me diga antes de começarmos.” Envio dessa pergunta não é aceite; registrar a resposta real e quem a deu. |
| Site visto no ar | “O site está em {endereço conferido}. Conseguiu abrir e conferir {itens combinados}? Há algum ajuste do escopo antes de seguirmos com a cobrança?” Não registrar `entrega_vista` só porque a página existe ou porque nós a abrimos. |
| Cobrança | “Conforme a proposta {versão} e {condição já cumprida}, o valor desta cobrança é {valor}, com vencimento em {data} e pagamento por {forma combinada}. Está em {referência}. Ficou alguma dúvida sobre essa cobrança?” Usar somente após os requisitos; não escolher provedor ou forma pelo cliente. |
| Pagamento recebido | “Confirmamos o recebimento de {valor} referente a {cobrança}. O próximo passo é {ação}, com {responsável e dependências}. {Saldo ou próxima cobrança somente se aplicável e combinado}.” Enviar apenas depois de verificar o recebimento; nunca pedir senha, cartão ou dado bancário sensível na conversa. |
| Espera | “Combinado, vamos aguardar {condição informada pelo cliente}.” Data só entra se tiver sido combinada. Silêncio não autoriza desconto, nova oferta ou retomada de hora em hora. |

## Condições históricas preservadas

**ControEco:** Rômulo confirmou que ofereceu R$ 500/mês e site sem implantação. É evidência de condição histórica real, não proposta aceita, contratação, pagamento nem autorização atual de retomada. Antes de qualquer ação, conferir a conversa mais recente, os sócios envolvidos, o escopo abrangido pelo valor, verba de mídia, prazo e cobrança. Não substituir pelo catálogo atual, somar serviços por suposição ou cadastrar o pacote como aceito. Registrar o conteúdo efetivamente oferecido com sua data/versão somente após conferir a referência.

**Comece:** preservar a proposta histórica de R$ 90/mês e a avaliação conjunta/comparação registrada. Não aplicar a condição a outros contatos e não retomar por vencimento de uma revisão interna.

**Roda Mais:** respondeu diagnóstico e elogiou o resultado; isso não comprova intenção de contratar. Preservar a pausa e conferir eventual reabertura real. Não colocá-la no piloto como compradora confirmada.

Nenhuma ficha de cliente foi alterada para produzir este roteiro.

## O que existe no código e o que falta validar

| Implementação local observada | Capacidade e limite |
|---|---|
| `src/operations/ciclo-comercial.ts` | Eventos versionados de proposta preparada, enviada, aceite, entrega vista, cobrança, pagamento, trabalho e correção, em notas da aba CRM. Valida vínculos, datas, versões, saldo e referência de recebimento; não é confirmação automática do banco nem documento jurídico definitivo. |
| `src/operations/CrmCicloComercial.vue` | Formulário de fatos confirmados e responsabilidade da conversa. Aguarda o evento aparecer no retrato; falha ambígua impede repetição imediata. Não gera proposta pronta, detecta sozinha o aceite ou efetua cobrança. |
| `src/operations/responsavel-conversa.ts` | Projeta o responsável compartilhado entre ofertas no mesmo número. Ainda exige comprovar que cada emissor real consulta esse controle. |
| `server/crm.ts` / `server/ciclo-comercial.ts` | Integram validação das notas estruturadas na escrita existente. Exigem conferir a versão instalada e um percurso completo de persistência/retorno antes de declarar o ciclo homologado. |
| `src/operations/spiced.ts` / `mandar-proposta.ts` | Evidência de qualificação confirmada pelo operador e gate de dor/impacto/decisor. A adequação ao novo critério de qualificação ainda requer alteração explícita de regra e testes; este roteiro não altera esse gate. |
| `src/office/missao.ts` | Marco visual deixou de usar preço do template atual como prova de proposta histórica; registros explícitos continuam válidos. Trecho ausente não é recuperado por inferência. Não confundir o marco legado com o novo ciclo de documentos versionados. |

Faltam fechar, em lotes pequenos: integração entre o novo ciclo e os indicadores/etapas legados; regra de qualificação suficiente sem preenchimento fictício; preparação assistida de proposta com condições reais; comprovação de responsabilidade e pausa em todos os emissores; evidência durável de compromissos cumpridos, além do horário de uma saída. A UI atual é um registro manual de fatos, não a implementação completa do vendedor autônomo desejado.

A validação financeira do código não substitui revisão do combinado: periodicidade, competência, parcelamento, composição de pacote e custo externo precisam estar escritos no documento. Não lançar a mesma entrada de dinheiro tanto no ciclo novo quanto no registro legado de recebimento; conferir ambos e corrigir explicitamente um erro antes de repetir. Valores desconhecidos não viram zero apenas para completar o formulário.

## Piloto e critérios de conclusão

Escolher de três a cinco conversas elegíveis com necessidade ou intenção real e contexto recuperável. Não preencher quantidade retomando pausados. Ofertas vendáveis continuam disponíveis; não esperar reconstruir o portfólio para atender uma oportunidade.

Para cada caso, conferir:

- Necessidade, adequação, intenção, decisão e próximo passo têm evidência ou lacuna explícita.
- Há um responsável atual e os emissores concorrentes respeitam a passagem ou permanecem pausados de forma verificada.
- Material prometido está entregue ou tem tarefa e responsável; uma saída qualquer não conclui a promessa.
- Proposta preparada, conteúdo enviado, aceite, cobrança e recebimento são separados e vinculados.
- Condições do site e exceções históricas foram preservadas; desconto novo exige decisão do Rômulo com escopo e custo considerados, sem liberdade irrestrita do modelo.
- Cada caso está em avanço comprovado, espera justificada ou encerramento fundamentado. Nenhum tem ação duplicada nem tarefa sem responsável.

Medir contatos distintos, tempo até resposta útil quando houver horários confiáveis, oportunidades qualificadas pelo critério declarado, propostas realmente enviadas, aceites, cobranças e pagamentos confirmados. Mostrar também histórico ausente e pendências. Recorrência contratada, caixa recebido pela Prumo e vendas realizadas pelo cliente são números diferentes; não somar eventos duplicados nem projetar mês a partir de teste curto.

## Fontes de trabalho

- Código local: `src/operations/ciclo-comercial.ts`, `CrmCicloComercial.vue`, `responsavel-conversa.ts`, `spiced.ts`, `mandar-proposta.ts`, `proxima-venda.ts`; `server/crm.ts` e `server/ciclo-comercial.ts`.
- Jornada gerada: [jornada-do-cliente.md](referencia/jornada-do-cliente.md). Alterações futuras do funil devem ir à fonte em código antes de regenerar o guia.
- Fontes da Prumo no checkout irmão: `../prumo/00-contexto/negocio.md`, `organizacao.md` e `../prumo/04-venda/piloto-cdl/precos.json`. Condições históricas confirmadas pelo Rômulo não são sobrescritas por preços padrão.
- Regras do repositório: [RULES.md](../RULES.md), especialmente acompanhamento observado, qualificação, cadência e medição comercial. A orientação nova do usuário governa a evolução; divergências de implementação estão explicitadas acima, sem declarar concluída a mudança.
