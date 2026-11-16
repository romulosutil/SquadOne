# Revisão dos casos pendentes e retomadas — 22/10/2026

Conferência final: 19h14 de São Paulo. Foram revisados 35 contatos distintos,
com 26 rascunhos condicionais e próximo passo interno por caso. Os 35 registros
estavam atuais na conferência. Nenhuma mensagem aos contatos foi enviada por
esta revisão. A conta teve atividade concorrente, incorporada ao caso ControEco.

## Recortes

| Decisão analítica | Contatos |
|---|---:|
| Preparar próximo passo para revisão | 3 |
| Conferir encaminhamento | 2 |
| Aguardar resposta ou combinado | 19 |
| Recuperar contexto | 5 |
| Não priorizar | 6 |

ControEcoDDtização: acompanhar os prints já prometidos e solicitados ao time;
o “ok” posterior não comprova entrega nem apaga o pedido anterior sem link.
Piauí e Casa do Bordado: uma pergunta sobre a utilidade na rotina, depois de
conferir a conversa atual. Aldeia e The Best: validar o destino indicado.
RADIX tem pedido de bate-papo, mas retomada confirmada em 22/10; não duplicar.

O aparelho devolveu três mensagens da Piauí e cinco de Jeferson. Com autorização
específica para Gemini/Google, três áudios de Jeferson/Ddetize foram transcritos.
Nova Era não devolveu áudio; Masque, Recipeças e Ramavi continuaram sem conversa
recuperada. Um pedido de recuperação aceito tecnicamente não foi contado como
histórico recebido. Os recortes não representam backup integral do WhatsApp.

Jeferson foi marcado **sem contato**: o áudio confirma número errado. O pedido
de desculpas e o “ok” encerraram a conversa; nenhuma nova confirmação foi enviada.
Ddetize tratava de Instagram e já recebeu abordagens depois da sexta solicitada,
16/10; aguardar nova abertura, sem inventar retorno para a próxima sexta.
Lud continua sem reabertura automática. Os demais desfechos e planos foram mantidos.

## Refinamentos publicados

- Leitura contextual separa pedido de conversa de compra e de reunião aceita.
- Cartão de contato no mesmo lote conserva o texto do encaminhamento anterior.
- Saudação automática com horário de atendimento fica como robô.
- Notas `[revisao-retomada-v1]` guardam fato, próximo passo, condição, rascunho e
  base do contexto. Ficam visíveis em Diagnóstico/Números e nas fichas.
- Nova entrada, saída, registro comercial, resposta da fonte ou plano invalidam
  a revisão; a interface oculta o rascunho até nova conferência. Isso ocorreu
  durante a revisão da ControEco e foi verificado na Central.
- O observador reconhece o marcador legado `[áudio não transcrito]`, permitindo
  melhorar o mesmo registro com a transcrição, sem duplicar o áudio.
- Prompt do Grok atualizado no repositório para aplicação manual. Não foi
  alterada sua VM, frequência de duas revisões diárias ou rotina externa.

## Publicação e validação

Release no Dell: `~/.local/share/squadone-releases/retomadas-20261022`.
A aplicação foi montada sobre as fontes atuais do Dell. Sete arquivos da Central
foram publicados, preservando as alterações existentes na produção. A correção
posterior do marcador de áudio foi aplicada por fragmento nas fontes e no leitor
instalado; os dois observadores voltaram ativos. Backups ficaram na release.

Passaram 3.735 testes da base do Dell, a conferência de tipos e o build de produção.
Os testes direcionados de classificação, CRM e revisões somaram 51 casos. O leitor
passou nos 101 testes do Dell (um ignorado) e 97 locais (dois ignorados).
Conferidos também a interface, os recursos publicados e as 35 notas vigentes.
Notas anteriores ficam no histórico quando novas evidências exigem revisão.

Os 21 workflows do n8n mantiveram versão e ativação. As notas foram gravadas pela
rota existente do CRM, sem rotas ou tipos de registro de envio. Permaneceram:
5 primeiros envios/dia, 2/hora, intervalo de 30 minutos e as pausas existentes.
O executor continuou com cinco recibos no dia; último às 14h37, anterior à revisão.
O limite de 20 transcrições/dia foi preservado: quatro usadas no fechamento.

## Classificação no fechamento

Sobre 343 contatos com envio registrado: silêncio 206, robô 70, recusa 28,
neutra 19, permissão 6, acesso/encaminhamento 7, curiosidade 1, pedido de conversa 1
e contexto insuficiente 5. São classes da última evidência, não etapas cumulativas
nem contagem de quem já demonstrou interesse em algum momento. As cinco pendências
semânticas são Nova Era, Masque, Sansei, HG e Lud; não são o mesmo recorte dos cinco
contatos da fila analítica “recuperar contexto”.

Artefatos locais em `output/revisao-retomadas-2026-10-22/`: relatório por contato,
painel HTML, casos estruturados, conferência final, saúde dos serviços e captura
da Central. Os áudios não foram publicados como mídia pública.
