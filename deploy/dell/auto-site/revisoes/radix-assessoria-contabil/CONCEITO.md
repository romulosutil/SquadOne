# Radix Assessoria Contábil: site-demo de 19/10/2026

**No ar:** https://demo-radix-assessoria-contabil.vercel.app (projeto `demo-radix-assessoria-contabil`, com `index.html` e `og.jpg`; sem `raio-x/`, que ainda não foi feito).
Feito fora do Dell, sem `content.md`: tudo saiu do Instagram @radixcontabilidade (bio, legendas, fotos e a série de
vídeos "Mande sua dúvida pra gente"). **A Radix não aparece no Google Maps**, então a página não tem nota, avaliação nem
horário. Também não tem site próprio hoje.

**Título:** "Assessoria contábil e consultoria tributária no Recife". Uma frase com o ofício nas palavras de quem procura
e a cidade. O subtítulo diz o que fazem, para quem (pequenas e médias empresas) e onde: Rua do Sossego, 577, em Santo Amaro.

**O fato que distingue:** os sócios respondem eles mesmos às dúvidas dos empresários em vídeo ("Mande sua dúvida pra
gente", com Luciano Ramos na maioria e Edvaldo Soares em outros), e o sócio fundador, Jefferson Tavares, participou do
workshop "Por dentro da Reforma Tributária" com contadores e empresários de todo o país (fim de benefícios fiscais, CBS e
IBS nos serviços, tributação dos dividendos). Fonte: legendas e vídeos do Instagram. Por isso a prova da página é a
reforma tributária (o que muda para quem está no Simples) e as cinco perguntas frequentes são as cinco dos vídeos.

**Dribbble:** Northline Advisory - Accounting Website — https://dribbble.com/shots/27713893; aplicado:
- o topo com o wordmark à esquerda, o menu curto no centro com nomes comuns (Serviços, Como funciona, Quem atende,
  Perguntas, Contato) e o botão chapado à direita;
- o hero em duas colunas no desktop: fio curto, título grande em serifa de alto contraste, parágrafo curto e o botão
  chapado à esquerda; a foto ocupando a metade direita e sangrando até a borda;
- a faixa de serviços logo abaixo do hero: cinco células com ícone de traço fino num círculo, nome e uma linha,
  separadas por fios verticais; aqui, os cinco serviços da bio, cada um com o seu WhatsApp de mensagem pronta;
- a faixa escura com foto à esquerda e título serifado à direita, aqui em verde-fechado: o escritório e "Quem atende",
  com os três sócios;
- o tom: sóbrio, editorial, muito respiro, fios finos, raio de 4 px.
Ficaram de fora: o rótulo em caixa alta espaçada acima dos títulos (só o fio curto), texto, logo, fotos e ícones do
shot, e qualquer faixa de números ou depoimento (a Radix não tem avaliações publicadas).

**O detalhe que só a Radix tem:** as barras subindo do logo, redesenhadas como marca gráfica discreta: no fio acima de
cada título (um traço e quatro barras em verde-limão), no sinal do wordmark, no favicon e num gráfico de barras em linha
fina na faixa escura. E a parede verde com o logo grande, que já está na foto do hero e no `og.jpg`.

**Wordmark provisório:** "Radix" em Bodoni Moda + "Assessoria Contábil" em Figtree, ao lado de um quadrado quase preto
com quatro barras verde-limão. Não é o logo oficial (a órbita e o R estilizado não foram redesenhados): o logo em vetor
tem de vir deles.

**Cores:** papel #f5f4ee, quase preto #201e1f (do logo) para texto, verde-limão #aacd4b (do logo) só como preenchimento
(botão com texto escuro, barras, marcas; nunca texto sobre fundo claro), verde-fechado #1c3a26 na faixa escura (a parede
verde do escritório, fechada), apoio #55524e (7,0:1 sobre o papel), texto claro #f1f3ea e #b9c8b4 sobre o verde (11,1:1 e
7,1:1). Botão limão com texto escuro: 9,1:1.

**Fontes:** Bodoni Moda (títulos, peso 500, eixo óptico 11–72, a serifa de alto contraste do shot) e Figtree (texto,
400–600, grotesca limpa e legível em tela pequena). Subconjunto latino, 45,6 KB em base64 somadas. Nenhum dos demos de
contabilidade anteriores usa esse par.

**Movimento:**
- título, subtítulo, botões e foto do hero entram com fade e 12 px (CSS puro, até 700 ms): a primeira tela chega montada;
- barra de WhatsApp e Ligar no celular quando o hero sai de vista (IntersectionObserver), que some no Contato;
- fio sob o topo quando a página rola; no desktop, o círculo do ícone do serviço fica limão no hover.
`prefers-reduced-motion` desliga tudo. Sem JS, todo o conteúdo aparece (a barra fixa não).

**Celular:** 5.038 px a 390 px = 5,97 telas de 844 (a foto do escritório em 4:3, com o rosto do Luciano acima da legenda). Na primeira tela: título, subtítulo, os dois botões e o começo da
foto. Nada vaza na horizontal. No celular, os serviços viram linhas inteiras clicáveis com uma seta, saem o parágrafo de
apoio do "Como funciona", o botão "Ligar" repetido do Contato e o link do Instagram ao lado das perguntas (o Instagram
está no Contato). Desktop conferido a 1440 e 1024 px (prints em `radix/prints/`).

**Peso medido:** 231,8 KB no total; 121,5 KB até o fim do hero; fontes 45,6 KB; foto do hero 49,6 KB em base64; fotos
de conteúdo 35,5 (escritório), 10,9, 19,2 e 25,8 KB (retratos); CSS 16,5 KB e JS 1 KB sem base64.

**Fotos (Instagram da Radix):** hero = vídeo DJwW6TcPT3A (Edvaldo diante da parede verde), recortado acima da caixa de
legenda e sem o selo do canto; escritório = vídeo DJmI3Ctvjnw (Luciano à frente, equipe nas mesas, quadros de frevo e
maracatu), sem a caixa, o selo e a tarja do nome; retratos de Jefferson e Edvaldo = só a foto de dentro da moldura dos
cards "Parabéns"; Luciano = vídeo DLXI65QNEhM.

**Pedir à Radix:**
- o logo em vetor (SVG ou PDF);
- o horário de atendimento;
- o número do CRC, se quiserem publicar;
- fotos em resolução maior (as do Instagram são quadros de vídeo de 1080 px, a do hero com compressão visível);
- confirmar se o CNPJ 17.070.164/0001-98, "Radix Consultoria e Assessoria Ltda", é deles: tem o mesmo telefone
  (81) 98871-7257 e o sócio José Luciano Silva Ramos, mas o CNAE não é contábil e o endereço é a Rua da Assembleia;
- criar a ficha no Google Maps (Perfil da Empresa) com o endereço da Rua do Sossego: hoje a Radix não aparece lá.
