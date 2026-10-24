# Simplificação comercial — primeiro lote da Fase 4

Data: 24/10/2026. Preservar o escritório e priorizar respostas já recebidas. Complementa o plano, a homologação do piloto e a matriz de responsabilidades.

## Mudanças deste lote

- Uma fábrica versionada de contexto para os três workflows WhatsApp: números, conversa e classificação de resposta. Cada consumidor mantém nome e formato de saída, dentro de um subfluxo aguardado. As quatro fontes Sheets continuam frescas; falha em qualquer fonte interrompe o caminho, sem confirmar “não é lead” com contexto parcial. Código original dos consumidores e credenciais são preservados.
- Cada regeneração reaplica os contratos por opt-in local estrito: `workflow-contexto-whatsapp.json`, versão 1, `contextoFresco` e `pausarJev` booleanos. Sem configuração, não altera o fluxo. Organização da Prumo também é inserida no subfluxo. Guarda adulterada, cadeia inesperada, referência fora do escopo, consumidor desabilitado ou erro tolerado exigem revisão.
- Pausa somente de novas comparações Jev: remover entrada do ramo e desabilitar os quatro nós. Preservar tabela, credenciais, nós e Gemini principal. A amostra auditada contém 159 comparações e nenhuma revisão humana; concordância com Gemini não é acurácia nem promoção. Revisar a amostra antes de outra coleta.
- Nomes da inferência do Caçador passam a identificar Luna/Hermes, incluindo conexões e referências. Classificação das respostas comerciais continua Gemini. A ponte `/comercial/evento` não chama modelo.
- Métrica de inferência Luna em JSONL privado: tarefa, duração incluindo validação/limpeza, execução Hermes, resultado validado localmente, provedor/modelo solicitados e, quando informado pelo artefato exclusivo da tentativa, modelo/provedor efetivos, chamadas API, tokens e custo **estimado**. Ausentes ficam desconhecidos; custo real continua desconhecido. Nunca registrar prompt, resposta, contato, erro livre ou ID de sessão. Arquivo antigo de uso não é reaproveitado; falha de métrica não autoriza outra inferência.
- SOUL e três skills existentes do Hermes recebem o contrato comercial atual. O secretário consulta e diagnostica; n8n executa contratos, Luna faz inferência restrita, Central concentra estados/fila, Rômulo negocia e confirma fatos. Instrução de leitura não constitui isolamento técnico das ferramentas do gateway. Nenhuma mudança global de capacidades neste lote.

## Limites e próximos lotes

A organização dos subfluxos **não reduz as quatro leituras Sheets por chamada**. O retrato atual remove telefone em certas linhas e trunca campos; usá-lo como índice completo poderia perder contatos ou sobrescrever estado recente. Índice completo, invalidação por escrita e medição de latência ficam para um lote específico. Também continuam abertos observabilidade ponta a ponta da projeção, unificação adicional das regras repetidas e isolamento técnico do secretário.

Hermes e Evolution correspondem à mesma conta física **na leitura atual**; `origem` identifica o coletor. A deduplicação pode fazer a captura Hermes prevalecer e deixar o evento fora do envelope comercial atual. Não reclassificar histórico por inferência. Correção por conta/sessão verificada ainda não implementada; detalhes em [identidade de captura](PRUMO-IDENTIDADE-CAPTURA-HERMES-2026-10-24.md).

Não reativar primeiros contatos pausados, caçadores desativados ou Grok. Não alterar recusas, esperas ou responsabilidade humana. Este lote não envia WhatsApp, cria proposta, confirma contrato/pagamento ou prova primeira venda. Silmer, agenda pessoal e cena do escritório ficam preservadas.

## Verificação e publicação

49 testes Python aprovados no Dell: 11 contexto, 12 Luna/ponte, 3 papéis/opt-in, 7 comercial e 16 confiabilidade. Compilação Python aprovada. Os novos testes usam dublês; não consomem modelos nem gravam fatos comerciais. Não houve mudança em servidor/UI, portanto a suíte de aplicação e o build já aprovados no lote anterior não foram repetidos.

Backups privados e resumos ficam em `~/.cache/mel-work/fase4-simplificacao-20261024T120444Z/`; fontes brutas não são publicadas.

## Reversão

Conservar filas, mensagens e dados. Restaurar os quatro exports imediatamente anteriores, por ID e estado ativo original; desabilitar o opt-in da simplificação antes de regenerar. Restaurar os sete instalados anteriores e remover somente os dois novos módulos após retirar o hook. Para retomar Jev, exigir decisão explícita e avaliação da amostra; restaurar todo o estado antigo não é justificativa para retomar o experimento inadvertidamente. Configuração, sessões e cron Hermes não são objeto desta reversão.

## Publicado e conferido

Commit de implementação `fd089b8`, publicado na main e aplicado pelo atualizador do Dell. Nove arquivos instalados conferidos byte a byte; opt-in local criado em modo 0600. Luna e gateway Hermes reiniciados após comprovação de ociosidade; ambos ativos, assim como Central e os dois observadores. Não executar o aplicador global do Hermes: este lote instala somente SOUL e três skills, sem alterar config, memória, cron ou ferramentas.

Homologação isolada no engine n8n: três workflows temporários autenticados fizeram somente as quatro leituras e o consumidor original. Dois casos sem número elegível voltaram “sem lead” com contexto completo; o terceiro preservou 1.874 chaves. Os três temporários foram removidos, zero falhas de limpeza. A mesma lista foi preservada antes/depois dessa homologação. Nenhum modelo ou nó de escrita foi conectado nos temporários.

Publicação estreita em quatro workflows: classificador 22→18 nós principais, conversa 9→5, números 8→4 e Caçador 9→9, com nomes Luna corrigidos. O subfluxo com organização canônica contém oito nós; a contagem menor no pai não significa menos trabalho de leitura. Todos com versão ativa correspondente à salva. Inventário final 21 workflows/18 ativos, estados individuais preservados; os outros 17 permaneceram intactos. Os 31 arquivos preexistentes do clone Dell permaneceram byte a byte.

A leitura real do endpoint publicado retornou 1.874 chaves no formato esperado. Amostra anterior de 3.519 ms; posterior de 5.664 ms durante verificação/Graphify. São amostras únicas sob cargas diferentes, sem conclusão de desempenho e sem economia alegada. A aderência futura do Hermes às instruções não foi avaliada por nova conversa ou teste de ferramentas; comprovar arquivo instalado e reinício não é uma prova de isolamento técnico.

Central respondeu normalmente após a publicação. Nenhum arquivo de servidor, componente, cena, câmera, personagem ou navegação foi alterado neste lote. O piloto continua assistido, com proposta, contrato e pagamento humanos. A Fase 4 permanece aberta para os lotes delimitados acima.
