# Design do SquadOne

Mínimo, para as telas novas (finanças primeiro) não inventarem cor nem
tamanho. Tokens em `tokens.css`.

## Princípios

1. **Celular primeiro.** A tela nasce a 390 px, com 16 px de margem e sem
   rolagem lateral; o desktop só ganha colunas. Toque mínimo de 44 px.
2. **Texto antes da cor.** Todo estado tem palavra (RULES 3): "Atualizada",
   "Precisa de você", "Falhou". A cor só reforça. Semáforo sempre com rótulo.
3. **Número é o protagonista.** Valores em `tabular-nums`, alinhados à
   direita em lista, nunca cortados. Negativo leva sinal **e** cor.
4. **Uma fonte por número.** Toda tela de finanças diz "dados até dd/mm" e a
   saúde de cada conexão: número sem data é número que mente (RULES 2).
5. **Privacidade.** R$ e estabelecimento só aparecem nesta tela. Nada de
   valor em `title`, `aria-live` global, notificação ou URL (RULES 24).

## Tokens

| Token | Uso |
|---|---|
| `--fundo` | fundo da página |
| `--superficie`, `--superficie-2` | cartão; cartão dentro de cartão, faixa |
| `--texto`, `--texto-2` | texto; texto secundário (datas, fontes) |
| `--borda`, `--linha`, `--linha-fina` | contorno: ver "Força em ação e estado" abaixo |
| `--sombra`, `--sombra-pequena` | sombra dura, deslocada; nada de desfoque; uma por pilha |
| `--destaque` + `--destaque-texto` | seleção atual, ação primária |
| `--positivo`, `--negativo` | entrada/saída de dinheiro (com sinal) |
| `--ok-fundo`, `--atencao-fundo`, `--erro-fundo` | semáforo das conexões e avisos |
| `--barra-*` | barra inferior (celular) e trilho lateral |
| `--esp-1…6` | espaço, múltiplos de 4 px |
| `--fonte` | Inter variável, hospedada em `fontes/` (nunca depender da instalada) |
| `--peso-texto`, `--peso-medio`, `--peso-forte`, `--peso-titulo` | 450 texto e campos; 600 rótulo e apoio; 700 nome, valor e botão; 800 título e total. Nada de número solto |
| `--tam-mini…--tam-titulo` | seis tamanhos (tabela abaixo). Nada de rem solto em `font-size` |

### Tamanhos

| Token | Valor | Uso |
|---|---|---|
| `--tam-mini` | 0,75 rem (12 px) | selo, pílula, sinal, legenda da barra inferior; o menor que se escreve |
| `--tam-apoio` | 0,875 rem (14 px) | data, fonte, explicação, rótulo de campo, linha secundária, botão compacto |
| `--tam-texto` | 1 rem (16 px) | corpo e campos (16 px: o iOS não dá zoom no foco) |
| `--tam-nome` | 1,125 rem (18 px) | nome do lead, título de cartão, h2 de bloco da Hoje e de Finanças, h3 |
| `--tam-secao` | 1,375 rem (22 px) | h2 de seção grande, cartão da fila, número de coluna, ícone grande |
| `--tam-titulo` | clamp(1,75 rem, 6 vw, 2,5 rem) | h1 da tela, total e contagem grandes |

Tracking: `-0.02em` no `--tam-secao` e no `--tam-titulo`; `-0.01em` (ou 0) do
`--tam-nome` para baixo. A Inter a 800 já é compacta: mais apertado que isso
encosta as letras.

### Força em ação e estado, calma em leitura

- **3 px** (`--linha`) só no contorno externo de um bloco de tela
  (`.hoje__bloco`, `.fin-bloco`, `.crm-topo`, `.crm-coluna`, `.crm-ficha__cabeca`)
  e em botão ou link de ação.
- **2 px** (`--linha-fina`) em cartão de lista (`.crm-cartao`, `.crm-grupo`,
  `.crm-ficha__bloco`, `.crm-colinha__secao`), campo e selo.
- **1 px a 35%** de `--borda` entre linhas de uma lista (`.crm-item`,
  `.fin-linhas`). Nada de borda em volta de cada linha.
- **Sombra** só no que se toca ou no que está por cima (botão, folha, cabeça da
  tela, cartão de decisão solto). Uma por pilha: o `.cartao` dentro de
  `.hoje__bloco` e os `.fin-bloco` não têm; cartão de lista também não.
- **Caixa alta espaçada** só em selo e pílula de estado (`.selo`, `.crm-tag`,
  `.fin-pilula`: uma ou duas palavras). Rótulo de campo, kicker e título de
  bloco em caixa normal.
- **Hover** nunca em cor de estado: `--superficie-2` no comum e
  `brightness(0.95)` no primário. Menta (`--ok-fundo`) é "Interesse" e
  "Atualizada"; num link, parecia já mandado.

Auditoria de 15/10/2026 (escala de tamanhos, onde vai borda de 3 px e sombra,
tabela no desktop): `docs/auditoria-de-design-2026-10-15.md`.

Modo escuro: `prefers-color-scheme: dark`, a não ser que `<html data-theme="light">`;
`data-theme="dark"` força. Só os semânticos mudam; a paleta fica.

## Navegação

- Abaixo de 1024 px: **barra inferior** Hoje · Funil · ＋Pedir · Finanças ·
  Mais, fixa, com a área segura do iPhone. O ＋Pedir é o gesto principal
  (maior, em `--destaque`) e abre a folha Pedir; sem a agenda no processo fica
  desabilitado com o motivo escrito ("sem agenda aqui"). No Easypanel, sem
  Funil nem Finanças: Hoje · Agenda · ＋Pedir · Escritório · Mais.
- A partir de 1024 px: **barra lateral** com todos os destinos (Agenda,
  Escritório e Entrada inclusive), o Pedir em cima e "Buscar e ir" (Ctrl+K /
  ⌘K) embaixo.
- O item atual leva `aria-current="page"` e o fundo `--barra-ativo`.

## Folha (Sheet)

Tudo que abre por cima é uma folha (`components/Sheet.vue`): sobe de baixo no
celular, com alça, e vira diálogo no meio da tela a partir de 48 rem. Título
sempre; botão **Fechar** com texto (nunca só ✕); ação principal no rodapé, à
direita. Esc fecha, o foco fica preso dentro e volta a quem abriu. Durante um
envio a folha não fecha ("Aguarde…" no lugar de "Fechar").

## Agentes

- **Cartão de decisão** (contratação, troca de squad): `.cartao--decisao`,
  faixa `--acento` à esquerda; ajuste de tempo em `--positivo`; falha do Dell
  em `--negativo`. Selo em caixa alta com a palavra, nunca só a cor.
- **Estado de agente** (`.estado`): ponto + palavra. Sem fonte é "Sem sinal",
  com o ponto tracejado e o texto em `--texto-2` — nunca "ocioso" inventado.
- **Segmentado** (Auto/Foco/Baixa, Lista/Mapa, Site/Organizar): 44 px por
  botão, `aria-pressed`, o escolhido em `--destaque`.

## Componentes de finanças

- **Bloco**: `--superficie`, `--linha`, sem sombra (ela fica no `.fin-topo`), título curto em cima
  ("Tenho", "Devo", "Gastei") e o total grande logo abaixo.
- **Barra de proporção**: largura em %, sempre com o número ao lado; nunca a
  barra sozinha.
- **Semáforo de conexão**: pílula com a palavra (OK, Atualizando, Atenção,
  Erro) e o fundo correspondente.
