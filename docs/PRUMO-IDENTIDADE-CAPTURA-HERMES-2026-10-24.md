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