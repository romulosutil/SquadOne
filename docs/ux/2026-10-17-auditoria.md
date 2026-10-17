# Auditoria da Central (17/10/2026)

Pedido do Rômulo: analisar as features e os botões da Central com as heurísticas de Nielsen, os padrões do MCP de UX
(uxpatterns.dev), padrões de produto e a estrutura de CRM e vendas, para uma operação "o mais linear e fácil possível".
Feita depois das 15 otimizações do blueprint (2f6386f), por oito subagentes só de leitura: inventário do código, inspeção
ao vivo, números da Mel, Hermes e IA.

O relatório completo, com o veredito de cada item (AC-01 a AC-31), as ondas e o desenho do Assistente, está no Artifact
<https://claude.ai/artifact/MJwqpqL9cMmiRPQ8n7E5XV>. A triagem de cada AC mora no banco dele (coleção `decisoes`), como a
das OT do blueprint.

## O diagnóstico em uma frase

As otimizações acertaram a pergunta ("quem eu chamo agora?"). O que faltava era **confiança**: a mesma coisa aparecia
com números, nomes e estados diferentes em cada tela, e o laço da venda não fechava dentro da Central (sem Ganho, Triagem
sem Dispensar, Telegram e Central fora de sincronia).

## Onda 1 (confiança), feita em 17/10/2026

| AC | O quê | Onde |
|---|---|---|
| AC-01 | A "Ficha" da A fazer abre (o link era interceptado pela casca e o CrmPanel não relia a URL) | `ProximaVenda.vue` (`onAbrir`), `CrmPanel.vue` |
| AC-02 | Um número só para a fila: aba, cartão e "fila inteira" leem `resumoDoDia` | `proxima-venda.ts` |
| AC-03 | Uma regra por métrica: Números, Funil (Quadro = Lista), taxa do expediente, sala do Escritório | `resultados.ts`, `funil-lista.ts`, `office/operacao.ts` |
| AC-04 | O status da Próxima venda aparece, e a falha de anotação tem "Abrir a Ficha" | `ProximaVenda.vue` |
| AC-06 | Telegram e Central com o servidor como fonte única (aviso fechado, toque atrasado, ritmo, expiração) | `vendedor.ts`, `venda-do-dia.ts` |
| AC-07 | Soluço de rede de uma tentativa não vira "Telegram inacessível" (49 das 51 quedas eram isso) | `telegram-polling.ts` |
| AC-17 | Um número só para o Dell no topo, na Hoje e no Mais; a Hoje sem comandos nem containers | `alertas.ts` (`resumoDoDell`) |
| AC-28 | Contador de uso por tela e por escrita da API, sem dado de lead | `server/uso.ts` |

## Onda 2 (fechar o laço), feita em 17/10/2026

| AC | O quê | Onde |
|---|---|---|
| AC-05 | O botão da fila escolhe o link pelo tipo: "Abrir a conversa" nunca dispara o gerar_demo | `proxima-venda.ts` (`linkDoPasso`) |
| AC-08 | Desfecho em um toque na Ficha, em todas as ofertas: Ganhou (confirmação), Perdeu (motivo), Proposta enviada, com desfazer | registros `ganhou`/`ganhou_desfeito`, `CrmFicha.vue`, `crm.py` |
| AC-09 | "2ª mensagem enviada" e "Follow-up enviado" à mão em Anotar, para onde aponta o "anote à mão" | `CrmFicha.vue` (`anotacoesAMao`) |
| AC-10 | Triagem em lotes de 10 com Convidar e Dispensar, e a Prioridade da Central (era 100 em todos) | `triagem.ts`, registros `dispensado`, `prioridadeDaTriagem` |
| AC-11 | Caçadores de Iris e Estamparias pausados (decisão do Rômulo): 1.423 parados contra 10 envios/dia | `prumo-ofertas.py --desativar` na Mel |
| AC-12 | Uma frase por próximo passo, a mesma no cartão e no "Agora" da Ficha | `fraseDaAcao`, `agoraDaFicha` |
| AC-14 | Ficha em ordem de decisão: Agora e primário, Desfecho, Conversa, Como vender (abre em "O que oferecer"), consulta | `CrmFicha.vue`, `ANATOMIA_DA_FICHA` |

## O que fica para as próximas ondas

Onda 3 (menos telas) e Onda 4 (Assistente, que depende da emenda da RULES 20 e da RULES 28 nova): ver o Artifact.
