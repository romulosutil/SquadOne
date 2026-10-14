<!-- Cópia instalada de ~/SquadOne/deploy/dell/auto-site/REFERENCIAS.md. Não edite aqui: mude por PR no SquadOne e reinstale (dell-status --instalados mostra o comando). -->

# Referências — sites reais de serviço local

Biblioteca do passo 1.6 do `CLAUDE.md`, criada em 13/10/2026 no lugar do
Refero (acervo de produto SaaS, que ensinava gramática de aplicativo a uma
desentupidora de bairro). Cerca de 400 sites de serviço local foram capturados
no celular, em 7 nichos; ficaram 3 por nicho. **Nenhum é perfeito:** serviço
local quase nunca contrata estúdio bom, e cada referência está aqui por um
princípio, não para ser copiada. Os bons ganham em três coisas simples, não em
sofisticação visual: foto do que é deles, título literal e telefone por
extenso.

## Como usar

1. Leia a folha do nicho do lead: `~/auto-site/referencias/<nicho>.jpg` (a
   primeira tela de cada referência no celular, capturada em 13/10/2026).
   Uma imagem só, já pronta: não precisa de internet.
2. Escolha **duas** e anote no `CONCEITO.md` o princípio de cada uma (está na
   tabela abaixo).
3. Se quiser ver mais da página (a segunda tela, a lista de serviços), capture
   ao vivo: `python3 ~/.local/bin/qa-numerico --celular https://<site>/ <rascunho>/refs/<site>.png --rm`.
   Site que mudou, saiu do ar ou pede verificação de robô: fique com a folha.
4. **Copie o princípio, nunca o resto:** layout, texto, marca, foto, ícone e
   cor são deles. E vários desses sites já têm, mais abaixo da primeira tela,
   o esqueleto de template de IA que estamos tirando dos nossos (ver
   "Cuidado" em cada linha e a seção "Cara de IA" do `CLAUDE.md`).

Nicho do Caçador → folha:

| Vertical no `content.md` | Folha |
|---|---|
| advocacia | `advocacia.jpg` |
| contabilidade | `contabilidade.jpg` |
| desentupidora, encanador | `desentupidora.jpg` |
| dedetização, controle de pragas | `dedetizadora.jpg` |
| reformas, construção, engenharia, marcenaria, pintura | `reformas.jpg` |
| locação de equipamentos, caçamba, andaime | `locacao-e-cacamba.jpg` |
| faz-tudo, marido de aluguel, reparos | `faz-tudo.jpg` |
| indústria e B2B (usinagem, caldeiraria) | ainda sem folha: use `locacao-e-cacamba.jpg` (a máquina e a frota como prova) e `reformas.jpg` (título = serviço + cidade) |

## O que os melhores fazem e os nossos não faziam

1. **A foto é do que é deles**, sem moldura nem inclinação: a frota com o
   adesivo, a equipe uniformizada em fila, a porta do escritório, a caçamba com
   o nome pintado, o dono ao lado da própria van, o pátio cheio.
2. **O título é literal:** serviço + cidade ("House Extensions in London",
   "Albury / Wodonga Skip Bin Hire") ou o slogan real da casa. Nenhum usa
   aforismo com palavra em itálico.
3. **O telefone aparece escrito**, como rótulo do botão ou numa barra logo
   abaixo do logo, e muitas vezes de novo numa barra fixa embaixo com dois
   botões. No Brasil: "Ligar" e "WhatsApp" lado a lado.
4. **Um número por unidade ou região**, com o nome dela.
5. **Pessoa com nome:** "Hi, I'm Todd", "See Mike's Work", o dono com o
   telefone direto. A confiança vem do nome, não de adjetivo.
6. **Prova local concreta:** a rua da obra na legenda, "desde 1917", os bairros
   atendidos, a nota com o número de avaliações.
7. **Marca de uma ou duas cores**, as mesmas do uniforme, da van ou da caçamba.
   Nos ofícios, tipografia condensada e pesada; em advocacia e contabilidade,
   serif sóbria, sem itálico decorativo.
8. **Serviços como foto do trabalho ou lista de tarefas tocáveis**, não grade
   de cards com ícone.
9. **Promessa que se mede** no lugar de adjetivo: mesmo dia, preço depois de
   ver o problema, garantia de 15 dias, horário.
10. **Página curta:** os melhores cabem em 2 a 7 telas. Nenhum abre com
    formulário. Chips, vidro fosco e algarismos romanos não aparecem em nenhum.

## Advocacia — `advocacia.jpg`

| # | Site | Princípio | Cuidado |
|---|---|---|---|
| 1 | stagetorn.dk (Dinamarca, 5 advogados) | Escritório pequeno cabe numa tela: marca, telefone e e-mail por extenso no topo, foto real dos sócios e as 4 ou 5 perguntas do cliente em acordeões. | A foto do topo é lavada demais; a nossa foto real vai nítida. |
| 2 | jaredstilley.com (EUA, 5 pessoas) | "Ligar" e "WhatsApp" como dois botões grandes e rotulados acima da foto; a equipe fotografada num lugar reconhecível da cidade. | O brasão de leão é kitsch. |
| 3 | apexadvocaten.nl (Holanda, 4 advogados) | Título = o serviço + o tipo de cliente, em palavras simples, numa serif sem itálico; a equipe trabalhando à mesa, não retrato de estúdio. | Sem telefone na primeira tela: o nosso tem. |

Também vale o princípio (sem folha): **fionabruce.co.uk**, a porta do escritório
com a placa como foto do topo e a primeira frase dizendo tamanho, cidade e anos
de casa. No Brasil, nada bom: os sites de escritório pequeno são template
WordPress ou o mesmo aforismo em itálico que estamos tirando dos nossos. OAB:
continua valendo o Provimento 205/2021 (sem avaliações na página).

## Contabilidade — `contabilidade.jpg`

| # | Site | Princípio | Cuidado |
|---|---|---|---|
| 1 | nordkyst-revision.dk (Dinamarca, ~10 pessoas) | Título "seu parceiro local em <cidade> e região"; na primeira tela, endereço, telefone e a foto do dono com nome, cargo e número direto. | O selo em pílula acima do título. |
| 2 | jbb.com.au (Austrália, desde 1975) | Equipe real e lista curta de serviços na mesma tela, com uma só ação de contato. | O título "we see numbers, differently" é slogan: o nosso diz ofício e cidade. |
| 3 | dusanjwirk.com (Canadá, 2 sócios) | Os nomes dos sócios como marca, uma frase "quem e onde", botão de ligar sempre visível no cabeçalho. | A foto de paisagem não prova nada: prefira o escritório ou os sócios. |

No Brasil, nada bom em cerca de 100 sites. Proffit (Florianópolis) e Papyrus
(BH) servem só pelo padrão de contato: fixo e WhatsApp por extenso no topo,
"desde 1983" e foto do próprio escritório.

## Desentupidora e encanador — `desentupidora.jpg`

| # | Site | Princípio | Cuidado |
|---|---|---|---|
| 1 | rorleggerhuset.no (Oslo, ~25 pessoas) | A equipe uniformizada em fila diante das vans: "empresa real, vai chegar". O adesivo da van é a marca; "24 h" com o número no topo. | Tipografia fraca. |
| 2 | oneillplumbing.com (Seattle, desde 1917) | A van antiga ao lado da nova com o mesmo logo conta a história da família numa imagem; dois botões vermelhos enormes, "Ligar" e "Agendar". | O cabeçalho com dois números e links pequenos demais para o dedo. |
| 3 | desentupidoradinamica.com.br (Porto Alegre, 40 anos) — **a melhor do Brasil** | O caminhão hidrojato da casa, com a marca, é a prova; "Ligar agora" e "Chamar no WhatsApp" lado a lado, do mesmo tamanho; a promessa "Entupiu? Chamou, chegou!". | A pílula "Equipe disponível agora" e o véu escuro sobre a foto. |

Também vale o princípio: **wilsonplumbingbendigo.com** ("equipe pequena" e o
bairro na primeira frase, os três encanadores com nome diante da caminhonete) e
**bayplumbingco.com** (um telefone por região, com o nome dela). Da Brel (BR),
só a frase "você só recebe o preço depois que a gente vê o problema".

## Dedetizadora e controle de pragas — `dedetizadora.jpg`

| # | Site | Princípio | Cuidado |
|---|---|---|---|
| 1 | pestfreemi.com (Ann Arbor, familiar desde 2016) | Duas cores da marca em tudo, como pintura de caminhão; cidade e prova no título; a equipe de moletom da marca logo abaixo; praga só em silhueta, nunca foto. | Sem telefone tocável e 17 telas: não copiar a extensão. |
| 2 | peststopboys.co.uk (Brighton) | Dedetizadora não precisa de foto de inseto: um universo de cor próprio e 2,5 telas (o nome, o que resolve, como trabalha, um telefone por cidade). | Não diz a cidade na primeira tela; pede verificação de robô (use a folha). |
| 3 | premier-pest.squarespace.com (Utah) | A van e o técnico, com o detalhe do logo no uniforme, mais um botão de ligar, é uma primeira tela completa; o site inteiro em menos de 3 telas. | Os botões brancos sobre a foto. |

Também vale o princípio: **drepestcontrol.co.uk** (a ordem certa: quem, desde
quando, telefone, cidades atendidas) e **confirmakill.co.uk** (o botão É o
número por extenso; "mande uma foto da praga" é o gesto natural de WhatsApp).
No Brasil, só lições pontuais: a Insetisan põe o número dentro do logo.

## Reformas e pequena construtora — `reformas.jpg`

| # | Site | Princípio | Cuidado |
|---|---|---|---|
| 1 | buildteam.com (Londres) | Título literal "serviço em cidade"; a foto inteira de uma obra deles, com a rua real na legenda: vira prova, não decoração. | 16 telas: não copiar a extensão. |
| 2 | spacecraftjoinery.com.au (Adelaide, marcenaria) | Uma cozinha entregue, com a dona dentro, e uma barra na cor da marca, sempre na tela, só com o menu e o telefone. | Falta dizer o quê e onde na primeira tela: o nosso diz. |
| 3 | vandervlietaannemer.nl (Holanda, região de Zaltbommel, familiar) — **a mais próxima de um construtor que vive do WhatsApp** | Só obra entregue por eles, foto inteira; botão de telefone grande no cabeçalho e WhatsApp flutuante, a um toque de qualquer ponto; logo abaixo, "recém-entregue" com a obra mais nova. | O título é o nome da obra ("Riante villa…"): o nosso diz ofício e cidade, e a obra entra na legenda. |

Também vale o princípio: **bradstileremodel.com** (fotos de celular do próprio
trabalho, densas, em faixa: é o material que o dono brasileiro tem no
WhatsApp; não copie o formulário nem os selos de vantagem do topo),
**normandyremodeling.com** (barra fixa embaixo com um botão de ligar grande e
os 4 serviços como links simples na primeira tela) e **neilkelly.com** (o
título fala do medo do cliente, orçamento, prazo e risco, não das virtudes da
empresa). No Brasil, a Lar
Pontual usa CREA e ART como sinal de confiança, que é o certo aqui.

## Locação de equipamentos e caçamba — `locacao-e-cacamba.jpg`

| # | Site | Princípio | Cuidado |
|---|---|---|---|
| 1 | murrayvalleybinsandskips.com.au (Albury-Wodonga) | Cidade no título, em letra condensada pesada; "ver preços" e o telefone como botões de mesmo peso; a nota do Google; a reserva (tamanho e data) logo abaixo. | O checklist de vantagens com ✓ é esqueleto de template. |
| 2 | eynesburygroup.co.uk (St Neots, desde 1966) | Barra de telefone fixa no topo; "serviço em cidade" com a cidade em segunda cor; a máquina deles, com o logo pintado, é a foto e o selo. | |
| 3 | entulhos.pt (Lisboa e Setúbal) — **o modelo mais próximo de um disk-entulho** | A caçamba da casa, com o nome pintado, numa obra real; a região no título; WhatsApp e telefone sempre visíveis; menos de 5 telas. | Tipografia genérica e texto corrido apertado. |

Também vale o princípio: **coastalhire.com.au** (uma filial por linha, cada uma
com o seu telefone, e o pátio cheio como foto) e **junkitplus.com** (um card por
tamanho de caçamba: foto, capacidade, limite de peso, dias, botão). No Brasil,
a Versátil Andaimes (PR) tem as faixas zebradas de sinalização como sistema
gráfico, mas nem telefone na primeira tela.

## Faz-tudo e reparos — `faz-tudo.jpg`

| # | Site | Princípio | Cuidado |
|---|---|---|---|
| 1 | toddsunn.com (Seattle, desde 1989) | Para o autônomo: uma barra só com o número logo abaixo do logo, o rosto dele com a camiseta da marca e uma frase em primeira pessoa ("Hi, I'm Todd"). | |
| 2 | trailsidehandyman.com (Denver) | Os serviços como fotos de trabalhos reais dele, numa grade, e a pessoa com nome ("See Mike's Work"). | O sobretítulo "DENVER METRO · FAMILY-OWNED" e a fonte Inter são o novo esqueleto de template: copie só as fotos e a ideia. |
| 3 | hourlyhusbands.com (Washington) | A van é o logo em ação: a foto real na rua, e a cor do site tirada dela. | Telefone não tocável na primeira tela; banner de cookies. |

Também vale o princípio: **maridodealuguelcuritiba.com.br** (a estrutura certa
para o Brasil em menos de 3 telas: nome, anos de experiência, lista de
pequenos serviços em duas colunas, barra verde fixa "Fale comigo" que abre o
WhatsApp; a foto do topo é de banco de imagem: a nossa é real) e
**handymanamsterdam.nl** (começar pela tarefa do cliente, "pendurar, montar,
consertar", em linhas grandes de tocar).

## Mantendo a biblioteca

A folha é uma foto de 13/10/2026: o site pode mudar ou sair do ar, e a folha
continua valendo pelo princípio. Para trocar uma referência ou acrescentar um
nicho: capture com `qa-numerico --celular <url> <arquivo> --rm` (site que não
abre em iframe sai de uma janela de 500 px reduzida), monte a folha com as 3
primeiras telas lado a lado (390×844 cada), e mude por PR, com o ok do Rômulo.
