# Jornada do cliente do PRUMO

> Gerado de `src/operations/jornada.ts` e `src/operations/colinha.ts` por `npx tsx scripts/jornada-guia.ts`.
> Não edite à mão: mude o código e refaça (o teste `src/operations-jornada.test.ts` falha se este arquivo ficar para trás).
> A fonte do negócio é o repositório prumo (`00-contexto/negocio.md`); os preços valem os de `04-venda/piloto-cdl/precos.json`.

**Leia isto antes de atender, escrever para, ou montar qualquer coisa para um lead do PRUMO.** Diz em que ordem as coisas
acontecem, quem faz cada passo e o que oferecer a quem. No CRM (`/crm`), a Ficha de cada lead mostra o passo em que ele está,
o próximo passo e o que oferecer, com estas mesmas regras.

## O desenho

```
 TODO LEAD     Achado → Raio-X pronto → Primeira mensagem → Respondeu → Viu o Raio-X
                                                                           │
                     ┌─────────────────────────────────────────────────────┤  (um, outro ou os dois)
                     ▼                                                     ▼
 POR FORA      Conversa (Encontrado, Respondido,           POR DENTRO   Convite para o Mapa → Mapa respondido
               Anúncios, Redes)                            (só equipe)  → Devolutiva de 45 min (→ Fonte)
                     │                                                     │
                     └──────────────────────────┬──────────────────────────┘
                                                ▼
 FECHO                       Proposta (em até 24 h) → Fechou → mensalidades
```

Iris e estamparias andam num caminho curto: Achado → Primeira mensagem (convite) → Respondeu → Conversa → Proposta → Fechou.

## Os passos

| # | Passo | Trilho | Quem | Como | Quando o lead está aqui | O que o tira daqui | Prazo |
|---|---|---|---|---|---|---|---|
| 1 | **Achado** | Todo lead | robô | Caçador (n8n 01, 06:00: Google Places + nota do Gemini); Iris e estamparias pelos caçadores próprios (rodados à mão); Plus pelo Catálogo de Negócios Maçônicos | O caçador gravou a empresa na planilha (ou, no Plus, no leads.json). | O Raio-X (ou o site) publicado vai para "Raio-X pronto". |  |
| 2 | **Raio-X pronto** | Todo lead | robô | raio-x.py (11:15 e 17:15) e o Balcão (n8n 03, de hora em hora) marcam "pronto" e sorteiam a mensagem; no PRUMO, o Raio-X à mão (projeto prumo-raio-x) | Raio-X publicado e o lead marcado "pronto", ainda sem a primeira mensagem. | A primeira mensagem enviada leva para "Primeira mensagem". |  |
| 3 | **Primeira mensagem** | Todo lead | você | Enviar um por um no CRM, pelo WhatsApp (trava de ritmo: 1 a cada 4 min, 8 por hora, teto do dia); o observador marca envio e leitura sozinho | Enviada (ou convite enviado), sem resposta de gente. | Resposta de gente leva para "Respondeu". Sem resposta: follow-up no 3º dia (só para quem leu, no mesmo dia) e Perdido em 7 dias. | follow-up no 3º dia; Perdido no 7º sem mensagem do lead |
| 4 | **Respondeu** | Todo lead | você | O observador lê a resposta e o Gemini classifica (interesse, neutra, negativa, robô, exclusão); você responde com a colinha | Respondeu e a 2ª mensagem ainda não saiu. | Interesse: a 2ª mensagem (o Raio-X ou o demo, com o preço do Encontrado). Negativa: a resposta da objeção. Exclusão: agradecer e apagar no mesmo dia. | interesse respondido em até 2 h; parado com 1 dia no passo |
| 5 | **Viu o Raio-X** | Todo lead | você | A 2ª mensagem do CRM (anotada sozinha ao tocar); "Gerar demo" quando ele quer ver o site (20 a 40 min, até 4 por dia) | A 2ª mensagem saiu (Raio-X, demo ou os dois, com o preço do Encontrado). | Abre um trilho, ou os dois: por fora, a conversa sobre os produtos; por dentro, o convite para o Mapa (só empresa com equipe). | proposta em até 24 h depois de cada "gostei"; parado com 2 dias no passo |
| 6 | **Conversa** | Por fora (o caminho do cliente) | você | Conversa de 20 a 45 min (roteiro em prumo/04-venda/roteiro-conversa-45min.md); marque no Calendar e salve o próximo passo na Ficha | Quer o site, ou o Raio-X mostrou um trecho do caminho que ele quer arrumar. | Proposta por escrito em até 24 h. | proposta em até 24 h depois da conversa; parado com 2 dias no passo |
| 7 | **Convite para o Mapa** | Por dentro (empresa com equipe) | você | Convite da colinha ("Mapa grátis: 16 perguntas, uns 10 minutos"); só empresa com umas 8 pessoas ou mais | Viu o Raio-X, a empresa tem equipe e o Mapa ainda não foi respondido. | O dono responde as 16 perguntas no formulário: "Mapa respondido". |  |
| 8 | **Mapa respondido** | Por dentro (empresa com equipe) | você | O formulário dispara o fluxo "PRUMO — Diagnóstico do dono" e o prumo-mapa gera o rascunho em PDF em ~/prumo-entregas; você completa os [PREENCHER] | O dono respondeu as 16 perguntas (sinal "diagnóstico" no CRM). | Documento completo e a devolutiva de 45 min marcada. | parado com 2 dias no passo |
| 9 | **Devolutiva do Mapa** | Por dentro (empresa com equipe) | você | Conversa de 45 min sobre o documento (o documento é do dono, contrate ou não) | Devolutiva marcada como próximo passo na Ficha. | Proposta da Fonte (e dos produtos que o Mapa apontou) em até 24 h. | proposta em até 24 h depois da devolutiva; parado com 2 dias no passo |
| 10 | **Proposta enviada** | Fechamento | você | proposta-modelo do prumo (04-venda) com o cardápio; marque "Proposta enviada" na Ficha | Proposta marcada na Ficha. | Fechou (página do lead) ou recusou; sem decisão, cobre com data no próximo passo. | parado com 3 dias no passo |
| 11 | **Fechou** | Fechamento | você | Encontrado: no ar e pago depois de ver; Fonte: 2 semanas, 50/50; depois, as mensalidades | Fechou (ou Concluído na planilha). | Entrega feita e a mensalidade correndo. |  |
| 12 | **Perdido** | Fechamento | robô | Recusou, pediu para apagar, 7 dias sem mensagem do lead ou sem contato fácil | Saiu do funil. | Volta sozinho se ele escrever; um próximo passo ou a proposta o trazem de volta. |  |

## O que oferecer a quem

1. O Raio-X (grátis) é a porta de todo lead, com ou sem site. Até ele ver o Raio-X, não se oferece mais nada.
2. Depois do Raio-X há dois trilhos, e eles se somam: por fora (Encontrado, Respondido e Acompanhado, Anúncios, Redes) e por dentro (Mapa → Fonte → Manutenção). Um lead com equipe pode fazer o Mapa e, ao mesmo tempo, querer o site.
3. Sem site (Site antes da venda, Plus com oferta "site"): o Encontrado vem logo depois do Raio-X; é o que o demo e a 2ª mensagem vendem, e paga só depois de ver no ar.
4. Com site (serviços PRUMO, Plus com oferta "prumo"): Respondido e Acompanhado, Anúncios ou Redes, conforme o que o Raio-X mostrou. O Encontrado só se o site atual não aparece no Google ou ele pedir um novo.
5. O Mapa (grátis) só para empresa com umas 8 pessoas ou mais, depois do Raio-X (ou direto pela CDL). Sem saber o porte, confirme antes de convidar.
6. A Fonte só existe depois do Mapa; a Manutenção, só depois da Fonte e dos 30 dias de ajustes.
7. Respondido e Acompanhado, Fonte e Manutenção não têm preço no frio: saem por escrito na proposta, em até 24 h.
8. Disse "já temos site": não insista no Encontrado; o Raio-X mostra o resto do caminho (WhatsApp, avaliações).
9. Iris e CRM de estamparia são ofertas próprias, fora do cardápio: não se misturam com Raio-X nem Mapa.

## O cardápio

| Serviço | Etapa | Tipo | O que o cliente recebe | Preço (tabela) | Para quem |
|---|---|---|---|---|---|
| **Raio-X** | ver | diagnostico | Uma página feita pelo Prumo, só com dados públicos: como a empresa aparece no Google, o que já está bom, até 3 coisas que mandam cliente para o concorrente (só as que o dado confirma) e, quando faz sentido, a demonstração do site. O dono não preenche nada. | grátis | Todo lead, antes do primeiro contato: é a porta de entrada de todos. Funciona também com quem já tem site. |
| **Mapa** | ver | diagnostico | O Raio-X mostra a empresa por fora; o Mapa, por dentro. O dono responde 16 perguntas (uns 10 minutos, sem nenhum dado financeiro) e recebe um documento: Índice do Prumo X/18, os 6 blocos, o que passa pelo dono, onde a informação mora, as travas estimadas e o que fazer primeiro. Mais uma conversa de 45 minutos sobre o resultado. O documento é do dono, contrate ou não. | grátis | Só empresa com equipe (umas 8 pessoas ou mais, onde a Fonte se paga), depois do Raio-X ou direto pela CDL. Empresa pequena fica no Raio-X e nos produtos. |
| **Encontrado** | arrumar | produto | Site no ar com o endereço da empresa, perfil do Google revisado e botão de WhatsApp. A mensalidade cobre domínio, hospedagem e ajustes. | R$ 690 + R$ 39/mês (paga só depois de ver no ar) | Quem não tem site, ou tem um que ninguém acha no Google. É o que o demo e a segunda mensagem vendem. |
| **Respondido e Acompanhado** | arrumar | produto | WhatsApp que responde na hora, faz as primeiras perguntas e marca horário; retorno automático de orçamento parado; painel simples de quem chamou e de quem fechou. Antes e depois medidos: contamos o WhatsApp antes de ligar e mostramos a diferença em 30 dias. | R$ 2.400 + R$ 290/mês (só depois de uma conversa, nunca no WhatsApp frio) · *sob proposta para o cliente* | Quem já tem site e perde cliente no WhatsApp: demora para responder, ninguém responde fora do horário, orçamento pedido que some. |
| **Anúncios** | arrumar | produto | Criamos e cuidamos dos anúncios no Google ou no Instagram, e todo mês mostramos quantas pessoas chamaram por causa deles. A verba do anúncio vai direto para a plataforma, sem passar pelo Prumo. | R$ 590/mês (Google ou Instagram; R$ 390 a mais pelos dois; mínimo de 3 meses) | Quem já tem site e perfil do Google em dia e precisa de mais gente chamando: o Raio-X mostra poucas buscas ou pouca gente chegando. Depois do Raio-X, nunca no WhatsApp frio. |
| **Redes sociais** | arrumar | produto | Instagram e Facebook em dia: 8 posts por mês e stories toda semana, feitos com as fotos e os serviços da empresa e publicados depois da aprovação do dono. | R$ 790/mês (mínimo de 3 meses; depois, cancela quando quiser) | Quem tem perfil parado ou sem padrão e perde confiança de quem confere antes de chamar. Depois do Raio-X, quando ele mostra rede social abandonada. |
| **Fonte** | arrumar | projeto | A construção, em cerca de 2 semanas depois da conversa sobre as regras. Na primeira, conferimos o Mapa com o time; depois, as regras da casa (como a empresa vende, compra, entrega e cobra, e quem faz o quê) saem da cabeça do dono para um Notion ou um agente com IA que o time consulta. | R$ 1.500 (a partir de, 50/50, só depois do Mapa) · *sob proposta para o cliente* | Empresa com equipe que fez o Mapa e onde tudo depende do dono. Chega pelo Mapa (e a CDL leva até ele), nunca pelo frio. |
| **Fonte em dia** | manter | mensalidade | Revisão mensal da Fonte, atualização das regras, leitura dos números e uma conversa de 45 minutos. | R$ 190/mês (opcional, até 10 mudanças por mês, depois dos 30 dias de ajustes) · *sob proposta para o cliente* | Quem construiu a Fonte e quer mantê-la em dia. Opcional: nunca condição para fechar a Fonte. |

Fora do cardápio, ofertas próprias:

- **Iris**: Sistema para clínicas de terapia (agenda, fichas e prontuário), já em produção; cadastro grátis e 7 dias de teste. Psicologia e terapias (aba Clínicas). A conversa segue à mão: não há 2ª mensagem aprovada.
- **CRM de estamparia**: O CRM da Silmer adaptado para outra estamparia. Fase B0: só valida se há demanda, ainda sem preço nem instalação. Estamparias e confecções (aba Estamparias). Nada de prometer prazo ou preço antes da fase B1.

## Onde ver e onde mudar

- **Em que passo está um lead:** a Ficha no CRM (`/crm`, bloco "Jornada"). A etapa vem do retrato das planilhas (`server/crm.ts`, a cada 10 min).
- **O funil inteiro por passo** (quem espera quem, quem está parado): a vista Jornada (`/crm?ver=jornada`).
- **O texto de cada momento** (mensagens, objeções, roteiro da conversa): a Colinha (`/crm?ver=colinha`, `src/operations/colinha.ts`).
- **Mudou a ordem, um passo ou uma regra de oferta:** `src/operations/jornada.ts`, depois `npx tsx scripts/jornada-guia.ts`.
- **Mudou um preço ou um serviço:** `prumo/04-venda/piloto-cdl/precos.json` e o caminho descrito no `CLAUDE.md` do prumo (inclui `colinha.ts`).
