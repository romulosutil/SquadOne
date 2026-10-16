# Service blueprint do SquadOne

`servico.json` é a fonte; `servico.html` desenha o quadro (publicado como Artifact, e lê o
JSON publicado ao lado). Formato da NN/g: uma coluna por passo da jornada e cinco faixas,
separadas por três linhas:

| Faixa (rótulo na página) | Nome na NN/g | Código | O que vai nela |
|---|---|---|---|
| O que ele recebe | Evidência | `E` | o que o cliente vê, recebe ou guarda (mensagem, site, evento, PDF) |
| O que ele faz | Jornada do cliente | `C` | o que ele faz; todo passo tem pelo menos um cartão aqui |
| — contato — | linha de interação | | |
| Quem ele vê | Palco | `P` | pessoas e tecnologia que ele vê (Rômulo, a Central, o bot) |
| — daqui para baixo ele não vê — | linha de visibilidade | | |
| Por trás | Bastidor | `B` | o que roda sem ele ver (n8n, travas, turno, classificação) |
| — a base — | linha de interação interna | | |
| Base | Processos de apoio | `A` | sistemas, dados e terceiros (Vercel, Google, Evolution, fila de avisos) |

Os rótulos mudaram na versão 2 (16/10/2026) para a linguagem de quem usa; os códigos, não.

## Códigos

- Serviço: `SITE` (Venda do Site), `PRUMO` (Venda do PRUMO), `OFERTAS` (Iris, Estamparias e Plus), `AGENDA` (Agenda pessoal).
- Passo: `<SERVIÇO>-<n>` (`SITE-3`).
- Cartão: `<passo>-<faixa><n>` (`SITE-3-B2` = 2º cartão do bastidor no passo 3 do Site).

- Tela da Central: `TELA-nn`. Otimização proposta: `OT-nn`.

Código publicado não muda nem se reaproveita: conversas e outros agentes citam por ele. Passo novo
só entra no fim do serviço (o teste exige a sequência); um passo que nasce no meio vira cartão do
passo mais perto, com o passo renomeado se for preciso (foi o que se fez com o "o que achou?" em
`SITE-6`).

## De uso (versão 2, 16/10/2026)

- **`etapas`**: as sete etapas comuns da venda (achar, preparar, 1º contato, resposta, mostrar valor,
  retorno, proposta e desfecho). Todo passo de venda diz a sua em `etapa`; a vista **Lado a lado** põe
  Site, PRUMO e Ofertas nas mesmas linhas, com os toques do Rômulo e os robôs de cada passo.
- **`numeros`**: o funil dos 30 dias por etapa, com data, fonte e referência. É retrato, não ao vivo:
  atualize junto com a análise que o mediu.
- **`telas`**: o inventário da Central (rota, perfil, para que serve, veredito: manter, fundir, cortar,
  renomear, mover), com os cartões que cada tela serve.
- **`otimizacoes`**: as propostas `OT-nn` (tipo, por quê, proposta, impacto, esforço, cartões e telas).
  São proposta; **a decisão é do Rômulo, na página**: Em aberto, Fazer, Depois, Não fazer, Feita, mais
  uma nota. Fica no banco do Artifact, coleção `decisoes`, um documento por OT
  (`{status, nota, atualizado}`); só o dono grava, quem tem o link só lê.
- **`glossario`**: um nome por coisa (o que se chama de vários jeitos hoje e o nome que fica).

Para seguir com as decididas, um agente lê o banco: `ArtifactData` `list` da coleção `decisoes` no
Artifact abaixo (ou o Rômulo cola o "Copiar as marcadas Fazer"). Feita uma OT, marque-a como Feita
no banco e atualize os cartões e telas que ela tocou no mesmo commit.

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
realce. Se um token do app mudar, copie o valor novo para lá. Quatro vistas: **Jornadas** (a partir
de 60 rem o quadro, passos em colunas, faixas em linhas, painel à direita; abaixo, uma lista por passo
e o cartão abre numa folha), **Lado a lado**, **Otimizar** (matriz impacto × esforço e a triagem) e
**Telas** (inventário e glossário). O endereço aceita `#lado`, `#otimizacoes`, `#telas` e qualquer
código (`#SITE-3-B2`, `#OT-04`, `#TELA-05`). Estados e vereditos usam os pastéis fixos das etapas do
funil do app, sempre com o nome escrito.

Para republicar, publique `servico.html` no mesmo Artifact
(https://claude.ai/artifact/HHyUrvFAPSHsLZq5ZXmgJh) com `servico.json` em `files` e `capabilities`
`{"db": {"rules": [{"path": "decisoes", "read": "view", "write": "admin"}]}}` (ou omita `capabilities`
para manter o que está guardado): a página lê o JSON publicado ao lado e mostra o erro se ele faltar.
Republicar não apaga a triagem.

O design system (tokens e componentes) é outra coisa: `/design-system` no app, `src/blueprint/tokens.ts`.
