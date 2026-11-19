# Central da Prumo

## Percurso

No build observado na Mel, a raiz abria o Escritório e Vendas abria em uma
folha sobre o cenário. Conversas e Carteira tinham entradas distintas.
Primeiros contatos repetia a configuração da frente em Vendas e em Mais.

A raiz passa a abrir a Carteira em **Precisa de atenção**. Cada relação da
conta mantém sua ficha e mostra o último evento comprovado na fonte, a
responsabilidade e a próxima ação. O filtro permite consultar oportunidades,
contas encerradas, conversas e cadastros. A ficha abre com a passagem humana,
o motivo de bloqueio, o recibo da abertura e o histórico já guardado. Em
**Primeiros contatos**, o operador encontra a situação do WhatsApp e do
LinkedIn e um único controle da fila de WhatsApp. Os endereços antigos do CRM
continuam válidos, inclusive as fichas com `?lead=`.

Foram retirados a tela intermediária da Central imersiva, o estado de seleção
do andar, o menu flutuante sobre o cenário, a abertura automática do
Assistente e os atalhos de Escritório na navegação da Prumo. A fila de
conversas foi incorporada à carteira. A instância `app`, a rota direta
`/squadone`, os componentes compartilhados e a leitura legada
`/api/operations/crm/escritorio` continuam disponíveis para seus consumidores.

## Acordo com o especialista n8n

| Fato | Origem, vínculo e relógio | Regra de evidência e repetição |
| --- | --- | --- |
| Pedido agendado | `ultima-entrega.json` em `~/.local/share/n8n-estado/whatsapp-prospeccao/` e `linkedin/`, com `versao: 1`, `workflowId`, `execucaoId`, `criadoEm` em UTC. Pedido de canal sem contato associado. | O n8n publica a marca após a entrega do pedido à fila existente. `workflowId + execucaoId` identifica a entrega. Releitura produz a mesma informação. |
| Busca LinkedIn sem candidato | `linkedin/rodadas.sqlite`, `workflow + execucao` e `slot` do pedido em São Paulo. O retrato `executor-estado.json` dá a hora da conferência mais recente. | O worker só fecha `sem-candidato` com busca de pessoas confirmada e zero novos envios. Pedido entregue, rodada pausada e resultado de busca são exibidos como fatos separados. |
| Envio LinkedIn | `linkedin/linkedin.sqlite`, reserva única por perfil, com ID da reserva e URL exata da conversa. Usa `confirmadoEm`. | Estado `enviado` com conversa e evidência da saída. A reserva `incerto` conserva sua proteção e o encerramento mantém o motivo. Respostas são consultadas na conversa exata em Outros. |
| Envio WhatsApp | `frente-comercial/registro.sqlite`, ID completo da relação e chave WhatsApp canônica DDD+8 precisam coincidir para exibir o recibo na ficha. `em` preserva o relógio legado do ledger e o recorte do dia em São Paulo. | Só `enviado` com recibo Evolution preenchido e sem colisão entra no total. `incerto` e `sem_confirmacao` mantêm seus estados e ficam fora do total. O campo `em` do envio é a hora de reserva. O histórico carrega o horário da saída observada quando disponível. |
| Resposta WhatsApp | Inbox durável e JSONL do observador, mesma conta e conversa canônica. Chave existente inclui origem, conta, canal, conversa, tipo, direção e ID original. Exibe `ocorridoEm` da mensagem. | A leitura da fonte confere o evento original e seu conteúdo. Reentrega idêntica é idempotente. Divergência ou vínculo múltiplo aparece para revisão. Em vínculo único, a ficha recebe a passagem para Rômulo. O registro humano de responsabilidade v2 confirma a assunção. |

O especialista do n8n confirmou as marcas na Mel nas execuções naturais
`136466` (WhatsApp às 22h18) e `136468` (LinkedIn às 22h20). A Central também
aceita a ausência da marca e continua lendo os ledgers. A tela usa 10 minutos para agenda/executor de
WhatsApp e 25 minutos para LinkedIn. O retrato do CRM conserva o limite da sua
publicação, 30 minutos na Mel, e destaca falhas parciais ou posteriores.
Contagem ilegível aparece como registro indisponível. Ausência de mensagem
nova é normal e a idade de uma mensagem histórica não é usada para medir a
saúde da captura.

## Evidência de aceitação

Consulta em leitura à Mel em 18/11/2026 às 22h04 de São Paulo. Central e
agenda de ambos os canais ativas, build `ca64d12`, 25 workflows com oito
ativos e 16 arquivados. Publicação do CRM `136429` às 22h00min48s.

- **LinkedIn.** A agenda `136089`, às 19h20, entregou o pedido. O log da
  mesma execução confirmou duas consultas de pessoas e `rodadas.sqlite`
  registrou `sem-candidato`. O ledger tinha zero reservas e zero envios.
  Na rodada `136425`, às 22h00, o pedido também foi entregue e o executor
  registrou `pausado`.
- **WhatsApp.** A frente mostrava dez primeiros contatos no dia. O ledger
  tinha dez recibos distintos e cada um coincidiu por ID com uma saída
  capturada e com uma ficha. No caso natural de 17/11, a saída às 08h02min19s
  foi seguida por entrada humana às 09h02min47s. O mesmo ID original apareceu
  no JSONL e na inbox durável, em `concluido/handoff`. A entrada estava
  na ficha Site com vínculo único e na fila de Rômulo. A assunção dessa
  conversa segue a cargo do operador.
- **Validação isolada.** Os testes usam recibos e fichas fictícios, incluindo
  duplicidade, chave divergente, resultado incerto, dia de São Paulo, fonte
  ausente, fonte atrasada, pedido pausado e busca com zero. A interface
  compilada foi exercitada em 1440 e 390 px com uma resposta, seu recibo e
  o controle de assunção na ficha. O cenário não usou nenhum canal externo.

## Implantação e reversão

1. Antes de mesclar, conferir que os dois comprovantes publicados pelo n8n
   continuam sendo atualizados pelo ciclo natural.
2. Junto com a atualização da Central, instalar a unit versionada de
   `squadone-operations.service` e aplicar `systemctl --user daemon-reload`
   antes de reiniciar apenas a Central. Preservar os drop-ins instalados. A
   exceção de diretório permite ao SQLite abrir os arquivos auxiliares do WAL
   do WhatsApp. O arquivo principal permanece montado somente para leitura.
   Na aplicação, as conexões usam `readOnly` e `PRAGMA query_only`.
3. Após a subida, esperar o próximo ciclo natural. Comparar a hora e o ID da
   agenda, o resultado da busca, o total de recibos do dia e uma entrada na
   ficha exata. Verificar a unit efetiva e a ausência de erros no CRM. Usar
   somente consultas e registros existentes.
4. Para reverter, aplicar `git revert -m 1 <commit-do-merge>` se houve merge,
   `git revert <commit-do-squash>` se houve squash, ou reverter os commits
   em ordem inversa se foram integrados individualmente. Atualizar a Central
   e reinstalar a unit a partir da revisão revertida.
   Recarregar o systemd e reiniciar somente a Central. O fluxo anterior volta
   a servir `/` com o Escritório e os atalhos anteriores. As marcas de
   agenda podem permanecer com o n8n. Se a publicação delas precisar ser
   retirada, reverter a PR do produtor no n8n e manter as filas operacionais.
   Carteira, conversas, registros, as cotas e as reservas continuam nos
   mesmos arquivos e contratos.
