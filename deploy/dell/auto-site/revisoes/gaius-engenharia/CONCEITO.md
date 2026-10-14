# Gaius Engenharia — redesign de 14/10/2026

**No ar:** https://demo-gaius-engenharia.vercel.app (projeto `demo-gaius-engenharia`, deploy `dpl_5iAsYMcLj8Jdcq9jBZLKe6NmwMy7`,
com o `og.jpg` de produção e o `raio-x/` novo, SHA-1 conferido). Feito fora do Dell: o conteúdo saiu do demo de
10/10, do perfil no Google, das 21 avaliações e do Instagram @gaius_engenharia, conferidos em 14/10.

**De presente, o Raio-X novo.** O `/raio-x/` era o automático de 10/10 (versão 4: uma busca só, "empreiteira em
Curitiba", Encontrado a R$ 990). Agora é o do modelo aprovado, feito à mão no `gerar.py` do piloto
(`prumo/04-venda/piloto-cdl/leads/gaius-engenharia/`): três buscas, as avaliações mais recentes, o domínio, redes e
anúncios. Presença 6,0 de 18, "Pouco visível".

**Título:** "Steel frame e vistoria de imóvel em Curitiba". Uma frase com os dois ofícios e a cidade: a obra é o que
a Gaius diz ser (bio do Instagram, categoria "Construtora"); a vistoria é o que mais aparece nas avaliações (5 das 18
com texto).

**O fato que distingue:** o mesmo engenheiro monta a estrutura e confere o imóvel pronto. A Gaius fez o projeto
estrutural de fundação e de steel frame da nova portaria do Bosque Tramontin, no Campo Comprido (legenda do reel de
outubro), e o Caio é quem faz as vistorias que os clientes descrevem ("olhou cada canto e marcou tudo").

**Dribbble:** "Wiyasa - Construction Company Website Design" — https://dribbble.com/shots/19263939 (Syahrul Falah
para Vektora); aplicado:
- a folha clara sobre a faixa de cor (lá amarela; aqui o verde do logo), com o menu dentro da folha;
- o título grande à esquerda e o parágrafo curto à direita, sob um fio (aqui com o traço laranja);
- os dois cartões por cima da faixa de fotos, um colorido e um branco, com a seta no canto: Vistoria (laranja)
  sobre a foto do Caio na vistoria, Obra em steel frame (branco) sobre a estrutura vista do alto;
- a faixa de fotos com uma estreita e uma larga;
- as obras num painel escuro com cartões de foto ("Our projects");
- "Get to know us" virou "Quem atende": foto ao lado, lista de fatos com a fonte;
- o fecho escuro com a frase grande e os dados em lista.
Ficaram de fora, pela "Cara de IA": a faixa de números (400+, 11,5, 100+), o carrossel de notícias e o newsletter.

**Celular:** CSS começa em 390 px; o segundo botão, a explicação de cada passo, o Instagram e a caixa de horário
(repetida no Contato) ficam só no desktop; cada serviço é uma linha inteira que abre o WhatsApp. 5,8 telas.

**O detalhe que só este negócio tem:** o G hexagonal do logo redesenhado em SVG (verde, laranja e o fio interno) e as
linhas de construção que aparecem atrás dele no cartão da marca, estendidas pela faixa verde do topo: guias finas
na horizontal e na vertical e duas diagonais laranja, como o desenho técnico do logo.

**Cores e fontes:** verde #034018 e laranja #DE5B02, medidos no cartão do logo que a Gaius publicou no Google; o
cartão laranja usa #C04E00 para o texto branco passar em AA (4,85:1); papel #F6F5F1, tinta #14201A. Onest (uma
família, variável 400–700, 33 KB). Diferente da versão anterior (Tomorrow + Mona Sans, campo verde-escuro
#0D1C14). O `registro.md` do Dell não foi consultado (sessão fora do Dell).

**Movimento:**
- título e parágrafo entram com fade e 10 px (CSS puro, 600 ms): a primeira tela chega montada;
- a seta dos cartões e o sublinhado do serviço respondem ao mouse (só com hover): mostram o que abre;
- barra de WhatsApp e Ligar no celular quando a primeira tela sai de vista.
`prefers-reduced-motion` desliga tudo.

**Números:** 303 KB no total, 162 KB até o fim da primeira seção; fonte 44 KB e foto do hero 73 KB em base64; 5
fotos; CSS 13 KB e JS 0,6 KB; um WhatsApp só, o do Google, (41) 98736-1325; nada abaixo de 12 px; alvos de toque
de 44 px; o título aparece sem JavaScript e com reduced-motion. O `qa-numerico` não rodou (fica no Dell): a conta
acima é do script da sessão.

**Saiu da versão anterior:** a parede em camadas com a lente da vistoria, o menu Guia · Montantes · Travamento ·
Fechamento · Entrega, o seletor "Qual é a sua obra?" que montava a mensagem, o campo "Em poucas palavras", o laudo
desenhado com pontos de exemplo e o e-mail (sem fonte conferida). Entrou "Obra corporativa e frigorífico", da
avaliação de quem construiu o frigorífico com a Gaius.

**Achados para o dono:**
- o domínio gaiusengenharia.com.br venceu em 29/08/2026 e está inativo no Registro.br (é o botão "Site" do Google, o
  LinkedIn e o CNPJ);
- o post de vistoria do Instagram (out/2025) mostra outro celular, (41) 98787-8609, e www.gaiusengenharia.com; o
  site usa só o do Google;
- nenhuma das 21 avaliações tem resposta.

**Pedir ao Caio:** fotos da obra do frigorífico, de uma vistoria em andamento e do sobrado por dentro, em tamanho
original (as do Google têm 960 a 1080 px).
