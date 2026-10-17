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

## Onda 3 (menos telas), feita em 17/10/2026

| AC | O quê | Onde |
|---|---|---|
| AC-13 | Um nome por coisa na tela (Vendas, Ganho/Ganhou, Roteiro, 2ª mensagem, Leram/Leu, Atualizar, Escritório, A fazer, as ofertas), com o glossário que o teste confere | `src/operations/glossario.ts`, `src/operations-glossario.test.ts`, `crm-formato.ts` (`textoDaSubEtapa`) |
| AC-15 | Vendas no celular: abas numa linha que rola de lado, ofertas e etapas num "Filtros" fechado, a Próxima venda logo abaixo das abas | `CrmPanel.vue` |
| AC-16 | O primário logo depois do porquê, a mensagem em "Ver a mensagem" e o filtro de nicho por chave | `ProximaVenda.vue`, `proxima-venda.ts` (`chaveDoNicho`) |
| AC-18 | A Hoje no Dell sem o bloco Time | `HojeRota.vue` |
| AC-19 | Funil com uma alternância (Quadro \| Lista); "Por passo" virou o filtro Passo; Próximo passo pela fila; um rótulo curto por oferta | `funil-lista.ts`, `CrmFunil.vue`, `SIGLA_DO_PRODUTO` |
| AC-20 | O Roteiro saiu das abas de Vendas e mora em Mais › Entender | `MaisRota.vue`, `/mais?abrir=roteiro` |
| AC-21 | Um "Liberar" do dia no servidor, o mesmo na Próxima venda, na Triagem e na Ficha | `venda-do-dia.ts`, `liberados.ts` |
| AC-22 | O lead Novo tem o primeiro contato como primário na Ficha, com as travas e o motivo | `primeiro-da-ficha.ts` |
| AC-23 | O Ctrl+K acha as abas e os leads, e a dica diz a tela em palavras | `casca/paleta.ts` |
| AC-24 | Manutenção só com ferramentas; um "Ver no blueprint" por fluxo | `casca/mais.ts`, `fluxos.ts` (`blueprintDoFluxo`) |
| AC-25 | Ações raras fora do destaque: Desconectar o Google em Manutenção, Arquivar a squad na folha de editar, "Atualizar" pequeno | `MaisRota.vue`, `EditarFolha.vue`, `FinancasPanel.vue` |
| AC-26 | Finanças: aviso de orçamento pelo Telegram, parcelas futuras numa dobra, "Todos os meses", o nome de cada conexão no selo | `financas/*` |
| AC-27 | A Entrada diz "Entrada" e volta para "← SquadOne" | `deploy/dell/entrada/pagina.html` |

## O que fica para as próximas ondas

- Onda 4 (Assistente): RULES 28 e a exceção da 20 aprovadas, MVP construído e ligado na Mel em 17/10/2026 (AC-31).
  Fase 2 **feita em 17/10/2026**: o copiloto da Ficha absorvido pelo painel (cartão "Sugestão do copiloto" só com a
  referência do lead; `CrmCopiloto.vue` saiu), o cartão de gasto falado (a RULES 28 pedia; grava por
  `POST /api/financas/gasto`, sem o valor passar pelo Assistente) e o "Perguntar sobre este lead" abrindo o painel de
  dentro da Ficha, também no celular. Pendente, fase 3: Jev medindo a intenção em sombra e o /a no Telegram.
- O nome das contas no selo de Finanças: o selo já mostra o nome de cada conexão, mas o servidor ainda não
  manda as contas por conexão (`server/financas/resumo.ts` mandar `contas` em cada uma).
