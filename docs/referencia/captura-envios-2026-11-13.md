# Captura e CRM — 13/11/2026

As duas saídas sem captura, de Fênix Ar Condicionado Automotivo e LG Higienização/Impermeabilização, foram recuperadas pela sessão autenticada do WhatsApp a partir dos recibos já confirmados. Nenhuma mensagem foi reenviada aos destinatários. Originais retornaram com os horários 18h57m36s e 19h05m03s UTC; histórico, prova da conta e marcos no CRM conferidos.

## Correções publicadas

1. A consulta de histórico passa a usar o LID único comprovado pela própria sessão, quando disponível.
2. A recuperação pontual lê somente IDs confirmados no SQLite, valida a conta e o destinatário e pede o original ao aparelho. O pedido não cria conteúdo, horário, prova ou âncora.
3. O callback de mensagens também entrega os originais solicitados ao leitor de histórico. Só um pedido dirigido vigente e o mesmo socket autenticado permitem registrar a prova, com o conteúdo e a data reais.
4. Antes de reservar e transportar um primeiro contato, o executor confere que o destinatário está na lista fresca do capturador. Se necessário, reinicia o observador e aguarda a fonte real. Não insere números artificialmente na lista.
5. O bundle do classificador expõe sua função como propriedade simples. O sandbox real do n8n devolvia objeto sem os exports com getters e falhava com `classificarResposta is not a function`. A correção foi validada no n8n com quatro casos fictícios. Em produção, foi alterada somente a forma do export do bundle instalado; doze casos mantiveram resultados idênticos. O gerador também foi corrigido para futuras gerações.

Backups privados foram mantidos no Dell em `~/.local/share/claude-ops/backups/`. Código instalado e fontes receberam as correções pontuais, preservando as diferenças anteriores do Dell. Sessão, recusas, exclusões e recibos foram preservados.

## Resultado observado

Auditoria de 16h58: **28 de 28** recibos tinham histórico, prova exata da conta/conteúdo/horário e marco de envio no CRM; nenhum envio aguardava projeção. Inclui quatro disparos do novo perfil posteriores à publicação da correção de prontidão do capturador. A contagem é uma fotografia da consulta, não uma promessa de que toda execução futura funcionará.

`npm run test:envios` passou no Dell: **40 testes** cobrindo a política sem limites, proteção contra duplicidade e recusas, prontidão do capturador, foco da descoberta, recuperação de originais e export do classificador. O atualizador executa esse gate antes do build. O arquivo de GitHub Actions está preparado no checkout; não houve commit/push nem execução de CI remoto nesta tarefa.

## Pendência constatada às 16h58, resolvida às 18h11

**Atualização:** os 22 lotes e quatro entradas posteriores foram processados. A divergência era o hash da transcrição de dois áudios, distinto do marcador original já comprovado. Fila zerada, 26 execuções bem-sucedidas e registros da inbox intactos. Ver [conciliação e validação no CRM](lotes-respostas-2026-11-13.md). O diagnóstico abaixo registra a situação anterior à correção.

Há **22 lotes na fila de classificação de respostas históricas**. Após corrigir o export, o primeiro evento recusado é de 30/10: o mesmo ID já está concluído na inbox, mas o envelope reapresentado possui outro `conteudoHash` e outra data de recepção. A validação estrutural passa; a confirmação imutável do evento devolve 409. A data de recepção não entra no hash de deduplicação; o conteúdo divergente impede aceitá-lo como repetição.

Não foram alterados IDs, hashes, âncoras ou registros concluídos para forçar confirmação. Não foi demonstrado que todos os 22 lotes têm esse conflito: o primeiro impede a fila de avançar. Essa pendência de classificação não é uma das duas capturas recuperadas e não impediu os 28 marcos de envio conferidos, mas impede declarar o workflow inteiro sem pendências. Requer conciliação do envelope histórico com a mensagem original e o registro já concluído antes de reprocessar esse fato.

Resultados sanitizados: `outputs/captura-perfil-20261113/auditoria-final.json`, `contrato-classificador-validado.json` e `test-envios-final.log`. Payloads privados e provas permanecem no Dell; não foram copiados para este relatório.
