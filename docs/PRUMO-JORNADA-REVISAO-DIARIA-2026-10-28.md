# Jornada diária de melhoria comercial

Pedido de Rômulo em 28/10/2026: repetir a análise do dia anterior, melhorar mensagens e qualidade dos leads e depois iniciar novos envios.

Todos os dias às 08h30 de São Paulo, um acompanhamento neste chat executa a jornada na Mel. A execução depende deste ambiente Codex disponível; o timer de envio na Mel continua independente. O roteiro fica neste documento e o coletor em `deploy/dell/revisao-comercial-diaria.py`.

1. Conferir Central, conta, pausas, recibos e rodada. Falhas não viram silêncio do lead.
2. Executar `python3 ~/.local/bin/revisao-comercial-diaria`, que lê o dia anterior no fuso de São Paulo. Cruzar registros de envio, marcos do CRM e conversas completas do observador. A análise cobre primeiros contatos e atividade nas conversas existentes.
3. Carla revisa texto efetivamente enviado, pergunta anterior, resposta contextual e versão. Separar silêncio, robô, acesso, permissão, interesse, recusa e avanço confirmado. Uma atualização do texto não reescreve o histórico.
4. Elisa revisa material autorizado, tempo até o link e pendências de entrega. Trinta minutos é um limiar de diagnóstico, não SLA prometido. Um link observado não comprova qualidade ou aceite da entrega.
5. Diego confere evidência pública específica, destino e diversidade entre candidatos aprovados. Marina executa novamente a curadoria existente com resultados maduros. Preservar três notas mínimas de 65, maturação de 48h, comparação por oferta, amostra mínima e ausência de ajuste quando insuficiente.
6. Produzir melhorias com evidência, responsável, hipótese, teste e resultado a observar. Aplicar correções demonstráveis dentro da autorização; mudanças experimentais de copy ficam versionadas e validadas antes de publicar. Não declarar vencedor com dados de um dia, permissão ou taxa de resposta.
7. Conferir fila e iniciar/acompanhar o executor se a rodada e demais proteções permitirem. O relatório não reserva, não envia e não reinicia rodada. Dez pendentes continuam exigindo revisão humana explícita com motivo; avisar quando essa decisão for necessária.
8. Guardar relatório e evidência privada em `~/.local/share/revisao-comercial-diaria/historico/AAAA-MM-DD.json`; `ultima.json` tem somente o resumo. Conversas não entram no journal. Avisar apenas melhoria aplicada, conclusão relevante, falha ou decisão necessária.

## Primeira revisão: 27/10

Dez primeiros contatos confirmados com recibo: uma permissão para material, três robôs e seis silêncios. Oito dedetizadoras e dois escritórios de advocacia. Houve mudança de texto durante o dia; não são grupos comparáveis. Não há base para favorecer advocacia nem excluir dedetizadoras.

O material autorizado por Bruno foi entregue aproximadamente 259 minutos depois da permissão. Melhoria operacional: conferir entrega e pendências antes de ampliar a fila. Não usar esse único caso para impor promessa de entrega.

O bloqueio das 10h10 de 28/10 era da rodada acumulada, não do timer. A curadoria da manhã também falhou por indisponibilidade da Central ao iniciar; o serviço recebe dependência de início da Central e novas tentativas a cada dois minutos, limitadas a dez em trinta minutos.

Para a retomada de hoje, a revisão e o início de novos envios foram expressamente solicitados por Rômulo neste chat. Preservar limite de 15/dia, 2/hora, intervalo de 30 minutos e dez pendentes por rodada, pausas e recusas. A autorização de hoje não cria reinício automático diário da rodada.

## Instalação e retomada conferidas

- Acompanhamento `revisar-mensagens-e-qualidade-dos-leads` ativo neste chat, diariamente às 08h30. O roteiro contém análise, melhorias com evidência, testes, publicação dentro das autorizações e acompanhamento da fila.
- Cinco testes do coletor aprovados na Mel: fuso, permissão distinta de venda, robô, cobertura/atualidade e entrega pendente. O Python local do Windows não tem a base `tzdata`; a validação foi executada no Linux de destino, que tem a base de fusos.
- Coletor instalado em `~/.local/bin/revisao-comercial-diaria`; primeira execução completa às 10h16. Backup de configuração em `~/.cache/mel-work/revisao-comercial-20261028/`.
- Curadoria atualizada às 10h16 de 28/10: 35 casos rotulados e nenhum padrão estatístico ativo. Serviço conferido com `Restart=on-failure`, nova tentativa em dois minutos e resultado de sucesso.
- A rodada anterior incluía nove envios ainda sem resposta humana e uma reserva da Bio Defesa sem saída nem recibo observados. Não contar essa reserva como mensagem enviada ou lead que ignorou.
- Nova rodada iniciada às 10h18min30s com a autorização deste chat. Primeiro envio para Luiz Antônio — Advocacia confirmado às 10h18min38s por recibo e mensagem observada. Próximo envio possível às 10h48min38s, sujeito às proteções.
- Backup e prova do envio em `~/.local/share/squadone-operations/auditoria-retomada-20261028/`. Nenhum texto histórico, funil, preço ou caçador foi alterado nesta instalação.


## Revisão de 30/10 executada em 31/10

21 conversas revisadas; 18 primeiros contatos com recibo, nove Site e nove Íris. Resultado atual dos primeiros: dez silêncios, cinco robôs, duas recusas e um acesso/encaminhamento. A Ensinergia tem entrada sem saída posterior; conferir o contexto e conduzir humanamente, sem presumir autorização para material. Nenhuma nova permissão para link ou atraso dessa coorte.

A política de 30/10 teve exceção datada de 25/dia, seis/h e dez minutos, registrada no código operacional após decisão de Rômulo. Não comparar essa cadência e ofertas diferentes como teste de copy. A exceção expirou: conferidos hoje 15/dia, dois/h e 30 minutos. A revisão humana registrada às 14h49 de 30/10 abriu a rodada atual; ela tem nove pendentes, sem bloqueio.

Central, WhatsApp e adaptadores saudáveis. Sábado fora do expediente, sem primeiros contatos; próximo expediente configurado para 02/11 às 08h. Curadoria atualizada sem padrão estatístico ativo. Não há evidência suficiente para novo texto ou ajuste de peso por setor. Relatório privado e testes propostos por responsável guardados em `~/.local/share/revisao-comercial-diaria/revisoes/`. Nenhum envio ou reinício de rodada foi acionado pela revisão.
