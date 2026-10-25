# Telegram na operação da Prumo

Revisão: 25/10/2026. O Telegram é o canal do operador para pedidos, resultados e avisos internos. A fonte comercial continua sendo a Central/CRM; receber uma mensagem ou tocar num link não conclui a obrigação. Este procedimento não cria bot, cadência, envio ou autorização comercial.

## Quem faz o quê

| Responsabilidade | Executor | Saída verificável |
| --- | --- | --- |
| Receber pedido do operador | Bot da Central por polling, somente chat privado autorizado | Update original persistido na fila antes do offset avançar |
| Interpretar e executar demanda autorizada | Central e squad escolhida pelo conteúdo; `/p` direciona Prumo | Resultado do turno e, quando aplicável, evento/reserva com identidade própria |
| Avisar pendência comercial | Vendedor e fluxo de passagem existentes | Aviso interno vinculado à ficha; não mensagem ao cliente |
| Decidir negociação, contratação ou pagamento | Rômulo, na oportunidade atual | Fato confirmado na fonte, responsável e próxima condição definidos |
| Avisar falha/P0 | Monitor Dell/Socorro pelas outboxes existentes | Tentativa e estado técnico de transporte; o operador confere a falha, não presume remédio executado |
| Avisar agenda e semáforos pessoais | Publicador pessoal existente | Lembrete/percentual; não movimentação financeira nem dado pessoal levado ao modelo |

## Roteamento e horários

| Classe | Canal e regra | Limite |
| --- | --- | --- |
| Pedido do operador e resultado do turno | Telegram na mesma conversa autorizada; entrada `getUpdates`, sem webhook público no Dell | Allowlist vazia fecha; grupos são ignorados. Demanda com mais de dez minutos não vira compromisso atrasado |
| Passagem/decisão comercial | Telegram existente com acesso à Central/ficha e fila correspondente | Avisos de conversa podem chegar fora do expediente; a janela de silêncio das 22h às 7h impede novo aviso comercial do vendedor. Não altera expediente/ritmo de primeiro contato |
| Aviso comum do vendedor | Um aviso aberto por vez, janela comercial e teto interno já configurados; pedidos comerciais recebem prioridade conforme código | Teto de avisos internos não é capacidade de vendas nem autorização de WhatsApp. Pausas e fontes são relidas |
| P0 | Somente Telegram pela outbox do monitor; pode furar o silêncio | Se o bot falhar, conservar para tentativa posterior. Não transferir ao WhatsApp |
| Falha/recuperação do Dell e Socorro | Telegram; sem som das 22h às 7h quando não P0 | Se o bot falhar, aguardar próxima rodada, sem fallback WhatsApp |
| Lembretes de agenda e alertas pessoais | Telegram sem som das 22h às 7h, pela opção já existente | Finanças transporta apenas semáforo/percentual e categoria permitida, nunca valor ou estabelecimento. A fila pessoal é reserva quando não houve tentativa ou todos os destinos recusaram explicitamente; incerteza/entrega parcial bloqueia fallback na correção local. P0/falhas continuam exclusivos |

Horários são de São Paulo. Silêncio não tem o mesmo efeito em todas as classes: aviso pessoal pode chegar sem som; o vendedor comercial espera; P0 pode alertar. Não usar um único rótulo genérico para todas essas rotas.

## Rotina do operador ao receber um aviso

1. Identificar se é decisão comercial, pedido/resultado, agenda pessoal ou infraestrutura. Um lembrete pessoal não vira lead; um P0 não confirma negociação.
2. No comercial, abrir o encaminhamento da Central e reler a ficha/Agora, fonte e último pedido. Aviso antigo e backfill não confirmam abertura atual.
3. Conferir identidade e responsabilidade. Assumir a conversa quando aplicável; pedido de preço, proposta, negociação, contrato e pagamento é decisão humana, mesmo com qualificação incompleta.
4. Executar a ação pertinente ou registrar espera/impedimento na fonte existente. Durante esta implantação não há envio de mensagens. A pausa de prospecção não equivale a proibição do atendimento manual que Rômulo decidir conduzir depois.
5. Concluir somente pela evidência real prevista. Se a integração já observou o envio/resposta, não transcrever novamente. Um botão legado de confirmação só registra fato efetivamente ocorrido; não substitui a verificação.
6. Ao terminar, deixar responsável e próximo passo/condição de espera. Receber aviso, abrir a ficha e gerar rascunho não confirmam material entregue, proposta enviada, aceite ou recebimento.

## Persistência, reinício e exceções

- O polling só confirma o update ao Telegram depois da persistência. Erro ao gravar não autoriza perder o original ou trocar sua identidade.
- A fila serial durável conserva `pendente`, `processando`, `concluido` e `ambiguo`. Pendentes podem retomar após a revalidação de idade/autorização; processo morto em execução vira ambíguo e não repete o modelo.
- Mesmo update/conteúdo é deduplicado; mesma identidade com conteúdo diferente é conflito. Não limpar o journal para liberar o turno.
- A tentativa de aviso sobre turno ambíguo é persistida antes do transporte. `avisoTentado` não comprova que o operador recebeu a mensagem.
- Agenda usa identidades e reservas próprias. Timeout/404 na conferência não comprovam que um evento incerto nunca foi criado e não autorizam recriação.
- O registro de P0/falhas é uma outbox durável. Estado verde do transporte não prova leitura, atendimento ou correção da falha.
- A correção local dos avisos pessoais grava uma reserva privada antes do transporte e conserva o resultado de cada destino por hash. `reservado` ou `incerto` bloqueiam nova tentativa da mesma chave, inclusive após reinício e depois de 24 h. Não são marcados como enviados.
- Entrega parcial e erro de rede/timeout/HTTP 5xx mantêm revisão pendente, sem outra tentativa ou fallback. Quando todos os destinos recusam explicitamente (400/401/403/404/429) ou o bot está desligado, a fila pessoal pode assumir. Ausência comprovada da fila permite nova publicação depois de corrigir a instalação; outros erros de persistência mantêm bloqueio revisável.
- O dedupe de entregas confirmadas/publicações na fila continua de 24 h. `esquecer` pode encerrar esse dedupe, mas não libera reserva/incerteza. `fila` significa publicado para o monitor, não confirmação de leitura ou entrega no WhatsApp.
- O adaptador conserva recusa, entrega e incerteza de todos os destinos. Resultado sem recibo do transporte permanece incerto. Nunca se usa somente o primeiro erro para decidir outro canal.
- A reserva tem limite de arquivo de 16 MiB e falha fechada se corrompida/indisponível; o histórico não é zerado para liberar envio. Não declarar entrega exatamente uma vez: a falha após envio pode impedir confirmação local e exige conferência.

## Conferir sem mandar mensagem

| Situação | Conferência segura | Ação a evitar |
| --- | --- | --- |
| Não chegou aviso | Ver estado recente do monitor, configuração presente sem revelar token/chat, fila e encaminhamento atuais | Mandar teste ao cliente ou criar pendência comercial artificial |
| Polling em conflito | Conferir se há webhook ou outro consumidor e consultar o runbook por responsável técnico | Chamar `setWebhook`, apagar updates ou executar `deleteWebhook` automaticamente |
| Token/allowlist ausente | Responsável técnico confere configuração privada | Copiar credencial para Git, chat ou artefato |
| Turno/agenda ambíguos | Ler garantias e evento/pedido original; preservar bloqueio | Reenviar demanda, gerar novo ID ou apagar journal |
| Aviso foi recebido, tarefa continua | Abrir ficha e verificar a evidência de saída da etapa | Concluir tarefa pelo aviso ou pelo clique |

As rotas existentes de garantias (`GET /api/agenda/garantias`) mostram metadados e estados, sem conteúdo. A conferência explícita de reservas lê o Calendar e atualiza derivados; não cria/reenvia eventos. Ainda assim, sua execução é intervenção própria e não foi usada nesta auditoria.

## Instalação e evidência desta revisão

Leitura do Dell em 25/10/2026, sem gravar estado remoto: Central ativa; transporte configurado `polling`; presença de token e allowlist confirmada sem revelar valores; avisos pessoais Telegram ligados e vendedor configurado. O monitor Telegram estava `ok` em retrato de 11h46 BRT, com 21 segundos de idade na consulta. O runtime informava ausência de turno ocupado, mas não expõe confirmação de entrega Telegram.

O bundle instalado contém os contratos da fila `telegram-turnos.json` e `avisoTentado`. A ausência do arquivo da fila no caminho padrão consultado não foi interpretada como prova de fila vazia ou de nenhuma execução histórica. O offset persistido existe; sua data não é heartbeat de polling e não comprova entrada recente.

Validação local isolada: 325 testes em 41 suítes de avisos, interpretação, transporte Telegram, polling, fila durável, garantias, lembretes, vigia, vendedor e frente comercial passaram, zero falhas/skips; `npm run lint` passou. Os transportes foram dublados, sem modelo, Telegram, Calendar ou cliente real. A correção está em `server/avisos.ts`, `server/avisos.test.ts` e no pequeno adaptador de `server.ts`.

A inspeção remota acima antecede essa correção: esta frente não implantou, reiniciou, alterou configuração/cron/pausas ou enviou mensagens no Dell. A aprovação dos testes locais não confirma o novo comportamento em produção; isso depende do rebuild e da instalação controlada pela frente principal.

## Implantação e compatibilidade dos avisos pessoais

1. O responsável técnico preserva, no acervo privado do Dell, o bundle/arquivos atuais e o mapa `avisos-enviados.json` antes da troca. Confere os hashes e aplica somente o diff revisado; espera a Central ociosa para rebuild e reinício conforme a operação principal.
2. O caminho efetivo usa `SQUADONE_OPERATIONS_DATA_DIR`, ou `data/operations` dentro do diretório da Central. O novo sidecar é `avisos-enviados.json.tentativas.json`, privado (0600), com reserva atômica, fsync e trava entre processos. Guarda token técnico, hash da chave/destino, horários e estados; não texto, chat ID, telefone ou transcrição. Não fica na pasta pública de fila do monitor.
3. O mapa numérico anterior continua legível e respeitado por 24 h; o código não o apaga nem remove suas chaves antigas. Envio confirmado ou publicação na fila atualiza o espelho. O sidecar é a autoridade da reserva: falha no espelho não apaga a confirmação já salva. Legado/sidecar corrompidos bloqueiam e permanecem para inspeção.
4. Após a troca, conferir somente processo, runtime, metadados/permissões, contagens de estados e logs redigidos. A instalação não precisa gerar mensagem de teste, demanda artificial, lead, evento ou aviso P0.
5. Em uma pendência `reservado`/`incerto`, Rômulo assume a conferência do efeito visível na conversa pessoal/fonte; o responsável técnico correlaciona privadamente a chave original e seu hash e conserva a prova. O próximo passo é registrar resultado dessa conferência e decidir uma recuperação específica. Não há nova tela, comando automático de desbloqueio ou limpeza de journal nesta entrega. A ausência de recibo não é prova suficiente para repetir.
6. Retorno para bundle antigo exige avaliação: o mapa legado não representa reservas e incertezas do sidecar. Se existirem pendências, não reativar o publicador antigo, renomear/apagar o sidecar ou trocar chave para contornar a trava. Preservar ambos os arquivos e escolher correção segura; desligar o Telegram pessoal também não libera uma reserva incerta para WhatsApp.

| Estado pessoal | Significado | Próximo passo |
| --- | --- | --- |
| `reservado` | Tentativa reservada; pode ter sido interrompida | Conferir por responsável humano/técnico; sem repetição automática |
| `incerto` | Resultado não comprovado em todos os destinos | Conferir efeito e evidência por destino; sem fallback |
| `telegram` | Transporte confirmou todos os destinos da tentativa | Dedupe de 24 h; leitura e ação humana continuam não comprovadas |
| `fila` | Aviso pessoal publicado para o monitor | Conferir monitor/outbox; não declarar cliente ou operador atendido |
| `naoEnviado` | Pasta ausente comprovou que não houve publicação | Corrigir instalação; uma próxima tentativa pode publicar |

P0 e origens de infraestrutura/comercial exclusivas passam pela outbox existente antes de qualquer caminho pessoal. Não recebem fallback ou migração de canal por esse patch. Rotinas pessoais, lembretes silenciosos, máscaras financeiras e procedimentos Silmer continuam sob seus contratos anteriores.

## Fontes

- `RULES.md`, regra 20 e decisões de cadência/privacidade.
- `server/telegram-entrada.ts`, `telegram-bot.ts`, `telegram-polling.ts` e `fila-telegram-duravel.ts`.
- `server/vendedor.ts`, `avisos.ts`, `rotas-garantias-agenda.ts` e contratos de agenda.
- `deploy/dell/dell-status.py` e `deploy/dell/lib/aviso.py`.
- `docs/PRUMO-AGENDA-TELEGRAM-GARANTIAS-2026-10-24.md` e `PRUMO-OPERACAO-ASSISTIDA-FASE4B-2026-10-24.md`.

A prova técnica não substitui o uso natural do canal: recebimento efetivo, atendimento, aceite e pagamento continuam fatos distintos. Não é necessário inventar mensagem de teste para declarar o procedimento definido.

## Implantação coordenada — 25/10/2026

O lote corrigido foi integrado às fontes atuais do Dell, preservando as edições preexistentes. Homologação Linux completa: 4.129 testes, zero falhas/skips, tipagem e build aprovados. Backup do bundle e do mapa numérico legado foi feito antes da troca; os assets antigos foram retidos. Central ociosa antes e depois da cópia; reinício controlado concluído às 12h14 BRT, runtime e garantias disponíveis por GET.

Não houve mensagem de teste nem nova tentativa artificial. O sidecar é criado sob demanda na primeira publicação natural; ausência anterior do arquivo não é prova de entrega. A observação pós-instalação comprova instalação e disponibilidade, não recebimento futuro ou comportamento de uma falha real. Backup/provas privados: `~/.cache/mel-work/modelo-operacional-20261025/`.
