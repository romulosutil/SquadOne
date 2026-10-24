# Agenda e Telegram: garantias técnicas e conferência

Lote preparado localmente em 24/10/2026. Não é uma homologação no Calendar real, um envio de Telegram nem uma venda. Preserva escritório, horários comerciais e decisões humanas. As validações usam fixtures, transporte dublado e processos filhos de teste.

## O que muda

- A UI envia uma identidade por intenção; retry da mesma demanda/modo/squad conserva o ID em memória e sessionStorage. Sucesso e atualização da Mochila terminam essa intenção; falha da leitura posterior conserva o mesmo ID; outro pedido usa outro ID. Telegram usa chat e mensagem originais. O hash da intenção é persistido antes do modelo: mesmo ID com payload diferente é recusado; replay concluído não chama outro modelo.
- Agenda usa trava por calendário, compartilhada entre UI e Telegram e entre processos. Revalida ocupação sob a trava. O retrato do Calendar pode estar atrasado: reservas comprovadas no journal também ocupam o horário. Prazos transparentes não ocupam.
- Antes de cada POST, guarda tentativa e ID determinístico do evento em arquivo privado. Leitura e gravação têm AbortSignal e limite de 20 segundos mesmo quando o provider ignora o sinal. Resposta tardia não confirma nem modifica o journal.
- Resultado incerto bloqueia novas reservas naquele calendário. HTTP 404 na conferência não prova que um POST incerto nunca criou evento e nunca autoriza repeti-lo. Não há expiração automática dessas travas.
- A fila de turnos Telegram persiste antes de responder 200 ou avançar offset. Somente pendentes retomam. Autorização e idade são conferidas novamente ao executar. Processando de processo morto vira ambíguo e não roda o modelo de novo. Um aviso interno tem tentativa persistida antes do transporte e não repete no restart; `avisoTentado` não é confirmação de recebimento.
- Arquivos têm escrita temporária, fsync, rename, sincronização do diretório e modos privados no Linux. Corrupção, trava incerta ou teto de 16 MiB recusam o crescimento antes de trocar o último arquivo válido. Não há poda de identidade/dedupe.

## Como conferir um bloqueio

O contrato HTTP `/api/orquestrar` agora exige `requestId` no formato `ui:<UUID>`; abas antigas precisam ser atualizadas. A UI publicada fornece esse campo automaticamente, sem mudança visual.

As rotas ficam no router interno já protegido do app. Não são ferramentas de envio nem de registro comercial:

1. `GET /api/agenda/garantias?squadId=<id>` mostra IDs derivados e estados de agenda, intenções e fila. Não inclui texto da demanda, credenciais ou transcrição. Estado processando pode indicar processo ativo ou interrupção ainda não conferida.
2. Consulte o evento e o pedido originais no Calendar/Telegram. Não transforme ausência de resposta ou timeout em falha comprovada da criação.
3. `POST /api/agenda/conferir-reservas`, com JSON contendo somente `squadId`, executa exclusivamente GET dos IDs reservados e atualiza o derivado. Não cria, altera, cancela ou reenvia eventos. Evento exato pode confirmar a reserva; remarcação ou cancelamento comprovados atualizam a ocupação derivada sem repetir a intenção. Ausência, leitura falha ou identidade divergente mantêm o bloqueio.
4. Intenção/turno ambíguos não possuem botão de “tentar de novo” nem reset automático. Mesmo que os eventos sejam conferidos, o mesmo pedido não volta a executar. Se restar incerteza externa, use o Calendar diretamente para a decisão humana; não apague o journal para liberar a automação.

## Estado privado e recuperação

Sob `SQUADONE_DATA_DIR`: `agenda-reservas/<hash-do-calendario>.json`, `agenda-demandas/<hash-do-requestId>.json` e `telegram-turnos.json`. Backups devem preservar arquivo inteiro e permissões. Nenhum dado desses diretórios entra no Git.

A recuperação de uma trava normal verifica que o PID morreu e serializa a retirada com trava de recuperação. Trava vazia, ilegível, PID incerto ou `.recovery` órfã ficam fechadas. Não remover às cegas: interrompa os escritores, preserve cópias exatas, confira processos e os eventos remotos antes da intervenção. Se o teto de arquivo foi atingido, o acervo anterior permanece legível; segmentação/compactação exige migração que preserve IDs, hashes e ambiguidades, não remoção de histórico.

## Limites e aceite

A garantia cobre agendamentos originados pelos turnos da UI e Telegram neste backend. Não serializa alterações feitas por aplicativos externos no Google nem oferece uma transação distribuída com o Calendar. O ajuste legado de duração/esforço conserva suas próprias marcas e If-Match; ele não passa a integrar a fila de criação deste lote. Sua concorrência com novas reservas e uma fila durável própria para ajustes são uma evolução separada, sem declarar cobertura inexistente.

A fila persistente cobre demandas e áudio do turno. Botões de contratação, votos, gastos e avisos conservam seus caminhos próprios. Não foram feitas transcrições reais, convites, mensagens para leads ou chamadas pagas na validação.

Gate local: testes antigos de agenda/Telegram e novas regressões de concorrência, intenção, limite, transparência, credencial, remarcação/cancelamento, reinício e morte real de processos filhos. Antes de publicar, executar também no Linux para validar fsync/permissões reais. Homologação de atendimento, contratação e pagamento continua dependendo de fatos reais; testes não são aceite do cliente.

Validação local concluída no Windows: 305 testes passaram (267 existentes e 38 novos), zero falhas, tipagem limpa. Inclui quatro casos com processos filhos reais e transporte externo substituído por dublês. Validação Linux concluída no conjunto integrado: 4.093 testes passaram, zero skips; tipagem e build aprovados. A conferência de um agendamento real depende de um pedido legítimo e continua distinta dos testes; esta implantação não cria evento de teste no Calendar nem envia mensagem para comprová-la.

O [contrato oficial de Events](https://developers.google.com/workspace/calendar/api/v3/reference/events) permite ID fornecido pelo cliente em base32hex. O publicador usa um ID derivado estável dentro desse alfabeto; a proteção local não depende de o Google detectar toda colisão distribuída.
