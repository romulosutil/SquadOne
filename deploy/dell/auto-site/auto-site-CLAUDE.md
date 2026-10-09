<!-- Cópia instalada de ~/SquadOne/deploy/dell/auto-site/auto-site-CLAUDE.md. Não edite aqui: mude por PR no SquadOne e reinstale (dell-status --instalados mostra o comando). -->

# Workspace `auto` — esteira "Site antes da venda"

Esta pasta mora no Dell (`~/auto-site`). O n8n escreve aqui de um lado (o
Caçador manda pacotes que o `auto-entrada` materializa) e o Claude Code trabalha
do outro. **A pasta é o barramento entre os dois — não existe API nem webhook
ligando um ao outro.**

A esteira é a frente "Vender mais" do PRUMO, que é dono de tudo. No Drive,
esta pasta aparece em `Meu Drive/PRUMO/Sites antes da venda`, um espelho **só
de leitura** que o próprio Dell atualiza a cada hora (`backup-dell`). Nada aqui
depende do Drive, e editar lá não volta para cá. Até 25/09/2026 o espelho era
`Meu Drive/auto`, pelo PC que queimou.

## O que tem nesta pasta

```
auto/
├── CLAUDE.md                        este arquivo
├── .claude/commands/lead-novo.md    comando da esteira (/lead-novo)
├── registro.md                      log de tudo que foi publicado
├── Leads — Site antes da venda.gsheet
├── _descartados/                    leads avaliados e rejeitados — NÃO é fila
├── _concluidos/                     sites publicados sem retorno do lead (expirado entra sozinho) — NÃO é fila
├── _em-conversa/                    leads que responderam e não fecharam (entra sozinho) — NÃO é fila
├── _recusados/                      leads que recusaram (botão "Recusou" da página do lead) — NÃO é fila
├── _fechados/                       leads que fecharam negócio (botão "Fechou") — NÃO é fila
└── <slug-do-negocio>/               uma pasta por lead, criada pelo n8n
    ├── content.md                   ficha do lead — LEIA PRIMEIRO
    ├── Fotos/                       até 5 fotos do Google Places
    ├── Logotipo/                    foto de capa do Google Meu Negócio
    ├── index.html                   ← o que você produz
    └── publicado.json               ← o recibo que devolve o lead ao n8n
```

**Um lead está pronto para trabalho quando tem `content.md`, não tem
`index.html`, mora direto em `auto/<slug>/` (não dentro de `_descartados/`),
e o slug ainda não aparece no `registro.md` como "não publicado".** É essa a
fila. Nada além disso define o que fazer a seguir.

**`_descartados/` não é fila, nunca varra essa pasta procurando trabalho.**
Criada em 17/09/2026 depois de duas varreduras seguidas caírem nos mesmos 6
leads quebrados (Belleviva, Clínica Biavatti, Espaço A, Face Doctor Itaim,
CareCrafters, Family Plus — todos com linha `— (não publicado)` no
`registro.md`, ver 16-17/09/2026). São leads já avaliados e rejeitados
(negócio já tem site, é franquia com site da rede, ou ficha falsa) que o n8n
continuava trazendo de volta pro topo da fila. Mover para lá, em vez de
apagar, mantém `content.md`/`Fotos`/`Logotipo` recuperáveis se o Rômulo quiser
checar depois, sem que apareçam em buscas ou varreduras por descuido.

**`_concluidos/` também não é fila.** Criada em 18/09/2026 a pedido do Rômulo:
guarda os leads que já tiveram site publicado (`index.html` + `publicado.json`)
e não deram retorno. Só o GB Sports (`gb-sports-crosstraining`) ficou de fora,
porque respondeu, mesmo sem fechar — foi para `_em-conversa/` (também não é
fila), reservada a leads que responderam e ainda não fecharam nem morreram.
Desde 29/09/2026 as duas pastas se enchem sozinhas (ver "Depois do envio" em
"Planilha"): lead que responde vai para `_em-conversa/`, e lead enviado sem
resposta em 10 dias vira `expirado` e vai para `_concluidos/`. Você não move
nenhuma das duas à mão. O demo de quem expirou é pausado na Vercel 15 dias
depois (mesma regra dos recusados, abaixo).

**`_recusados/` também não é fila.** Criada em 25/09/2026 a pedido do Rômulo,
quando a I&C Climatização (`i-c-informatica-climatizacao-solucoes-em-ar-condicionado`)
negou sem nem abrir o site. Guarda os leads que tiveram site publicado,
responderam e recusaram: diferente de `_concluidos/` (silêncio),
`_em-conversa/` (conversa viva) e `_descartados/` (rejeitado por nós antes de
publicar). **Desde 30/09/2026 a recusa se marca sozinha:** cada lead tem uma
página (`…/webhook/lead?id=<place_id>`, na coluna `acoes_link` da planilha e no
resumo das 10:30 do Hermes) com os botões Recusou, Fechou e Desfazer. O toque
muda a planilha (`status` `recusado`, `recusado_em`), move a pasta para cá e
anota a linha `**Recusou.**` no `registro.md`; nada vai para o lead. Se o
Rômulo avisar uma recusa numa sessão, mande-o ao link do lead (ou, sem ele,
mova a pasta à mão e anote a linha como antes; não mexa na planilha). **O demo
fica no ar por 15 dias depois da recusa e então é pausado na Vercel**
(`site-demos-pausa`, todo dia às 09:40): pausado, nunca apagado, e a pasta fica
aqui. Se o lead voltar (Desfazer), o demo volta ao ar sozinho.

**`_fechados/` também não é fila.** Criada em 30/09/2026 para o botão "Fechou"
da página do lead: guarda quem fechou negócio (`status` `fechado`,
`fechado_em`, linha `**Fechou.**` no `registro.md`). Não é `_concluidos/`
(silêncio); o demo de quem fechou nunca é pausado. Desfazer devolve a pasta
para onde estava.

**Balanço de 25/09/2026:** o Rômulo informou que, dos 75 sites publicados até
ali, só o da Pousada Caminho do Mar (`pousada-caminho-do-mar-de-paraty`) não
recusou. Os outros 74 (os 34 que estavam na raiz, os 38 de `_concluidos/`, o
GB Sports e a I&C) foram para `_recusados/`, e o Caminho do Mar foi para
`_em-conversa/`. `_concluidos/` ficou vazia e continua valendo para os
próximos leads que ficarem sem resposta.

**Regra contra retrabalho:** antes de processar um item da fila, procure o
slug em `registro.md`. Se já tiver linha com `— (não publicado)`, o lead já
foi avaliado e descartado — não reabra sem informação nova (ex.: `content.md`
mudou, o site concorrente saiu do ar). Grave `<slug>/DESCARTAR.md` (1ª linha: o
motivo; depois as evidências) e passe para o próximo: quem move para
`_descartados/` é o runner (05/10/2026; na execução automática você não move pastas). Isso não substitui marcar `descartado` na planilha (o
n8n faz isso lendo o Sheets, não esta pasta) — é só para o Claude Code não
perder tempo reavaliando o que já está resolvido.

**Confira a premissa "sem site" também nas fotos, não só pelo nome.** Antes de
construir, olhe fachada, montra, placa e vinil da porta atrás de domínio
(`www.…`), @ de Instagram ou nome de rede diferente do nome do lead, e teste
cada domínio achado (`curl`). Aconteceu em 21/09/2026 com a ODS (Entrecampos,
Lisboa), que estava em 1º na triagem de 18/09: a busca pelo nome "ODS" não
achou site nenhum, mas a foto-3 (fachada) trazia `www.ondadesorrisos.com`
debaixo dos telefones. A ODS é a unidade Entrecampos da rede Onda de Sorrisos
(3 clínicas), com site no ar listando o mesmo endereço e o mesmo fixo do
`content.md`. Rede com site = descarte (registre no `registro.md` e grave `<slug>/DESCARTAR.md`
com o motivo e as evidências; o runner move a pasta para `_descartados/`).
Proposta aprovada pelo Rômulo em 21/09/2026.

**Teste o domínio do e-mail antes de concluir "sem site".** Se o `content.md`,
a página do Facebook ou a bio trouxerem um e-mail em domínio próprio
(`vendas@negocio.com.br`), o domínio existe: teste ele com `curl` mesmo que a
busca pelo nome não tenha achado site nenhum. Aconteceu em 22/09/2026 com a
ArredArte (Campinas): a busca pelo nome não achava nada, mas o e-mail da
página do Facebook era `vendas@arredarte.com.br`, e o domínio respondia 200.

**Domínio no ar não é site no ar: olhe o que tem dentro.** No caso da
ArredArte o `arredarte.com.br` era WordPress cru, com 165 caracteres de texto
visível e o conteúdo inteiro sendo o "Hello world! Welcome to WordPress." de
instalação, sem página nenhuma em `/wp-json/wp/v2/pages`, e o botão "NOSSO
SITE" da bio dava 404. Isso **não** é site, e o lead continua válido. Mais que
isso: domínio pago, WordPress instalado, Google Tag Manager e Facebook Pixel
configurados e nada publicado é sinal de compra, não de descarte — o dono já
tentou ter site e não saiu. Anote no `registro.md` para o Rômulo usar na
abordagem. Para decidir, extraia o texto visível (tire `script`/`style`, tire
as tags) e conte: tema padrão e post "Hello world" = sem site; páginas reais
com serviço, endereço e contato = descarte.

**Conte o texto DEPOIS de renderizar, nunca no HTML do `curl`.** Site feito em
React, Vue ou construtor moderno entrega o HTML quase vazio e monta o conteúdo
no navegador: o `curl` devolve zero caractere visível e você conclui "sem
site" para um negócio que tem site. Use
`chrome --headless=new --virtual-time-budget=9000 --dump-dom <url>` e conte no
DOM renderizado. Aconteceu em 22/09/2026 com a Olivvare (Ribeirão Preto): o
`curl` deu 0 caractere visível, o DOM renderizado deu 3707, com menu de sete
itens, showroom e catálogo de produtos. Era descarte, e a regra sem este
parágrafo mandaria construir.

**O domínio tem que ser do negócio, não parecido com o nome dele.** Antes de
descartar, confirme que o site é do MESMO negócio: cidade, telefone e ramo
batendo com o `content.md`. Aconteceu em 22/09/2026 com a Casa Simões
(marcenaria em Ribeirão Preto): `casasimoes.com.br` responde 200 com site
grande, mas é uma loja de equipamentos de segurança e ferramentas em Santos,
com DDD 13. Nome parecido não é o mesmo negócio, e descartar por isso é perder
lead bom.
Proposta aprovada pelo Rômulo em 22/09/2026.

**Presença digital fraca ou nula: pare e devolva pro Rômulo.** Diferente dos
casos acima (site já existe, franquia, ficha falsa — você decide e registra
sozinho), quando o `content.md` trouxer indício forte de presença digital
fraca ou nula — o mais comum é faltar WhatsApp **e** e-mail, mas vale também
sem Instagram, sem site, sem avaliação recente, telefone que não bate em
diretório nenhum — o primeiro trabalho não é seguir a esteira. É descobrir se
o negócio ainda funciona: Google Business "permanentemente fechado", data da
avaliação mais recente, endereço/telefone batendo (ou não) em diretórios
(Yelp, Doctoralia, Facebook, guiamais etc.), redes sociais paradas há anos.
Feita essa checagem, **pare** — não construa, não descarte, não mova para
`_descartados/` sozinho. Volte com o que achou (funciona ou não, e as fontes)
e deixe a decisão de seguir ou não com o Rômulo.

## O que você entrega

Um `index.html` dentro da pasta do lead. Landing page de conversão para uma
PME que **hoje não tem site nenhum** — o dono nunca se viu na internet, e essa
página é a primeira vez.

Desde 08/10/2026 a página não é uma pilha de seções: é uma história curta em
**cinco Atos**, guiada por **uma metáfora do ofício** do negócio, com movimento
que sempre quer dizer alguma coisa (passo 1.5.1 e "Barra de excelência"). O
negócio tem de parecer experiente e confiável, nunca amador, e nenhuma frase
pode gerar medo ou desconfiança.

### Regionalidade (escopo ampliado em 16/09/2026)

Pedido do Rômulo, quando o n8n começou a trazer leads de Miami: o escopo deixou
de ser "negócio brasileiro" e virou **PME de qualquer país, adaptada à
regionalidade dela**. Brasil: português, WhatsApp. Fora do Brasil: antes do
`/design`, pesquise como aquele mercado contrata aquele tipo de negócio (canal
de contato que o cliente local usa de fato, idioma ou idiomas do bairro,
convenções de preço/seguro/agendamento, o que a concorrência local mostra) e
replique isso. Idioma da página, `lang`, `alt`, formato de telefone e endereço,
e o CTA principal seguem o mercado, não o Brasil. Anote no `registro.md` o que
a pesquisa mostrou, para virar regra quando o mesmo país se repetir.

Continua valendo tudo o mais: premissa "sem site" (confira antes), nada
inventado, franquia/rede fora.

<!-- site-nichos.py: início (não edite entre os marcadores; rode o script) -->
### Ramos novos: urgência, escritório, indústria (desde 05/10/2026)

Migração de nicho do Rômulo: 83 demos de B2C de vitrine (pousada, eventos,
estética, academia...) deram 0 interesse. Agora o Caçador traz serviço que o
cliente procura no Google para contratar. A premissa "sem site" e o "nada
inventado" continuam; muda o que a página precisa provar para quem chega
pelo Google:

- **Advocacia** (Provimento 205/2021 da OAB): sóbria e informativa. Sem
  avaliações nem depoimentos de clientes na página, sem promessa de resultado
  ("garantido", "ganhe sua causa"), sem preço, sem superlativo ("o melhor",
  "referência"), sem chamada de venda ("consulta grátis", "promoção").
  Entra: áreas de atuação explicadas em linguagem simples, quem atende, como
  funciona o primeiro atendimento, endereço e contato. Número da OAB só se o
  próprio advogado o publica. CTA: "Falar com o escritório" no WhatsApp.
- **Contabilidade**: serviços (abertura de empresa, MEI, Simples, folha,
  imposto de renda), para que porte de empresa, quem atende. CRC só se
  publicado. Avaliações podem entrar.
- **Indústria e B2B** (usinagem, caldeiraria, locação de equipamentos): quem
  compra é empresa. Capacidades, processos, materiais, setores atendidos e
  região de entrega, sem inventar máquina nem certificação: o que as fotos, as
  avaliações e a pesquisa não mostram fica genérico ("peças sob desenho").
  CTA: "Pedir orçamento" no WhatsApp, com o texto já pedindo desenho ou
  quantidade.
- **Urgência** (desentupidora, dedetizadora, caçamba): o cliente chega com
  pressa, pelo celular. WhatsApp e ligar fixos na tela, região atendida,
  serviços em lista, horário como o Google diz ("24 horas" só se estiver lá).
  Laudo ou certificado para condomínio e Vigilância só se o negócio já cita.
- **Saúde** (psicologia, odontologia, medicina) saiu das buscas: os conselhos
  proíbem depoimento. Se um lead assim aparecer, nada de avaliações na página.
<!-- site-nichos.py: fim -->

### Regras do arquivo

- **Um arquivo só.** CSS e JS inline. Nada de CDN, nada de build, nada de
  framework. Tem que abrir offline e nunca quebrar.
- **HTML de frontend, limpo e legível.** Sem abstração antecipada: nada de
  objeto de configuração, nada de placeholder de API, nada de marcação de
  componente. Só HTML bem escrito, semântico, que um dev consegue pegar e
  continuar no dia em que o cliente quiser mais.
- **Impecável no celular.** É lá que o dono vai abrir o link: pelo WhatsApp,
  num celular médio (CPU lenta, 4G). Projete em 390×844 primeiro; nada depende
  de hover, alvo de toque de 44 px, nada passa de 390 px na horizontal.
- **CTA principal: WhatsApp** (Brasil), com o telefone real do `content.md`.
  Fora do Brasil, o canal que o mercado local usa (ver Regionalidade). O `href`
  real (`https://wa.me/...`) está no HTML de todo CTA, não só no JS.
- **Sem JavaScript, tudo visível.** Estado inicial escondido só sob uma classe
  que o JS põe (`html.js`); o título e a foto do Ato I nunca começam com
  `opacity: 0` nem esperam script: a entrada deles é CSS puro, começa no
  primeiro quadro e acaba em até 700 ms. (Em 08/10/2026 o hero de um demo de
  advocacia só aparecia depois de dois `requestAnimationFrame`: o LCP esperava
  o script.)
- **Orçamento de bytes (LCP abaixo de 2,5 s em 4G).** Tudo vem num arquivo só,
  então o que decide o LCP é quantos bytes chegam antes do Ato I terminar. Os
  demos de 03-08/10/2026 pesavam de 440 a 905 KB, 75-90% em foto base64, e a
  foto do hero só terminava depois do byte 200 000. Tetos:
  - do começo do arquivo até o fim do Ato I (head, CSS, fontes, foto do
    hero): **200 KB**;
  - fontes: no máximo 2 famílias, subset, **80 KB** em base64 somadas;
  - foto do hero: **80 KB** em base64; cada foto de conteúdo: **60 KB**, no
    máximo 5;
  - arquivo inteiro: **450 KB**;
  - CSS **35 KB** e JS **25 KB** sem contar base64, legíveis e comentados
    (nada de minificar: um dev precisa conseguir continuar).
  Meça com um script python3 no rascunho antes do deploy (bytes até o fim do
  Ato I, total, CSS, JS, fontes e imagens) e corte o que passar: a imagem
  feita em SVG custa pouco, a foto de celular esticada custa muito.
  Publicar outros arquivos não é saída: o Raio-X republica só `index.html` e
  `og.jpg`, e o que mais subisse sumiria no deploy dele.

### Fotos

**As fotos de `Fotos/` e `Logotipo/` vão para o site publicado.** Regra trocada
em 15/09/2026, a pedido do Rômulo, depois da CLIN ODONTO CSCN ter ido ao ar sem
nenhuma imagem. A regra antiga (fotos fora do site, espaço reservado com
comentário) valeu até ali.

**O risco está assumido, não resolvido.** As fotos são do Google Places: são de
terceiros e exigem crédito ao autor, e o `content.md` não traz o nome de quem
fotografou. Ou seja, elas sobem sem atribuição. Foi decisão do Rômulo, com o
risco na mesa. Se um dia o `content.md` passar a trazer o autor, credite.

**Todo site sai com foto. Sem exceção.** Reforço pedido pelo Rômulo em
16/09/2026, depois de vários leads saírem só com tipografia e forma: "você tem
esquecido de usar fotos". Uma página sem nenhuma foto de gente ou de lugar não
fecha o passo 4. Mínimo de 2 fotos, uma delas no hero ou encostada nele.

Quando `Fotos/` e `Logotipo/` vierem vazias, ou só com o que é proibido abaixo
(radiografia, antes e depois), use **foto ilustrativa com licença livre**
(Unsplash, conferindo "Fotografia grátis" na página, nunca Unsplash+):

- gente real sorrindo em contexto que conversa com a copy (casa, família,
  cotidiano), nunca consultório, cadeira ou equipamento de banco de imagem,
  porque fingiriam ser o espaço da clínica e assustam quem tem medo de dentista;
- nunca se passe pela equipe ou por paciente: `alt` descreve a pessoa, não diz
  "Dr. Fulano";
- escolha pela paleta: a foto tem que caber na cor do site (frame de vídeo com
  parede laranja e azul briga com qualquer paleta que não seja essa);
- crédito ao autor no rodapé ("Fotos ilustrativas: Nome, via Unsplash") e
  comentário no HTML pedindo ao dono as fotos reais (retrato do titular,
  recepção, fachada).

Precedentes: Clínica Lauravi (refação com 2 ilustrativas) e Guastelli Gastaldo
(3 ilustrativas, retrato dentro da forma-assinatura do hero).

**Escolha, não despeje.** Publique só as que ajudam a página. Uma foto boa vale
mais que cinco medianas, e foto ruim é pior que nenhuma.

Não publique:

- **Imagem de paciente.** Radiografia, foto clínica, boca, antes e depois. É
  dado de outra pessoa e você não tem consentimento nenhum.
- **Foto que desmente a copy.** Se o texto elogia a estrutura organizada, não
  publique a bancada entulhada.
- **Foto que assusta.** Instrumento em close, agulha, procedimento em curso.
  Boa parte de quem procura dentista tem medo de dentista.

Como entrar no arquivo, já que continua sendo um HTML só:

- Redimensione para o tamanho em que ela aparece no celular, no dobro da
  densidade (foto do hero ~800 px de largura; foto de prova bem menor), comprima
  em **WebP** com qualidade em torno de 72 (o PIL do Dell grava WebP; sai ~30%
  menor que o JPEG) e embuta em base64, dentro do orçamento de bytes das
  "Regras do arquivo". Nada de CDN, nada de arquivo solto. O `og.jpg` da prévia
  continua JPEG (é o que o WhatsApp lê).
- `width` e `height` sempre, para a página não pular enquanto carrega.
- `decoding="async"` em tudo que não é a foto do Ato I. `loading="lazy"` não
  economiza nada numa imagem `data:` (os bytes já vieram no HTML): o que conta é
  o orçamento. Nos Atos abaixo da dobra, `content-visibility: auto` com
  `contain-intrinsic-size` adianta a primeira pintura.
- `alt` descritivo no idioma da página, dizendo o que se vê.
- **Ajuste a proporção do painel à foto, não a foto ao painel.** Cortar uma
  foto 4:3 para caber num vão 4:5 estraga o enquadramento; mudar o vão custa
  uma linha de CSS.
- Deixe um comentário HTML dizendo a origem e o que pedir ao dono depois (uma
  foto da fachada, um retrato dos titulares).

### O que NÃO pode entrar

- **Nenhuma avaliação do Google entre aspas, como depoimento.** O texto das
  avaliações é matéria-prima de copy — parafraseie, extraia o que os clientes
  elogiam, use as palavras que eles usam. Nunca atribua uma fala a alguém.
- **Nada inventado.** Sem lorem, sem "Sobre nós" genérico, sem serviço que o
  negócio não oferece, sem número de anos de mercado que ninguém informou, sem
  selo, prêmio ou estatística fabricada.
- **Nada que gere medo ou desconfiança.** O visitante chega com um problema e a
  página é a parte calma da história. Proibidos: medo ("antes que seja tarde",
  "pode estourar", "não perca seus direitos", "pragas transmitem doenças",
  "você está sendo enganado"), desconfiança do mercado ("cuidado com os
  desonestos", rir do próprio ramo), urgência artificial (contador, "últimas
  vagas"), exclamação e caixa alta gritada. O problema aparece como situação
  neutra ("A pia parou") e logo vem a solução. Em 08/10/2026 havia título que
  soava como "você foi lesado" num demo de advocacia e uma seção que ria do
  "Ligue agora!!!" num de desentupidora: os dois saem com esta regra.

### Experiência sem inventar

O negócio tem de parecer estabelecido e no controle, e isso se prova com dado
que o visitante pode conferir, nunca com adjetivo:

- **Tempo de mercado** só com fonte: data de abertura do CNPJ (pesquisa do
  dossiê), post do próprio negócio ("comemorou 6 anos em abril de 2026"), texto
  do perfil do Google. A fonte entra no texto ("Desde 2020, CNPJ aberto em
  dezembro"). Sem fonte, nada de "anos de experiência".
- **Avaliações**: nota e quantidade exatas, "no Google"; o que os clientes
  elogiam, parafraseado com as palavras deles (regra acima). Advocacia e saúde:
  nada disso na página.
- **Fotos reais** pequenas e tratadas (recorte, cor, grão), com legenda que diz
  o que se vê e onde ("A F-350 na frente da base, Rua Castro Alves"). É a prova;
  o visual grande é feito em código.
- **Horário** exatamente como o Google mostra. Um "aberto agora" calculado no
  navegador a partir desse horário, no fuso da cidade, é estado vivo legítimo.
- **Acabamento de estúdio**: nenhum placeholder, "em breve", ícone de
  biblioteca, emoji como ícone, componente desalinhado a 390 px ou erro de
  digitação; rodapé com dados reais, favicon e prévia do link. Amador é o que
  mais derruba a confiança.

## Como trabalhar cada lead

A ordem importa. São cinco skills, e as cinco rodam: `/design` cria a
direção; `/design-taste-frontend`, `/ui-ux-pro-max` e `/impeccable` refinam
**antes** do código (são as que mais mudam o frontend — depois do HTML
escrito, virariam retrabalho); `/emil-design-eng` e o `audit`/`polish` do
`/impeccable` fecham **no código**, sem trocar a direção.

**Nenhuma skill passa por cima deste arquivo.** Onde uma skill manda outra
coisa, vale o `CLAUDE.md`: arquivo único sem CDN/framework (ignora a stack
React/Tailwind/Motion e as libs de ícone da `/design-taste-frontend` — SVG
inline é permitido), nada inventado, e a esteira
não para para perguntar nada (ignora entrevista e página de escolha do
`/impeccable`).

**1. Ler.** `content.md` inteiro, depois as imagens de `Fotos/` e `Logotipo/`.
Saia daí com uma frase sobre o que este negócio é e o que ele quer parecer.

**1.5. Marca real, se existir.** `Fotos/` e `Logotipo/` são Google Places — não
são a marca do negócio, são só o espaço fotografado por terceiros. Se o
`content.md` trouxer um Instagram (informado pelo Google ou confirmado à mão),
abra o perfil antes do `/design` e puxe: foto de perfil (o logo real, se tiver
marca própria), 4-5 posts recentes para paleta de cor real, e a bio para
posicionamento (nicho, tom, o que o negócio quer ser visto como). Isso é
insumo de marca, separado das fotos do espaço. Sem Instagram informado, siga
só com o que `content.md` e as fotos do espaço dão — não invente identidade
visual.

**Abra sempre o painel de links da bio quando aparecer "e mais N".** O
Instagram colapsa os links extras e mostra só o primeiro, com um "e mais 1"
fácil de ler como ruído. Clique e leia a lista inteira: é lá que aparece o
site, a loja, o linkbio ou a página do Facebook. Aconteceu em 22/09/2026 no
Cruz Móveis: a bio dizia `wa.me/<número do negócio> e mais 1` e o segundo link só
apareceu depois do clique (era a página do Facebook, então a premissa "sem
site" se manteve — mas eu tinha concluído isso sem ter olhado).
Proposta aprovada pelo Rômulo em 22/09/2026.

**Procure a marca dentro das fotos antes de concluir que não existe.** Placa de
recepção, letreiro, fachada, jaleco, impresso na mesa, adesivo na porta: é
comum o logo real, a cor real e o posicionamento real estarem fotografados sem
que o `content.md` diga uma palavra sobre isso. Olhe foto por foto atrás
disso antes de decidir a paleta.

**Aconteceu uma vez** (Academia Korpus, Praia do Morro, 2026-09-15): sem
Instagram no `content.md`, o site saiu com paleta lida das fotos de academia
genérica do Google Places (branco/preto) — perdeu a marca real (roxo/violeta
escuro, logo circular, posicionamento "Estúdio 40+"), que só existia no
Instagram. Retrabalho total. Por isso este passo existe.

**Aconteceu de novo, ao contrário** (CLIN ODONTO CSCN, Faria Lima,
2026-09-15): o `content.md` dizia "Instagram não informado", mas a foto-4 da
pasta `Fotos/` mostrava a placa de acrílico da recepção com o logo inteiro
(dois C concêntricos, verde-esmeralda escuro) e a assinatura "parceria em
odontologia empresarial e individual". Dali saíram a paleta e a segunda frente
do site. Se eu tivesse parado no texto do `content.md`, o site sairia no azul
clínico genérico que a própria biblioteca da `/ui-ux-pro-max` recomenda para
"clínica médica" (`#0891B2`). A marca estava na parede, não no arquivo.

**1.5.1. Metáfora e Atos.** Antes do estilo e do `/design` (08/10/2026, direção
"redesign conceitual e de movimento" do Rômulo). Os demos até ali tinham duas
falhas: o fluxo comum saía de template (hero, serviços, diferenciais,
orçamento, contato) e, quando havia ideia, ela morava num brinquedo (arrastar
uma cláusula, girar uma maquete) com a página em ordem de template em volta. O
visitante precisava aprender o brinquedo antes de entender o negócio.

*A metáfora* é o instrumento, documento ou percurso que o próprio ofício usa
para mostrar ao cliente que o trabalho está sob controle. Ela representa o
cuidado e a ordem, **nunca o problema**. Duas camadas: a família vem do nicho
(tabela abaixo, ponto de partida) e a instância vem do lead (a cor da fachada,
a frota, a esquina, o vocabulário do dono, achados no passo 1.5). Família sem
instância é template; instância sem família é enfeite. Teste, e um "não"
derruba a metáfora: vem do ofício (não de banco de imagem: balança, dente
brilhando, floco de neve)? Dá nome e ordem aos cinco Atos e serve de índice?
Mostra controle, não o problema? Lê em 3 segundos num celular? Parada (com
reduced-motion) ainda conta a história? Trocando o nome por o de um
concorrente da mesma cidade, algo fica falso?

| Nicho | Família da metáfora | A navegação é | O movimento que diz algo | Nunca |
|---|---|---|---|---|
| Advocacia | a pasta do caso, organizada | separadores numerados de I a V | folhas que se assentam (`sticky`), marca-texto que acompanha o título; esticamento ≤ 1,5% | balança, martelo, frase de "você foi lesado", R$ |
| Odontologia | o caminho da consulta, da recepção à luz da janela | um caminho com cinco paradas | a luz da página clareia com o scroll; paralaxe suave nas fotos da recepção | dente 3D, instrumento, boca, antes e depois |
| Climatização e refrigeração | a curva que desce de 34° a 23° | um visor de termostato com o grau de cada Ato | a cor esfria com o scroll; linhas de ar esticam com a velocidade; ar frio descendo entre Atos | "faz mal à saúde", fungo, floco de clip-art |
| Desentupidora | o fluxo que volta a correr | uma linha de tubulação limpa que atravessa a página | a linha corre com o scroll; transição líquida (água limpa) entre Atos | esgoto, sujeira, rir do ramo |
| Dedetizadora | a casa protegida, cômodo por cômodo | a planta baixa; cada Ato acende um cômodo | o traço da barreira fecha o perímetro com o scroll | inseto grande, infestação, "transmitem doenças" |
| Reformas e marcenaria | da planta ao acabamento | uma régua com as etapas (medir, desenhar, executar, acabar, entregar) | linhas de projeto que se desenham e ganham material (a planta vira a foto por máscara); peças que se encaixam com inércia | "obra que nunca termina", "fuja do amador" |
| Escola infantil | um dia na escola, do portão à saída | um sol que atravessa o céu | lento e leve: a luz muda com o dia, levitação suave na rotina | rosto de criança identificável, "vagas acabando" |
| Estética automotiva | a passada de polimento | as etapas do detalhamento | um reflexo atravessa os títulos (máscara) e estica com a velocidade, como o brilho na lataria | "seu carro está desvalorizando" |

Outro nicho: aplique a regra e o teste; contabilidade, por exemplo, pode ser "o
ano fiscal do cliente, mês a mês", indústria "a peça do desenho à entrega".

*Os cinco Atos* são as perguntas que o visitante tem, na ordem em que as tem, do
"achei no Google" ao "chamei no WhatsApp". A metáfora dá o nome e a forma de
cada um. Um Ato pode ser curto, nenhum falta (em urgência o I já traz o
chamado do V). Só entra dado com fonte (ver "Experiência sem inventar").

- **I. Chegada — "é isto, é de verdade, é perto?"** Nome, o ofício nas palavras
  do cliente, bairro e cidade, nota e quantidade de avaliações do Google, uma
  foto real, WhatsApp (e ligar, em urgência), "aberto agora" pelo horário real.
  Movimento: entrada em CSS puro, título revelado linha a linha por máscara,
  paralaxe 3D curta na foto; a metáfora aparece como cenário. Por quê:
  confirmar em 3 s que é o negócio certo, sem o LCP esperar JS.
- **II. Reconhecimento — "eles resolvem o meu caso?"** Os serviços do
  `content.md`, do Instagram e das fotos, escritos como o problema que o
  cliente descreve. Movimento: o item tocado levita, os outros recuam, e a
  escolha já monta a mensagem do WhatsApp. Por quê: quem se reconhece já
  começou o contato.
- **III. Como funciona — "como vai ser, sem surpresa?"** Horário, região, como
  é o primeiro contato, o que mandar ou levar. Movimento: a sequência presa ao
  scroll (`position: sticky` + progresso 0-1), onde a metáfora acontece (a
  linha corre, a curva desce, as folhas se assentam). Por quê: a incerteza é a
  maior barreira para chamar um desconhecido.
- **IV. Prova — "dá para confiar?"** Fotos reais tratadas e legendadas, nota,
  o que os clientes elogiam (sem aspas), tempo de mercado só com fonte.
  Movimento: paralaxe de profundidade nas fotos, contador da nota uma vez.
  Por quê: confiança vem de evidência, não de adjetivo.
- **V. Chamado — "como eu falo, agora?"** WhatsApp com a mensagem pronta,
  telefone, endereço com o link do Maps, horário. Movimento: a metáfora se
  resolve (a linha chega, a curva chega a 23°, a pasta fecha), transição
  líquida para a cor do fecho, botão magnético. Por quê: o contato é o último
  passo natural da história, não um pedido.

Sempre: barra de WhatsApp fixa no celular depois que o Ato I sai da tela (o
contato a no máximo dois toques de qualquer ponto), e o índice dos Atos, que é
a metáfora, com o Ato atual marcado. Quem ignorar todos os efeitos e só rolar
entende o negócio e chega ao WhatsApp.

Grave `<slug>/CONCEITO.md` (nunca sobe para a Vercel) com: a metáfora em uma
frase (família + instância), os cinco Atos com o nome que a metáfora dá a cada
um e o que entra neles (com a fonte de cada dado), e a tabela **efeito → Ato →
o que significa** com cada efeito de movimento que vai para o código. Efeito
sem linha nessa tabela não entra. O estilo do passo 1.6 é a pele dessa
metáfora: escolha o que a serve.

**1.6. Escolher o estilo visual.** Antes do `/design` — nunca depois, nunca
junto com o código. Com o que saiu dos passos 1 e 1.5 (o que o negócio é, o
que quer parecer, a marca real se tiver Instagram), escolha **um** destes
estilos de frontend pra guiar a direção. Não misture vários: o negócio pede
um, não uma colagem.

- Bento Grid (Estrutura Modular)
- Neo-Brutalismo
- Glassmorphism & Liquid Glass
- Minimalismo Moderno (Raw & Clean UI)
- Neumorfismo e Claymorphism
- Material Design (Google)
- Fluent Design (Microsoft)
- Flat UI (Design Plano)
- Soft UI
- Spatial UI (Design Espacial)
- Maximalismo Visual

Diga qual escolheu e por quê, numa frase, antes de seguir pro `/design`. Esse
estilo é o insumo que entra no passo 2 — não uma opção a mais dentro dele, nem
nas skills de refino do passo 3.

**Antes de escolher, olhe as últimas 5 linhas do `registro.md`.** Anote qual
estilo e qual cor dominante cada um usou. Não repita o estilo nem a paleta de
nenhum dos últimos 5 — e se dois leads seguidos forem do mesmo segmento
(duas academias, duas clínicas, dois estúdios de pilates), o estilo do
segundo tem que ser diferente do primeiro sem exceção. Minimalismo Moderno
já se repetiu 4 vezes em 15/09/2026 (Estúdio Marília, Soma Guarapari,
Orthosanti, CLIN ODONTO CSCN) — é o estilo "seguro", e por isso é o que mais
tende a virar prateleira. Se ele for realmente o que a marca pede, diga por
quê nessa mesma frase; se for só o caminho de menor risco, escolha outro.

**1.6.1. Referência real no Refero.** Depois de olhar o `registro.md` e antes
de fixar a direção, pesquise em `https://styles.refero.design/` e selecione
**uma** referência de produto compatível com o setor, o público, o tom e o
estilo escolhidos. Abra a aba `DESIGN.md`, copie o arquivo completo e salve
em `<slug>/DESIGN.md`. Esse arquivo é referência local e obrigatória para os
passos 2–4; nunca grave um `DESIGN.md` na raiz de `auto`, pois cada lead tem
sua própria direção.

**Marca primeiro, Refero depois.** O `DESIGN.md` empresta gramática visual
(hierarquia, densidade, tipografia, escala, superfícies, componentes, motion,
do's e don'ts), não a identidade da empresa de origem. Adapte as cores à
marca real e às fotos do lead. Nunca copie ou mencione nome, logo, produto,
copy, avaliações, imagens, ícones proprietários, fluxos ou provas sociais da
referência. Continue obedecendo arquivo único, CSS/JS inline, sem CDN e sem
framework. Se a referência pedir fontes externas ou recursos que não cabem
nesse contrato, use uma alternativa local ou system font de efeito equivalente.

Antes do `/design`, diga em uma frase: a metáfora (1.5.1), estilo escolhido,
referência Refero (nome + URL) e o princípio visual aproveitado. O `/design` e
as skills de refino trabalham dentro dos cinco Atos e da metáfora; nenhuma
delas volta ao esquema "hero, serviços, depoimentos, contato". No passo 7, registre também
`Refero: <nome> — <URL>; aplicado: <princípios>; adaptado: <decisões de marca>`.

**2. `/design`** — é aqui que a ideia do site nasce, já dentro do estilo
escolhido no passo 1.6. Direção visual, estrutura, hierarquia, o que vai em
cada seção e por quê. Isto roda **antes de qualquer linha de HTML** — não é
uma consulta opcional, é o passo que impede o site de sair genérico. Se você
chegou ao código sem ter rodado isto, parou e voltou.

**3. Refinar a direção — antes de qualquer linha de HTML.** Três skills, nesta
ordem. Nenhuma troca o estilo do 1.6 nem a direção do passo 2 — aprofundam.

- **3.1 `/design-taste-frontend`** — o filtro anti-genérico. Escreva a
  "Design Read" de uma linha (tipo de página, público, linguagem), defina os
  três dials (variância, movimento, densidade) e passe a direção do passo 2
  contra a lista de AI tells (seção 9). O que for padrão de template sai
  aqui, antes de virar código.
- **3.2 `/ui-ux-pro-max`** — transforma a direção já filtrada em sistema:
  paleta com contraste checado, par tipográfico, espaçamento, guidelines de UX
  do tipo de negócio. É o que leva a ideia a página de produção.
- **3.3 `/impeccable`** — modo **Persuade** (landing que converte). A direção
  vem fixada dos passos 1.6–3.2: é brief pinado, então **não** rola mundo
  visual novo (`new-work`), não abre `serve-question`, não roda `init` nem
  `shape` com entrevista — o `content.md` é a verdade de produto. Rode o
  `impeccable context` — ele vai avisar `NO_PRODUCT_MD` e
  `PRODUCT_INIT_REQUIRED`; é esperado, ignore. Não escreva PRODUCT.md nem
  crie um DESIGN.md novo: use o `<slug>/DESIGN.md` copiado do Refero no passo
  1.6.1. Leia `reference/craft-floor.md` imediatamente antes do passo 4: o
  piso de qualidade e as proibições (inclusive as fontes padrão de IA) valem
  para o HTML que vai ser escrito.

**4. Escrever** `<slug>/index.html`.

**4.5. Polir no código.** Uma rodada em lote, não um loop.

- **`/emil-design-eng`** — invoque já com o alvo (`<slug>/index.html`) e a
  pergunta concreta; sem pergunta ela só devolve a saudação. Revisa o que o
  dono sente com o dedo: estado de toque dos botões, easing e duração,
  transição de entrada, nada animando de `scale(0)`, `prefers-reduced-motion`.
  Aplique a tabela Before/After. Use o checklist de motion da seção
  "Barra de excelência" abaixo — "um único momento de movimento, resto quieto"
  deixou de ser suficiente sozinho.
- **`/impeccable audit`** e depois **`/impeccable polish`** no `index.html` —
  captura desktop e celular juntos, corrige tudo num lote, no máximo mais uma
  rodada de confirmação.
- Feche com o pre-flight check (seção 14) da `/design-taste-frontend`.

**5. Publicar** na Vercel: time `romulodesigns`, projeto `demo-<slug>`,
produção. Caminho: **Vercel CLI** (`vercel` 53.x, já logado nesta máquina como
`sutilromulo-5015`). Não use o MCP da Vercel para isso.

**O que sobe: só o `index.html` e o `og.jpg` (a prévia do link no WhatsApp). Nada mais.** A pasta do lead nunca é
publicada — nem com `.vercelignore`. O deploy sai de uma pasta de staging fora
desta pasta, para onde só o `index.html` é copiado. É lista de permissão, não de
bloqueio: `content.md`, `Fotos/`, `Logotipo/`, `publicado.json` e qualquer
arquivo que apareça depois ficam de fora por construção. E o `.vercel/` que o
`link` cria fica no staging, não entra nesta pasta.

Comando no Dell (bash), trocando só `<slug>` (é o mesmo roteiro testado em
PowerShell no PC em 2026-09-14):

```bash
slug="<slug>"
stage="${TMPDIR:-/tmp}/esteira-deploy/demo-$slug"
rm -rf "$stage" && mkdir -p "$stage"
cp ~/auto-site/"$slug"/index.html "$stage"/
[ -f ~/auto-site/"$slug"/og.jpg ] && cp ~/auto-site/"$slug"/og.jpg "$stage"/
cd "$stage"
vercel link --yes --project "demo-$slug" --scope romulodesigns
vercel deploy --prod --yes --scope romulodesigns
```

`vercel link --project` cria o projeto se não existe e reusa se já existe — refação
publica no mesmo projeto e a URL não muda.

**A URL do lead é a linha `Aliased:` da saída do deploy** — normalmente
`https://demo-<slug>.vercel.app`. Não monte a URL na mão. As outras URLs
(`demo-<slug>-romulodesigns.vercel.app` e a do deployment com hash) ficam atrás
do login da Vercel (Vercel Authentication, padrão do Hobby) e devolvem 302 para
quem não é dono — o cliente veria uma tela de login.

Antes do passo 6, confirme que a URL abre para qualquer pessoa:

```bash
curl -s -o /dev/null -w "%{http_code}" https://demo-<slug>.vercel.app
```

Tem que dar `200`. Se não der (ex.: o nome `demo-<slug>.vercel.app` já era de
outra conta e a Vercel deu outro alias), o lead quebrou: não escreva
`publicado.json`, anote em `registro.md` e siga.

**6. Escrever o recibo** em `<slug>/publicado.json`. É assim que o lead volta
para o n8n — **você não escreve na planilha**, o `.gsheet` desta pasta é só um
atalho, não um arquivo. O n8n varre esta pasta atrás de `publicado.json` e
atualiza a planilha sozinho.

```json
{
  "place_id": "<o mesmo do content.md>",
  "slug": "<slug>",
  "nome": "<nome do negócio>",
  "site_url": "<a URL da linha Aliased: do passo 5, ex. https://demo-<slug>.vercel.app>",
  "vercel_project": "demo-<slug>",
  "publicado_em": "2026-09-15T14:30:00-03:00"
}
```

O `place_id` é a chave: sem ele o n8n não acha a linha. Copie exatamente como
está no `content.md`.

Os campos `raio_x_*` e o arquivo `raio-x.html` da pasta não são seus: depois do
seu deploy, o runner publica o Raio-X do PRUMO em `/raio-x` do mesmo projeto e
grava esses campos no recibo (desde 08/10/2026). Não os escreva nem os copie
para o palco do deploy.

**7. Anotar** uma linha em `registro.md`: data, lead, slug, URL, a metáfora
(família + instância) e a decisão de design que você tomou pensando nesse
negócio específico.

## Barra de excelência — por que cada site precisa valer o investimento

Site "correto" não basta. Para quem nunca teve site, essa página é a
primeira impressão dele na internet, e o Rômulo está vendendo isso como
investimento — tem que parecer caro, não genérico. Isso não é opinião, é
checklist, e roda antes de fechar o passo 4.5.

### 1. Não repita estilo nem paleta (regra já no passo 1.6)

Consulte o `registro.md` antes de escolher. Ver seção 1.6 acima.

### 2. Movimento é vocabulário mínimo, não um efeito isolado

Muitos leads publicados até aqui saíram com "um único momento de movimento,
resto quieto" — foi escolha certa de sobriedade caso a caso, mas virou
padrão por repetição, e padrão é o que faz o conjunto parecer estático. A
partir de agora, todo `index.html` sai do passo 4.5 com **todos** estes,
não só um:

- **Entrada da hero** animada (fade + translateY curto — nunca pop abrupto,
  nunca `scale(0)`).
- **Scroll-reveal** nas seções abaixo da hero: `IntersectionObserver`,
  fade + translateY de 20-30px, dispara uma vez, JS vanilla inline (cabe na
  regra de arquivo único).
- **Stagger** em qualquer grupo de 3+ itens da mesma natureza (cards de
  serviço, lista de diferenciais, grade de fotos): delay incremental de
  60-100ms entre eles. Itens do mesmo grupo não aparecem todos juntos.
- **Hover/tap com profundidade real**: sombra que cresce e/ou scale sutil
  (1.02-1.03), nunca só troca de cor. Gateado por `@media (hover: hover)`
  para não travar em toque (achado real do CLIN ODONTO CSCN, linha 29 do
  `registro.md`).
- **`prefers-reduced-motion: reduce`** desligando tudo isso — sem exceção,
  regra de acessibilidade do próprio `/emil-design-eng`, não opcional.

Isto é piso, não teto. Se a marca pede mais (a academia com letreiro que
acende, a porta que se escreve, a engrenagem que engata — já aconteceram),
o piso continua valendo por baixo do momento de assinatura da seção 3.

### 2.1 Vocabulário dos Atos: cada efeito com o seu porquê (08/10/2026)

Acima do piso, o movimento vem deste vocabulário, e só quando a tabela
"efeito → Ato → o que significa" do `CONCEITO.md` (passo 1.5.1) diz por quê.
Efeito bonito sem significado é carga cognitiva: sai.

| Efeito | Como | Significa | Dose e limites |
|---|---|---|---|
| Esticamento por velocidade | `skewY`/`scaleY` proporcional à velocidade da rolagem, amortecido por mola, zero quando parado | a matéria tem peso; a página responde ao gesto | até 3% (1,5% em advocacia e saúde); só em imagem e nas linhas da metáfora, nunca em texto corrido |
| Paralaxe 3D real | `perspective` no contêiner, 2-3 camadas com `translateZ`, movidas pelo scroll (e pelo ponteiro, com `pointer: fine`) | existe um lugar e um objeto de verdade | no máximo 3 camadas; nunca `background-attachment: fixed` (quebra no iOS) |
| Transição líquida entre Atos | `clip-path` (elipse, polígono) ou máscara SVG ligada ao progresso da fronteira; a cor do Ato seguinte escorre para dentro | é uma história só, não blocos | uma por fronteira; com reduced-motion vira corte seco |
| Magnetismo no cursor | o CTA principal puxa o ponteiro num raio de 80-120 px, até 8 px de deslocamento, volta com mola | a página quer que você chame, sem gritar | só `(hover: hover) and (pointer: fine)`; um ou dois elementos por página |
| Tipografia dinâmica com máscara | título revelado por linha (`overflow: clip` + translate) ou preenchido por gradiente ligado ao scroll (marca-texto, reflexo) | o olho entra pelo título certo | texto inteiro no DOM, legível sem JS; `aria-label` no pai e `aria-hidden` nas partes |
| Estado vivo e levitação | o item escolhido sobe 4 px com sombra; "aberto agora" respira | o que está ligado ou disponível se destaca | levitação contínua só no que é estado real |
| Inércia e lag elástico | rótulos, números e ícones seguem o scroll com lerp 0,08-0,12 | hierarquia: o principal chega primeiro | atraso de até 24 px; nunca no texto que se lê |

Tetos: no máximo 3 tipos de efeito por Ato, uma sequência presa ao scroll por
página, dois elementos magnéticos. Regras do motor (JS vanilla inline): um
único laço `requestAnimationFrame` com molas e lerp, parado quando nada se move
e com a aba oculta; listeners `passive`; anime só `transform`, `opacity` e
`clip-path`; leia o layout num lote, cacheado por `ResizeObserver`;
`IntersectionObserver` liga e desliga o que está fora da tela; a rolagem nunca
é sequestrada (nada de `preventDefault` em wheel/touch, nada de "smooth
scroll" por JS). Efeito de cursor só com
`matchMedia('(hover: hover) and (pointer: fine)')`, escutando a mudança; no
toque, o equivalente é um gesto (arrastar) ou nada. Com
`prefers-reduced-motion: reduce` (lido no CSS e no JS, escutando a mudança) a
sequência presa ao scroll vira as etapas empilhadas e legíveis, e paralaxe,
esticamento, magnetismo, lag e transições somem: o conteúdo é o mesmo.

### 3. Pelo menos um "momento de assinatura" por site

Uma decisão visual que não sairia de um gerador genérico — porque nasceu
da marca real deste negócio específico, não de um padrão de template.
Exemplos que já aconteceram e funcionaram: o mural da recepção redesenhado
em SVG que se desenha ao entrar na tela (Studio TRG), a assinatura manuscrita
que atravessa a costura da porta (Estúdio Marília), a engrenagem da marca
que engata ao carregar (GB Sports), a vértebra que acende em relevo dourado
(Bless Pilates). Se ao terminar o site você não consegue apontar em uma
frase qual foi essa decisão, falta — volte no passo 1.5/1.6 e procure de
novo na marca real, não invente algo genérico só para preencher o item.
Desde 08/10/2026 o lugar natural do momento de assinatura é a sequência do
Ato III ou a resolução do Ato V: é onde a metáfora (passo 1.5.1) acontece.

### 4. Checklist de saída do passo 4.5

- [ ] Estilo (1.6) diferente dos últimos 5 leads no `registro.md`
- [ ] Paleta dominante diferente dos últimos 5 leads
- [ ] Hero animado, scroll-reveal, stagger, hover com profundidade,
      `prefers-reduced-motion` — todos presentes, nessa ordem de checagem
- [ ] Pelo menos 1 momento de assinatura identificável e citável em uma frase
- [ ] `/emil-design-eng` e `/impeccable polish` rodaram **depois** do motion
      estar no código, não antes — senão o polish audita uma página ainda
      estática
- [ ] A metáfora passa no teste do 1.5.1 e a navegação é ela; os cinco Atos
      estão na ordem das perguntas do visitante
- [ ] No celular, em 3 s no Ato I: o que é, onde é e como chamar; de qualquer
      ponto, o WhatsApp a até dois toques
- [ ] Todo efeito tem linha na tabela do `CONCEITO.md`; nenhum sobra
- [ ] Nenhuma frase de medo, desconfiança, urgência artificial ou deboche do
      ramo; toda afirmação de experiência tem fonte
- [ ] Captura a 390×844 com `--force-prefers-reduced-motion`: página completa
      e legível; efeitos de cursor só com `pointer: fine`
- [ ] Orçamento de bytes medido e dentro (fim do Ato I ≤ 200 KB, arquivo ≤
      450 KB, CSS ≤ 35 KB, JS ≤ 25 KB); título e foto do Ato I visíveis sem JS

## Limites

- **Um lead por vez, do começo ao fim.** Não faça os sete passos de cinco leads
  em paralelo — o resultado vira média.
- **Comece com 1 por rodada.** Sobe para 3 e depois 5 só quando três sites
  seguidos saírem bons sem retrabalho.
- **Se um lead quebrar**, deixe a pasta sem `index.html`, anote o motivo no
  `registro.md` e siga. Um lead com problema não leva o lote junto.
- **Não envie mensagem para ninguém.** A esteira termina no site publicado e na
  planilha atualizada. A abordagem é o Rômulo quem faz, à mão.

## Planilha

Você não mexe nela. O `.gsheet` aqui na pasta é um atalho do Google Drive, não
um arquivo que se edita — quem escreve é o n8n, lendo o `publicado.json` que
você deixou.

Para referência: estados do lead são `novo → pronto → enviado → expirado`, com
saída `descartado`, e desde 30/09/2026 `recusado` e `fechado` (botões da página
do lead; `status_anterior` guarda o que o Desfazer devolve). Resposta não é
status: é a coluna `respondeu_em`. O `publicado.json` é o que move um lead de
`novo` para `pronto`.

**Depois do envio, sozinho (29/09/2026).** Nada disto é trabalho seu, mas
explica por que uma pasta some da raiz:

- `pronto → enviado`: clique no `wa_link` ou primeira mensagem do lead no
  WhatsApp (o observador do Dell lê o log do Hermes);
- `respondeu_em`: mensagem do lead a 5 min ou mais do envio (antes disso pode
  ser a saudação automática do WhatsApp Business); a pasta vai para
  `_em-conversa/` na hora seguinte;
- follow-up: no 3º dia sem resposta, o Rômulo recebe um aviso com o texto
  pronto (`followup_em` na planilha); quem manda é ele;
- `enviado → expirado`: 10 dias sem resposta; a pasta vai para `_concluidos/`.
  Se um expirado responder, volta para `enviado` e a pasta para `_em-conversa/`.

- recusou / fechou / desfazer: botão na página do lead
  (`…/webhook/lead?id=<place_id>`); a pasta vai para `_recusados/` ou
  `_fechados/` na hora (ou volta, no Desfazer) e o `registro.md` ganha a linha;
- lead em Perdido no CRM há 2 dias (recusou, 7 dias sem mensagem dele, sem
  contato, descartado): o demo é APAGADO na Vercel pelo `site-demos-limpeza`
  (desde 08/10/2026); a pasta fica, com `apagado_em` no `publicado.json`.
  Quem volta precisa do demo republicado a partir da pasta.

Follow-up, expiração e mudança de pasta pela resposta valem só para envio (ou
resposta) a partir de 29/09/2026. Lead em `_recusados/` ou `_fechados/` não
recebe follow-up nem expira.

O Rômulo acompanha tudo isso, junto com o PRUMO, no CRM da Central (`/crm`,
também no celular pela tailnet): Novo, Em contato, Proposta, Ganho, Perdido
(Em contato sem mensagem do lead por 7 dias vai para Perdido), com as regras
em `~/SquadOne/deploy/dell/README.md` ("CRM"). A Central
só lê a planilha e as pastas; divergência entre as duas aparece lá como nota.
Não é trabalho seu corrigir nenhuma das duas.

Se precisar de algum dado do lead que não está no `content.md`, ele não existe —
não vá buscar na planilha nem invente.

## O que o Rômulo faz, e você não

Ele é designer de produto. As decisões de direção visual que se repetem — o que
funcionou, o que soou falso, o padrão que vale reaproveitar — voltam para este
arquivo como regra. Se você descobrir algo que deveria valer para todo lead,
não aplique calado no próximo nem edite este arquivo: desde 08/10/2026 ele é
versionado no SquadOne (`deploy/dell/auto-site/auto-site-CLAUDE.md`) e só muda
por PR. Na execução automática, escreva a regra proposta no resumo final (o
runner grava no log do lead); numa sessão com o Rômulo, proponha o PR.
