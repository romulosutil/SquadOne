# Identidade de captura: Hermes e Evolution

Auditoria somente leitura em 24/10/2026. A melhoria de contexto compartilhado não altera a origem dos registros existentes, a configuração das contas, preços ou políticas comerciais. O escritório permanece preservado.

## Achado comprovado e limite histórico

O observador da bridge Hermes grava `origem: pessoal`; o observador da instância Evolution PRUMO grava `origem: prumo`. Ambos estão ativos e escrevem na mesma pasta de conversas. A deduplicação atual do JSONL usa identidade da mensagem e direção, sem uma identidade independente da conta remetente. Portanto, `origem` identifica quem gravou a linha; isoladamente, não comprova uma conta física diferente.

A identidade própria da sessão Hermes (`me.id`) foi comparada somente em memória com `ownerJid` da única instância Evolution PRUMO. As duas correspondiam à **mesma conta física no instante da auditoria**. Nenhum número, credencial ou hash pessoal é publicado neste documento. Essa observação atual não prova a identidade de sessões passadas nem autoriza atribuir todo o histórico à conta PRUMO.

A homologação mostrou o efeito: um caso cujas entradas estavam apenas sob o coletor `pessoal` ficou corretamente inelegível para o envelope que hoje exige origem `prumo`. Outros casos com saída posterior registrada somente pelo coletor Hermes conservaram uma conferência interna; não receberam sugestão de novo contato. Alterar a origem histórica para fazê-los passar apagaria a proveniência e invalidaria a evidência.

## Próxima fatia proposta — ainda não implementada

Separar a conta canônica verificada do coletor original. Um registro privado explícito deve vincular conta/canal, coletor, identidade própria e versão da sessão, com data de confirmação e início de vigência. Uma prova derivada deve apontar para a mensagem original por identidade, direção, conversa e hash exato do conteúdo, conservando o valor literal de `origem`. O JSONL existente não precisa ser reescrito.

A primeira proposta considerou verificar a sessão Hermes e o armazenamento de sessão da Evolution. A leitura direta desse armazenamento **não será introduzida no observador nesta fatia**: exige um contrato próprio de acesso, verificação e falha. A correção de identidade fica para a próxima fatia; o índice/contexto compartilhado deve tornar a incerteza visível, sem presumir que já resolveu a captura.

Uma eventual prova deve ser persistida antes do encaminhamento de um novo envelope. Não deve criar uma nova identidade de mensagem, modificar horário original, ampliar a deduplicação por heurística textual ou atestar retroativamente uma captura anterior à vigência do mapeamento.

## Critérios de aceite

- A mesma mensagem da mesma conta, recebida pelos dois coletores, produz um evento lógico e preserva a proveniência de ambos; contas comprovadamente distintas permanecem separadas.
- Mudança de identidade ou sessão, sessão não registrada, prova ausente, inválida, vencida ou indisponível bloqueia o novo envelope derivado. O erro aparece como contexto insuficiente para conferência.
- A falha dessa verificação não apaga mensagens, avança o consumo sem persistência, reescreve histórico ou reinicia o classificador para tentar obter um resultado diferente.
- Eventos anteriores à prova permanecem históricos de conta não comprovada. O mapeamento atual não os promove silenciosamente a fatos comerciais.
- Reinício, duplicidade e conflito de conteúdo mantêm as garantias da inbox: confirmação apenas após persistência; resultado ambíguo não autoriza repetição automática.
- Comparação antes/depois deve preservar os arquivos de produção existentes e demonstrar que nenhuma proposta, aceite, cobrança, pagamento ou troca humana de responsável foi registrada por um evento técnico.

## Fallback operacional

Sem prova suficiente, manter a mensagem disponível para revisão na ficha, identificando a limitação de origem/conta. Não gerar novo envio ao cliente, retomar negociação, presumir interesse ou confirmar um marco humano. Contexto compartilhado, rascunho e aviso interno não equivalem a contratação ou pagamento.
## Correção implementada — 24/10/2026

O diagnóstico acima registra a situação anterior e a proposta inicial de sessão. A implementação adotada comprova a própria observação: Hermes vincula a captura ao socket fechado no callback, ao `me.id` compatível e à chave **pública** dessa sessão; Evolution preserva o `sender` do webhook já autenticado, derivado de `client.user.id` pelo código instalado. A Evolution não expõe fingerprint público de sessão; a garantia é declarada como `webhook-evolution`, sem inventar assinatura criptográfica WhatsApp ou fingerprint.

Provas privadas em `~/.local/share/whatsapp-identidades/<BR10>.jsonl` conservam coletor, hash da conta, garantia, sessão quando disponível, horário de captura e tuple exata de ID original, direção, horário da mensagem e hash do texto efetivamente arquivado. Não guardam texto, telefone, token ou corpo completo do webhook. O `config.json` ancora a conta Prumo conferida e a vigência; `obrigatoria.json` impede que perda da configuração retorne ao caminho legado após reinício. O histórico original não é reescrito.

Identidade da conta e correlação da conversa são verificações diferentes. Prova automática exige PN brasileiro explícito no próprio evento e correspondência com BR10; mapa LID legado sem vínculo à conta não é prova. Número estrangeiro que colide na chave, PN alternativo contraditório, socket antigo, conta diferente ou conteúdo divergente não são aceitos silenciosamente. Captura bruta permanece disponível para conferência. Provas operacionais de outra conta são conservadas separadamente; a mesma tuple em contas diferentes bloqueia a associação.

O backend reconcilia periodicamente as entradas originais dos coletores e do histórico recuperado com a inbox durável, independentemente do observador que venceu ou da emissão do envelope n8n. IDs e horários originais são conservados; recebidoEm não cria identidade nova. Sem prova, a entrada permanece como passagem **interna**, sem rascunho ou nova abordagem. Sem ID não se fabrica mensagem: a lacuna aparece na cobertura. Prints/importações fora do escopo são contados separadamente, sem promover evidência manual a captura autenticada.

A prova precisa coincidir com a linha original. Duplicatas e ordem de chegada não mudam o contexto; nova sessão, conta, tuple ou conflito invalidam a sugestão. Saída só encerra pendência quando comprovada na mesma conta e confirmada na projeção atual do CRM. Nenhum evento técnico confirma qualificação humana, proposta, aceite, contrato ou pagamento.

A ficha existente recebeu uma leitura de cobertura (contagens, ausência de prova/ID/oportunidade e indisponibilidade), mantendo intactos cena, personagens, câmera e navegação do escritório. A API de cobertura não expõe contato, texto ou ID original. O backlog anterior sem prova continua desconhecido; não foi promovido com a identidade atual.

### Validação antes de publicar

Suíte completa Linux: 3.986 testes, zero falhas/pulados; tipagem e build aprovados. Captura: 13 testes JS (incluindo os blocos reais da bridge), 25 novos Python, 94 do adaptador, 25 de entrega durável e 12 do remendo, todos aprovados no Linux. A bridge real foi copiada para HOME privado, regenerada, verificada sintaticamente e reaplicada para provar idempotência; nenhum listener de WhatsApp foi iniciado nesse teste.

Backups e logs privados: `~/.cache/mel-work/fase-identidade-20261024T125227Z/`. As validações usam fixtures; nenhuma prova fictícia deve ser instalada na área operacional ou usada para atestar uma mensagem histórica real. Instalação e conferência de produção serão registradas abaixo.

### Reversão

Não apagar provas, inbox ou JSONL. Desligar apenas os novos pontos de captura/restaurar as cópias anteriores sob backup, conservando as pendências. Restaurar código da Central por versão e rebuild verificados. Não apagar `obrigatoria.json` para contornar falha de identidade; sem prova, seguir com atendimento manual e conferência interna. Nenhuma reversão reativa Grok, campanhas, caçadores ou envio automático.

## Publicação e aceite técnico

Implementação `9db7f6a`, complemento de origem transcrita `bbc322f`, aplicados pelo atualizador do Dell. Suíte final Linux **3.987/3.987**, zero falhas/pulados; mais 13 testes da captura Hermes e 156 Python (captura/adaptador/entrega/remendo), todos aprovados. Build e tipagem passaram. Graphify atualizado no Dell por AST.

Cinco artefatos instalados (incluindo a bridge gerada), conferidos com as fontes/saída validadas; gateway Hermes e adaptador reiniciados ociosos e ativos, com Hermes conectado. A verificação de ociosidade usa `active_agents`, `gateway_busy` e o registro real de execuções vazio: no código desta versão, `active_sessions` do painel conta sessões com atividade nos últimos 300 segundos, sem significar trabalho em execução. Não editar ou apagar esse registro para liberar reinício.

Conferência real da cobertura: 116 arquivos, **174 entradas originais**, todas na inbox; segunda passagem produziu zero novos registros e reconheceu os mesmos174. Zero conflitos, IDs faltantes entre capturas de transporte, oportunidades ausentes ou falhas de leitura. Cinco entradas manuais de print, sem ID original, ficaram fora da ingestão automática e identificadas como ignoradas. As174 entradas históricas não possuem prova de conta contemporânea e permanecem para revisão interna; não foram promovidas a fatos humanos ou a autorização de novo contato. Não foi fabricada uma prova de produção para simular a primeira captura futura.

Na interface real, Estampa Cor aparece em Resolver contexto e na ficha, com a restrição explícita de que a tarefa interna não autoriza envio. A ficha mostra174 registros históricos para conferência. Cena, personagens, câmera e navegação do escritório preservados; captura de tela registrada na área de artefatos da execução. Nenhum botão de assumir, salvar, enviar ou confirmar fato comercial foi acionado.

O prefixo original de cada um dos116 históricos continua byte a byte igual ao manifesto inicial. Um arquivo recebeu três linhas de saída pelos coletores durante o trabalho, sem alterar seu conteúdo anterior. Arquivos de posição/fila/log naturalmente avançaram; não são prova de reescrita de conversa. Os31 arquivos preexistentes do clone Dell permaneceram byte a byte; registros da aba CRM humana também permaneceram intactos. Workflows continuam21/18 ativos, com estados individuais conservados. Nenhum envio de WhatsApp ao cliente ou marco comercial foi executado nesta validação.

Evidências privadas finais: `validacao-publicada-final.json`, `historico-e-capturas-reais-sanitizado.json`, `cobertura-publicada-sanitizada.json`, `fullsuite-final.log` e logs de geração/instalação no diretório da fase. Uma futura mensagem sem identidade, PN explícito ou conteúdo comprovável continua coberta pela revisão interna; isso evita sumiço sem diminuir a exigência de comprovação.
