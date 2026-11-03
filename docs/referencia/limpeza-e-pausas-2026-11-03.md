# Limpeza de código e histórico das pausas

Conferência: 03/11/2026, horário de São Paulo. Escopo: checkout atual do SquadOne,
histórico de todas as referências Git locais, repositórios SquadOne/Prumo no Dell,
metadados da API do n8n, política operacional e estados do systemd. Não foram
lidos payloads de execuções nem enviadas mensagens, perguntas à IA ou coletas.

## Código retirado

- Componentes sem importadores no app atual: `src/casca/EscritorioVivo.vue`,
  `src/operations/ProximaVenda.vue` e `ConversasParaAvancar.vue`.
  A Central monta GameMap e SalaComando diretamente; CrmPanel abre AtendimentoCliente
  e CrmFicha. Cena, sprites, câmera, navegação e componentes ativos foram preservados.
- `src/operations/agenda-window.ts`: somente o teste próprio chamava `upcomingAgendaEvents`.
- Teste exclusivo da função removida: `operations-agenda-window.test.ts`.
  Os testes das regras compartilhadas de
  cadência, receita, follow-up e CRM permanecem.
- Quatro nós `Jev:` do classificador de WhatsApp: todos desabilitados e sem ligação
  ao grafo principal. `workflow_limpeza.py` aplica a mesma remoção ao final dos
  ganchos de publicação, inclusive após a simplificação do contexto. Uma aresta
  externa, referência por expressão, nó habilitado ou conjunto incompleto impede
  a remoção. Tabela, amostras históricas, ferramentas de análise e a sombra Jev da
  agenda não são removidas.
- Arquivo operacional antigo `~/.local/share/squadone-operations/auto-production.json`:
  última alteração em 17/09/2026; os leitores foram aposentados em 30/09. Cópia
  privada de reversão antes da retirada. `server/auto-production.ts` permanece ativo.

Referências atuais no CLAUDE, blueprint e inventário de testes foram ajustadas;
relatórios históricos de UX conservam os nomes da época. As demais alterações
preexistentes do checkout foram preservadas. Exports e geradores dos workflows
pausados também foram preservados.

## Por que cada fluxo está parado

Os hashes abaixo pertencem a `romulosutil/SquadOne`. Alguns commits estão em outras
referências e não na branch deste checkout; consultar com `git show <hash>`.

| Fluxo/processo | Motivo registrado | Commit e evidência |
|---|---|---|
| Caçador de Site (`oow8TkxrAf4fVvTj`) | Gargalo de conversa: 107 leads esperando primeiro contato e centenas em revisão. A falha de SSRF foi corrigida; a pausa foi deliberada. | [16523e1](https://github.com/romulosutil/SquadOne/commit/16523e1), 29/10; `docs/PRUMO-DECISOES-PM-2026-10-28.md`. A condição histórica de retorno (<90 pendentes/mudança do mix) antecede a restrição posterior de APIs pagas e não autoriza ativação automática. |
| Caçadores Íris e Estamparia | AC-11: cerca de 1.800 achados num dia e 1.423 em triagem contra 10 envios/dia; processar a fila existente antes de adquirir mais. | [f6e1611](https://github.com/romulosutil/SquadOne/commit/f6e1611), 17/10; `docs/ux/2026-10-17-auditoria.md` e CLAUDE do commit. Bloqueios de pesquisa paga posteriores em [b186357](https://github.com/romulosutil/SquadOne/commit/b186357). |
| 05 · Acompanhamento (`4lFlWNGv5KDZytJE`) | Parser legado ignorava ciclo e responsável atuais; podia expirar negociação que a Central protegia. A Central governa prazos e espera. | [c8b8706](https://github.com/romulosutil/SquadOne/commit/c8b8706), 24/10; implantação conferida em [54200b6](https://github.com/romulosutil/SquadOne/commit/54200b6). `docs/PRUMO-OPERACAO-ASSISTIDA-FASE4B-2026-10-24.md`; motivo atual confirmado em `workflow-operacao.json`. |
| 06 · Funil semanal (`cn4KcQujNk9CwcN0`) | Regras legadas de pausa de buscas não equivalem à qualificação, ciclo e responsável atuais; podiam interpretar licença/preço como sinal de compra. Preservar Buscas e `site-funil.json`. | [37c8457](https://github.com/romulosutil/SquadOne/commit/37c8457), 24/10; seção “Lacuna conhecida do Funil 06” de `docs/PRUMO-PROSPECCAO-FASE5-2026-10-24.md`. Motivo atual também na política privada. |
| Fonte com IA (`yNLwUy5bdEmC4Qss`) | Suspensão de inferência por custo zero; nó de consulta transformado em bloqueio e ativação protegida. | [b186357](https://github.com/romulosutil/SquadOne/commit/b186357), 03/11, adiciona a Fonte a `n8n.DESLIGADOS`; implantação descrita em `docs/PRUMO-PESQUISA-HIGIENE-2026-11-01.md`. Política privada confirma o motivo. Há divergência de escopo descrita abaixo. |
| Radar PNCP (`c8d62107-67db-4a1e-b6a9-211f9d9ef0df`) | Frente subutilizada; pausa deliberada sem apagar dados. Arquivamento posterior, separado do n8n geral da Mel. | [b2fc29d](https://github.com/romulosutil/SquadOne/commit/b2fc29d), 11/10; [4d9422e](https://github.com/romulosutil/SquadOne/commit/4d9422e), 28/10, registra arquivamento. Em 03/11: `active=false`, `isArchived=true`. |
| Lead Scout antigo | 57 convites frios, 21 respostas de robô e nenhum dono interessado; entrada passou a ser pela CDL. | [1830b01](https://github.com/romulosutil/SquadOne/commit/1830b01), 08/10. [4d9422e](https://github.com/romulosutil/SquadOne/commit/4d9422e) registra que já não existia na instância em 28/10. |
| Ramo Jev do classificador | Pausa de nova coleta até revisar a amostra: 159 comparações, zero revisão humana; concordância entre modelos não comprova acurácia nem permite promoção. | [fd089b8](https://github.com/romulosutil/SquadOne/commit/fd089b8), 24/10; `docs/PRUMO-RESPONSABILIDADES-FASE4-2026-10-24.md`. Remoção atual limitada aos nós isolados; histórico preservado. |
| Syncthing | Sem aparelho pareado desde 04/10; espelhamento substituído pelo backup Dell → Drive. | [bf31318](https://github.com/romulosutil/SquadOne/commit/bf31318) remove a verificação e registra a aposentadoria em 12/10. Em 03/11 o serviço está desabilitado e parado; unidade preservada. |

### Divergência da Fonte

O complemento de 1/11 restringe custo zero à pesquisa e ao enriquecimento; o
`custo_zero_n8n.py` atual já deixa atendimento, classificação e Fonte fora desse
escopo. Entretanto, `n8n.DESLIGADOS`, a política privada e o grafo da Fonte ainda
guardam a suspensão anterior. Não foi encontrado um commit de retomada da Fonte
nas referências consultadas dos dois repositórios. Isto exige reconciliar a
decisão e a implementação em um trabalho próprio; a limpeza não reativa a Fonte.

## O que permanece em execução

Na API: 22 workflows, 15 ativos e 7 inativos (o Radar é arquivado). Central,
observadores, Luna dos workflows, timers de curadoria/frente comercial/contexto
e vigia do Mapa presentes. `inactive/dead` de serviço oneshot entre disparos não
é abandono quando o timer/path continua ativo. A ausência de execuções salvas
também não prova parada: CRM, pesquisa e Medição não guardam sucessos.

Medição atualizou `prumo-metricas.json` em 03/11 às 15h48; CRM também foi atualizado
no dia. Esses arquivos não foram removidos. Copiloto, Assistente e a sombra Luna
da agenda estão habilitados; as flags da sombra Jev da agenda também existem.
Não confundir esses experimentos com os quatro nós isolados no n8n.

## Validação e reversão

O teste de `workflow_limpeza.py` cobre preservação dos metadados, idempotência,
dependências por aresta/expressão e recusa de remoção de conjuntos incompletos ou
habilitados. Antes de publicar, o PUT foi capturado em memória: a diferença é
exatamente a retirada dos quatro nós, sem mudar configurações ou outros nós.

Limpeza operacional aplicada às 16h03 de 03/11/2026. O classificador ativo passou
de 18 para 14 nós; os outros 21 workflows conservaram nós, ligações, configurações,
versão e data de atualização. Os 22 estados de ativação/arquivamento ficaram
iguais: 15 ativos e 7 inativos, incluindo o Radar arquivado. Uma segunda captura
de PUT em processo novo confirmou a idempotência do gancho instalado. A Central
continuou disponível com agenda e Assistente habilitados, sem reinício.

O arquivo antigo foi retirado do diretório operacional. Backup do arquivo, do
classificador e do cliente n8n anterior em
`~/.cache/mel-work/limpeza-codigo-20261103-160305/`, diretório 0700 e arquivos 0600;
`conferencia.json` registra o resultado sem payloads de execução. O cliente instalado
recebeu apenas as duas linhas do gancho final, preservando os demais ganchos atuais
do Dell; o checkout local está em outra branch e não substituiu o cliente inteiro.

Validação: `npm run lint` e `npm run build` aprovados; `npm test` com 3.457 testes,
3.455 aprovados, dois ignorados e zero falhas. A primeira execução no sandbox teve
erros EPERM em renomeações temporárias; a execução fora dessa restrição passou.
Python: 5 testes da limpeza, 8 de confiabilidade e 4 de custo zero aprovados.
O README do repositório Prumo também ganhou a conferência datada da pausa da Fonte.

Na preparação da publicação, a main atual ainda importava `CrmConfirmarPasso.vue`
na Ficha. Esse componente e `operations-confirmar-passo-ui.test.ts` foram
preservados; a ausência de importadores no checkout auditado não autorizou
retirá-los da main. `ProximaVenda.vue` já havia sido removido da main e não
entra novamente como exclusão no commit. A publicação usa somente as mudanças
deste trabalho, sobre a main atual, sem as demais edições do checkout.
Não restaurar workflows nem reativar pausados como efeito colateral de uma reversão.

### Validação da publicação isolada

A publicação foi preparada sobre `origin/main` `f135ab0`, com índice temporário,
sem incorporar as demais edições do checkout e sem mudar seu HEAD/índice original.
A árvore exata foi exportada e validada separadamente: tipagem e build aprovados;
o build isolado usou um Client ID OAuth sintático de teste, sem copiar segredos
ou publicar seus artefatos. O blueprint teve somente três referências de
`ConversasParaAvancar.vue` substituídas por `AtendimentoCliente.vue`.

Com concorrência limitada a dois arquivos, a árvore da limpeza teve 4.681 testes:
4.678 aprovados, dois ignorados e uma falha em
`src/operations-sinais-comerciais.test.ts:28` (horário da última recusa).
A mesma execução na main original teve 4.682 testes: 4.679 aprovados, dois
ignorados e exatamente a mesma falha. A diferença de um teste corresponde à
função de agenda retirada. O teste temporal do monitor passou nessa comparação.
A falha preexistente não foi alterada por este trabalho. Os cinco testes Python
da limpeza também passaram na árvore isolada.
