# Benetti Advocacia Previdenciária — redesign de 15/10/2026

**No ar:** https://demo-benetti-advocacia-previdenciar.vercel.app (projeto `demo-benetti-advocacia-previdenciaria`,
com o `og.jpg` novo e o `raio-x/` de produção, SHA-1 conferido: `index.html` ad1e7fc6…, `raio-x/` 5c040c9c…).
Feito fora do Dell: o conteúdo e as três fotos saíram do demo no ar (versão dos cinco Atos), não do `content.md`.

**Título:** "Advogada previdenciária no Centro de Londrina". Uma frase com o ofício, o bairro e a cidade. O subtítulo
diz o que ela atende (auxílio-doença, perícia, auxílio-acidente, aposentadoria) e onde: sala 301 do Edifício
Metrópole, no Calçadão.

**O fato que distingue:** o foco declarado no benefício por incapacidade, com laudo, quesitos e perícia (LinkedIn
dela), e escritório aberto em 20/08/2021 (Benetti Sociedade Individual de Advocacia, CNPJ 43.207.250/0001-00,
Receita Federal). Advocacia: sem avaliações na página (Provimento 205/2021).

**Dribbble:** "Osborne Legal - Law Firm Landing Page", de Emura — https://dribbble.com/shots/27789863. Busca:
"lawyer website", "law firm landing page" e "attorney website", populares; o Justserv (AC) e o Alden & Vale
(Jéssica Barbosa) ficaram de fora por já terem sido usados. Aplicado:
- o hero num painel grafite com cantos arredondados, foto grande à direita sumindo no escuro, título grande em
  grotesca leve embaixo à esquerda, os dois botões (cheio e contorno);
- o menu numa pílula flutuando no alto do painel, com o botão claro "Falar com o escritório" na ponta;
- a ficha flutuante no canto da foto (no shot, os horários livres; aqui, o endereço e o horário do Google);
- a grade de células com fio fino (no shot, os clientes), com uma célula em destaque em gradiente: aqui, as oito
  situações, cada uma com o seu WhatsApp de mensagem pronta, e o auxílio-doença cortado em destaque;
- "From the first facts to the final order" virou "Como funciona o primeiro atendimento": a lista de etapas à
  esquerda com a marca na primeira, e no lugar do diagrama, o painel "O que separar antes de chamar";
- "Partner-led" virou "Quem atende": retrato num painel com o nome sobre a foto e os fatos ao lado;
- o fecho de contato no painel com luz quente, e o cartão com o endereço à direita.
Ficaram de fora, pelo Provimento 205/2021 e pela "Cara de IA": logos de clientes, depoimentos, o valor recuperado,
o FAQ, o formulário do fecho, a newsletter, os selos, o rótulo em caixa alta acima dos títulos, os números 01–04
e a lista com ✓.

**Celular:** foto em 16:10 no alto do painel, título, subtítulo, os dois botões e a ficha na primeira tela; a célula
"Outra situação" some (o botão geral está no topo e na barra fixa), o retrato de "Quem atende" fica em 2:1. 5,96 telas.

**O detalhe que só este negócio tem:** a sala 301. Os veios do mármore grafite da parede e da mesa (as duas fotos dela)
desenhados em linha fina no painel do hero, e o âmbar dos LEDs da estante como a única cor de destaque: botão,
marca da primeira etapa, ícones da ficha e a luz do fecho.

**Cores e fontes:** grafite #111214 e #18191b (o mármore), texto #ece9e4, apoio #a6a09a, âmbar #e3a65c (a estante).
Albert Sans, uma família só, peso 300–600, subconjunto, 36 KB. Diferente dos últimos de advocacia: Kulniski
(Newsreader + Instrument Sans, papel, vidro e mogno), AC Advocacia (Hanken Grotesk, creme, café e dourado),
Jéssica Barbosa (DM Sans, vinho e areia) e a versão anterior desta (Newsreader + Hanken Grotesk, mármore).

**Movimento:**
- título, subtítulo, botões e foto do hero entram com fade e 12 px (CSS puro, até 700 ms): a primeira tela chega montada;
- a luz âmbar do fecho acende uma vez quando o painel entra na tela: é a luz da estante, que dá o tom do escritório;
- barra de WhatsApp e Ligar no celular quando a primeira tela sai de vista.
`prefers-reduced-motion` desliga tudo, e a luz já fica acesa.

**Saiu da versão anterior:** os cinco Atos e o menu I–V ("Sala 301 · O seu caso · Os separadores · Quem lê"), o
título "Cada papel do seu benefício, no seu separador.", o campo "Ou escreva do seu jeito" com "Pôr na etiqueta",
as caixinhas "O que você já tem em mãos" que montavam a mensagem, a pasta com separadores desenhada e o diálogo
de WhatsApp de exemplo.

**Pedir à Dra. Jéssica:** foto da sala 301 em resolução maior (a do hero tem 640 px de largura), o horário de todos
os dias (o Google mostra só "segunda: abre às 8h; sábado: fechado"), o número da OAB se ela quiser publicar e o logo
em vetor, se houver.

**Gate:** `qa-numerico` passou (192 KB; Ato I 113 KB; fontes 36 KB; 6,0 telas), rodado no PC com o Chrome no PATH
e um `content.md` mínimo (nome, cidade, vertical, telefone) feito a partir do demo no ar. Capturas de 1024 a 1920 px
sem o título encostar no menu.
