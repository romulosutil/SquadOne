# Fase 5 — contrato de aquisição e retomada por oferta

24/10/2026. Entrega técnica delimitada; não registra venda, aprovação de texto novo,
ativação de caçador ou aumento de primeiros contatos. Preserva o escritório e o
atendimento de quem já respondeu.

## O que foi comprovado

`prumo-ofertas.py:cacador()` já é a fábrica comum de Íris e Estamparia. Busca,
normalização, identificação, deduplicação, triagem e persistência usam o mesmo
código, parametrizado por `prumo-ofertas.json`; `triar_js()` injeta a configuração
em `prumo-ofertas-triar.js`. Não foi criada uma segunda fábrica para reduzir
contagem de workflows.

O teste novo acrescenta uma terceira oferta **apenas em memória**, com critérios,
aba, cidade e teto fictícios. A fábrica real gera as três ofertas com o mesmo
template de triagem e roteamento, dedupe contra todas as abas e destinos próprios.
Outro teste executa o JavaScript real sem rede e comprova: ID existente não entra;
ID repetido entre páginas não duplica; WhatsApp de outro funil e unidade com mesmo
contato viram descarte explicável; o prospect novo entra em `Revisar`, com a origem
do contato não confirmado preservada. Nenhuma oferta foi adicionada ao catálogo,
CRM, planilhas ou n8n. Adicionar uma oferta real ainda exige integração de catálogo,
aba, leitor CRM, material, critérios e aprovação comercial.

`prospeccao_contrato.py` é um auditor puro de fronteiras: verifica componentes e
operações declarados, inclusive dentro de subworkflows. Não executa aquisição,
não substitui o código dos adaptadores e não certifica seu comportamento completo
apenas pela presença de nós. Seu resultado nunca autoriza ativação.

Os três contratos também foram conferidos em memória contra os exports privados
do baseline `fase5-atual` do Dell. Íris e Estamparia estavam inativos; o Caçador
Site 01 estava ativo. A auditoria não mudou esses estados. Não se deve afirmar que
todos os caçadores estão pausados.

## Contrato comum e adaptadores

| Fronteira | Íris / Estamparia | Site legado |
|---|---|---|
| Busca | Nicho × cidade configurados; busca menos recentemente usada; Google Places, até três páginas de 20 | Aba Buscas e `Escolher a busca`; preferência de verticais e última rodada mantidas |
| Normalização | `Triar e checar sites`, template compartilhado | `Normalizar campos`, regras existentes |
| Identificação e dedupe | ID do Places e chave legada de WhatsApp (DDD + últimos oito); todas as ofertas, Descartados, Prospects e Site | `Não está na planilha`, sobre `Ler leads existentes`; não presumir dedupe entre todos os funis |
| Critérios | Segmento, exclusões, perfil, sinais, público, regiões e teto por oferta | Raio, telefone, avaliações, rede/franquia, Portão, site no ar, pontuação; preservados |
| Persistência | Aba da oferta ou Descartados com motivo e campos de resgate | Leads/descartados e pacotes `content.md`/foto para a esteira existente |
| Confirmação comercial | Prospect encontrado não é contato, clique não é envio, classificação não é venda | Mesma fronteira; recibos de material não são proposta aceita ou pagamento |

O Site permanece `geracaoCompleta=false` no contrato. Sua fábrica integral não
está reconstruída em fonte a partir deste trabalho: os scripts existentes editam
o workflow preservado. `site-antes-da-venda.py` não deve receber export antigo para
recriá-lo. `site-cacador-escolha.py` ajusta escolha; `site-cacador-site-no-ar.py`
aplica a verificação de site; `site-nichos.py` hoje sincroniza a lista de artigos
gramaticais, e não executa novamente a antiga migração de nichos.

Nenhum adaptador pode converter indisponibilidade de fonte em “não existe lead”.
O contrato registra dois riscos reais antes de ampliar aquisição:

1. Íris/Estamparia toleram falha de algumas leituras externas usadas no dedupe;
   a triagem também captura falha de acesso ao nó e usa lista vazia. A leitura da
   própria oferta é mais restrita. Falta política única de completude antes de
   qualquer nova gravação.
2. Os três adaptadores têm persistência com `retryOnFail`. Dedupe anterior não
   torna append idempotente após timeout ambíguo. Antes de aumentar volume é preciso
   recibo durável/checagem por ID, sem repetir append às cegas e sem apagar o acervo.

Esses riscos foram expostos, não corrigidos disfarçadamente numa extração de
fábrica. A correção futura precisa de baseline, testes de falha e lote próprio.

## Feedback: fonte e decisão

A Central continua fonte comercial. Não se criou outro arquivo de contatos,
parser paralelo de notas ou base de aprendizado de agentes. Usar os fatos já
projetados da aba CRM, com identidade da oferta e da conversa verificadas:

| Evidência existente | Uso permitido na revisão | Inferência proibida |
|---|---|---|
| Qualificação humana da oferta exata | Conferir público, necessidade, decisor e próximo passo | Tratar permissão para receber material como intenção de comprar |
| Proposta/ciclo comercial versionado | Separar proposta enviada, aceite, cobrança e recebimento | Contar rascunho, clique ou ganho verbal como venda paga |
| Perda/recusa explicitamente registrada | Preservar motivo literal e testar hipótese com outro lead | Transformar silêncio em objeção de preço ou rejeição do nicho |
| `[aprendizado-v1]` humano | Fato → hipótese → teste → resultado; pausa até nova entrada, quando registrada | Modelo aprovar a própria hipótese ou nova saída destravar pausa |
| `[revisao-retomada-v1]` humano | Revisar contexto e condição de espera, sem alterar etapa | Uma análise antiga autorizar contato depois de mudança no contexto |

O ciclo de revisão é: ler Central atual → agrupar por oferta/busca/variante com
denominador e período claros → separar resposta automática, licença, interesse,
qualificação, proposta, aceite e pagamento → conferir perdas literais → propor
uma alteração de configuração → Rômulo aprovar → homologar em dados sintéticos e
comparar o workflow antes/depois. A aprovação de um teste não reativa aquisição.

Não há amostra mínima de resultado comercial nova aprovada nesta fase. Sem
quantidade suficiente ou vínculo inequívoco entre busca, oferta e resultado,
registrar “inconclusivo”; não ajustar automaticamente o ranking. Preservar as
preferências e critérios existentes até decisão específica.

### Lacuna conhecida do Funil 06

`site-funil-regra.js:propostasAbertas()` reconhece os tipos legados `proposta` e
`proposta_desfeita`. O sinal de compra mantém `licenca` por compatibilidade
histórica e pode usar texto de preço. Isso não equivale à qualificação atual, ao
ciclo comercial versionado ou ao responsável `[responsavel-conversa-v2]` da Central. A seleção e
pausa legadas do 06 não foram reescritas e não devem ser apresentadas como
aprendizado comercial consolidado. Foi aprovada a proteção mínima: acrescentar
06 à guarda operacional já usada por 05 e desativá-lo reversivelmente, preservando
o workflow, execuções, a aba Buscas e o arquivo `site-funil.json`. A preparação
desta mudança não comprova sua instalação; o root registra a conferência real.

A auditoria do export encontrou 06 ativo, agendado para segunda-feira às 08h.
Seus efeitos são update de `ativa`, `pausada_em` e `pausa_motivo` em Buscas,
gravação do retrato e aviso; o campo `nao_gerar` do retrato restringe a fila do
gerador/Raio-X. O retrato existente, gerado em 19/10/2026 às 11:00:49Z, tinha
136 buscas, cinco pausadas naquela execução e **zero IDs em `nao_gerar`**.
Congelar 06 preserva esses dados: não limpa bloqueios, não religa buscas e não
gera material. O caminho explícito de demo pedida no gerador já é separado da
fila comum filtrada por `nao_gerar`; não foi alterado.

Com a pausa confirmada e sem execução 06 em curso, o parser legado deixa de
emitir novas pausas/restrições e de tratar licença como intenção em decisões
operacionais. A Central continua responsável por ciclo, dono, espera e fila.
Religar 06 exige um contrato completo de projeção da Central ou migração
validada, com licença separada de intenção. O leitor atual limitado a 20
oportunidades não pode ser usado como lista completa de proteção do funil.

## Mensagens por oferta e etapa

“Existente” abaixo significa texto já versionado e usado pelo mecanismo atual,
com suas condições. Não é aprovação geral para envio. Preços e condições vêm da
proposta exata e do catálogo; não se copiam condições de uma oferta para outra.

| Oferta / etapa | Fonte existente | Condição de uso |
|---|---|---|
| Íris — apresentação | `prumo-ofertas.json:ofertas.iris.mensagem` e `server/convite-mensagem.ts` | Pedir quem coordena; não solicitar dados de pacientes |
| Estamparia — apresentação | `prumo-ofertas.json:ofertas.estampa.mensagem` e `server/convite-mensagem.ts` | Pedir responsável; não dizer que o produto já foi validado em cliente |
| Site — apresentação | `site-mensagem.js` variantes elegíveis, espelho testado em `server/site-mensagem.ts` | Cada afirmação precisa do material/fato correspondente; conservar variante já enviada |
| Prumo — apresentação | `prumo-simples.py` e `server/convite-mensagem.ts` | Apresentação e uma pergunta; material somente no passo apropriado |
| Plus — apresentação/retomada | `server/plus-mensagem.ts`, por oferta | Somente origem Plus real; não reutilizar saudação/origem em contato comum |
| Site — demonstração/retomada | `SEGUNDA` / `FOLLOWUP` em `site-mensagem.js` e espelho TS | Link e material reais; condições do Encontrado somente quando essa for a oferta combinada |
| Prumo — material/retomada | `SEGUNDA_PRUMO` / `FOLLOWUP_PRUMO` em `server/prumo-mensagem.ts` | Raio-X registrado e disponível; não afirmar produção inexistente |
| Todas — passagem/proposta | Ciclo comercial e procedimento atual da Central | Rômulo assume negociação; documento/versão, valores, recorrência, prazo e condições explícitos |

Para descoberta, demonstração específica de Íris/Estamparia e passagem não há
catálogo integral novo aprovado nesta entrega. Os textos abaixo são **candidatos
para revisão humana**, sem instalação em agente, geração de link ou envio:

| Oferta / etapa | Candidato a revisar |
|---|---|
| Íris — descoberta | Como vocês reúnem hoje as anotações das sessões para preparar a reavaliação? |
| Íris — demonstração | Posso mostrar o fluxo do dossiê com um caso fictício para vocês avaliarem? |
| Estamparia — descoberta | Como vocês juntam arte, tamanhos e prazo quando um pedido chega pelo WhatsApp? |
| Estamparia — demonstração | Posso mostrar uma ficha de pedido com dados fictícios para vocês avaliarem? |
| Site — descoberta | Quando alguém encontra vocês no Google, qual é o próximo passo para pedir um orçamento? |
| Prumo — descoberta | Qual decisão do dia a dia ainda precisa passar por você antes de a equipe agir? |
| Todas — passagem | Vou alinhar esse ponto com o Rômulo. Qual horário funciona para continuarem a conversa? |
| Todas — proposta | Sobre a proposta {REFERÊNCIA_E_VERSÃO_CONFIRMADAS}, ficou alguma dúvida sobre o escopo ou as condições? |
| Todas — retomada | Sobre {COMBINADO_CONFIRMADO}, ficou alguma dúvida para decidirmos o próximo passo? |

Só usar a demonstração se o material estiver pronto e validado; só oferecer
horário disponível; só mencionar proposta enviada se houver confirmação na
fonte. Substituir marcadores com fatos atuais e revisar o gate de mensagem.
Campos desconhecidos permanecem desconhecidos. Estamparia não recebe preço
inventado; mensalidade de site não combinada não vira zero. Ofertar apenas
tráfego a lead da lista Site continua legítimo, sem assumir contratação do site.

## Retomada e capacidade antes de ampliar

A cadência é da Central (`cadencia.ts`, `retomadas.ts`, revisão de retomadas,
responsável da conversa e ciclo comercial). Não há sequenciador novo no n8n.
Conservar limites, pausas, horário e ritmo atuais. O teto de 40 avisos internos
do vendedor não é capacidade de vendas nem limite de mensagens ao cliente.

No piloto, cada retomada exige conferir a conversa atual e a condição que a
justifica. Recusa/exclusão, pausa humana, compromisso futuro, proposta em análise,
nova entrada aguardando atendimento ou responsável humano interrompem uma
sequência incompatível. As etapas finitas da cadência existente não autorizam
reiniciá-la indefinidamente por uma nova nota ou nova passagem de agente.
Ausência de limite total consolidado e comprovado para todo o histórico é
bloqueio para retomada autônoma em massa; não se resolve inventando um número.

Checklist por oferta, a registrar antes de uma decisão de aumento:

- [ ] Quem atende a próxima resposta humana e qual sua disponibilidade real.
- [ ] Fila de respostas sem dono e idade da mais antiga conferidas na fonte atual.
- [ ] Tempo útil observado entre entrada, aviso e atendimento; não apenas execução verde.
- [ ] Quantidade de revisões e negociações que Rômulo consegue concluir na janela disponível.
- [ ] Material/demonstração disponível, escopo de entrega e capacidade de implantação/suporte.
- [ ] Contato e identidade verificáveis; dedupe completo, falha fechada e recibos de persistência.
- [ ] Horário, teto e ritmo atuais preservados; nenhum outro agente concorrendo pela mesma conversa.
- [ ] Pausas, recusa, compromisso futuro, responsável humano e análise de proposta bloqueiam sequências incompatíveis.
- [ ] Feedback tem oferta/busca/variante e fato confirmados; silêncio isolado não alterou o público.
- [ ] Texto e condições aprovados para a oferta e etapa; não usar sugestão como aprovação.
- [ ] Plano de reversão preserva dados novos, conversas, propostas e condições já ofertadas.
- [ ] Aprovação específica para reativar o caçador ou aumentar volume, independente deste documento.

Não há comprovação nova de capacidade, contratação ou pagamento nesta entrega.
O fechamento comercial real continua um marco de negócio; a preparação técnica
e a documentação não o substituem.

## Validação e reversão

Cinco testes novos em `prospeccao_contrato.test.py`, sem rede/modelo/execução de
workflow, mais auditoria estrutural somente leitura dos três exports privados.
Os testes usam configuração e contatos inteiramente fictícios, sem snapshots de
produção. Nenhum gerador runtime existente mudou; retirar o auditor/testes/doc
reverte esta entrega sem tocar aquisição ou histórico.


## Atualização de 24/10 — proteção local da captura

O patch local acrescenta três proteções, sem ativar caçadores ou modificar critérios:

- Leituras usadas no dedupe falham fechado; falha ao consultar uma fonte interrompe a triagem antes de produzir gravações.
- Íris/Estamparia passam a usar `appendOrUpdate` pela coluna `ID`, com repetição automática desligada. O contrato auditor exige essa chave e recusa configuração diferente.
- O Site continua no workflow e adaptador legados. O preparador normal do workflow aplica leitura estrita e `appendOrUpdate` por `place_id` aos dois destinos de planilha; raio, telefone, avaliações, franquia, Portão, site e pontuação permanecem intactos.

A operação de upsert do Google Sheets não fornece unicidade atômica entre duas execuções concorrentes. A proteção reduz repetição sequencial e falha de fonte, mas não prova exclusão mútua. O risco de concorrência permanece e impede qualquer expansão até existir um único escritor comprovado ou uma proteção durável equivalente.

Validação local offline: seis testes de `prospeccao_contrato.test.py` e 17 testes de `workflow_confiabilidade.test.py` aprovados. O segundo usa o export sanitizado do Site, preserva critérios e estado ativo, e verifica que a transformação é idempotente. Não foi possível publicar ou conferir o estado atual da produção: a tentativa SSH por `mel` não resolveu o hostname. Nenhuma execução n8n, planilha, cliente ou caçador foi acionado nesta atualização.

## Publicação conferida no Dell — 24/10/2026, 22h BRT

As proteções locais da seção anterior foram publicadas nos três workflows e verificadas por releitura da API. Snapshot e plano aplicado em `~/.cache/mel-work/retomada-acesso-20261024/`, privados no Dell. Mantidos 21 workflows/16 ativos; estados individuais e critérios por oferta preservados, sem execução manual. O risco residual de concorrência do Sheets permanece explícito e impede tratar o upsert como garantia de unicidade concorrente. A frente comercial continua pausada; não houve expansão. Ver evidências, correção LID/SOS, limites e reversão no registro de encerramento técnico.
