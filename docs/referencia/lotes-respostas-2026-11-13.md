# Conciliação da fila de respostas — 13/11/2026

Às **18h11 de São Paulo**, os **26 lotes** estavam processados com sucesso, com **zero lotes e zero eventos pendentes**. Eram os 22 lotes apontados na revisão anterior e quatro respostas recebidas depois. A auditoria confrontou as execuções principais do n8n, a fonte do CRM e o retrato atualizado da Central.

## Causa e correção

A fila continha 27 envelopes em 26 lotes. Vinte e cinco eventos já coincidiam com a inbox. Dois áudios tinham transcrição acrescentada ao texto do histórico; o produtor calculava o hash desse texto enriquecido, enquanto a inbox imutável já continha o hash do marcador de áudio capturado originalmente. A Central recusava a repetição com conteúdo diferente, e o primeiro lote impedia os demais de avançar.

`envelopes_audio.py` concilia somente essa equivalência comprovada: mesmo destinatário, ID original, direção, instante, conta Prumo e prova autenticada da Evolution; o hash do marcador precisa ser exatamente o já registrado na inbox. O texto transcrito segue para classificação. Sem original único, prova válida e correspondência com a inbox, o envelope permanece intacto para revisão.

A correção do envelope fica durável antes do HTTP. Reinício e timeout mantêm o lote, que só sai depois do ACK normal do workflow. Não foram alterados IDs, mensagens, sidecars de prova ou fatos concluídos para produzir confirmação. Os **307 registros anteriores da inbox permaneceram integralmente iguais**. Não houve novo envio aos destinatários desses lotes durante a conciliação.

Também foi corrigida a persistência cronológica: um lote antigo não substitui uma resposta posterior já registrada, tanto em Site como nas outras ofertas. Recusas e exclusões continuam preservadas.

## Validação no CRM

As 26 execuções principais do webhook terminaram com sucesso, incluindo persistência e conferência do recibo comercial. Classificações: cinco recusas, oito robôs, uma indicação de acesso, onze neutras e uma permissão para material. Permissão não foi apresentada como interesse em compra.

Na comparação com o CRM atualizado, quinze resultados correspondiam exatamente ao tipo e instante do lote, três já tinham resposta posterior e oito mantiveram o registro existente conforme as proteções do fluxo. **Nenhuma divergência** permaneceu nessa comparação. A fonte foi consultada diretamente para as linhas de Site e o retrato da Central foi atualizado antes da conferência final.

As quatro respostas mais recentes, adicionais aos 22 lotes iniciais, foram verificadas individualmente:

| Empresa | Resposta/classificação | Resultado no CRM |
| --- | --- | --- |
| Tecnofrio | Saudação automática → robô | `bot`, sem marco de resposta humana |
| Tecnoclima | Saudação automática → robô | `bot`, sem marco de resposta humana |
| Riccon Energia Solar | Saudação automática → robô | `bot`, sem marco de resposta humana |
| Móveis Planejar | “Obrigado não tenho interesse” → recusa | `negativa`, etapa Perdido e resposta às 17h24m41s de São Paulo |

Essas são respostas reais observadas e processadas; não são mensagens de teste nem garantia sobre eventos futuros. O pipeline continua ativo para as próximas entradas.

## Testes e publicação

Publicação no Dell às **18h04**, com backup privado em `~/.local/share/claude-ops/backups/lotes-respostas-20261113-180435/`. Foi aplicado um patch sobre a versão ativa, preservando as demais diferenças do checkout. O workflow de classificação recebeu apenas a proteção cronológica; a inbox manteve sua regra de imutabilidade.

**54 testes do gate `npm run test:envios` passaram no Dell**, incluindo nove testes de áudio/prova/fila durável e cinco de ordem temporal. Outros 30 testes de envelopes comerciais e entrega durável passaram no palco isolado antes da publicação. Os testes de áudio cobrem prova ausente, outra conta, ID/direção/horário divergentes, literal que imita áudio, registro já equivalente, idempotência e reinício antes do ACK. Os de ordem cobrem replays antigos, fusos distintos, repetição idêntica e preservação de recusa após robô ou agradecimento.

Não houve commit/push nem execução de GitHub Actions nesta tarefa. O gate está instalado no atualizador do Dell.

Evidências sanitizadas: `outputs/lotes-respostas-20261113/auditoria-depois.json`, `dry-run.json` e `test-envios.log`. As mensagens, os envelopes completos e as provas privadas permanecem no Dell.
