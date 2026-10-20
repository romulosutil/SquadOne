# Diagnóstico da operação de vendas do PRUMO (19/10/2026)

O PRUMO aqui são as cinco linhas sob ele: Serviços PRUMO, Venda de site, Iris, Estamparia e Plus.
Este diagnóstico juntou quatro levantamentos, todos só de leitura: a lógica do funil no SquadOne, os fluxos do n8n e
os scripts do Dell, o repositório `prumo` com as memórias, e os números ao vivo da Mel
(API `/api/operations/*` e arquivos, lidos em 19/10 às 19h de SP). As falhas de maior impacto foram conferidas no código.

## Em cinco linhas

1. O funil não quebra no topo, quebra no fim: 281 envios deram 49 respostas de gente e 10 "quero ver".
   Esses 10 renderam 10 links, depois 2 propostas, e nenhuma venda. Ganho registrado: zero, em todas as linhas.
2. A captação está desligada da capacidade: 3.510 leads achados contra 281 enviados (8%), com 1.877 parados.
   Nas últimas semanas o tempo foi para infraestrutura (cerca de 190 correções em 19/10, 31 itens da AC, 15 OTs) e não para fechar.
3. A automação avisa e ninguém age: em 19/10 foram 18 avisos do vendedor no Telegram, com 0 "Enviei".
   As 15 ações do dia expiraram. O uso da Central caiu de 160 telas/dia (17 e 18/10) para 20 (19/10).
4. Não existe qualificação. Nenhum campo de dor, impacto, prazo ou decisor; a proposta sai com um "gostei", sem conversa.
   Também não há evento crítico: o domínio vencido do lead não é usado como urgência.
5. O risco operacional é alto: um só chip para prospecção, alertas e Hermes. O robô de envio automático foi autorizado
   em 18/10 com teto de 100/dia, três dias depois de uma restrição de 24 h. O teto caiu para 30 na Fase 0 (19/10).

## Números (desde 23/09; retrato de 19/10)

| Linha | Achados | Parados | Enviados | Resposta de gente | Robô | Quero ver | Link | Proposta | Ganho |
|---|---|---|---|---|---|---|---|---|---|
| Site | 1.703 | 150 | 209 | 36 (17%) | 24 | 7 | 6 | 1 | 0 |
| Serviços PRUMO | 67 | 0 | 59 | 7 (12%) | 21 | 1 | 1 | 1 | 0 |
| Iris | 670 | 666 | 4 | 1 | 2 | 1 | 1 | 0 | 0 |
| Estamparia | 760 | 753 | 7 | 3 | 1 | 1 | 2 | 0 | 0 |
| Plus | 310 | 308 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **3.510** | **1.877** | **281** | **49 (17%)** | **48** | **10** | **10** | **2** | **0** |

- **Degraus:** de resposta de gente para "quero ver", 20%; de "quero ver" para link, 80%; de link para proposta, 20%;
  de proposta para ganho, 0 de 2.
- **Velocidade:**
  - Do "quero ver" ao link, a mediana é 0,7 h, mas 2 de 7 esperaram cerca de 52 h.
  - Do link à proposta, cerca de 3,5 dias.
- **Follow-up:** 72 enviados, nenhuma resposta depois deles.
- **Medição turva:**
  - Leitura desconhecida em 73% dos envios.
  - 49% das "respostas" são de robô; no Serviços PRUMO, 21 de 59 envios.
  - 14% dos envios saíram fora do expediente, e 4 intervalos desde 16/10 ficaram abaixo dos 5 min da trava.
- **Backlog:** no ritmo real (cerca de 18/dia), a fila dá uns 104 dias úteis.
- **Uso da Central:** Hoje, Funil e Ficha são abertos; Números e Roteiro quase nunca.

## Onde quebra, por ordem de dano

**Fundo do funil (receita)**

1. **A proposta sai sem descoberta.** No Site e no PRUMO, `gostouDepoisDoLink` abre "Mandar a proposta" com um "gostei"
   ou um "quanto fica" ([mandar-proposta.ts:40](../src/operations/mandar-proposta.ts:40)).
   A dica da própria colinha diz "só depois de uma conversa", e a jornada pede "Marcar a conversa".
   Nada confirma o decisor: a Comece "não decide sozinha" e foi comparar com o concorrente.
2. **A proposta não tem cadência nem fim.**
   - O grupo `proposta` entra na fila desde o dia 0, com "Pergunte o que faltou na proposta"
     ([proxima-venda.ts:389](../src/operations/proxima-venda.ts:389), [crm.ts:1946](../server/crm.ts:1946)).
   - O "Enviei" vale só pelo dia, então a cobrança volta todo dia.
   - A etapa nunca expira ([crm.ts:937](../server/crm.ts:937) trata só `contato`), e o número de propostas incha.
3. **A conversa em andamento fica sem cadência.** Quem respondeu "vou ver" e silenciou só reaparece no 7º dia, como revisão.
   Na fila, revisões antigas passam na frente de um "quero ver" recente.
4. **O aviso quente fica preso fora do expediente.** O vendedor não avisa nada fora de seg–sex 8h–17h30
   ([vendedor.ts:182](../server/vendedor.ts:182)), nem um "quero ver". Essa trava foi pensada para o primeiro contato.
5. **Não se mede receita.** Faltam valor da proposta, valor do ganho, pagamento confirmado, MRR, motivo de perda
   (preço, timing, decisor, concorrente) e canal de origem.

**Meio do funil (conversa)**

6. **O follow-up não funciona.** O texto rendeu 0 respostas em 72 envios. Ele só vai para quem leu: no PRUMO, Iris e
   Estamparia, quem desliga o recibo recebe um toque só.
7. **O insight é escondido.** O Raio-X acha coisas que o dono não sabe (domínio vencido, DNS morto, 11º lugar, avaliações
   filtráveis), mas a regra de tom manda "o que está bom vem primeiro" e proíbe apontar defeito.
8. **As objeções de preço servem a um produto só.** "Quanto custa?" e "Tá caro" respondem com o Site para todas as ofertas,
   inclusive PRUMO e Iris, cujo lead já tem site.
9. **A recepção recebe a proposta.** `mandar-proposta` ignora a leitura do copiloto (decisor, recepção ou robô).

**Topo e operação**

10. **Há cinco linhas e uma pessoa.**
    - Os públicos são quatro, sem nada em comum, e o Plus é um canal, não um público.
    - O ICP declarado (ES, equipe de 8 ou mais) não bate com os leads reais: profissionais sozinhos em GO, PR e SP.
    - A Fonte é vendida e ainda não existe pronta (a página `/fonte` tem respostas fixas). Iris e o CRM de estamparia
      estão prontos, segundo o Rômulo (19/10), o que corrige o levantamento que dizia o contrário.
11. **A Triagem premia quem tem menos dor.** 35 dos 100 pontos vão para nota e volume no Google
    ([crm.ts:1713](../server/crm.ts:1713)), e nota baixa é justamente a dor que se vende.
12. **O chip único é ponto único de falha.**
    - Banimento derruba prospecção, Hermes e os alertas que passam pela fila do WhatsApp.
    - O observador trava fechado: com `leads.json` de mais de 30 min, a resposta se perde e a Evolution não a reentrega.
    - O mapa `@lid` vive só em memória.
13. **Há três relógios de perda.** O CRM marca Perdido em 7 dias, a planilha expira em 10 e a pausa do demo conta 15.
    O demo é apagado antes de a planilha considerar o lead perdido.
14. **O Caçador do Site não está versionado.** Ele nasce de um JSON externo remendado e não dá para auditar o dedupe.
15. **A documentação ficou para trás.** O `fluxos.ts` diz "ligado em 16/10" sobre caçadores pausados.
    O CLAUDE.md já foi acertado para 30/dia na Fase 0.

## Qual framework

**De qual estamos mais perto: SPIN, com uma peça de Challenger.**
- A conversa de 45 min e a colinha são SPIN de manual, com Situação, Problema, Implicação ("quanto isso custa por mês?")
  e Necessidade ("devolver o que ouviu"). Quase nunca chegam a ser usadas: nos registros só houve um Mapa respondido.
- O Raio-X é um insight comercial ao estilo Challenger, mas a regra de tom tira a tensão dele.
- MEDDPICC não existe no processo. SPICED aparece em pedaços: S, P e I estão na colinha; C e D, não.

**O que encaixa melhor num solopreneur com agentes: SPICED como espinha, Challenger na abertura e SPIN como técnica de pergunta.**
- **O tamanho do negócio pede SPICED.** O SPICED (Winning by Design) foi feito para ciclo curto, ticket recorrente e
  pequena empresa. O ticket aqui é R$ 690 + mensalidade, e quem decide é o dono.
  O MEDDPICC foi feito para venda enterprise, com comitê, jurídico e champion. Aqui, 6 das 8 letras ficariam vazias.
  Só vale uma versão reduzida para a Iris (clínica com 3 ou mais profissionais e convênio) e para a CDL (diretoria).
- **Cada letra vira um campo que um agente preenche e um humano confirma.** O copiloto já lê a conversa;
  basta extrair S, P, I, C e D em JSON. A proposta só abre com P, I e D confirmados.
  Isso transforma o framework numa trava de código, não num treinamento.
- **O "C" (evento crítico) é o buraco que mais custa hoje.** Os fatos do Raio-X são eventos críticos prontos: domínio
  vencido em 29/08, site fora do ar desde 26/08, temporada, CDL. O Challenger entra aqui: a abertura lidera com o fato
  que o dono não sabe, com respeito, mas sem esconder.
- **O SPIN continua como o "como perguntar".** É ele que preenche o P e o I numa ligação de 10 minutos.

## Devemos usar o AARRR?

**Sim, como régua e não como método de venda, e com uma adaptação.** O funil pirata é de produto e crescimento, não
de conversa. Ele serve para mostrar que hoje se mede com obsessão as duas primeiras letras e nada das três últimas.

| Letra | No PRUMO | Hoje |
|---|---|---|
| Aquisição | lead enviado com resposta de gente | medido (A/B, nicho, horário) |
| Ativação | "quero ver", com o SPICED preenchido (P + I + D) | medido sem a qualificação |
| Receita | pagamento confirmado (não o "fechou" verbal) | **não medido** |
| Retenção | mensalidade ativa no 3º mês | **não existe** |
| Indicação | pedido de indicação no 30º dia, indicado que vira lead | **não existe** |

Adaptações:
- **A ordem.** Num serviço, a Receita vem antes da Retenção.
- **A Estrela-guia.** A métrica principal é **pagamentos confirmados por semana**. Enquanto ela for zero, nada novo entra
  no topo: nada de caçador, nicho ou linha nova.
- **A Indicação.** Ela é o canal mais barato para quem vende sozinho e com um chip só. Ela e o Plus (rede quente) merecem
  ser testados antes de religar caçadores frios.

---

## O prompt

Cole numa sessão nova do Claude Code no SquadOne. A Fase 0 já foi decidida (19/10/2026); o agente começa pela Fase 1.

```text
Você é o orquestrador de vendas do PRUMO (Serviços PRUMO, Venda de site, Iris, Estamparia e Plus, tudo sob o PRUMO),
operado por uma pessoa só, o Rômulo, com agentes. Siga o CLAUDE.md do SquadOne e o global (Orchestrator-Workers:
despache trabalhadores, sem worktree extra, sem PR, merge direto na main).

OBJETIVO ÚNICO ATÉ 08/11/2026: 5 propostas qualificadas e 1 pagamento confirmado.
Estrela-guia: pagamentos confirmados por semana. Nada que não aproxime alguém de pagar entra nesta rodada.

LEIA ANTES (nesta ordem):
1. docs/PRUMO-DIAGNOSTICO-VENDAS-2026-10-19.md (este diagnóstico; números de 19/10)
2. docs/referencia/jornada-do-cliente.md e docs/referencia/perfis-e-experimentos.md
3. src/operations/proxima-venda.ts, mandar-proposta.ts, colinha.ts, copiloto.ts, server/crm.ts, server/vendedor.ts
4. As decisões do blueprint (ArtifactData list decisoes) das OTs que você for tocar

INVARIANTES (não negocie):
- Nada é enviado ao lead sem o toque do Rômulo, salvo o robô de primeiro contato já autorizado, no teto que ele definir.
- Preço só do cardápio (precos.json / colinha); nenhum "R$" gerado por modelo.
- As travas de horário e de ritmo valem para o PRIMEIRO contato; responder a quem escreveu não é primeiro contato.
- Teste nunca toca dado real (HOME e raiz temporários); regras puras em node:test com tabela de casos.
- Cada passo que muda atualiza o cartão em docs/blueprint/servico.json no mesmo commit.
- Verificação: npx vue-tsc --noEmit, npm test, npm run build, e exercitar a rota.

FASE 0 — DECIDIDA PELO RÔMULO EM 19/10/2026 (não reabra; registro em docs/referencia/perfis-e-experimentos.md,
seção "Fase 0 do diagnóstico de vendas"):
a) Teto de primeiros contatos: 30/dia, somando o time comercial, as telas e o Telegram (REGRAS_DO_RITMO, commit
   0611f26, já no ar na Mel). Não mexa no teto, no intervalo de 5 min nem nas 12/h.
b) Nenhuma linha congelada: Iris e o CRM de estamparia são produtos prontos. As cinco linhas dividem o teto pela
   ordem da fila de venda, sem cota por linha. Os caçadores de Iris e estamparias seguem pausados (AC-11).
c) Plus: teste de 20 envios como rede quente. Os envios são do Rômulo (o time comercial não manda Plus).
d) Os fatos do Raio-X podem abrir a 1ª mensagem como evento crítico, como variante nova do A/B.

COMECE PELA FASE 1. Depois, as Fases 2 a 5 em ordem; uma fase só começa com a anterior entregue.

FASE 1 — FECHAR OS QUENTES (trabalho do Rômulo, hoje; o agente só prepara)
Gere a lista dos 10 "quero ver" e das 2 propostas abertas (Verde+, Comece), sem telefone na tela.
Para cada um, prepare:
- o que se sabe em SPICED;
- a lacuna (normalmente C e D);
- uma mensagem curta pedindo 10 minutos de ligação com dia e hora;
- três perguntas SPIN para a ligação.
O Rômulo manda. Pronto quando cada um dos 12 tiver um próximo passo com data anotado na Ficha.

FASE 2 — SPICED NO CRM (código)
1. Campos estruturados por lead: situacao, dor, impacto (texto, ou R$ dito pelo próprio lead), evento_critico
   (fato + data), decisao (decisor_confirmado: sim | não | não sei; quem; como paga). Gravados como registro na aba
   CRM, no mesmo caminho do proximo/proposta.
2. O copiloto extrai SPICED da conversa guardada como SUGESTÃO, com a citação do trecho. O Rômulo confirma com um
   toque na Ficha. O modelo nunca confirma sozinho.
3. A trava: "Mandar a proposta" (gostouDepoisDoLink) só aparece com dor + impacto + decisor_confirmado = sim.
   Sem isso, a ação vira "Marque 10 minutos com X", com as perguntas que faltam. Vale para as cinco linhas: hoje
   gostouDepoisDoLink só cobre Site e PRUMO; Iris, Estamparia e Plus ganham o mesmo passo com a mesma trava.
4. A Ficha mostra o SPICED como uma faixa (S·P·I·C·D, preenchido / falta), com o código BP- do design system.
Pronto: testes de tabela para a trava (todas as combinações dos três campos) e para a leitura da sugestão do copiloto.

FASE 3 — CADÊNCIA (código)
1. Proposta: nada no dia 0; "o que achou?" no 1º dia útil; último toque no 3º; no 10º, Perdido com o motivo
   "proposta sem retorno". O "Enviei" segura até o próximo degrau, não só o dia.
2. Conversa em andamento sem retorno: toque no 2º dia útil, com a sugestão do copiloto; revisão no 7º.
3. Na fila, quente antes de revisão: responder > mandar a proposta > combinado > depois do link > proposta > revisões.
4. O vendedor do Telegram avisa respostas de gente fora do expediente (silêncio das 22h às 7h).
   O expediente segue só para o primeiro contato.
5. O follow-up deixa de depender do recibo de leitura em todas as linhas. Reescreva o texto: o de hoje deu 0 de 72.
   Teste a nova versão com o A/B existente (30 por braço antes de qualquer taxa).
6. Um relógio de perda só: 7 dias no CRM, na planilha e na limpeza do demo. Mexa no crm.py, no 05 · Acompanhamento
   e no site-demos-* juntos; reinstale na Mel (instalados.json).
7. Abertura com evento crítico (decisão d da Fase 0): uma variante nova da 1ª mensagem que abre com UM fato do
   Raio-X do lead (domínio vencido, site fora do ar, posição no Google), com respeito, sem nota e sem "defeito".
   Siga o guia no topo das VARIACOES de site-mensagem.js e o espelho em server/site-mensagem.ts; para Serviços PRUMO,
   server/prumo-mensagem.ts. Sem fato verificável no Raio-X, o lead não entra nesse braço. Ela entra no A/B
   estratificado (ab_elegiveis, alocarRodada), com 30 por braço antes de qualquer taxa; o que já foi enviado nunca
   troca de letra. Os textos novos passam pelo Rômulo antes de ir ao ar.
8. Teste do Plus (decisão c): marque os 20 envios do teste (registro plus_enviado já existe) e mostre em Números
   a comparação com o Site no mesmo período: respostas de gente, "quero ver" e propostas.

FASE 4 — AARRR NA CENTRAL (código)
Em Vendas › Números, uma faixa AARRR no topo:
- Aquisição: resposta de gente / enviados.
- Ativação: "quero ver" com SPICED / respostas.
- Receita: pagamentos confirmados e R$ do cardápio.
- Retenção: mensalidades ativas no 3º mês.
- Indicação: indicações pedidas e recebidas.
Novos registros: valor_proposta, pagamento_confirmado (data e valor, só do cardápio), origem (caçador | plus | indicação
| CDL | anúncio), motivo_perda (preço | timing | sem dor | decisor | concorrente | sumiu).
No 30º dia depois do pagamento, um passo "Pedir indicação" na fila.
Finanças nunca entram aqui (RULES).

FASE 5 — ROBUSTEZ (código e Dell)
- O observador não perde resposta quando leads.json está velho: guardar em espera e casar depois, em vez de descartar.
- Persistir o mapa @lid→telefone em disco (600).
- O alerta P0 e as falhas do dell-status saem só pelo Telegram, nunca só pela fila do WhatsApp.
- Versionar o "01 · Caçador" em ops/n8n/workflows/.
- A Triagem pontua a dor: nota baixa ou poucas avaliações SOBEM para o Respondido; o peso do nicho vem de
  "quero ver", não só de resposta.
- Atualizar o fluxos.ts (caçadores de Iris e estamparias pausados desde 17/10; o CLAUDE.md já diz 30/dia).

FORA DESTA RODADA: caçador novo, linha nova, nicho novo, tela nova fora das Fases 2–4, refatoração, mudar o teto
de ritmo, religar caçadores.

ENTREGA DE CADA FASE: o que mudou (arquivo:linha), testes adicionados, o que foi instalado na Mel, o que ficou para o
Rômulo, e o número da Estrela-guia na data.
```

---

## Fechamento da auditoria (20/10/2026)

Auditoria do código em `origin/main` (b936237) contra o prompt acima. As Fases 2 a 5 estavam no ar, com estes furos, fechados no commit deste fechamento:

- **Fase 2:** a trava SPICED não alcançava Iris, Estamparia e Plus sem 2ª mensagem (o gatilho dependia de `segundaEnviada`); agora usa o marco real do material (`instanteDoMaterial`) e é testada com fixture sem esse marco. A citação do decisor precisa sustentar o "sim", e o lote não confirma decisor. Textos de jornada e colinha que mandavam propor sem qualificar foram ajustados.
- **Fase 3:** a letra D do Site não era lida da coluna `ab_elegiveis` (o braço D era incontável); o follow-up "B" mostrava o texto antigo (agora mostra o novo); o "Enviei" durável falhava na tela de conversas; o Perdido por `proposta-sem-retorno` impedia nova proposta; a lista de conversas tinha ordem própria.
- **Fase 4:** `valor_proposta`, `origem` e `motivo_perda` agora são agregados em Números (BP-AARRR).
- **Fase 5:** as listas de origens que exigem Telegram eram três e divergiam; agora são uma e há teste de paridade. Documentação do P0 só pelo Telegram corrigida.

**Continua aberto (decisão do Rômulo ou fora desta rodada):** falha de fluxo do n8n (`n8n:`) ainda pode sair só pelo WhatsApp com o bot fora; sugestão do copiloto no toque de conversa em que a vez é nossa (hoje o texto é fixo); "10º dia" da proposta é corrido, não útil; `acaoDepoisDoLink` ainda lê só `segundaEnviada`; preço da Estamparia; `dominio-vencido` sem fonte no Raio-X; Caçador do Site sem construtor; Fase 1 (convites e datas dos quentes) é do Rômulo; reinstalar na Mel `aviso.py`, `site-mensagem.js` e `auto-site-CLAUDE.md`.
