# Pares de fontes por nicho

Tabela de pares tipográficos para os sites de lead. Montada em 03/11/2026 a
partir das páginas gratuitas do Typewolf (o top 40 de Google Fonts, a
"Suggested Font Pairing" de cada fonte e os quatro top 10) e conferida no
Google Fonts no mesmo dia. **Revisar em maio de 2027.**

Por que existe: 11 demos de advocacia seguidos saíram em serif com itálico
sobre creme ou azul-marinho. A regra do passo 1.6 (não repetir a cor dominante
nem o par de fontes de nenhum dos últimos 5 do mesmo nicho) só funciona se
houver de onde escolher.

**Como usar, no passo 1.6 e no 3.2 (`/ui-ux-pro-max`, par tipográfico):**

1. Leia as últimas 5 linhas do `registro.md` do mesmo nicho e anote os pares
   usados.
2. Abra o índice "Por nicho" abaixo e escolha uma linha do nicho que não esteja
   entre esses 5. Prefira trocar também de classificação (se os últimos foram
   serif, vá de grotesca ou slab).
3. A escala e o peso do shot do Dribbble continuam mandando na hierarquia
   (tamanho do título, contraste entre título e texto). A tabela escolhe a
   família, não o tamanho.
4. Só Google Fonts (licença OFL ou Apache): é o que se pode recortar (subset) e
   embutir em base64 no arquivo. Escreva o par no `registro.md` com os nomes
   desta tabela, para a próxima consulta achar.

**Orçamento** ("Regras do arquivo"): no máximo 2 famílias, subset, 80 KB em
base64 somadas. Base64 pesa 1,33 vez o woff2, então 80 KB em base64 são cerca
de 60 KB de woff2. Medido em 03/11/2026, um peso no subset `latin` do Google:
Atkinson Hyperlegible Next 12 KB, Manrope 14 KB, Archivo 15 KB, Big Shoulders
15 KB, Source Sans 3 16 KB, Cabin 17 KB, Bitter 19 KB, Work Sans 20 KB,
Libre Baskerville 20 KB, Literata 20 KB, Source Serif 4 22 KB, Alegreya 23 KB,
Fira Sans 24 KB, Vollkorn 25 KB, **Merriweather 49 KB**. Na prática cabem três
arquivos (título, texto, texto em negrito); com Merriweather, recorte pelos
caracteres da página ou troque. Peça pesos estáticos (`wght@400;700`), nunca a
faixa variável inteira: Archivo com eixo de largura completo deu 90 KB.

## A tabela

(T) = par sugerido pelo próprio Typewolf, as duas fontes grátis. As demais
linhas foram montadas aqui com fontes do Google Fonts. Todas responderam 200 em
`fonts.googleapis.com/css2` com os pesos listados em 03/11/2026 (e 400 para
peso que não existe, como PT Sans 800 ou Cabin 800). "1 família" = a mesma
família no título e no texto: conta como uma só e gasta menos bytes.

| # | Par (título / texto) | Classificação | Clima | Nichos | Observação |
|---|---|---|---|---|---|
| 1 | Libre Franklin 800 / Libre Baskerville 400 (T) | grotesca americana + serif transicional | sóbrio, direto | advocacia, contabilidade, construção | Título em sans tira a advocacia do serif. Baskerville é larga e boa a 16-17 px. Tem itálico: não use no título. |
| 2 | Libre Franklin 400/700/800 (1 família) | grotesca americana | sóbrio, direto | advocacia, contabilidade, construção, aluguel | Título 800. Corpo a 16 px sim. A saída mais simples para advocacia sem serif. |
| 3 | Source Serif 4 600 / Source Sans 3 400 (T) | serif transicional + grotesca | sóbrio, editorial | advocacia, contabilidade, odontologia | No Typewolf aparece como Source Serif Pro / Source Sans Pro. **Risco do clichê**: serif + itálico + creme ou marinho. Título romano, fundo de outra cor. |
| 4 | Spectral 600 / Source Sans 3 400 (T) | serif contemporânea + grotesca | calmo, editorial | advocacia, estética, odontologia | Spectral é fina: título no mínimo 600. Mesmo risco do #3; sem itálico de destaque. |
| 5 | PT Sans 700 / PT Serif 400 (T) | sans humanista + serif transicional | institucional | contabilidade, advocacia, odontologia | Só 400 e 700 nas duas. Corpo a 16 px sim. Título em sans. |
| 6 | Archivo Narrow 700 / Merriweather 400 (T) | sans condensada + serif de tela | técnico, firme | contabilidade, advocacia, dedetização | Merriweather pesa 49 KB por peso: recorte pela página. Corpo a 16 px muito bom. |
| 7 | Alegreya 800 / Alegreya Sans 400 (T) | serif humanista caligráfica + sans humanista | artesanal, acolhedor | restaurante, estética | Superfamília (2 nomes, mesmo desenho). Título 700-800. Itálico bonito, mas não no fim do título. |
| 8 | BioRhyme 800 / Cabin 400 (T) | slab expandida + sans humanista | robusto, direto | construção, oficina, aluguel, restaurante | BioRhyme só no título (larga, sem itálico). Cabin vai até 700. |
| 9 | Zilla Slab 700 / Source Sans 3 400 | slab contemporânea + grotesca | técnico, sóbrio | advocacia, contabilidade, dedetização, desentupidora | Slab para advocacia sem cair no serif clássico. Zilla tem itálico. |
| 10 | Bitter 400/700/800 (1 família) | slab de tela | firme, legível | contabilidade, advocacia, oficina, desentupidora | Feita para tela: corpo a 16 px sim. Título 800. |
| 11 | Arvo 700 / PT Sans 400 | slab geométrica + sans humanista | direto | construção, oficina, aluguel, restaurante | Arvo só 400 e 700. Título no mínimo 700. |
| 12 | Work Sans 400/700/800 (1 família) | grotesca | técnico, direto | contabilidade, dedetização, desentupidora, estética | Título 800. Corpo a 16 px sim. 20 KB por peso. |
| 13 | Public Sans 400/700/800 (1 família) | grotesca neutra | sóbrio, técnico | contabilidade, odontologia, dedetização, advocacia | Neutra: o caráter vem da cor e da composição do shot. |
| 14 | Fira Sans Condensed 800 / Fira Sans 400 | sans humanista condensada + sans humanista | técnico | desentupidora, dedetização, oficina, aluguel | Mesmo desenho, 2 nomes no Google: conta como 2 famílias. |
| 15 | Barlow Condensed 700 / Barlow 400 | grotesca de placa rodoviária | direto, urgente | desentupidora, aluguel, oficina, construção | Barlow Condensed lê bem em título grande no celular. Texto 400, negrito 600. |
| 16 | Archivo largura 75 peso 800 / Archivo 400 (1 família) | grotesca com eixo de largura | direto, urgente | desentupidora, aluguel, construção, dedetização | Peça instâncias estáticas (`Archivo:wdth,wght@75,800` e `@100,400`, cerca de 15 KB cada). |
| 17 | Chivo 400/700/900 (1 família) | grotesca pesada | direto | construção, aluguel, oficina, contabilidade | Título 900. Corpo a 16 px sim. |
| 18 | Big Shoulders 800 / Public Sans 400 | grotesca condensada industrial + grotesca neutra | industrial, urgente | aluguel, construção, desentupidora, oficina | Big Shoulders só no título, a partir de 32 px. Sem itálico. |
| 19 | Rubik 400/500/700 (1 família) | sans de cantos arredondados | acolhedor | odontologia, estética, dedetização, restaurante | Título 700. Corpo a 16 px sim. |
| 20 | Manrope 400/700/800 (1 família) | grotesca geométrica | limpo, moderno | odontologia, estética, contabilidade | Sem itálico. 14 KB por peso. |
| 21 | Red Hat Display 700 / Red Hat Text 400 | grotesca geométrica, versão título + versão texto | sóbrio, moderno | odontologia, contabilidade, advocacia, estética | Display é para título; Text é para corpo a 16 px. |
| 22 | Atkinson Hyperlegible Next 400/700 (1 família) | grotesca de legibilidade | claro, acessível | odontologia, dedetização, contabilidade | A mais leve medida (12 KB). Boa para público mais velho. |
| 23 | Proza Libre 400/600/700 (1 família) | sans humanista | calmo | estética, odontologia, advocacia | Título 700. Corpo a 16 px sim. |
| 24 | Eczar 700 / Karla 400 | serif de contraste + grotesca | quente, artesanal | restaurante, estética | Eczar sem itálico, só título. Karla corpo a 16 px sim. |
| 25 | Abril Fatface 400 / Work Sans 400 | didone pesada + grotesca | marcante | restaurante, estética | Abril só tem 400 (já é preta). Título a partir de 40 px. Didone sobre creme é outro clichê. |
| 26 | Literata 400/700 (1 família) | serif contemporânea de livro | sóbrio | advocacia, contabilidade, odontologia | Serif que não é a de sempre. Título romano 700; itálico só no texto. |
| 27 | Vollkorn 400/700 (1 família) | serif old-style | tradicional, quente | restaurante, advocacia | 25 KB por peso. Advocacia só se os últimos 5 não forem serif. |
| 28 | Sofia Sans Condensed 800 / Sofia Sans 400 | grotesca com larguras | direto | dedetização, desentupidora, oficina, estética | Mesmo desenho, 2 nomes: conta como 2 famílias. |
| 29 | Young Serif 400 / Rubik 400 | serif de título pesada + sans arredondada | acolhedor, artesanal | restaurante, estética | Young Serif só tem 400. O Typewolf a junta com Syne, que está na lista de não usar. |

## Por nicho

| Nicho | Linhas |
|---|---|
| Advocacia | sem serif: 2, 13, 21, 23 · slab: 9, 10 · sans + serif: 1, 5, 6 · serif: 3, 4, 26, 27 |
| Odontologia, clínica | 3, 4, 5, 13, 19, 20, 21, 22, 23, 26 |
| Contabilidade | 1, 2, 3, 5, 6, 9, 10, 12, 13, 17, 20, 21, 22, 26 |
| Desentupidora, encanador | 9, 10, 12, 14, 15, 16, 18, 28 |
| Dedetização | 6, 9, 12, 13, 14, 16, 19, 22, 28 |
| Aluguel de equipamentos, andaimes | 2, 8, 11, 14, 15, 16, 17, 18 |
| Construção, reforma | 1, 2, 8, 11, 15, 16, 17, 18 |
| Oficina | 8, 10, 11, 14, 15, 17, 18, 28 |
| Estética | 4, 7, 12, 19, 20, 21, 23, 24, 25, 28, 29 |
| Restaurante | 7, 8, 11, 19, 24, 25, 27, 29 |

Todo nicho tem pelo menos 8 linhas e mais de uma classificação, então sempre
sobra par fora dos últimos 5.

## Não usar

- **Fontes padrão de IA** (impeccable 4.5.0: `reference/new-work.md`, seção 4,
  e a regra `overused-font` do detector; o `craft-floor.md` manda respeitar
  essas proibições). Aparecem em quase todo site gerado e denunciam a página:
  Inter, Roboto (e a família toda), Open Sans, Lato, Montserrat, Arial,
  Helvetica, Fraunces, Recoleta, Instrument Sans, Instrument Serif, Geist,
  Mona Sans, Plus Jakarta Sans, Space Grotesk, Space Mono, Playfair Display,
  Cormorant (e Cormorant Garamond), Lora, Crimson (Text e Pro), Newsreader,
  Syne, IBM Plex (Sans, Serif, Mono), DM Sans, DM Serif, Outfit. Por isso
  ficaram de fora quatro pares do Typewolf: Syne + Young Serif, Cormorant +
  Cabin, Roboto + Roboto Slab e IBM Plex Sans + IBM Plex Mono.
- **Serif grande em itálico como título** (o detector do impeccable também
  barra): é o clichê dos 11 demos de advocacia.
- **Poppins, Raleway, Oswald**: grátis e fora da lista acima, mas são a cara de
  template de 2015 a 2020. Só com motivo do shot.
- **Comerciais** (não estão no Google Fonts, não se embute): tudo dos quatro top
  10 do Typewolf (Ogg, Tiempos, GT Super, GT Sectra, Freight, Editorial New,
  Self Modern, Caslon, Garamond comercial, Apercu, GT America, Founders
  Grotesk, Neue Haas Grotesk, Graphik, Proxima Nova, Avenir, Futura, Circular,
  GT Walsheim, Sentinel, Adelle, Clarendon, Archer, Whitney, Gill Sans, Optima,
  Effra) e as fontes pagas que o Typewolf sugere ao lado de uma grátis (FF Meta
  Serif, Americana, P22 Underground, New Caledonia, Reckless, Minion, Sailec,
  Acta Display, FF Mark, Romana, Schneidler, Today Sans, FF Franziska). A
  maioria das fontes do "site do dia" do Typewolf também é comercial.
- **Fonte do sistema** (Arial, Helvetica, Times, Georgia, Segoe) como voz do
  título: o `craft-floor.md` trata isso como falha.
- Material pago do Typewolf (guias em PDF, lookbooks): fora.

## Português

O subset `latin` do Google cobre `U+0000-00FF`, que inclui todas as letras
acentuadas do português (ã, õ, ç, é, ê, á, â, à, í, ó, ô, ú, ª, º estão entre
`U+00C0` e `U+00FF` ou logo antes), e também `U+2000-206F` (travessão, aspas
curvas, reticências). Conferido em 03/11/2026 no CSS da Work Sans: o bloco
`/* latin */` traz `unicode-range: U+0000-00FF, ..., U+2000-206F, ...`. Use só
o bloco `latin`; `latin-ext` e `vietnamese` não fazem falta. Se recortar à mão
(`pyftsubset`), inclua pelo menos `U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026`,
senão um "Não" ou "Avaliações" sai com o acento na fonte reserva.
