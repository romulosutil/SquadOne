# Operação do Iris dentro do SquadOne e do PRUMO (plano de 11/10/2026)

Status: **proposta, nada implementado.** Pedido do Rômulo: o n8n pesquisa clientes para o
Iris como já faz para o PRUMO, o CRM recebe os achados prontos para contato, ele aborda
**como PRUMO** e inicia a conversão em lead.

## 1. O que é o Iris e o que "operação" cobre aqui

Iris (`dev/Pessoal/Iris`, GitHub `romulosutil/Iris`) é um SaaS B2B para **clínicas** de
terapia infantil/TEA (ABA), TCC e multidisciplinares. O cliente que paga é a clínica
(coordenador clínico decide; recepção e terapeutas usam). Proposta: "chegue na avaliação
com o dossiê pronto" (diário em texto livre, IA extrai evidências, terapeuta aprova,
dossiê para convênio). Em produção no Easypanel (Hostinger), cobrança por Pix Automático
no Asaas, **sinal verde para captação** no `docs/GO_LIVE.md` (medido em 09/09/2026).

"Operação" neste plano = **a operação comercial**: achar clínicas, contatar, converter em
lead e levar ao teste. Fica fora: operar o produto (containers, backup, Asaas), que é
a Fase 5, opcional.

## 2. O que já existe e será reaproveitado

| Peça | Onde | Serve ao Iris como |
|---|---|---|
| Busca no Google Places + Gemini | n8n da Mel, fluxo 01 (Site) e Lead Scout (PRUMO, desligado em 08/10) | molde do Caçador de clínicas |
| Regra "WhatsApp só se publicado no site" | `ops/n8n/README.md` | mesma regra de elegibilidade |
| Porte por CNPJ | `deploy/dell/claude-ops/prumo-porte-cnpj.*` | filtro de tamanho da clínica |
| Planilha → retrato → CRM | fluxo `08 · CRM`, `server/crm.ts` (`COLUNAS_DO_*`, `etapaDo*`) | fonte da verdade do funil |
| Envio um por um, Hoje, Resultados, Ficha, Colinha | `src/operations/*` | tela de contato |
| Classificação da resposta (negativa/interesse/...) | n8n "WhatsApp — resposta de lead" + Jev em sombra | triagem do que volta |
| Squad PRUMO (Prospecção, Atendimento) | roster de produção, `/p` no Telegram | quem "trabalha" |
| Raio-X como isca grátis | `raio-x.py`, `calculo_prumo.py` | molde da isca do Iris |

## 3. Decisões que o Rômulo precisa tomar (com a recomendação)

1. **Como o PRUMO vende um SaaS de clínica.** O PRUMO hoje é consultoria de presença
   (Encontrado, Respondido, Mapa, Fonte). O Iris é produto de software com outro público
   (coordenação clínica, não dono de comércio). *Recomendação:* a mensagem sai em voz PRUMO
   ("nós"), sem o nome dele (regra de 08/10), apresentando o Iris como **ferramenta
   que o PRUMO opera e implanta**, não como "o produto do PRUMO". Nada de cliente, anos
   ou depoimento inventado (regra de 08/10); sem pedir ajuda nem "cliente fundador".
   Precisa existir uma página do Iris que o link da mensagem possa abrir (o `iris` tem
   `public/` e um app em produção; conferir qual URL é a de entrada).
2. **ICP.** *Recomendação:* clínicas com **3+ profissionais e atendimento por convênio**
   (é onde a glosa dói e onde a ficha ativa paga), nichos nesta ordem: ABA/TEA, multidisciplinar
   infantil, neuropsicologia, fonoaudiologia, terapia ocupacional, TCC. Psicólogo solo fica
   fora do começo.
3. **Modelagem no CRM.** *Recomendação:* terceiro produto `iris` (rótulo "Iris · Clínicas"),
   com aba própria **na mesma planilha do PRUMO**. Motivo: as regras de pausa por nicho
   (20 envios sem sinal), Resultados e mensagens diferem; misturar com distribuidoras suja
   a medida de "propostas por semana". Alternativa mais barata (coluna `oferta` no
   Prospects) economiza código e perde essa separação.
4. **Isca.** Cold com convite pronto falhou no PRUMO (57 convites, 21 robôs, 0 donos). O
   que aprendemos: valor antes do pedido. *Recomendação:* o Iris oferece o **"dossiê de
   exemplo" com caso fictício** (nunca dado de paciente) e depois **21 dias de teste**
   (issue #663 do Iris: gravar `trial_dias = 21` no cadastro). Não há "Raio-X da clínica"
   com dado de fora sem pesquisar antes se vale (ver Fase 4).
5. **Canal.** O número é um só (5527997780954) e compartilhado com o funil de sites. Mais
   volume de clínicas aumenta o risco de banimento do número que sustenta o resto. *Recomendação:*
   teto diário próprio do Iris (começar em 10/dia, em horário comercial, pois o CRM já mede
   a taxa dentro/fora do expediente) e **decidir se vale um segundo número** só para o Iris
   antes de subir de 30/dia.

## 4. Estado do Iris que trava ou condiciona (verificar antes da Fase 3)

Os documentos do Iris são de 09/09/2026; o estado vivo não foi medido nesta sessão.

- `main` do Iris **bloqueado para deploy** desde 08/09 (migração `0158` pede `pgvector`
  e o Postgres de produção é `postgres:17-alpine`). Produção roda a última versão que
  deployou, anterior a isso. Confirmar que o app que a clínica vai usar é o que a mensagem
  promete.
- `iris-minio` está parado (por ele, 12/10) e `iris-postgres` segue ligado: confirmar que
  isso não afeta o ditado de voz/relatórios que a demo mostre.
- **Faltam para vender sem custo de suporte:** guia do pagador do Pix Automático (#377),
  central de ajuda (#376), trial de 21 dias (#663). O primeiro e o último são pré-requisito
  de conversão; a ajuda pode vir depois.
- **Conformidade nos textos:** o Iris tem dependências jurídicas em aberto
  (`docs/legal/briefing-para-advogado.md`, DPA do áudio). A abordagem não pode afirmar
  "100% LGPD", "aprovado pelo CFP/COFFITO" ou algo que o parecer não sustente. Texto de
  venda sai só com afirmações que o próprio `docs/` do Iris comprova.
- **Dado de saúde:** a prospecção usa só dado público de empresa (nome, site, telefone
  publicado). Nenhum dado de paciente entra em planilha, n8n ou CRM; a demo usa caso fictício.

## 5. Fases

### Fase 0: decisões e prontidão (sem código, 1 sessão)
Fechar §3. Medir §4 (deploy do Iris, URL de entrada, trial). Saída: este arquivo atualizado
com as respostas e uma lista de 8 a 10 clínicas escolhidas à mão para testar o texto antes de
automatizar (piloto manual, como foi o Raio-X da Roda Mais).

### Fase 1: Caçador de clínicas no n8n (Mel)
- Workflow novo `Iris · Caçador` em `ops/n8n/workflows/iris-cacador.json`, no molde do
  Lead Scout: rodízio **nicho × cidade** (começar por ES e capitais próximas, depois SP/MG/RJ), Places API
  (New) com a chave de `~/.config/prumo/places.env`, Gemini só para classificar
  "isto é clínica de terapia? atende por convênio? quantos profissionais aparecem no site?".
- Elegibilidade: operação ativa, **WhatsApp publicado no site** (mesma regra do PRUMO),
  celular brasileiro; porte via `prumo-porte-cnpj`; sinais de ICP viram pontos
  (convênio, "TEA/ABA", equipe visível, volume de avaliações).
- **Dedupe entre os três funis** por WhatsApp e `place_id` (a Roda Mais mostrou que o ID
  da planilha vem em minúsculas: guardar o ID bruto numa coluna própria).
- Grava na aba nova `Clínicas` da planilha do PRUMO; descartes em `Descartados`.
- Ligar com `n8n.DESLIGADOS` em mente (`deploy/dell/claude-ops/n8n.py` impede religar o
  que foi desligado de propósito). Criar **desligado**, rodar manual com 1 nicho × 1 cidade,
  conferir a lista à mão, só então agendar (9h).
- Teste: contrato de colunas (`server/prumo-workflows.test.ts` ganha o equivalente).

### Fase 2: CRM `iris`
Mudanças em `server/crm.ts` e na casca (a lista de arquivos com `CrmProduto` está no
`grep` de 11/10: `crm.ts`, `crm-formato.ts`, `types.ts`, `hoje.ts`, `CrmPanel/Funil/Ficha/Colinha`):

- `CrmProduto = "site" | "prumo" | "iris"`, `COLUNAS_DO_IRIS`, `etapaDoIris` (puro),
  fonte `iris` no retrato, `RotuloDoProduto`, aviso de coluna ausente.
- Etapas do Iris: Novo → **Em contato** → **Proposta = demo/teste combinado ou trial
  em curso** → **Ganho = clínica pagando** → Perdido. Mesmo prazo de 7 dias sem resposta;
  trial em curso segura o lead (como "próximo passo" segura hoje).
- O registro de nota/próximo passo/proposta (`POST /crm/registro`) passa a aceitar
  `produto: "iris"` (hoje recusa fora de site|prumo, `crm.ts:494` e `:1228`).
- Resultados e a pausa de nicho (20 envios sem sinal) valem por produto.
- Testes em `server/crm.test.ts` e `src/operations-colinha.test.ts` (tabelas de caso).
- Fluxos `08 · CRM` e `WhatsApp — resposta de lead` ganham a aba nova (cuidado: **não rodar
  `whatsapp-conversa.py` com flags fora da lista**, ele republica fluxos; incidente de 12/10).

### Fase 3: contato como PRUMO
- Mensagens em `server/iris-mensagem.ts` (PURO, espelhado no n8n como `site-mensagem.ts`):
  primeira mensagem em 2 variações A/B (para medir), segunda mensagem com o dossiê de
  exemplo, follow-up no 3º dia, voz "nós/o PRUMO". Sem R$ na mensagem fria.
- Fila "Enviar um por um" (`fila-de-envio.ts`) já serve; Hoje ganha a linha do funil Iris.
- Colinha do Iris (`colinha.ts`): objeções reais da clínica: LGPD de menor, "IA no
  prontuário", glosa, migração das planilhas, preço por ficha ativa (R$ só do cardápio,
  que precisa sair do `modelo-de-negocio` do Iris e ser aprovado por ele).
- Prumo no roster (✎, não Git): `prumo--prospeccao` passa a cobrir "clínicas (Iris)";
  `prumo--geral` atende a conversa; `pj--prospeccao` ganha "Não cuida de: clínicas do Iris".
  Catálogo `src/office/trabalhadores.ts` + `fluxos.ts` ganham o Caçador do Iris e o fluxo
  "Iris · Clínicas" (o teste confere as duas listas contra o `status.json`).
- Telegram `/p` já cai na squad certa; nenhuma mudança de código.

### Fase 4: conversão em lead
Da resposta ao teste, fechando o buraco que o PRUMO tem (resposta sem próximo passo):
interesse → Ficha com próximo passo → **chamada de 20 min com demo do dossiê** → cadastro da
clínica no Iris com `trial_dias = 21` → acompanhamento no 7º e 14º dia → Pix Automático →
Ganho. Sinal automático de volta: **webhook do Iris → n8n → aba Clínicas** (cadastro, trial,
primeira ficha, ativação). Antes de existir, esses marcos entram à mão pelo registro do CRM.
Pesquisar nesta fase se um **"Raio-X da clínica"** (reputação no Google, canais de
agendamento, convênios divulgados) funciona como isca grátis; só construir se o piloto da
Fase 0 mostrar que a mensagem seca não abre conversa.

### Fase 5 (opcional): operar o produto na Central
Cartão do Iris no `dell-status`/Central: containers do Easypanel, backup, billing,
cobranças vencidas. Só quando houver clínica pagando.

## 6. Ordem de entrega (PRs pequenos, um por vez nos mesmos arquivos)

1. Piloto manual (Fase 0), sem PR.
2. PR `crm: produto iris` (Fase 2, só leitura de uma aba que pode estar vazia; seguro).
3. PR `n8n: Iris Caçador` desligado + contrato de colunas (Fase 1); ligar à mão.
4. PR mensagens + colinha + fluxos/catálogo (Fase 3); roster pelo ✎.
5. Webhook do Iris e acompanhamento (Fase 4).

## 7. Critério de sucesso e de parada

- Métrica única do funil (a de 08/10): **propostas por semana**, aqui "testes combinados".
  Meta de partida: 50 clínicas abordadas, 5 respostas com texto, 2 chamadas, 1 trial em 4 semanas.
- Parada: 20 envios sem sinal por nicho pausam o nicho (regra já existente); 30 envios sem
  nenhuma resposta humana pausam o Iris inteiro e voltam à Fase 0.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Ban do número compartilhado | teto próprio, horário comercial, segundo número se passar de 30/dia |
| Mensagem fria repete o fracasso do PRUMO (0 donos em 57 convites) | piloto manual primeiro; valor antes do pedido; medir variações |
| Texto promete mais que o Iris prova ou que o jurídico libera | só afirmações do `docs/` do Iris; revisar com o briefing jurídico |
| Produção do Iris atrás do `main` | medir em §4 antes de qualquer envio |
| Dado de saúde vazando para planilha/n8n/Jev | só dado público de empresa; Jev recebe resposta de lead, não ficha |
| Marca: consultoria que vende software | decisão 1; não inventar clientes |
| Capacidade de uma pessoa só | cada fase entrega algo usável sozinha; Fase 5 é opcional |
