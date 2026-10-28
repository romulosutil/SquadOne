# Operação do WhatsApp na Prumo

Revisão: 25/10/2026. Procedimento geral de captura e atendimento. O WhatsApp transporta fatos; a Central conserva a fonte comercial e Rômulo conduz negociação e fechamento no piloto. A prospecção continua pausada. Consultar este procedimento não autoriza envio, resposta automática, QR ou reconexão.

## Duas contas, um contrato comercial

- O número pessoal é acompanhado pela bridge do Hermes e seu observador; a conta Prumo usa Evolution, adaptador e observador próprios. São caminhos técnicos distintos e não dois donos da mesma negociação.
- Origem `pessoal` ou `prumo` identifica o coletor que gravou uma linha. Não comprova, sozinha, a conta que enviou nem a autoria humana.
- A identidade da conta exige prova específica. O helper de identidade usa contexto de webhook autenticado, instância, conta por hash, destinatário no próprio evento, ID/direção/horário e hash do conteúdo. Uma correlação LID pode localizar a conversa sem provar a conta emissora daquela mensagem.
- Um responsável por conversa e oportunidade evita respostas concorrentes. Nome igual, número normalizado, importação ou histórico antigo não fundem oportunidades nem criam abertura atual.

## Fluxo de trabalho

1. Receber evento 1:1 pelo transporte existente. O adaptador Prumo valida o segredo antes do corpo; grupos, ruído e payload inválido não viram conversa comercial.
2. Conferir fonte fresca de leads. A lista do adaptador tem limite de 30 minutos. Falha de fonte ou LID não resolvido preserva evento mínimo durável antes do recibo; não adivinha número nem descarta a fila antiga para confirmar sucesso.
3. Resolver o chat correto. Para LID, a sessão confirmada precede caches e alternativas. `senderPn` e `participantAlt` não identificam o destinatário. Conflitos sem confirmação ficam pendentes; um participante não vira cliente.
4. Persistir spool/prova e passar ao observador. A entrega durável usa arquivo imutável com publicação atômica; o observador confirma sua fila em disco antes da remoção da captura. Falha de gravação não produz recibo de sucesso.
5. Projetar conversa e evento na fonte existente. ID original, direção, tipo e horário preservam eventos distintos; replay da mesma evidência não autoriza nova ação.
6. Na Central, conferir autoria, responsável, pedido, restrição, última saída e próxima condição. Robô, recepção e áudio sem conteúdo conhecido exigem tratamento próprio; permissão para material não é compra.
7. Rômulo decide a resposta, o material ou o marco comercial. A pausa de aquisição não proíbe atendimento manual legítimo e não concede resposta automática aos agentes. Neste trabalho não se envia nenhuma mensagem.
8. Conferir o efeito na conversa e no CRM. Abrir WhatsApp, copiar texto ou gerar material não conclui a obrigação. Registrar somente complemento ou fato externo ainda não observado, sem transcrever novamente o que a captura já demonstra.

## O que cada evento comprova

| Evento | Pode sustentar | Não comprova |
| --- | --- | --- |
| Entrada com ID/direção/horário | Mensagem recebida naquela conversa, conforme sua captura | Autoria humana, decisor, qualificação, conta correta sem a prova correspondente ou intenção de compra |
| Saída observada | Conteúdo enviado por uma conta, se a captura identifica conta e conversa | Entrega de todo material prometido, proposta final enviada, aceite, obrigação cumprida ou pagamento |
| Recibo entregue | Sinal de transporte disponível no log/contador | Leitura, atendimento ou avanço comercial |
| Recibo lido com direção coerente | Marco técnico de leitura do que foi enviado | Interesse, acordo, contratação ou recebimento financeiro |
| Prova de identidade válida | Vínculo daquele evento com a conta ancorada e metadados conferidos | Confirmação retroativa de todo o histórico ou liberação de contato |
| Importação/backfill | Evidência histórica com data original | Mensagem atual, urgência por data de recebimento, nova autorização ou conversa completa |

O parser aceita as formas conhecidas de recibo e rejeita as insuficientes. O observador usa somente `lido` como marco comercial técnico; `entregue` não deve ser apresentado como uma etapa adicional confirmada no CRM. A existência de estrutura no parser não certifica todos os formatos futuros do provedor.

## Material, proposta e dinheiro

- Material devido tem referência, versão e evidência de envio do conteúdo específico. Uma saída genérica não prova cumprimento.
- Proposta exige oferta e condições conferidas, versão exata e evidência real do envio. Classificador não aceita a proposta pelo cliente.
- Aceite, condição de cobrança, cobrança e recebimento são fatos separados. Um texto, promessa ou comprovante não conferido não confirma dinheiro recebido.
- Condições individuais confirmadas prevalecem; o transporte não cria preço ou prazo. Site mantém o gatilho contratado de ser visto funcionando antes de cobrar.
- A Central e a aba CRM são a referência comum. Hermes, Evolution, Telegram e a pasta de capturas não são bases editáveis paralelas de negociação.

## Falhas e recuperação

| Situação | Conduta | Quem conclui |
| --- | --- | --- |
| Desconexão real | Manter a pausa de primeiros contatos e conferir conta e estado atual; não repetir mensagens | Rômulo confirma a conta; operador autorizado conduz a recuperação. QR, logout e troca de conta são ações explícitas |
| Conectado novamente | Conferir estado e identidade; preservar fila e pausas | Conexão `open` não reativa prospecção por si só |
| Fonte antiga/indisponível | Preservar evento mínimo e tratar a fonte; ausência de dados não vira fila vazia | Integração/operador verifica recibos e frescor antes de continuar |
| LID ambíguo ou contraditório | Conservar a pendência e buscar prova legítima; não usar remetente como destinatário | Operador confere sessão/evento; se necessário Rômulo esclarece o contexto |
| Falha/timeout após tentativa de persistir ou enviar | Consultar estado e evidência original; manter ambiguidade sem replay automático, novo ID ou limpeza do journal | Operador autorizado reconcilia; Rômulo decide a ação comercial |
| Captura atribuída à oportunidade errada | Preservar original e prova, corrigir associação e aplicar correção controlada, com autorização quando necessária | Operador confere ID/horário/destino; não reclassificar ou apagar o histórico em massa |
| Robô, recepção, áudio ou mídia sem contexto | Tratar o pedido ou a lacuna específica; não inferir compra | Rômulo confere o conteúdo e a pessoa/processo antes do próximo marco |

A correção anterior da SOS preservou os 36 registros indevidamente associados em quarentena e os originais privados; dois registros pessoais permaneceram na ficha. Isso é evidência de correção, não uma nova confirmação de abertura comercial. Este lote não revisou novamente a oportunidade nem alterou seu histórico.

## Verificação sem mandar mensagem

1. Consultar metadados autenticados de conexão e comparar a identidade atual da conta com a âncora configurada, sem exibir credenciais ou identificadores.
2. Conferir serviços, hashes dos três fontes instalados e saúde autenticada do adaptador. Serviço ativo ou conexão aberta são sinais técnicos separados de captura correta e atendimento.
3. Conferir lista de leads, filas pendentes, erros e idade do último evento. Ler contagens; não abrir conversas, acionar QR, reconexão ou webhook de envio para testar.
4. Consultar frescor das provas e do retrato CRM. Prova inexistente/antiga não equivale a falha confirmada, identidade atual de todo o histórico ou zero oportunidades.
5. Verificar a frente comercial e as guardas na Central. A recuperação do canal não altera a autorização da prospecção.
6. Validar novas entradas quando ocorrerem naturalmente, preservando o horário original e a diferença entre evento observado, interpretação e confirmação humana.

## Evidência deste lote

Leituras em 25/10/2026, entre 11h49 e 11h51 BRT, somente por metadados:

- Instância Prumo `open`; uma instância nomeada encontrada. Identidade atual canônica comparada por hash e igual à âncora configurada; configuração com modo 600. O identificador da conta não foi impresso nem copiado para o documento.
- Evolution-adaptador, os dois observadores e gateway Hermes ativos. Adaptador `/saude`: fonte de leads disponível, zero pendências, sem erro de entrada, sem sinal de desconexão e sem resposta descartada. Esses contadores são do processo e não representam toda a história.
- Filas duráveis Prumo: zero pendências no adaptador e no observador, sem limpeza ou consumo executado por esta auditoria.
- Fonte e instalado no Dell byte a byte iguais: adaptador (`a192e15f4f6a2da8b634b0a37006d86017a9fcbdfe25c323a313482839cf5671`), observador (`35bef728f683e011596a50cc146caf767d6ddeb7c3d05c1d5be9cc1f55417338`) e helper de identidade (`2c0d564f1d8fe60f37f0a82fdab421ab71d87c7dde035dc3235e7731cc082c79`).
- Âncora de identidade configurada desde 24/10. Não havia arquivo de prova por mensagem; `status-evolution.json` tinha data de captura antiga de 30/09 e contadores de rejeição. Ele não foi usado para declarar saúde de captura atual ou confirmar passagens históricas.
- Frente comercial `ativo=false`, `estado=pausado`, zero primeiros contatos exibidos no dia. Nenhum envio, modelo, replay, reconexão ou alteração de configuração foi executado.
- Suítes offline de identidade (25 casos), adaptador (99) e entrada durável (27) aprovadas no Windows, com três skips de condições POSIX. Nenhum dado/fila real foi usado como fixture.

Nenhum bug novo impeditivo foi demonstrado pelos metadados e pelo código auditado; não foi criado um novo transporte ou executor. A prova de captura de uma mensagem nova e o atendimento natural continuam verificações distintas, sem evento artificial.

## Fontes de execução

`deploy/dell/whatsapp-observador/evolution-adaptador.py`, `observador.py`, `identidade_captura.py` e suas suítes; `server/conversa-do-lead.ts`, `server/entrada-atendimento-comercial.ts`, `server/atendimento-comercial.ts`, regras de responsável/qualificação/ciclo da Central. O contrato de passagem geral está em `regras-de-passagem.md`. Estado privado e conversas permanecem no Dell, com permissões próprias, fora do Git e do modelo operacional público.

Conferência coordenada às 12h19 BRT: nova consulta autenticada confirmou `open`, identidade atual igual à âncora privada e os quatro serviços ativos. Sem reconexão, captura artificial ou mensagem. O motivo antigo da pausa é registro da ocorrência anterior; conexão atual aberta não elimina a pausa nem autoriza retomada.
