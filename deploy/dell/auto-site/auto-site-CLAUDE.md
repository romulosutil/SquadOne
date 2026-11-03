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
resposta em 7 dias vira `expirado` e vai para `_concluidos/` (o mesmo 7º dia
do Perdido no CRM; era 10 até 19/10/2026). Você não move nenhuma das duas à
mão. O demo de quem ficou em Perdido é APAGADO na Vercel 2 dias depois pelo
`site-demos-limpeza` (a pausa de 15 dias saiu em 19/10/2026; ver abaixo).

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
mova a pasta à mão e anote a linha como antes; não mexa na planilha). **Dois dias
depois de o lead ir a Perdido no CRM, o demo é apagado da Vercel**
(`site-demos-limpeza`, todo dia às 09:50); a pasta fica aqui. Se o lead voltar
(Desfazer), o demo só volta ao ar republicando a pasta.

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

**Clareza antes de conceito (13/10/2026).** A página responde, em ordem e com
palavras simples, às cinco perguntas de quem chega pelo Google (passo 1.5.1):
o que é e onde fica, se resolve o meu caso, como funciona, se dá para confiar,
como eu chamo. Cabe em até **6 telas de celular**. O negócio tem de parecer
experiente e confiável, nunca amador, e nenhuma frase pode gerar medo ou
desconfiança.

*Por que mudou:* de 08 a 13/10/2026 a direção foi "metáfora do ofício e cinco
Atos". A auditoria dos 54 demos no ar em 13/10 mostrou que ela virou o novo
template e deu cara de IA a todos: título em frase de efeito que não diz o
ofício ("A água desce. Depois, a gente confere."), menu com o nome da
metáfora ou só com I, II, III ("Portão · Lista · Corredor"), campo de texto e
caixinhas de marcar em 39 dos 54, brinquedos ("faça o teste das oito placas"),
polaroides inclinadas com bilhete, vidro fosco em 34, e páginas com 11 telas
de mediana. A metáfora continua permitida, mas **só no visual** (cor, imagem,
um detalhe de movimento); título, menu, texto e estrutura são diretos.

### Regionalidade (escopo ampliado em 16/09/2026)

Pedido do Rômulo, quando o n8n começou a trazer leads de Miami: o escopo deixou
de ser "negócio brasileiro" e virou **PME de qualquer país, adaptada à
regionalidade dela**. Brasil: português, WhatsApp. Fora do Brasil: antes da
prancha do passo 2, pesquise como aquele mercado contrata aquele tipo de negócio (canal
de contato que o cliente local usa de fato, idioma ou idiomas do bairro,
convenções de preço/seguro/agendamento, o que a concorrência local mostra) e
replique isso. Idioma da página, `lang`, `alt`, formato de telefone e endereço,
e o CTA principal seguem o mercado, não o Brasil. Anote no `registro.md` o que
a pesquisa mostrou, para virar regra quando o mesmo país se repetir.

Continua valendo tudo o mais: premissa "sem site" (confira antes), nada
inventado, franquia/rede fora.

<!-- nichos: início (escrito à mão desde 19/10/2026; o site-nichos.py só troca a lista FEMININOS nos fluxos) -->
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
<!-- nichos: fim -->

### Regras do arquivo

- **Um arquivo só.** CSS e JS inline. Nada de CDN, nada de build, nada de
  framework. Tem que abrir offline e nunca quebrar.
- **HTML de frontend, limpo e legível.** Sem abstração antecipada: nada de
  objeto de configuração, nada de placeholder de API, nada de marcação de
  componente. Só HTML bem escrito, semântico, que um dev consegue pegar e
  continuar no dia em que o cliente quiser mais.
- **Celular primeiro no CSS, desktop de verdade no desenho (14/10/2026).** O
  dono abre o link pelo WhatsApp, num celular médio (CPU lenta, 4G): o CSS
  começa em 390×844, nada depende de hover, alvo de toque de 44 px, nada passa
  de 390 px na horizontal, até 6 telas. Mas o cliente dele procura também no
  computador, e o Rômulo apresenta no notebook: a composição do desktop vem do
  shot do Dribbble (passo 1.6) e é desenhada para 1440 px, com painéis, grade
  em colunas e foto grande ao lado do texto. Uma coluna estreita de celular
  centralizada numa tela de 1440 px é defeito, não estilo.
- **CTA principal: WhatsApp** (Brasil), com o telefone real do `content.md`.
  Fora do Brasil, o canal que o mercado local usa (ver Regionalidade). O `href`
  real (`https://wa.me/...`) está no HTML de todo CTA, não só no JS.
  **Um número só, e de fonte certa (13/10/2026):** o telefone do Google
  (`Telefone:` do `content.md`) quando é celular. O "WhatsApp achado na busca"
  só entra depois de conferido no Instagram, no Facebook, na foto da fachada ou
  no cartão do próprio negócio, com a fonte anotada no `registro.md`; sem
  conferência, use o telefone do Google (fixo vira "Ligar", e o WhatsApp sai).
  Em 13/10 dois demos tinham dois números de WhatsApp diferentes e quatro
  tinham um WhatsApp que não batia com o telefone: o cliente do dono chamaria
  o número errado.
- **Nada de código de teste no arquivo publicado.** O modo de captura
  (`?qa=1`, classe `html.qa`, `#qa-resultado`, `window.onerror` de
  depuração) mora numa cópia no rascunho, nunca no `index.html` que sobe. Em
  13/10 29 dos 54 demos levavam esse código.
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
  Meça antes do deploy com o gate numérico (11/10/2026):
  `python3 ~/.local/bin/qa-numerico <slug>/index.html --capturas <pasta das capturas>`.
  Ele mede estes tetos (o Ato I é a primeira `<section>` dentro de `<main>`),
  `width`/`height` e `alt` das imagens, `prefers-reduced-motion`, contraste
  AA dos pares cor/fundo do CSS e o Ato I visível sem JS e com reduced-motion
  (tira as duas capturas ele mesmo). Desde 13/10/2026 também reprova o título
  em duas frases de efeito, entre aspas ou sem o ofício nem a cidade, a cidade
  fora do Ato I, menu numerado, frase da lista de gaveta, campo de texto para o
  visitante, código de teste publicado e WhatsApp fora do `content.md`; e mede
  a página renderizada a 390 px: mais de 8 telas, rolagem lateral, link ou
  botão abaixo de 40 px e texto abaixo de 12 px reprovam. Código 1 = falhou, e
  cada FALHA diz o que cortar. Rode até sair 0. Sem ele instalado, um script python3 no rascunho
  faz a conta dos bytes. Corte o que passar: a imagem feita em SVG custa
  pouco, a foto de celular esticada custa muito.
  Publicar outros arquivos não é saída: o Raio-X republica só `index.html`,
  `og.jpg` e os três arquivos do SEO técnico (abaixo), e o que mais subisse
  sumiria no deploy dele.

### Perguntas frequentes e SEO técnico (15/10/2026)

Quem procura pelo Google, e cada vez mais pelo AI Overviews, ChatGPT ou
Perplexity, chega à página que tem fato fácil de extrair: dado estruturado e
pergunta com resposta direta. Até 15/10 os demos só tinham `<title>` e
`og:image`. É também o que o serviço Encontrado do PRUMO vende, então o demo
mostra isso pronto.

- **Seção de perguntas.** Antes do Contato, `<section id="perguntas">` com 3 a
  5 perguntas, cada uma num `<details data-fonte="...">` fechado: o `<summary>`
  é a pergunta, terminada em "?", e um `<p>` é a resposta. A pergunta sai de um
  tema das avaliações ou do briefing do `content.md` (quem elogia a rapidez
  vira "Vocês atendem no mesmo dia?"; quem fala da limpeza, "O serviço deixa
  sujeira?"), nunca de uma lista genérica do ramo. A resposta é direta na
  primeira frase e só tem fato com fonte: horário, endereço e nota do Google,
  o que as avaliações contam (parafraseado, sem aspas, sem nome), o que o
  Instagram ou o dossiê provam. Sem fonte, a pergunta não entra; nada de
  promessa, preço inventado nem "garantia".
- **`data-fonte`** diz de onde veio a resposta: `google`, `avaliacoes`,
  `instagram`, `facebook`, `cnpj` ou `dossie` (mais de uma, separadas por
  espaço). Advocacia e saúde: nunca `avaliacoes` (regra dos conselhos, ver
  "Ramos novos"); lá as perguntas são sobre como funciona o atendimento.
- **JSON-LD, `robots.txt`, `sitemap.xml` e `llms.txt` não se escrevem à mão.**
  Depois do `og.jpg` e antes do deploy, roda
  `python3 ~/.local/bin/seo-do-site <slug> --url https://demo-<slug>.vercel.app --exigir-faq`.
  Ele põe no `<head>` o LocalBusiness no subtipo do ofício (LegalService,
  Plumber, Dentist...) e o FAQPage, e grava os três arquivos na pasta. Cada
  valor vem de uma fonte: nome, telefone e nota do `content.md`; endereço,
  coordenadas e horário do Google Places; perguntas e respostas do texto da
  página. A nota (`aggregateRating`) só entra com os números exatos do Google
  e só se a página os mostra; em advocacia e saúde, nunca. O que não tem fonte
  fica de fora, e um JSON-LD feito à mão é apagado. Código 1 = cada FALHA diz o
  que corrigir na seção de perguntas.
- **Sobem junto** o `robots.txt`, o `sitemap.xml` e o `llms.txt` (ver passo 5).
  O `seo-places.json` que fica na pasta é cache do Places (até 30 dias) e não
  sobe.

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
  o orçamento. Nas seções abaixo da dobra, `content-visibility: auto` com
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

### Cara de IA (13/10/2026)

Tudo abaixo apareceu em dezenas dos 54 demos auditados em 13/10/2026 e é o
que faz o dono (e o cliente dele) perceber na hora que a página foi gerada.
Nada disto entra:

- **Título-aforismo.** Duas frases curtas em contraste ("Primeiro a pergunta.
  Depois a parede.", "Barata não espera. Escorpião também não."), frase de
  efeito que não diz o ofício ("Do mesmo lado da mesa.", "Aqui estamos."),
  título entre aspas, palavra em itálico de destaque no fim do título serifado.
  O título é **uma frase** com o que a empresa faz e onde, nas palavras de
  quem procura: "Desentupidora 24 horas em Votorantim", "Advogada
  previdenciária no Setor Oeste, em Goiânia", "Aluguel de betoneira e andaime
  em Aparecida de Goiânia". O jeito do dono entra no subtítulo, com fato.
- **Menu que não diz para onde leva.** Algarismo romano (I, II, III), número
  sozinho, nome da metáfora ("Portão · Lista · Corredor", "Ralo · Conferida").
  Rótulo é a palavra que o cliente usaria: Serviços, Áreas, Como funciona,
  Avaliações, Onde fica, Contato.
- **Especificidade de efeito.** Endereço e número usados como poesia ("O
  Fórum fica no 689. A conversa começa no 1980."). Fato entra como fato: rua,
  bairro, horário, nota, frota, ano de abertura com fonte.
- **Formulário e brinquedo.** Campo de texto, caixa "conte com as suas
  palavras", teste, quiz, contador "Respondidas: 0 de 5", arrastar um quadrado,
  seletor que monta a mensagem. O WhatsApp é o formulário: um botão por
  serviço, cada um com a mensagem pronta, é toda a interação que a página
  precisa.
- **Decoração de gerador.** Polaroide ou cartão inclinado com bilhete
  manuscrito, nota adesiva "Instagram, set. 2026", letra gigante desenhada em
  código, objeto 3D feito em SVG no lugar de foto, vidro fosco
  (`backdrop-filter`), rótulo em caixa alta espaçada em cima de todo título,
  índice de progresso no topo.
- **Frases de gaveta.** "Sem complicação", "sem rodeios", "explicado com
  clareza", "de verdade", "a gente cuida", "do mesmo lado", "jornada",
  "atendimento humanizado", "cuidado e firmeza", "de ponta a ponta", "sua
  história" e as demais da lista do gate (`FRASES_PROIBIDAS` no
  `qa-numerico`).
- **Página comprida.** Mais de 6 telas no celular. Se uma seção não responde a
  uma das cinco perguntas do passo 1.5.1, ela sai.
- **O esqueleto de template novo.** Vários sites reais refeitos em 2026 (e
  algumas das referências, mais abaixo da primeira tela) já têm a cara de IA
  seguinte: sobretítulo espaçado com pino ou ponto ("CAMPINAS · FAMILIAR DESDE
  2010") em cima do título, uma palavra do título em outra cor, faixa de
  números ("+500 clientes · 4,9 · 24 h"), checklist de vantagens com ✓ e
  cards numerados 01, 02, 03. Também não entra: trocar um vício por outro não
  resolve.

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

### Leis de UX que o gate não mede (03/11/2026)

Tiradas uma vez do Laws of UX e do Component Gallery; não precisam ser abertos
a cada lead. O que já está neste arquivo (as cinco perguntas, o toque de 40 px,
os bytes, o contraste, as perguntas em `<details>`, um WhatsApp só) não se
repete aqui.

- **Uma ação principal.** O botão do WhatsApp é o único botão cheio da página,
  com o mesmo texto em toda parte. Telefone, Instagram e Maps são links de
  texto. Em urgência, "Ligar" pode ser o segundo botão, de contorno, nunca do
  mesmo peso. Duas ações iguais fazem o visitante parar para escolher.
- **A cor de destaque é do botão.** A cor que chama o olho fica no WhatsApp;
  nenhum bloco grande usa a mesma cor de fundo, senão o botão some nele.
- **Começo e fim.** O que fica na memória é a primeira tela e o fecho. A
  primeira tela responde à pergunta 1 com o botão; antes do rodapé vem um
  fecho que repete o WhatsApp, o endereço e o horário, não uma seção que só
  acaba.
- **Convenção.** Nome ou logo no topo à esquerda, até 5 âncoras no menu com os
  nomes de sempre, endereço com o link do Maps, telefone em `tel:`, contato no
  rodapé. Menu de três linhas só no celular.
- **Grupos pequenos.** Serviços em grupos de 3 a 6 itens, cada um com título de
  até 5 palavras e uma frase; passando de 6, agrupe pelo problema do cliente.
  Sem número nos cards ("Cara de IA").
- **Perto quer dizer junto.** O espaço entre seções é pelo menos o dobro do
  espaço dentro delas; título, texto e botão de um bloco ficam juntos; cada
  seção se separa da outra por fundo ou fio.
- **Leitura.** Corpo de 16 px ou mais, entrelinha perto de 1,5 e linha de até
  ~75 caracteres no desktop: o texto vai num painel ao lado da foto, nunca de
  ponta a ponta em 1440 px.
- **Nada de carrossel** nem slider automático: fotos e avaliações em grade ou
  lista que rola com a página. O primeiro link da página é "Pular para o
  conteúdo", visível quando recebe o foco.

## Como trabalhar cada lead

A ordem importa, e **a direção nasce desenhada, não escrita (03/11/2026)**.
No passo 2, a `frontend-design` e os dials da `/design-taste-frontend` geram
**duas pranchas** de wireframe a 1440 px, uma pelo shot e outra pela página
real, e você escolhe uma olhando as duas ao lado das referências. No passo 3,
a `/ui-ux-pro-max` e o `/impeccable` transformam a prancha escolhida em
sistema. Só então vem o `index.html` (passo 4), escrito seção por seção a
partir da prancha. `/emil-design-eng` e o `audit`/`polish` do `/impeccable`
fecham **no código** (passo 4.5), sem trocar a direção.

*Por que mudou:* nas gerações de 29/10 e 03/11/2026 o `CONCEITO.md` ficava
pronto antes de qualquer skill abrir, as skills só carregavam regra, e o
`index.html` saía num único Write, depois só corrigido. Nenhuma imagem do
site existia antes do código para comparar com o shot. O título ficava com
metade da escala do shot e cada seção virava título, texto e lista.

**A `/design` não roda na execução automática:** ela não está instalada no
Dell e não pode ser chamada pelo agente (`disable-model-invocation`, visto em
29/10 e 03/11/2026). Onde a esteira dizia `/design`, use a `frontend-design`.

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
abra o perfil antes da prancha do passo 2 e puxe: foto de perfil (o logo real, se tiver
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

**1.5.1. As cinco perguntas.** A estrutura da página (13/10/2026). São as
perguntas de quem chega pelo Google, na ordem em que as tem, cada uma numa
seção com nome comum. A primeira `<section>` dentro de `<main>` continua
sendo o "Ato I" que o gate mede; o visitante nunca vê "Ato", número de seção
nem índice de progresso.

1. **Chegada: "é isto, é perto?"** Um `<h1>` de uma frase com o ofício e o
   bairro ou a cidade, nas palavras de quem procura ("Desentupidora 24 horas
   no Jardim Tatiana, em Votorantim"). Abaixo, o fato que distingue este
   negócio, com fonte (quem atende, a frota, o horário, desde quando pelo
   CNPJ), a nota e o número de avaliações do Google, o botão do WhatsApp (e
   "Ligar", em urgência) e uma foto real. Tudo na primeira tela do celular.
2. **Serviços: "resolve o meu caso?"** O que o negócio faz, tirado do
   `content.md`, do Instagram e das fotos, escrito como o cliente descreve o
   problema. Cada item pode ter o seu botão de WhatsApp com a mensagem pronta;
   é a única interação da página. Sem campo de texto, sem caixa de marcar.
3. **Como funciona: "como vai ser?"** Horário, região atendida, como é o
   primeiro contato, o que mandar ou levar. Três ou quatro passos curtos.
4. **Prova: "dá para confiar?"** Fotos reais legendadas, a nota, o que os
   clientes elogiam (parafraseado, sem aspas), tempo de mercado só com fonte.
   Advocacia e saúde: sem avaliações (regra dos conselhos, ver "Ramos novos").
5. **Contato: "como eu chamo?"** WhatsApp, telefone, endereço com o link do
   Maps, horário; rodapé com dados reais.

Entre a prova e o contato, as **perguntas frequentes** (3 a 5, fechadas em
`<details>`; regras em "Perguntas frequentes e SEO técnico"): é a parte da
página que o Google e os assistentes de IA citam.

Sempre: barra de WhatsApp fixa no celular depois que a primeira tela sai de
vista. **No máximo 6 telas de celular** (o gate avisa acima de 6 e reprova acima de 8). Uma seção
a mais só entra se responder a uma pergunta real deste negócio (por exemplo
"Atende condomínio?" numa dedetizadora que emite laudo); se ela não responde a
pergunta nenhuma, sai.

**A metáfora, se houver, fica só no visual.** A ideia de 08/10/2026 (a pasta
do caso na advocacia, a linha da tubulação na desentupidora, a régua de
etapas na reforma) pode inspirar a cor, uma imagem ou **um** detalhe de
movimento, por exemplo a linha que acompanha a lista de serviços. Nunca o
título, o menu, o nome das seções nem a estrutura. Metáfora que precisa de
explicação sai.

Grave `<slug>/CONCEITO.md` (nunca sobe para a Vercel), curto: o título e por
quê; o fato que distingue este negócio, com a fonte; o shot e a página real do
passo 1.6 (título, URL) e o que você tirou de cada um para o desktop e para o
celular; o par de fontes e a linha do `FONTES.md`; e cada efeito de
movimento com o que ele significa. Efeito sem linha não entra. O
`CONCEITO.md` começa aqui e **fecha no passo 2**, com a escala medida do
shot, o mapa da composição e a prancha escolhida.

**1.6. Duas referências: um shot do Dribbble e uma página real do nicho
(14/10 e 03/11/2026).** Antes da prancha do passo 2, **a cada lead e a cada pedido de
melhorar um site**. O shot do Dribbble manda na composição e no tom; a página
real do Land-book (logo abaixo) mostra o que o shot não mostra: a página
inteira, a quantidade de texto de verdade e o celular. Substitui a biblioteca
fixa de 13/10 (`REFERENCIAS.md`, só primeiras telas de celular de sites de
bairro) e o Refero (acervo de SaaS). Motivo, nas palavras do Rômulo: os sites
estavam "focados demais em mobile". O Dribbble mostra composição de desktop de
verdade, e é dela que o site precisa.

```
python3 ~/.local/bin/dribbble buscar --saida <rascunho>/dribbble/busca --consulta "<ramo em inglês> website" --consulta "<ramo em inglês> landing page" --max 24
python3 ~/.local/bin/folha-de-contato --saida <rascunho>/dribbble/busca/folha.jpg --pasta <rascunho>/dribbble/busca
python3 ~/.local/bin/dribbble shot <link do shot escolhido> --saida <rascunho>/dribbble/shot
python3 ~/.local/bin/folha-de-contato --saida <rascunho>/dribbble/shot/folha.jpg --pasta <rascunho>/dribbble/shot
```

A busca é a dos populares (`/search/shots/popular?q=`), em inglês: "law firm",
"plumber", "pest control", "accounting firm", "equipment rental", "dumpster
rental", "home renovation". O `indice.txt` liga cada miniatura ao link do shot.
O `shot` baixa as imagens e, quando o shot é vídeo, tira 6 quadros dele com o
ffmpeg: é a página inteira do design, não só a capa. O curl leva 202 sem corpo
(desafio anti-robô); o Chrome headless passa, sem login.

Escolha **um** shot e siga-o. Critérios, nesta ordem:

1. **Serve às cinco perguntas** do passo 1.5.1 (dá para pôr o ofício e a cidade
   no título, um botão de WhatsApp em cada seção, prova e contato).
2. **Combina com o negócio**: sóbrio para advocacia e contabilidade, direto e
   de alto contraste para urgência, técnico para indústria. Nada de cliché do
   ramo (balança, estátua da Justiça, martelo, terno em banco de imagem).
3. **Tem composição de desktop**: painéis, grade, foto grande ao lado do texto,
   ritmo entre seções. Shot só de celular, de aplicativo ou de dashboard não
   serve.

Do shot vêm a **composição** (como o hero divide texto e foto, a grade, os
painéis, o espaçamento, a escala da tipografia, o fecho) e o **tom** (peso da
letra, raio, contraste). Da **marca real** (passo 1.5) vêm as cores e o detalhe
que só este negócio tem. Nunca copie texto, logo, foto, ícone ou marca do
shot; e o que a seção "Cara de IA" proíbe continua proibido mesmo se o shot
tiver (rótulo em caixa alta espaçada, cards numerados 01-02-03, faixa de
números).

O **exemplo aprovado** está em `~/auto-site/_exemplos/jessica-barbosa-advocacia-advo/`
(`index.html` e `CONCEITO.md`; no ar em
https://demo-jessica-barbosa-advocacia-advo.vercel.app). O shot foi o "Alden &
Vale" (https://dribbble.com/shots/27806443), e o Rômulo aprovou em 14/10/2026:
"acertou no design!". É o piso de qualidade, não um molde: o próximo lead
segue o shot dele. Dribbble fora do ar ou sem resultado depois de trocar a
consulta não para o lead: a página real do Land-book passa a mandar também na
composição; sem as duas, siga a composição do exemplo e diga no resumo final.

**A página real do nicho (Land-book, 03/11/2026).** O shot é um conceito: quase
nunca traz a página inteira, nunca traz o celular e o texto dele é de enfeite.
Depois de escolher o shot, ache **uma** página publicada do mesmo ramo no
Land-book (sites no ar e templates construídos, com captura da página inteira
no desktop e o link do site):

```
python3 ~/.local/bin/landbook buscar --saida <rascunho>/landbook/busca --consulta "<ramo em inglês>" --consulta "<outro nome do ramo>" --max 24
python3 ~/.local/bin/folha-de-contato --saida <rascunho>/landbook/busca/folha.jpg --pasta <rascunho>/landbook/busca
python3 ~/.local/bin/landbook pagina <link escolhido> --saida <rascunho>/landbook/pagina
python3 ~/.local/bin/qa-numerico --celular "<site do site.txt>" <rascunho>/landbook/pagina/celular.png
python3 ~/.local/bin/folha-de-contato --saida <rascunho>/landbook/pagina/folha.jpg <rascunho>/landbook/pagina/tela-*.jpg <rascunho>/landbook/pagina/celular.png
```

A folha da página junta as telas (`tela-NN.jpg`), nunca a `pagina.*` inteira:
alta como é, ela derruba a escala da folha a ponto de não dar para ler. A
busca acha por semelhança e sempre devolve alguma coisa, e mistura escritório
de verdade com software do ramo (Legora e Spellbook em "law firm") e com
template à venda; o tipo vai entre colchetes no `indice.txt`. Software sai;
template construído serve; se nada da folha servir, troque a consulta. Escolha
pela mesma régua do shot. Dela vêm **a ordem e o tamanho das seções, a
quantidade de texto de cada uma e como o desktop vira celular** (a captura do
site no ar; se ela sair em branco, o site recusa moldura: siga sem ela). Nunca
o texto, a foto nem a marca. Se ela e o shot discordarem na composição do
desktop, vale o shot; na quantidade de texto e no celular, vale a página real.
Land-book sem resultado útil não para o lead: siga só com o shot e diga no
resumo final.

Fora da esteira (avaliados em 03/11/2026, ver `decisoes.md` do PRUMO):
Awwwards (o `robots.txt` proíbe a busca automática; o "site do dia" é
experimental e pesado demais), Lapa Ninja, Landingfolio, SaaS Landing Page,
Saaspo e Refero (acervo de SaaS), Mobbin, Page Flows, ScreensDesign e Refcat
(telas de aplicativo, atrás de login), Pinterest (proíbe robô e não diz de
onde vem a imagem), Godly/recent.design (portfólio animado), Webframe e UX
Archive (fora do ar). Laws of UX e Component Gallery já estão destilados em
"Leis de UX que o gate não mede"; o Typewolf, no `FONTES.md`. Nenhum deles se
abre a cada lead.

**O estilo sai da marca real (passo 1.5) e do shot**, não de um catálogo de
estilos. Antes de decidir, olhe as últimas 5 linhas do `registro.md` e não
repita a cor dominante nem o par de fontes de nenhum dos últimos 5 do mesmo
nicho (11 demos de advocacia seguidos saíram em serif com itálico sobre creme
ou azul-marinho). **O par de fontes sai do `~/auto-site/FONTES.md`** (03/11/2026):
pares gratuitos do Google Fonts, por clima e por nicho. Escolha uma linha do
nicho que não esteja nos últimos 5; o shot continua decidindo a escala e o
peso. Fonte fora da tabela só com motivo escrito no `CONCEITO.md`.

Antes do passo 2, diga em uma frase: o título, o shot (título e URL) e o que
ele decide no desktop, e a página real (título e URL) e o que ela decide no
texto e no celular. No passo 7, registre também
`Dribbble: <título> — <URL>; aplicado: <o que veio dele>` e
`Land-book: <título> — <URL>; aplicado: <o que veio dela>`.

**2. Prancha de direção: duas, antes de qualquer linha do `index.html`
(03/11/2026).** É aqui que a ideia do site nasce, a partir da marca real, do
shot e da página real do passo 1.6, dentro das cinco perguntas do passo
1.5.1. Não é uma consulta opcional: é o passo que impede o site de sair
simples. Se você chegou ao código sem as duas pranchas e a folha delas,
parou e voltou. Conte até ~8 minutos para ele; é o passo que mais muda o
resultado.

- **2.1 Abra as duas skills de direção.** A `frontend-design` com o brief
  (o que o negócio é, a marca real, o shot, a página real, as cinco
  perguntas), e a `/design-taste-frontend` para a "Design Read" de uma linha
  (tipo de página, público, linguagem) e os três dials (variância,
  movimento, densidade). Elas decidem a prancha, não escrevem a página: a
  stack delas não vale (ver "Nenhuma skill passa por cima deste arquivo").
- **2.2 Meça o shot.** Na folha do shot, a 1440 px: a altura do título
  principal em px, a razão entre título, subtítulo e corpo, o número de
  colunas, a largura do painel de texto, o espaço entre seções, o raio e o
  peso da letra. Grave como "Escala" no `CONCEITO.md`. É o número que o
  título do site precisa alcançar; título com metade da escala do shot é
  defeito, não sobriedade.
- **2.3 Mapeie a composição.** No `CONCEITO.md`, uma tabela com uma linha por
  seção do shot, de cima para baixo: o que o shot faz ali (grade, painel,
  componente) e o que entra no site. Para tudo o que a "Cara de IA" proíbe,
  escreva o substituto permitido, para nenhum vão ficar vazio:
  - faixa de números → faixa de fatos com fonte (nota e número de avaliações
    do Google, ano do CNPJ, região atendida, horário);
  - depoimento entre aspas → cartões com o que os clientes elogiam,
    parafraseado (advocacia e saúde: como funciona o atendimento);
  - formulário → um botão de WhatsApp por serviço, com a mensagem pronta;
  - cards numerados 01-02-03 → cards com o problema do cliente no título;
  - bloco grande na cor de destaque → fundo escuro da marca ou foto tratada
    (a cor de destaque fica no botão);
  - foto de estúdio do shot → foto real tratada (recorte, cor, grão) no
    tamanho que ela aguenta, e o visual grande feito em código (forma,
    padrão, tipografia);
  - sobretítulo em caixa alta → nada: o título direto já orienta.
  Uma seção do shot que não tem substituto sai inteira; nunca fica pela
  metade. E nenhuma seção do site é só título, parágrafo e lista: cada uma
  tem o seu componente (painel com foto, faixa de fatos, cartão destacado,
  grade de prova, lista de passos, fecho com horário). O exemplo aprovado
  tem um por seção, dentro das mesmas regras.
- **2.4 Desenhe duas pranchas** em `<rascunho>/prancha/a.html` e `b.html`:
  HTML com blocos cinza no lugar das fotos (na proporção da foto real que vai
  ali), o texto real ou do tamanho real, o par do `FONTES.md` na escala
  medida no 2.2 e as cinco perguntas. **A** segue a composição do shot;
  **B** segue a ordem e o tamanho das seções da página real. Sem cor final,
  sem efeito, sem foto embutida: é para decidir composição, não acabamento.
- **2.5 Ponha as duas na mesma folha das referências.** Capture cada prancha
  a 1440×900, uma tela por vez pela âncora
  (`google-chrome --headless=new --screenshot=<rascunho>/prancha/d-a-1.png --window-size=1440,900 "file://<rascunho>/prancha/a.html#<id da seção>"`,
  `d-a-2.png` na tela seguinte, `d-b-1.png`… para a B), e o celular com `qa-numerico --celular`; junte numa
  folha só, com as imagens do shot (`shot-NN.*`, ou `quadro-NN.jpg` quando o
  shot é vídeo) e as telas da página real:
  `python3 ~/.local/bin/folha-de-contato --saida <rascunho>/prancha/folha.jpg --pasta <rascunho>/prancha --refs <imagens do shot> <rascunho>/landbook/pagina/tela-*.jpg`.
- **2.6 Escolha pela folha**, nesta ordem: responde às cinco perguntas;
  mantém a escala e o respiro do shot; cada seção tem componente próprio;
  cabe em até 6 telas no celular. Pode misturar (o hero de A, os serviços de
  B) se disser por quê. Grave no `CONCEITO.md` a prancha escolhida e o
  motivo em duas frases. A prancha escolhida é o contrato do passo 4.

**3. Transformar a prancha em sistema — ainda antes do `index.html`.** Duas
skills, nesta ordem. Nenhuma troca a prancha escolhida nem a estrutura do
1.5.1, e nenhuma traz de volta o que a seção "Cara de IA" proíbe.

- **3.1 `/ui-ux-pro-max`** — paleta da marca real com contraste checado, o
  par tipográfico do `FONTES.md`, a escala do passo 2.2 e o espaçamento.
  Grave os valores (cores, tamanhos, espaços) no `CONCEITO.md`: eles viram
  as variáveis CSS do passo 4.
- **3.2 `/impeccable`** — modo **Persuade** (landing que converte). A direção
  vem fixada pela prancha e pelo passo 3.1: é brief pinado, então **não** rola mundo
  visual novo (`new-work`), não abre `serve-question`, não roda `init` nem
  `shape` com entrevista — o `content.md` é a verdade de produto. Rode o
  `impeccable context` — ele vai avisar `NO_PRODUCT_MD` e
  `PRODUCT_INIT_REQUIRED`; é esperado, ignore. Não escreva PRODUCT.md nem
  DESIGN.md: a direção está no `<slug>/CONCEITO.md`, na prancha escolhida e
  nas referências do passo 1.6. Leia `reference/craft-floor.md` imediatamente antes do passo 4: o
  piso de qualidade e as proibições (inclusive as fontes padrão de IA) valem
  para o HTML que vai ser escrito.

**4. Escrever** `<slug>/index.html` **a partir da prancha escolhida**, seção
por seção: a estrutura e a escala vêm dela, o cinza vira foto, cor e texto
finais, e os valores do passo 3.1 viram as variáveis CSS. Depois da primeira
versão, capture o desktop e ponha na mesma folha da prancha e do shot
(`--refs <capturas da prancha escolhida> <imagens do shot>`). Onde a página ficou com
menos escala, menos respiro ou menos componente do que a prancha, o conserto
é voltar à prancha, não aceitar a perda.

**4.5. Polir no código.** Uma rodada em lote, não um loop.

- **`/emil-design-eng`** — invoque já com o alvo (`<slug>/index.html`) e a
  pergunta concreta; sem pergunta ela só devolve a saudação. Revisa o que o
  dono sente com o dedo: estado de toque dos botões, easing e duração,
  transição de entrada, nada animando de `scale(0)`, `prefers-reduced-motion`.
  Aplique a tabela Before/After. O movimento segue a seção 2 da "Barra de
  excelência": pouco, sóbrio e com motivo.
- **`/impeccable audit`** e depois **`/impeccable polish`** no `index.html` —
  captura desktop e celular juntos, corrige tudo num lote, no máximo mais uma
  rodada de confirmação. **Captura de celular só com o gate** (13/10/2026):
  `python3 ~/.local/bin/qa-numerico --celular "file://<lead>/index.html#<id da seção>" <rascunho>/qa/m-<seção>.png`
  (`--rm` para reduced-motion). Com `google-chrome --window-size=390,844` a
  página é desenhada com ~500 px de largura e cortada: parecia celular e era
  tablet. Desktop continua com `--window-size=1440,900`. As capturas de cada
  rodada viram **uma** imagem:
  `python3 ~/.local/bin/folha-de-contato --saida <rascunho>/qa/folha-N.jpg --pasta <rascunho>/qa`
  (nome da captura = rótulo: `m-chegada.png`, `d-servicos.png`, `m-chegada-rm.png`),
  e lê-se a folha, não as capturas uma a uma (cada imagem lida fica no
  contexto até o fim do lead e pesa em toda chamada seguinte).
- **O ajuste de altura não desfaz a direção.** Quando o gate avisa que a
  página passou de 6 telas, corte uma seção que não responde a pergunta
  nenhuma ou encurte o texto. Não reduza o título abaixo da escala do passo
  2.2 nem o espaço entre seções abaixo do que a prancha definiu: em
  03/11/2026 o ajuste de 7,3 para 6,0 telas tirou o respiro de todas as
  seções (56 para 40 px) e o bloco de horário e região.
- Feche com o pre-flight check (seção 14) da `/design-taste-frontend`.

**5. Publicar** na Vercel: time `romulodesigns`, projeto `demo-<slug>`,
produção. Caminho: **Vercel CLI** (`vercel` 53.x, já logado nesta máquina como
`sutilromulo-5015`). Não use o MCP da Vercel para isso.

**O que sobe: só o `index.html`, o `og.jpg` (a prévia do link no WhatsApp) e, desde 15/10/2026, o `robots.txt`, o
`sitemap.xml` e o `llms.txt` do `seo-do-site`. Nada mais.** A pasta do lead nunca é
publicada — nem com `.vercelignore`. O deploy sai de uma pasta de staging fora
desta pasta, para onde só esses arquivos são copiados. É lista de permissão, não de
bloqueio: `content.md`, `Fotos/`, `Logotipo/`, `publicado.json`, `seo-places.json` e qualquer
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
for f in robots.txt sitemap.xml llms.txt; do [ -f ~/auto-site/"$slug"/$f ] && cp ~/auto-site/"$slug"/$f "$stage"/; done
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

**7. Anotar** uma linha em `registro.md`: data, lead, slug, URL, o título, o
shot do Dribbble do passo 1.6 (título e URL) e a decisão de design que você
tomou pensando nesse negócio específico.

## Pedido de melhorar o design de um site

Quando o Rômulo pede para melhorar um demo que já está no ar, é o mesmo
processo, do passo 1 ao 7, pelo refazer do runner
(`gerador-de-sites --refazer <slug> --nota "<o que ele disse>"`): o site
anterior vai para `<slug>/_vN/`, e o passo 1.6 busca um shot novo no Dribbble.
Não reaproveite o shot nem a estrutura do site anterior: a nota do Rômulo diz o
que não funcionou. O Raio-X volta ao ar sozinho depois do deploy (o gancho do
runner).

## Barra de excelência — por que cada site precisa valer o investimento

Site "correto" não basta. Para quem nunca teve site, essa página é a primeira
impressão dele na internet, e o Rômulo está vendendo isso como investimento:
tem de parecer feito por um bom estúdio para **este** negócio. Desde
13/10/2026 isso quer dizer o contrário do que parecia em 08/10: um bom site de
serviço local é claro, curto, com foto real e tipografia bem resolvida, e o
capricho está no acabamento, não em efeito. Isto é checklist e roda antes de
fechar o passo 4.5.

### 1. Não repita a cor nem o par de fontes (regra no passo 1.6)

Consulte o `registro.md` antes de escolher. Ver passo 1.6 acima.

### 2. Movimento: pouco, sóbrio e com motivo

O padrão é uma entrada curta do título e da foto da primeira tela (CSS puro,
fade e translateY de até 12 px, até 600 ms) e o retorno de toque nos botões.
Fora isso, **no máximo um** efeito ligado ao negócio, com linha no
`CONCEITO.md` (por exemplo a linha da tubulação que acompanha a lista de
serviços). Scroll-reveal é opcional e, se entrar, é discreto (opacidade, sem
deslocamento grande) e nunca esconde o que já está na tela.

Fora de uso desde 13/10/2026, porque eram a assinatura dos demos que pareciam
gerados: esticamento por velocidade, paralaxe 3D, transição líquida entre
seções, magnetismo no cursor, título revelado por máscara linha a linha,
inércia e lag elástico, sequência presa ao scroll, contadores animados.

Regras do motor, se houver JS de movimento: anime só `transform` e
`opacity`; listeners `passive`; a rolagem nunca é sequestrada; efeito de
cursor só com `matchMedia('(hover: hover) and (pointer: fine)')`; hover
gateado por `@media (hover: hover)` (achado do CLIN ODONTO CSCN, linha 29 do
`registro.md`). `prefers-reduced-motion: reduce` desliga tudo, sem exceção, e
o conteúdo continua o mesmo.

### 3. Um detalhe que só este negócio tem

Uma decisão que não sairia de um gerador: vem da marca real ou do lugar real,
não de um enfeite. A foto da frota na frente da base com a rua na legenda, o
verde exato da placa da recepção, o logo redesenhado limpo a partir da foto da
fachada, o horário de plantão escrito do jeito que o dono escreve no
Instagram. Exemplos de antes que funcionaram pela mesma razão: o mural da
recepção redesenhado em SVG (Studio TRG), a assinatura manuscrita da dona
(Estúdio Marília). Se ao terminar você não consegue apontar esse detalhe em
uma frase, volte ao passo 1.5 e procure de novo na marca real. Não serve:
objeto 3D, letra gigante, polaroide inclinada, brinquedo.

### 4. Checklist de saída do passo 4.5

- [ ] Cor dominante e par de fontes diferentes dos últimos 5 do mesmo nicho
      no `registro.md`; o par saiu do `FONTES.md` (ou o motivo está no
      `CONCEITO.md`)
- [ ] O shot do Dribbble e a página real do Land-book anotados no
      `CONCEITO.md`, cada um com o que decidiu
- [ ] Duas pranchas (A pelo shot, B pela página real) na folha com as
      referências, a escolhida e o motivo no `CONCEITO.md`, com a "Escala"
      medida do shot e o mapa da composição com o substituto de tudo o que
      a "Cara de IA" tirou
- [ ] O título no desktop na escala medida do shot, e cada seção com o seu
      componente (nenhuma é só título, parágrafo e lista)
- [ ] As "Leis de UX que o gate não mede": um botão cheio só, a cor de
      destaque só nele, fecho com WhatsApp, endereço e horário, nenhum
      carrossel
- [ ] Título de uma frase com o ofício e o bairro ou a cidade; no celular, em
      3 s na primeira tela: o que é, onde é e como chamar
- [ ] As cinco perguntas do passo 1.5.1, com nomes comuns no menu e nas
      seções; nenhum "Ato", número romano ou nome de metáfora à vista
- [ ] Até 6 telas de celular; nenhuma seção que não responda a uma pergunta
- [ ] Nenhum campo de texto, quiz ou brinquedo; de qualquer ponto, o WhatsApp
      a até dois toques
- [ ] Nada da seção "Cara de IA"; nenhuma frase de medo, desconfiança,
      urgência artificial ou deboche do ramo; toda afirmação de experiência
      tem fonte
- [ ] Um WhatsApp só, do telefone do Google ou conferido (ver "Regras do
      arquivo")
- [ ] O detalhe da seção 3, citável em uma frase
- [ ] Todo efeito tem linha no `CONCEITO.md`; nenhum sobra
- [ ] Capturas de celular feitas com `qa-numerico --celular` (e uma com
      `--rm`): página completa e legível
- [ ] Capturas de desktop a 1440×900 de cada seção, na mesma folha que os
      quadros do shot do Dribbble e às telas da página real (`folha-de-contato --refs`): a composição
      segue o shot, e nenhuma seção é uma coluna de celular no meio da tela
- [ ] O `qa-numerico` saindo 0: bytes, imagens, contraste, título, menu,
      frases, campos, código de teste, WhatsApp, altura, toque e texto miúdo
- [ ] 3 a 5 perguntas tiradas das avaliações, cada uma com `data-fonte`, e o
      `seo-do-site --exigir-faq` saindo 0 depois do `og.jpg`

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
- follow-up: no 3º dia sem resposta, a Central (server/crm.ts) o põe na fila
  "Próxima venda" com o texto pronto; ela calcula o dia sozinha pelo envio e
  quem manda é o Rômulo. A coluna `followup_em` segue na planilha só como
  histórico: ninguém mais a escreve;
- `enviado → expirado`: 7 dias sem resposta (o mesmo `DIAS_SEM_RESPOSTA` do
  CRM, `EXPIRA_DIAS` no 05 · Acompanhamento); a pasta vai para `_concluidos/`.
  Proposta tem relógio próprio: 10 dias corridos sem retorno (`cadencia.ts`).
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
versionado no SquadOne (`deploy/dell/auto-site/auto-site-CLAUDE.md`). Na
execução automática, escreva a regra proposta no resumo final (o runner grava
no log do lead); numa sessão com o Rômulo, mude o arquivo no SquadOne e faça
merge direto na `main`, sem PR (autorizado por ele em 14/10/2026: "não é um
produto"), e reinstale no Dell.
