# Classificação contextual das respostas — 22/10/2026

Pedido: implementar o primeiro refinamento da análise do histórico, sem enviar
mensagens aos contatos. O Grok continua em uma VM independente com duas revisões
diárias; o SquadOne não consegue alterar seu agendamento ou impedir seus envios.

`classificacaoResposta` é a leitura contextual versionada. Distingue interesse
comercial explícito, permissão, acesso/encaminhamento, curiosidade, robô, silêncio,
neutra, recusa, exclusão, pendência e ausência de envio. Cada leitura apresenta
motivo e evidência disponível, incluindo a pergunta anterior da nossa conta.

Interesse comercial explícito é pergunta sobre preço/funcionamento, necessidade
expressa ou intenção de avaliar/contratar. Não significa automaticamente dor,
impacto e decisor confirmados, proposta aceita ou pagamento. Curiosidade e elogio
isolado são insuficientes. Identidade só confirma acesso. Um sim depende da pergunta.

As classes são um recorte do estado atual, não eventos independentes do funil.
Há denominador de contatos com envio no período e explicação sobre tempos de
observação diferentes. Silêncio divide leitura confirmada e desconhecida; não se
usa o termo “ignorou”. Fonte sem texto e áudio não transcrito recebem revisão.

O CRM usa a conversa disponível para corrigir positivos ambíguos na leitura
operacional. Se isso muda `resposta`, conserva `respostaFonte`; os eventos da
planilha continuam originais. Sem conversa, a leitura sinaliza a insuficiência
sem reescrever a resposta legada. Recusas, exclusões e desfechos não são reabertos.
A operação de leitura não grava dados comerciais nem envia mensagens.

`quisVer` continua sendo o indicador legado de pedido de material ou interesse
explícito. Não equivale à nova contagem de interesse comercial. A permissão
específica mantém o material pendente; identidade isolada não o mantém.

O gerador de workflow conserva os seis tipos já aceitos pelas planilhas. Acesso,
elogio e sim sem contexto ficam neutros; permissão e pedido de vídeo ficam como
licença; interesse pede conteúdo comercial explícito. Há proteções determinísticas
além do prompt. Saídas são excluídas do lote de respostas; silêncio nunca é
classificado como mensagem recebida. A sombra registra o mesmo tipo final, sem
influenciar a decisão. Não foi criado envio automático.

Testes usam contatos fictícios, modelo simulado e fontes temporárias. A interface
preserva recebimentos confirmados como primeiro indicador em Números. O build de
validação local usa identificador OAuth fictício, não credencial real; esse pacote
não deve ser publicado. O teste do classificador usa `--testar`, nunca o comando
que publica workflows ou cria colunas.

Mudanças de código não equivalem à publicação no Dell/n8n. A publicação deve
reusar o identificador público OAuth do ambiente real, conferir os arquivos contra
a versão instalada e preservar workflows pausados e limites existentes.
Reclassificação contextual não reescreve retrospectivamente as planilhas.

Prompt proposto para o Grok: `PRUMO-GROK-ATUALIZACAO-2026-10-22.md`.
