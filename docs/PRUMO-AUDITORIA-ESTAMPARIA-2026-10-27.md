# Auditoria das conversas de Estamparia — 27/10/2026

Pedido: revisar outras conversas após o envio indevido à Ultra, identificar erros semelhantes e corrigir as regras e a leitura operacional. Escopo finito: as 20 conversas da retomada de Estamparia, incluindo a Ultra e Stamp Fast. A auditoria não envia mensagens.

## Evidências e resultado

Os recibos de `estamparia-saidas` contêm um único envio, à Ultra. As outras 19 conversas não têm envio registrado por esse mecanismo. Isso não identifica quem realizou as saídas históricas fora dele.

Quatro outras conversas têm saídas posteriores a uma saudação automática, sem retorno humano intermediário: Arara Silk, Bazar Darke, DMK e MR3. Esses registros anteriores não têm recibo do novo atendimento; sua autoria não foi atribuída ao agente. Permanecem em espera, sem nova abordagem durante a auditoria.

Foram confirmados e corrigidos dois erros de classificação:

| Conversa | Antes | Depois |
| --- | --- | --- |
| R7 Camisetas | O agradecimento posterior aparecia como resposta neutra e ocultava a recusa explícita | Recusa na classificação e negativa na leitura operacional, com evidência da mensagem original |
| The Best Estamparia | A indicação de contato enviada pelo shopping aparecia como neutra | Acesso/encaminhamento; conferir o contato com Rômulo, sem presumir interesse nem iniciar conversa com outro número |

Na reprodução antes/depois com os históricos do lote, somente essas duas classes mudaram. Dez conversas continuam classificadas como robô. O acesso humano posterior da Stamp Fast, a permissão para material da Favarato e os demais retornos foram preservados.

## Correção

`mensagem-automatica.ts` fornece a mesma detecção para classificação, marcadores da conversa e atendimento de Estamparia. Saudações, menus e avisos de ausência não confirmam humanidade, não preenchem perguntas de descoberta e não atualizam a última entrada humana do resumo. Positivos legados contraditos por evidência de robô passam a bot somente na leitura operacional, mantendo a resposta da fonte. Recusas e exclusões não são reabertas.

A classificação tem versão `respostas-2026-10-27` e aceita versões históricas na interface de dados. O catálogo de mensagens, a política de retomada, a ativação e os limites não mudaram. Não houve escrita retroativa na planilha, remoção de recibos ou mensagem de reparação aos contatos.

## Validação e publicação

- PC: 3.347 testes, 3.345 aprovados e dois ignorados; tipos e build aprovados. A primeira execução restrita bloqueou conexões dos servidores simulados locais; a repetição autorizada concluiu sem falhas.
- Dell: 219 testes do conjunto afetado aprovados; frontend e servidor compilados em pasta separada. Uma fixture de contexto incerto foi ajustada para não conter um marcador textual que agora comprova resposta automática; a proteção de revisão humana permanece testada.
- Publicação isolada às 08h26 de São Paulo, com comparação de hashes, backup dos fontes e do build anterior, serviço ocioso e sem reservas pendentes. Diferenças anteriores entre PC e Dell foram preservadas.
- Conferência ativa pelas referências individuais das 20 conversas: 14 em aguardar, quatro em preservar desfecho e duas em conferir com Rômulo. A leitura não concedeu autorização de contato. Serviço ativo, um envio histórico e zero incertos.

Relatórios privados no Dell: `~/SquadOne/output/auditoria-conversas-20261027T112501Z/`, com `publicacao.json`, `auditoria-classificacoes.json`, `verificacao-ativa.json`, testes, build e backups. Eles não são outra fonte de negociação.
