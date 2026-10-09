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

**Antes de tocar em `/design`:** se o `content.md` do lead trouxer indício
forte de presença digital fraca ou nula (falta WhatsApp e e-mail, sem
Instagram, sem site, sem avaliação recente), pare esse lead aqui — pesquise
se o negócio ainda funciona (regra em `CLAUDE.md`) e devolva o achado pro
Rômulo em vez de decidir sozinho. Não conta como "publicado" nem como
"descartado" — não mexe no `registro.md`, não move pra `_descartados/`. Se
processando em lote, siga pro próximo lead da fila.

## 2. Para cada lead

Siga os passos do `CLAUDE.md` — ler `content.md` e as imagens de `Fotos/` e
`Logotipo/`, marca real (Instagram, se tiver), metáfora e Atos (passo 1.5.1,
grava o `CONCEITO.md`), escolher
o estilo visual, `/design`, refino da direção (`/design-taste-frontend` →
`/ui-ux-pro-max` → `/impeccable`), escrever, polir no código
(`/emil-design-eng` → `/impeccable audit` + `polish`), publicar, recibo,
registro. As cinco skills rodam sempre, nessa ordem. `/design` e as três de
refino vêm antes de qualquer linha de código; só a `/emil-design-eng` e o
`audit`/`polish` rodam sobre o HTML pronto.

Releia as restrições do `CLAUDE.md` antes de escrever o HTML. As que mais
escapam:

- a página é uma história em cinco Atos guiada por uma metáfora do ofício
  (passo 1.5.1), não o esquema "hero, serviços, diferenciais, contato"; a
  metáfora mostra o cuidado, nunca o problema, e a navegação é ela
- todo efeito de movimento tem linha na tabela "efeito → Ato → o que
  significa" do `CONCEITO.md`; o que não significa nada sai. Cursor só com
  `pointer: fine`, `prefers-reduced-motion` completo, título e foto do Ato I
  visíveis sem esperar JS
- orçamento de bytes medido antes do deploy (fim do Ato I ≤ 200 KB, arquivo
  ≤ 450 KB, CSS ≤ 35 KB, JS ≤ 25 KB), fotos em WebP
- nenhuma frase de medo, desconfiança, urgência artificial ou deboche do ramo;
  experiência só com fonte (anos, nota, horário)

- abra as fotos de `Fotos/` e `Logotipo/` (passo 1) antes de decidir estilo —
  não decida só pelo texto do `content.md`
- se o `content.md` trouxer Instagram, puxe logo/paleta/bio de lá **antes** do
  `/design` (passo 1.5) — sem isso o site perde a marca real (aconteceu com a
  Academia Korpus)
- sem Instagram, procure a marca **dentro** das fotos antes de desistir dela:
  placa, letreiro, fachada, jaleco, impresso. Na CLIN ODONTO CSCN o logo e o
  posicionamento inteiros estavam na placa da recepção, e o `content.md` não
  dizia nada
- escolha **um** estilo de frontend da lista do passo 1.6 antes do `/design` —
  não pule direto pra skill sem essa decisão tomada
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
  Site só com tipografia e forma não fecha o passo 4
- avaliação do Google **nunca** vira depoimento entre aspas
- nada de conteúdo inventado — serviço, tempo de mercado, selo, número
- nenhuma skill passa por cima do `CLAUDE.md`: a stack React/Tailwind/Motion da
  `/design-taste-frontend` não vale (arquivo único, sem CDN), e o `/impeccable`
  não entrevista, não abre página de escolha nem rola direção nova — a direção
  já está fixada no passo 1.6 e no `/design`

## 3. Ao terminar

Um parágrafo curto, sem tabela:

- quantos leads entraram e quantos saíram publicados
- para cada um, a URL, a metáfora (família + instância) e **uma frase** sobre a
  decisão de design que você tomou pensando naquele negócio — não uma
  descrição do que a página tem
- o que falhou, se falhou, e por quê

Se algum lead ficou sem site, diga qual e o motivo real. Não arredonde.
