# Regras gerais de passagem da Prumo

Revisão: 25/10/2026. Escopo: operação geral, sem fatos de oportunidades ou envio. Prumo define oferta e aceite; a Central aplica o estado comercial; Rômulo confirma decisões humanas. O piloto permanece assistido e a prospecção pausada.

## Como usar no trabalho diário

1. Abrir a pendência no escritório/CRM existente e conferir a fonte atual, o último pedido e o que já foi cumprido.
2. Aplicar os bloqueios abaixo antes de escolher qualquer contato. O resultado pode ser conferir, aguardar ou preservar encerramento.
3. Encontrar a etapa em que falta evidência de saída. Executar a ação descrita, sem saltar a validação humana.
4. Concluir somente quando a saída estiver demonstrada na fonte; deixar responsável e próxima condição de revisão conforme o fato real. Abrir link, receber aviso e gerar arquivo não concluem o trabalho.
5. Se o contexto mudar, reler e refazer a conferência. Não reutilizar permissão, rascunho ou responsável antigo como autorização atual.

O JSON `src/operations/modelo-operacional/passagens.json` é a versão estruturada deste manual para consulta no painel. Não é motor de envio, nova base editável ou autorização de automação. O estado de oportunidade continua vindo do CRM e das integrações existentes.

## Ordem de conferência e exceções

Esta ordem define o que conferir e bloquear operacionalmente. Não altera o score, o desempate ou a prioridade canônica do código. A presença de um bloqueio permite revisão interna, sem liberar contato.

| Ordem | Condição | Resultado a deixar visível | Como sai desse estado |
| --- | --- | --- | --- |
| 1 | Recusa, exclusão, desfecho ou revisão humana sem interesse/inadequação | Preservar restrição; nenhum novo rascunho de abordagem | Somente fato legítimo posterior e revisão humana coerente, sem reabertura automática |
| 2 | Pausa, espera explícita, compromisso futuro ou saída posterior ao pedido | Aguardar a condição combinada; revisão interna é separada | Resposta/combinado real conferido. Data de revisão vencida não autoriza cobrança |
| 3 | Dúvida de fonte, identidade, oportunidade, frescor ou processamento | Conferir internamente; sem repetir evento ou mensagem | Prova original/contexto válido e reconciliação que preserve IDs e histórico |
| 4 | Rômulo já responsável; dono ausente ou registro bloqueado | Um responsável por conversa, sem atuação concorrente | Confirmação humana da sucessão na revisão atual, sem cancelar outros gates |
| 5 | Robô | Conferir canal/horário indicado; não preparar proposta para menu | Entrada humana legítima ou próximo passo de conferência; sem adivinhar opção de menu |
| 6 | Recepção | Atender ao encaminhamento/pedido específico, sem declarar comprador | Pessoa/processo de decisão esclarecidos. Permissão vale só para o material mencionado |
| 7 | Áudio sem conteúdo, mídia sem contexto ou dúvida de significado | Ouvir/transcrever e conferir antes de responder | Conteúdo efetivamente conhecido e contexto atualizado; não preencher intenção por inferência |
| 8 | Preço, negociação, proposta, contrato ou pagamento | Passagem ao Rômulo com fontes e lacunas | Decisão humana e próximo estado registrado; qualificação incompleta não impede a passagem |
| 9 | Entrada humana com abertura e sem bloqueios | Uma pergunta pertinente, material específico ou preparação da etapa | Evidência de saída da etapa correspondente; sem contato sob a pausa atual |

O caráter humano de uma mensagem não comprova que o remetente decide a compra. A ausência de marcador de robô/recepção também não comprova identidade. Backfill mantém a data original; receber o histórico agora não cria urgência.

## Matriz de etapas

### 1. Capturar e preservar o evento

**Responsável:** Observadores/adaptadores e entrada durável; Rômulo apenas para esclarecer exceção sem prova.

**Entrada necessária:**

- Evento real da integração existente, com ID original, origem, conta, canal, direção, tipo e horário original.

**Ação:** Persistir antes do recibo e deduplicar a mesma combinação de evento, preservando eventos distintos da mesma mensagem.

**Saída verificável:**

- Evento persistido com referência verificável à captura original.
- Repetição reconhecida sem novo efeito; fonte ainda não legível fica preservada para conferência.

**Exceções:**

- Falha de persistência não confirma recebimento.
- Saída, entrega e leitura preservam evidência, mas não entram como nova resposta comercial.
- Timeout/resultado ambíguo não autoriza novo ID, replay ou apagar journal.

**Evidência:** Recibo durável e referência original privada; a data de importação não substitui a data do acontecimento.

**Limite de automação:** Captura e projeção existentes podem continuar. Nenhum envio, resposta, compra ou fato humano é produzido por capturar.

### 2. Conferir conta, conversa e oportunidade

**Responsável:** Central aplica as verificações; Rômulo resolve identidade, associação múltipla e responsabilidade.

**Entrada necessária:**

- Captura original disponível e retrato CRM atual.
- Conta emissora e destinatário precisam de prova; o nome do coletor não basta.

**Ação:** Confrontar a captura, a prova da conta e a chave da conversa; associar à oportunidade correta e conferir o responsável atual.

**Saída verificável:**

- Conta/conversa/oportunidade sustentadas pela fonte e contexto atual.
- Se houver mais de uma oportunidade, seleção humana explícita preserva as demais.

**Exceções:**

- Sem prova, conflito, fonte indisponível ou associação múltipla gera conferência interna.
- Nome de empresa igual não autoriza unir registros.
- Histórico importado não comprova abertura atual ou identidade da conta no passado.

**Evidência:** Tupla original conferida e estado de identidade; responsabilidade confirmada em nota própria da conversa.

**Limite de automação:** Pode conferir e derivar pendência. Não atribui responsável humano, corrige identidade por suposição ou libera contato.

### 3. Escolher o trabalho correto

**Responsável:** Central organiza a fila; Rômulo decide revisão humana e próximo combinado.

**Entrada necessária:**

- Contexto e fonte atuais, incluindo última entrada, saída, restrições e próximo passo.

**Ação:** Aplicar as restrições e classificar trabalho como decidir, qualificar, conferir, aguardar ou encerrado; separar resposta, material, encaminhamento e revisão interna.

**Saída verificável:**

- Uma próxima ação interna compreensível, com motivo e resultado esperado.
- Espera ou desfecho preservado quando a restrição prevalece.

**Exceções:**

- Robô não é comprador; recepção não confirma decisão; áudio não ouvido não é conteúdo conhecido.
- Saída posterior impede repetir pergunta ou apresentação.
- Sinal histórico pode justificar revisão interna, nunca urgência pelo horário do backfill.

**Evidência:** Prioridade canônica e sua fonte/data, sem converter classificação em confirmação humana.

**Limite de automação:** Ordena e explica a fila. Prioridade não é chance de venda, autorização de contato ou negociação.

### 4. Qualificar uma lacuna por vez

**Responsável:** Time prepara a próxima lacuna; Rômulo confirma a revisão humana e conduz a conversa neste piloto.

**Entrada necessária:**

- Necessidade e contexto que possam ser conferidos em fonte real.
- Para conversar, abertura atual e gates de contato válidos; sob pausa, somente revisão interna.

**Ação:** Conferir necessidade, adequação da oferta, intenção, participantes/processo de decisão e próximo passo aceito; registrar fonte e evidência do que foi efetivamente confirmado.

**Saída verificável:**

- Revisão parcial válida com lacunas explícitas, ou revisão suficiente para avaliar proposta final.
- Pedido comercial encaminhado ao Rômulo mesmo quando ainda faltam campos.

**Exceções:**

- Permissão, curiosidade e avaliação não são intenção de contratar.
- Sem interesse ou oferta inadequada preserva a restrição, sem rascunho de contato.
- Nota nova inválida exige revisão; não recuperar silenciosamente SPICED antigo como atual.
- Sem nota nova, o fallback SPICED existente permanece compatível; não completar impacto, orçamento ou prazo por suposição.

**Evidência:** Nota humana de qualificação na fonte, com referência e trecho real; silêncio ou classificação do modelo não preenche os campos.

**Limite de automação:** Sugere uma pergunta ou conferência interna e rascunho. Não confirma qualificação, impõe reunião ou exige um único decisor.

### 5. Preparar e cumprir o material solicitado

**Responsável:** Time prepara e confere; Rômulo revisa e decide qualquer envio quando autorizado.

**Entrada necessária:**

- Pedido ou permissão específica para o material mencionado.
- Material realmente localizado, disponível e conferido conforme os critérios da oferta.

**Ação:** Conferir o que foi prometido, a versão e a disponibilidade; preparar somente esse material e verificar sua entrega observada depois de eventual envio autorizado.

**Saída verificável:**

- Material/versão e saída correspondente conferidos na conversa, ou pendência interna específica de disponibilidade.
- Próxima condição de espera ou pergunta pertinente após a entrega, sem presumir aceite.

**Exceções:**

- Link aberto ou arquivo gerado não prova entrega ao cliente.
- Demo removida, URL indisponível ou homologação não validada não é material pronto.
- Recepção que autoriza vídeo autoriza esse vídeo, não reunião, proposta ou contratação.

**Evidência:** Referência do material e evidência de saída compatível com o prometido; existência de site local não comprova cliente vendo no ar.

**Limite de automação:** Pode preparar arquivos e conferir fatos observados dentro dos serviços existentes. Não envia sob a pausa nem declara compromisso cumprido pelo clique.

### 6. Preparar e conferir a proposta

**Responsável:** Time prepara; Rômulo aprova escopo, valores, prazo, responsável e versão final.

**Entrada necessária:**

- Oferta adequada e referência comercial identificável.
- Rascunho pode ter lacunas; versão final exige qualificação suficiente e condições completas segundo os gates existentes.

**Ação:** Identificar oferta e versão; preencher entregáveis, exclusões, dependências, responsável, prazo, valor inicial, mensalidade e condições somente a partir de fontes aprovadas.

**Saída verificável:**

- Rascunho identificado e lacunas explícitas para revisão.
- Proposta enviada somente após versão completa, autorização aplicável e evidência real do conteúdo enviado conferida por Rômulo.

**Exceções:**

- Campo desconhecido não recebe zero para liberar formulário.
- Nova versão preparada não troca automaticamente versão aceita.
- Condição individual confirmada prevalece na negociação; catálogo não reescreve oferta passada.
- Proposta histórica real permanece preservada; rascunho atual não prova envio passado.

**Evidência:** Referência/versão da proposta e fonte do preço; marco separado de proposta_enviada com prova do envio da versão exata.

**Limite de automação:** Pode montar rascunho e apontar lacunas. Não cria preço, desconto, promessa, envio, aceite ou dívida.

### 7. Passar decisão comercial ao Rômulo

**Responsável:** Rômulo negocia e decide; time e Hermes fornecem síntese e referências de leitura.

**Entrada necessária:**

- Pedido contextualizado de preço, proposta, desconto, negociação, contratação, contrato ou pagamento; também intenção confirmada de contratar.

**Ação:** Encaminhar o pedido original, as condições já discutidas e as lacunas; conferir o responsável da conversa antes de qualquer atuação e preservar o último combinado.

**Saída verificável:**

- Decisão humana e versão/condições correspondentes, ou espera com motivo e condição de revisão.
- Se Rômulo assumir, responsabilidade registrada na conversa e atuação concorrente do time impedida pelos gates.

**Exceções:**

- Qualificação incompleta não bloqueia o encaminhamento.
- Aviso recebido/aberto não significa conversa assumida nem tarefa concluída.
- Falta de prova, várias oportunidades ou nota de responsável inválida mantém revisão interna.
- Negociação não permite apagar documento ou condição anteriormente aceita.

**Evidência:** Passagem vinculada ao evento, contexto atual e referência da ficha; confirmação humana de responsabilidade e decisão quando ocorrer.

**Limite de automação:** Encaminha pela fila/transporte já existente quando permitido e prepara síntese. Não negocia autonomamente, confirma responsável por inferência ou promete prazo ao cliente.

### 8. Conferir aceite e documento

**Responsável:** Rômulo confere partes, representantes, versão e aceite; documento para uso passa pela revisão humana aplicável.

**Entrada necessária:**

- Versão completa da proposta com envio real confirmado, documento identificado e evidência do aceite.

**Ação:** Vincular o aceite à versão exata enviada e guardar o documento completo em local privado, registrando somente a referência e a evidência necessárias no CRM.

**Saída verificável:**

- Aceite humano registrado com documento e vínculo ativos, ou pendência documental explícita.
- Condição de cobrança contratada pronta para conferência separada.

**Exceções:**

- Rascunho, pedido de proposta, mensagem genérica de concordância e proposta enviada não confirmam aceite do escopo/valor.
- Nova versão não modifica contratação aceita sem decisão/documento coerentes.
- Correções preservam o original e tratam dependentes primeiro.

**Evidência:** Marco de aceite vinculado à versão enviada e referência do documento, com data compatível e confirmação do operador.

**Limite de automação:** Valida formato, vínculo e coerência dos registros. Não gera assinatura, aprovação jurídica ou contrato aceito automaticamente.

### 9. Conferir condição e cobrança

**Responsável:** Rômulo confirma a condição, a liberação, o destinatário e qualquer cobrança.

**Entrada necessária:**

- Aceite/documento ativos, componente e valor contratados, vigência e gatilho de cobrança explicitados.
- Gatilho realmente satisfeito; Site Encontrado, inclusive em pacote, exige cliente vendo o site funcionando no ar.

**Ação:** Vincular condição ao aceite e cobrança à condição; conferir valor, vencimento, forma e competência mensal antes de registrar ou apresentar cobrança.

**Saída verificável:**

- Condição e cobrança rastreáveis, sem exceder o componente aceito e sem duplicar componente/competência.
- Se gatilho não estiver comprovado, espera preservada e nenhuma cobrança liberada.

**Exceções:**

- Não presumir entrada universal; anúncio sem Site não herda gatilho de Site.
- Registrar cobrança não a envia e não emite documento fiscal.
- Mensalidade exige competência; versões substitutivas não geram cobrança sobreposta.
- Sem evidência de site visto, vencimento ou forma, manter pendência.

**Evidência:** Condição, gatilho e cobrança vinculados; para Site, marco de entrega_vista com prova específica de visualização funcionando.

**Limite de automação:** Confere regras e projeta obrigação registrada. Não escolhe forma, envia cobrança, informa dados bancários ou confirma pagamento por conta própria.

### 10. Confirmar o recebimento real

**Responsável:** Rômulo verifica o recebimento; Central valida vínculo, saldo, componente e competência.

**Entrada necessária:**

- Cobrança confirmada e dinheiro efetivamente verificado por Rômulo, com referência única e data real.

**Ação:** Registrar somente o valor recebido de fato, ligado à cobrança correta; separar parcial/integral e preservar o saldo aberto.

**Saída verificável:**

- Recebimento confirmado na fonte e reencontrado na projeção, com saldo correto e sem duplicação.
- Encaminhamento da entrega conforme a condição contratada, sem usar previsão de receita como caixa.

**Exceções:**

- Promessa, comprovante não conferido, ganho verbal, proposta ou aceite não são dinheiro recebido.
- Referência repetida, inclusive no legado, não gera outra receita.
- Correção acrescenta fato e conserva original; não editar ou duplicar pagamento para ajustar valor.
- Receita existente de outro cliente não comprova primeira venda nova.

**Evidência:** Confirmação humana de recebimento, referência única privada e cobrança vinculada; projeção pendente continua pendente.

**Limite de automação:** Valida e calcula saldo após o registro humano. Não movimenta banco, interpreta comprovante como confirmação ou envia dados financeiros a modelos.

### 11. Executar entrega e acompanhar o serviço

**Responsável:** Responsável de entrega definido no documento; Rômulo valida passagem e aceite do cliente.

**Entrada necessária:**

- Escopo/versão aceitos, responsável de entrega definido e condição de início contratada satisfeita.
- Capacidade, materiais, acessos e dependências efetivamente conferidos.

**Ação:** Passar escopo, critérios de aceite, dependências e condição de início ao responsável; conferir entrega por evidência e organizar suporte/recorrência segundo o contratado.

**Saída verificável:**

- Entrega vinculada ao escopo e critérios aprovados, com evidência de disponibilização e aceite quando exigido.
- Suporte/manutenção e próxima condição registrados, preservando os marcos comerciais e financeiros separados.

**Exceções:**

- Não iniciar por promessa de pagamento se a contratação exige recebimento; não impor pagamento prévio quando outra condição foi contratada.
- Gerador não aprova a própria qualidade; Site/Raio-X exigem as avaliações e manifestos aplicáveis.
- Cliente ver o site no ar é gatilho de cobrança, não aceite automático de todo o projeto.
- Retenção/indicação não são inferidas por tempo: respeitar os registros humanos previstos e não enviar mensagens automáticas.

**Evidência:** Documento/versão, responsável e checklist de entrega; referência da avaliação e manifestação real do cliente. Fatos de pós-venda ficam na fonte existente.

**Limite de automação:** Procedimento operacional humano e execuções técnicas já autorizadas. Este manual não instala executor de entrega, suporte, retenção ou indicação.

## Conteúdo mínimo de uma passagem humana

O encaminhamento deve permitir agir sem procurar em vários sistemas:

- Referência da oportunidade e ficha existente; conta/conversa corretas e estado de identidade. IDs e conteúdo privados ficam na fonte protegida.
- Pedido original, horário original e o que já foi respondido/entregue; distinguir observado, interpretação e confirmação humana.
- Motivo da passagem: preço, proposta, negociação, contratação, pagamento ou exceção de identidade/conteúdo.
- Necessidade e oferta em avaliação, condições já confirmadas e lacunas. Campo sem fonte continua pendente.
- Responsável atual da conversa e decisão solicitada ao Rômulo; quem recebe o aviso não é automaticamente quem assumiu.
- Próxima ação interna ou condição de espera; prazo somente se existente e confirmado.

O aviso por Telegram e a fila apontam para a mesma ficha. Não criar uma negociação paralela no Hermes, no Telegram ou no Grok. A operação usa a Central para a decisão comercial e preserva os transportes existentes.

## Registro e recuperação

- Qualificação, responsabilidade, proposta, aceite, cobrança e recebimento mantêm os respectivos registros humanos na aba CRM. Não completar marcadores por esta tabela.
- ACK de gravação exige aguardar a mesma nota aparecer na fonte projetada. Resultado incerto bloqueia repetição automática. Conferir a fonte antes de decidir recuperação; não mudar ID ou apagar journal.
- Correção é evento posterior com referência ao original; corrigir dependentes primeiro. Versões substitutivas da mesma referência não criam cobranças sobrepostas.
- Dinheiro inicial e mensal são componentes diferentes; mensalidade tem competência. Parcial deixa saldo aberto.
- Saída/entrega/leitura de mensagem preservada no inbox não é resposta comercial nem tarefa de compra. Não fechar ou repetir esse evento para zerar contagem.

## O que está aplicado e o que é procedimento humano

Captura durável, conferência de identidade, prioridade, qualificação/ciclo e autoridade já têm funções e validadores no código. Este material os torna consultáveis por etapa. O piloto atual prepara rascunhos/passagens e mantém os gates de confirmação; não instala resposta automática.

Entrega e pós-venda aqui são passagem e checklist humanos sobre o escopo contratado. A disponibilidade de execução técnica, suporte e capacidade depende da oferta e do responsável definido; nenhum personagem é usado como prova de capacidade. Aceite, validade jurídica do documento e recebimento real não são garantias produzidas pelo software.

Não foi identificado bug impeditivo que exigisse alterar o código para representar estas regras. A comprovação de uma nova passagem natural, identidade histórica sem prova, responsabilidade real, aceite e recebimento continuam dependentes dos fatos humanos/externos; não se resolvem por simulação ou confirmação em massa.

## Rastreabilidade e aceite desta entrega

| Regra | Fonte aplicada |
| --- | --- |
| Qualificação e passagem com lacunas | `src/operations/qualificacao-comercial.ts`: `camposFaltantesQualificacao`, `proximaPerguntaQualificacao`, `devePassarAoRomulo` |
| Qualificação nova governa; legado compatível | `src/operations/spiced.ts` e `qualificacao-comercial.ts` |
| Proposta, aceite, condição, cobrança e recebimento | `src/operations/ciclo-comercial.ts`: `validarEventoCiclo`, `pendenciasDaProposta`, `validarTransicaoCiclo`, `cicloDoLead` |
| Contexto, identidade e passagem sem execução | `server/atendimento-comercial.ts`: `conferirFonteAtendimento`, `AtendimentoComercial`; `server/entrada-atendimento-comercial.ts` |
| Fonte única e limites do secretário | `docs/PRUMO-RESPONSABILIDADES-FASE4-2026-10-24.md`, `docs/PRUMO-OPERACAO-ASSISTIDA-FASE4B-2026-10-24.md` |
| Restrição, espera, autoria e trabalho interno | `src/operations/prioridade-comercial.ts`: `planoComercialDoLead`; `src/office/procedimento-da-decisao.ts`; `src/operations/marcadores-da-conversa.ts` |
| Dono e sucessão da conversa | `src/operations/responsavel-conversa.ts`: `projetarResponsavelConversa`, `validarSucessaoResponsavel`, `autoridadeDaConversa` |
| Qualidade da oferta e diferença entre entrega/aceite | Prumo `00-contexto/organizacao.md`; `docs/referencia/organizacao-prumo.md`; `docs/PRUMO-QUALIFICACAO-CONTRATACAO-PAGAMENTO.md` |

Aceite do manual/dados: onze etapas com entrada, ação, dono funcional, saída, exceções, evidência e limite; ordem de bloqueios explícita; nenhum nome de cliente, contato, dado bancário ou preço inventado; JSON parseável e coerente com o documento. Aceite de implantação do painel e piloto real é registrado pelo integrador, separado desta preparação.
