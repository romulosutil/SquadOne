# PRUMO como holding: dois fluxos novos, Iris e CRM de estamparia (plano de 13/10/2026)

Status: **em andamento desde 14/10/2026.** Fica acima de `2026-10-11-operacao-iris.md`, que
continua valendo como detalhe da operação do Iris (§5 abaixo só registra o que mudou nele).

Feito em 14/10/2026 (pedido do Rômulo: "o PRUMO é subordinado ao SquadOne; os serviços do PRUMO, o Iris e o
CRM de estamparia, ao PRUMO"; detalhes em `docs/referencia/perfis-e-experimentos.md`): caçadores do Iris e das
estamparias no n8n (desligados, uma rodada manual cada: 10 clínicas e 7 estamparias para revisar), abas Clínicas
e Estamparias, clique do convite de cada oferta, as duas ofertas no funil do CRM ao lado de Site e PRUMO, salas
Iris e Estamparias na squad PRUMO. Em vez do registro de ofertas do §6, as ofertas novas reusam o contrato e a
regra do Prospects (`OFERTA_DE_PROSPECCAO` em `server/crm.ts`). Falta: observador do WhatsApp e classificação de
resposta lendo as abas novas, mensagens de 2º passo e colinha das ofertas, decisões 1 a 6 do §4.

## 1. O desenho, em uma frase

O n8n vira a **linha de produção de leads de qualquer oferta**; o **SquadOne CRM** é o funil
único; o **PRUMO** é a voz e o número de WhatsApp pelo qual tudo sai. Hoje há duas ofertas
nesse trilho (Consultoria, Site/Encontrado). Entram **Iris** (clínicas de terapia) e
**CRM de estamparia** (white-label do CRM Silmer). "Qualquer outro produto" do desenho é o
critério de projeto: a terceira e a quarta oferta não podem custar uma cópia do código da
segunda.

A esteira que cada oferta repete (é o que vira "padrão" neste plano):

```
Caçador (n8n, nicho × cidade)  →  aba da oferta na planilha  →  retrato do CRM
  →  mensagem em voz PRUMO (fila "um por um")  →  resposta classificada
  →  próximo passo na Ficha  →  conversão (demo/trial/proposta)  →  Ganho
```

## 2. O que a leitura dos repositórios mostrou (e que muda a ordem)

| Achado | Fonte | Consequência |
|---|---|---|
| O Iris **já vende sozinho**: produção no Easypanel, cadastro grátis em `/cadastro`, Pix Automático homologado, preço R$ 39/25 por ficha ativa | irisclinica.ia.br (lido hoje), `Iris/docs/GO_LIVE.md` | Fluxo A é só prospecção e conversão; produto pronto |
| O CRM Silmer é **mono-cliente e ainda não foi ao ar**: zero `tenant`/`organization_id`, 52 de 237 arquivos de código citam "Silmer", ficha v6, Rose, loja InfinitePay; fase atual é homologação (Meta, DPA da OpenAI, assinatura física) | `crm-silmer/RULES.md`, `README.md`, `docs/roadmap/PROXIMAS-FASES.md` | Fluxo B **não tem o que vender ainda** como produto; começa em validação de demanda, não em envio em massa |
| A página do Iris dá **7 dias de trial** (a partir do 1º paciente) e fala em "preço de fundador"; o plano de 11/10 assumia 21 dias (#663) e o PRUMO proíbe "cliente fundador" (08/10) | site vs. `operacao-iris.md` §3/§4 | A mensagem do PRUMO não pode repetir "fundador"; trial a medir antes de prometer prazo |
| `main` do Iris estava bloqueado para deploy (pgvector, D89) em 09/09; o log mostra commits até #666 | `GO_LIVE.md`, `git log` | Medir se D89 foi resolvido antes de qualquer envio |
| `server/crm.ts` tem 1.467 linhas e `CrmProduto = "site" \| "prumo"` aparece em 9 arquivos (34 ocorrências); `etapaDoSite`/`etapaDoPrumo` e `COLUNAS_DO_*` são por produto | `server/crm.ts:27,37,69,108,653,876` | Adicionar dois produtos por cópia custa ~2 × 400 linhas e 9 arquivos cada; vale um registro de ofertas (§6) |
| O PRUMO tem 0 donos em 57 convites frios e 165 abordagens com 0 propostas | memória `prumo-reposicionamento` | Nenhum fluxo novo sai em volume sem piloto manual |

## 3. Princípios (herdados, para não reabrir)

1. Voz de empresa ("nós", "o PRUMO"); sem o nome do Rômulo; **nunca inventar** cliente, equipe,
   anos, depoimento, "cliente fundador" nem desconto por depoimento.
2. Valor antes do pedido; R$ só em cardápio aprovado, nunca na mensagem fria.
3. WhatsApp só se **publicado no site** da empresa; celular brasileiro.
4. Uma métrica: **propostas por semana** (aqui, "testes/demos combinados").
5. Nicho sem sinal em 20 envios pausa sozinho; criar fluxo n8n **desligado**, rodar manual com
   1 nicho × 1 cidade, só então agendar (cuidado com `n8n.DESLIGADOS` e com
   `whatsapp-conversa.py`, que republica fluxos).
6. Nenhum dado de paciente (Iris) nem de cliente final (estamparia) em planilha, n8n ou CRM de
   prospecção: só dado público de empresa.

## 4. Decisões que dependem de você (com recomendação)

1. **Marca-mãe e nome das ofertas.** PRUMO é "consultoria de presença". Como holding, a
   mensagem diz "o PRUMO implanta e opera o Iris" / "o PRUMO implanta um CRM de pedidos para
   estamparia". *Recomendação:* PRUMO = quem fala e quem implanta; Iris mantém o nome; o CRM
   precisa de **nome de produto próprio** (não "CRM Silmer"; ex. a decidir) e a página
   `prumo.services` ganha uma seção "Soluções" só quando as duas ofertas tiverem uma página de
   destino de verdade.
2. **Iris: de onde o link da mensagem leva.** Hoje só existe `/cadastro` (autoatendimento).
   *Recomendação:* página curta `irisclinica.ia.br/?ref=prumo` (ou rota própria) que mostre o
   **dossiê de exemplo com caso fictício** e o botão de teste, sem "preço de fundador".
3. **CRM white-label: como multiplicar o produto.**
   - **A. Uma instalação por cliente** (stack Easypanel por empresa, mesma imagem, banco e
     n8n próprios). Quase nenhum código novo; custo de operação cresce com cada cliente.
   - **B. Multi-tenant de verdade** (isolamento por `tenant_id`/RLS como o Iris já faz). Muito
     código no CRM Silmer, que hoje tem Silmer espalhado.
   *Recomendação:* **A** para os 1 a 3 primeiros clientes (valida preço e demanda sem refatorar),
   B só com 3 clientes pagando. Conta de custo por instalação entra na Fase B2.
4. **O que é "estamparia" no produto genérico.** O CRM Silmer é vertical: ficha de pedido com
   técnica, arte, tamanhos, gola, público. *Recomendação:* o primeiro cliente externo é
   **estamparia/confecção personalizada** (mesma ficha), não "qualquer ramo". Generalizar a
   ficha para outros ramos fica fora deste plano.
5. **Canal.** Um número só sustenta site + consultoria e agora duas ofertas. O envio é
   manual ("um por um", você toca), então o gargalo é seu tempo e o risco é ban.
   *Recomendação:* teto de **10/dia por oferta** e **30/dia somando tudo**; segundo número só
   se passar disso ou se um nicho gerar denúncia.
6. **Jurídico do CRM de terceiros.** Ao rodar o CRM de uma empresa, o PRUMO passa a ser
   **operador de dados** (LGPD) de clientes finais dela, com OpenAI/Meta no caminho. Precisa de
   contrato e DPA próprios antes do 1º cliente externo. *Recomendação:* tratar como gate do B,
   não da prospecção.

## 5. Fluxo A: Iris (delta sobre o plano de 11/10)

O plano de 11/10 (fases 0 a 5) segue válido. Mudanças:

- **Fase 0 ganha duas medições**: D89/deploy do Iris em dia? E o trial real (7 ou 21 dias, #663)?
  Sem isso a mensagem não pode citar prazo.
- **Conversão mais simples que a prevista.** Como o Iris tem cadastro grátis, o caminho padrão
  vira *mensagem → página com dossiê de exemplo → cadastro com `ref=prumo` → trial → Pix
  Automático*; a chamada de 20 min é para quem responder, não etapa obrigatória.
- **Sinal de volta**: webhook do Iris (cadastro, 1º paciente, 1ª evidência aprovada, assinatura)
  → n8n → aba `Clínicas`. Sem ele, marcos à mão pelo registro do CRM, como previsto.
- **Rótulo de ICP** do plano de 11/10 mantido (3+ profissionais, convênio, ABA/TEA primeiro).
- Itens #377 (guia do pagador) e a decisão do preço continuam pré-requisito de conversão.

## 6. Trabalho compartilhado: registro de ofertas no CRM (antes das duas ofertas)

Em vez de `CrmProduto = "site" | "prumo" | "iris" | "crm"` e um `etapaDoX` por cópia:

- `OFERTAS: Record<OfertaId, { rotulo, aba, colunas, etapa(), mensagem(), colinha() }>` em módulo
  PURO; `site` e `prumo` migram **sem mudar comportamento** (os testes de `server/crm.test.ts`
  e `src/operations-colinha.test.ts` provam a equivalência antes de adicionar nada).
- Planilha: **uma aba por oferta** na planilha do PRUMO (`Clínicas`, `Estamparias`), mesmo
  contrato de colunas do `Prospects`, com `COLUNAS_DE_OFERTA` parametrizado.
- Dedupe entre ofertas por WhatsApp e `place_id` bruto (o ID da planilha vem em minúsculas).
- Resultados, pausa de nicho e "Enviar um por um" passam a iterar o registro.
- Custo: 1 PR de refatoração sem comportamento novo. Justificativa: sem ele cada oferta nova
  repete os 9 arquivos; com ele, a próxima oferta é uma entrada no registro + mensagem.

## 7. Fluxo B: CRM de estamparia (white-label)

Etapas, porque produto e demanda não estão no mesmo estágio:

### B0. Provar que alguém quer (sem produto novo, 2 a 3 semanas)
- Caçador `Estamparias` no n8n (molde do Lead Scout): nichos *estamparia*, *camisetas
  personalizadas*, *uniformes personalizados*, *silk screen*, *sublimação*, *confecção sob
  encomenda*; ICP: WhatsApp publicado no site (é onde o CRM entra) e sinais de volume.
- Oferta de entrada = **conversa e demonstração do caso real da Silmer** (o CRM rodando num
  negócio verdadeiro, sem inventar nada). Nada de "instalação grátis".
- Piloto manual: 8 a 10 estamparias escolhidas à mão, mensagem escrita por você, antes de ligar
  o agendador. Meta: 2 conversas em 4 semanas; sem conversa, parar e não construir B1.

### B1. Silmer em produção (condição para vender)
O CRM Silmer precisa terminar a própria homologação (Meta, DPA/ZDR da OpenAI, assinatura da
ficha v6, backup/restore). Isto é trabalho do repositório `crm-silmer`, já na fila dele
(`PROXIMAS-FASES.md`); este plano só **declara a dependência**: nenhum cliente externo antes do
Silmer próprio estável por pelo menos 30 dias.

### B2. Primeira instalação externa (se B0 mostrar demanda)
- Decisão 3 (A): script de provisionamento de uma stack nova no Easypanel (CRM + worker +
  Postgres + n8n + RustFS), com marca, nome da empresa e remetente parametrizados.
- Remover o "Silmer" fixo do que aparece ao cliente (nome, textos, impressão, `secret://crm/
  order-recipient-phone`), via configuração por instalação, **sem** tocar o modelo de dados.
- WhatsApp próprio de cada cliente (WABA dele); PRUMO não usa o número do cliente.
- Contrato + DPA (decisão 6). Preço: a definir só depois das duas primeiras conversas.

### B3. Escala (só com 3 clientes pagando)
Multi-tenant (decisão 3, B), painel de gestão das instalações na Central do SquadOne, cobrança.

## 8. Ordem de entrega

1. **Medições da Fase 0 do Iris** + piloto manual de 8 a 10 clínicas (sem PR). Em paralelo,
   piloto manual de 8 a 10 estamparias (B0).
2. PR `crm: registro de ofertas` (§6), sem comportamento novo.
3. PR `crm: oferta iris` + Caçador `Iris` desligado + contrato de colunas.
4. PR mensagens, colinha e fluxos/catálogo do Iris; roster pelo ✎ (`prumo--prospeccao`
   cobre "clínicas (Iris)"; `pj--prospeccao` ganha "Não cuida de").
5. PR `crm: oferta estampa` + Caçador `Estamparias` desligado (só depois do piloto B0 mostrar
   conversa).
6. Webhook do Iris → n8n; acompanhamento 7º/14º dia.
7. B1/B2 só depois dos gates acima.

Cada PR é pequeno e merge um por vez nos mesmos arquivos (`crm.ts`, `colinha.ts`).

## 9. Critério de sucesso e de parada

- Métrica única: **demos/testes combinados por semana**, por oferta.
- Iris: 50 clínicas abordadas, 5 respostas com texto, 2 chamadas, 1 trial ativo em 4 semanas.
- Estampa: 2 conversas em 4 semanas no piloto manual; senão pausa e volta ao Silmer próprio.
- Parada geral: 30 envios sem resposta humana numa oferta a pausam e voltam ao piloto manual.
- Teto de capacidade: se as duas ofertas rodarem juntas, não ultrapassar 30 envios/dia no
  total; priorizar a oferta com mais respostas.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Vender o CRM antes de existir (mono-cliente, sem go-live) | B0 só valida demanda; B1 como pré-requisito; nada de "instalação" prometida |
| Diluir a marca: consultoria que vende software de saúde e de estamparia | decisão 1; páginas de destino próprias; nunca citar cliente que não existe |
| Ban do número compartilhado com quatro ofertas | tetos por oferta e total; segundo número; horário comercial |
| LGPD: PRUMO vira operador de dados de terceiros (estamparia) e de saúde (Iris) | prospecção só com dado público; DPA antes do 1º cliente de CRM; textos do Iris só com o que `docs/` prova |
| Refatoração do `crm.ts` quebra o funil em uso | PR sem comportamento novo, testes de equivalência, merge isolado |
| Capacidade de uma pessoa só | fases independentes; B2/B3 só com demanda provada |
