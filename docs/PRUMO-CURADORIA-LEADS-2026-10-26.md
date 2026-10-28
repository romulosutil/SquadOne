# Curadoria de leads e Marina — 26/10/2026

Pedido de Rômulo: analisar todos os leads contatados hoje, encontrar padrões,
ajustar a lista atual e criar um agente que refine diariamente a seleção.
Posteriormente autorizou os textos de alinhamento de Diego, Elisa e Prospecção
e deu autonomia para criar ou arquivar agentes conforme a utilidade do papel.

## Cobertura e resultados observados

Fonte: CRM vivo do Dell, conversas capturadas pelo observador, recibos do
executor e memória de primeiros contatos. A revisão das 19h21 de São Paulo
leu 3.527 leads, com retrato comercial das 19h20. Os 11 leads com primeiro
contato registrado hoje também são os 11 com saída observada hoje na base.
São seis de Site, três de Estamparia e dois de Iris. Duas verificações de
destino sem WhatsApp ficam separadas: não houve envio a esses números.

| Lead | Oferta | Resultado observado | Direção da curadoria |
|---|---|---|---|
| Pereira Advocacia | Site | Recusa explícita, seguida de agradecimento | Preservar recusa; o resumo neutro não libera nova abordagem |
| Protea Neurodesenvolvimento | Iris | Recusa: já possui sistema próprio | Respeitar recusa; perfil aderente não prova necessidade de trocar |
| JC Desinsetizadora | Site | Encaminhamento ao responsável por divulgação; já tem acompanhamento no Google | Acesso não confirma interesse; validar lacuna e responsável na conversa existente |
| Stamp Fast Estamparia | Estamparia | Permissão para falar por ali | Acesso não confirma dor, impacto ou compra; qualificar na conversa existente |
| Minha Kamiseta | Estamparia | Somente resposta automática | Aguardar evidência humana; não considerar sucesso ou fracasso |
| CJS Dedetizadora e Desentupidora | Site | Somente resposta automática | Aguardar evidência humana |
| ALPHAKILL Dedetizadora Controle de Pragas | Site | Somente resposta automática | Aguardar evidência humana |
| Artbrilho Serigrafia e Sublimação | Estamparia | Sem retorno observado | Inconclusivo; não inferir motivo ou repetir contato |
| Clínica Albanos — Terapia ABA | Iris | Sem retorno observado | Inconclusivo |
| Esparta Dedetizadora | Site | Sem retorno observado | Inconclusivo |
| USLT-DEDETIZAÇÃO | Site | Sem retorno observado | Inconclusivo |

Resumo: duas recusas, dois acessos/encaminhamentos, três robôs e quatro sem
retorno. Nenhuma qualificação confirmada, proposta ou pagamento foi encontrado
nesse grupo. BêAbá Comportamental e Ser Humano Clínica da Aprendizagem foram
verificações sem WhatsApp, fora dos 11 envios.

## Padrões e decisões

1. **Resposta não equivale a oportunidade.** Recepção, robô e acesso ao
   responsável não confirmam interesse. A curadoria mantém essas classes
   distintas, inclusive quando a última mensagem é um agradecimento.
2. **Aderência não comprova dor.** A Protea corresponde ao público do Iris,
   mas informou ter solução própria. Isso protege esse contato; não justifica
   excluir todas as clínicas ou penalizar um nicho inteiro.
3. **O canal comercial pode receber a abordagem como atendimento a cliente.**
   Os três robôs responderam com fluxo de orçamento/atendimento. É observação
   de canal, sem prova de necessidade, leitura humana ou baixo valor do lead.
4. **Mensagem precisa corresponder à evidência.** Há candidatos com mensagem
   afirmando demo pronta e sem evidência da demo na ficha. Eles aguardam revisão
   do texto. Continuam aceitos candidatos que oferecem preparar a demo sob
   demanda; não se criou exigência de demo anterior ao contato.
5. **Silêncio do mesmo dia é inconclusivo.** Nenhum dos 11 completou 48h.
   Notas, posição no Google e respostas não medem disposição de pagar.

Na primeira revisão, entre os leads novos da base, apareceram 102 casos sem
achado estruturado de site, 110 com afirmação de demo pronta sem evidência,
144 sem evidência infantil/TEA, 723 Estamparias sem qualificação confirmada e
oito destinos com registro confirmado de ausência de WhatsApp. Esses motivos
podem se sobrepor e incluem casos já inelegíveis pelas regras anteriores;
não são a quantidade retirada da fila de 100 nem exclusões do CRM.

## Aprendizado e responsabilidade

Marina, id `marina`, foi criada pelo fluxo oficial de contratação como
**Curadora de leads**, integrante de `prumo--prospeccao`. Diego mantém perfil
e prospecção; Elisa, entrega e evidência; Carla, atendimento. Os treinos de
Diego e Elisa e o escopo de Prospecção foram alinhados pelos endpoints oficiais
de edição após aprovação explícita de Rômulo. Nenhum papel foi arquivado nesta
rodada porque as responsabilidades continuam complementares.

A rotina `curadoria-leads.timer` roda todos os dias às **07h20 e 18h40 de
São Paulo**, com recuperação de execução perdida. Lê a fonte recente, preserva
atributos públicos observados, recalcula resultados e grava modelo e relatório
privados. Falha de leitura não renova o modelo antigo.

A primeira revisão encontrou **351 contatos maduros**, dos quais **33** têm
rótulo explícito de avanço confirmado ou recusa para a comparação. Ainda não
há padrão com evidência suficiente para alterar a prioridade por perfil.

O aprendizado usa janela de 90 dias e contatos com pelo menos 48h. Compara
perfis da mesma oferta, exige dez rótulos no grupo e dez no restante e só aplica
ajuste quando os intervalos de confiança de 95% não se sobrepõem. Ajuste máximo
de cinco pontos, somente na ordenação dos já aprovados; nunca veto por setor.
Qualificação, proposta e pagamento continuam contagens distintas. Silêncio,
robô, acesso, curiosidade e interesse sem qualificação não rotulam fracasso.
Duplicatas e atribuições ambíguas entre ofertas não alimentam a comparação.
É aprendizado operacional descritivo, sem alegação causal ou probabilidade de venda.

O executor consulta a régua recente, inclui seu hash no cache dos pareceres e
revalida o lead antes do envio. Modelo ausente, inválido ou com mais de 30h
interrompe novos contatos. Site segue principal, Estamparia segue dirigida e
as três aprovações mínimas de 65 continuam obrigatórias. Reservas, recusas,
tomada humana, pausas, ritmo e caçadores pausados foram preservados.

A ferramenta **`ler_filtro_leads`** permite conversar com Marina sobre o resumo
e os critérios atuais. Só expõe agregados permitidos; não transfere a memória
privada, telefones, valores ou conteúdo bruto de conversas ao modelo.

## Implantação e validação

Instalado no Dell com comparação das fontes atuais, trava compartilhada do
executor, backup e retorno em falha. O bundle do servidor foi compilado sobre
a versão atual da produção, conservando os assets do escritório. Configuração
comercial e os 104 registros de contato existentes foram preservados. Não houve
envio de teste. A fila ainda não enviada foi invalidada para nova avaliação;
recibos permanecem nos registros originais.

A consulta completa do CRM estava ultrapassando o timeout de 25s do executor
anterior, inclusive antes desta alteração. Seu prazo de leitura passou a 90s,
com a mesma validação de atualidade do retrato e as mesmas revalidações de envio.

Na conferência das 19h26, a nova régua já tinha avaliado 40 candidatos e
publicado 26 aprovados (13 de Site e 13 de Iris), com justificativa da Marina
e versão `marina-curadoria-v1-20261026`. A fila prepara o expediente de 27/10;
os próximos lotes continuam pelo serviço existente. Central, timer comercial
e timer da curadoria estavam ativos. A falta de demo pronta não impediu a
seleção dos Sites cuja mensagem respeita a entrega sob demanda.

Parecer de modelo fora do contrato adia somente o lote correspondente e nunca
o aprova. Os lotes anteriormente aprovados permanecem disponíveis; o serviço
conserva o orçamento de inferência e tenta a avaliação pendente em outra rodada.

Validação: **63 testes Python** (curadoria, persistência, integração, estratégia,
responsável, qualidade e abertura) e **46 testes TypeScript** do Assistente e da
leitura agregada passaram no Linux. Typecheck local passou. O bundle do servidor
de produção compilou. O typecheck do checkout do Dell já apresentava uma
incompatibilidade de `AtendimentoComercial`/`ContextoEntradaEstamparia`, confirmada
também sem o delta. A suíte legada `frente-comercial.test.py` também tem falhas
anteriores relacionadas a políticas/mocks antigos; isso não foi apresentado
como validação aprovada. O build completo local de frontend depende de
`VITE_GOOGLE_CLIENT_ID`, ausente neste ambiente; não foi necessário publicar
novo frontend para este ajuste.

Evidências locais em `output/filtro-leads-20261026/`. No Dell:
`~/.cache/mel-work/filtro-leads-20261026/`, com backup de implantação em
`backup-20261026T222103Z/`, e histórico operacional em
`~/.local/share/curadoria-leads/historico/2026-10-26.json`.
