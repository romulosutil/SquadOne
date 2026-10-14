# Revisões de demo feitas fora do Dell

Uma revisão de texto ou de design pedida pelo Rômulo numa sessão sem acesso ao Dell
(14/10/2026, a primeira: Jéssica Barbosa) chega aqui, em `revisoes/<slug>/index.html`.
O repositório é só o caminho até o Dell: a pasta de verdade continua sendo
`~/auto-site/<slug>/`, e é de lá que o deploy sai (passo 5 do `auto-site-CLAUDE.md`).

Por que não publicar direto na Vercel: o `raio-x` só republica `/raio-x` quando o
`index.html` da pasta é byte a byte o que está no ar. Um demo trocado sem passar pela
pasta trava o raio-x do lead. Por isso também não entra no `instalados.json`: um
refazer do gerador muda a pasta, e a cópia daqui deixaria de valer.

Numa sessão no Dell, trocando `<slug>`:

```bash
slug="<slug>"
cp ~/auto-site/"$slug"/index.html ~/auto-site/"$slug"/index.antes-revisao.html
cp ~/SquadOne/deploy/dell/auto-site/revisoes/"$slug"/index.html ~/auto-site/"$slug"/index.html
python3 ~/.local/bin/qa-numerico ~/auto-site/"$slug"/index.html --capturas /tmp/qa-"$slug"
# deploy do passo 5 do auto-site-CLAUDE.md (staging com index.html e og.jpg); ele tira o /raio-x do ar
raio-x "$slug"    # devolve o /raio-x, já na versão de três atos (compara o index.html da pasta com o que acabou de subir)
```

Depois, uma linha no `~/auto-site/registro.md` com a data e o que a revisão mudou.

| Lead | Data | O que mudou |
|---|---|---|
| `jessica-barbosa-advocacia-advogada-trabalhista-e-previdenciarista` | 14/10/2026 | Título diz o que ela faz e onde; menu só com o nome das seções (some abaixo de 1080 px); vocabulário da metáfora ("anotação", "qualificação", "quem assina a leitura") trocado por palavras do visitante; fontes saem de cada fato para uma nota só; letra mínima de 13 px no cartão; placeholder com contraste AA; Ato III de 420vh para 320vh |
| `ac-advocacia-previdenciaria-ap` (confira o slug inteiro no `registro.md`: na Vercel o nome do projeto é `demo-ac-advocacia-previdenciaria-ap`) | 14/10/2026 | Redesign pelo Dribbble ("Justserv", shot 27328710): hero em bento numa moldura escura (menu e contatos na coluna, título grande no painel creme com a foto da placa, afirmação e atalhos de área à direita) e a placa AC da sala 1411 redesenhada na divisa. Sai o "percurso" em cinco Atos, o menu I–V, o campo "desde que ano você trabalha?" e a foto da meia-maratona; título vira "Advogada previdenciária em Ribeirão Preto"; as oito áreas viram fichas com a mensagem pronta (abertas no computador, sanfona no celular). Hanken Grotesk, creme da parede + dourado da placa + café. 156 KB, `qa-numerico` passou (6,1 telas) |
