# Revisões de demo feitas fora do Dell

Uma revisão de texto ou de design pedida pelo Rômulo numa sessão sem acesso ao Dell
(14/10/2026, a primeira: Jéssica Barbosa) chega aqui, em `revisoes/<slug>/index.html`.
O repositório é só o caminho até o Dell: a pasta de verdade continua sendo
`~/auto-site/<slug>/`, e é de lá que o deploy sai (passo 5 do `auto-site-CLAUDE.md`).

**Regra (Rômulo, 14/10/2026): nada fica local.** Revisão ou redesign feito numa sessão termina
publicado na Vercel, na hora, e com a cópia aqui no `main`. Não se entrega `index.html` em rascunho,
anexo ou "à espera do Dell": o que o Rômulo aprovou tem de estar no link do lead quando a sessão acaba.

Como publicar de qualquer máquina com o Vercel CLI logado (`npx vercel@53 whoami` responde
`sutilromulo-5015`), trocando `<slug>`:

1. O nome do projeto é `demo-<slug>` com o slug inteiro. O alias (`demo-…-ap.vercel.app`) vem cortado:
   ache o projeto pela busca da Vercel (MCP `list_projects` com `search`) em vez de adivinhar.
2. Palco só com o que o deploy atual tem: o `index.html` novo, o `og.jpg` e o `raio-x/index.html` de
   produção (baixe pelo alias e confira o SHA-1 com `list_deployment_files`). Deploy sem o `raio-x/`
   tira o Raio-X do ar.
3. `index.html` gravado em **LF**. O Git normaliza para LF; se o que subiu tiver CRLF (Windows), a cópia
   daqui não bate byte a byte com a do ar e o `raio-x` do Dell trava.
4. `vercel link --yes --project demo-<slug> --scope romulodesigns` e
   `vercel deploy --prod --yes --scope romulodesigns`; confira que a página do alias tem o mesmo SHA-1 do
   arquivo e que `/og.jpg` e `/raio-x/` dão 200.
5. Commit em `revisoes/<slug>/` (o `index.html` publicado e o `CONCEITO.md`), linha na tabela abaixo,
   merge direto no `main`.

**No Dell, depois** (pode ser na próxima sessão de lá): copie o `index.html` daqui para a pasta do lead,
para o `raio-x` voltar a ver a pasta igual ao que está no ar. Não precisa novo deploy:

```bash
slug="<slug>"
cp ~/auto-site/"$slug"/index.html ~/auto-site/"$slug"/index.antes-revisao.html
cp ~/SquadOne/deploy/dell/auto-site/revisoes/"$slug"/index.html ~/auto-site/"$slug"/index.html
cmp ~/auto-site/"$slug"/index.html <(curl -s https://demo-"$slug".vercel.app/) && echo igual   # o alias pode ser o cortado
```

Depois, uma linha no `~/auto-site/registro.md` com a data e o que a revisão mudou. Não entra no
`instalados.json`: um refazer do gerador muda a pasta, e a cópia daqui deixaria de valer.

Antes desta regra (Jéssica Barbosa, primeira revisão de 14/10) o caminho era o inverso: a revisão
esperava aqui uma sessão no Dell para publicar. O redesign aprovado da Jéssica acabou publicado direto, e
o arquivo desta pasta ficou diferente do que está no ar.

| Lead | Data | O que mudou |
|---|---|---|
| `jessica-barbosa-advocacia-advogada-trabalhista-e-previdenciarista` | 14/10/2026 | Título diz o que ela faz e onde; menu só com o nome das seções (some abaixo de 1080 px); vocabulário da metáfora ("anotação", "qualificação", "quem assina a leitura") trocado por palavras do visitante; fontes saem de cada fato para uma nota só; letra mínima de 13 px no cartão; placeholder com contraste AA; Ato III de 420vh para 320vh |
| `ac-advocacia-previdenciaria-aposentadorias-beneficios-previdenciarios-inss` | 14/10/2026 | Publicado direto (dpl_6LHGGU… e reenvio em LF). Redesign pelo Dribbble ("Justserv", shot 27328710): hero em bento numa moldura escura (menu e contatos na coluna, título grande no painel creme com a foto da placa, afirmação e atalhos de área à direita) e a placa AC da sala 1411 redesenhada na divisa. Saem os cinco Atos, o menu I–V, o campo "desde que ano você trabalha?" e a foto da meia-maratona; título "Advogada previdenciária em Ribeirão Preto"; as oito áreas viram fichas com a mensagem pronta. Hanken Grotesk; creme da parede, dourado da placa, café. 156 KB, `qa-numerico` passou (6,1 telas) |
| `kulniski-advocacia-consultoria-juridica` | 14/10/2026 | Publicado direto. Redesign pelo Dribbble ("Estate Planning Website Design", shot 27783662): hero com o painel do texto e o painel do retrato, a faixa da vitrine (as oito áreas pintadas no vidro preto da porta, em letra romana, cada uma abrindo a sua área), as dez áreas como lista de perguntas com o que a lei diz, o que levar e o WhatsApp pronto, "Quem atende" com as perguntas que ela respondeu nos posts, fecho no vidro. Saem os cinco Atos, o menu I–V, o título "As palavras da vitrine" e o campo "escreva do seu jeito"; título "Advogada trabalhista e previdenciária em Ribeirão Preto"; divórcio e inventário em cartório corrigidos pela Res. 571/2024 do CNJ. Newsreader + Instrument Sans; papel, vidro e o mogno da estante. 201 KB, `qa-numerico` passou (6,0 telas) |
| `gaius-engenharia` | 14/10/2026 | Publicado direto (dpl_5iAsYMcLj8Jdcq9jBZLKe6NmwMy7), **com o Raio-X novo em `/raio-x/`**: o do modelo aprovado, feito à mão no `gerar.py` do piloto (`prumo/04-venda/piloto-cdl/leads/gaius-engenharia/`, presença 6,0, "Pouco visível"), no lugar do automático de 10/10. No Dell, não deixe o runner republicar o Raio-X por cima. Redesign pelo Dribbble ("Wiyasa - Construction Company Website Design", shot 19263939): folha clara sobre a faixa verde, título grande com o parágrafo à direita, cartões Vistoria (laranja) e Obra (branco) por cima da faixa de fotos, obras num painel verde, "Quem atende" com o Caio e os fatos com fonte, fecho escuro. Saem a parede em camadas, o menu Guia · Montantes · Travamento, o seletor que montava a mensagem e o campo "Em poucas palavras"; título "Steel frame e vistoria de imóvel em Curitiba". Onest; verde e laranja do logo, o G hexagonal redesenhado. 303 KB, 5,8 telas; `qa-numerico` não rodou (fora do Dell) |
| `benetti-advocacia-previdenciaria` | 15/10/2026 | Publicado direto (index.html ad1e7fc6…, og.jpg novo, `raio-x/` de produção). Redesign pelo Dribbble ("Osborne Legal - Law Firm Landing Page", shot 27789863): hero num painel grafite com a foto da Dra. Jéssica à direita sumindo no escuro, título grande embaixo à esquerda, menu em pílula e a ficha (endereço e horário do Google) flutuando sobre a foto; as oito situações numa grade de células com o WhatsApp pronto; "Como funciona" com as etapas e o que separar; "Quem atende" com retrato e fatos com fonte; fecho com a luz âmbar da estante. Saem os cinco Atos, o menu I–V, o título "Cada papel do seu benefício, no seu separador.", o campo "Ou escreva do seu jeito" e as caixinhas que montavam a mensagem; título "Advogada previdenciária no Centro de Londrina". Albert Sans; grafite do mármore da sala 301 e âmbar dos LEDs da estante, veios do mármore no hero. 192 KB, `qa-numerico` passou (6,0 telas) |
| `radix-assessoria-contabil` | 19/10/2026 | **Site novo**, não redesign: a Radix (Recife) não tem site nem ficha no Google Maps, e não passou pelo Dell (sem `content.md`, tudo do Instagram @radixcontabilidade). Publicado direto em `demo-radix-assessoria-contabil` (index.html 8e2a58c2…, og.jpg), **sem `raio-x/`**, que ainda não foi feito. Dribbble "Northline Advisory - Accounting Website" (shot 27713893): hero em duas colunas com título em serifa e a parede verde com o logo à direita, faixa dos cinco serviços com WhatsApp pronto, faixa verde-fechada com o escritório e os três sócios, reforma tributária para quem está no Simples, as cinco perguntas da série "Mande sua dúvida pra gente". Bodoni Moda + Figtree; papel, quase preto e verde-limão do logo. 232 KB, 5,97 telas; `qa-numerico` não rodou (fora do Dell) |
| `controecoddtizacao` | 22/10/2026 | **Site novo**, feito fora do Dell (sem SSH): dados da ficha do Google lidos em 22/10 (endereço, celular, horário, 4,9 em 93 avaliações, 5 fotos do perfil) e do Raio-X avulso de 17/10 (`raio-x-prumo.vercel.app/controecoddtizacao`). Publicado direto em `demo-controecoddtizacao` (index.html 0ebead5c…, og.jpg, robots, sitemap, llms.txt), **sem `raio-x/`**, e passado pela trava `qualidade_prumo.proteger` (homologação: leva o aviso de prévia). Dribbble "HVAC Cleaning & Pest Control Website" (shot 25645270): hero num painel carvão arredondado com o título em serifa à esquerda e a foto do aplicador de EPI à direita, seis serviços em 3×2 com WhatsApp pronto, "Como funciona" com o retorno depois do serviço em destaque, grade de fotos (escola infantil, caixas d'água, cozinha, depósito), cinco perguntas, fecho escuro. Título "Dedetizadora na Farolândia, em Aracaju". Source Serif 4 + Figtree; carvão, papel e o amarelo da bomba costal. 305 KB, 5,9 telas; `qa-numerico` passou (código 0, rodado no Windows). No Dell: criar/copiar a pasta do lead a partir daqui |
