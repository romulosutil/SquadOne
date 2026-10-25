# Critérios para liberar e interromper automação comercial

Revisão: 25/10/2026. Matriz operacional geral para leitura no painel existente. Não é uma autorização de envio, um novo executor ou uma lista de confirmações de clientes. A prospecção permanece pausada.

## Decisão que esta matriz permite tomar

Primeiro identificar a ação pretendida. Conferir o que ela pode fazer no piloto, quais gates se aplicam e que evidência falta. O resultado possível é continuar a leitura/preparação, revisar com Rômulo, aguardar ou preservar uma restrição. Nenhum campo verde deste documento muda configuração ou cria um fato comercial.

A disponibilidade qualitativa de Rômulo está confirmada. A falta de horas numéricas não barra o piloto. Prazos individuais continuam vinculados a escopo, dependências e compromissos concretos. Pausa de prospecção não é proibição do atendimento manual do Rômulo e não é permissão de resposta automática do agente.

## Fluxo de decisão por ação

| Ação | Gates essenciais | Quem confirma o efeito |
| --- | --- | --- |
| Leitura | Autorização do leitor, fonte atual e privacidade | Código valida fonte; não cria fato |
| Captura/projeção | Identidade, evento, persistência e resultado ambíguo | Recibo prova persistência, não compra |
| Rascunho/material | Contexto, restrições, fonte de condições, referência/qualidade | Rômulo revisa o uso; gerar não envia |
| Primeiro contato | Todos os gates de aquisição, decisão específica de retomada e política viva | Executor somente no alcance autorizado; atualmente pausado |
| Resposta assistida | Identidade/autoria, responsável, pedido, restrições e revisão humana | Rômulo conduz; abrir/copiar não comprova envio |
| Proposta | Qualificação canônica para versão final, condições, versão e envio real | Rômulo aprova e confere envio |
| Negociação | Passagem contextualizada e condições conferidas | Rômulo decide preço/escopo/compromisso |
| Contrato/aceite | Documento/partes/representação, versão enviada e evidência de aceite | Rômulo confere; cliente/representante aceita |
| Cobrança/recebimento | Aceite, condição, gatilho, componente/competência, valor e referência | Rômulo libera cobrança e verifica dinheiro |

## Regras permanentes

- Este arquivo é política de consulta, não um motor de permissão, painel de ativação ou confirmação de fato humano. Estado de saúde/pausa deve ser relido na fonte viva.
- A prospecção permanece pausada. Criar o catálogo, cumprir uma lista de critérios ou confirmar disponibilidade não reativa qualquer executor.
- Captura, leitura, projeção e preparação continuam somente dentro dos contratos já autorizados. Nenhuma mensagem, execução de teste real ou alteração comercial é produzida por este documento.
- Pausa da aquisição não proíbe Rômulo de conduzir atendimento manual pelos caminhos existentes. Ela também não permite ao agente responder automaticamente.
- Há gates que nunca são substituídos por teste técnico: decisão humana, identidade que a fonte não comprova, acordo do cliente, aceite e recebimento.
- Antes de efeito externo, reler contexto e limites; permissão, cache ou rascunho antigo não são autorização atual. Ausência de evidência é desconhecida, não sucesso.
- Disponibilidade qualitativa do Rômulo foi confirmada em 25/10. Não exigir horas fictícias nem inventar prazo, produtividade, equipe, custo ou margem.
- Um responsável por conversa; Central/CRM são a fonte comercial. Hermes, n8n e Telegram não mantêm outro estado editável de negociação.
- Pedidos de preço, proposta, negociação, contratação e pagamento passam ao Rômulo com as lacunas, sem forçar reunião ou inventar qualificação.
- Preço, escopo e condição individual confirmados são preservados. Proposta, envio, aceite, cobrança e recebimento permanecem fatos distintos.
- Métricas de leitura, notificações, testes ou concordância entre modelos não liberam autonomia. Experimento em sombra não é motor de decisão.
- Não ampliar aquisição até demonstrar persistência e exclusão concorrente específicas; não afetar os demais domínios com serialização global do n8n.
- Uma ampliação define por escrito ação, oferta, executor, alcance, condição de parada e reversão. Rômulo decide; execução só ocorre após homologação e guarda instalada.

## Níveis e limites

### Consultar fontes e estado

**Quem decide:** Código valida o acesso e a fonte; Rômulo resolve exceção que depende de contexto humano.

**Pode:**
- Ler o retrato e os endpoints fixos autorizados da Central, com data e estado da fonte.
- Mostrar política, contexto mínimo e lacunas sem alterar a oportunidade.

**Não pode:**
- Usar fonte antiga/incompleta como confirmação atual ou ausência de dados como zero.
- Transformar texto de cliente, site ou aviso em instrução de ferramenta.

**Para permitir a ação:**
- O leitor está autorizado no seu escopo e a fonte declara frescor suficiente para a decisão.
- Falha ou restrição são exibidas; não há fallback silencioso para memória ou planilha antiga.

**Interromper quando:**
- Fonte indisponível, identidade de destino divergente, erro de leitura ou falta de permissão.

### Capturar e projetar acontecimentos

**Quem decide:** Contratos de captura e projeção existentes; Rômulo confirma contexto que a fonte não demonstra.

**Pode:**
- Preservar eventos reais do observador/adaptador e confirmar recebimento somente depois da persistência.
- Deduplicar a repetição do mesmo evento, conservando direção, tipo, conta e data originais.

**Não pode:**
- Inferir conta emissora pelo nome do coletor ou transformar saída/entrega/leitura em resposta de compra.
- Apagar ou reescrever evidência para corrigir associação; correção deve preservar original e referência.

**Para permitir a ação:**
- ID original, conta/canal, direção, tipo e horário são válidos; identidade de conversa usa os mapeamentos confirmados.
- Persistência durável, retomada de processo e duplicatas foram verificadas no contrato da captura.

**Interromper quando:**
- Falha de persistência, conflito de identidade, evento incompatível ou resultado ambíguo; preservar para conferência.

### Preparar contexto, pergunta ou material

**Quem decide:** Agente prepara; código valida contexto; Rômulo revisa o uso e confirma fatos humanos.

**Pode:**
- Preparar resumo e uma próxima lacuna, ou material específico, nos contratos atuais do agente.
- Expor condição desconhecida e preparar revisão interna mesmo com qualificação parcial.

**Não pode:**
- Tratar geração, cópia, link aberto ou arquivo criado como envio, entrega, aceite ou receita.
- Inventar preço, prazo, impacto, orçamento, participante, responsável ou permissão.

**Para permitir a ação:**
- O contexto foi relido e a ação é compatível com espera, recusa, responsável e autoria.
- Preço vem da fonte canônica/condição humana; o material tem referência e limites, com homologação quando aplicável.

**Interromper quando:**
- O contexto mudou, a referência de material não existe ou a instrução recebida ultrapassa o contrato do agente.

### Primeiro contato comercial

**Quem decide:** Rômulo decide a retomada específica; código aplica os gates. Este documento mantém a prospecção pausada.

**Pode:**
- No estado atual, somente seleção e preparação internas que não enviem mensagem nem reativem aquisição.
- O executor já existente só poderá iniciar contato após decisão específica de retomada e validação dos gates aplicáveis.

**Não pode:**
- Usar este painel, tempo disponível ou workflow ativo como autorização de envio.
- Recontatar recusa/exclusão/conversa anterior, ultrapassar limites ou repetir envio ambíguo.

**Para permitir a ação:**
- Rômulo autoriza explicitamente a retomada da oferta/ação; pausa e identidade são relidas no ponto de execução.
- Critérios, material e texto estão aprovados; público/contato são elegíveis e nenhum executor concorre pela conversa.
- Exclusão concorrente da aquisição, persistência e recibos estão comprovados; horário, teto e intervalo existentes passam no código.

**Interromper quando:**
- Pausa/restrição, resposta humana, compromisso vigente, dono humano, fonte falha, erro de envio ou recibo ambíguo.

### Responder uma conversa com revisão

**Quem decide:** Rômulo conduz no piloto; agentes e modelos não recebem nova autonomia por esta matriz.

**Pode:**
- Preparar resposta ao pedido real, uma pergunta de qualificação ou material devido para revisão humana.
- Rômulo pode conduzir atendimento manual pelos caminhos existentes quando decidir fazê-lo; pausa de prospecção não cria autorização do agente.

**Não pode:**
- Liberar resposta automática porque houve permissão, curiosidade ou preenchimento de uma qualificação.
- Disputar conversa assumida, responder áudio desconhecido ou repetir apresentação/material já entregue.

**Para permitir a ação:**
- Há entrada legítima com autoria/contexto compreendidos; identidade e responsável estão conferidos.
- Rômulo revisa e autoriza a ação no fluxo já previsto; o servidor relê contexto e bloqueios antes de abrir o caminho de uso.
- Qualquer futura resposta automática restrita exige lote próprio e decisão explícita após piloto natural; não está liberada aqui.

**Interromper quando:**
- Recusa, espera, responsável conflitante, identidade pendente, contexto alterado ou resultado ambíguo.

### Preparar e confirmar a proposta

**Quem decide:** Rômulo aprova a proposta final e confirma seu envio; agentes preparam e o código preserva versão e vínculos.

**Pode:**
- Preparar versão identificada, inclusive parcial, mostrando lacunas e fonte das condições.
- Preservar proposta histórica real sem reescrever preço, escopo ou situação como se fosse proposta nova.

**Não pode:**
- Apresentar rascunho incompleto como versão final enviada ou usar catálogo para substituir condição individual confirmada.
- Dar por enviado porque o operador abriu WhatsApp, copiou texto ou gerou PDF.

**Para permitir a ação:**
- Para a versão final, o gate canônico de qualificação é suficiente e coerente com oferta, escopo, preço, prazo/dependências e responsável.
- Rômulo aprova a versão exata; envio efetivo é observado/conferido conforme o registro previsto na ficha.

**Interromper quando:**
- Falta de condição essencial, proposta incompatível, nova versão não revisada ou incerteza de envio/projeção.

### Negociar e fechar condições

**Quem decide:** Negociação e fechamento permanecem humanos com Rômulo; nenhum gate verde transfere esse poder ao modelo.

**Pode:**
- Preparar alternativas, fatos, lacunas e efeito de mudança para decisão de Rômulo.
- Encaminhar pedido de preço, desconto, proposta, contratação ou pagamento com qualificação incompleta explicitada.

**Não pode:**
- Conceder desconto, alterar preço/escopo/prazo ou assumir compromisso comercial pelo Rômulo.
- Atrasar passagem comercial para forçar reunião, orçamento ou um único decisor.

**Para permitir a ação:**
- Rômulo confere a condição e os participantes e decide o compromisso concreto.
- Alteração acordada recebe referência/versão coerente sem apagar as condições anteriores.

**Interromper quando:**
- Conflito de condições, falta de autorização para decidir ou ausência de evidência de acordo.

### Documentar contratação e aceite

**Quem decide:** Rômulo revisa a contratação e confirma a evidência; o cliente ou representante competente aceita.

**Pode:**
- Preparar quadro comercial e documento identificado para revisão, mantendo partes e condições pendentes visíveis.
- Registrar a referência da versão e o aceite real pelo caminho humano existente quando comprovados.

**Não pode:**
- Assinar ou aceitar pelo cliente, declarar documento validado juridicamente por geração ou presumir aceite por silêncio.
- Substituir documento já aceito só porque existe rascunho de versão mais nova.

**Para permitir a ação:**
- Partes/representação, proposta enviada, versão, escopo, condição e documento para uso foram conferidos por Rômulo.
- Há evidência de aceite da versão exata por quem pode decidir; correção preserva original e dependentes.

**Interromper quando:**
- Documento/parte/versão divergente, aceite não comprovado ou condição comercial ainda em aberto.

### Liberar cobrança e confirmar recebimento

**Quem decide:** Rômulo autoriza cobrança e verifica recebimento; código valida vínculos/deduplicação, sem integração bancária nova.

**Pode:**
- Preparar conferência de condição, gatilho, componente, valor, vencimento e competência nos controles existentes.
- Registrar somente recebimento realmente verificado por Rômulo, com referência única e cobrança vinculada.

**Não pode:**
- Enviar cobrança por esta matriz, mover dinheiro, presumir entrada universal ou chamar aceite/cobrança de receita.
- Duplicar/corrigir pagamento apagando o original ou lançar valores bancários em prompts, Git e avisos.

**Para permitir a ação:**
- Aceite e condição estão vinculados; gatilho contratado foi comprovado. Site Encontrado, inclusive em pacote, exige site visto funcionando antes de cobrar.
- Rômulo confere a cobrança e depois o dinheiro recebido; parcial conserva saldo e mensalidade exige competência.

**Interromper quando:**
- Gatilho não cumprido, saldo/vínculo conflitante, comprovante não conferido, resultado incerto ou duplicata.

## Gates: verificação, prova e consequência

O estado abaixo descreve a exigência/política conhecida, não um check automático de saúde. A prova deve ser vinculada à ação, à versão e à fonte atual. Testes valem para a versão testada; autorização humana tem escopo.

### Autorização específica e pausa

- Critério: Identificar a ação e oferta autorizadas; reler pausa e política no executor imediatamente antes do efeito externo. Uma autorização antiga não desfaz uma pausa atual.
- Evidência: Decisão explícita do Rômulo e estado vigente da frente/workflow/rota. Este JSON não registra essa decisão nem ativa nada.
- Responsável: Rômulo decide; executor aplica a guarda.
- Estado da política: `prospeccao-pausada`.
- Consequência: Continuar captura/leitura/preparação autorizadas; impedir novos envios e reativações nesta entrega.

### Fonte atual e íntegra

- Critério: A leitura está ok, completa e dentro do limite de frescor definido pelo consumidor; erros/colunas ausentes não são tolerados como listas vazias.
- Evidência: Data original do retrato, estado das fontes e validação existente da API; nova leitura quando o contexto mudar.
- Responsável: Central e leitores; operador confere indisponibilidade.
- Estado da política: `exigir-a-cada-decisao`.
- Consequência: Sem prova atual, mostrar desconhecido e trabalhar na conferência interna, sem enviar ou confirmar fatos.

### Conta, conversa e autoria

- Critério: Conta emissora e conversa são sustentadas pela fonte; mapeamento confirmado precede cache. Robô, recepção e áudio sem conteúdo não são comprador qualificado.
- Evidência: Evento original, mapeamento/identidade de captura e conteúdo mínimo contextualizado na ficha; coletor e data de importação não bastam.
- Responsável: Adaptadores/observadores e validação da Central; Rômulo resolve contexto sem prova.
- Estado da política: `exigir-a-cada-conversa`.
- Consequência: Conflito bloqueia contato e fica como revisão interna; não confirmar identidade em massa.

### Restrição, espera e responsabilidade

- Critério: Recusa/exclusão/desfecho, pausa, compromisso vigente, saída posterior e responsável atual passam antes da ação. Um executor por conversa.
- Evidência: Estado atual e notas humanas válidas da ficha, última entrada/saída e próximo combinado.
- Responsável: Prioridade e guardas canônicas; Rômulo confirma sucessão de responsável.
- Estado da política: `exigir-a-cada-acao`.
- Consequência: Aguardar ou preservar encerramento; vencimento de revisão interna não autoriza retomada.

### Pedido real e efeito já produzido

- Critério: A ação corresponde ao pedido original e ainda falta seu efeito; backfill não ganha urgência por ter chegado agora.
- Evidência: ID/tipo/direção/data original, material devido e saídas observadas; abertura/cópia não são envio.
- Responsável: Central/observador e conferência do operador.
- Estado da política: `exigir-a-cada-acao`.
- Consequência: Não repetir material, pergunta, proposta ou cobrança só para encerrar uma tarefa.

### Qualificação e passagem comercial

- Critério: Aplicar o gate canônico antes da proposta final; nova revisão inválida exige conferência, sem retorno silencioso ao legado. Pedido comercial passa a Rômulo mesmo com lacunas.
- Evidência: Necessidade, adequação, intenção, participantes, próximo passo aceito e fonte/trecho reais confirmados na ficha.
- Responsável: Rômulo confirma fatos; código aplica a revisão vigente.
- Estado da política: `humano-com-validacao`.
- Consequência: Permitir preparação parcial e passagem; impedir proposta final sem os requisitos correspondentes.

### Oferta, condições e versão

- Critério: Usar a fonte canônica da oferta, preservando condição individual confirmada; preço/prazo desconhecidos ficam pendentes.
- Evidência: Catálogo e versão, escopo individual e revisão humana; tabela de Íris separada e Estamparia sem preço presumido.
- Responsável: Prumo define; Rômulo aprova o compromisso.
- Estado da política: `exigir-por-versao`.
- Consequência: Não aplicar defaults, desconto, mensalidade zero ou prazo genérico para fazer um formulário passar.

### Material e liberação de qualidade

- Critério: A referência exata está disponível e satisfaz o gate aplicável. Prévia identificada; gerador não aprova a própria entrega.
- Evidência: Artefato/manifesto e revisão de qualidade da versão. Para Site/Raio-X, trava de qualidade existente; HTTP 200 não prova visualização do cliente.
- Responsável: Executor prepara; Prumo/Rômulo confere a entrega.
- Estado da política: `exigir-por-entrega`.
- Consequência: Material indisponível ou não conferido não é prometido como entregue nem usado para liberar cobrança.

### Compromisso executável

- Critério: Disponibilidade qualitativa do Rômulo está confirmada. Conferir responsável, escopo, pré-requisitos e conflito concreto antes de assumir cada prazo.
- Evidência: Confirmação de 25/10/2026 e compromissos/ficha/agenda existentes; estimativa do executor quando necessária.
- Responsável: Rômulo e responsável confirmado pela entrega.
- Estado da política: `disponibilidade-confirmada`.
- Consequência: Não exigir horas numéricas para operar o piloto; resolver dependência ou conflito real antes da promessa.

### Persistência e concorrência da aquisição

- Critério: Demonstrar que execuções concorrentes das ofertas não criam dois efeitos sobre a mesma identidade; falha de leitura interrompe gravação e repetição ambígua não é automática.
- Evidência: Teste isolado de concorrência/falha/reinício e prova do mecanismo instalado de exclusão/reserva e reconciliação. Upsert Sheets isolado não certifica unicidade atômica.
- Responsável: Engenharia de automação confere; Rômulo decide expansão somente depois da prova.
- Estado da política: `prova-obrigatoria-antes-de-expandir`.
- Consequência: Não ampliar aquisição sem a garantia específica; não impor limite global do n8n aos outros domínios.

### Recibo, projeção e resultado incerto

- Critério: Persistência é confirmada antes do ACK; ACK e retrato projetado são estados diferentes. Falha incerta bloqueia nova tentativa até conferir a fonte.
- Evidência: Recibo/journal existente, identidade/hash da operação, execução e reencontro do fato na aba CRM.
- Responsável: Contratos de persistência e operador na reconciliação.
- Estado da política: `exigir-a-cada-gravacao`.
- Consequência: Preservar ID e histórico; não inventar outro ID, apagar journal ou repetir mensagem/pagamento.

### Horário, teto e condição de parada

- Critério: Aplicar horário, ritmo e cadência já aprovados e as interrupções por resposta/espera/dono. O teto não é meta nem autorização.
- Evidência: Trava compartilhada vigente: até 30 primeiros contatos/dia de São Paulo, 12/h móvel e intervalo mínimo de 5 minutos; contadores do executor e fonte atual.
- Responsável: Código aplica limites; Rômulo aprova alteração separadamente.
- Estado da política: `preservar-limites-e-pausas`.
- Consequência: Não retomar enquanto pausado; não reiniciar sequência por nova nota ou passagem, nem expandir por silêncio.

### Passagem que permite agir

- Critério: O encaminhamento identifica oportunidade, pedido, fonte/data original, o que já ocorreu, lacunas, decisão solicitada e responsável esperado.
- Evidência: Pendência na fila/ficha e vínculo do aviso existente; confirmação de recebimento/abertura quando o piloto natural permitir.
- Responsável: Central/transportes encaminham; Rômulo assume e decide.
- Estado da política: `exigir-contexto-e-vinculo`.
- Consequência: Aviso recebido não conclui atendimento; sem prova de identidade, deixar revisão interna e nenhuma urgência por backfill.

### Teste técnico e uso natural

- Critério: Antes de mudar o alcance, testar falha, duplicata, concorrência, reinício, bloqueios e preservação; depois observar o piloto natural nos casos elegíveis previstos no plano.
- Evidência: Resultados isolados sem dados reais de cliente, versão instalada e evidência do piloto assistido. Simulação não conta como venda ou aceite.
- Responsável: Engenharia/RevOps homologam; Rômulo confirma uso real e decide o próximo alcance.
- Estado da política: `exigir-por-mudanca-de-alcance`.
- Consequência: Teste verde não ativa automação. Não fabricar contato, reunião, envio, contrato ou pagamento para validar o fluxo.

### Falha visível e reversão preparada

- Critério: Distinguir executando, aguardando, falha e concluído por evidência; preservar backups e plano que reverta só o lote afetado.
- Evidência: Estado publicado, log sanitizado, manifesto/backup e teste de restauração aplicável; tarefa sem fonte não vira sucesso.
- Responsável: Executor publica estado; RevOps acompanha; operador decide exceção.
- Estado da política: `exigir-antes-de-publicar`.
- Consequência: Parar a ação afetada e conservar captura/fila/histórico; não religar caçadores ou outros emissores como rollback.

### Decisões e marcos humanos separados

- Critério: Negociação, versão final, aceite, condição de cobrança e recebimento exigem suas confirmações; entrega técnica não os substitui.
- Evidência: Proposta/versão, documento/aceite, gatilho de cobrança e referência de recebimento conferidos por Rômulo nas rotas existentes.
- Responsável: Rômulo; código valida vínculos e correções.
- Estado da política: `permanentemente-humano-no-piloto`.
- Consequência: Nenhum nível técnico transfere desconto, assinatura, aprovação ou confirmação de dinheiro ao modelo.

### Dados mínimos e canais corretos

- Critério: Enviar aos modelos apenas o recorte permitido/mascarado; preço e regras vêm do código. Não copiar segredos, conversas completas, dados bancários ou recebimentos para o catálogo/manual.
- Evidência: Contrato de cada leitor/modelo/transporte e logs sanitizados; alertas operacionais seguem o canal previsto.
- Responsável: Aplicação e integrações; Rômulo decide contexto fora do contrato.
- Estado da política: `exigir-em-todos-os-niveis`.
- Consequência: Não ampliar escopos, coletar conversas pessoais adicionais ou usar WhatsApp como fallback de falha operacional.

## Como registrar uma ampliação sem a ativar por engano

Rômulo decide uma mudança específica de ação/oferta/executor/alcance. O responsável técnico prepara a versão, prova os gates aplicáveis e guarda backup. A revisão compara a versão instalada e o estado ativo antes/depois, mantendo as outras pausas e domínios. Somente a decisão específica e a instalação da guarda permitem o alcance aprovado; nenhum manual, indicador ou resultado de teste substitui esse passo.

Resposta automática, negociação, assinatura e movimentação/confirmação de dinheiro não são liberadas nesta entrega. Primeiro contato também continua pausado. O envelope histórico de até 30/dia, 12/h móvel e cinco minutos é limite de segurança aplicado pelo código quando houver autorização vigente; não é meta ou justificativa para enviar agora.

Não inventar uma taxa de conversão ou percentual de acerto para liberar a operação. O piloto natural previsto no plano é distinto dos testes: usar conversas elegíveis reais, preservando espera/recusa e registrando ação concorrente, entrega de material, passagem e resultado humano. Não contatar clientes só para gerar uma amostra.

## Parada e reversão

1. Ao detectar violação, conter somente a ação/alcance afetado pelas guardas existentes. Não interromper captura e preservação de evidências por conveniência.
2. Conservar IDs, hashes, recibos, contexto original e dados novos. Resultado incerto não autoriza reenvio, limpeza de journal ou outra identidade de operação.
3. Usar backup/manifesto do lote para restaurar código/configuração de forma seletiva; conferir o que mudou depois do backup antes de restaurar dados.
4. Preservar todos os estados pausados. Rollback não reativa Caçadores, VENDAS/Grok, acompanhamento ou outro emissor.
5. Manter atendimento humano e leitura disponíveis dentro do contrato; comunicar a pendência pela fila e canal operacional existente, sem fallback pelo WhatsApp.
6. Após corrigir, repetir a homologação isolada aplicável, conferir instalação e fonte viva e registrar o limite do que foi provado. Teste não substitui novo aceite de retomada quando necessário.

## Fontes e fronteiras

- `RULES.md`: autorização do piloto, pausas, limites, confirmação humana, privacidade e preservação do escritório.
- `docs/revops/regras-de-passagem.md`, `rotina-diaria.md` e `capacidade-de-entrega.md`: processo geral e disponibilidade qualitativa confirmada.
- `docs/PRUMO-PLANO-REORGANIZACAO-2026-10-23.md`: piloto, responsabilidades, critérios de aceite e reversão.
- `docs/PRUMO-QUALIFICACAO-CONTRATACAO-PAGAMENTO.md`: marcos e condições separados.
- `src/operations/qualificacao-comercial.ts`, `spiced.ts`, `ciclo-comercial.ts`, `prioridade-comercial.ts` e `responsavel-conversa.ts`: gates canônicos existentes; esta matriz não os duplica como motor.
- `server/entrada-atendimento-comercial.ts`, `atendimento-comercial.ts` e `registro-comercial-duravel.ts`: entrada/registro, persistência e não repetição de resultados incertos.
- `deploy/dell/claude-ops/workflow_operacao.py`, `n8n.py`, `workflow_confiabilidade.py` e `prospeccao_contrato.py`: guardas dos publicadores, proteção de fontes e limites da persistência de aquisição. A guarda do publicador não é ACL universal da API administrativa.

O JSON `src/operations/modelo-operacional/automacao.json` contém a mesma política para consulta. Não grava clientes, credenciais, decisões humanas ou estados vivos. Nenhum workflow, serviço, CRM ou mensagem foi alterado por esta definição.
