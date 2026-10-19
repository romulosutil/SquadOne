# Análise de UX da Central (16/10/2026)

> **Registro de época.** O que segue descreve a Central de 16–17/10/2026. Em 19/10/2026 (`docs/auditoria-de-fluxos-2026-10-19.md`) o `ProximaVenda.vue`
> e o que só ele usava (`plano-do-dia.ts`, `fila-de-envio.ts`, `anotacao-de-envio.ts`) saíram, e as abas de Vendas passaram a se chamar **Conversas para
> você**, **Primeiros contatos** e **Entender** (Funil, Diagnóstico, Resultados; `NOME_DAS_ABAS` em `vendas-abas.ts`). Onde o texto diz "A fazer", "Números"
> ou "Próxima venda", leia esses nomes e a fila de venda (`proxima-venda.ts`) como ela é hoje.

Pedido do Rômulo: análise profunda com os padrões do MCP de UX (uxpatterns.dev), e os 11 pontos dele (a Hoje não
entrega valor, "Em contato" sem visão, botões perdidos, menu com "pra que tem isso aqui?", ficha confusa, falhas que
deveriam disparar o Hermes, "por que não vende"). Os números vêm do `GET /api/operations/crm` da Mel às 16:30 de 16/10.

## O diagnóstico em uma frase

A Central foi desenhada como **painel de estado** (o que existe, o que o Dell confere, quantos em cada etapa) e o
trabalho do Rômulo é de **vendedor** (com quem falar agora, o que dizer). O padrão "Dashboard" do MCP começa por
"comece pelas perguntas que o usuário precisa responder antes de escolher o layout". A pergunta dele é "quem eu chamo
agora e o que eu digo?", e nenhuma tela respondia isso no primeiro olhar.

## O que os dados mostram (o "porquê" de não vender)

| Últimos 30 dias | n | taxa | referência |
|---|---|---|---|
| Receberam a 1ª mensagem | 267 | | |
| Leram (com recibo) | 68 | 25 % | ~60 % (recibo parcial: não decide) |
| Responderam (gente) | 41 | 15 % | ~15 % ✓ |
| Disseram "quero ver" | 7 | 17 % | ~30 % |
| Receberam o próximo passo | 3 | 43 % | ~100 % no mesmo dia |
| Proposta | **0** | **0 %** | ~40 % |
| Ganho | 0 | | |

- **O topo do funil funciona** (15 % de resposta a frio é o esperado). O dinheiro escapa **depois do "sim"**.
- Em 16/10 havia **dois "pode sim" de 14/10 sem o link** (Kulniski, Gaius) e um "Sim, achei bem legal" de 13/10 com
  o follow-up 4 dias atrasado (Roda Mais). A Hoje do CRM listava os três, mas no meio de 1.423 "prospects para
  revisar" e 164 "primeiro contato para enviar".
- **Nenhum passo da jornada pedia "o que achou?" depois do link.** A simulação mostrou: depois da 2ª mensagem anotada,
  o lead ficava 48 h em "Respostas para responder" (pedindo o que já saiu) e depois sumia até virar Perdido.

## Achados por tela, com o padrão do MCP

### 1. Hoje (`/`)
- **Hierarquia invertida** (Dashboard: "não faça todos os painéis parecerem igualmente importantes"). O topo era
  "Nada precisa de você agora" (o estado do Dell, em h1), depois a agenda, um bloco "Time" que no Dell só dizia "Sem
  sinal dos agentes", e por último uma linha "1887 novos · 80 em contato". A venda, que é o trabalho, estava no fim
  e só como contagem.
- **Métrica sem pergunta** (Dashboard: "não assuma que todos entendem a métrica"): contagem por etapa não diz onde
  agir. **Feito:** o primeiro cartão é **Próxima venda** (uma ação, o porquê, a tática, a mensagem pronta, um botão
  primário) e o segundo é **Por que não está vendendo** (o funil em degraus com o gargalo marcado e o que fazer). O
  estado do Dell desceu para h2; o "Time" sem agentes e a linha do funil saíram.

### 2. "Em contato" sem visão da conversa
- **Timeline** ("mostre a sequência para reconstruir o que aconteceu"): a Ficha tinha uma linha do tempo de *eventos*
  (enviado, viu, classificada) e um trecho de 200 caracteres; a conversa em si nunca chegava ao CRM (o observador a
  apagava depois de classificar). Por isso o agente "adivinhava a etapa".
- **Feito:** o observador passa a gravar as mensagens dos leads (só leads, 0600, 120 dias); a Ficha mostra a
  **Conversa** em balões; o **copiloto** recebe as últimas 20 mensagens no dossiê (mascaradas) e o **Hermes** ganhou
  o skill `conversa-do-lead` para responder "em que ponto está X e qual a próxima mensagem". O Jev segue só medição
  (RULES 27).

### 3. Proatividade ("Envie para X, só pra eu revisar")
- **AI Suggestions** ("explique o que a IA está fazendo e o que o usuário ainda controla"; "mostre a proveniência"):
  cada aviso diz **por que** (o fato do retrato), **como** (a tática do momento) e traz a **mensagem inteira** antes
  do toque. O Rômulo continua no controle: nada sai sem ele.
- **Feito:** o vendedor manda no Telegram, de seg a sex das 8h às 17h30, **um aviso por vez** com "Abrir no WhatsApp
  com a mensagem", "✓ Enviei" e "Pular"; o "Enviei" anota no CRM e já traz a próxima.

### 4. Envio automático da 1ª mensagem
- Pedido: automatizar para passar de 10 por dia. **Decisão dele (16/10):** semi-automático e rampa 10/20/30 mantida.
  O motivo: o número da prospecção é o mesmo do Hermes e levou restrição de 24 h em 15/10; disparo pela API não
  oficial (Evolution) é o caminho para o banimento e derrubaria o Hermes junto. O que o vendedor tira é o trabalho
  de achar, ordenar e escrever: o toque continua sendo dele, e o ritmo sobe sozinho (20/dia a partir de 23/10, 30 a
  partir de 30/10). A automação de verdade continua sendo a Fase 3 do plano de 15/10 (Cloud API com opt-in).

### 5. Botões "Jornada", "Resultados", "Colinha" perdidos
- **Tabs** ("rótulos de 1 a 3 palavras, descritivos"; "na ordem do fluxo"; "não use abas para esconder o que o
  usuário precisa ver"): cinco abas com nomes internos ("Colinha" é jargão; "Jornada" e "Funil" são duas vistas do
  mesmo funil; "Resultados" não diz de quê). **Feito:** quatro abas com nome de tarefa (**A fazer · Funil ·
  Números · Roteiro**), uma linha embaixo dizendo para que serve a aberta, e a Jornada virou o modo "Por passo da
  jornada" dentro do Funil.

### 6. Menu "pra que tem isso aqui?"
- **Navigation menu / progressive disclosure:** o Mais era uma lista plana de sete coisas iguais (inclusive
  "Agentes do SquadOne", que no Dell dava 404, e o Design system, que é ferramenta de quem mexe no visual), seguida
  de três painéis técnicos abertos. **Feito:** três grupos pelo motivo de abrir: **Usar** (Lançamentos, Entrada),
  **Entender** (como a operação funciona, fechado) e **Manutenção** (ferramentas, o que o Dell confere, design
  system; abre sozinho quando há falha). O link morto saiu.

### 7. Ficha do lead com carga cognitiva alta
- Eram dez blocos em sequência (cabeça + jornada, Agora, ação fixa, avisos, resposta, oferta, colinha, copiloto,
  anotar, consulta). **AI Suggestions/Layout:** "não empurre avisos críticos para baixo de uma resposta longa"; "não
  sobrecarregue a primeira tela com opções raras".
- **Feito:** (1) a **mensagem que vai sair** aparece antes do botão, para revisar sem abrir o WhatsApp às cegas;
  (2) **Conversa** no lugar de "Resposta"; (3) oferta, roteiro e copiloto viraram **uma seção "Como vender" com três
  abas**, abrindo na que o momento pede (copiloto do "respondeu" à proposta, roteiro quando o passo é escrever à mão,
  oferta no resto); (4) a jornada saiu do topo para a consulta (o "Agora" já diz o passo).

### 8. Falhas que disparam o Hermes
- **Notification** ("diga o que dá para fazer em seguida quando a recuperação importa"): o alerta dizia "peça ao
  Claude: …" e parava aí. **Feito (no Dell):** a falha nova dispara o **socorro**: primeiro o remédio seguro da lista
  (reiniciar a unidade daquela verificação, no máximo 2 vezes em 6 h), depois o Hermes para diagnosticar (com limite
  por verificação e por dia), e um aviso só com o resultado. Fora da lista, o Hermes descreve o pedido pronto para o
  Claude: não mexe em mais nada. Interruptor em `~/.config/socorro/desligado`.

### 9. Simulação das jornadas
- `server/jornadas-de-venda.test.ts` passa um lead do Site pelo retrato de verdade, do pronto ao "quero ver", e
  confere o que a fila manda fazer em cada passo. Achados corrigidos: o lead pedindo resposta depois da 2ª mensagem
  (Site e PRUMO) e a falta do "o que achou?". Confirmado como correto: nada para quem não leu, follow-up só para quem
  leu, só-robô como primeiro contato, nada fora do expediente.

## O que fica para depois (não feito hoje)

- **Medir o vendedor:** quantos avisos viram "Enviei" e quanto tempo do aviso ao envio (o `vendedor.json` tem o dia;
  falta o histórico). Sem isso não dá para saber se a proatividade aumentou a velocidade de resposta.
- **Proposta em um toque:** o gargalo é a proposta, e marcá-la ainda é um formulário no fim da Ficha. Um "Mandar a
  proposta" com o rascunho do copiloto (preço do cardápio) e a marcação automática fecharia o laço.
- **Revisar prospects (1.423):** é triagem, não venda, e estava na Hoje do CRM. Vale uma fila própria, fora de "A fazer".
- **Classificar a etapa da conversa por modelo:** com a conversa guardada, o Jev (em sombra) pode passar a medir "em
  que etapa está" contra a regra atual, antes de qualquer decisão automática.
- **Contraste e foco** dos componentes novos ainda não passaram pela auditoria de acessibilidade do design system.
