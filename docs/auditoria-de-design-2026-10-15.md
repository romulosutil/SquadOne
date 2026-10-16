# Auditoria de design da Central (15/10/2026)

Telas: **Hoje** (`src/rotas/HojeRota.vue`), **CRM** (`src/operations/Crm*.vue`,
`crm.css`) e **Finanças** (`src/operations/financas/*`), lidas contra
`src/estilos/design.md` e RULES 3, 4 e 13. Não é um redesenho: a casca, a
navegação, a paleta e o modo escuro ficam. A direção é uma frase só:
**força em ação e estado, calma em leitura.** Borda grossa, sombra dura e
amarelo marcam o que se toca e o que pede atenção; o resto (listas, linhas,
cartões que só informam) fica em linha fina, sem sombra.

## Já feito neste commit

- **A fonte.** A `--fonte` dizia `Inter` sem carregar nada; no Windows a
  Central inteira saía em **Arial Black**, um corte só, preto, sem hierarquia
  possível. Boa parte da impressão de "pouco profissional" era isso. A Inter
  variável agora mora em `src/estilos/fontes/` (latim + latim estendido,
  ~130 kB, `font-display: swap`) e o fallback é a pilha do sistema.
- **Pesos por token.** Os 147 `font-weight` numéricos (600, 700, 800, 900 e
  950, que não existe na Inter) viraram `--peso-texto` (450), `--peso-medio`
  (600), `--peso-forte` (700) e `--peso-titulo` (800). Texto corrido e campos
  ficam em 450: até ontem eram 600, que em Arial Black não fazia diferença.

Antes de mexer no resto, **olhe as três telas com a fonte nova**: parte do
que segue pode ter ficado menor (ou maior) do que parece no código.

## Prioridades

Esforço: **P** = uma tarde, só CSS; **M** = um dia, CSS + pouco template;
**G** = mais de um dia, componente novo.

| # | O que mudar | Por quê | Esforço |
|---|---|---|---|
| 1 | Escala tipográfica em tokens | 26 tamanhos de 0,58 a 1,5 rem só nessas telas | P |
| 2 | Linha fina e sem sombra no que não se toca | 3 px aninhados em 3 níveis no Funil | P |
| 3 | Uma sombra por pilha na Hoje | cartão com sombra dentro de bloco com sombra | P |
| 4 | Menos caixa alta espaçada | rótulo, kicker, h2 e pílula gritam igual | P |
| 5 | Tracking negativo moderado | -0,04 em é apertado demais para a Inter a 800 | P |
| 6 | Hover sem cor de estado | link passa a menta, que é a cor de "OK" | P |
| 7 | Tabela de Lançamentos no desktop | 72 rem de largura para uma coluna de lista | M |
| 8 | Lista em tabela no Funil do desktop | 310 Plus + "Em contato" viram colunas de rolagem | G |

### 1. Escala tipográfica em tokens (P)

Hoje há **26 tamanhos distintos** em rem entre `crm.css`, `financas.css`,
`agentes.css`, `casca.css` e a Hoje (0,58 · 0,66 · 0,7 · 0,72 · 0,74 · 0,75 ·
0,76 · 0,78 · 0,8 · 0,82 · 0,85 · 0,88 · 0,9 · 0,92 · 0,95 · 0,98 · 1 · 1,02 ·
1,05 · 1,1 · 1,15 · 1,2 · 1,3 · 1,35 · 1,4 · 1,5), mais quatro `clamp()` de
título diferentes. Diferença de 0,02 rem não se vê; o que se vê é que nada
parece pertencer à mesma família. `crm.css` sozinho tem 21.

Proposta: seis degraus em `tokens.css`, ao lado dos pesos:

```css
--tam-mini: 0.75rem;   /* selo, pílula, rótulo de campo */
--tam-apoio: 0.875rem; /* data, fonte, explicação, linha secundária */
--tam-texto: 1rem;     /* corpo, campos (16 px: o iOS não dá zoom) */
--tam-nome: 1.125rem;  /* nome do lead, título de cartão, h3 */
--tam-secao: 1.375rem; /* h2 de bloco, cartão da fila */
--tam-titulo: clamp(1.75rem, 6vw, 2.5rem); /* h1 da tela, total grande */
```

Troca mecânica, arquivo por arquivo (0,7–0,78 → mini; 0,8–0,92 → apoio;
0,95–1,02 → texto; 1,05–1,2 → nome; 1,3–1,5 → seção; os clamps → título).
Registrar a tabela em `design.md`. O 0,58 rem da barra inferior (9 px) é o
único abaixo do legível e deve subir para mini.

### 2. Linha fina e sem sombra no que não se toca (P)

`design.md` diz "3 px nos blocos, 2 px dentro", mas o CRM usa `--linha`
(3 px) 26 vezes, inclusive dentro de dentro. No quadro do Funil um lead tem
**três contornos de 3 px empilhados**: a coluna (`.crm-coluna`), o cartão
(`.crm-cartao`) e cada link do cartão (`.crm-cartao__links a`); a cabeça da
coluna ainda tem outra linha de 3 px embaixo. Com 15 cartões por coluna, a
tela vira grade de linhas pretas e o que importa (a resposta nova, o
follow-up de hoje) não se destaca de nada.

Regra a escrever em `design.md` e aplicar:

- **3 px** só no contorno externo de um bloco de tela (`.hoje__bloco`,
  `.fin-bloco`, `.crm-topo`, `.crm-coluna`) e em botão de ação.
- **2 px** (`--linha-fina`) em cartão de lista: `.crm-cartao`, `.crm-grupo`,
  `.crm-ficha__bloco`, `.crm-colinha__secao`.
- **1 px** a 35% (o divisor que `.crm-item` e `.fin-linhas` já usam) entre
  linhas de uma lista. Nada de borda em volta de cada linha.
- Links dentro de cartão do Funil (`.crm-cartao__links a`): 2 px, sem
  fundo, e só o primeiro (a ação do dia) em `--destaque`.

### 3. Uma sombra por pilha na Hoje (P)

Cada seção da Hoje é `.hoje__bloco` com `--sombra` (4 px), e os cartões de
decisão dentro dela (`.cartao`, em `agentes.css`) têm **outra** `--sombra`.
Sombra dura dentro de sombra dura achata tudo: nenhum dos dois parece estar
na frente. Regra: **a sombra fica no que se toca ou no que está por cima**
(botão, folha, cartão de decisão solto). Dentro de `.hoje__bloco`, o
`.cartao` perde a sombra e fica com a faixa colorida à esquerda (que já diz
o tipo, RULES 3). O mesmo para `.fin-bloco` no grid de Finanças (duas colunas
a partir de 64 rem): cada bloco com 4 px de sombra pesa mais do que os
números que carrega. Proposta: blocos sem sombra; ela fica no `.fin-topo`.

Os `border-left: 10px` da Hoje (`.hoje__precisa.is-falha` etc.) estão certos
e são o modelo: estado com cor **e** palavra.

### 4. Menos caixa alta espaçada (P)

Caixa alta com `letter-spacing` aparece em kicker (0,12 em), h2 da Hoje e de
Finanças, rótulo de campo do CRM (`.crm-filtros label`, `.crm-form label`),
`.crm-tag`, `.fin-pilula`, `.crm-fila__mensagem figcaption`, `.fin-dia h3`.
Quando tudo é rótulo gritado, nada é. Deixar caixa alta só em **selo e
pílula de estado** (curtos, 1–2 palavras). Rótulo de campo e h2 de seção em
caixa normal, `--peso-forte`; o kicker "SquadOne · PRUMO" pode ir para
`--texto-2` em caixa normal.

### 5. Tracking negativo moderado (P)

`letter-spacing: -0.04em` em todo h1/h2/h3 do CRM e `-0.03em` em Finanças e
na Hoje foram ajustados para a Arial Black, que é larga. A Inter a 800 já é
compacta: -0,04 em encosta as letras dos títulos e do nome do lead na Ficha. Usar
`-0.02em` no título grande e `-0.01em` (ou 0) de 1,125 rem para baixo.

### 6. Hover sem cor de estado (P)

`.crm-item__links a:hover`, `.crm-cartao__links a:hover` e
`.crm-ficha__links a:hover` pintam o fundo de `--ok-fundo` (menta), a mesma
cor de "Interesse" e de "Atualizada". Passar o mouse sobre "Mandar o link"
faz o link parecer já mandado. Hover em `--superficie-2` (como `.botao`) ou
`filter: brightness(0.95)` no primário.

### 7. Tabela de Lançamentos no desktop (M)

`FinLancamentos.vue` é uma lista por dia (`.fin-linhas`): nome e categoria
empilhados à esquerda, valor à direita, uma linha de 44 px por lançamento,
editor abrindo embaixo. No celular está certo. No desktop o bloco ocupa
72 rem e cada linha fica com um vão de meio metro entre o nome e o valor;
para revisar categoria de 40 lançamentos os olhos atravessam a tela 40
vezes.

A partir de 64 rem, uma `<table>` de verdade: **Data · Descrição ·
Categoria · Conta · Valor** (valor à direita, `tabular-nums`, sinal e cor
como hoje), cabeçalho fixo, linha de 40 px, zebra de 1 px em vez de
divisor, e o editor como linha expandida (`<tr>` com `colspan`) logo abaixo,
reaproveitando o `<form class="fin-editor">` atual. O agrupamento por dia
vira a coluna Data (com o dia repetido só na primeira linha do grupo).
Abaixo de 64 rem, a lista de hoje, intacta. `formato.ts` já tem o que a
tabela precisa.

### 8. Lista em tabela no Funil do desktop (G)

O quadro de quatro colunas do Funil (`CrmFunil.vue`) funciona para poucos
leads por etapa. Com o Plus (310 leads) e um "Em contato" que passa de 100,
cada coluna é uma rolagem própria de cartões altos (nome, etapa, marcos,
sinais, links: 6–8 linhas por lead), e comparar dois leads exige rolar
colunas diferentes. Os sinais (`.crm-sinal`, onze tipos possíveis por cartão) quebram
em duas ou três linhas de etiquetas.

Proposta, sem tirar o quadro: no desktop um terceiro botão no segmentado
**Quadro | Lista**, e a Lista é uma tabela com **Lead · Oferta · Etapa ·
Último toque · Próximo passo · Sinal mais forte · Ação**, ordenável por
Último toque e Próximo passo, linha de 44 px, um clique abre a Ficha na
folha como hoje. "Sinal mais forte" é **um** sinal, escolhido por ordem
(Resposta nova > Follow-up hoje > Prazo amanhã > Divergência > resto),
porque a tabela tem que caber numa linha; os outros ficam na Ficha. O filtro
de oferta, a busca e as travas de horário e de ritmo valem igual. É o item
mais caro e o de maior ganho para quem trabalha a fila sentado.

## O que não mudar

- **Cor só reforça** (RULES 3): selos, pílulas e semáforo já trazem a
  palavra. Nenhuma proposta acima tira texto de estado.
- **44 px de toque**, folha com "Fechar" escrito, foco visível de 3 px:
  estão certos em todas as telas auditadas.
- **Hoje com no máximo 3 cartões** (RULES 13) e o resto atrás de "Ver
  todas": a ordem e o limite estão certos; o problema ali é só a sombra em
  pilha (item 3).
- **Amarelo para a ação principal** (`--destaque`): continua sendo a única
  cor "de botão". O ganho dos itens 2–4 é justamente ele voltar a se
  destacar.

## Ordem sugerida

1–6 num commit só de CSS (+ a tabela de escala em `design.md`), olhado nas
três telas a 390 px e a 1280 px, claro e escuro. Depois 7, depois 8.
