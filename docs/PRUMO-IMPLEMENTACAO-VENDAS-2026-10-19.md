# Implementação do diagnóstico de vendas — 19/10/2026

Pedido: executar `PRUMO-DIAGNOSTICO-VENDAS-2026-10-19.md`, preservando as alterações anteriores do checkout.
Objetivo comercial até 08/11/2026: cinco propostas qualificadas e um pagamento confirmado.

## Fontes e limites

- O retrato real prevalece sobre as contagens históricas do diagnóstico. Em 19/10, há dez interessados e duas propostas dentro desse mesmo conjunto; não são doze pessoas diferentes. As propostas atuais são Comece e Roda Mais. Verde+ exige conferência, sem criar proposta retroativa.
- Ganho registrado não comprova pagamento. Sem registro explícito, a Estrela-guia é **não medida**, inclusive quando há zero ganhos.
- Pausas, recusas e condições históricas são preservadas. Preparar uma ligação não significa que ela foi aceita ou que uma mensagem foi enviada.
- O banco externo `ArtifactData/decisoes` do blueprint não é exposto pelas ferramentas disponíveis. Não se inferem seus estados; o pedido explícito deste diagnóstico orienta as mudanças locais.
- O checkout já continha alterações extensas. Nenhuma limpeza, restauração ou inclusão geral delas em commit faz parte desta execução.

## Fase 0 — decisão aplicada

Teto compartilhado de 30 primeiros contatos/dia, intervalo de cinco minutos e 12/h. Plus conduzido pelo Rômulo; caçadores pausados não são religados. Não há cota por linha.

## Validação inicial

A verificação de tipos estava incluindo cópias antigas sob `output/` e `brag-output*/`. Essas saídas passaram a ser excluídas, mantendo o código da aplicação na verificação. O typecheck passou após esse ajuste.

O primeiro `npm test` isolado executou 2.894 testes: 2.772 passaram, 120 falharam e dois foram ignorados. Parte das falhas vem das restrições de conexão local e renomeação de temporários do sandbox; a execução com permissões apropriadas e dados fictícios isolados deve separar essas falhas dos defeitos do código.

Os resultados de cada fase e a instalação serão registrados abaixo somente após verificação.

Reexecução inicial: **typecheck aprovado; 2.892 testes passaram, zero falhas e dois ignorados; build aprovado**. O build local usou um Client ID OAuth fictício exclusivamente no processo de teste e não é um pacote de produção. Os testes do roster passaram a selecionar explicitamente suas próprias pastas fictícias antes dos imports; seis rótulos visíveis foram alinhados ao glossário Vendas. Logs em `output/diagnostico-vendas/`.

Fase 0: mais 72 verificações TypeScript e 34 Python focadas passaram. As verificações Python no Windows usaram adaptações temporárias para dependências Linux, sem exercitar o bloqueio `fcntl`; a instalação deve validar novamente no Linux da Mel. Nenhuma instalação desta fase foi declarada antes de ocorrer.

## Fase 1 — preparo entregue

[Pacote dos quentes](PRUMO-QUENTES-2026-10-19.md): dez interessados únicos, duas propostas dentro desse conjunto, mais Verde+ para auditoria da divergência. Cada ficha traz o SPICED conhecido com evidência, lacunas, convite condicional e três perguntas SPIN.

Oito próximos passos **internos** para 20/10 foram gravados pela rota existente e confirmados na fonte em `2026-10-19T23:23:13.731Z`. Convite não enviado e ligação não marcada. Comece preserva o próximo passo de 19/10, a espera e a proposta histórica; Roda Mais preserva a pausa até resposta. Verde+ não recebeu proposta ou plano fictício.

Na Mel: somente os oito registros preparatórios de próximo passo; nenhum serviço instalado nesta fase. Para o Rômulo: conferir o contexto atual, decidir quais convites cabem, enviar e conduzir as ligações. Estrela-guia em 19/10: **não medida**, pois a fonte ainda não registra pagamentos confirmados; ganhos registrados: zero.

## Preços: Iris por ficha ativa; Estamparia pendente

O Rômulo indicou a regra existente no repositório Iris. A fonte `Iris/src/lib/billing/calculator.ts`, `FAIXAS_PRECIFICACAO`, cobra por **ficha ativa/mês em faixas marginais**: primeiras 15 a R$ 39, da 16ª à 40ª a R$ 32 e seguintes a R$ 25. A faixa nova não reprecifica as anteriores: 20 fichas somam R$ 745/mês. O preparo comercial deve usar essa regra determinística, sem mudar preços no Iris ou aceitar um valor produzido pelo modelo. Sem quantidade confirmada, não inventar total.

O CRM de estamparia permanece sem preço definido. Nenhuma sugestão de preço ou desconto passa a ser cardápio aprovado por consequência desta conversa. As ofertas não herdam valores de Site ou Serviços PRUMO.

Referências públicas consultadas em 19/10/2026: [PsicoManager, planos individuais](https://psicomanager.com/planos), que exibe R$ 89/mês no Pró; [Vestalize para estamparia](https://vestalize.com/solucoes/sistema-para-estamparia), que anuncia R$ 79,90/mês no Profissional. Públicos, contratos e funcionalidades diferem: o Iris atende governança clínica de clínicas de terapia infantil e não equivale a um plano individual de agenda. Essas referências não definem seu preço nem justificam automaticamente cobrar abaixo delas. Hipótese a validar: piloto pago com implantação acompanhada, escopo, resultado esperado e prazo de revisão do preço; sem desconto permanente presumido.

## Instalação: cuidado com a base

A Mel e a referência local `main` estavam em `52a076f` no início da integração. A Fase 2 foi instalada em `5cce535`; as fases seguintes partem dessa base atualizada. O checkout ativo permanece em `ff91abc`, anterior à produção e com alterações extensas. Copiar o build local inteiro ou publicar seus arquivos sem conciliação reverteria melhorias já instaladas. A integração usa somente os trechos intencionais de cada fase, preservando as alterações preexistentes. O build de produção usa a configuração real já presente na Mel, sem copiar credenciais para este relatório.

## Fase 2 — implementação e verificação local

- `src/operations/spiced.ts`, `types.ts`, `server/crm.ts` e `deploy/dell/claude-ops/crm.py`: registro estruturado `spiced` na aba CRM existente, leitura do último válido, limite de 200 caracteres por campo e 1.000 no JSON, datas reais e enumeração validada. Um objeto vazio permite retirar uma confirmação. Sugestões nunca entram automaticamente nesse registro.
- `src/operations/copiloto.ts`: extração parcial de S/P/I/C/D com citação literal verificável. Sem evidência, o campo não vira sugestão. O modelo não produz preço; impacto em dinheiro exige o valor literal do lead. Sem qualificação confirmada, não há itens de proposta.
- `CrmSpiced.vue`, `CrmFicha.vue` e `AssistenteSugestao.vue`: faixa `BP-SPICED`, edição manual, confirmação explícita em um toque, estado aguardando a fonte e rascunho preservado por lead. Sugestões não se confundem com campos confirmados. Recepção e robô bloqueiam a proposta nos caminhos de envio e cópia.
- `mandar-proposta.ts` e `proxima-venda.ts`: dor + impacto + decisor confirmado são exigidos nas cinco linhas. Sem isso, o passo pede dez minutos e mostra as perguntas que faltam. Registrar a proposta histórica real continua permitido: não apaga a condição anterior da Comece.
- `precos-iris.ts` e `colinha.ts`: faixas marginais espelhadas da fonte do Iris, com identificação de origem e SHA-256, cálculo inteiro em centavos e testes nas fronteiras. Quantidade ainda desconhecida não vira total; Estamparia permanece sem valor.

Validação local: tabela das oito combinações de qualificação nas cinco linhas; parser do CRM e n8n; citações ausentes/inventadas, robô, recepção e moeda do modelo; render Vue em memória com confirmação humana e preservação de rascunho. Rodada completa local: **2.984 passaram, zero falhas, dois ignorados**; verificações de tipos e build aprovadas. Testes adicionais de preços/SPICED/propostas/colinha/jornada: 219 aprovados; três testes do validador n8n aprovados. O build de teste usa Client ID fictício e não deve ser instalado.

Na Mel: Fase 2 instalada em `5cce535` e conferida em 19/10 às 20:48:31 de São Paulo; [registro da instalação](PRUMO-INSTALACAO-VENDAS-2026-10-19.md). Sete rotas reais responderam 200; OAuth, oito preparos internos, duas propostas e pausas foram preservados. Testes Linux: 42 do executor e três do validador SPICED aprovados. Para o Rômulo: preencher ou confirmar a qualificação real antes de preparar proposta; quantidade de fichas do Iris e preço da Estamparia não são inferidos. Estrela-guia em 19/10: não medida até a instrumentação da Fase 4.

Verificação da Fase 2 conciliada com a produção: **3.338 testes aprovados, zero falhas e dois ignorados**, typecheck e build de teste aprovados. Smoke com o roteador real, `CrmStore` e n8n simulado: leitura 200, escrita sem origem 403, JSON inválido 400, registro SPICED válido 201 e qualificação confirmada na releitura da fixture, com etapa preservada. O delta contém somente os trechos intencionais sobre a `main`; credenciais, dados reais e o `dist` de teste ficam fora. Os três testes Python do validador também passaram; o teste do executor do time será conferido no Linux antes da instalação.

## Fase 3 — cadência e experimentos entregues para integração

- `cadencia.ts`, `proxima-venda.ts`, `server/crm.ts`, `server/venda-do-dia.ts` e `crm.py`: proposta sem toque no dia zero, retornos no primeiro e terceiro dias úteis e perda no décimo dia corrido sem retorno. Confirmação de envio durável por proposta e degrau, na mesma aba CRM. Conversa tem um toque no segundo dia útil e revisão no sétimo corrido. Dias úteis seguem segunda a sexta do expediente existente; não há calendário de feriados. Recusa, exclusão, perda manual, pausa, resposta humana e próximo passo futuro impedem cobrança indevida; um combinado antigo não reabre recusa.
- `server/vendedor.ts` e fila: responder, proposta qualificada, combinado, depois do link e proposta passam antes das revisões. Avisos de conversa podem sair entre 7h e 22h, inclusive fora do expediente; o primeiro contato conserva horário, teto compartilhado e ritmo.
- `site-acompanhamento.py`, `crm.py` e `site-demos-limpeza.py`: follow-up único nos dias 3–6, independente do recibo; perda fria no sétimo dia. Demonstrações usam esse prazo comercial e a folga operacional existente de dois dias, com revalidação e proteção de conversa, proposta, pausa e próximo passo; não se somam dois prazos comerciais de sete dias. Publicador restrito altera somente o fluxo 05 existente. A conferência da Mel mostrou que a antiga pausa de demonstrações e suas unidades não existem na instalação nem na main; a cópia local anterior foi preservada e corrigida, mas não se introduz essa rotina obsoleta em produção. O ajuste instalado usa a limpeza real existente.
- `followup-experimento.ts`, `abertura-prumo.ts`, `ab-mensagem.ts`, `site-mensagem.js` e espelhos do servidor: texto B e abertura D preparados, com estratificação, um fato verificável e confirmação do conteúdo realmente enviado. Envios antigos não trocam de letra; convite legado não recebe variante fictícia. Taxas exigem 30 observações em cada braço. **As variantes novas seguem desligadas**, aguardando revisão explícita do [texto exato](PRUMO-TEXTOS-VENDAS-2026-10-19.md).
- `plus-experimento.ts` e Números: primeiros vinte envios únicos do Plus a partir de 19/10, comparados com Site no mesmo período, mostrando respostas humanas, interesse e propostas. Reenvio não transforma lead antigo em novo; histórico de interesse não desaparece ao chegar à proposta. Objeções de preço usam a oferta real.

Verificação do checkout: **3.033 testes aprovados, zero falhas e dois ignorados**, typecheck e build de teste aprovados. Testes adicionais: 235 de cadência e domínio, 37 do Balcão, quatro de publicação restrita/anotação pós-recibo e 92 Python; seis casos dependem do Linux. Os dois pacotes foram congelados com preimages, postimages e hashes para integração sobre a produção, sem capturar mudanças da fase seguinte.

Instalação desta fase: pendente de verificação do snapshot integrado. Para o Rômulo: revisar os textos novos e executar os contatos manualmente. Nenhuma mensagem foi enviada ao lead por esta implementação. Estrela-guia em 19/10: **não medida** até a Fase 4.
