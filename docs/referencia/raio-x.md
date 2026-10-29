# Raio-X do PRUMO: o padrão da página, o molde e como republicar

O Raio-X é a página grátis que o PRUMO manda antes de qualquer conversa: como a empresa aparece para quem
procura no Google, feita só com dados públicos. Quem monta é o `deploy/dell/raio-x.py` (na Mel,
`~/.local/bin/raio-x`); quem desenha é o molde `deploy/dell/prumo-mapa/modelo_raio_x.py`, cópia do piloto da
Prumo. Este arquivo descreve a Versão 6 (29/10/2026). A fonte do comportamento é o código; se este texto e o
código discordarem, vale o código, e este texto se corrige no mesmo commit.

## O padrão

Cada regra abaixo diz onde mora, porque mudar a regra é mudar aquele arquivo.

1. **O fato mais forte abre a página.** Os pontos saem na ordem de `FORCA_DO_PONTO` (`raio-x.py`): site do
   perfil que não abre ou perfil sem site (0), site que abre sem o nome da empresa ou botão "Site" que leva a
   uma rede social (1), nota abaixo de 4,3 no Google (2), fora dos 3 primeiros numa das buscas (3), poucas
   avaliações (4), sem horário (5), site sem celular ou sem WhatsApp (6), primeiras fotos de terceiros (7).
   Ficam os 3 primeiros. Por quê: o site que não abre o dono confere num toque; a nota, numa olhada na lista;
   a posição na busca muda de pessoa para pessoa. Até a Versão 5 a busca vinha primeiro e o "Fora dos 20
   primeiros" abria a página e se repetia. O ponto 01 vira o título da abertura (`editorial_basico` do molde)
   e o `achados[0]` do recibo, que a primeira mensagem do Balcão cita: a mensagem e a página falam do mesmo
   fato. Na mesma leitura da abertura vem "O que já ajuda: …" (o primeiro item de "O que já está bom"), para
   a página não soar como acusação; a lista inteira do que está bom fica num detalhe fechado.
2. **O Índice Prumo de Presença é apoio, não manchete.** Nota de 0 a 18, régua com a faixa e as seis
   dimensões (`indice_prumo` dentro do molde; cálculo em `prumo-mapa/calculo_prumo.py`), aprovado pelo
   Rômulo em 17/10/2026 (prumo, `00-contexto/decisoes.md`). Aparece na página, abaixo do achado, com
   "Uma referência de presença, não uma previsão de vendas". Na **mensagem** de abordagem continua proibido
   falar em nota de 0 a 18: no teste de usabilidade, nota e defeito apontados na conversa foram lidos como
   insulto. Na página, o dono abre quando quer e vê de onde vem cada número.
3. **Três pontos, cada um com o que vimos e por que pesa** (`titulo` e `porque` de cada ponto, em
   `diagnostico`). O mesmo achado aparece no máximo 2 vezes no texto que se lê sem abrir detalhe: a abertura
   e o ponto. A ação não repete o achado e a calculadora não repete a posição na busca. Quem garante é o
   teste `Versao6.test_e_o_mesmo_achado_no_maximo_duas_vezes`, não uma trava de publicação.
4. **A Prioridade 01 resolve o ponto 01** (`dados_do_modelo`): a ação do ponto da manchete vem primeiro,
   com entregáveis (`itens`), o primeiro passo de vocês (`preparar`), quem faz (`quem`) e como saber que
   ficou pronto (`pronto`), todos em `acao_do_ponto`. As outras seguem "o que vocês fazem hoje vem antes"
   (`ordem`). Por quê: em 29/10/2026 o Raio-X do Arnoldo abria com o site fora do ar e mandava "responder às
   avaliações" primeiro; a página dizia uma coisa e mandava fazer outra.
5. **Três buscas de cliente** (`consultas_das_buscas`), escolhidas antes de ver o resultado. Para os ramos
   de `RAMOS` com áreas (hoje advocacia e odontologia), uma delas é a da especialidade quando o nome, o tipo
   do perfil ou o resumo que o Google escreve do lugar (`editorialSummary`, pedido no Place Details desde
   29/10/2026) a dizem; o nome e o tipo pesam mais que o resumo. Sem pista, ficam o termo do ramo, o outro
   jeito de pedir e "melhor <termo>". Nada é inferido por modelo. Ramo fora de `RAMOS`: o tipo do perfil,
   "melhor <tipo>" e o tipo no bairro; sem bairro, só duas. Sem cidade, nenhuma.
6. **Só o que foi conferido.** O que o Places não entrega (respostas às avaliações, redes, anúncios, tempo
   de resposta) sai como "não conferido" no método e nos itens do perfil. A recomendação sobre algo não
   conferido vai no condicional: "Responder às avaliações, se ainda não respondem" (`acao_do_ponto`, chave
   `nota`). O teste `Versao6.test_c_nao_afirma_que_nao_respondem` barra a afirmação.
7. **Nicho regulado.** Advocacia (ramo do Caçador ou categoria do Google, `eh_advocacia`) leva
   `CONFORMIDADE_OAB` na primeira tela: "Feito dentro das regras da OAB (Provimento 205/2021): conteúdo
   informativo, sem promessa de resultado e sem preço." `conferir_advocacia` recusa a página que tiver a
   linha faltando, valor em reais, "garant…", "promete/prometemos" ou "preç…" fora dela; a calculadora
   (valor que o próprio dono digita) não conta como preço. Nos outros ramos a linha não aparece.
8. **Sem catálogo; uma saída só.** Os quatro serviços saíram da página (editorial de 17/10/2026). Todo
   Raio-X termina no convite para o Mapa grátis (decisão de 15/10/2026, `MAPA_LINK` com a Empresa
   preenchida pelo `place_id`, `mapa_link_do_lead`) e, depois dele, no fecho pessoal: "Para conversar, é só
   responder na mesma conversa do WhatsApp." e "Rômulo Sutil Corrêa · PRUMO". O texto do fecho mora no
   molde (`FECHO`, vindo do `editorial_raio_x.py` da Prumo), não no `raio-x.py`.
9. **Homologação.** Toda publicação passa por `deploy/dell/lib/qualidade_prumo.py` (`proteger`), que roda a
   régua da Prumo (`06-qualidade/publicacao.py`) sobre os bytes finais. Sem avaliação aprovada em
   `~/.config/prumo-qualidade/entregas/<referencia>/raio-x.json`, ou com ela em fase `homologacao`, a página
   sobe com o aviso de homologação e a pasta do lead ganha o candidato `.prumo-candidato-raio-x.json`, sem
   aprovação. Profissional só com a avaliação aprovada, fora da pasta que o gerador escreve. O gerador nunca
   assina aceite. Detalhes em [`qualidade-prumo.md`](qualidade-prumo.md).

## Como mudar

**O desenho mora na Prumo.** `prumo/04-venda/piloto-cdl/gerar.py` (com `editorial_raio_x.py` e
`indice_prumo.py`) é a fonte do molde e da trava (`conferir_raio_x`, `conferir_pagina`, `conferir_esqueleto`).
Mudou lá, leve para cá:

```bash
cd prumo/04-venda/piloto-cdl
python modelo_para_squadone.py gerar.py <SquadOne>/deploy/dell/prumo-mapa/modelo_raio_x.py
SQUADONE=<SquadOne> python conferir_squadone.py --working-tree   # antes do commit: lê a pasta de trabalho
SQUADONE=<SquadOne> python conferir_squadone.py                  # depois do merge: lê o main por git show
```

Cada arquivo tem de sair "igual". O `conferir_squadone.py` também exige que `precos.json` e
`exemplo-raio-x.json` daqui sejam os do piloto. Não edite o `modelo_raio_x.py` à mão: o próximo
`modelo_para_squadone.py` apaga a edição.

**Os dados e as regras de conteúdo moram aqui**, no `raio-x.py`: a ordem dos pontos (regra 1), a Prioridade
01 (4), as buscas (5), o que é conferido e o condicional (6), a linha da OAB e a trava da advocacia (7) e o
link do Mapa (8). O que vai para o molde sai de `dados_do_modelo`, no esquema do `raio-x.json` do piloto.

**Testes:**

- `python3 deploy/dell/raio-x.py --testar` (72 testes, raiz temporária, nada toca `~/auto-site` nem a rede;
  a classe `Versao6` cobre as regras 1 a 8 com um advogado de Teresina inventado). No Windows, aponte a
  trava para o checkout da Prumo (`PRUMO_REPO=../prumo`; sem isso, 3 testes de publicação falham com
  "Fonte canônica da qualidade indisponível") e, mesmo assim, 4 dependem de Linux (`fcntl` nos 3 do
  avulso e `/proc` no do gerador rodando). O conjunto completo roda na Mel.
- `python3 deploy/dell/prumo-mapa/calculo_prumo.test.py` e `prumo_mapa.test.py`.
- Na Prumo, em `04-venda/piloto-cdl/`: `python gerar.py --verificar` (o exemplo byte a byte igual a
  `publicar/`) e `python editorial_raio_x.test.py` (o caminho automático, sem `editorial` escrito à mão).

## Na Mel

1. Merge direto na `main` e push, sem PR. O `~/SquadOne` da Mel se atualiza sozinho em até 10 min
   (`atualizar-central.timer`), mas o Raio-X roda das cópias, não do checkout.
2. Reinstalar as cópias de `deploy/dell/instalados.json`: `deploy/dell/raio-x.py` → `~/.local/bin/raio-x`;
   `deploy/dell/prumo-mapa/*.py`, `precos.json`, `exemplo-raio-x.json` e `archivo.woff2` →
   `~/.local/share/prumo-mapa/`; `deploy/dell/lib/qualidade_prumo.py` → `~/.local/lib/mel/`. Conferir com
   `dell-status --instalados` (lista o que ficou atrás, com o comando). Do PC, `ssh mel` só pelo OpenSSH do
   Windows (no Git Bash, `/c/Windows/System32/OpenSSH/ssh.exe mel '...'`).
3. **Não subir `VERSAO` sem querer republicar em massa.** O `raio-x.timer` (11:15 e 17:15) roda
   `raio-x --pendentes --max 6` e refaz todo lead `pronto` da raiz de `~/auto-site` com `raio_x_versao`
   menor (ou com a página fora do ar). A decisão de 17/10/2026 é não republicar os Raio-X já enviados, por
   isso `VERSAO` continua 5 e a Versão 6 se distingue no recibo por `raio_x_molde: "editorial-2026-10-29"`,
   que o `--pendentes` não lê. Lead em `_em-conversa/` nunca é refeito sozinho.
4. Refazer um lead à mão:
   - prévia, sem publicar: `raio-x --html SLUG --saida /tmp/SLUG.html` (se o cache do Places de 30 dias
     venceu, chama o Places e grava `raio-x-places.json` na pasta do lead);
   - diagnóstico: `raio-x --simular SLUG`;
   - publicar: `raio-x SLUG` (ou `raio-x _em-conversa/SLUG`). O avulso (demo sob pedido) vai para
     `raio-x-prumo.vercel.app/<nome>`; o de quem tem demo, para `<demo>/raio-x`. Os dois passam pela trava
     `qualidade_prumo`.
5. O `~/prumo` da Mel não é fonte do **molde**: o Raio-X automático usa as cópias instaladas daqui. Mas a
   trava de qualidade lê a régua de lá (`PRUMO_REPO`, padrão `~/prumo`, pasta `06-qualidade/`): sem ela, nada
   publica. Em 29/10/2026 ele estava 54 commits atrás, com 22 arquivos locais de 21/10 sem commit; não
   sincronize sem olhar o que está lá.

## De onde veio

Em 29/10/2026 o Raio-X automático do Arnoldo Bastos Advocacia (Teresina) foi comparado com uma análise feita
à mão para o Bruno Gouveia (Aracaju). A feita à mão convencia melhor: era específica, ensinava ao dono
algo que ele não sabia, citava a OAB e tinha uma saída só. O automático era melhor em atribuição (o
formulário do Mapa com o `place_id`, os links de WhatsApp com o interesse), em transparência (o que foi e o
que não foi conferido) e em escala. A Versão 6 junta os dois: o editorial aprovado em 17/10/2026 chega ao
automático, e o automático passa a abrir pelo fato mais forte, buscar pela especialidade quando ela é
verificável, falar no condicional do que não conferiu, citar a OAB na advocacia, não repetir o achado e
fechar com o convite do Mapa e a assinatura. Código nos commits 14e61e7 e 38e8e21 (SquadOne) e ceef362
(Prumo).
