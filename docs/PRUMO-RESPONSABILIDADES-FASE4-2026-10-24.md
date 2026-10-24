# Responsabilidades da operação — Fase 4

Revisão: 24/10/2026. Complementa a [Fase 4 do plano](PRUMO-PLANO-REORGANIZACAO-2026-10-23.md) e a [homologação do piloto](PRUMO-HOMOLOGACAO-PILOTO-2026-10-24.md). Base do negócio: [organização da Prumo](referencia/organizacao-prumo.md) e `prumo/00-contexto/organizacao.md`, lidos antes desta revisão.

## Escopo e estado desta entrega

Auditoria de leitura no Dell e atualização versionada do SOUL e das três skills Hermes existentes. Esta entrega não instala instruções, não muda capacidades, configuração, memória, cron, timers, workflows ou serviços e não envia mensagens a clientes. Não altera escritório, navegação, serviços pessoais ou operação da Silmer. Preparar estas instruções não comprova que o gateway já as carregou.

## Matriz de execução, decisão e registro

| Componente | O que executa | O que decide ou confirma | Fonte e limite |
|---|---|---|---|
| Prumo | Define oferta, condições, método e qualidade | Promessa comercial e critérios de aceite | Fontes canônicas da Prumo; condição individual confirmada é preservada antes do catálogo geral |
| Rômulo | Atendimento humano, negociação e definição das condições | Confirma qualificação, proposta final, envio observado/informado, aceite, cobrança, pagamento e responsabilidade conforme os gates da ficha | Fonte e evidência do fato; clicar em link ou receber aviso não confirma marco |
| Central/SquadOne | CRM operacional, fila, ficha, contexto, responsabilidade e agenda | Código aplica permissões e estados; interpretações não aprovam fatos humanos | Aba CRM existente, conversa observada e projeções atuais; caches são derivados |
| Observadores e adaptadores | Capturam mensagens e encaminham eventos reais | Não decidem compra, preço ou conta autorizada para responder | Origem do coletor é proveniência técnica; não equivale à identidade da conta emissora |
| n8n do Dell | Transporte, coleta e execução dos fluxos autorizados | Aplica contratos de persistência; classificação não é aceite comercial | Workflows e fontes versionadas; não assume negociação ou fechamento |
| Gemini e Jev no classificador de respostas | Gemini é primário; nova coleta Jev em pausa no lote técnico decidido | Jev não decide o estado comercial; revisar a amostra existente antes de qualquer continuidade | Estado anterior observado: ambos habilitados; Gemini com até três tentativas, nó HTTP Jev sem retry. Confirmar publicação do lote para afirmar a pausa efetiva |
| Luna em `luna-workflows.service` | Classificação de prospecção e resumo em contratos fixos; repasse comercial separado | Não confirma a qualificação humana, não envia a lead nem escolhe condições de venda | Inferência restrita, sem terminal, arquivos, memória ou ferramenta de envio; não é o secretário Hermes |
| Copiloto/agentes da Central | Interpretação e rascunhos sujeitos a revisão | Não confirmam fontes, preços negociados, aceite ou recebimento | Nova qualificação explícita governa; SPICED é fallback somente sem nota nova; invalidade exige revisão |
| Hermes secretário | Leitura, diagnóstico, síntese e encaminhamento ao Rômulo | Não altera CRM, agenda, infraestrutura ou condições comerciais por iniciativa própria | SOUL e skills; instruções comerciais novas propostas nesta entrega ainda precisam de instalação controlada |
| Visão semanal do Hermes | Síntese agendada somente de leitura | Não cria, pausa ou reativa executores nem confirma saúde comercial | Único job Hermes ativo observado; consulta de receita não prova leitura atual de cada oportunidade |
| VENDAS/Grok externo | Rascunhos sob pedido no escopo atual | Não há controle técnico comprovado da Central sobre sua execução ou pausa | Base externa separada; pausa declarada não é verificação independente da VM |
| Telegram existente | Entrega prioritária de avisos operacionais e passagem, com acesso à fila/ficha | Recebimento não é resolução da pendência nem envio a cliente | Transporte compartilhado com encaminhamento rastreável; não duplicar aviso no WhatsApp por suposição |
| WhatsApp do Hermes | Atendimento pessoal autorizado e transporte existente | Não concede permissão para contato comercial autônomo | Gateway Hermes ativo; não confundir com emissor Prumo, observador ou n8n |
| Socorro e healthwatch | Diagnóstico e remédios de infraestrutura conforme listas e tetos próprios | Não decidem campanha, preço, negociação ou fechamento | Contratos separados; não tornam o Hermes um operador irrestrito |
| Silmer e rotinas pessoais | Mantêm seus executores, dados e sincronismos próprios | Seus responsáveis e aprovações permanecem independentes | Não reorganizar ou pausar como efeito colateral desta fase |

## Contrato comercial comum

1. Consultar conversa e ficha atuais antes de propor ação. Separar fonte observada, confirmação humana, interpretação e lacuna.
2. Ler qualificação explícita, ciclo, responsabilidade e tarefa de atendimento. Nota nova inválida exige revisão; não recuperar silenciosamente uma antiga como atual.
3. Perguntar uma lacuna por vez quando houver abertura. Não exigir reunião, impacto financeiro ou decisor único se o processo com participantes estiver esclarecido.
4. Encaminhar preço, proposta, contratação, negociação, contrato e pagamento a Rômulo mesmo com qualificação incompleta. Proposta final mantém seus gates próprios.
5. Preservar condição individual confirmada. Valores em aberto permanecem desconhecidos; não preencher com padrão, zero ou desconto inventado. Ausência de aceite não vira contratação.
6. Preservar recusa, exclusão, pausa, espera e responsabilidade humana. Tarefa interna visível não autoriza contato. Origem do coletor não identifica conta de envio.
7. Usar Telegram e fila existentes para avisar. Ficha e ação só são concluídas pelos fatos e confirmações previstos, não pelo aviso ou clique.

## Roteamento conferido

| Entrada na tailnet | Destino local | Papel |
|---|---|---|
| HTTPS `443`, `/` | `127.0.0.1:9119` | Painel Hermes |
| HTTPS `443`, `/webhook` | `127.0.0.1:5679` | Webhooks n8n |
| HTTPS `443`, `/prumo/metricas` | `127.0.0.1:8767` | Medição Prumo |
| HTTPS `8443`, `/` | `127.0.0.1:9120` | Central e CRM |

A leitura do Serve não encontrou Funnel habilitado. Isso comprova o roteamento observado, sem afirmar uma auditoria completa de exposição de rede. Links de ficha devem vir da origem com a base da Central; não montar links comerciais no painel Hermes nem reproduzir hostname, contatos ou identificadores pessoais neste documento.

## Evidências de leitura e limites

Leituras feitas em 24/10/2026, com valores secretos e conteúdo de sessões excluídos da saída:

- `~/.hermes/SOUL.md` e as três skills operacionais estavam iguais às versões do checkout Dell antes desta alteração. Não havia `~/.hermes/AGENTS.md`. As instruções antigas não mencionavam os novos contratos de qualificação, ciclo, responsabilidade e atendimento.
- `~/.hermes/config.yaml`: terminal local; presets `hermes-whatsapp` e `hermes-telegram`. A definição instalada em `~/.hermes/hermes-agent/toolsets.py` inclui terminal, escrita/patch de arquivos e gerenciamento de cron nesses presets. Regra de leitura no SOUL não é isolamento técnico de escrita. A lista de pré-aprovações não continha as categorias perigosas de exclusão/controle de containers verificadas.
- `~/.hermes/google_token.json`: seis escopos declarados, todos `readonly` (Calendar, Contacts, Documents, Drive, Gmail e Spreadsheets), arquivo modo `0600`. Não foi feito refresh nem teste de capacidade nas APIs; escopos declarados não auditam a sessão de navegador.
- Painel `/api/status` do Hermes: gateway em execução, somente WhatsApp na lista de plataformas ativas; zero agentes e sessões ativos na leitura. Telegram constar do config não prova canal Telegram ativo no Hermes. Avisos Telegram da Central/monitor são transportes separados.
- `~/.hermes/cron/jobs.json`: nove jobs, oito desativados e somente Visão semanal de receita ativo; última execução em 19/10 com estado `ok`, próxima em 26/10 às 08h30. O prompt foi inspecionado apenas por indicadores derivados: leitura, pasta de receita, sem ordem de mudança. Não foi copiado para o relatório.
- Timers de Graphify, Sites e pendências e Entrada permaneciam ativos, com respectivos jobs Hermes desativados. Não são três rotinas comerciais extras do Hermes. `silmer-drive-sync.timer` e backup também estavam ativos e não foram alterados. Crontab do usuário sem entradas.
- Gateway, painel e navegador Hermes ativos; `ProtectHome=no`, `ProtectSystem=no`, `NoNewPrivileges=no` nas unidades observadas. Isso caracteriza isolamento não aplicado por essas opções, sem comprovar exploração ou dano.
- Luna, Socorro e healthwatch instalados correspondiam às fontes do checkout Dell. Foram lidos código e metadados; nenhuma inferência, remédio ou capability foi executada nesta auditoria.
- Os journals foram resumidos em contagens de 24 horas, sem imprimir mensagens. Não houve entradas de warning/error por prioridade nos quatro journals consultados. O silêncio do journal não comprova entrega comercial ou ausência de execução em outros logs.

Fontes privadas ficam no Dell: configurações e cron em `~/.hermes/`; unidades em `~/.config/systemd/user/`; instruções e ferramentas instaladas sob `~/.hermes/`; journal do systemd; estado do monitor em `~/.local/share/squadone-operations/status.json`. Não copiar tokens, prompts completos, contatos ou conversas para Git, Drive, grafo ou memória. A baseline exata dos quatro arquivos versionados foi guardada na área privada da execução, em `output/reorganizacao-prumo-20261023/hermes-fase4-baseline/`, no checkout de controle.

## Correções prioritárias e aceite

| Prioridade | Lote implementável | Aceite verificável | Estado |
|---|---|---|---|
| 1 | Atualizar SOUL e três skills com os papéis e contrato comercial acima | Revisão do diff; após instalação autorizada, comparação byte a byte e confirmação de carregamento, sem envio | Documentação preparada; não instalada por esta entrega |
| 2 | Restringir tecnicamente o perfil secretário a leitores e consultas fixas | Testar em ambiente isolado que ler é permitido e escrever arquivo/CRM, gerir cron e enviar a lead são recusados; preservar Luna/Socorro e operação pessoal/Silmer | Proposto; requer lote de permissões separado, sem alterar globalmente o gateway agora |
| 3 | Unificar encaminhamento comercial na fila/Telegram existentes | Mesmo evento não gera avisos concorrentes; ficha usa base `8443`; recebimento e resolução permanecem distintos | Fluxo atual a preservar; revisão das instruções preparada |
| 4 | Fazer Hermes consultar os mesmos estados derivados da Central | Nota nova inválida não cai no legado; preço incompleto passa ao humano; pausa/espera/owner não geram rascunho de contato; coletor não vira conta emissora | Contrato documentado; automação adicional não implementada aqui |
| 5 | Tornar o inventário de executores e rotinas rastreável | Um responsável, entrada, saída, cadência, condição de repetição e reversão por executor; cron pausado não reaparece como tarefa nova | Inventário inicial acima; não desligar rotinas pela contagem |
| 6 | Verificar divergência entre fontes versionadas, instaladas e síntese semanal | Manifesto de versões sem segredos; leitura do CRM com frescor explícito quando a síntese depender dele; desconhecido declarado em vez de sucesso presumido | Proposto; não modificar cron ou memória nesta entrega |

## Jev em sombra: amostra existente e decisão atual

A autorização histórica de medir o Jev em sombra está documentada em
`deploy/dell/claude-ops/whatsapp-conversa.py` desde 11/10/2026. Não se trata de um
agente negociador. Antes do novo lote, a consulta GET ao workflow publicado
confirmou o classificador ativo: Gemini `models/gemini-3.6-flash` primário, nó
habilitado com retry e `maxTries=3`; nó HTTP Jev habilitado e `retryOnFail=false`.
A Luna dos Caçadores continua independente dessa comparação.

O `jev-respostas-resumo.py` instalado foi comparado ao fonte e inspecionado antes
da leitura. As funções existentes foram chamadas com transporte limitado a GET
na Data Table, sem executar inferência, `--revisar`, gravação ou gerador de fluxos.
Resultado em 24/10/2026:

| Medida | Resultado observado |
|---|---|
| Comparações registradas | 159 linhas, 85 leads distintos |
| Período dos registros | 13/10 a 23/10/2026 |
| Revisão humana | 0 leads revistos; 159 linhas pendentes |
| Concordância Jev × Gemini | 71,70%; 76,42% nos casos de uma mensagem |
| Concordância com humano | Indisponível; concordância entre modelos não é acurácia |
| Erro impeditivo pelo gate legado | 0 interesse/licença classificados como negativa/exclusão; não garante ausência de outros erros |
| Sinal de injeção pelo limiar existente | 2 linhas; não comprova incidente |
| Custo informado nos registros | US$0,004571532; não é o custo total da operação |
| Latência Jev p50 / p95 | 725 / 2356 ms |
| Modelo efetivamente registrado | `typesafe/jev-1.13-20260917` |
| Promoção pela regra existente | Não |

A regra exige pelo menos 60 **leads** com revisão humana, concordância Jev × humano
≥95% e nenhum interesse/licença convertido em negativa/exclusão. Concordância com
Gemini não promove sozinha. O requisito adicional de DPA da TypeSafe consta no
procedimento existente; sua situação não foi verificada nesta auditoria. A
comparação legada trata licença como interesse para o Jev; ela não valida a nova
qualificação comercial e precisa manter essa distinção ao avaliar uma promoção.

**Decisão técnica atual:** pausar somente a coleta de novas comparações do ramo
Jev, preservando as 159 linhas e o Gemini primário. O lote técnico separado remove
a aresta entrante e desabilita os quatro nós Jev, com preservação da decisão em
regenerações por configuração local opt-in. Confirmar a publicação e a leitura de
retorno antes de afirmar que a pausa já está efetiva. Este documento e as edições
do Hermes não executam a mudança. Não pausar o workflow inteiro, os observadores,
a Luna dos Caçadores, Silmer ou rotinas pessoais; configuração Hermes fica intacta.

Não há evidência de retorno decisório suficiente para manter coleta indefinida;
tampouco há evidência de zero uso, superioridade de modelo ou economia comprovada.
A próxima atividade é **revisar a amostra existente antes de reativar ou promover**.

**Responsáveis propostos para a revisão:** RevOps prepara a seleção e registra a
avaliação; Rômulo confirma a revisão humana e decide continuidade. **Data proposta
para essa decisão: 26/10/2026**, sujeita à disponibilidade de revisão. Usar casos
de divergência e controles concordantes, identificando versão/contexto para não
misturar regras antigas e atuais. Uma reativação precisa de pergunta experimental,
responsável e próxima data de revisão; promoção exige os gates completos. Sem
revisão disponível, conservar a pausa, sem bloquear o atendimento comercial.

Dados individuais, hashes e IDs das linhas permanecem na tabela privada do n8n;
este documento registra apenas agregados. Não copiar trechos de conversa para a
matriz ou para a revisão externa.

## Desconhecidos que permanecem

- Estado e capacidades reais da VM/Grok, catálogo que recebe e confirmação independente da pausa externa.
- Escopos e capacidade efetiva da sessão persistente do navegador Google; só os escopos declarados do token foram lidos.
- Conjunto final de ferramentas de uma sessão futura após filtros de plugins, defaults e atualizações do Hermes. A auditoria confirmou a configuração/presets, sem invocar o agente para experimentar escrita.
- Efeito comercial da revisão semanal: estado técnico `ok` não comprova oportunidades qualificadas, contratação ou pagamento.
- Entrega futura dos avisos e carregamento das instruções propostas: exigem verificação posterior à instalação autorizada, preservando serviços e pausas existentes.

A Fase 4 continua aberta para simplificação e medição dos executores. Esta revisão organiza seus limites sem tratar uma mudança de documentação como economia comprovada, qualificação humana ou venda.