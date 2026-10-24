# Operação assistida — simplificação e responsabilidades (Fase 4B)

Data: 24/10/2026. Objetivo: responder oportunidades existentes e chegar à primeira venda nova, preservando o escritório, o histórico e os controles comerciais. Complementa a [Fase 4](PRUMO-SIMPLIFICACAO-FASE4-2026-10-24.md) e a [matriz de responsabilidades](PRUMO-RESPONSABILIDADES-FASE4-2026-10-24.md).

## Responsabilidade por etapa

| Etapa | Executor | O que entrega | O que depende de Rômulo |
|---|---|---|---|
| Captura de mensagem | Observadores, Hermes bridge e Evolution | Histórico e prova operacional quando disponíveis; reconciliação durável | Esclarecer identidade ou contexto quando não houver prova |
| Classificação inicial | Gemini no n8n | Interpretação da mensagem; persistência antes do recibo | Corrigir classificação quando necessário; não equivale a qualificação humana |
| Fila e proteção da conversa | Central/SquadOne | Próxima pendência, espera, responsável, qualificação e ciclo atuais | Assumir conversa, confirmar fatos e resolver lacunas na ficha |
| Consulta do secretário | Hermes | Leitura atual da Central, síntese interna e lacunas; sem nova base | Escolher ação e conduzir atendimento |
| Preparação de resposta | Copiloto/Assistente sob seus contratos atuais | Rascunho sujeito a contexto e revisão | Revisar e enviar; geração não confirma envio |
| Preço e proposta | Rômulo, com os controles da Central | Escopo, condições e versão da proposta | Aprovar negociação e proposta final; preservar acordos individuais |
| Contrato e pagamento | Rômulo | Aceite, cobrança e recebimento com evidência | Confirmar cada marco separadamente; ganho não equivale a pagamento |
| Aviso de passagem | Fila existente e Telegram | Aviso com encaminhamento | Abrir a pendência e agir; aviso lido não conclui tarefa |
| Aquisição futura | Caçadores e frente comercial, conforme pausas existentes | Somente funções já autorizadas e ativas | Não ampliar nem reativar aquisição por esta reorganização |

Diego avalia aderência, Elisa confere evidências/entrega e Carla avalia abordagem no executor da frente comercial. São três leituras do mesmo modelo; o nome do personagem não prova um executor independente nem uma tarefa em andamento. A frente está com `ativo=false` na leitura de implantação; o timer ativo, sozinho, não significa envio autorizado. Os personagens e o cenário continuam intactos.

Luna dos workflows é inferência restrita do Caçador; não é o secretário Hermes. Jev permanece sem nova coleta em sombra. O squad de agenda mantém seu domínio; não decide negociação ou contratação. O VENDAS/Grok externo continua com a pausa informada pelo usuário, sem verificação independente da VM.

## Simplificação do n8n

O inventário de partida contém 21 workflows, 18 ativos. Não fundir entradas distintas apenas para reduzir a contagem. Três convites já usam a mesma fábrica; o clique do Site conserva seu rastro técnico para a variante de abordagem, sem equivaler a envio. Paths, IDs, credenciais e histórico permanecem.

O `05 · Acompanhamento (Site antes da venda)` repete uma decisão comercial fora da Central. Seu parser legado protege proposta, próximo passo e aprendizado, mas ignora os novos contratos de ciclo e responsável. Nesta fase, a rotina fica pausada, com trava local versionada contra reativação pelos publicadores. Não criar outro parser de qualificação/contrato no n8n para compensar essa divergência.

A Central já calcula vencimento e follow-up com a conversa e seus contratos atuais. Efeito deliberado: novos envios silenciosos deixam de receber `status=expirado` na planilha pelo 05; a mudança física de pasta causada por essa marca também deixa de ser produzida por ele. Contagem de pastas/colunas antigas não é o estado comercial atual. O leitor do Hermes usa a Central para evitar essa ambiguidade.

A pausa não desfaz status antigos, pedidos de pasta existentes ou execuções já iniciadas. `site-pastas`, a limpeza de demos e os demais executores têm contratos próprios e não são desligados por ela. Não afirmar que toda demo fica preservada só porque o 05 foi pausado. Silmer, agenda pessoal, diagnóstico, medição, retrato e transporte permanecem separados.

As quatro leituras frescas do contexto WhatsApp continuam necessárias. Um cache do retrato atual perderia campos e poderia ficar desatualizado por edições externas. Reduzir essas consultas exige equivalência de dados e invalidação comprovadas; este lote não promete redução de latência ou de custo de inferência.

## Rotina para a primeira venda

1. Abrir a fila da Central e escolher uma pendência de resposta real ou uma revisão interna que destrave atendimento. Uma resposta histórica sem prova não é autorização de recontato.
2. Conferir a ficha e o último combinado; assumir a conversa quando aplicável. Preservar recusa, espera, exclusão e condição individual.
3. Resolver a lacuna seguinte de qualificação com uma pergunta por vez, quando houver abertura. Pedido de preço, proposta ou negociação passa a Rômulo mesmo com qualificação incompleta.
4. Registrar proposta, aceite, cobrança e recebimento nos marcos próprios. Não encerrar pendência por clique, geração de texto ou chegada do aviso.
5. Ao terminar, deixar próxima ação ou espera registrada na fonte existente. Hermes e outros agentes consultam essa projeção; nenhuma memória paralela substitui o CRM.

Este roteiro não cria contato automático, nova cadência, preço ou compromisso. Em especial, os R$500/mês oferecidos ao Kelisson são gestão de tráfego com mídia à parte; não há mensalidade de site combinada pelo relato do usuário.

## Aceite técnico e limites

Publicação, instalação, contagens finais, testes e reversão serão registrados abaixo após a conferência. Preparar fontes não comprova que um serviço as carregou. A consulta Hermes não é isolamento técnico das ferramentas de uma sessão do gateway.

## Limites operacionais da guarda e da leitura

A política local de pausa protege os publicadores que usam `n8n.py`: bloqueia ativação, exclusão e recriação conhecida do workflow reservado. Não é ACL do n8n; um administrador com API direta ou interface de edição continua capaz de alterar o estado. Não apagar a política para fazer uma publicação passar. Reativação exige revisão do domínio atual e decisão explícita; a reversão não deve religar o parser antigo por acidente.

A consulta Hermes usa somente GET local fixo, sem redirecionamento, cache, escrita no CRM ou inferência. Uma leitura normal da Central pode reconciliar o índice derivado de persistência já existente; isso não cria nota, confirmação de responsável, proposta, contrato ou pagamento. Fonte incompleta, antiga ou inacessível volta como não verificada, sem fallback para uma planilha antiga. A referência opaca identifica a oportunidade consultada; não comprova identidade da conta nem autorização de contato.

O servidor fornece o link da ficha a partir da origem da Central configurada e validada, para um lead efetivamente encontrado. Hermes replica esse link; não deduz hostname a partir do painel, de um webhook antigo ou da memória. Se a origem não for válida, a ficha fica indisponível explicitamente.

## Homologação isolada

A cópia Linux foi montada a partir do commit publicado anterior, com os 31 arquivos preexistentes reais do Dell preservados e somente este lote aplicado. Resultado: 4.000 testes da aplicação aprovados, zero falhas/skip; tipagem e build aprovados. Python: 54 testes da guarda/publicadores e 9 do leitor Hermes, todos aprovados no Linux, sem skip. Dublês de transporte e fixtures ficaram fora dos dados de produção; nenhum modelo ou mensagem comercial foi necessário.

## Reversão controlada

Não apagar workflows, histórico, registros ou pastas de clientes. A pausa está em `~/.config/claude-ops/workflow-operacao.json`, versão 1, com lista `pausados` de objetos `{id,nome,motivo}`, modo 0600. A cópia publicada de `n8n.py` relê a configuração antes de mutações. Arquivo inválido recusa a mutação; ausência é o modo legado. Para restaurar um fonte instalado, usar seu backup privado e conferir a fonte versionada. A remoção da guarda ou a reativação do 05 exige decisão explícita e revisão dos contratos atuais; não restaurar a ativação antiga como consequência automática de um rollback de código.

O leitor Hermes e suas instruções podem voltar à versão anterior sem alterar o CRM. Reverter o endpoint não exige mexer no cenário ou nos dados; instrução sem endpoint deve declarar indisponibilidade, sem recorrer a fatos antigos. As fontes e o estado final de instalação serão conferidos separadamente da homologação.
