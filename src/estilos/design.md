# Design do SquadOne

Avisos de novas respostas (21/10/2026): durante Minhas decisões, novas mensagens humanas
aparecem em uma faixa visível com o nome do cliente e a prioridade na fila global atual.
A faixa não troca o cliente aberto, não move o foco nem limpa rascunhos. Cada cliente tem
um aviso; várias chegadas são ordenadas pela prioridade e sua posição acompanha a fila.
A lista de avisos tem altura limitada e rolagem para preservar o espaço do atendimento.
Dispensar não altera a conversa ou o CRM. A primeira leitura e a repetição do mesmo envio
não avisam novamente; uma mensagem posterior pode gerar outro aviso. Mensagens automáticas
e respostas já atendidas ficam fora. Falha na leitura não anuncia prioridade como atual.


Retorno à fila (21/10/2026): uma resposta humana posterior ao envio reabre a decisão
na prioridade de resposta, pela hora da mensagem mais recente. Resoluções e pulos anteriores
não escondem nem rebaixam o novo retorno; o histórico permanece intacto e há uma linha por
cliente. Vendas e Minhas decisões usam a mesma prioridade. O cliente que já está aberto
permanece na tela, e o próximo avanço usa a fila atualizada. Uma nova mensagem humana supera
a classificação antiga de robô e permite revisar espera ou tarefa interna anterior.

## Painéis de atendimento · 25/10/2026

A entrevista com Rômulo confirmou que o escritório e seus dois quadros orientam
bem; a dificuldade começa nos painéis seguintes. A conversa continua no WhatsApp.
Ao abrir um cliente, a interface deve explicar o próximo passo, como conduzi-lo,
quando agir ou revisar e o que acompanhar depois. Relato e critérios completos em
`docs/ux/2026-10-25-paineis-e-jornadas.md`.

O padrão novo é `PainelOperacional` (BP-PAINEL): blocos irmãos, com cabeçalho,
conteúdo e área de ações. Use `--contorno-painel` no bloco de trabalho; borda forte
continua identificando controles. Dentro do painel, use divisores e espaço. O
título do cliente usa `--tam-titulo-pagina`; o título do bloco,
`--tam-titulo-bloco`; instrução principal, `--tam-secao`; texto, `--tam-texto`;
datas e contexto, `--tam-apoio`. Os botões dentro desses painéis não têm sombra.
Uma única ação principal usa amarelo; a navegação de etapas usa realce claro e
indicador amarelo, para se distinguir do botão que executa uma ação.

`OrientacaoDaConversa` (BP-ORIENTACAO) reúne próximo passo, momento, responsável,
procedimento e resultado esperado. A navegação é Orientação → Mensagem →
Acompanhamento, com acesso direto às três etapas. Hora não registrada permanece
desconhecida. Espera, tarefa interna e contexto insuficiente não apresentam um
rascunho de contato como próxima ação. A mensagem é revisável; o envio permanece
no WhatsApp e só é confirmado pela evidência correspondente. Atualização de
contexto bloqueia o link anterior; texto vazio ou com marcadores pendentes não
abre uma mensagem. O servidor continua validando o preparo.

Essa composição substitui, para os painéis de atendimento, a aplicação uniforme
de bordas de 2 px, sombras em botões e títulos quase iguais. A navegação imersiva
de 18/10 continua vigente no perfil operations; a seção histórica “Navegação”
abaixo descreve a casca anterior e o perfil app.

Acompanhamento automático (21/10/2026): a jornada mostra as mensagens capturadas
pela integração, sem pedir confirmação de envio ou cópia da resposta. A abertura
do WhatsApp leva ao acompanhamento e fica aguardando sincronização até haver
uma nova saída observada. Próxima ação é opcional; complemento, contato e retorno
por fora ficam em uma dobra secundária. Eventos do servidor atualizam o CRM e a
ficha aberta sem limpar rascunhos ou recolher a conversa expandida. A hora da
consulta aparece separada da hora da mensagem. “Ao vivo” exige conexão ativa e
leitura válida; consultas a cada 15 s e retorno ao app cobrem desconexões.

Minhas decisões (21/10/2026): a fila tem uma linha por cliente, prioridade explícita, busca,
filtro de oferta e páginas de oito itens. Separa Precisa de você, Em acompanhamento e Encerradas.
Cada cliente abre uma jornada Entender → Agir → Acompanhar: evidência e motivo, ação contextual,
acompanhamento do acontecimento, próximo passo com data e acesso ao desfecho na ficha. Os passos são
navegação, sem porcentagem de venda presumida. Abrir o WhatsApp prepara a mensagem; o envio só
é anotado por confirmação explícita ou observação. Atualizações mantêm o cliente selecionado,
revisões e rascunhos; bloqueiam novas confirmações quando a fonte fica indisponível. A folha
mantém uma só rolagem e o acesso à fila continua disponível mesmo sem pendências.

Clareza das decisões (21/10/2026): Entender destaca uma situação, seguida dos trechos recentes
do WhatsApp com autor e horário; orientações e marcos ficam em uma dobra. Agir mostra a conversa,
a interpretação revisável e a resposta contextual; texto padrão é identificado. Acompanhar mostra
as mensagens capturadas e permite complementar contexto ou definir ação e data. Após saída observada,
Clareza das decisões (21/10/2026): Entender destaca uma situação, seguida dos trechos recentes
do WhatsApp com autor e horário; orientações e marcos ficam em uma dobra. Agir mostra a conversa,
a interpretação revisável e a resposta contextual; texto padrão é identificado. Acompanhar oferece
registrar envio, registrar resposta ou definir ação e data. Após confirmação ou saída observada,
a resposta anterior deixa de ser pendência; material solicitado e passos vencidos continuam ativos.
Uma nova entrada reabre a decisão. O próximo cliente vem da primeira prioridade global disponível,
independente da posição e dos filtros. Após registrar a interação, a fila é relida e o próximo
cliente abre automaticamente, quando a gravação termina. Se não houver outro cliente, a tela
permanece no acompanhamento atual; falha na gravação ou releitura não avança a navegação. Uma
nova resposta enviada e capturada no WhatsApp também abre o próximo cliente, sem registro
manual e mesmo se outro passo do cliente continuar ativo. Releitura do mesmo envio e entrada
posterior do cliente não acionam esse avanço.

Escritório imersivo (18/10/2026, correção explícita do Rômulo): a home é um único ambiente aberto em pixel art, com os agentes animados e clicáveis. Dois telões compartilhados mostram as decisões e o andamento do time e as conversas que dependem do usuário; abrem detalhes sobre o cenário. Navegação fixa no rodapé em todas as larguras: Escritório, Assistente, Vendas e Mais. Sem trilho lateral nem campo de busca visível. Vendas abre em drawer; o Assistente conserva seu comportamento e escopo geral. Mais dá acesso a Agenda, Finanças, Entrada e Configurações. A sala permanece montada atrás dos painéis, sem rolagem de página ou zoom manual; painéis têm uma única região de rolagem. Esta decisão substitui a home de cartões com escritório recolhido, sem alterar o serviço comercial autorizado ou suas proteções.

Mínimo, para as telas novas (finanças primeiro) não inventarem cor nem
tamanho. Tokens em `tokens.css`.

## Princípios

1. **Celular primeiro.** A tela nasce a 390 px, com 16 px de margem e sem
   rolagem lateral; o desktop só ganha colunas. Toque mínimo de 44 px.
2. **Texto antes da cor.** Todo estado tem palavra (RULES 3): "Atualizada",
   "Precisa de você", "Falhou". A cor só reforça. Semáforo sempre com rótulo.
3. **Número é o protagonista.** Valores em `tabular-nums`, alinhados à
   direita em lista, nunca cortados. Negativo leva sinal **e** cor.
4. **Uma fonte por número.** Toda tela de finanças diz "dados até dd/mm" e a
   saúde de cada conexão: número sem data é número que mente (RULES 2).
5. **Privacidade.** R$ e estabelecimento só aparecem nesta tela. Nada de
   valor em `title`, `aria-live` global, notificação ou URL (RULES 24).

## Tokens

| Token | Uso |
|---|---|
| `--fundo` | fundo da página |
| `--superficie`, `--superficie-2` | cartão; cartão dentro de cartão, faixa |
| `--texto`, `--texto-2` | texto; texto secundário (datas, fontes) |
| `--borda`, `--linha`, `--linha-fina` | contorno de 2 px (bloco, botão, campo) e de 1 px (selo, chip, amostra): ver "Neobrutalismo saudável" |
| `--sombra`, `--sombra-pequena` | sombra dura, deslocada, sem desfoque: só no botão primário e na folha por cima |
| `--raio-bloco`, `--raio-controle`, `--raio-selo`, `--raio-pilula` | 16, 10 e 6 px e a pílula: bloco e folha; botão, campo e zona; selo; chip |
| `--respiro-bloco`, `--respiro-pilha`, `--respiro-interno` | padding do bloco, distância entre blocos e entre peças de dentro (20/24/12 no celular, 24/32/16 no desktop) |
| `--realce` | fundo pastel do "o que fazer agora" dentro de um bloco (`.zona--realce`) |
| `--tam-numero` | o número protagonista de um bloco (`.numero-grande`) |
| `--destaque` + `--destaque-texto` | seleção atual, ação primária |
| `--positivo`, `--negativo` | entrada/saída de dinheiro (com sinal) |
| `--ok-fundo`, `--atencao-fundo`, `--erro-fundo` | semáforo das conexões e avisos |
| `--barra-*` | barra inferior (celular) e trilho lateral |
| `--esp-0…16` | espaço: 0 (2 px), 1, 2, 3, 4, 5, 6, 8, 12, 16 (× 4 px). Nada de rem solto em padding, margin ou gap |
| `--toque`, `--toque-grande` | 44 px (mínimo de tudo que se toca) e 48 px (o envio principal) |
| `--divisor` | 1 px a 35% de `--borda`, entre linhas de lista |
| `--faixa`, `--faixa-forte` | 6 e 8 px: a faixa à esquerda que diz o tipo (citação, mensagem, cartão de decisão) |
| `--hover` | fundo de hover do comum (`--superficie-2`); nunca cor de estado |
| `--zebra` | linha par de tabela (BP-TABELA): meio caminho até `--superficie-2`, para o hover aparecer por cima |
| `--etapa-*`, `--sobre-pastel` | os pastéis das etapas do funil, fixos nos dois temas, e a tinta por cima |
| `--largura-leitura`, `--camada-*`, `--duracao` | medida máxima de leitura; ordem de empilhamento; duração de movimento |
| `--fonte` | Inter variável, hospedada em `fontes/` (nunca depender da instalada) |
| `--peso-texto`, `--peso-medio`, `--peso-forte`, `--peso-titulo` | 450 texto e campos; 600 rótulo e apoio; 700 nome, valor e botão; 800 título e total. Nada de número solto |
| `--tam-mini…--tam-titulo` | seis tamanhos (tabela abaixo). Nada de rem solto em `font-size` |

### Tamanhos

| Token | Valor | Uso |
|---|---|---|
| `--tam-mini` | 0,75 rem (12 px) | selo, pílula, sinal, legenda da barra inferior; o menor que se escreve |
| `--tam-apoio` | 0,875 rem (14 px) | data, fonte, explicação, rótulo de campo, linha secundária, botão compacto |
| `--tam-texto` | 1 rem (16 px) | corpo e campos (16 px: o iOS não dá zoom no foco) |
| `--tam-nome` | 1,125 rem (18 px) | nome do lead, título de cartão, h2 de bloco da Hoje e de Finanças, h3 |
| `--tam-secao` | 1,375 rem (22 px) | h2 de seção grande, cartão da fila, número de coluna, ícone grande |
| `--tam-titulo` | clamp(1,75 rem, 6 vw, 2,5 rem) | h1 da tela, total e contagem grandes |

Tracking: `-0.02em` no `--tam-secao` e no `--tam-titulo`; `-0.01em` (ou 0) do
`--tam-nome` para baixo. A Inter a 800 já é compacta: mais apertado que isso
encosta as letras.

## Hierarquia orientada à conclusão (18/10/2026)

A Central responde “o que é importante para mim?” com conversas e escolhas do time.
Configuração, responsabilidades, integrações e aparência ficam em Configurações.
Outras áreas têm acesso direto, sem depender de uma dobra dentro do escritório.

- Página: `.cabecalho-pagina` com `--tam-titulo-pagina`. Bloco: `.cabecalho-bloco`
  com `--tam-titulo-bloco`. A mesma informação não reaparece em outra caixa na tela.
- Contexto: `.sobretitulo`, curto e em caixa alta. Campo: `.rotulo-contexto`, acima
  do controle, com peso e espaçamento próprios. Explicação: texto de apoio, limitado
  por `--leitura-max`. Rótulo de campo não se mistura ao valor escolhido.
- Estado: `.etiqueta`, compacto, com fundo e palavra. Uma etiqueta não parece botão.
  Ação: verbo e destino. Um primário resolve a primeira prioridade; o restante é secundário.
- Resultado: `.metricas-venda` separa avaliações, envios confirmados e respostas.
  Ausência de leitura nunca vira zero. Não se mede sucesso por abrir um link.
- Página usa uma só rolagem. Listas crescem em blocos, sem painéis com `overflow:auto`
  empilhados. Diálogos têm sua própria rolagem, por serem outra superfície de trabalho.
- Atualização automática mantém rascunhos, foco e seleção; não remonta a página.
  No retorno à aba, relê as fontes. Falha mantém o último dado e identifica sua idade.
- Acompanhamento mostra o fato observado pela integração, sem “já fiz” ou conclusão
  presumida. As avaliações dos agentes têm pontuação, motivo e autoria reais.

Os padrões e exemplos vivos estão no catálogo BP-CABECALHO, BP-ETIQUETA,
BP-METRICAS, BP-PRIORIDADES e BP-OBSERVACAO do design system.

## Neobrutalismo saudável (16/10/2026)

Mesmo depois da auditoria de 15/10, o app cansava: caixa dentro de caixa (a Ficha tinha folha >
bloco > cartão > selo, quatro contornos), 3 px e sombra em todo bloco, cinco botões iguais em
fileira. As referências que o Rômulo mandou (Dribbble: fintech e saúde mental em neobrutalismo)
mantêm a tinta e a sombra dura, mas usam pouco: canto arredondado médio, contorno de 2 px, pastel
como fundo de seção inteira, muito respiro, número grande e **uma** coisa que salta por tela.
Fundamento de interação no UX Patterns ("Button": um primário por tela, hierarquia
primário/secundário/terciário; "Card Grid": não fazer todo painel parecer igualmente importante).

### As quatro regras de composição (BP-R1 a BP-R4)

1. **Um nível de contorno (BP-R1).** Numa tela ou folha, só o bloco (`.bloco`, `.hoje__bloco`,
   `.fin-bloco`, `.crm-ficha__bloco`...) tem borda. Dentro dele, agrupe com **fundo**
   (`.zona`, `.zona--realce`, `.recado`) ou com **divisor** (`--divisor`), nunca com outra
   caixa de borda. A folha (Sheet) conta como a tela: dentro dela, blocos; dentro dos blocos,
   zonas. `.cartao` dentro de `.bloco`, `.zona` ou `.hoje__bloco` já sai achatado (sem borda
   nem sombra, faixa do tipo por sombra interna).
2. **Um primário por tela ou folha (BP-R2).** Amarelo com `--sombra`: a ação que resolve o motivo
   de estar ali. Numa lista (cada cartão com a sua ação), a ação da linha é secundária ou link; o
   primário da tela é um só. Botões em três degraus: `.botao--primario` (amarelo + sombra),
   `.botao` (contorno, sem sombra), `.botao--leve` (só fundo, terciário).
3. **Secundárias agrupadas (BP-R3).** À vista, o primário e no máximo **um** secundário. Três
   ações ou mais: as outras vão para `details.mais-acoes > ul.lista-acoes` (lista vertical com
   divisor e seta), nunca uma fileira de botões iguais. Só não esconda ali o que é o motivo da
   tela (UX Patterns: "don't hide important actions behind dropdown menus").
4. **Respiro antes de borda (BP-R4).** Separe primeiro por espaço (`--respiro-pilha` entre
   blocos, maior que `--respiro-interno` dentro), depois por fundo, por linha por último.

### Força em ação e estado, calma em leitura

- **2 px** (`--linha`) no contorno do bloco de tela e da folha, em botão, campo e segmentado.
  Nada de 3 px: era o que fazia tudo gritar igual.
- **1 px** (`--linha-fina`) só em peça pequena: selo, chip, amostra. Cartão de lista dentro de
  bloco não ganha `--linha-fina`: não tem borda nenhuma (BP-R1).
- **1 px a 35%** de `--borda` entre linhas de uma lista (`.crm-item`,
  `.fin-linhas`, `.lista-acoes`). Nada de borda em volta de cada linha.
- **Raio**: `--raio-bloco` (16) no bloco e na folha, `--raio-controle` (10) em botão, campo,
  segmentado e zona, `--raio-selo` (6) em selo, `--raio-pilula` em chip e `.escolhas`. Por dentro
  sempre menor que por fora. Só por token: o teste barra px solto em `border-radius`.
- **Sombra** só no botão primário e no que está por cima (folha no desktop, aviso, o pedido
  preso do /design-system). Bloco de tela, cabeça de tela e cartão não têm. Só por token: o teste
  barra sombra deslocada solta (`inset`, a faixa do tipo, passa).
- **Pastel** como fundo de seção inteira, não como caixa: `--realce` para o "o que fazer agora",
  `--ok-fundo`/`--atencao-fundo`/`--erro-fundo` para estado, `--superficie-2` para o neutro.
- **Número grande**: o número que importa no bloco em `.numero-grande` (`--tam-numero`), com o
  rótulo colado; um por bloco.
- **Caixa alta espaçada** só em selo e pílula de estado (`.selo`, `.crm-tag`,
  `.fin-pilula`: uma ou duas palavras). Rótulo de campo, kicker e título de
  bloco em caixa normal.
- **Hover** nunca em cor de estado: `--superficie-2` no comum e
  `brightness(0.95)` no primário. Menta (`--ok-fundo`) é "Interesse" e
  "Atualizada"; num link, parecia já mandado.

Auditoria de 15/10/2026 (escala de tamanhos, onde vai borda de 3 px e sombra,
tabela no desktop): `docs/auditoria-de-design-2026-10-15.md`.

Modo escuro (17/10/2026): **o padrão é claro**. O app abria escuro sozinho quando o sistema estava
escuro, e o dono achou que atrapalhava; agora o escuro é escolha, em Mais › Aparência (e no
`/design-system`): Claro | Escuro | Automático (`src/casca/SeletorDeTema.vue`, estado único em
`temaVivo.ts`, regra PURA em `tema.ts`, guardada no `localStorage` em `squadone:tema`). Claro põe
`<html data-theme="light">`, Escuro põe `data-theme="dark"` e Automático tira o atributo, e aí vale
o `prefers-color-scheme`. Um `<script>` curto no `index.html` aplica a escolha antes do primeiro
quadro (sem ele o fundo piscava escuro); o teste confere que ele dá o mesmo que `tema.ts`. Só os
semânticos mudam; a paleta fica. Os dois blocos escuros do `tokens.css` (media query e
`[data-theme="dark"]`) são iguais, e o teste confere.

Erro no escuro (17/10/2026): `--erro-fundo` é um cinza-avermelhado (`#362a2d`) e `--negativo` um rosado
calmo (`#ef9f97`); o vinho saturado de antes gritava em todo aviso. Como o fundo ficou perto da
superfície 2, quem diz "erro" é a faixa ou a borda no `--negativo` (`.recado--erro`, `.zona--erro`,
`.selo--erro`, o gargalo do "Por que não está vendendo"). Diagnóstico para ler (o gargalo) leva fundo
neutro com faixa e título no `--negativo`, não o bloco inteiro em `--erro-fundo`.

## Design system (/design-system) e a regra do teste

Desde 16/10/2026 o design system é uma página do próprio app: `/design-system` (Mais ou Ctrl+K).
Ela lê este `tokens.css` cru, mostra cada token com amostra, valor claro e escuro e o comentário
de cima; mede o contraste dos pares que as telas usam no tema da hora (e o teste calcula os mesmos
pares nos dois temas, do `tokens.css` cru, desde 17/10/2026); e traz cada componente vivo
com um código fixo (`BP-BOTAO`, `BP-ESCOLHAS`, `BP-FICHA`...). Mudar um valor ali muda o app
inteiro daquela aba até recarregar, e "Copiar pedido" devolve o bloco de CSS e o porquê, para colar
na conversa. Para pedir mudança visual, cite o código `BP-` e, se for de token, cole o pedido.

`src/blueprint/blueprint.test.ts` barra o que foge da escala em qualquer `.css` ou `<style>` de
`src/`: rem/px solto em espaço e em `font-size`, peso numérico, px solto em `border-radius`
(16/10/2026), sombra deslocada que não é `--sombra`/`--sombra-pequena` (16/10/2026) e `var(--x)`
que não existe. Exceção só com motivo escrito no teste (`EXCECOES`, `EXCECOES_DE_REGRA`). As regras
de composição (BP-R1 a BP-R4) não dá para conferir por CSS: são revisão, com o código na mão.

## Uma decisão por vez (16/10/2026)

- **Selecionado é amarelo.** Aba atual, opção escolhida e ação primária em `--destaque`; nada de
  seleção invertida (texto sobre fundo escuro) num lugar e amarela no outro.
- **Variantes, uma por vez.** Dois ou mais textos do mesmo momento (as variantes da colinha)
  ficam em `.escolhas` e só o escolhido aparece. Formulários do mesmo bloco, idem (o "Anotar" da Ficha).
- **Consulta dobrada.** O que não muda a decisão de agora (detalhes do lead, linha do tempo, ofertas
  de depois) fica num `details.dobra`, com o título e a contagem à vista.
- **Um aviso, não dois.** Se a dica já diz a regra, o aviso genérico não se repete embaixo.

### Componentes de escolha

| Classe | Quando |
|---|---|
| `.segmentado` | 2 a 4 opções curtas numa linha (Lista/Mapa, Site/Organizar, Próximo passo/Proposta/Nota) |
| `.escolhas` | chips em pílula: rótulo longo ou número variável de opções; quebra linha, não estica (só abaixo de 30 rem) |
| `details.dobra` | consulta: fechada por padrão, aberta sozinha só quando há falha dentro |
| `details.mais-acoes` | ações secundárias além da primeira (BP-R3): lista com divisor, não fileira |

### Componentes de composição

| Classe | Quando |
|---|---|
| `.bloco` | o contorno de uma seção da tela ou da folha (BP-BLOCO); `--respiro-bloco` por dentro |
| `.zona`, `.zona--realce` | agrupar dentro do bloco por fundo (BP-ZONA); o realce é o próximo passo, um por bloco |
| `.numero-grande` | o número protagonista do bloco (BP-NUMERO) |

## Tabela no desktop (BP-TABELA, 16/10/2026)

Lista com muitos itens que se comparam entre si (Lançamentos, a Lista do Funil) vira `<table>` a
partir de 64 rem; abaixo, a lista de sempre, e só uma das duas no DOM (`matchMedia`).

- Cabeçalho `position: sticky`, em `--texto-2` e `--peso-medio`; a coluna ordenada fica em `--texto`
  e `aria-sort` diz o sentido. Ordenar é um `<button>` dentro do `<th>`.
- Linha de `--toque` (44 px), uma linha por item: o que não cabe leva reticências e fica inteiro na
  Ficha ou no editor. Layout fixo (`table-layout: fixed` + `<colgroup>`) quando há texto comprido.
- `--zebra` no lugar do divisor entre linhas; `--divisor` só entre grupos (os dias dos Lançamentos).
  Hover em `--hover`, nunca cor de estado.
- Número à direita em `tabular-nums`, com sinal e cor como na lista.
- O nome (ou a descrição) é o `<button>` que abre; clicar na linha faz o mesmo. Editor é uma linha
  com `colspan`, logo abaixo. Uma ação por linha, no estilo do link do cartão.

## Navegação

- Abaixo de 1024 px: **barra inferior** Hoje · Funil · ＋Pedir · Finanças ·
  Mais, fixa, com a área segura do iPhone. O ＋Pedir é o gesto principal
  (maior, em `--destaque`) e abre a folha Pedir; sem a agenda no processo fica
  desabilitado com o motivo escrito ("sem agenda aqui"). No Easypanel, sem
  Funil nem Finanças: Hoje · Agenda · ＋Pedir · Escritório · Mais.
- A partir de 1024 px: **barra lateral** com todos os destinos (Agenda,
  Escritório e Entrada inclusive), o Pedir em cima e "Buscar e ir" (Ctrl+K /
  ⌘K) embaixo.
- O item atual leva `aria-current="page"` e o fundo `--barra-ativo`.

## Folha (Sheet)

Tudo que abre por cima é uma folha (`components/Sheet.vue`): sobe de baixo no
celular, com alça e canto `--raio-bloco` em cima, e vira diálogo no meio da tela a partir de
48 rem (o único lugar, com o botão primário, que leva `--sombra`). A folha é o contorno: dentro
dela, blocos sem sombra e, dentro deles, zonas (BP-R1). Título sempre; botão **Fechar** com
texto (nunca só ✕); ação principal no rodapé, à direita, e só uma (BP-R2). Esc fecha, o foco fica preso dentro e volta a quem abriu. Durante um
envio a folha não fecha ("Aguarde…" no lugar de "Fechar").

## Agentes

- **Cartão de decisão** (contratação, troca de squad): `.cartao--decisao`,
  faixa `--acento` à esquerda; ajuste de tempo em `--positivo`; falha do Dell
  em `--negativo`. Selo em caixa alta com a palavra, nunca só a cor. Solto, tem contorno e
  `--raio-bloco`; dentro de bloco vira zona (sem borda, faixa por sombra interna).
- **Estado de agente** (`.estado`): ponto + palavra. Sem fonte é "Sem sinal",
  com o ponto tracejado e o texto em `--texto-2` — nunca "ocioso" inventado.
- **Segmentado** (Auto/Foco/Baixa, Lista/Mapa, Site/Organizar): 44 px por
  botão, `aria-pressed`, o escolhido em `--destaque`.

## Componentes de finanças

Pausa automática da prospecção (21/10/2026): aviso de atenção com hora, evidência agregada e motivo específico; distingue restrição, recusa da integração, desconexão e acúmulo sem resposta humana. O prazo de revisão não promete retomada. A Ficha e a Triagem mostram a mesma trava; respostas às conversas existentes continuam disponíveis.

Primeiros contatos (21/10/2026): o painel separa disparos confirmados hoje, respostas humanas, somente robôs e sem resposta, pelo dia de São Paulo e um destinatário por categoria. A resposta humana substitui o robô. Sem CRM atual, mostra contagem indisponível; os limites de dia, hora e intervalo vêm da mesma regra usada pelo envio. A pausa continua exigindo ativação manual.

- **Bloco**: `--superficie`, `--linha`, `--raio-bloco`, sem sombra, título curto em cima
  ("Tenho", "Devo", "Gastei") e o total em `.numero-grande` logo abaixo.
- **Barra de proporção**: largura em %, sempre com o número ao lado; nunca a
  barra sozinha.
- **Semáforo de conexão**: pílula com a palavra (OK, Atualizando, Atenção,
  Erro) e o fundo correspondente.


### Escritório integrado · 18/10/2026

A navegação flutua sobre a sala: amarelo marca somente a página atual; o acesso verde ao Assistente é uma ação separada, com aria-expanded. No desktop, a conversa ocupa uma área lateral independente e pode ser recolhida. O cenário ocupa toda a altura sem reservar faixa para o menu. No celular, a sala mantém escala legível e permite exploração horizontal; os cards continuam com uma única rolagem vertical. O card de agente prioriza o canal direto e diferencia conversas de clientes, agenda e operação, sem abas de nomes semelhantes.


Minhas decisões (21/10/2026): fila com uma linha por cliente, busca, oferta e páginas; Precisa de você, Em acompanhamento e Encerradas. Cada decisão percorre Entender, Agir e Acompanhar. Procedimentos distinguem robô, recepção, áudio sem transcrição, espera e desfecho. Mensagens vêm da fila ou do copiloto com contexto relido antes e depois do preparo; mudança invalida a sugestão. Robô recebe orientação de menu e espera, sem tratar resposta automática como interesse ou liberar retomada fora das travas da ficha. Abrir WhatsApp não grava envio; confirmação e próximo passo são explícitos. Preserva seleção e rascunhos durante atualização.
### Atendimento compartilhado · 25/10/2026

Os quadros e a fila comercial usam a mesma orientação: tarefa, responsável,
momento, evidência, condição e resultado esperado. `AtendimentoCliente` mantém
orientação e ficha completa no mesmo diálogo, sem perder o rascunho ao alternar.
O detalhe da ficha complementa o fluxo Orientação → Mensagem → Acompanhamento.
Em telas de até 28 rem, cada etapa ocupa uma linha para manter o nome legível.
Vendas prioriza Conversas e Primeiros contatos; consultas ficam em Entender.
Leitura atrasada leva indicador de atenção e bloqueia ações dependentes da fonte.
