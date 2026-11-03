# Homologação do Site da Locforte (03/11/2026)

Referência pseudonimizada: `lead:3ea0c7a7796057f3ee932ebe` (a mesma do Raio-X). Avaliação no prumo:
`06-qualidade/avaliacoes.json`, id `site-lead-3ea0c7a7796057f3ee932ebe`.

**Versão no ar (prévia, com o aviso):** https://demo-locforte-escoras-e-equipamento.vercel.app, `index.html`
SHA-1 `6c762c82…`, publicado pela trava `qualidade_prumo.proteger` (estado `homologacao`) com seis arquivos:
`index.html`, `404.html`, `og.jpg`, `robots.txt`, `sitemap.xml`, `llms.txt`.
**Versão de entrega avaliada (os mesmos bytes sem o aviso):** `sha256:7d4aa4be33c934cee89774ada2341817583a699346787e677d224405a9d784c7`,
o manifesto `entrega:` que a trava compara na publicação Profissional.

Revisor: Claude (assistente), a pedido do Rômulo. Este registro **não é aceite**: o C05 fica com o Rômulo, depois de
conferir os critérios abaixo, para a versão exata que for ao ar sem o aviso.

## O que foi testado

| Arquivo | O que tem |
|---|---|
| `no-ar.json` (gerado por `testar_no_ar.py`) | 30 casos no ar, 30 passaram: rotas, HTTP→HTTPS (308), certificado, title, description, og, canonical, JSON-LD, noindex, h1, nota, aviso, nenhum recurso de terceiros carregado, nenhum formulário, um WhatsApp só com toda mensagem pronta preenchida, wa.me → api.whatsapp.com com o número, `tel:` único, Maps, Instagram e "Ver no Google" respondendo, âncoras internas, e a 404 própria com início, WhatsApp e Ligar |
| `teclado-e-larguras.json` | Teclado com teclas reais: ordem de foco, foco visível, aba e pergunta pelo Enter; altura do aviso em 5 larguras; 320 px sem rolagem lateral |
| `celular-390-aviso.jpg`, `computador-1440-aviso.jpg` | A primeira tela no ar, com o aviso legível acima do menu |
| `qa-numerico` (passou, 03/11) | 376,3 KB; Ato I 132,8 KB; CSS 24,0 KB; 4 788 px = 5,7 telas a 390 px; contraste AA em 11 pares; toque e texto miúdo; sem JS e com reduced-motion o Ato I aparece |
| `seo-do-site --conferir` (código 0) | JSON-LD conferido com as fontes |

## Falhas achadas e o que aconteceu

1. **Aviso de prévia encoberto** pelo menu (absoluto no topo): ilegível no celular, cortado no desktop. Corrigido
   no CSS do site; medido em 320, 360, 390, 641 e 1440 px.
2. **Aviso injetado dentro do `<style>`**: falha criada nesta revisão (um comentário CSS citava a tag do corpo, e a
   trava injeta depois da primeira ocorrência). Comentário reescrito; uma ocorrência só da tag.
3. **Rolagem lateral a 320 px** (332 px de largura). Corrigido: o botão do menu perde o ícone abaixo de 360 px.
4. **Erro sem saída:** rota inexistente devolvia o 404 em texto puro da Vercel. Corrigido com `404.html` própria,
   que passou pela trava como sexto arquivo do manifesto. **Fica para a esteira:** `arquivos_site` no SquadOne só
   publica cinco arquivos; um refazer pelo Dell perde a 404 até a esteira incluir `404.html`.
5. **O limite do ajuste mensal diverge entre as fontes da oferta (aberta, decisão do Rômulo):**
   - `prumo/04-venda/piloto-cdl/precos.json` (a fonte do preço): "Domínio, hospedagem e **um ajuste por mês** incluídos";
   - `prumo/00-contexto/negocio.md` (a fonte da oferta, no HEAD e na cópia local): "Domínio, hospedagem e **ajustes** incluídos";
   - na `main` do SquadOne (`6cb6eb3`), o cardápio da jornada ("a mensalidade cobre domínio, hospedagem e ajustes") e
     quatro textos do Encontrado na colinha ("ajustes incluídos").
   Mudanças sem commit de outra sessão (o `negocio.md` local, que já fala em "um ajuste por mês" na revisão de 30/10,
   e o checkout do SquadOne no branch `ccr-fd8c9d70-fh8kjx`) vão para "um ajuste por mês", mas não estão publicadas.
   Enquanto as fontes não baterem, o cliente pode ler "ajustes" sem limite numa mensagem e um por mês na proposta.
   **Resolvida em 03/11/2026:** o Rômulo decidiu "um ajuste por mês" (`prumo/00-contexto/decisoes.md`). Na `main` do
   SquadOne, `b6fe5dc` (com `d2ecdaa`): colinha (5 textos), 2ª mensagem (`server/site-mensagem.ts`,
   `deploy/dell/claude-ops/site-mensagem.js` e o teste) e o cardápio da jornada, refeito por `scripts/jornada-guia.ts`;
   `npm test` sem falha nova. No prumo: a tabela do `negocio.md` e a `proposta-modelo.html`. Conferido depois:
   `git grep "hospedagem e ajustes"` na `main` do SquadOne só acha a reconstituição histórica da mensagem à Roda Mais e este registro, que cita a frase antiga.
   Ficam com a reescrita local do site institucional, ainda sem commit: `02-site/index.html` (o que está no ar em
   prumo.services já diz "um ajuste por mês") e a apresentação (o texto local tirou a frase; o PDF se refaz com ela).
6. **Corrigidas antes, na construção:** domínio cortado pela Vercel (og, canonical, sitemap no endereço certo);
   foto do fecho acima do orçamento (76,8 KB em base64 → 54 KB).

## Item por item

| Item | Estado | Por quê |
|---|---|---|
| C01 Oferta definida | atende | Problema, público, entregáveis, limites, preço, condição de pagamento e responsável definidos (`negocio.md`, `precos.json`, cardápio da jornada, catálogo: "Rômulo / Prumo"); o limite da mensalidade, "um ajuste por mês", agora é o mesmo em todas as fontes (falha 5, resolvida) |
| C02 Execução reproduzível | não verificado | O procedimento existe (`auto-site-CLAUDE.md`) e este exemplar saiu dele, com o `CONCEITO.md` dizendo entradas e gates. Mas as entradas (11 fotos do perfil, 6 imagens do Flow) ficaram fora do repositório, e as edições foram feitas por scripts avulsos; só `fonte/montar_sprite.py` e `fonte/chroma.py` foram guardados. Refazer exige o pacote de entradas |
| C03 Sucesso, erro e recuperação | atende | Sucesso: 30/30 no ar e os gates. Erro: rota inexistente → 404 própria; sem JS e com reduced-motion o conteúdo aparece. Recuperação: da 404 volta ao início ou ao WhatsApp; os deploys anteriores seguem prontos na Vercel para voltar. Falhas 1 a 4 e 6 resolvidas e medidas de novo |
| C04 Dados e acessos | não verificado | Dados: só públicos do perfil e do CNPJ; nenhum formulário, cookie ou recurso de terceiros. Acesso indevido: `content.md`, `.vercel/` e rota qualquer dão 404. Falta: procedimento de retirada de acesso (perfil do Google e domínio, quando o cliente der acesso) e quem do time da Vercel acessa o projeto |
| C05 Aceite | não verificado | Aceite só do responsável, depois dos critérios, para a versão sem aviso. O "registrar aceite" de 03/11 veio antes desta conferência |
| C06 Entrega, suporte e saída | não verificado | Não há runbook de entrega, canal e prazo do ajuste mensal, exportação nem ensaio de reentrega para este cliente |
| ST01 Domínio, rotas, contato, SEO, conteúdo | não verificado | Rotas, HTTPS, CTAs e dados conferidos (`no-ar.json`). Falta o que só a entrega tem: o endereço da empresa (o Encontrado promete o domínio dela) e tirar o `noindex`, que hoje é proposital no demo |
| ST02 Celular, desktop, teclado, erro e contato | atende | 390 e 320 px (qa e medida), 1440 px, teclado com foco visível, Enter nas abas e perguntas, 404 com saída, WhatsApp e Ligar com o número único |
| AC01 Canais, responsável, horário e prazo | não verificado | Falta a ficha de atendimento do Prumo para este cliente (canal, horário, prazo de resposta do ajuste) acessível a ele |
| AC02 Prazo medido | não verificado | Sem conversa real nem ensaio identificado; clique não é envio |
| AC03 Resultado, próximo passo, condições | atende | O roteiro explica resultado, próximo passo ("Posso começar?", o endereço e o acesso ao perfil) e condições, com textos para interesse, dúvida ("quanto custa?", "tá caro") e encerramento; desde `b6fe5dc`, com "um ajuste por mês", como a oferta (falha 5, resolvida) |
| AC04 Continuidade e recusa | não verificado | Teste do SquadOne não feito nesta revisão |
| AC05 Pedir ajuda e encerramento | não verificado | Sem cliente e sem canal de suporte definido |
| ED01 Inventário | atende | Tabela abaixo, com dono e finalidade; disponibilidade testada só onde existe |
| ED02 Links e transições | não verificado | Site → WhatsApp, Ligar, Maps, Instagram e Google funcionam (`no-ar.json`). Proposta, entrega e suporte ainda não existem para testar a jornada inteira |
| ED03 Consistência | atende | Nome, marca e contato batem entre site, perfil do Google, Instagram e Raio-X; a condição do ajuste mensal é a mesma na oferta, no preço, na proposta-modelo, na colinha e na 2ª mensagem (falha 5, resolvida) |
| ED04 Celular e teclado com leitura, rótulos e erro | atende | 38 focáveis, nenhum sem nome; `lang="pt-BR"`; link de pular; contraste AA; 404 com saída; bloqueios do aviso e de 320 px corrigidos |
| ED05 Falha percebida e recuperada | não verificado | Não há monitor nem alerta para o demo, nem ensaio de queda |

## Pontos de contato desta oferta (ED01)

| Ponto | Dono | Finalidade | Estado em 03/11 |
|---|---|---|---|
| Site (demo) | Prumo · Rômulo | Mostrar o site e levar ao orçamento | No ar, testado |
| Raio-X (`raio-x-prumo.vercel.app/<slug>`) | Prumo · Rômulo | Diagnóstico grátis, a porta da venda | No ar (avulso), não retestado aqui |
| WhatsApp e telefone da Locforte | Locforte · Claudinei | Receber o pedido de orçamento do site | Links testados; envio não |
| Perfil do Google e Instagram da Locforte | Locforte | Nota, avaliações, fotos, endereço | Links testados |
| WhatsApp do Prumo (2ª mensagem e conversa) | Prumo · Rômulo | Mandar o demo com o preço; conversar | Roteiro na colinha, com "um ajuste por mês" |
| Proposta (`proposta-modelo` do prumo) | Prumo · Rômulo | Escopo, preço e início por escrito | Ainda não emitida |
| Entrega (domínio da empresa, perfil revisado) | Prumo · Rômulo | O Encontrado no ar com o endereço dela | Não existe |
| Suporte (ajuste mensal) | Prumo · Rômulo | Um ajuste por mês, pedido pelo WhatsApp | Não definido para este cliente |

## Para chegar a 100%

- Na esteira (SquadOne): incluir `404.html` em `arquivos_site`.
- Com a venda: domínio da empresa, tirar o `noindex`, ficha de atendimento, prazo medido, suporte, saída e
  ensaio de recuperação; retirada de acesso; monitor do site.
- Por último, o aceite do Rômulo (C05) para a versão exata sem o aviso.
