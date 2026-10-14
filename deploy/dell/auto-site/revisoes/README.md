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
raio-x "$slug"    # devolve o /raio-x (compara o index.html da pasta com o que acabou de subir)
```

Depois, uma linha no `~/auto-site/registro.md` com a data e o que a revisão mudou.

| Lead | Data | O que mudou |
|---|---|---|
| `jessica-barbosa-advocacia-advogada-trabalhista-e-previdenciarista` | 14/10/2026 | Título diz o que ela faz e onde; menu só com o nome das seções (some abaixo de 1080 px); vocabulário da metáfora ("anotação", "qualificação", "quem assina a leitura") trocado por palavras do visitante; fontes saem de cada fato para uma nota só; letra mínima de 13 px no cartão; placeholder com contraste AA; Ato III de 420vh para 320vh |
