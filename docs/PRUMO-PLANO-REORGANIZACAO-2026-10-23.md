# Plano de execução por fases — primeira venda da Prumo
Data: 23/10/2026. Base: diagnóstico do comitê, inspeção do Dell e entrevista com Rômulo.
Status: execução iniciada neste chat em 23/10/2026, por autorização de Rômulo, com subagentes de escopo delimitado. Publicações e testes são registrados por lote; início de execução não significa implantação concluída.

## Diretriz obrigatória — preservar o escritório

Preservar o escritório isométrico existente, sua identidade visual, cenário, personagens/sprites, mesas, quadros, câmera e navegação. As melhorias comerciais devem utilizar os quadros, indicadores e painéis já existentes. Não substituir o escritório por um dashboard nem remover o cenário como consequência da reorganização das filas.

As três filas da fase 2 são agrupamentos operacionais, não uma exigência de três novas telas. “Minhas decisões” apresenta o que depende de Rômulo; “Decisões dos agentes” apresenta execução, resultados e bloqueios. A espera do cliente fica identificada nos painéis e detalhes apropriados, com condição de revisão.

Cada lote valida abertura dos quadros, seleção dos personagens, acesso aos painéis, retorno ao escritório e uso no celular. Mudanças visuais indispensáveis devem ser pontuais e coerentes com os componentes existentes. Redesenho integral fica fora deste plano.

Rômulo passou o prompt de transição e encaminhou o retorno do VENDAS/Grok declarando a campanha horária e as revisões de 9h30/15h30 pausadas, sem envios pendentes sob seu controle. Registrar como pausa declarada pelo agente; não houve inspeção independente da interface da VM. A base do Grok não está sincronizada ao CRM e essa pausa não controla os emissores do Dell.

Esta execução passa a ser coordenada neste chat. Antes de editar, conferir alterações locais e entregas já realizadas para evitar sobreposição com trabalhos anteriores.

## Objetivo e escopo

Colocar em funcionamento o caminho resposta do lead → qualificação → apresentação → negociação humana → proposta → aceite/contratação → cobrança → pagamento confirmado, respeitando o momento de cobrança de cada oferta.

A primeira venda nova pode acontecer durante o primeiro bloco. A refatoração completa, a unificação de caçadores, a aprovação de API oficial e a revisão de todos os produtos não são pré-requisitos para conduzir uma oportunidade atual. O prazo de venda depende da decisão do cliente; os prazos abaixo estimam esforço de execução.

O escritório deve responder:
1. O que aconteceu e qual é a evidência?
2. O que já foi feito e o que o time fará em seguida?
3. O que depende de Rômulo, por que agora e qual ação resolve a pendência?

## Responsabilidades previstas

- **Rômulo:** condições comerciais, escopo, descontos, negociação, aceite da passagem, contratação, confirmação de recebimento e configuração do VENDAS na VM.
- **Engenharia/Codex:** corrigir regras, implementar estado e fila, ajustar workflows e agentes, preservar dados, testar e publicar por etapas.
- **Comitê de RevOps e automação:** validar critérios comerciais, mensagens, divisão de responsabilidades e evidências dos marcos.
- **Agente comercial de produção:** perguntar somente o que falta, esclarecer e apresentar a oferta aprovada, registrar fatos e encaminhar decisões humanas.
- **Código determinístico:** identidade, deduplicação, permissões, preços aprovados, pausas, responsável, vencimentos, transições e confirmação de eventos.

As várias personas não precisam gerar várias chamadas de modelo para responder ao mesmo cliente.

## Fases e dependências

| Fase | Entrega | Esforço inicial estimado | Dependência |
|---|---|---:|---|
| 0 | Referência de mudança e controle dos executores | 1–2 h | Nenhuma |
| 1 | Caminho comercial mínimo até pagamento | 3–6 h | Controle da fase 0; pode ocorrer junto às correções urgentes |
| 2 | CRM confiável com próxima ação clara | 1–2 dias de trabalho | Fases 0 e 1 |
| 3 | Atendimento e qualificação pelo n8n/agente | 1–2 dias | Estado, responsável e catálogo das fases 1 e 2 |
| 4 | Simplificação dos fluxos ativos e dos modelos | 1–2 dias | Piloto rastreável das fases 2 e 3 |
| 5 | Prospecção comum e expansão por oferta | 1–2 dias iniciais, depois revisão semanal | Atendimento e fechamento demonstrados |

Uma fase termina por critérios funcionais e resultados observados. O plano não fica parado esperando que um cliente compre para corrigir problemas conhecidos. A venda real é acompanhada continuamente desde a fase 1.

## Fase 0 — definir referência e impedir atuação concorrente

### Entregas

- [ ] Registrar a versão compilada e as fontes do Dell, diferenças com o PC e mudanças paralelas que afetam o caminho comercial.
- [ ] Guardar cópias restauráveis dos workflows e arquivos alterados, com segredos mantidos no ambiente privado.
- [ ] Identificar todos os emissores: Rômulo, frente comercial do Dell e VENDAS/Grok. Registrar quem pode iniciar contato, responder, apresentar e negociar.
- [ ] Propor e aplicar na VM a transição do VENDAS para consulta/rascunho durante o piloto, retirando a recuperação horária e a negociação/envio autônomos do caminho compartilhado.
- [ ] Rômulo confere as tarefas efetivamente configuradas na VM e registra quais foram desativadas. A promessa do agente no chat não substitui essa conferência.
- [ ] Manter os limites e pausas existentes do Dell. Nenhum caçador pausado é reativado nesta fase.
- [ ] Definir uma referência comum de catálogo e política comercial, com versão e data.

### Aceite

Sabemos qual executor atende cada conversa, o que está ativo e como desfazer a próxima entrega. A equipe não presume que o CRM controla a VM.

### Reversão

Restaurar a versão técnica anterior, conservando mensagens e fatos novos. Retomar atendimento manual pelo WhatsApp com o mesmo registro comercial. A reativação de tarefas da VM é uma ação separada e explícita.

## Fase 1 — preparar e conduzir uma oportunidade até receber

Essa fase começa antes de redesenhar toda a interface.

### 1. Preparar o pacote comercial da oportunidade

- [ ] Escolher a oferta adequada à necessidade observada, entre as que podem ser entregues.
- [ ] Definir escopo, entregáveis, limites relevantes, prazo, preço, recorrência, dependências do cliente e suporte.
- [ ] Estimar horas e custos externos daquela entrega para estabelecer uma condição comercial consciente. Usar a tabela como referência; condições históricas permanecem preservadas.
- [ ] Preparar uma apresentação curta e uma proposta revisável.
- [ ] Preparar o documento de contratação e o registro de aceite com versão, escopo, preço e condição combinada.
- [ ] Definir quem informa a forma de pagamento, como Rômulo verifica o recebimento e quem inicia a entrega.
- [ ] Para Encontrado, conservar a condição de pagamento após ver o site funcionando/no ar. Para as demais ofertas, explicitar a condição da contratação; não impor entrada universal.
- [ ] Registrar separadamente aceite, valor contratado, vencimento, pagamento parcial/integral e primeiro recebimento.

O documento de contratação deve ser validado para uso antes de ser apresentado como instrumento definitivo. Nesta fase o plano organiza o trabalho; não oferece um modelo jurídico pronto.

### 2. Qualificação mínima

Registrar, com trecho ou fato de origem:
- necessidade concreta;
- adequação da oferta;
- intenção de avaliar ou contratar;
- quem participa da decisão;
- próximo passo aceito.

O agente pergunta somente o que falta, uma pergunta por vez. Pedido de preço, proposta ou contratação gera passagem imediata com as lacunas identificadas. Não é necessário forçar uma reunião ou inventar impacto financeiro para completar uma ficha.

### 3. Iniciar o piloto comercial

- [ ] Separar de três a cinco conversas elegíveis com abertura atual; não completar o lote com recusas, pausas ou compromissos futuros.
- [ ] Conferir a conversa atual antes de qualquer retomada.
- [ ] Preparar o próximo passo de cada caso, com responsável e condição/prazo.
- [ ] Responder, entregar o prometido, esclarecer a decisão e propor um avanço concreto.
- [ ] Rômulo conduz negociação e fechamento; o agente prepara o resumo e a proposta.
- [ ] Acompanhar o retorno enquanto a engenharia corrige o restante.

Referências para conferência, sem disparo automático:
- **ControEco:** existe interesse expresso em tráfego e decisão com sócios. Preservar R$ 500/mês e a condição de site sem implantação, se ainda vigentes; esclarecer o restante do escopo e a mensalidade do site.
- **Comece:** preservar a condição histórica de R$ 90/mês e a espera registrada; revisão não autoriza cobrar novamente.
- **Roda Mais:** diagnóstico respondido e elogiado; investigar necessidade somente se houver reabertura legítima, sem presumir intenção de compra.

### Aceite

Uma oportunidade pode percorrer o caminho inteiro até o recebimento, mesmo com registro manual nos pontos ainda não automatizados. Existe uma proposta concreta, um mecanismo de contratação e uma forma verificável de confirmar o pagamento.

A venda real é marcada somente com os fatos correspondentes. Uma simulação completa valida o fluxo técnico, mas não conta como primeira venda.

## Fase 2 — tornar o CRM confiável e acionável

### Estado comercial mínimo

Conservar Sheets/aba CRM como fonte comercial nesta entrega. Acrescentar somente campos/eventos necessários e atualizar API, validadores, geradores do n8n e projeção no mesmo pacote.

Separar:
- **etapa comercial:** conversa, qualificação, proposta, decisão e contratação;
- **trabalho atual:** responsável, tarefa, condição e prazo;
- **situação financeira:** cobrança prevista, vencimento, recebido e eventual correção.

Manter a compatibilidade com as etapas existentes. O aceite da contratação e o pagamento são eventos diferentes. Preservar IDs, ofertas e condições anteriores.

Uma conversa pode envolver mais de uma oferta; a identificação de conta/contato não deve apagar oportunidades distintas. Ainda assim, uma única pessoa ou executor assume o envio naquela conversa em cada momento.

### Correções prioritárias

- [ ] Corrigir “já tenho um sistema, mas quero contratar outro” e variações contextuais que hoje caem em recusa.
- [ ] Exigir evidência do conteúdo enviado para marcar proposta; template atual não comprova envio passado.
- [ ] Separar resposta enviada de material entregue e compromisso cumprido.
- [ ] Preservar interesse histórico mesmo quando a última resposta é “ok”.
- [ ] Sinalizar oferta comercial observada ainda não registrada, para conferência, sem transformar qualquer menção de preço em proposta.
- [ ] Tornar a atualização do retrato consistente, com publicação atômica ou mecanismo equivalente.
- [ ] Confirmar gravação na fonte antes de apresentar sucesso; resultado ambíguo bloqueia repetição automática.

### Tela de trabalho — melhorar os painéis e preservar o escritório

Organizar o trabalho em três agrupamentos dentro da interface existente, preservando o escritório, seus personagens e seus acessos:
1. **Precisa de você:** negociação, desconto, escopo, contratação, pagamento ou caso realmente ambíguo.
2. **Time em execução:** o que foi iniciado, resultado esperado e quando será conferido.
3. **Aguardando cliente:** motivo da espera, combinado e condição da próxima revisão.

Cada ação principal mostra cliente, pedido, última ação comprovada, responsável, próxima ação e motivo. A ficha completa fica disponível para aprofundamento, sem ser uma etapa obrigatória em todos os casos.

“Minhas decisões” continua sendo a entrada para pendências humanas. “Decisões dos agentes” continua sendo a entrada para o trabalho do time. Ajustar os painéis abertos por esses acessos para distinguir execução, espera do cliente e bloqueio. Não criar uma home substituta nem trocar a composição visual do escritório.

Robôs, número indisponível e verificação de cadastro têm uma fila própria de conferência. O código ou agente resolve o que puder; pede ajuda humana com uma pendência específica.

### Aceite

Rômulo entende quem precisa dele e executa a próxima ação a partir dos quadros e painéis existentes, sem investigar o escritório inteiro. Após uma ação, a interface distingue execução, confirmação, espera e erro. Registros originais continuam consultáveis. Cenário, personagens, câmera e navegação permanecem funcionais e visualmente preservados.

### Verificação

Casos mínimos: recusa, intenção de trocar fornecedor, permissão, robô, áudio sem conteúdo conhecido, material prometido, proposta histórica, “ok” posterior à proposta, pagamento parcial e repetição de evento.

Conferir também o escritório no desktop e no celular: renderização, cliques nos quadros e personagens, abertura e fechamento de painéis e retorno à sala. Comparar com a referência visual anterior ao lote.

### Reversão

Desligar a nova projeção/fila e retornar à anterior; manter todos os eventos comerciais novos acessíveis. Correção não apaga o fato original.

## Fase 3 — automatizar a resposta, a qualificação e a passagem

### Organização lógica do n8n

1. Receber e persistir o evento.
2. Identificar conta, contato e oportunidade.
3. Carregar contexto atualizado e restrições.
4. Classificar e decidir a próxima ação.
5. Preparar ou executar uma ação permitida.
6. Registrar evidência, atualizar a fila e avisar o responsável.

Pode haver subfluxos. Cada responsabilidade tem entrada, saída, dono, erro e condição de repetição identificáveis.

### Contrato dos eventos

- [ ] Usar ID original, origem, conta, tipo do evento e horário.
- [ ] Diferenciar envio, entrega, leitura, resposta, proposta e pagamento.
- [ ] Deduplicar repetições do mesmo evento sem eliminar eventos distintos da mesma mensagem.
- [ ] Persistir antes de confirmar recebimento; permitir recuperação de pendências após reinício.
- [ ] Em envio ambíguo, reconciliar o recibo antes de tentar novamente.
- [ ] Relê pausa, recusa, responsável, contexto e condições imediatamente antes de enviar.

### Autonomia do agente

**Pode:** esclarecer catálogo aprovado, perguntar o que falta, apresentar uma solução aderente, entregar material já solicitado e propor um próximo passo dentro da política.

**Passa para Rômulo:** intenção de contratar, negociação, desconto, escopo personalizado, conflito entre condições, informações de pagamento e decisão ambígua.

O agente não inventa preço, data de reunião, material entregue ou pagamento confirmado. Regras de propriedade, catálogo, estados e preços são aplicadas pelo código.

### Passagem recebida

- [ ] O pedido de passagem carrega contexto, necessidade, oferta, dúvidas, condição já oferecida e decisão solicitada.
- [ ] Usar inicialmente o Telegram existente com link direto à oportunidade, mais a fila do SquadOne.
- [ ] Rômulo confirma que recebe esse aviso na prática. O chat do Grok não conta como canal de entrega.
- [ ] “Assumir conversa” altera o responsável e interrompe as rotinas de envio do agente naquela conversa.
- [ ] Meta interna inicial: assumir em até 15 minutos no expediente combinado; medir e ajustar. Isso não é promessa de prazo ao cliente.
- [ ] Fora do horário, conservar a pendência e respeitar as condições de atendimento definidas.

### Piloto e aceite

Começar com rascunhos revisados e ampliar para respostas restritas ao catálogo após a validação. Negociação e fechamento continuam humanos.

No piloto de três a cinco conversas elegíveis:
- nenhuma ação concorrente na mesma conversa;
- pedidos recebidos e materiais prometidos têm conclusão verificável;
- cada oportunidade tem responsável e próxima condição;
- o pagamento pode ser confirmado sem depender de nova integração bancária;
- falha e reinício preservam o trabalho e não provocam reenvio ambíguo.

O piloto usa a integração existente, sem ampliar ritmo de primeiros contatos nem depender de uma aprovação futura da Meta.

### Reversão

Desligar somente o envio automático novo. Continuar com captura, registro, fila, sugestões e atendimento manual. Não reativar VENDAS ou caçadores como efeito colateral.

## Fase 4 — simplificar fluxos ativos e racionalizar os modelos

### n8n e acesso aos dados

- [ ] Compartilhar a resolução de contato e a leitura de contexto entre os fluxos de WhatsApp.
- [ ] Evitar releitura das quatro abas completas a cada evento quando um índice/cache derivado, atualizado e reconstruível puder atender.
- [ ] Manter a fonte comercial identificável; cache não vira segunda fonte editável.
- [ ] Unificar regras de classificação, próxima ação, prazo e confirmação hoje repetidas entre interfaces e executores.
- [ ] Tornar o caminho de gravação → projeção → tela observável, incluindo estado atrasado ou indisponível.
- [ ] Corrigir nomes de nós e documentação que identificam o provedor errado.
- [ ] Manter workflows gerados a partir de fonte versionada para que uma regeneração não apague correções.

### Modelos e agentes

- [ ] Um motor principal por tarefa; fallback só quando necessário.
- [ ] IA para interpretação e redação; código para regras, preço, permissão, estado e confirmação.
- [ ] Reaproveitar contexto e sugestão por versão/hash quando ainda válidos.
- [ ] Medir modelo efetivo, chamadas, tentativas, duração, custo disponível e resultado por tarefa.
- [ ] Revisar GPT/Luna, Gemini e Jev por função e resultado, sem assumir que três opiniões são necessárias para cada resposta.
- [ ] Experimentos em sombra recebem pergunta, responsável e data de revisão; manter somente os que sustentam uma decisão de melhoria.

### Agenda e Telegram

Manter uma fronteira clara entre organizar uma tarefa e executá-la comercialmente. O bot de avisos comerciais pode compartilhar transporte, mas agenda, lembretes e turnos não precisam entrar no atendimento do lead.

Tratar durabilidade da fila, timeout do Calendar e reserva entre UI/Telegram como correções próprias, com testes de falha e reinício.

### Aceite

O mesmo evento percorre um caminho compreensível, com menos leituras redundantes e sem duplicar ações. Comparar com o comportamento e tempos anteriores; registrar medição antes/depois, sem inventar percentual de economia.

### Reversão

Trocar uma responsabilidade por vez, com versão anterior disponível, preservando filas e eventos pendentes.

## Fase 5 — consolidar prospecção e ampliar por oferta

### Entregas

- [ ] Extrair o mecanismo comum dos caçadores: busca, normalização, identificação, deduplicação e persistência.
- [ ] Configurar por oferta público, sinais, critérios, regiões e material de apresentação.
- [ ] Preservar critérios específicos de Íris, Estamparia, Site e demais ofertas.
- [ ] Conectar a seleção ao que foi aprendido nas conversas e às perdas explicitamente apuradas.
- [ ] Documentar mensagens por oferta e etapa: apresentação, descoberta, demonstração, passagem, proposta e retomada.
- [ ] Revisar capacidade de atendimento antes de reativar cada caçador.
- [ ] Manter limites e pausas vigentes até uma decisão específica; silêncio não é prova suficiente para descartar um público.
- [ ] Definir limite total e condição de parada das retomadas, além de recusa: compromisso futuro, pausa, proposta em análise e responsável humano interrompem sequências incompatíveis.

### Aceite

Uma nova oferta utiliza o mecanismo comum com seus critérios, sem duplicar o fluxo inteiro. O aumento de aquisição cabe na capacidade comprovada de resposta, negociação e entrega.

### Reversão

Pausar a aquisição da oferta afetada, conservando dados, conversas, configurações e capacidade de atender quem já respondeu.

## Indicadores do ciclo inicial

1. Respostas com atendimento pendente.
2. Tempo até resposta útil e até o humano assumir.
3. Oportunidades com necessidade e decisão esclarecidas.
4. Propostas efetivamente entregues.
5. Próximos passos aceitos, em vez de apenas sugeridos.
6. Contratações aceitas.
7. Primeiro pagamento confirmado e valor recebido.
8. Ações concorrentes, envios ambíguos e pendências perdidas.

Separar receita contratada, recorrência e recebimentos. Os resultados online da Silmer e a remuneração já existente não contam como primeira venda nova desta operação.

## Primeiro bloco de execução

**Fases 0 e 1, com correções urgentes da fase 2 em paralelo:**
- conferir versões e controlar os emissores;
- escolher uma oportunidade com abertura atual;
- preservar a condição comercial real;
- preparar apresentação, proposta, contratação e confirmação de pagamento;
- atribuir responsável e próximo passo;
- corrigir classificação e comprovação de proposta/entrega;
- acompanhar a oportunidade diariamente enquanto a fila e a automação evoluem.

A oportunidade não espera o término da reorganização técnica para receber atendimento.

## Referência

Diagnóstico completo e evidências sanitizadas foram entregues no chat. Baseline técnico desta execução: PRUMO-BASELINE-REORGANIZACAO-2026-10-23.md. Roteiro comercial: PRUMO-OPERACAO-COMERCIAL-PILOTO.md.
