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
| `--borda`, `--linha`, `--linha-fina` | contorno (3 px nos blocos, 2 px dentro) |
| `--sombra`, `--sombra-pequena` | sombra dura, deslocada; nada de desfoque |
| `--destaque` + `--destaque-texto` | seleção atual, ação primária |
| `--positivo`, `--negativo` | entrada/saída de dinheiro (com sinal) |
| `--ok-fundo`, `--atencao-fundo`, `--erro-fundo` | semáforo das conexões e avisos |
| `--barra-*` | barra inferior (celular) e trilho lateral |
| `--esp-1…6` | espaço, múltiplos de 4 px |

Modo escuro: `prefers-color-scheme: dark`, a não ser que `<html data-theme="light">`;
`data-theme="dark"` força. Só os semânticos mudam; a paleta fica.

## Navegação

- Abaixo de 1024 px: **barra inferior** Hoje · Funil · ＋Pedir · Finanças ·
  Mais, fixa, com a área segura do iPhone. O ＋Pedir fica desabilitado (com
  "em breve" escrito) até a mudança da agenda para o Dell.
- A partir de 1024 px: o trilho lateral da Central, com os mesmos destinos.
- O item atual leva `aria-current="page"` e o fundo `--barra-ativo`.

## Componentes de finanças

- **Bloco**: `--superficie`, `--linha`, `--sombra`, título curto em cima
  ("Tenho", "Devo", "Gastei") e o total grande logo abaixo.
- **Barra de proporção**: largura em %, sempre com o número ao lado; nunca a
  barra sozinha.
- **Semáforo de conexão**: pílula com a palavra (OK, Atualizando, Atenção,
  Erro) e o fundo correspondente.
