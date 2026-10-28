# Decisões comerciais de 28/10/2026 (PM com autoridade delegada)

Em 28/10/2026 o Rômulo aprovou as dez prioridades do primeiro dia de um especialista de CRM. Os itens que dependiam
dele foram decididos por um PM com autoridade delegada ("Todos os itens que dependem de mim, decida com um Product
Manager"). Este arquivo registra o que foi decidido. A versão completa, com os textos, está no `pm-decisoes.json` da sessão.
Contexto: zero ganho em todas as linhas e meta de 5 propostas e 1 pagante até 08/11/2026
(`PRUMO-DIAGNOSTICO-VENDAS-2026-10-19.md`).

## O que o Rômulo decidiu direto

- **Mensagens às oportunidades abertas:** "Automatize as mensagens e pode disparar." É a decisão que estava aberta em
  `RULES.md` (resposta automática a conversa e ampliação do envio automático) e em `perfis-e-experimentos.md`
  (envio do lead quente). O `RULES.md` ainda não foi atualizado: ele está modificado no checkout de produção da Mel, e um
  commit nele trava o `atualizar-central`. Atualizar quando esse trabalho entrar na `main`.
- **Chip único:** deixou de ser risco. O Rômulo cria números novos na Flu.ke se um levar softban. As travas de ritmo seguem.
- Aprovados sem mudança: congelar a construção, cadência e fim da proposta, motivo de perda obrigatório, uma oferta
  principal, rotina, novo follow-up, Triagem pela dor e medição.

## O que o PM decidiu

**Construção até o 1º pagamento confirmado (com comprovante).** Antes de abrir código, responder por escrito "qual lead
nomeado isso aproxima de pagar até 08/11?". Uma entrega de código por dia útil, de até meio dia, fora dos blocos de venda.
- Entra: defeito que impede mandar, receber ou registrar mensagem de lead; o mínimo para cobrar (link de Pix/Asaas,
  registro de aceite e pagamento, contrato de uma página); os parâmetros abaixo, nesta ordem: avisos do Telegram, cadência
  e motivos de perda, follow-up, pesos da Triagem; o mix dos 30 primeiros contatos; incidente de segurança ou banimento.
- Não entra: tela, aba ou métrica nova; agente ou sombra nova; caçador, nicho ou linha nova; refatoração, design system,
  n8n, gerador de sites, Raio-X ou Mapa; qualquer mudança nas travas de horário e de ritmo.

**Oferta principal: Site.** É a única com preço fechado, demo pronta e "só paga depois de ver", e as quatro oportunidades
mais quentes são de site. Mix dos 30 primeiros contatos/dia até o 1º pagamento: Site 18 (time automático, primeiro os
que têm fato verificável do Raio-X), Iris 8 (Rômulo, ou o executor se ligado; sem "30 dias grátis" novo), Plus 4 (Rômulo,
só oferta de site, até fechar os 20 do teste), Estamparia 0 (volta a 4 quando houver condição de assinatura; quem já
respondeu segue atendido), Serviços PRUMO 0 (o funil atual segue na cadência). **Isso altera o "sem cotas" da Fase 0**
até o 1º pagamento; teto de 30/dia, 5 min e 12/h não muda.

**Rotina.** Bloco 1, fechar, 09h00–10h30; bloco 2, conversar, 14h00–15h30, seg–sex. Telegram com teto de 8 avisos/dia
(pagamento, aceite, Pix e contrato sem teto): ficam resposta de gente em conversa aberta ou proposta, "quero ver", "pode
mandar", "quanto custa" e pedido de conversa; saem o primeiro contato um a um, follow-up e toques de cadência
individuais, revisões de 7 dias, robô/recepção, sombra do lead quente e "sugestão pronta", e mais de um aviso por lead
por dia. Meta: 80% dos itens com "Enviei" ou "Pular" no mesmo dia (hoje, 7%). Resumos de bloco às 08h55 e 13h55 ficam
para uma entrega seguinte.

**Proposta.** Validade de 10 dias corridos (condição, não promoção). Toques em D+1 útil (dúvida e quem mais decide),
D+4 úteis (chamada de 10 min com quem decide junto) e D+8 corridos (validade e encerramento honesto). Perdido em D+10,
motivo "sumiu". A cadência atual (`src/operations/cadencia.ts`) tem 1º e 3º dia útil e fim no 10º dia, e não cobre as
propostas do ciclo comercial (`crm.ts:2203`, `proxima-venda.ts:296`): corrigir quando `crm.ts` e `proxima-venda.ts`
puderem ser commitados.

**Motivos de perda (lista fechada):** preco, timing, decisor, ja_tem, sem_dor, sumiu, contato_errado. Hoje há duas listas
que não se falam (`motivoPerda` do sistema e `motivo_perda` do AARRR); a Ficha não pede o motivo no "Perdeu".

**Follow-up:** uma pergunta, sem preço nem link, com uma versão com `{fato_raio_x}` e outra sem, por oferta. Entra como
braço B novo em `src/operations/followup-experimento.ts` subindo `VERSAO_DO_FOLLOWUP` (o controle A não muda), com 30 por
braço antes de qualquer taxa.

**Triagem (soma 100):** dor 50 (sem site 15; site fora ou domínio vencido 15; nota abaixo de 4,3 = 8; fora do top 10 do
nicho 7; avaliações sem resposta ou menos de 20 = 5), acesso ao decisor 20, aderência do nicho 20 (taxa de "quero ver"
relativa; menos de 30 envios = 10), porte 10. Na Iris e na Estamparia a dor sai dos sinais da oferta.

## Mensagens de 28/10

O PM aprovou 15 retomadas (Comece, RADIX, Bruno Gouveia, NeuroConectar, Favarato, Kulniski, Gaius, Jéssica Barbosa, AC
Previdenciária, Roda Mais, Ddetize, Stamp Fast, Casa do Bordado, Estampa Cor, Baobá): uma pergunta cada, sem R$, sem link,
voltadas a uma chamada de 10 minutos com quem decide, ou um encerramento honesto para quem teve 4 ou mais retomadas sem
resposta. Ficaram fora ControEco, Trilhar e Parque Desenvolver (receberam mensagem hoje), as recusas (Pereira, R7: marcar
Perdido), Aldeia (sem o número do Ricardo), JC e The Best (número indicado = primeiro contato frio) e Psicomed (WhatsApp em
manutenção até 09/11). O disparo usa um script único na Mel (`~/.cache/mel-work/disparo-20261028/`), que lê o número do
CRM, confere de novo a conversa antes de cada envio, espaça 4 a 5,5 min e anota na Ficha no formato
`[Envio confirmado pelo operador · data]`.
