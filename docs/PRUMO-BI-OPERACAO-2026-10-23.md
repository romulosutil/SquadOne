# BI da operação Prumo — 23/10/2026

## Diagnóstico com fonte e data

Consulta da produção às 12h44 de São Paulo; retrato das planilhas gerado às 12h40.
3.523 leads cadastrados, 348 com primeiro envio registrado. As classes atuais
somam esses 348: 208 sem resposta, 71 robô, 30 recusas, 20 neutras, 6 permissões,
6 acessos/encaminhamentos, 5 pendências, 1 curiosidade e 1 pedido de conversa.
Nenhum está atualmente classificado como interesse comercial explícito. Isso não
apaga sinais históricos e não comprova que nunca houve interesse.

238/348 não têm conversa preservada nesta fonte (68,4%). Há 61 indicações humanas,
incluindo recepção e recusas, 2 propostas registradas, nenhuma qualificação SPICED
confirmada e nenhum ganho/pagamento confirmado no recorte. Ausência de registro
não comprova ausência do acontecimento fora das integrações.

Entre contatos com pelo menos 48 h de observação, a indicação humana acumulada é
31/224 no Site, 5/59 em Serviços Prumo, 11/28 em Estamparia e 8/24 em Iris. Plus:
2/2, amostra insuficiente. Datas, públicos, cobertura e textos variam; não atribuir
a diferença à mensagem ou declarar um público vencedor. Isto não mede resposta
dentro de 48 h; exige históricos de primeira resposta para fazê-lo.

## O que as escolhas dos agentes permitem concluir

A frente atual informa 325 avaliados e 100 selecionados, dos quais 5 enviados.
26 das 100 escolhas têm nota >=70 e justificativa que declara lacuna. Esse é um
alerta literal para revisão, não prova de erro da nota. As outras dimensões da
avaliação continuam disponíveis ao abrir cada escolha.

95 escolhas não têm envio; as outras 5 ainda têm menos de 48 h. Essa fila atual
não oferece amostra madura para validar a capacidade preditiva do score. Não
tratar nota 80 como 80% de chance de venda. A autoria de cada saída da conta
compartilhada também não está demonstrada apenas pelo texto selecionado.

O problema prioritário é medir e conduzir o acesso ao responsável, transformar
permissão em descoberta e manter compromissos explícitos. Os relatórios de 19 e
22/10 já documentam canal errado, apresentação após robô, permissão confundida com
interesse e retomadas sem compromisso. O BI torna esses casos investigáveis.

## Ajuste de operação

1. Resolver contexto ausente ou revisão vencida, com ação interna explícita;
   aguardar quando houver pausa, recusa, resposta já enviada ou condição futura.
2. Diego confere aderência e destino. Elisa verifica evidência e material. Carla
   confere a pergunta e a abordagem. As justificativas ficam visíveis por escolha.
3. O Rômulo conduz as respostas: confirmar quem decide, uma necessidade concreta
   e o próximo compromisso. Usar SPICED já existente antes de nova proposta.
4. Comparar uma variável por teste; distinguir resposta humana, acesso, permissão,
   qualificação, proposta e pagamento. Silêncio não diagnostica preço ou público.

## Regra escolhida pelo Rômulo nesta conversa

Até 15 primeiros contatos por dia, no máximo 2/h e 30 minutos de intervalo.
Até 10 contatos sem resposta humana, acumulados desde o início de uma rodada
explicitamente revisada. Ao atingir 10, parar novas aberturas. Não zerar por
prazo, meia-noite, reinício ou classificação de perda automática. Reserva incerta
permanece ocupada. Resposta humana posterior libera vaga; uma revisão humana com
motivo inicia outra rodada e conserva a contagem anterior na auditoria.

Silêncios anteriores à nova rodada continuam no BI e não entram retroativamente
nas dez vagas. O teto por pendências substitui a antiga pausa proporcional de
80% de silêncio entre cinco contatos maduros. Proteções da conta e demais gates
permanecem. Revisar a rodada não reativa uma conta restrita nem remove uma pausa.

A documentação oficial consultada não publica regra de 10/15 sem resposta como
limite seguro. São escolhas internas de capacidade e aprendizado. Referências:
[Política de mensagens](https://business.whatsapp.com/policy) e
[controles e feedback de mensagens comerciais](https://about.fb.com/news/2025/04/ways-to-manage-your-businesses-chats-on-whatsapp/).

## Entrega

`/crm?ver=bi`: ações e gargalos investigáveis, classes e marcos separados, recortes
por oferta/nicho/mensagem, sequências após robô e escolhas dos agentes ligadas
às evidências e ao resultado observado. A fila apresenta uma ação, responsável,
prazo/condição e resultado esperado. Não gera nem envia mensagens ao contato.

Artefatos de apuração e validação estão em `output/bi-operacao-2026-10-23/`.
São arquivos locais de trabalho, não mídia pública.

## Publicação e preservação verificadas

Publicado no Dell em 23/10/2026 às 15h12 de São Paulo, após autorização explícita
do Rômulo, com a condição de preservar funil e escritório. O recibo
`output/bi-operacao-2026-10-23/publicacao.json` registra 29 arquivos publicados,
3.753 testes aprovados, tipos e build aprovados e 82 testes do executor aprovados.

A implantação partiu das fontes existentes no Dell e guardou cópias anteriores.
Foram conferidos os mesmos 3.523 contatos, todos os registros humanos anteriores,
a equipe do escritório e as fontes fora do escopo. A navegação em produção entre
fila de ações, BI, funil e escritório foi conferida visualmente; as capturas estão
na pasta de validação. Nenhum histórico foi reiniciado para implantar o BI.

A rodada começou às 15h12, com teto de 15/dia, 2/h e intervalo de 30 minutos.
Na conferência após o próximo ciclo, o serviço e o timer estavam ativos, a frente
estava pronta e havia uma vaga reservada de dez, sem pausa automática. Reserva
não comprova envio. O estado pausado do recibo inicial era o retrato do executor
anterior ao próximo ciclo; a conferência posterior consta em `validacao.json`.
