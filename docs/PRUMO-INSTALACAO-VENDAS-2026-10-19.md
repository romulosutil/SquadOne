# PRUMO — instalação das Fases 0 e 2 (19/10/2026)

**Fase 2 instalada na Mel e conferida em 19/10 às 20:48:31 de São Paulo.** Commit de código `5cce535512024cd62b971f63551383ee922b04f2`, pai `52a076fd60b2e40ccdd616586c5e698723457710`. O diagnóstico original já existia na main; os cartões do blueprint acompanharam a implementação no mesmo commit.

## Integração e publicação

O delta revisado contém 39 arquivos sobre a main atual, conciliado por três vias com os autores. Foram preservados o cache da visão do CRM, os sinais do site no copiloto, os gates de mensagem e a confirmação de envio da interface atual. Não se transportou o comportamento antigo do checkout. Os preços da Iris permanecem separados dos nove valores do cardápio PRUMO.

A publicação usou índice e objetos temporários, atualização CAS da referência main e push normal, sem força. O HEAD do checkout antigo permaneceu `ff91abcc22aa09ad60e0e3ec29aec0986d5f2063` e seu índice normal não foi alterado. Credenciais, dados, pastas de saída e o dist de teste não entraram no commit. As edições da Fase 3 em andamento não foram recapturadas.

## Instalação e ordem

1. Preparados backups protegidos do workflow 08, dos dois scripts instalados e do dist anterior. Conferido que o fluxo vivo correspondia à base antes de alterá-lo.
2. Testes executados no Linux com HOME e raízes inteiramente temporários: **42 do executor e três do validador SPICED aprovados**. A primeira tentativa do executor encontrou apenas uma falta de arquivos de comparação na estrutura temporária; completada a estrutura, todos passaram.
3. Às **20:45:18**, publicada somente a atualização SPICED do workflow **08 · CRM**, ID `AsjxktRCqRJSmj9P`: código dos nós “Validar registro” e “Montar retrato”. Os outros 15 nós, conexões e estado ativo foram preservados. Nenhuma credencial foi criada ou alterada e nenhum outro fluxo foi republicado.
4. Instalados apenas `crm.py` em `~/.local/share/claude-ops/crm.py` e `frente-comercial.py` em `~/.local/bin/frente-comercial`, nos destinos de `deploy/dell/instalados.json`.
5. Depois da publicação da main, o atualizador padrão fez o build **na Mel**, usando o `.env` real que já existia. Build concluído às **20:47:06** e Central respondendo às **20:47:07**. O atualizador manteve seu procedimento de aguardar operação ociosa antes do reinício. Não foi transferido dist local nem Client ID fictício.

Não foram ligados caçadores, textos novos ou serviços novos. A instalação não disparou mensagens aos leads.

## Verificação

- Integração local: **3.338 testes aprovados, zero falhas e dois ignorados**, typecheck e build de teste aprovados. O dist de teste ficou separado da entrega de produção.
- Smoke isolado do router real, `CrmStore` e webhook n8n simulado: GET 200, ausência de Origin 403, JSON inválido 400, registro válido 201 e releitura confirmada, com etapa preservada. Nenhum registro de teste foi feito no CRM real.
- Na Mel, sete leituras reais retornaram **HTTP 200**: runtime, autenticação, CRM, venda do dia, situação do copiloto, vendedor e time comercial. OAuth continuou conectado. O build contém a faixa `BP-SPICED` e não contém o Client ID fictício dos testes.
- Preservados exatamente os **oito próximos passos internos**, as **duas propostas reais** e as pausas de Comece e Roda Mais. Todos os estados de ativação dos workflows permaneceram iguais aos capturados antes da instalação.
- O validador do 08 aceita o registro SPICED e a Central instalada contém o novo código. Há **zero qualificações SPICED confirmadas** na fonte; nenhum preenchimento, compromisso, proposta ou pagamento foi inventado.
- As duas cópias instaladas conferem byte a byte com a main. A consulta global de instalados informou **160 de 161 iguais**; o desvio restante está fora dos alvos desta fase e não foi alterado.

## Rollback e evidências

Na Mel: `~/.local/state/squadone-deploy/prumo-fase2-20261019T234210Z/`. A pasta contém os backups, logs dos testes Linux, confirmação da publicação do 08 e `smoke-final.json`. Permissões da pasta de preparo: 0700. O roteiro `rollback-fase2.py` foi compilado e deixado pronto, **sem execução**; restaura o workflow, scripts e dist anteriores e aguarda a Central ficar ociosa para reiniciá-la. A main Git não é revertida automaticamente por esse roteiro.

A revisão automática inicialmente recusou o SCP por falta de comprovação do destino e o push por falta de autorização explícita. As ações específicas foram reapresentadas após conferir a origem idêntica dos clones, o serviço no clone da Mel e as instruções literais do diagnóstico solicitado (“merge direto na main” e reinstalação na Mel). Ambas foram aprovadas; não se trocou de canal nem se usou force push para contornar a revisão.

## O que fica para o Rômulo

Conferir as conversas atuais, usar os preparos condicionais e confirmar a qualificação real na Ficha antes de preparar proposta. Oito ações internas datadas não significam ligações marcadas ou convites enviados. Comece e Roda Mais continuam aguardando conforme os registros existentes. Quantidade de fichas da Iris e preço da Estamparia exigem confirmação própria.

**Estrela-guia em 19/10:** pagamentos confirmados por semana continuam **não medidos** até a instrumentação da Fase 4. Ganhos registrados permanecem zero; isso não foi usado como prova de zero pagamentos.
