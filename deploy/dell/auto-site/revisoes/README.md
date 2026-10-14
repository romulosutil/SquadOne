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
