# Kulniski Advocacia & Consultoria Jurídica — redesign de 14/10/2026

**No ar:** https://demo-kulniski-advocacia-consultoria.vercel.app (projeto `demo-kulniski-advocacia-consultoria-juridica`,
com o `og.jpg` novo e o `raio-x/` de produção, SHA-1 conferido). Feito fora do Dell: o conteúdo saiu do demo no ar
(versão de 09/10), não do `content.md`.

**Título:** "Advogada trabalhista e previdenciária em Ribeirão Preto". Uma frase com o ofício e a cidade. As duas
primeiras palavras da vitrine são Trabalhista e Aposentadoria; família, consumidor e direito médico vêm no apoio.

**O fato que distingue:** o WhatsApp é o celular da própria Dra. Carla, o mesmo (16) 98100-0093 pintado no vidro da
porta, embaixo do nome dela e da OAB/SP 408.980 (foto da vitrine, enviada pelo escritório ao Google). E ela responde
uma pergunta por post no Facebook e no TikTok (@kulniskiadvocacia), com o artigo de lei.

**Dribbble:** "Estate Planning Website Design / Law Firm Website Design", de Design Dundies — https://dribbble.com/shots/27783662;
aplicado:
- o hero dividido entre o painel do texto e o painel do retrato, com a mesma altura;
- a faixa das áreas logo abaixo do hero, de ponta a ponta (lá laranja com asteriscos; aqui o vidro preto da vitrine);
- as áreas como lista de perguntas, título à esquerda e lista à direita (o FAQ do shot), cada uma abrindo o que a
  lei diz, o que levar e o WhatsApp com a mensagem pronta;
- "Sharing her knowledge" virou "Quem atende": painel com texto e foto lado a lado, com as perguntas que ela já
  respondeu em público;
- o fecho num painel escuro, com o contato e o endereço;
- o botão chapado numa cor só.
Ficaram de fora, pelo Provimento 205/2021 e pela "Cara de IA": avaliações, prêmio, faixa de números, Instagram,
o mapa grande e a palavra do título em outra cor.

**Celular:** o retrato vem antes do título, em 16:10, para título, foto, botão e endereço caberem na primeira tela;
a foto da vitrine sai (a faixa já é a vitrine); 6,0 telas.

**O detalhe que só este negócio tem:** a faixa da vitrine. As oito áreas na ordem em que estão pintadas no vidro
preto da porta, em letra romana branca, com o fio da moldura do vidro; cada palavra abre a sua área na lista.
Salário-maternidade e inventário vêm da placa da fachada e estão no fim da lista, com a nota dizendo isso.

**Cores e fontes:** papel #f4f3f0 (o branco da fachada), vidro #151617, letra #f3f1ec, mogno #7a4430 (a estante do
escritório, no retrato). Newsreader (títulos e vitrine) e Instrument Sans (texto), subconjunto, 64 KB. Diferente dos
últimos de advocacia: AC Advocacia (Hanken Grotesk, creme, café e dourado), Jéssica Barbosa (DM Sans, vinho) e a
versão anterior desta (Cinzel + Hanken Grotesk, vidro azulado e vinho).

**Movimento:**
- título, apoio e retrato entram com fade e 12 px (CSS puro, 600 ms): a primeira tela chega montada;
- um reflexo de luz passa uma vez pelo vidro da vitrine quando ela aparece: é vidro, não um enfeite;
- o + da área gira para × ao abrir: mostra o que fecha;
- barra de WhatsApp no celular quando a primeira tela sai de vista; no computador, o topo fica preso com o menu.

**Conteúdo revisto:** divórcio e inventário em cartório estavam pela regra antiga ("sem filhos menores", "todos
maiores"); a Resolução 571/2024 do CNJ abriu o cartório nesses casos com condições, e o texto agora não fecha a porta.

**Saiu da versão anterior:** os cinco Atos e o menu I–V, o título "As palavras da vitrine, explicadas uma por uma",
o campo "ou escreva do seu jeito" com "Pôr no vidro", a pasta dos papéis desenhada, as frases do post entre aspas e a
placa dourada com a Têmis.

**Pedir à Dra. Carla:** foto da sala no Neo Ribeirão e o número da sala, o horário de todos os dias (o Google mostra
só "segunda a partir das 9h30; sexta até as 17h30"), a fachada atual em cor e o logo em vetor.

**Gate:** `qa-numerico` passou (201 KB; Ato I 131 KB; fontes 64 KB; 6,0 telas), rodado no PC com o Chrome no PATH.
