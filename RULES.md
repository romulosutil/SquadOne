# Regras do repositório

O [Estado atual](ESTADO-ATUAL.md) registra o que foi observado no Dell e o plano
operacional. Atualize a regra datada e o retrato do Dell quando a autorização,
a agenda ou o responsável por um fluxo mudar.

## Primeiros contatos diários no Dell — 18/11/2026

Rômulo autorizou até dez primeiros contatos automáticos por dia em cada canal,
inclusive fins de semana, e pediu iniciar imediatamente. O n8n agenda o
WhatsApp a cada dois minutos e o LinkedIn a cada dez. O Dell executa o envio
somente para contatos comerciais elegíveis e registra a confirmação de cada
canal. As cotas usam o dia de São Paulo e são independentes.

Reservas anteriores ficam preservadas. O WhatsApp deixa de contá-las como
estoque disponível e repõe os cadastros barrados. No LinkedIn, continuam valendo
o navegador dedicado, a confirmação do perfil, o limite de uma abordagem por
rodada e o destino Outros para as conversas comerciais. Rômulo assume as
respostas em ambos os canais.

## Retiradas confirmadas no Dell — 18/11/2026

A Fonte com IA continua pausada e seu aviso privado está arquivado. O
instalador de Medição preserva o alerta geral configurado e publica somente
a Medição. Em eventual retomada autorizada da Fonte, restaurar primeiro o
aviso sanitizado. O coletor mensal de fotos de skills do Hermes foi retirado.
O contador nativo e as fotos históricas continuam disponíveis. A
[conferência da implantação](ESTADO-ATUAL.md#implantação-da-retirada) registra
o commit e os serviços observados.

## LinkedIn no Dell — 17/11/2026

> A decisão de 18/11 substituiu o teto de cinco contatos e a agenda inicial.
> O contrato de execução e passagem humana desta seção continua aplicável.

Rômulo autorizou o navegador, ciente do risco, com até cinco contatos novos por
dia de São Paulo, somente primeira mensagem, comerciais em Outros e nenhuma
alteração nas conversas de vagas. Depois pediu migrar a execução para o agente
do SquadOne no Dell e n8n, sem PC ou chat. A automação anterior do Codex foi
excluída. O novo workflow agenda pedidos locais; `linkedin-agente` os consome
e executa Diego no runtime Hermes com navegador exclusivo do Dell (9223).

O ledger existente é preservado. Reservar antes do clique, autorização de uso
único, nunca repetir resultado incerto, excluir qualquer conversa anterior ou
de vagas e organizar somente threads comerciais exatas registradas. Respostas
ficam com Rômulo. Login inicial é feito por ele na janela aberta no Dell, sem
copiar cookies do PC; login ausente não dispara modelo nem consome cota.
Os caminhos de execução e a conferência estão no
[guia do LinkedIn no Dell](ops/n8n/README.md#linkedin-no-dell).

## Retomada autorizada e conferida — 17/11/2026

> Registro da retomada. Em 18/11, a agenda do n8n assumiu os disparos dos
> timers antigos de frente e reposição do WhatsApp.

Rômulo pediu neste chat reconectar Hermes e Evolution, liberar os fluxos,
encontrar novos leads e iniciar os envios conforme a operação mínima vigente.
Os dois canais foram pareados; a identidade anterior do Hermes foi preservada.
Naquela data, pesquisa, campanha e timers de primeiro contato estavam ativos. A integração e
as conversas capturadas confirmaram os primeiros envios; Rômulo assume respostas.
Não há autorização para recontatar a carteira antiga nem reativar aposentados.

A política operacional em `~/.local/bin/aquisicao-comercial.json` está em
`primeiro-contato`, com `respostasAutomaticas: false`. O drop-in
`operacao-runtime.conf` inicia a Central a partir de um espelho de caminhos,
preparado por `preparar-central-runtime`; somente essa política vem da cópia
operacional. A política de produção fica fora dos arquivos rastreados e o
padrão versionado continua pausado. O atualizador foi conferido após essa separação. Uma reinstalação da
política padrão pausa a aquisição e não autoriza reativação implícita.

Correções publicadas: ciclo sem referências à avaliação por modelos removida,
versão única de seleção, cadeia completa do webhook `/enviar` até sua resposta e
redirecionamento compatível com o sandbox do n8n. Oito testes de regressão
passaram na Mel. Backups e reversão: `~/.local/state/retomada-20261117/`.

## Histórico da pausa — simplificação de 16/11/2026

> A retomada de 17/11 substituiu esta pausa no Dell. O padrão de instalação
> versionado conserva o estado `preparado-pausado`.

Rômulo autorizou aplicar a simplificação no Dell e a abertura padrão do Prumo,
sem retomar disparos. A política v2 fica em `preparado-pausado`: reserva e transporte
continuam bloqueados mesmo se uma flag ou timer antigo for ligado. A retomada
depende de instrução posterior. Não reconectar WhatsApp nem drenar carteira antiga.

Pesquisa, CRM, entrada WhatsApp e falhas formam o núcleo. Captura e recibos
permanecem; Rômulo assume qualquer retorno. Site, Raio-X e Mapa só por pedido
humano. A abertura canônica está em `config/mensagem-inicial.json`; o corte de
pesquisa nova preserva a carteira e as mensagens históricas. Os workflows
aposentados ficam arquivados, com fontes privadas e backup para reversão.
Geradores antigos não podem substituir o núcleo nem reativar os aposentados.

## Modelo de primeiro contato — 16/11/2026

Rômulo pediu: o agente envia a primeira mensagem atual e ele assume quando o
cliente responder. Retirar o que não serve a esse fluxo. Esta decisão substitui
o bloqueio absoluto da reconstrução anterior e os atendimentos automáticos de
Site/Encontrado e Estamparia. Não exige descoberta, consenso de três modelos,
Raio-X, Mapa, demonstração ou proposta automática para iniciar o contato.

A abertura mantém texto e destinatário da fonte atual, somente para cadastro
novo sem contato anterior. A política v2 em `config/aquisicao-comercial.json`
permite apenas primeiro contato, com `respostasAutomaticas: false`. Recusas,
exclusões, identidade, reserva atômica, resultado incerto, pausa manual e
restrições reais do provedor continuam obrigatórios. Não trocar conta ou
reconectar para contornar restrição; não reenviar um resultado incerto.

A tela de Vendas tem respostas para Rômulo, primeiros contatos e carteira.
Qualificação, negociação, material e proposta passam a ser trabalho humano.
Os executores de resposta automática e seus scripts de reativação foram
retirados. Histórico comercial, documentos, contratos e dados existentes são
preservados. Análises antigas continuam consultáveis por seus endereços.

Código local e testes não comprovam publicação ou envio. A implantação no Dell
precisa conferir serviço, campanha, timer, conta e recibo; a política não liga
sozinha um executor que foi desativado. Não drenar automaticamente fila antiga.

## Histórico de decisões comerciais

As cotas, pausas de aquisição e autorizações de envio abaixo registram seus
respectivos períodos. A retomada de 17/11 e a decisão de 18/11 substituem
as instruções conflitantes. As regras de identidade, captura e proteção da
carteira continuam aplicáveis em seus escopos.

### Reconstrução comercial e bloqueio inicial (16/11/2026)

Rômulo confirmou softban do WhatsApp por spam após os disparos de 13/11 e
autorizou reconstruir a operação da Prumo e o CRM que a atende. Esta direção
substitui as regras anteriores que liberavam primeiros contatos sem limites ou
tratavam diagnóstico e demonstração como passagem obrigatória de toda venda.
O histórico abaixo permanece como registro das decisões anteriores.

Primeiros contatos automáticos ficam bloqueados independentemente de conexão,
horário, quotas ou configuração ativa. Não drenar a fila antiga ao reconectar,
não usar número público como permissão e não trocar conta para contornar a
restrição. A eventual retomada requer um fluxo próprio de elegibilidade por
destinatário e regras do provedor; alterar uma flag não basta. Conversas e
compromissos existentes permanecem preservados, com suas autorizações próprias.

A aquisição começa pela necessidade concreta. Site e implantação de um fluxo
comercial são hipóteses iniciais; outros produtos têm avaliação dirigida de
prontidão, comprador e economia. Raio-X e Mapa são instrumentos opcionais.
Preços, contratos e critérios de qualidade permanecem nas fontes da Prumo.

A Carteira separa cadastro, conta, conversa, oportunidade, proposta, contratação
e recebimento. Telefone compartilhado não prova identidade de empresa. Silêncio
ou expiração legada exige revisão e não comprova recusa; resposta, material e
ganho marcado não comprovam pagamento. Uma próxima ação com responsável e
evidência deve orientar o trabalho, sem consenso obrigatório de três LLMs.

Plano, critérios de validação e responsabilidades:
`docs/PRUMO-RECONSTRUCAO-COMERCIAL-2026-11-16.md`. Pesquisa e contrapontos:
`docs/PRUMO-PESQUISA-CRM-2026-11-16.md`. Documentação ou código local não
comprovam publicação nem cobertura de emissores externos.

## Envios e renovação dos leads (13/11/2026)

Rômulo pediu retirar as travas de envio e confirmou remover também aprovações dos
três agentes e filtros comerciais. Cotas diária/horária, intervalo obrigatório,
expediente/feriados, limite de dez pendências e metas/datas de campanha deixam de
interromper os primeiros contatos. A política compartilhada está em
`config/politica-envios.json`; substitui as restrições operacionais anteriores.

A direção é buscar empresas novas, com dados públicos atuais, em outros serviços
e cidades. O manifesto registra `pesquisaNovaDesde` para retirar a carteira antiga
da fila atual sem apagá-la ou reenviá-la. Notas antigas e modelo de curadoria não
são condições de envio e nenhuma nota substituta é fabricada. A pesquisa continua
gratuita, com orçamento de leitura separado dos envios.

Preservar recusas/exclusões, validade do destinatário e da mensagem, histórico,
reservas atômicas, ausência de reenvio de resultado incerto e parada manual. A
retirada de cotas internas não contorna desconexão ou restrição real do provedor.

## Reposição conforme o consumo (12/11/2026, correção)

A cadência de dez minutos exige reposição contínua. O timer verifica a fila a
cada dois minutos após cada rodada de pesquisa, dentro do calendário comercial.
O estoque alvo é de seis contatos aprovados ou cadastros próprios ainda nos três
pareceres; reprovados, contatos anteriores, recusas, exclusões e destinos sem
WhatsApp não contam como estoque. A meta permanece em vinte envios por dia.

A pesquisa continua gratuita e limitada a 480 leituras públicas por dia, sem
zerar o uso acumulado nem ampliar o teto de mensagens ou de avaliações do modelo.
Novos cadastros solicitam o retrato pelo webhook autenticado de leitura existente
e aguardam sua presença no CRM. Falha conserva uma pendência privada para nova
tentativa. Uma fila consumida aparece em reposição; somente a meta cumprida ou
uma campanha finita concluída representa encerramento do lote.

A leitura reconhece tanto `data-item-id=oh` quanto o componente atual
`pane.openhours` do Google Maps. Categoria pública conferida segue com origem e
data para os pareceres, sem confirmar atividade atual, necessidade ou decisor.
Horários isolados não dispensam nome, Place ID, endereço e telefone inequívoco.


Rômulo pediu mudar o espaço entre disparos para dez minutos e acompanhar o próximo
envio, corrigindo bloqueios sem nova cobrança. O ritmo compartilhado passa a dez
minutos e seis primeiros contatos por hora móvel, mantendo vinte por dia, expediente,
feriados, pausas, dez pendências por rodada e as três aprovações. Substitui os 30
minutos e dois/hora da autorização anterior. Não é uma exceção que expira hoje.

## Cadência de dez minutos (12/11/2026, atualização)

Rômulo pediu mudar o espaço entre disparos para dez minutos e acompanhar o próximo
envio, corrigindo bloqueios sem nova cobrança. O ritmo compartilhado passa a dez
minutos e seis primeiros contatos por hora móvel, mantendo vinte por dia, expediente,
feriados, pausas, dez pendências por rodada e as três aprovações. Substitui os 30
minutos e dois/hora da autorização anterior. Não é uma exceção que expira hoje.

## Prospecção contínua autorizada (12/11/2026)

Rômulo solicitou corrigir a interrupção dos disparos, criar regressões e manter
campanhas nos dias úteis com aprovação dos três agentes, buscando leads diariamente
até fechar. O manifesto opt-in `continuo-dias-uteis`, restrito a novos contatos de
Site, substitui o lote datado de 10/11. Mantém 20/dia, 2/h, 30 minutos, expediente,
feriados, dez pendências por rodada e três notas mínimas de 65. Não amplia retomadas
nem apaga restrições, recusas ou histórico. A fonte deve ser atual e verificável;
nenhuma cota autoriza inventar qualificação, demo ou envio.

`prospeccao-diaria` repõe candidatos por perfis públicos sem API paga. Cadastro
exige Place ID, nome, telefone, endereço e horários, sem site próprio observado ou
com canal social no campo Site. A ausência de link continua sendo hipótese. Dedupe
consulta todas as ofertas e estados, preservando recusas e exclusões. A inclusão
na planilha não aprova nem envia: o executor mantém sua avaliação, reserva e gates.

Pausas de proteção e fim de campanhas têm motivo explícito e aviso durável. A
retomada desta correção usa a rota normal, com conta conectada e CRM atual; as quatro
pendências anteriores continuam na rodada. A pesquisa lê o manifesto vigente,
sem o corte obsoleto de 6/11. Falha de pesquisa/aviso permanece observável e pode ser
tentada novamente; falha ambígua de envio nunca é repetida.



## Conciliação dirigida de captura (03/11/2026)

Rômulo autorizou corrigir as divergências de AV. Serviços e Atual Serviços e retomar a campanha com os mesmos limites. Conciliações de relógio usam registro privado separado, vinculado ao conjunto exato de provas revisadas, mesmo ID, conteúdo, direção e conta. Os JSONL originais não são alterados; o limite de dois segundos só vale para o registro nominal autorizado. Prova nova ou divergência de conteúdo/conta continua bloqueando. A conciliação invalida o contexto derivado e não envia, libera rodada ou inventa resposta humana.


## Curadoria diária e autonomia dos agentes (26/10/2026)

Rômulo pediu revisar todos os contatos do dia, ajustar a fila e criar um agente
que aprenda diariamente quais leads merecem abordagem. Marina foi contratada
em Prospecção para essa curadoria transversal. Neste chat, Rômulo também
autorizou alinhar Diego, Elisa e Prospecção e criar, ajustar ou arquivar agentes
conforme a utilidade dos papéis. Usar o ciclo de vida existente e preservar o
histórico; essa autonomia de equipe não altera preços, limites ou autorizações
de mensagens.

O serviço `curadoria-leads` revisa a fonte às 07h20 e 18h40 de São Paulo.
`filtro_leads.py` adia casos sem aderência, com recusa/exclusão, destino
confirmadamente sem WhatsApp ou mensagem afirmando demo pronta sem evidência.
Não exige produzir demo antes da descoberta: oferta sob demanda continua válida.
Dados incompletos adiam a fila automática, sem apagar o lead ou mudar seu funil.

O aprendizado deriva do CRM e dos recibos existentes, com memória privada de
atributos públicos e histórico diário. Robô, silêncio, acesso e permissão não
rotulam fracasso. Qualificação confirmada, proposta, pagamento e recusa são
resultados distintos; agradecimento não apaga restrição ou encaminhamento.
Comparar a mesma oferta, deduplicar destinos, excluir atribuição ambígua entre
ofertas, observar 48h e janela de 90 dias. Ajuste de prioridade até 5 só com dez
casos rotulados no grupo e na comparação e intervalos de 95% separados; nunca
veta um setor nem substitui as três notas mínimas de 65. Dados insuficientes
mantêm ajuste zero. Isso não estima probabilidade de venda ou causalidade.

Modelo ausente, inválido ou com mais de 30h interrompe novos contatos. Mudança
efetiva da régua invalida avaliações; recibos ficam preservados. A consulta
`ler_filtro_leads` expõe somente agregados ao agente; conversas, telefones e
valores não entram nessa memória de inferência. O executor tolera até 90s para
ler o CRM completo, conservando a verificação de atualidade e as revalidações
anteriores ao envio. A curadoria não tem ferramenta de envio.

Parecer de seleção fora do contrato adia seu lote, preservando os já aprovados.
Não se trunca nem completa uma resposta do modelo para presumir aprovação; o
orçamento de inferência permanece compartilhado e a pendência exige nova leitura.

Relatório e validação em `docs/PRUMO-CURADORIA-LEADS-2026-10-26.md`.

## Atendimento automático de Estamparia (26/10/2026)

Rômulo autorizou os agentes a continuar as conversas de Estamparia quando o cliente
responder, com responsável e próximo passo visíveis no escritório. A capacidade usa
o inbox, a identidade verificada, a conta profissional e a trava por conversa já
existentes. A ativação tem data explícita. Rômulo também autorizou neste chat
incluir as respostas anteriores, inclusive Stamp Fast. Essa retomada usa uma
lista persistida de entradas originais, sem retroagir a ativação. Só responde
onde a última entrada humana ainda está pendente e a identidade está conferida;
saída posterior aguarda novo retorno e histórico sem prova pede conferência.
Não reativa caçadores, não faz retomadas por silêncio nem muda primeiros contatos.

Carla pode explicar a oferta e perguntar sobre rotina, gargalo, equipe e decisão,
com textos versionados da fonte Prumo. As observações não são confirmação humana
de SPICED. Preço, fiscal, integração específica, demonstração, contratação e agenda
pedem encaminhamento ao Rômulo; não há preço aprovado de Estamparia nem envio de
Raio-X/Mapa como se pertencessem a essa oferta. Pausa, recusa, desfecho, compromisso,
responsabilidade humana e resultado de envio incerto continuam protegidos.

## Prioridade comercial por oferta (26/10/2026)

Rômulo aprovou ajustar a prospecção para vender melhor: Site/Encontrado é a
frente principal entre candidatos aprovados; CRM de estamparia é venda dirigida,
com necessidade, impacto e decisor confirmados no SPICED do CRM. Sinais públicos,
categoria e sugestões do modelo não substituem essa confirmação. O ajuste não
interrompe conversas existentes nem autoriza primeiros contatos a quem já foi
contatado. Falta de confirmação adia a prospecção automática; não descarta o lead.

Cada Site exige achado estruturado do Raio-X referente a site/perfil; ausência
de link não comprova ausência de site. A seleção mantém as três aprovações com
mínimo 65 e diversidade de setores dentro da oferta. Sites aprovados vêm antes
das demais ofertas, sem cota de envios e sem relaxar os critérios para preencher
fila. A alternância automática de ofertas e o bônus por taxa de resposta da
regra de 23/10 ficam substituídos por esta direção. Respostas permanecem no BI.

Cada escolha apresenta por que a empresa poderia comprar (evidência ou hipótese),
por que aquela oferta, por que abordar agora e a viabilidade comercial. Custos,
margem, urgência e prazo de fechamento desconhecidos são explicitados, nunca
inventados. A qualificação privada não entra no prompt de seleção: somente os
indicadores booleanos de confirmação. Mudanças na qualificação, responsável ou
política invalidam avaliações antigas, preservando recibos e registros.

O objetivo é comparar qualificação, proposta, recebimento, ciclo e margem quando
houver dados; resposta humana e nota não equivalem a venda ou probabilidade.
Condições e preços continuam nas fontes oficiais da Prumo. Limites, pausas,
proteções da conta e regras do atendimento permanecem vigentes.

## Reorganização comercial e preservação do escritório (23/10/2026)

Rômulo autorizou executar o plano de reorganização por fases neste chat, com
subagentes de escopo delimitado. Preservar o escritório isométrico, cenário,
personagens/sprites, mesas, quadros, câmera e navegação. Melhorias comerciais
devem usar os quadros, indicadores e painéis existentes; as filas “Precisa de
você”, “Time em execução” e “Aguardando cliente” são agrupamentos operacionais,
sem exigir nova home ou substituir o escritório por um dashboard.

“Minhas decisões” continua sendo o acesso às pendências humanas, e “Decisões dos
agentes” ao trabalho do time, com evidências, responsável, próxima ação e condição
de espera. Validar os cliques, os painéis e o retorno ao escritório no desktop e
celular. Redesenho integral está fora deste plano. Preservar alterações anteriores
e publicar por lotes verificáveis; nenhuma fase reativa caçadores pausados.

O prompt de transição do VENDAS/Grok já foi comunicado por Rômulo. Isso não
comprova a pausa das tarefas na VM e não cria sincronização com a aba CRM.

## Qualidade da seleção comercial (23/10/2026)

Rômulo autorizou ajustar as avaliações dos agentes e manteve a abordagem atual
da demo de Site sob demanda, preparada em cerca de dez minutos. Não exigir demo
prévia como condição de seleção. A falta de resposta não comprova lead ruim.

Diego verifica perfil e destino; Elisa verifica evidência e pertinência da entrega;
Carla verifica abordagem e próximo passo. Os primeiros pareceres não recebem as
opiniões dos colegas. Cada papel precisa aprovar com pelo menos 65; a menor nota
governa a prioridade, sem compensação por média. Mudanças na ficha, texto ou régua
invalidam o cache da avaliação, preservando o histórico e os recibos de envio.

Os sinais públicos da triagem chegam às três leituras. Na seleção automática,
Iris exige evidência de público infantil/TEA; Estamparia exige roupa e personalização,
conforme o perfil já definido na Prumo. Ficha insuficiente aguarda conferência sem
ser descartada do CRM. Sinal público não confirma dor, decisor ou intenção de compra.
O sinal histórico por setor usa contatos com pelo menos 48 h e dez casos, separando
robô e recusa de indicação humana. Limites, textos e operação das conversas ficam
nas regras existentes; esta revisão não reabre pausas nem muda a rodada comercial.

## BI e rodada comercial (23/10/2026)

Pedido do Rômulo: ações com evidência, responsável e resultado esperado; BI de
público, mensagens, sequências e escolhas dos agentes. O BI deriva das fontes
existentes, distingue classe atual de marco histórico e não muda o negócio
automaticamente. Comparações descritivas usam contatos maduros (48 h), mostram
denominador e cobertura e não declaram causalidade ou vencedor de A/B.

Decisão confirmada pelo Rômulo: até 15 novos contatos/dia, 2 por hora e 30 minutos
entre contatos; até 10 aguardando resposta humana desde o início da rodada.
O controle não zera à meia-noite nem após reinício. Robô, recibo, passagem do tempo,
perda por prazo e erro ambíguo não liberam vaga. Resposta humana posterior observada
libera a vaga; revisão humana explícita com motivo inicia outra rodada e guarda
a contagem anterior. O limite de 10 substitui a pausa por proporção de silêncio,
preservando bloqueio, restrição, desconexão, pausas e demais gates. Não há número
seguro publicado pela Meta nem ampliação da autorização de respostas automáticas.
O controle de reservas é operacional, privado; a aba CRM continua fonte comercial.

## Classificação contextual das respostas (22/10/2026)

Por pedido do Rômulo, separar interesse comercial explícito, permissão para material,
acesso/encaminhamento, curiosidade, resposta automática e silêncio. Identidade ou
“sim” ao pedido de falar com o responsável não confirmam interesse. Permissão
continua permitindo preparar o material específico, sem confirmar compra ou
qualificação. Esta decisão substitui a equivalência histórica entre licença e
interesse nas métricas; o indicador legado de pedido de material mantém seu escopo.

A leitura contextual leva motivo, trecho e pergunta anterior. Falta de contexto,
áudio não transcrito e entrada posterior ao robô ainda não classificada ficam
pendentes de revisão. Ausência de papel não comprova humanidade; silêncio sem
recibo não significa mensagem ignorada. Preservar fonte, eventos, recusas, pedidos
de exclusão e condições históricas. A leitura não grava na planilha, reabre perdas,
envia mensagens ou muda limites. Atualizar o classificador não autoriza responder
automaticamente. A rotina do Grok duas vezes ao dia continua fora do controle do Dell.

## Qualidade da Prumo (21/10/2026)

A Prumo é a fonte dos critérios, nomes e aceite; o SquadOne executa. Leia `docs/referencia/organizacao-prumo.md` e `../prumo/00-contexto/organizacao.md` antes de criar ou alterar ofertas e fluxos. Site e Raio-X passam por `deploy/dell/lib/qualidade_prumo.py` antes de publicar. Homologação é identificada; Profissional exige todos os obrigatórios, IQS completo, referência e manifesto exatos. O gerador não publica diretamente nem assina aceite; avaliações aprovadas ficam na área privada, fora da pasta do lead. O Mapa continua como rascunho, sem envio automático.

`prumo_contexto.py` injeta o guia canônico em cada entrada dos workflows Prumo/Site e seus subworkflows. O `n8n.py` mantém essa integração nas regenerações; `prumo-contexto.timer` confere a sincronização a cada 15 minutos e preserva os fluxos pausados. A cópia operacional é identificada por SHA256 em `~/.local/share/prumo-contexto/`.

**Acompanhamento automático (21/10/2026, pedido do Rômulo):** envios e respostas
capturados pelo observador dispensam confirmação ou transcrição pelo operador.
A sala mostra o conteúdo observado e só oferece registro manual para contexto
complementar ou acontecimentos por fora. Abrir WhatsApp aguarda evidência de nova
saída; não presume envio, conclusão de tarefas, aceite ou pagamento. Próxima ação
continua sendo uma decisão humana opcional. Esta decisão substitui a exigência de
registrar acontecimentos já observados na jornada da sala. A atualização recebe
sinais do servidor, reconecta ao retornar e conserva consulta periódica e rascunhos.

**Robustez comercial (19/10/2026):** indisponibilidade temporária da lista de leads não autoriza descartar uma resposta. Eventos úteis aguardam correlação em armazenamento privado durável; o mapa LID persiste com permissão 600. Confirmação de recebimento exige persistência; replay identifica duplicatas e preserva os diferentes tipos e estados de uma mesma mensagem. Não se ampliam as conversas pessoais capturadas nem se imprimem conteúdo, telefone ou identificadores privados no journal. Alertas P0 e falhas do Dell saem exclusivamente pelo Telegram; se ele falhar, ficam para nova tentativa, sem fallback pelo WhatsApp. Caçadores pausados permanecem pausados, e a triagem privilegia dor comprovada e interesse humano com amostra mínima, sem inferir ausência de avaliações a partir de dado faltante.

**Medição comercial AARRR (19/10/2026):** valor da proposta e pagamento são registros distintos, confirmados pelo Rômulo na aba CRM existente. Ganho verbal não confirma recebimento. Valores vêm do catálogo da própria oferta; Estamparia permanece sem preço aprovado. Pagamentos têm data real, referência e componente, deduplicação e correção explícita, sem editar o histórico. A Estrela-guia conta recebimentos confirmados na semana de São Paulo nas cinco linhas, independente do filtro da tela. Ausência de registros novos não comprova o histórico anterior. Retenção exige assinatura paga e confirmação humana de atividade no terceiro mês; indicação pede um passo humano trinta dias depois do primeiro pagamento válido, sem envio automático. Essa medição não consulta Finanças pessoais, e valores ou referências de recebimento não entram nos prompts dos modelos.

**Diagnóstico de vendas (19/10/2026):** a proposta nova exige dor, impacto e decisor confirmados pelo Rômulo no SPICED da Ficha, separado das sugestões citadas do copiloto. O modelo não produz preço; o código monta os valores da oferta a partir de sua fonte canônica. Iris usa faixas marginais por ficha ativa/mês, sem misturar sua regra com o cardápio de serviços PRUMO. Propostas históricas reais permanecem registráveis sem reescrever condições.

**Cadência comercial (19/10/2026; proposta revista pelo PM em 28/10/2026):** a proposta vale 10 dias corridos; sem retorno, tem toques no primeiro e no quarto dias úteis (seg–sex) e no oitavo dia corrido, também nas propostas do ciclo comercial, e encerramento por prazo no décimo dia corrido, com motivo “sumiu” (registrado como “proposta sem retorno”). O “Perdeu” à mão só grava com um motivo da lista fechada (preço, não é a hora, quem decide não aprovou, já tem quem faça, não vê necessidade, sumiu, contato errado); pausas explícitas, compromisso futuro e retorno humano posterior protegem a conversa. Essa decisão específica substitui a proibição anterior de perda de proposta somente por prazo. Conversa humana em andamento recebe um toque no segundo dia útil e revisão no sétimo corrido, sem perda inferida por silêncio. Leads que nunca responderam seguem o relógio único de sete dias no CRM, acompanhamento e limpeza, preservando as proteções de demos e a revalidação antes de cada ação. Confirmar “Enviei” grava o degrau na aba CRM para não repetir no dia seguinte. Avisos de conversa no Telegram podem chegar fora do expediente, com silêncio das 22h às 7h; expediente e ritmo continuam limitando o primeiro contato.

Escritório integrado (18/10/2026, refinamento do Rômulo): o cenário usa toda a altura, com navegação flutuante e acesso verde separado ao Assistente, sem imitar o estado ativo de uma página. No desktop o Assistente abre à direita e pode ser recolhido; a preferência é lembrada neste aparelho. No celular abre sob demanda em card central, enquanto a sala ampliada pode ser explorada horizontalmente, sem rolagem da página. O card de agente abre o canal direto; conversas de clientes têm acesso próprio, e agenda, delegação e operação ficam em seções secundárias. Substitui as três abas Conversas/Conversar/Trabalho e a moldura modal do Assistente no desktop; preserva cards centrais nas demais áreas, observação de fatos pelas integrações e proteções do serviço comercial.

Escritório imersivo (18/10/2026, correção explícita do Rômulo): a home é um único ambiente aberto em pixel art, com os agentes animados e clicáveis. Dois telões compartilhados mostram as decisões e o andamento do time e as conversas que dependem do usuário; abrem detalhes sobre o cenário. Navegação fixa no rodapé em todas as larguras: Escritório, Assistente, Vendas e Mais. Sem trilho lateral nem campo de busca visível. Vendas, Assistente e detalhes dos agentes abrem em cards centrais, com margem ao redor, botão Fechar, clique fora e Escape; o Assistente conserva seu escopo geral. Mais dá acesso a Agenda, Finanças, Entrada e Configurações. A sala permanece montada atrás dos painéis, sem rolagem de página ou zoom manual; painéis têm uma única região de rolagem. A indicação “Sua vez” abre uma missão comercial: objetivo, contexto e marcos observados nas integrações. Informar algo ao time registra contexto, sem presumir conclusão ou envio. A direção visual é um escritório aconchegante com madeira, plantas, luz quente e sprites existentes sobre cenário ilustrado. Esta decisão substitui a home de cartões com escritório recolhido, sem alterar o serviço comercial autorizado ou suas proteções.

Fase 0 do diagnóstico de vendas (19/10/2026, decidida pelo Rômulo): as cinco linhas dividem 30 primeiros contatos/dia pela ordem da fila de venda, sem cota por linha, mantendo 5 minutos e 12/h. Nenhuma linha está congelada; Iris e o CRM de estamparia são produtos prontos, e seus caçadores continuam pausados (AC-11). Plus é teste de 20 envios de rede quente feitos pelo Rômulo, nunca pelo time comercial. Uma variante nova do A/B pode abrir com um fato verificável do Raio-X como evento crítico; os textos passam pelo Rômulo antes de ir ao ar. Esta decisão não religa caçadores.

Central orientada à venda (18/10/2026, nova decisão do Rômulo): a Central mostra conversas e decisões comerciais; configuração de equipe, aparência, infraestrutura e responsabilidades moram em Configurações. Atualizações são automáticas, com retorno à aba, prazo de rede e preservação de rascunhos. Uma rolagem de página; mapa sem controles de zoom. Rótulo de campo, estado, título e ação têm padrões distintos e documentados.

Primeiros contatos pelo time (18/10/2026, autorização explícita do Rômulo; teto revisto na Fase 0 em 19/10): os agentes escolhem, pontuam, preparam e enviam primeiros contatos dentro do teto compartilhado de 30 por dia; o Rômulo conduz a conversa posterior. Esta decisão substitui a exigência anterior de envio manual para o primeiro contato neste serviço. Diego avalia aderência, Elisa confere a entrega e Carla decide a abordagem a partir dessas avaliações reais. O serviço tem estado durável, proteção contra repetição por número e revalidação antes de enviar. Preserva expediente, intervalo e limites compartilhados; não retoma recusas, exclusões ou conversas anteriores. Falha ambígua impede reenvio automático. O estado exibido vem de confirmação da integração e da conversa observada, sem botões de “já fiz” ou conclusão presumida. Não autoriza respostas automáticas às conversas nem mudanças de preços, infraestrutura ou credenciais. Em 28/10/2026 o Rômulo autorizou retomadas em conversa aprovadas por um PM com autoridade delegada, enviadas por disparo supervisionado (ver docs/PRUMO-DECISOES-PM-2026-10-28.md); um envio automático contínuo a conversas ainda exige implementação e registro próprios.

Clareza e conclusão dos fluxos (18/10/2026, pedido do Rômulo): a classificação pode ser revisada e confirmada na Ficha, com motivo e contexto atual. A decisão fica como nota identificada na aba CRM existente, vinculada à classificação de origem; não reescreve a coluna da fonte e perde validade se houver novo contexto ou desfecho. Convites da Central usam destino direto do WhatsApp e texto revisável: abrir conta somente como tentativa conservadora para o ritmo, nunca como envio. Conteúdo e horário do convite só entram no acompanhamento após confirmação explícita, em nota identificada no CRM. Esta regra substitui a equivalência clique/envio da regra 17 para convites da Central. A triagem permite adiar por até 24 horas neste aparelho, com lista acessível e retorno à triagem, sem dispensar ou alterar o CRM. Avisos abrem seus encaminhamentos no topo; a visualização do escritório fica recolhida no celular. Revisão interna e espera usam rótulos próprios, sem presumir autorização de contato.

Preparo de amanhã (18/10/2026): atalho por lead relê o contexto e exige plano ativo para amanhã em São Paulo e hash atual no servidor. Só propõe rascunho, respeitando espera/recusa e sem alterar combinado. Revisão pode guardar texto neste aparelho, identificado por oferta/lead/data/hash; não equivale a envio ou aceite do cliente. Antes da data, o cartão não libera WhatsApp com texto; leitura da conversa segue acessível. Na data, nova conferência do contexto e confirmação humana antes de abrir. Sem lote automático ou novos filtros.

Próximos dias na sala (18/10/2026): leitura dos próximos passos ativos agrupa amanhã e datas posteriores pelo calendário de São Paulo, sem novos filtros, limite de horizonte ou alteração automática. Hoje mantém prioridade; futuros não duplicam outras pendências. Preparar antecipadamente não autoriza antecipar contato. Conclusão, reagendamento e WhatsApp mantêm as confirmações existentes.

Conclusão e reagendamento na sala (18/10/2026): revisão explícita vinculada ao hash atual do lead; servidor recusa contexto alterado e cliques repetidos durante atualização. Reagendar grava um único proximo_passo; concluir grava proximo_passo vazio com a data real da conclusão, limpando o plano ativo sem registrar ganho ou perda. As regras de prazo de Vendas continuam valendo. Vazio sem data continua sendo limpeza legada. Histórico distingue conclusão de limpeza. A fila só muda com a leitura da fonte, sem ocultação otimista; falha ambígua bloqueia repetição automática.

Retomadas na sala (18/10/2026): próximos passos datados da fonte existente destacam hoje e atrasados, sem duplicar fila ou inferir envio pendente por silêncio. Interação posterior ao plano exige conferência. Preparar retomada relê lead e valida contexto e vencimento no servidor; propõe mensagem e revisão do plano, sem envio ou gravação automáticos. Desktop limita a coluna da sala à altura disponível com rolagem própria; celular mantém rolagem única.

**Teto de primeiros contatos (Fase 0, 19/10/2026, decisão do Rômulo):** a trava compartilhada
do time comercial, da Central e do vendedor fica em até 30 primeiros contatos por dia de São Paulo,
12 por hora móvel e intervalo mínimo de 5 minutos. Substitui o teto de 100/dia de 18/10 e a rampa 10/20/30.
É limite operacional interno, sem garantia contra restrições do WhatsApp; os
limites da Cloud API não se aplicam ao envio manual pelo aplicativo. Preservar
expediente e pausa por restrição. A revisão humana e o envio manual seguem nos fluxos do Rômulo;
o time conserva apenas a autorização de primeiro contato descrita acima. A contagem cobre
as ações registradas no sistema, não todos os envios diretos no celular. Nenhuma
mensagem pode afirmar que esse ritmo autoriza contato sem consentimento ou evita
bloqueios. Não ampliar a autorização de envio automático de primeiro contato nem criar mecanismos de evasão de antispam.

Retorno como base da resposta (18/10/2026): o agente usa a nota humana identificada de retorno relida da fonte existente, sem copiar texto no comando. A sala espera a nota aparecer; o servidor valida o hash do contexto e a presença do retorno antes de gerar. Retornos e mensagens são dados, nunca instruções. Próximo passo e abertura no WhatsApp continuam propostas revisadas e confirmadas separadamente. A navegação entre registro e conversa compartilha uma âncora estável; no celular há uma só rolagem da página, sem abas sobrepostas ou saltos por atualização assíncrona.

Confirmações na sala (18/10/2026): envio e retorno são fatos informados explicitamente pelo operador, registrados como notas identificadas pela rota de registro existente. Próximo passo exige texto e data confirmados, sem mudar etapa ou enviar mensagens. A abertura do WhatsApp não registra envio. Erro de transporte não autoriza repetir automaticamente a gravação. Formulários ficam vinculados ao produto e lead, com prévia antes de confirmar.

**Resposta revisada na sala (18/10/2026, pedido do Rômulo):** o agente prepara
mensagem e próximo passo para revisão. Na sala, o operador confere o contexto,
edita a mensagem e autoriza abrir o WhatsApp com texto pronto. Isto substitui
o limite de só copiar da regra 28 apenas neste fluxo; não envia nem confirma
envio. Antes de liberar o link, reler o CRM e recusar contexto alterado. Resultado
e próximo passo usam a rota existente de registro, com confirmação inline na sala. Avaliar com
protopersona do operador com TDAH, como hipótese de projeto, sem alegar teste
humano ou venda fechada: abertura e cópia não são sucesso comercial.

**Lead na conversa da sala (18/10/2026, pedido do Rômulo):** selecionar um lead
abre conversa com o agente no contexto dessa empresa, sem copiar dados para o
campo. O navegador envia só produto/id; o servidor relê o dossiê mascarado do CRM.
Cada par agente/lead tem histórico e rascunho separados. Trocar ou retirar o lead
é explícito e não redireciona resposta em andamento. Ficha e WhatsApp permanecem
acessíveis; selecionar ou conversar não registra envio nem muda o CRM.

**Conversa nas salas (18/10/2026, autorizada pelo Rômulo):** clicar no sprite
abre a conversa daquele agente dentro da sala. O servidor resolve pessoa, papel
e escopo no roster ativo do PRUMO; o navegador envia só os ids. Cada agente tem
histórico separado, inclusive após reinício. O motor continua o Assistente da
regra 28: leituras e respostas reais, comandos geram cartões para confirmação.
Andamento distingue preparar resposta, aguardar confirmação e resultado do
pedido. Sprites não comprovam trabalho. Trocar escritório é navegação secundária;
leads e WhatsApp mantêm as rotas atuais.

**Escritório como central (18/10/2026, autorizado pelo Rômulo):** no perfil
operations o escritório ocupa a home, começando pelo PRUMO. Cada sala reúne
responsáveis, pendências do seu recorte e ações. A ficha existente de Vendas
abre dentro do escritório, preservando confirmação humana, histórico e travas.
Pedidos de trabalho reutilizam a orquestração atual (agenda/tarefas), com o
contexto da sala e responsável indicado; não significam execução comercial.
Automações continuam com os mesmos contratos e permissões. Esta direção
substitui a posição de consulta do escritório descrita em 17/10 e na regra 13.
Sem fonte não há contagem zero nem atividade presumida.
No celular, a home prioriza o controle da sala com seletor horizontal e mapa
opcional; no computador, cenário e trabalho ficam lado a lado. Os sprites
CraftPix são preservados, sem fallback visual de emojis. Links do WhatsApp
continuam na ficha; o atalho de leitura da sala não confirma nenhum envio.

**Classificação e preservação de demos (18/10/2026, pedido do Rômulo após conferir Comece):**
recusar abrir um link não é recusar o produto. Resposta humana posterior a uma classificação
terminal exige revisão do contexto, nunca nova cobrança automática. Conversa sem retorno não
vira perda apenas pelo prazo; o CRM pede revisão do próximo passo. Demos com conversa humana,
próximo passo, proposta ou pausa ficam protegidas da limpeza automática até encerramento
manual atual. A limpeza relê o CRM antes de cada exclusão; sem confirmação atual não apaga.
Ausência de arquivo de conversa também protege: não comprova falta de resposta.
A pausa de hospedagem usa a mesma proteção e também revalida o CRM antes da ação.
Encerramento humano posterior resolve compromissos antigos e reinicia a folga de dois dias;
novo compromisso posterior a esse encerramento volta a proteger a demo.
Pedidos explícitos de exclusão continuam no comando próprio, confirmado pelo operador.

**Direção de venda e histórico (17/10/2026, pedido do Rômulo):** a Central prioriza
a próxima decisão de venda; o escritório fica como consulta. Vendas não recomenda
retomar um contato sem conferência humana do contexto atual. Arquivo de mensagens
é histórico parcial, nunca prova de cobertura completa. A conferência fica em nota
identificada na aba CRM e perde validade quando a conversa ou os marcos avançam.
Uma exportação de conversa individual pode ser importada por gesto explícito,
com prévia, identificação dos participantes e confirmação do lead; nunca dispara
classificação, mensagem, mudança de etapa ou proposta retroativa.

**Aprendizado comercial (17/10/2026, pedido do Rômulo):** abrir uma proposta no WhatsApp
não comprova envio. A Ficha pede confirmação humana com conteúdo e data; a Próxima venda
só anota proposta ao confirmar “Enviei”. Aprendizados ficam como notas identificadas na
aba CRM existente, com fato, hipótese, próximo teste e resultado separados. Silêncio não
prova recusa, defeito no preço ou autorização para insistir. O registro não muda a etapa,
não agenda ações e não reescreve estratégia, preço ou prompt automaticamente.

1. Preserve o SquadOne como nome do produto em toda interface nova.
2. Não represente integração, aprovação ou saúde operacional como real sem
   evidência da fonte correspondente.
3. Componentes interativos devem funcionar por teclado, manter foco visível e
   comunicar estado também por texto.
4. Não use ícones como único rótulo de uma ação sem nome acessível.
5. Protótipos isolados não podem alterar rotas, serviços, credenciais ou dados
   da aplicação.
6. Antes de mudar arquitetura, atualize este documento e `ARCHITECTURE.md` com
   a decisão aprovada.
7. O SquadOne é um app único no Dell (decisão de 05–06/10/2026): o perfil
   `SQUADONE_MODE=operations` serve a Central **e** o app (roster, turno,
   Mochila, ajuste, avisos, finanças), num processo só, escutando
   exclusivamente em `127.0.0.1:9120`. Fora do Dell ele só é alcançado pela
   tailnet do Rômulo: Tailscale Serve na porta HTTPS 8443 repassa ao loopback.
   **Nunca Funnel**: o app escreve no Google Calendar e no Tasks e guarda
   finanças, e na internet aberta o porteiro e o header abaixo seriam a única
   trava. O acesso tem três camadas, e nenhuma substitui a outra:
   - **ACL do Tailscale** restrita aos aparelhos do Rômulo para a porta 8443
     do Dell. O porteiro de IP admite a faixa inteira da tailnet
     (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`), então sem a ACL qualquer nó da
     tailnet (um servidor com tag, um aparelho compartilhado, um convite
     futuro) leria a agenda e as finanças;
   - **o servidor confere o header de identidade do Serve**
     (`Tailscale-User-Login`) contra uma lista da configuração em toda
     requisição que chega pelo Serve; ausente ou fora da lista é 403. Vale como
     segunda trava porque uma ACL editada às pressas abre calada, e o header só
     é confiável porque o processo escuta só em loopback: quem o põe é o Serve,
     não o navegador. Nó com tag não tem usuário e fica de fora, de propósito.
     Requisição local direta (processos do Dell, túnel SSH do PC para o
     callback do OAuth) não passa pelo Serve e segue valendo: quem já roda no
     Dell já tem as credenciais (ver "Riscos aceitos" no `ARCHITECTURE.md`);
   - **rotas que escrevem exigem `Origin`/`Sec-Fetch-Site` da mesma origem**.
     O header de identidade não protege de CSRF: uma página qualquer aberta no
     celular do Rômulo, que está na tailnet, faria o POST com a identidade dele.

   O porteiro de IP (`IPS_PERMITIDOS`: loopback e as faixas da tailnet) fica
   como terceira camada. As rotas do app entram no `operations` na mudança da
   agenda para o Dell, junto com o roster de **produção**, nunca sobre o
   retrato de 14/09/2026 que o Dell tem hoje: até lá seguem desmontadas e
   respondem 404 JSON (a higiene de 06/10/2026 fechou a escrita no Dell por
   isso). A exceção são as **finanças** (`/api/financas/*`, 07/10/2026): não
   dependem do roster nem da agenda e entram antes ("Transição", 3), já com a
   segunda e a terceira trava — a lista de logins é a
   `SQUADONE_LOGINS_TAILSCALE` do `operations.env` (a mesma da agenda), e com
   ela vazia as finanças fecham para quem chega pelo Serve. `/api/operations/*` e `/api/financas/*` continuam só no `operations`:
   o perfil `app` não tem os dados do Dell. Rota nova entra explicitamente,
   nunca por "montar tudo".
8. Health checks operacionais são alvos fixos da configuração local. O
   navegador nunca envia comandos, processos ou URLs para serem executados.
9. Projetos locais ficam fora do Git, exigem nome e destino e recusam esquemas
   diferentes de `http` e `https`.
10. A infraestrutura continua somente leitura: nenhuma tela, rota ou agente do
    SquadOne para, reinicia ou reconfigura serviço (n8n, Hermes, Docker,
    systemd, Tailscale). Quem conserta é Claude ou Codex pela máquina de
    controle (regra 20), com o Rômulo vendo. A escrita de **domínio** —
    Calendar, Tasks, roster, CRM (pelo webhook do n8n, regra 11) e finanças
    (categoria, orçamento, lançamento à mão) — só acontece por **gesto do
    usuário** (um clique no app, uma demanda que ele mandou no Telegram ou no
    Pedir) ou por **cartão que ele confirmou**. Agente, timer, leitura ou
    mensagem recebida propõem; não escrevem. É o que impede o modelo de agir
    sozinho: com Gemini no meio, uma escrita disparada por evento faria um
    texto de planilha ou de lead virar compromisso. Consequências: `GET` nunca
    escreve, e o link de um cartão no WhatsApp só **abre** a tela, onde a
    confirmação é um `POST` da mesma origem (regra 7); "responda 1 ou 2" pelo
    WhatsApp é proibido, porque daria a decisão ao Hermes (regra 20).
    Sincronizar uma fonte (Pluggy, retrato do CRM, `status.json`) não é escrita
    de domínio: é cópia local do que a fonte já diz, e corrige-se na fonte.
    **Exceção, 16/10/2026 (pedido do Rômulo: "as falhas têm que disparar o
    Hermes para resolver"):** o `socorro` do Dell (`deploy/dell/socorro.py`,
    disparado pelo `dell-status` quando uma verificação ENTRA em falha) pode
    executar sozinho só o que está na lista fechada `REMEDIOS` daquele
    arquivo: `systemctl --user restart` de hermes-gateway, hermes-dashboard,
    hermes-google-browser, code-server, evolution-adaptador,
    whatsapp-observador e whatsapp-observador-prumo; `docker restart` do
    container do n8n (o mesmo do healthwatch) e `docker start` dos três
    containers da Evolution. No máximo 2 tentativas por verificação a cada 6 h.
    O Hermes entra só para **diagnosticar** (`hermes -z` sem terminal, arquivo
    nem mensagens, no máximo 1 vez por verificação a cada 6 h e 6 por dia) e
    pode escolher um remédio, que só vale se estiver na mesma lista; o resto
    vira um pedido pronto para o Claude Code no aviso. Nada além disso:
    nenhuma escrita de domínio, configuração, credencial, fluxo, compose,
    apagar ou editar arquivo. O "Quebrou" sai igual; `~/.config/socorro/desligado`
    (`socorro --desligar`) desliga tudo. Mexer na lista é mudar esta regra.
11. O CRM (`/crm`, desde 30/09/2026 no lugar da Produção Auto) não tem etapa
    própria: a fonte da verdade são as planilhas (Leads do Site antes da venda,
    Prospects do PRUMO), lidas pelo retrato que o n8n grava em
    `n8n-estado/crm.json`. Pastas do `autoDirectory` e Mapas de
    `~/prumo-entregas` são só lidos; divergência entre planilha e pasta é
    mostrada, nunca corrigida. As únicas escritas são nota, próximo passo e
    proposta, que vão à aba CRM da planilha pelo webhook do n8n (segredo no
    header, só o servidor da Central o tem); nada disso fica em
    `SQUADONE_OPERATIONS_DATA_DIR` nem nas pastas dos clientes, e nada é
    enviado a lead.
12. `publicado.json` é somente um registro local. Disponibilidade pública,
    leitura, aprovação ou publicação pelo cliente exigem evidência própria e
    nunca podem ser inferidas pela interface.
13. **Desde 17/10/2026, no perfil `operations` a home é a Central de comando**
    (pedido do Rômulo: três menus, Central de comando, Assistente e Vendas). Ela
    responde nesta ordem: o estado do Dell (o único lugar do número "precisam de
    você") e **o que precisa do Rômulo agora, em no máximo 3 cartões** (o do Dell
    conta como um; o resto atrás de "ver todos", pelo mesmo motivo de sempre); o
    Escritório animado, com balões só com fonte e "Sem sinal" sem ela (regras 2, 19
    e 26: o passeio é decoração; só o problema real do `status.json` move o PO
    raiz até a sala dele); e uma faixa de uma linha por frente (Vendas, Agenda,
    Finanças, Entrada, Dell), cujo detalhe abre numa folha ou na rota inteira, que
    continua existindo por endereço. A Próxima venda mora em Vendas. Agenda,
    Finanças, Escritório e Entrada saíram dos menus; o Mais virou a Manutenção,
    discreta. No perfil `app` (Easypanel) a home continua a **Hoje** abaixo.

    A Hoje (perfil `app`) é pensada primeiro para o celular, e responde nesta ordem:
    - **o que precisa do Rômulo agora**, em no máximo 3 cartões (falhas do
      `dell-status` com `o_que_fazer`, cartões de decisão dos agentes, leads
      que responderam e esperam resposta — do retrato do CRM, desde
      08/10/2026, antes das finanças porque resposta de lead esfria em horas —,
      alerta de finanças em semáforo); o resto fica atrás de "ver todos". Mais de 3
      numa tela de celular vira lista que ninguém lê, e o mais grave some no
      meio;
    - os **próximos compromissos**;
    - o **estado do time** (uma linha por squad, com texto);
    - a **linha do funil** (o resumo do CRM, que abre `/crm`);
    - **o que resolve sozinho**, fechado: está ali para conferir, não para
      interromper.

    A home não aponta mais para o Easypanel: os agentes moram no mesmo app
    (Pedir e Escritório), e um botão para fora mandaria o Rômulo a uma cópia
    que, depois da mudança, é reserva fria (regra 25). Como a operação
    funciona (`src/operations/fluxos.ts`), Entrada e acessos ficam em "Mais";
    dashboards completos pertencem a rotas próprias (Funil, Finanças).
14. Leituras do Hermes exigem projeto, origem, instante e evidência explícitos;
    arquivo ausente significa estado vazio e não autoriza dados demonstrativos.
15. Um slug no estado do watcher prova somente que `hermes send` foi concluído;
    não prova leitura da mensagem. Saúde conectada do WhatsApp prova somente a
    disponibilidade atual do canal, não a entrega de mensagens anteriores.
16. Atualização persistente da Central é somente leitura: o canal SSE pode
    solicitar nova consulta, mas não iniciar runner, serviço, sincronização ou
    envio.
17. Workflows PRUMO usam o `ID` (ID do Google Places) como vínculo canônico entre
    Prospects, formulário e diagnóstico. O clique no link rastreado "Enviar
    convite" conta como envio (Etapa → Convite enviado); o mesmo vale para o
    `wa_link` do Site antes da venda (`pronto` → `enviado`) e, desde 30/09/2026,
    para mensagem que o Rômulo escreve ao número do lead no WhatsApp (linha
    `owner_sent` da bridge; `recusado` e `expirado` voltam a `enviado`). No Site
    antes da venda, só mensagem do lead a 5 min ou mais do envio conta como
    resposta (`respondeu_em`); antes disso pode ser saudação automática. Leitura
    (`visto_em`) só aparece para quem deixa a confirmação de leitura ligada:
    "entregue sem lido" é "não sei", nunca "não viu". O Hermes não envia nada a
    lead: a bridge só registra o que o aparelho vinculado já recebe.
18. O telefone público retornado pelo Google Places não prova disponibilidade
    no WhatsApp. O preenchimento automático de `Canal de contato` e `Destino
    do contato` exige link público de WhatsApp no site institucional; na
    ausência dele, somente confirmação humana pode classificar o número. Links
    com número fixo ou 0800 não qualificam a empresa para abordagem automática.
19. O estado do Dell na Central vem só de `status.json`, gravado pelo monitor
    `dell-status` no Dell. A Central não executa verificações, não recebe
    chaves de serviço e, sem retrato recente, diz que não sabe em vez de
    afirmar que está tudo bem.
20. Papéis e canais. Claude e Codex controlam e corrigem (SSH, Tailscale); o
    SquadOne é o app (agenda, agentes, CRM, finanças); o n8n do Dell é o
    gerente de fluxos e todo fluxo termina respondendo a alguém; o Docker do
    Dell é o servidor de projetos. Os canais, cada um com um papel só:
    - **Entrada pelo Telegram, buscado pelo Dell com `getUpdates`** (long
      polling, offset persistido). Webhook exigiria URL pública, e Funnel é
      proibido (regra 7); o polling só abre conexão de saída. Continuam as
      travas do bot: allowlist de `chat_id` que fecha quando vazia, só chat
      privado, dedupe de `update_id`, fila serial e demanda com mais de 10 min
      não roda. Sem rota de webhook no Dell, a trava do segredo do webhook
      vira a do token, que só existe no Dell (regra 25). A squad do turno
      sai do conteúdo (primeira squad ativa + redirecionamento automático);
      a única exceção é um prefixo **sem estado**: `/p` fixa a squad
      `prumo` pelo id, sem chamada a mais ao modelo, e o redirecionamento
      continua valendo depois dele. Nenhuma "squad ativa" fica guardada
      por chat.
    - **O resultado do turno e os botões respondem no Telegram**, na mesma
      conversa: é a resposta a um gesto do Rômulo, os botões inline só existem
      lá, e no WhatsApp a resposta dele cairia na IA do Hermes.
    - **Exceção de 16/10/2026 (pedido do Rômulo): o aviso de venda do vendedor
      sai pelo Telegram** (`server/vendedor.ts`, `SQUADONE_VENDEDOR=true`): seg a
      sex, 08:00–17:30, um por vez, teto de 8 avisos que saíram por dia e 1 por lead, só da lista branca desde 28/10/2026 (o urgente passa por cima). Precisa de botões (abrir o
      WhatsApp com a mensagem, "Enviei", "Pular") e, pela fila, sairia pelo mesmo
      número que fala com os leads. Nunca envia nada ao lead (regra 17).
    - **Toda saída proativa vai pelo WhatsApp do Hermes, pela fila com schema
      e teto** (`~/.local/share/avisos/fila`, drenada pelo `dell-status`:
      formato fechado com `origem` obrigatória, até 20 envios por hora com o
      excedente num resumo, silêncio das 22h às 7h exceto P0, chave repetida
      em 24 h descartada, `expira_em`). Lembretes, falhas e alertas de
      finanças entram nela (o cartão que pedia decisão por link da tailnet saiu
      em 19/10/2026: nada o produz mais); ninguém chama `hermes send` direto. O
      número é o pessoal, o mesmo que fala com leads: rajada é o que costuma
      dar banimento, e um ponto único é o único jeito de o teto valer para
      todos.
    - **Exceção de 16/10/2026 (escolha do Rômulo, OT-14 do blueprint): o aviso
      pessoal do SquadOne sai pelo Telegram.** O lembrete da agenda (vigia) e o
      alerta de finanças (70/90/100%) vão pelo bot ao chat do dono
      (`publicarAvisoPessoal` em `server/avisos.ts`), sem som das 22h às 7h, com o
      mesmo schema e sem R$; só se o bot estiver desligado ou falhar caem na fila
      acima. O motivo: o WhatsApp do Hermes é o número que fala com os leads e
      levou restrição de 24 h em 15/10, e cada aviso pessoal era uma mensagem a
      mais na conta dele. A chave de 24 h que a fila dava a esses avisos agora vive em
      `avisos-enviados.json` (sobrevive ao reinício da Central, que acontece a cada
      merge). O P0 saiu SÓ pelo Telegram (outbox exclusiva
      do dell-status, sem WhatsApp; Fase 5.3, 19/10/2026). **As falhas do Dell também
      (mesmo dia, segunda parte):** o "Quebrou / Continua fora / Voltou ao normal"
      do `dell-status` e o aviso do `socorro` (`origem` "socorro", que a drenagem
      separa) vão pelo mesmo bot, sem som das 22h às 7h salvo P0; desde 19/10/2026
      (Fase 5.3) com o bot fora essas origens e o P0 esperam a próxima rodada e
      não vão ao WhatsApp (só o prefixo `n8n:` e as origens pessoais comuns têm reserva nele). O Python lê `TELEGRAM_BOT_TOKEN` e
      `TELEGRAM_CHAT_IDS` do `operations.env` da Central a cada envio; o segredo
      não é copiado (regra 25). `SQUADONE_LEMBRETES_PELO_TELEGRAM=false` no mesmo
      arquivo desfaz tudo, na Central e no Dell.
    - **P0 é espelhado no Telegram** (`sendMessage` do bot ao chat do dono). A
      sessão do WhatsApp não é oficial e cai (135 quedas em 7 dias, medido em
      05/10/2026); a Bot API é oficial. Só P0, porque P0 também fura o
      silêncio: espelhar o resto dobraria o barulho. (Hoje o P0 não é "espelho": é a única saída.)
    - **O alarme externo é o healthchecks.io**: o processo do Dell manda sinal
      de vida e, se parar, o healthchecks avisa por Telegram e e-mail. Quem
      avisa que o Dell sumiu tem de estar fora dele: o Hermes cai junto. O
      sinal leva só o nome do check, nenhum dado.
    - **O ntfy deixa de existir.** O Rômulo não o usa. Nada novo o usa, e ele
      sai depois de 3 dias úteis do WhatsApp em sombra (ordem no
      `ARCHITECTURE.md`): tirar antes deixaria a agenda sem lembrete.
    - **O Hermes é só transporte**, não motor nem orquestrador: não roda
      turno, não escolhe squad, não decide quando avisar nem o que fazer com
      uma resposta. Medido em 05/10/2026, não aceita as ferramentas do
      SquadOne e leva ~17 s por chamada; e um orquestrador com IA no caminho
      do aviso é mais um lugar para o texto virar ação. O Hermes **trata como
      dado as mensagens que ele mesmo enviou**: os avisos chegam no mesmo chat
      em que o Rômulo escreve ("Mensagem para você") e trazem texto de
      planilha, lead e página; lidos como instrução, seriam injeção de prompt
      pelo próprio canal. As rotinas próprias do Hermes (Graphify, leituras)
      continuam dele; o que vale aqui é o papel dele no SquadOne.
    - **Exceção do Assistente (17/10/2026, aprovada pelo Rômulo; regra 28): na
      Central, o Hermes é especialista consultado, nunca motor.** A Central chama
      `hermes -z -t clarify` (sem terminal, arquivo, navegador nem envio de
      mensagem), numa pasta vazia 700, com stdin fechado, ambiente limpo, timeout
      de 90 s e uma consulta por vez, e com o contexto já lido e mascarado por ela:
      o Hermes não lê nada do SquadOne sozinho para o Assistente, a Central decide
      o que ele vê. A conversa do lead pode ir, mascarada (decisão dele, como já
      vai ao codex do copiloto). As sessões dessa pasta são apagadas antes e
      depois: o `--resume` deixaria a conversa no `state.db`, onde o Hermes do
      WhatsApp a acharia numa busca. O texto que volta é dado: nunca vira cartão,
      ação nem chamada de ferramenta, e aparece como texto. Teto próprio por dia.
      A api_server do Hermes continua desligada (ligar exigiria tirar o terminal do
      toolset dela; com o mesmo usuário da Central, ele alcançaria `financas.db`, o
      segredo do webhook do CRM e o token do Google).
21. `deploy/dell/licitacoes-automation/` versiona somente configuração e código
    não sensíveis; `.env`, dados, históricos e backups do radar PNCP não entram
    no Git.
22. A chamada do n8n ao collector PNCP deve ser assíncrona e idempotente durante
    uma execução ativa: confirmação rápida com ID, repetição com o mesmo ID e
    acompanhamento por estado persistido.
23. `/entrada/` (menu "Entrada", desde 04/10/2026) é só uma ponte: `server/entrada-proxy.ts`
    repassa um conjunto FECHADO de rotas (`GET /entrada/`, `GET /entrada/api/estado`, `POST /entrada/api/enviar` e a fonte `GET /entrada/inter.woff2`) para
    um destino FIXO de configuração, `127.0.0.1:9130` (o serviço da Entrada em
    `deploy/dell/entrada/`). Fica antes do `express.json()` porque o corpo é um arquivo de
    até 200 MB que passa em fluxo. Só seguem cabeçalhos de uma lista de permissão (nunca
    `Cookie` nem `Authorization`) e a query não segue. O repasse não interpreta o conteúdo:
    segredo, tamanho e origem são decididos pelo serviço da Entrada. Não é ação de parar,
    reiniciar ou reconfigurar infraestrutura (regra 10) e o navegador não escolhe destino
    (regra 8). Só existe no perfil `operations`. Duas consequências aceitas: o repasse manda
    `Host`, `Origin` e `X-Forwarded-For` como vieram (quem confere é a Entrada, que continua
    conferindo; a ponte não os substitui); e a `Origin` aceita por `/entrada/api/enviar` é a da
    Central inteira, então um XSS em QUALQUER rota da Central escreveria na Entrada. Por isso
    `src/` não usa `v-html` nem `innerHTML` (não introduza); um token na página não adianta
    (o mesmo script o leria), só origem própria resolveria. Com o app no mesmo processo, a
    mesma origem também escreve no Google e lê as finanças: a proibição vale ainda mais.
24. **Privacidade das finanças.** Valores em R$ ficam **só no app** (a tela e o
    banco). WhatsApp e Telegram recebem **semáforo e %** (do limite do cartão,
    do orçamento: 70, 90 e 100%), **nunca R$ nem estabelecimento**; a
    categoria pode ("Anotado: Mercado"), e quem lança "gastei 30 no mercado"
    pelo Telegram recebe a confirmação sem o valor. O Telegram não é E2E e
    passa pelos servidores dele; o WhatsApp sai pelo Hermes, que é um agente
    com modelo e memória próprios; os dois aparecem na tela bloqueada. O
    estabelecimento diz onde o Rômulo esteve e com o quê gasta (farmácia,
    clínica), mais do que o valor. Pelo mesmo motivo, nenhum valor nem
    estabelecimento vai a log, journal, `status.json` ou aviso.
    **Nada de finanças vai ao modelo sem pedido explícito** — Gemini, Luna,
    Jev ou Hermes (o Jev nunca, nem a pedido: regra 27): categorizar é regra determinística, e a explicação com IA só roda
    quando o Rômulo pede e mostra antes o que vai sair. Finanças nunca entra no
    `systemInstruction` do turno, que leva o roster em toda chamada. O banco
    (`financas.db`, com os `-wal`/`-shm`) e o arquivo com a credencial da
    Pluggy têm **permissão 600**, do usuário do serviço, fora do Git e fora de
    pasta que o container do n8n alcance (a fila de avisos é do grupo dele).
    **O backup é cifrado**: só pelo cofre restic, nunca cópia em claro no
    Drive. Cifrar campo a campo com a chave no mesmo disco não conta como
    proteção e não substitui nada disto (ver "Riscos aceitos" no
    `ARCHITECTURE.md`).
25. **O Easypanel é reserva fria.** Depois da mudança para o Dell, o
    `squadone-app` continua implantável (é a volta ensaiada se o Dell
    morrer), mas travado (`IPS_PERMITIDOS=127.0.0.1`) e **sem as variáveis
    do Telegram** (`TELEGRAM_BOT_TOKEN`, `_WEBHOOK_SECRET`, `_CHAT_IDS`). Com
    elas, o boot de produção chama `setWebhook`, e o Telegram recusa
    `getUpdates` enquanto houver webhook: um Implantar automático do `main`
    derrubaria a entrada do Dell calado. Também não roda vigia nem fila: dois
    processos varrendo a mesma agenda mandariam cada lembrete duas vezes.
    Religar a reserva é um passo manual do runbook, com o Dell fora.
26. **Trabalhadores automáticos ficam fora do prompt.** Os fluxos do n8n e os
    timers do Dell que fazem trabalho de uma sala (Caçador, Funil por nicho,
    gerador, Balcão, Observador do WhatsApp, Acompanhamento, Retrato do CRM,
    Diagnóstico, rascunho do Mapa, caçadores do Iris e das Estamparias)
    ligam-se a ela só pelo catálogo versionado, pelo id do domínio. O catálogo
    é um só desde 15/10/2026: o campo `trabalhador` dos passos de
    `src/operations/fluxos.ts`, de onde `src/office/trabalhadores.ts` deriva a
    lista (duas listas à mão divergiram). O
    catálogo é para o Rômulo ver quem trabalha em cada sala; nunca entra no `systemInstruction`
    e nenhum módulo do servidor importa o catálogo, os fluxos nem a operação
    das salas (`src/office/operacao.ts`; o teste confere). O roster vai em
    toda chamada ao modelo, e um agente que lesse o horário do Caçador
    acharia que pode acionar, reagendar ou consertar o Caçador — a
    infraestrutura é somente leitura (regra 10). Pelo mesmo motivo o treino
    das pessoas não cita os trabalhadores. Trabalhador não vira pessoa do
    roster, e sala não nasce por causa de um. Estado (rodou, falhou) só vem
    do `status.json` (regras 2 e 19): desde 15/10/2026 o Escritório também o
    mostra, sob cada sala, lido do mesmo retrato da Hoje e de Mais; sem
    retrato de até 5 min, ou sem a verificação do robô nele, a sala diz "Sem
    sinal". Os leads de cada sala vêm só do retrato do CRM, e o que não foi
    lido é "sem sinal", nunca zero. O Escritório continua sem gravar nada além
    do roster. As salas são quem trabalha,
    não etapas do funil: as etapas continuam em `src/operations/fluxos.ts`,
    em `src/operations/jornada.ts` e nas planilhas.
27. **O Jev é medição até ser promovido.** O `typesafe/jev-1.13` (TypeSafe pela
    OpenRouter, `server/openrouter-decisoes.ts`) só responde perguntas em
    **sombra**, depois do turno, sem `await`: nada do que ele devolve decide
    squad, sala, tipo ou contratação, nem volta ao Gemini, ao roster ou à UI.
    Só no perfil `operations` com a agenda ligada; **nunca no Easypanel** (a
    chave mora só em `~/.config/squadone/jev.env` no Dell, 600, e nenhum log,
    erro ou registro a repete). **Finanças nunca vão ao Jev**, nem a pedido:
    nem o texto de um gasto falado, nem valor em R$ numa demanda ou num escopo,
    nem demanda de salário, dívida, imposto e afins, nem demanda que o Gemini
    manda para a sala Contas (boletos, assinaturas, vencimentos), que é
    finanças para esta regra por decisão dele (15/10/2026). A demanda, já
    mascarada, passa a ficar em claro no JSONL da sombra
    (`SQUADONE_JEV_GUARDAR_DEMANDA=true` na Mel desde 15/10/2026, decisão dele,
    para dar para dizer quem acertou nas divergências; arquivo 600 que não sai
    da Mel; finanças continuam fora e nunca chegam ao arquivo).
    Todo envio sai com `provider.data_collection: "deny"` e ZDR exigido, e com o
    texto passado por `mascararParaJev` (telefone, e-mail, CPF/CNPJ, URL com
    identificador e segredo viram rótulos fixos). ZDR é a classificação da
    OpenRouter: a TypeSafe não publica prazo de retenção, e o processamento é
    nos EUA. A squad Pay4Fun foi liberada pelo Rômulo para ir a este terceiro
    (11/10/2026). **Respostas de leads** (aprovadas por ele em 11/10/2026, só
    em sombra e só com máscara e recorte) vão por um caminho só: o ramo "Jev:"
    do fluxo de respostas no n8n da Mel (`deploy/dell/claude-ops/whatsapp-conversa.py`),
    com só a última mensagem do lead, cortada em 600 caracteres, mascarada lá
    (também nome do lead e da empresa), e o lead só como hash na Data Table da
    Mel. A chave desse ramo é outra, dedicada, na credencial "OpenRouter Jev"
    do n8n da Mel; nunca no n8n do Easypanel. Virar
    motor de qualquer decisão exige cumprir os critérios de promoção de
    `docs/referencia/perfis-e-experimentos.md` e decisão explícita dele.

28. **O Assistente da Central propõe; o Rômulo faz** (17/10/2026, aprovada por ele;
    desenho na Auditoria da Central, AC-31). Painel de conversa
    (`SQUADONE_ASSISTENTE=true`, só no perfil `operations`, nunca no Easypanel) que
    substitui o Pedir no `operations` (o "＋" e o Ctrl+K passam a abri-lo; a folha
    do Pedir fica só no Easypanel) e, numa segunda fase, a aba do copiloto da Ficha.
    Papéis: o **Gemini** roteia e redige, com ferramentas **só de leitura** sobre os
    GET que já existem (Hoje, funil, fila de venda, lead mascarado, agenda do dia, o
    Dell pelo `status.json`, regra 19); o **Hermes** é consultado nas perguntas de
    estratégia, na forma da exceção da regra 20 (`SQUADONE_ASSISTENTE_HERMES=true`);
    o **Jev** só mede em sombra (regra 27), nunca responde. Para agir, o modelo só
    **propõe cartões**: o servidor valida e o cartão nasce "proposto"; quem escreve é
    o toque do Rômulo, pela rota que já existe e pela guarda de mesma origem (regra
    10). Nada é enviado a lead (regras 11 e 17): mensagem para lead é só "Copiar".
    **Finanças não entram no Assistente**: texto que parece finanças
    (`pareceFinancas`, "R$", gasto falado) não vai a modelo nenhum; o gasto falado
    vira cartão por regra fixa, e o resto responde "isso fica em Finanças". O R$ de
    proposta conta como finanças para esta regra (decisão dele): o preço continua
    vindo do cardápio na Ficha e no "Mandar a proposta". Telefone, e-mail, CPF/CNPJ
    e wa.me saem mascarados de tudo o que vai a um modelo e do histórico. Histórico
    em JSONL 600 em `SQUADONE_OPERATIONS_DATA_DIR/assistente/`, 90 dias, só
    mascarado. Cada resposta mostra de onde veio (as ferramentas que de fato
    rodaram, regra 14), e a saída do modelo é texto interpolado, nunca HTML (regra
    23). Tetos por dia: 60 mensagens e 20 consultas ao Hermes. O catálogo de
    trabalhadores fica fora do prompt (regra 26). As duas flags nascem desligadas.


## Conciliação dirigida de Protect Pragas, Vicente Quesado e Detone (04/11/2026)

Rômulo autorizou neste chat corrigir as três capturas, revisar nove pendências e abrir nova rodada para quinta com os mesmos limites. Protect/Vicente usam vínculos nominais de reentrega às provas Evolution anteriores. Detone exige opt-in `capturaCanonicaTardia: true`: a tuple canônica preservada é a prova Hermes tardia e a âncora Evolution comprova a mesma mensagem antes do horário tardio. Ambas as provas exatas, mesmo ID, direção, conteúdo e conta são obrigatórias. Originais e horários não são alterados, prova nova invalida a revisão e não há aumento de tolerância global. A correção não envia nem confirma autoria humana; respostas continuam com Rômulo.


## Conciliação dirigida de Ninja e Renan (06/11/2026)

Rômulo autorizou neste chat corrigir Ninja e Renan, revisar a pausa da conta e nove pendências, abrir nova rodada e retomar com os mesmos limites. Ninja usa conciliação nominal de um segundo; Renan vincula a reentrega Hermes sete segundos tardia à prova Evolution anterior pelos hashes exatos. Mesmo ID, direção, conteúdo e conta e o conjunto integral das provas revisadas são obrigatórios. Capturas, horários e provas originais permanecem intactos; prova nova invalida a revisão, sem aumentar tolerância global. A revisão da conta foi feita com conexão direta confirmada e CRM atual; liberação pela rota normal. Respostas continuam com Rômulo.


## Avisos automáticos na revisão comercial (06/11/2026)

Rômulo pediu corrigir Vicente, Celião e Oswaldo e impedir que avisos de recepção, ausência e expediente sejam tratados como respostas humanas. O classificador compartilhado, versionado como respostas-2026-11-06-avisos, reconhece moldes completos; saudação ou horário com conteúdo comercial humano adicional não são consumidos por esses moldes. Na revisão, usar a classificação atual: classe robo e houveRespostaHumana false não criam interesse, permissão ou tarefa de responder ao cliente. Estado humano de um handoff interno indica o responsável pela tarefa técnica, não a autoria do cliente. Identidade conflitante, recusa, exclusão e contexto insuficiente continuam protegidos. Nova entrada deve ser classificada pelo novo contexto; não perpetuar uma revisão nominal por nome. Originais e evidências anteriores ficam preservados.


## Próxima campanha preparada sem envio (06/11/2026)

Rômulo autorizou corrigir Serviço Fácil, aplicar melhorias de mensagens e seleção e preparar a próxima campanha, sem iniciar novos envios. Serviço Fácil tem recusa contextual com revisar=true por negação truncada; a leitura retira o interesse e preserva mensagem, fonte e incerteza, sem marcar fechamento ou apagar histórico. A regra é contextual, não uma lista nominal permanente.

A abertura E (descoberta-site-v1-20261106) usa fato estruturado e uma pergunta sobre a rotina; não oferece demo na abertura, não afirma perda de clientes nem ausência de site na internet. Ficha sem fato adequado fica adiada. A série E fica fora dos pares A/B/C/D históricos. O Balcão existente foi atualizado apenas no código da abordagem, preservando seu estado ativo e os contatos anteriores; 19 fichas não contatadas receberam a versão E.

O executor exige fonte válida vinculada ao nome e destino, conferência específica do fato e mensagem E. Prioriza falha técnica observada sobre hipótese do perfil, preservando diversidade e três pareceres mínimos de 65; essa ordem é comercial, não probabilidade nem aprendizado estatístico. Mudanças invalidam avaliações anteriores. Fontes reaproveitadas mantêm a data original; a revalidação na data da liberação continua obrigatória.

Preparação: 17 candidatos avaliados, 12 aprovados por três pareceres reais cada, cinco adiados pelos pareceres e um outro confirmado sem WhatsApp. Piloto proposto de dez principais e duas reservas, sem somar reservas à meta. Configuração em config/campanha-site-2026-11-09.preparacao.json; manifesto privado é rascunho separado, não foi instalado como autorização ativa. Nenhuma liberação de nova semana foi presumida.

O executor foi pausado pela rota normal (ativo=false). Rodada atual e cinco pendências preservadas; nenhuma rodada, reserva ou mensagem nova. Mantidos 15/dia compartilhados, dois/hora, 30 minutos, dez pendências, três notas >=65, maturação de 48h e mínimos estatísticos. Antes de liberar: autorização explícita, revisão das pendências e recibos/conversas com inicioAnterior, dados e pareceres frescos, fonte válida, canal e unicidade em todas as ofertas, conta/observador/CRM e gate. Não reativar caçadores; não alterar Silmer.

Validação: 238 testes TypeScript na Mel, dez testes Python de seleção, dois testes de publicação restrita do Balcão, 86 testes TypeScript locais, typecheck e build. Recibos e manifesto da campanha encerrada intactos. Evidência privada: /home/romulo-sutil-corr-a/.cache/mel-work/proxima-campanha-20261109/20261106T220135Z.


## Liberação do piloto de Site para 09/11 às 08h (08/11/2026)

Rômulo pediu neste chat: “prossiga até liberar”. O manifesto campanha-site-ativa.json em ~/.local/share/squadone-operations está ativo exclusivamente para 09/11, sem envio antes das 08h de São Paulo. Onze perfis públicos foram reconferidos; 33 pareceres reais atuais aprovaram nove. BS Construção e Reforma (62) e Sergio Pavão (58) foram adiados por Elisa; José Coelho foi promovido da reserva. Teto do piloto: nove; sem reservas restantes. Não ampliar a coorte para completar cota.

Cinco recibos e seis mensagens foram revisados: quatro silêncios e um encaminhamento sem autoria humana confirmada. Garcia foi conciliado nominalmente pelos hashes exatos das provas, mesma conta/ID/conteúdo/direção e diferença de dois segundos. Originais preservados, sem tolerância global nova. Rodada revisada pela rota normal com inicioAnterior, histórico preservado, e pausa de proteção liberada pela configuração normal após conta conectada.

Higiene e curadoria atualizadas; quatro pesquisas vencidas receberam evidências das consultas públicas reais desta liberação, com backup e sem API paga. Mantidos 15/dia compartilhados, 2/h, 30 min e dez pendências. Reavaliação real da data de execução e hash atual continuam obrigatórios; cache de domingo não vale como parecer de segunda. A revisão das 08h30 só gera relatório. Caçadores e Silmer preservados.

Conferência final: executor e timer ativos, nove na fila com três notas >=65, próximo envio 2026-11-09T08:00:00-03:00; 41 testes aprovados. Nenhuma nova reserva ou mensagem na liberação, recibos e manifesto anterior intactos. Evidência privada: /home/romulo-sutil-corr-a/.cache/mel-work/liberacao-site-20261109/20261109T021731Z.


## Nomes legítimos e aviso de validação comercial (09/11/2026)

Rômulo autorizou corrigir a validação dos nomes, o aviso no painel e retomar os quatro contatos restantes com os limites atuais. O gate aceita o separador de título | e preserva conectivos na sequência de palavras; Franco e Franco não é uma repetição adjacente. Markup, controles, URLs, placeholders, duplicação real e destinatário divergente continuam bloqueados. O nome e a fonte do cadastro não são reescritos.

A API de reserva devolve o motivo legível do gate. Quando as recusas de validação impedem todos os envios tentados, o executor publica estado bloqueado, contagem, motivo e orientação para conferir a mensagem/cadastro; não chama essa rodada de concluída nem inventa previsão de envio. A recusa de um lead ainda permite tentar outro, e a correção é revalidada no ciclo seguinte.

Publicados gate, API e executor após 191 testes na Mel, typecheck e builds; 23 testes locais passaram. Os testes do executor usam autorização, fonte e relógio fictícios, sem ler o manifesto operacional do host. Retomada pela rota normal, sem nova rodada nem ampliação de campanha: 15/dia compartilhados, 2/h, 30 min, dez pendências e nove no piloto. Isolda teve recibo e texto observado em 09/11 às 14h55; os outros três seguem o mesmo ritmo. Originais, recibos anteriores, campanha e início da rodada preservados. Auditoria: /home/romulo-sutil-corr-a/.cache/mel-work/correcao-nomes-20261109/20261109T174650Z.


## Limite diário de primeiros contatos (10/11/2026)

Rômulo autorizou neste chat aumentar de 15 para 20 mensagens por dia. O teto compartilhado de primeiros contatos passa a 20; permanecem dois por hora, intervalo mínimo de 30 minutos, dez pendências por rodada e expediente existente. Não abre nova rodada nem amplia campanhas, recontatos ou critérios. Com fechamento antes das 17h30, cabem no máximo 19 contatos a cada 30 minutos desde as 08h. Publicado após 58 testes, typecheck e build, com confirmação pela API limite=20, intervaloMinutos=30 e porHora=2. Auditoria privada: ~/.cache/mel-work/limite-diario-20-20261110.


## Expediente comercial até 18h (10/11/2026)

Rômulo autorizou neste chat estender o expediente de primeiros contatos para 08h até antes das 18h de São Paulo, de segunda a sexta exceto feriados. Mantidos 20/dia compartilhados, dois/hora, intervalo mínimo de 30 minutos e dez pendências por rodada. Vinte contatos cabem de 08h a 17h30, condicionados à fila, campanhas e proteções existentes. Regra aplicada na Central, textos e calendário do executor. Validação: 98 testes TypeScript e 85 Python, typecheck e build; API confirmou 20/dia, dois/hora e 30 minutos. Fronteiras instaladas verificadas: 17h30 e 17h59 dentro, 18h fora. Auditoria: ~/.cache/mel-work/expediente-18h-20261110.


## Campanha de Site liberada para 10/11/2026

Rômulo autorizou neste chat revisar as oito pendências, preparar e liberar hoje até 20 leads aprovados, mantendo qualidade e 30 minutos. Oito recibos e dez mensagens foram conferidos: seis silêncios e duas entradas sem autoria humana confirmada. A conciliação nominal de Silva & Santos vincula a reentrega Hermes 150 segundos posterior à âncora Evolution anterior; Sandra Regina tem diferença de dois segundos. Mesmos IDs, conteúdo, direção, conta e conjunto exato de provas. Originais e tolerância global preservados; não presume resposta humana nem autoriza responder ou recontatar.

A rodada foi revista pela rota normal com inicioAnterior e histórico preservado. Dos 41 cadastros novos de Site, 29 destinos sem contato anterior tiveram o perfil público reconferido sem API paga; cinco tinham fonte compatível. Quinze pareceres reais atuais aprovaram quatro: Gilson Ienke, BS Construção e Reforma, SL Advogados Associados e Detec Prag. Sergio Pavão foi adiado por Elisa (56); mínima 65 para cada um dos três papéis. Demais casos permanecem adiados/protegidos, sem completar cota com fatos ou identidades divergentes. WhatsApp e gate de texto dos quatro confirmados.

campanha-site-ativa.json está limitado a 10/11/2026, sem envio antes das 08h de São Paulo, com quatro principais, nenhuma reserva e metaContatos=4. O teto compartilhado permanece 20/dia, dois/hora, 30 minutos, expediente até antes das 18h e dez pendências por rodada. A autorização de até 20 não amplia esta lista automaticamente. Executor e timer ativos. Às 07h50, quatro prontos na fila, zero pendências na nova rodada e próximo envio a partir das 08h. Recibos anteriores intactos; nenhum envio/reserva novo na preparação. Trinta e seis testes aprovados. O teste antigo de validade recebeu relógio iso simulado para não depender da data real; regra de produção inalterada.

Auditoria privada: ~/.cache/mel-work/campanha-20261110/20261110T103904Z. Relatório: config/campanha-site-2026-11-10.liberacao.json.

O webhook da Evolution deve incluir `SEND_MESSAGE` além de `MESSAGES_UPSERT`,
`MESSAGES_UPDATE` e `CONNECTION_UPDATE`. O adaptador já suporta esse evento nativo,
com dedupe por recibo e filtro de leads. A captura não pode depender do upsert de
saída. Alterações preservam endereço, header secreto e opções do webhook.



## Foco e captura em 13/11/2026

A orientação atual do Rômulo é oferecer Site/Encontrado e implantação sob medida de fluxos com IA. Integrações, manutenção e Fonte são complementos condicionados à necessidade. Íris é candidato de nicho, sem prospecção geral nesta etapa; estamparia, PDV, escolar, fiscal, anúncios e redes sociais não entram na campanha geral. Detalhamento: docs/referencia/foco-comercial-2026-11-13.md e config/foco-comercial.json. O recorte de descoberta usa empresas de projetos sob orçamento e não presume necessidade ou compra. Continuam retiradas cotas, intervalo, expediente, limite de pendências e pareceres comerciais; destinatário válido, captura técnica pronta, recusas, exclusões, dedupe e recibos permanecem obrigatórios.

As duas capturas ausentes de 13/11 foram recuperadas por originais retornados da sessão autenticada, sem reenvio. Às 16h58, 28/28 envios tinham histórico, prova exata e marco no CRM, inclusive quatro do novo perfil. Gate de 40 testes aprovado no Dell. Há pendência distinta de 22 lotes históricos de classificação: o primeiro conflita em conteúdo com o mesmo ID já concluído; não modificar IDs/hashes para forçar baixa. Ver docs/referencia/captura-envios-2026-11-13.md.


## Conciliação da fila de respostas — 13/11/2026, 18h11

Resolvidos os 22 lotes históricos e quatro entradas posteriores: 26 execuções principais bem-sucedidas, fila de lotes/eventos zerada e 307 registros anteriores da inbox intactos. A divergência vinha de duas transcrições de áudio: conciliar apenas o hash do marcador original já existente na inbox e atestado pela captura da conta, preservando texto derivado para classificar, IDs e horários. Replays antigos não sobrescrevem resposta mais recente. Quatro respostas recentes conferidas na fonte e na Central: três robôs sem resposta humana e uma recusa em Perdido. Nenhum novo envio aos destinos dos lotes durante a conciliação. Gate ampliado: 54 testes aprovados no Dell. Detalhes: docs/referencia/lotes-respostas-2026-11-13.md. Esta atualização encerra a pendência de 22 lotes descrita acima.


## Registros complementares preservados do Dell

As decisões datadas abaixo preservam o histórico. Autorizações de aquisição e cadência conflitantes estão substituídas pela direção de 16/11/2026; contratos, suporte e proteções de captura permanecem nos respectivos escopos.

## Reentrega dirigida de Vs Obras (04/11/2026)

Rômulo autorizou corrigir Vs Obras, revisar as dez pendências, abrir nova rodada e retomar com os limites atuais. O registro nominal de reentrega vincula por hashes exatos a prova Hermes tardia à prova Evolution da mesma mensagem já capturada antes do horário tardio. Mantém IDs, direção, conteúdo, conta e provas originais; não aumenta a tolerância global de dois segundos. Prova nova invalida a revisão. As duas entradas automáticas no mesmo segundo continuam simultâneas: não se fabrica uma ordem nem se envia resposta por esta correção.


## Conferência das 19 conversas de Estamparia (26/10/2026)

A conferência operacional foi concluída por solicitação do Rômulo neste chat.
Quinze das 19 entradas foram comprovadas pela sessão existente; quatro legados
já respondidos só podem aguardar novo retorno, sem fabricar prova nem liberar
transporte pelo histórico. A nova entrada precisa de comprovação normal. Duas
divergências comprovadas de um segundo foram conciliadas com backup e auditoria,
preservando IDs, conteúdo e recibos. Recusas recuperadas suspendem contato.
Saudação automática não equivale a pessoa nem gera qualificação ou encaminhamento.
Uma resposta indevida à saudação da Ultra Placas foi conservada com seu recibo;
o tratamento do bot foi corrigido, sem apagar ou repetir o envio.

O escritório exibe cada responsável e próximo passo. A projeção da tela compartilha
uma leitura; o executor continua conferindo fontes atuais antes de qualquer envio.


## Automação do Encontrado (25/10/2026)

**Terceiro lote autorizado:** proposta padrão versionada e aceite pela Autentique,
com automação das etapas repetíveis e somente decisões reais para Rômulo. A Prumo
prestará o serviço como pessoa jurídica; ainda não há conta Autentique. Preparar o
cadastro privado, modelo concreto e integração antes da ativação. Aprovação única
do padrão vincula os bytes e condições exatos; não presumir aprovados os campos
marcados como sugestão no modelo visual antigo. Dados faltantes do cliente devem
ser solicitados ao próprio cliente, sem fabricar qualificação humana. Convite e
documento criado não comprovam assinatura. Aceite exige consulta autenticada da
versão e dos signatários exatos; nunca assinar pelo cliente ou por Rômulo. Cobrança
continua separada e exige o cliente ver o site funcionando. Preservar condições
individuais, pausas e tomada humana. Não usar clientes reais para testar.

**Segundo lote autorizado:** qualificação automática e preparação dos materiais
solicitados, com intervenção humana somente para decisões reais. O sistema pode
perguntar a lacuna seguinte, interpretar respostas com citações verificadas e
preparar Raio-X/demo especificamente pedidos, reutilizando os geradores e a régua
de qualidade existentes. Leituras automáticas são derivadas da conversa, com
origem e referência; nunca usam `humano:true` nem substituem notas humanas.
Material solicitado tem prioridade sobre completar questionário. Preparar não
comprova envio; material pronto só sai após nova conferência do contexto e do
pacote exato. Preservar pausas, condições individuais, tomada humana e o corte
próprio da nova capacidade. Não criar contato ou geração real para testar.

Rômulo autorizou implementar em ordem a operação automática, começando pelo
Encontrado, com intervenção humana somente nas exceções. Para essa oferta,
respostas padronizadas a novas entradas verificadas podem ser executadas pela
política versionada, sem aprovação por mensagem. Essa autorização substitui o
limite de somente rascunho exclusivamente nas ações homologadas desse caminho.
Preservar condições individuais, recusas, esperas e tomada humana da conversa.
Prospecção continua pausada; eventos anteriores à ativação não autorizam retomada.
Preço e escopo vêm da fonte canônica, nunca de texto livre do modelo. Proposta,
contratação e recebimento exigem suas evidências e integrações próprias; FAQ de
preço não cria nenhum desses fatos. Rômulo autorizou escolher os provedores:
Asaas para cobrança e Autentique para assinatura, inicialmente sem efeitos reais.
Não alterar o escritório para implantar essa automação.

## Fila de respostas conciliada — 13/11/2026, 18h11

Os 22 lotes pendentes e quatro entradas posteriores foram concluídos (26 sucessos), com fila vazia. Dois envelopes de áudio foram conciliados somente com o marcador original comprovado e já registrado na inbox. Transcrições, IDs, horários e os 307 registros anteriores da inbox foram preservados. Replays antigos não substituem resposta mais recente. Três robôs e uma recusa recentes conferidos na fonte e na Central, sem divergências. Nenhum novo envio aos destinos desses lotes durante a conciliação. Gate de 54 testes aprovado. Esta atualização encerra a pendência registrada antes; ver docs/referencia/lotes-respostas-2026-11-13.md.
