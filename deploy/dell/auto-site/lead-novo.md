---
description: Varre a pasta auto, acha os leads sem site e produz o site de cada um
argument-hint: "[quantidade, padrão 1] ou [slug específico]"
---

Você vai rodar a esteira "Site antes da venda" para os leads que estão esperando.

## 1. Montar a fila

Liste os diretórios em `.` (a raiz do workspace `auto`). Um lead está na fila
quando a pasta tem `content.md` e **não** tem `index.html`.

- Sem argumento: processe **1 lead**, o mais antigo pela data em `content.md`.
- Argumento numérico: processe essa quantidade, um de cada vez, do começo ao fim
  de cada um antes de começar o próximo.
- Argumento com nome de pasta: processe só aquele lead, mesmo que já tenha
  `index.html` (refação).

Se a fila estiver vazia, diga isso e pare. Não invente lead, não vá buscar em
outro lugar: quem enche a fila é o n8n.

Mostre a fila antes de começar.

**Antes de desenhar (passo 2 do `CLAUDE.md`):** se o `content.md` do lead trouxer indício
forte de presença digital fraca ou nula (falta WhatsApp e e-mail, sem
Instagram, sem site, sem avaliação recente), pare esse lead aqui — pesquise
se o negócio ainda funciona (regra em `CLAUDE.md`) e devolva o achado pro
Rômulo em vez de decidir sozinho. Não conta como "publicado" nem como
"descartado" — não mexe no `registro.md`, não move pra `_descartados/`. Se
processando em lote, siga pro próximo lead da fila.

## 2. Para cada lead

Siga os passos do `CLAUDE.md` — ler `content.md` e as imagens de `Fotos/` e
`Logotipo/`, marca real (Instagram, se tiver), as cinco perguntas (passo
1.5.1, começa o `CONCEITO.md`), um shot do Dribbble e uma página real do
Land-book (passo 1.6, `dribbble buscar`/`shot` e `landbook buscar`/`pagina`),
a prancha de direção (passo 2: `frontend-design` e `/design-taste-frontend`,
escala medida do shot, mapa da composição, **duas pranchas** a 1440 px na
folha com as referências, uma escolhida), o sistema (passo 3:
`/ui-ux-pro-max` → `/impeccable`), escrever a partir da prancha, polir no
código (`/emil-design-eng` → `/impeccable audit` + `polish`), publicar,
recibo, registro. Tudo até o passo 3 vem antes de qualquer linha do
`index.html`; só a `/emil-design-eng` e o `audit`/`polish` rodam sobre o HTML
pronto. A `/design` não roda aqui (não está instalada no Dell): no lugar dela,
a `frontend-design`.

Releia as restrições do `CLAUDE.md` antes de escrever o HTML. As que mais
escapam (auditoria dos 54 demos no ar em 13/10/2026):

- o título é **uma frase** com o ofício e o bairro ou a cidade ("Desentupidora
  24 horas no Jardim Tatiana, em Votorantim"); nada de duas frases de efeito,
  aspas ou título que não diz o que a empresa faz
- menu e seções com nome comum (Serviços, Como funciona, Avaliações, Onde
  fica, Contato); nunca I, II, III, nunca o nome da metáfora. A metáfora, se
  houver, fica só no visual
- até 6 telas de celular; seção que não responde a uma das cinco perguntas sai.
  O ajuste de altura corta seção ou texto, nunca a escala do título nem o
  respiro que a prancha definiu
- o título no desktop na escala medida do shot (passo 2.2), e cada seção com
  o seu componente: nenhuma é só título, parágrafo e lista
- nenhum campo de texto, quiz, teste ou brinquedo: um botão de WhatsApp por
  serviço, com a mensagem pronta, é toda a interação
- nada da seção "Cara de IA" do `CLAUDE.md`: polaroide inclinada, bilhete
  manuscrito, letra gigante, objeto 3D em SVG, vidro fosco, frase de gaveta
- um WhatsApp só: o telefone do Google, ou o "achado na busca" depois de
  conferido, com a fonte no `registro.md`
- o código do modo de captura (`?qa`, `html.qa`, `#qa-resultado`) não vai no
  arquivo publicado
- captura de celular só com `qa-numerico --celular` (com `--window-size` o
  Chrome desenha a página com ~500 px)
- orçamento de bytes e o resto medidos pelo `qa-numerico` antes do deploy, até
  sair 0; as capturas de cada rodada lidas numa folha de contato só
- nenhuma frase de medo, desconfiança, urgência artificial ou deboche do ramo;
  experiência só com fonte (anos, nota, horário)

- abra as fotos de `Fotos/` e `Logotipo/` (passo 1) antes de decidir estilo —
  não decida só pelo texto do `content.md`
- se o `content.md` trouxer Instagram, puxe logo/paleta/bio de lá **antes** do
  passo 2 (passo 1.5) — sem isso o site perde a marca real (aconteceu com a
  Academia Korpus)
- sem Instagram, procure a marca **dentro** das fotos antes de desistir dela:
  placa, letreiro, fachada, jaleco, impresso. Na CLIN ODONTO CSCN o logo e o
  posicionamento inteiros estavam na placa da recepção, e o `content.md` não
  dizia nada
- escolha o shot do Dribbble do passo 1.6 e leia os quadros dele antes da
  prancha — não pule direto pra skill sem essa decisão tomada; o desktop
  segue a composição do shot, não é a coluna do celular esticada
- `Logotipo/` não vazia não quer dizer logo aproveitável de cara — mas antes de
  descartar, tente extrair: recorte o logo isolado da foto (fundo, placa,
  fachada), teste se limpa em fundo sólido/transparente. Só ignore se a foto
  não tem logo nenhum, não se ele "não presta pronto"
- as fotos de `Fotos/` **vão** publicadas desde 15/09/2026, mas escolhidas:
  nada de imagem de paciente (radiografia, boca, antes e depois), nada que
  desminta a copy, nada que assuste quem tem medo de dentista. Redimensionadas,
  comprimidas e em base64 no arquivo único
- **todo site sai com foto, mínimo 2** (reforço de 16/09/2026). Se `Fotos/`
  vier vazia ou só com imagem proibida, use foto ilustrativa grátis do Unsplash
  (gente sorrindo em contexto de casa/família, nunca consultório de banco de
  imagem), com crédito no rodapé e comentário pedindo as fotos reais ao dono.
  Site só com tipografia e forma não fecha o passo 4, e objeto desenhado em
  código não substitui foto
- avaliação do Google **nunca** vira depoimento entre aspas
- nada de conteúdo inventado — serviço, tempo de mercado, selo, número
- nenhuma skill passa por cima do `CLAUDE.md`: a stack React/Tailwind/Motion da
  `/design-taste-frontend` não vale (arquivo único, sem CDN), e o `/impeccable`
  não entrevista, não abre página de escolha nem rola direção nova — a direção
  já está fixada nos passos 1.5.1 e 1.6 e na prancha escolhida do passo 2

## 3. Ao terminar

Um parágrafo curto, sem tabela:

- quantos leads entraram e quantos saíram publicados
- para cada um, a URL, o título, as duas referências e **uma frase** sobre a
  decisão de design que você tomou pensando naquele negócio — não uma
  descrição do que a página tem
- o que falhou, se falhou, e por quê

Se algum lead ficou sem site, diga qual e o motivo real. Não arredonde.
