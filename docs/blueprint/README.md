# Service blueprint do SquadOne

`servico.json` é a fonte; `servico.html` desenha o quadro (publicado como Artifact, e lê o
JSON publicado ao lado). Formato da NN/g: uma coluna por passo da jornada e cinco faixas,
separadas por três linhas:

| Faixa | Código | O que vai nela |
|---|---|---|
| Evidência | `E` | o que o cliente vê, recebe ou guarda (mensagem, site, evento, PDF) |
| Jornada do cliente | `C` | o que ele faz; todo passo tem pelo menos um cartão aqui |
| — linha de interação — | | |
| Palco | `P` | pessoas e tecnologia que ele vê (Rômulo, a Central, o bot) |
| — linha de visibilidade — | | |
| Bastidor | `B` | o que roda sem ele ver (n8n, travas, turno, classificação) |
| — linha de interação interna — | | |
| Processos de apoio | `A` | sistemas, dados e terceiros (Vercel, Google, Evolution, fila de avisos) |

## Códigos

- Serviço: `SITE`, `PRUMO`, `AGENDA`.
- Passo: `<SERVIÇO>-<n>` (`SITE-3`).
- Cartão: `<passo>-<faixa><n>` (`SITE-3-B2` = 2º cartão do bastidor no passo 3 do Site).

Código publicado não muda nem se reaproveita: conversas e outros agentes citam por ele.

## Marcas de um cartão

`momento` (momento da verdade), `dor`, `metrica`, `opcao` (opção de projeto/algoritmo),
`seguranca`, `melhorias`. Todas listas de frases curtas, exceto `momento` (booleano).
`arquivos` aponta onde o cartão mora no repositório; `ligacoes` do serviço são pares
`[de, para]` de cartões.

## Para um agente

1. Leia `servico.json`; ache o cartão pelo código que a pessoa citou.
2. Os `arquivos` dele são o ponto de partida no código; as `ligacoes` dizem o que vem antes e depois.
3. Mudou o comportamento de um passo? Atualize o cartão no mesmo commit. `src/blueprint/servico.test.ts`
   falha se um código quebrar, uma ligação apontar para o nada ou um arquivo citado sumir.

## A página

`servico.html` usa a linguagem do app (16/10/2026): Inter, os tokens de `src/estilos/tokens.css`
copiados no `:root` dela (o Artifact não lê o repositório) e as regras BP-R1 a BP-R4 do
`design.md`: um nível de contorno de 2 px (cartão, campo, botão, painel), canto 16/10/6 px,
amarelo no cartão escolhido, sombra dura só no "Copiar para a conversa" e a dica em zona de
realce. Se um token do app mudar, copie o valor novo para lá. A partir de 60 rem é o quadro (passos em colunas, faixas em linhas, painel à
direita); abaixo, uma lista por passo, e o cartão abre numa folha. Uma ação só por cartão:
"Copiar para a conversa", que leva código, arquivos, marcas e ligações; o resto se cita pelo código.

Para republicar, publique `servico.html` no mesmo Artifact
(https://claude.ai/artifact/HHyUrvFAPSHsLZq5ZXmgJh) com `servico.json` em `files`: a página lê o JSON
publicado ao lado e mostra o erro se ele faltar.

O design system (tokens e componentes) é outra coisa: `/design-system` no app, `src/blueprint/tokens.ts`.
