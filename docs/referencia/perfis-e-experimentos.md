# Perfis app/operations e experimentos desligados

> Movido do `CLAUDE.md` em 11/10/2026 para a sessão não carregar isto toda vez.
> O texto é o original, sem alteração; o `CLAUDE.md` guarda só o resumo das regras.

## Dois perfis: app (Easypanel) e operations (Dell)

O mesmo código roda em dois lugares, escolhido por `SQUADONE_MODE` no servidor. Detalhes e regras da Central estão em `ARCHITECTURE.md` e `RULES.md` — leia-os antes de mexer em `server/operations.ts`, `server/auto-production.ts`, `server/dell-status.ts`, `src/operations/` ou `deploy/`.

- **`app` (padrão, Easypanel):** o SquadOne de sempre, bind `0.0.0.0`. `/api/operations/*` responde 404 JSON (sem isto o fallback da SPA devolveria HTML 200). Ausente = `app`; valor desconhecido derruba o boot — perfil errado não pode abrir a Central calado.
- **`operations` (só no Dell, `deploy/dell/squadone-operations.service`):** a Central em `/` (`/squadone` abre os agentes aqui com a agenda ligada; sem ela, redireciona ao app do Easypanel, como desde 30/09/2026), rotas `/api/operations/*`, bind **só em `127.0.0.1`** (acesso por túnel/Tailscale). Exige `SQUADONE_OPERATIONS_CONFIG`; a credencial do Google é outra, local ao Dell, independente da de produção. As rotas do app (`rotasDoApp` em `server.ts`: roster, Mochila, turno, ajuste, avisos, avaliação) só são montadas com a agenda ligada (ver "Agenda no Dell"); sem ela o resto de `/api` é 404 JSON, e do Google ficam só `/api/auth/google` e `/callback` (a agenda da Central). `/api/push/*` não existe mais (o ntfy saiu). O `~/SquadOne/data/squad.json` do Dell é um retrato de 14/09/2026 e nunca vira a agenda.
- **`GET /api/runtime`** devolve `{ mode, avaliacoes, ocupado, agenda, assistente }` (`agenda`: o app mora neste processo; `assistente`: o painel do Assistente está ligado aqui). `ocupado` = turno em andamento (`haTurnoEmAndamento`, contado em `rodarDemanda`), mensagem na fila do bot (`bot.ocupado()`), resposta do Assistente em andamento ou, desde 19/10/2026, uma volta da vigia (`vigia.ocupada()`); o `deploy/dell/atualizar-central.sh` espera `false` (até 10 min) antes de reiniciar.
- **`src/RootApp.vue`** pergunta `/api/runtime` e monta a MESMA casca (`App.vue`) com `{ perfil, agentes }`: no `operations`, Hoje com o estado do Dell, Funil, Finanças, Entrada e, com `agenda: true`, os agentes (Pedir, Agenda, Escritório); no `app`, só os agentes. Falha na pergunta = perfil `app`, nunca a Central. `/squadone` sem a agenda continua redirecionando ao Easypanel.
- **Casca mobile (07/10/2026):** barra inferior abaixo de 1024 px (no Dell, desde 17/10/2026, Central de comando · ＋ · Vendas; Hoje · Agenda · ＋Pedir · Escritório · Mais no Easypanel), barra lateral e Ctrl+K/⌘K a partir dela. Links de rota da casca navegam com `pushState` (`casca/rota.ts`), sem recarregar: recarregar no meio de um turno perderia a resposta. A Hoje segue a RULES 13 (no máximo 3 cartões, depois "ver todas"), nesta ordem: falhas do Dell → troca de squad → ajuste → contratação → **respostas de lead** → **finanças** → fila → vale olhar. O cartão de respostas (`casca/RespostasAlerta.vue`, `pendenciaDeRespostas` em `casca/hoje.ts`, 08/10/2026) é o grupo "Respostas para responder" do mesmo `GET /api/operations/crm` da linha do funil (agora relido a cada 5 min com a aba visível, como as finanças): quantos esperam, o que o mais antigo disse e quantos querem ver, com link para `/crm`; até então só o aviso do Hermes na hora da resposta chamava. Desde 14/10/2026 o **interesse parado** (disse que quer ver e a 2ª mensagem não saiu) não some em 48 h: o servidor o põe na frente do grupo, o mais antigo primeiro, e o cartão diz "N ainda sem o link" (`parados`); some quando a 2ª mensagem é anotada na aba CRM (`segunda_enviada`: pelo observador, que vê o link sair na conversa, ou pelo "Enviei" explícito; abrir o WhatsApp não anota nada, e `anotacao-de-envio.ts` saiu em 19/10/2026; regras em `server/crm.ts`, `interesseParado`), ou na saída normal da etapa. O cartão de finanças (`casca/FinancasAlerta.vue`, `pendenciasDeFinancas` em `casca/hoje.ts`) vem do `GET /api/financas/estado` (o mesmo da Sala Finanças: o cartão mais usado e o orçamento do mês, só % e semáforo, "dados até") e só entra em **laranja ou vermelho (≥ 90 %)**; o amarelo (70 %) fica na aba Finanças, senão ocuparia um dos três lugares o mês inteiro. Texto "Cartão <banco>: N% do limite" / "Orçamento do mês: N%", link para `/financas`, nenhum R$ nem estabelecimento (RULES 24). Lido só no `operations`, no mount e a cada 5 min com a aba visível; falha = sem cartão, nunca estado inventado. Tudo usa os tokens (`tokens.css`), com modo escuro: o CRM em `src/operations/crm.css`, os painéis de Mais (como funciona, acessos, o que o Dell confere) em `src/operations/mais.css`. O `operations.css` (o shell antigo da Central, só claro) saiu.
- **Central de comando (17/10/2026, pedido do Rômulo: "os menus são Central de comando + Assistente + Vendas"):** no `operations` a barra inferior é Central de comando · ＋ Assistente · Vendas, e o trilho lateral, os mesmos dois destinos e o ＋; a Manutenção (o antigo Mais, `/mais`) é a engrenagem discreta do topo (celular) e do pé do trilho (desktop), sem o grupo "Usar". `/agenda`, `/financas`, `/squadone`, `/mais` e `/design-system` seguem por endereço (alertas do Telegram e links antigos); Agenda e Finanças acendem a Central, Escritório e design system acendem a Manutenção (`destinoAtual`). O `/` do `operations` é `rotas/CentralRota.vue` (a `HojeRota.vue` ficou só para o `app`): (1) o estado do Dell, único lugar do número "N precisam de você" (o chip do topo saiu), com "Atualizar", e os cartões de `casca/PrecisaDeVoce.vue` (no máximo 3, o do Dell conta um; a mesma peça da Hoje do `app`); (2) o Escritório animado (`casca/EscritorioVivo.vue`: GameMap em altura fixa, carregado na primeira pintura, ou Lista, guardada em `squadone:central:vista`; o andar é da Central, `squadone:central:andar`, padrão o primeiro com operação, e não troca a squad ativa); os balões vêm de `office/baloes.ts` (robôs pelo status.json, leads por passo da jornada nas salas do PRUMO, % e semáforo na Sala Finanças, bloco em curso ou próximo compromisso de `/api/time`; sala que deveria ter fonte e não leu diz "Sem sinal") e o PO raiz vai à sala do robô que falhou ou pede olhar (`destinoDoSupervisor` → prop `visita` do GameMap) e volta quando o status.json resolve; o passeio continua decoração; (3) as faixas de `casca/central.ts`: Vendas (o passo da vez e a oferta, a contagem por tipo e o gargalo; sem primeiro contato, que depende da trava de ritmo e fica na Próxima venda), Agenda (os 3 próximos; folha com a `AgendaRota`), Finanças (só o semáforo e as %, nunca R$ na home; a folha lê `/api/financas/visao` só quando abre e mostra `FinSaude` + `FinVisao`), Entrada (o selo de `GET /entrada/api/estado`, falha só vira "Sem sinal"; o toque navega de verdade para `/entrada/`) e Dell (a saúde "N de M ok", sem repetir o número do cabeçalho). O Ctrl+K oferece o Assistente, os três menus, as abas de Vendas, os saltos `/?abrir=financas|agenda|escritorio` (a Central remonta pela chave do `App.vue` e limpa o endereço) e o que mora na Manutenção. A Próxima venda deixou a home: o lugar dela é Vendas › A fazer.
- **Pedir é uma folha** (`casca/PedirFolha.vue`, era a CommandBar): chip da squad, Auto/Foco/Baixa de 44 px, ditado pelo navegador (Web Speech API, pt-BR, desabilitado com o motivo onde não existe) e o MESMO corpo `{ demanda, modo, squadId }` em `/api/orquestrar`. Erros e avisos do turno ficam por extenso na folha até o próximo pedido (eram `alert()`); com a folha fechada, o aviso traz "Ver detalhes".
- **`Sheet`** (`components/Sheet.vue`) é a folha de tudo: Pedir, contratar, editar, nova squad, arquivo, sala do mapa, ficha do CRM, Ctrl+K. `role="dialog"` + `aria-modal`, Esc, alça (arrastar para baixo), botão Fechar, foco preso (Tab gira e o `#app` fica `inert`) e devolvido a quem abriu; `bloqueada` durante um envio (nada fecha). Abaixo de 48 rem sobe de baixo; acima, diálogo no meio.
- **Contador de uso (17/10/2026, AC-28, só `operations`):** a casca manda um `sendBeacon` a cada troca de tela (`POST /api/operations/uso`, mesma origem, `text/plain` ≤ 1 KB, 204), e um middleware conta as escritas da API pelo modelo da rota do Express. O agregado é por dia de São Paulo, em `SQUADONE_OPERATIONS_DATA_DIR/uso/AAAA-MM-DD.json` (pasta 700, arquivo 600, gravado a cada ~30 s, 90 dias). Nunca guarda id de lead, telefone, texto, valor nem query além de `ver`/`produto`; finanças só pelo caminho. `GET /api/operations/uso?dias=14` devolve o agregado, sem tela por enquanto. É o que a próxima auditoria lê para saber o que é usado. No `app` o beacon recebe o 404 de sempre de `/api/operations`.
- **Assistente da Central (17/10/2026, RULES 28, só `operations`):** `SQUADONE_ASSISTENTE=true` liga o painel (o "＋", a lateral e o Ctrl+K abrem ele no lugar do Pedir); `SQUADONE_ASSISTENTE_HERMES=true` libera a consulta ao Hermes. O Gemini responde com até 3 rodadas de ferramentas só de leitura (Hoje, funil, fila, lead mascarado, agenda do dia, Dell) e só propõe cartões (pedido ao time, anotação na Ficha, mensagem ao lead só para copiar); quem escreve é o toque, pela rota de sempre. O Hermes é chamado por `hermes -z -t clarify -s mapa-do-ecossistema` numa pasta vazia, com as sessões apagadas antes e depois, e o texto dele nunca volta ao Gemini. Finanças, R$ e valor com cara de preço não vão a modelo (`parece-financas.ts`); a tela de Finanças responde por regra. Tetos: 60 mensagens, 60 respostas por regra e 20 consultas ao Hermes por dia; 4 min por resposta. Histórico em `SQUADONE_OPERATIONS_DATA_DIR/assistente/AAAA-MM.jsonl` (600, pasta 700, só mascarado, poda por data em 90 dias).
  - **Fase 2 (17/10/2026, AC-31).** *Copiloto no painel:* a aba Copiloto da Ficha saiu (`CrmCopiloto.vue` apagado); em "Como vender", o botão **"Perguntar sobre este lead"** (só com `useAssistente().disponivel`, que o `App.vue` liga pelo `/api/runtime`) abre o painel com o lead como contexto (`?lead=`, `contextoDoEndereco`); no celular o ＋ da barra fica inerte com a Ficha aberta e o painel sobe numa `Sheet` empilhada por cima dela (no desktop, o aside ao lado). A leitura `ler_sugestao_do_copiloto` só é declarada com o copiloto ligado (fonte `sugestao`, ligada no `server.ts` a `copiloto.ler`, que **nunca gera**) e devolve ao modelo `sugestaoParaOModelo` (PURA): momento, mensagem, porquê, ofertas e itens só pelo nome, sem preço, mascarado; sem sugestão `{ nenhuma }`, fora do trecho `{ foraDoTrecho }`, desligado `semSinal`; a fonte vira "copiloto das HH:MM". Achando a sugestão, a **cola** (não o modelo) cria o cartão `sugestao_do_copiloto` (`cartaoDaSugestao`, PURA: um por lead, dentro dos 3 cartões) com **só a referência** `{ produto, id, empresa, hashDoDossie }`: o texto da sugestão e o R$ da proposta nunca vão ao JSONL do Assistente. `casca/AssistenteSugestao.vue` relê a sugestão no `GET /crm/copiloto/sugestao`, põe nos itens o preço do cardápio (`itensDaProposta`/`textoDaProposta`), só copia (cada cópia medida no `/copiou`) e avisa quando a conversa andou (hash diferente). O prompt manda ler a sugestão antes de "o que respondo" e não repeti-la. *Gasto falado:* "gastei 30 no mercado" vira cartão **na aba**, por regra fixa (`gastoDoTexto` = o `lerGastoFalado` do Telegram), antes de qualquer envio: nem o texto nem o valor chegam ao servidor do Assistente, a modelo ou ao JSONL (RULES 24). `casca/AssistenteGasto.vue` mostra valor e lugar (a tela é o lugar do R$) com "Anotar em Finanças" e "Descartar"; o toque grava em `POST /api/financas/gasto { texto, origem }`, atrás das guardas de identidade e mesma origem das finanças, e o servidor relê o texto (`lerPedidoDeGasto`, PURA; a origem vira `painel:<id>`, a chave da transação, então o mesmo cartão tocado de novo não duplica) antes de `anotarGasto` na conta manual; o log diz só "anotado"/"repetido". O cartão vive só na aba (some ao recarregar ou em "Nova conversa"); `linhaDoTempo` o intercala com as mensagens. Pergunta de finanças que não é gasto falado segue com o "Isso fica em Finanças" do servidor. Fica para a fase 3: o Jev medindo a intenção em sombra e o `/a` no Telegram.
- **Número único do Dell (17/10/2026, AC-17):** topo, Hoje e Mais leem `resumoDoDell` (`src/operations/alertas.ts`): "precisam de você" (vermelho, ou amarelo sem `sozinho`) e "resolvem sozinhas" (amarelo com `sozinho`), com `total − ok = precisam + sozinhas` e o mesmo "às HH:MM". Retrato com mais de 5 min ou ausente = "Sem notícia do Dell desde HH:MM" (RULES 19). A Hoje (desde 17/10/2026 a Central de comando, que é também o único lugar do número) mostra só os títulos e "Ver em Manutenção" (`/mais?abrir=manutencao`); containers, comandos e caminhos ficam lá.
- **A Central é somente leitura para serviços e infraestrutura** (RULES 8, 10, 16): mostra estado e links, nunca para, reinicia ou reconfigura n8n, Hermes, Docker, systemd ou Tailscale. O estado do Dell vem só do `status.json` do monitor. **Escrita de domínio ela faz**, sempre por gesto do usuário ou por regra fixa e sempre no próprio diretório de dados (`SQUADONE_OPERATIONS_DATA_DIR`) ou pelo webhook do n8n: o registro do CRM (`POST /crm/registro` e os de desfecho, decisão e ajuste de passo, que viram nota/linha na aba CRM pelo n8n), o dia da venda (`venda-do-dia.json`: "Enviei", "Pular", os primeiros contatos e os liberados), o estado do vendedor e do lead quente em sombra (`vendedor.json`, `vendedor-historico.jsonl`, `lead-quente-sombra/`), o do copiloto e do Assistente (JSONL), o contador de uso, a conversa importada do WhatsApp (`POST /crm/conversa/importar`, em `whatsapp-conversas/`), o `frente-comercial-config.json` (pausar/ativar o time, `POST /crm/frente/config`) e a reserva do primeiro contato do time (`POST /crm/frente/reservar`), as finanças (`financas.db`), o `avisos-enviados.json` e a fila de avisos. Nada disso toca serviço: o time comercial (`frente-comercial.py`) é quem envia, e roda no systemd, não na Central.
- **Ferramentas de Mais → Acessos** (bloco `tools` do arquivo de `SQUADONE_OPERATIONS_CONFIG`, lido só no boot): `hermes`, `ide`, `n8n` e `remote` são obrigatórias; faltando uma, a Central não sobe ("Configuração da ferramenta '<id>' está incompleta"). **`syncthing` é opcional desde 12/10/2026**, quando o Syncthing da Mel foi aposentado (nenhum aparelho pareado desde 04/10): ausente, some do `/overview` e do painel (nada de "Sem resposta agora"); presente, vale como antes, com a mesma validação e o health de `healthKind: "syncthing"`, e uma entrada presente mas incompleta continua sendo erro. O `config/operations.example.json` já vem sem ela. Para tirar da Mel, **só depois** do deploy desta versão (na anterior, sem a entrada, a Central não sobe): apagar o bloco `"syncthing"` de `~/.config/squadone/operations.json` (JSON válido, sem vírgula sobrando) e `systemctl --user restart squadone-operations` com nenhum turno em andamento (`/api/runtime` com `ocupado: false`).

## PRUMO como holding: quatro ofertas num funil (14/10/2026)

Decisão do Rômulo: o **PRUMO fica sob o SquadOne** (é a squad `prumo`), e tudo o que o PRUMO prospecta fica
**sob o PRUMO**: o Site antes da venda (auto-site), os serviços do PRUMO (Raio-X, Mapa, Fonte: o "Organizar"),
o **Iris** (clínicas de terapia) e o **CRM de estamparia** (white-label do CRM da Silmer). Plano em
`docs/superpowers/plans/2026-10-13-prumo-holding.md`.

- **Roster de produção** (pelo ✎/API, não Git): a squad PRUMO ganhou as salas `prumo--iris` (PO Helena,
  Comercial do Iris) e `prumo--estamparias` (PO Otávio, Comercial do CRM de estamparia); a Prospecção passou a
  cuidar só de Site e Organizar, e o escopo da squad diz que ela é a holding das quatro ofertas.
- **n8n** (gerador `deploy/dell/claude-ops/prumo-ofertas.py`, config em `prumo-ofertas.json`, triagem em
  `prumo-ofertas-triar.js`): abas **Clínicas** e **Estamparias** na planilha do PRUMO, com o contrato de colunas do
  Prospects; "PRUMO · Iris — Caçador de clínicas" e "PRUMO · CRM de estamparia — Caçador de estamparias"
  (Places → site da empresa → WhatsApp publicado e celular → dedupe por place_id e WhatsApp contra todos os
  funis → até 15 por rodada em Revisar, descarte com motivo em Descartados, aviso pelo Hermes). **Nasceram
  desligados** e rodavam à mão (`python3 prumo-ofertas.py --rodar iris|estampa`); **o Rômulo ligou o agendamento
  em 16/10/2026** ("pode automatizar"): dias úteis às 9h, até 15 por rodada em Revisar, nada é enviado (o convite
  segue sendo um toque dele), primeira rodada agendada na segunda, 19/10, às 9h. Liga e desliga por
  `python3 prumo-ofertas.py --ativar|--desativar [iris|estampa]` e confere por `--estado`, sempre a partir de
  `~/.local/share/claude-ops` (`prumo-ofertas.py`, `prumo-ofertas-triar.js` e `prumo-ofertas.json` instalados lá).
  Republicar (sem flags) troca os nós e **não** muda o estado ligado/desligado; confira com `--estado`. Cliente do PRUMO (`clientes`, hoje a Silmer) nunca vira
  prospect. O clique em Enviar convite (`/webhook/convite-iris` e `/convite-estampa`) abre o WhatsApp com o convite
  da oferta (voz PRUMO, sem nome, R$ nem link) e marca "Convite enviado".
- **CRM** (`server/crm.ts`): produtos `iris` e `estampa` lidos dessas abas pelo 08 · CRM (`crm.py`), com a regra
  `etapaDoPrumo`. Raio-X, Mapa, 2ª mensagem e reenvio do só-robô seguem só do PRUMO: nas ofertas
  novas não há texto aprovado, e a Hoje pede "combinar a demonstração". Aba ausente ou ilegível não segura o
  retrato: vira fonte com erro. O filtro do CRM e o segmentado do celular mostram as quatro (Site, Organizar,
  Iris, Estampa).
- **Filtro dos caçadores, revisto no mesmo dia** (análise de 14/10/2026 e decisão do Rômulo; regra em
  `prumo-ofertas-triar.js`, config em `prumo-ofertas.json`). A regra do PRUMO de "só WhatsApp publicado no site"
  jogava fora metade de cada busca, inclusive as melhores clínicas de ABA, que só têm Instagram. Agora o WhatsApp
  vale do link cadastrado como site no Google, do link no site (celular **ou fixo**: WhatsApp Business roda em
  fixo), do botão do site, de link encurtado e do número no texto; sem nada disso, o **celular do Google** entra
  como "não confirmado" (prioridade menor; a Hoje pede para conferir antes do convite). O perfil é exigido no
  nome, no tipo do Google ou no site: Iris só com público infantil/TEA ("multidisciplinar" sozinho deixava entrar
  reabilitação de adulto; fisioterapia, medicina do trabalho e órgão público fora; profissional sozinho marcado),
  estamparia só com roupa (caneca, brinde e fornecedor fora). A busca da vez é a usada há mais tempo (coluna Busca),
  com as frases que rendem no Places na frente ("terapia ABA" e "clínica de autismo" trazem 20+; "clínica ABA
  autismo" trazia 3). Descartados guarda site, telefone, Maps, tipo e busca, para resgatar à mão; colunas novas
  entram sempre no fim. `--rodar <oferta> --busca "..."` roda uma busca escolhida numa cópia temporária;
  `--reavaliar <oferta> AAAA-MM-DD "busca"` tira o que ainda está em Revisar sem convite e os descartes desde a data
  e refaz a busca com as regras atuais (usado em 14/10 nas duas buscas da 1ª rodada: 15 clínicas e 15 estamparias).
  No CRM, Prospects para revisar vem pela Prioridade, com sinais, nota e Maps.
- **WhatsApp** (`deploy/dell/claude-ops/whatsapp-conversa.py`, abas e convites tirados do `prumo-ofertas.json`):
  os três fluxos do observador (números, conversa, resposta classificada) leem também Clínicas e Estamparias,
  pelo nome da aba e tolerantes (aba que não lê é pulada, sem segurar Site e Prospects), com as regras do
  Prospects: o envio do Rômulo vale o clique em Enviar convite, a leitura vira "Leu o convite em ...", e a
  resposta a 5 min ou mais do convite grava "Respondeu em" e a Próxima ação. A classificação do Gemini grava
  Tipo da resposta, Resposta e Resposta em; gente (interesse ou neutra) passa a Etapa a **"Em conversa"**
  sozinha (antes era à mão), robô apaga o "Respondeu em" daquela conversa, negativa ou exclusão vai a "Sem
  interesse". O aviso do interesse pede combinar a demonstração (nunca Raio-X) e leva à ficha
  (`lead=iris:<ID>` / `estampa:<ID>`). O Jev em sombra recebe essas respostas como as do Prospects (mascaradas).

## A/B do vídeo no envio do Site (11/10/2026; medição pronta, nada ligado)

Pergunta: mensagem + link rende mais "respondeu de gente" com um vídeo de ~15 s do demo logo depois? O código só **mede**: nada envia, grava planilha ou escolhe lead. Sem a coluna preenchida, nenhuma tela muda.

- **Desenho, fixado antes de enviar:** um nicho, uma letra de mensagem (`mensagem_variante`), 20 envios por braço; braço sorteado de forma determinística por `bracoDoLead(placeId, sal)` (`src/operations/ab-video.ts`: FNV-1a sobre os bytes UTF-8 de `<sal>:<place_id>` + finalizador fmix32 do MurmurHash3; hash par = `video`), com o sal próprio `SAL_DO_AB_VIDEO` (`squadone-ab-video-1`; outro teste, outro sal). O lead nunca troca de braço. Métrica primária: respondeu de gente (o robô, tipo `bot`, não conta). Leitura **única** 7 dias depois do último envio, sem espiar: antes disso a tela mostra só quantos foram enviados, nunca a taxa. "Vídeo ganhou" só com **+20 pontos percentuais E Fisher exato bilateral p < 0,10** (`fisherExato`, mesma folga do `fisher.test` do R); qualquer outra coisa é "não provado". Menos de 20 num braço: "amostra insuficiente".
- **Regra de parada:** qualquer aviso ou restrição do WhatsApp na conta, ou 2 ou mais bloqueios no braço com vídeo: parar e não ler. O CRM não enxerga bloqueio; a regra fica escrita no bloco do teste.
- **Coluna `braco_video` (aba Leads, preenchida à mão):** `video` = braço com vídeo; vazia = sem vídeo; outro texto (`sem-video`) = sem vídeo marcado. `server/crm.ts` a lê como `abordagem.video` (`bracoDaColuna`: aceita "vídeo", "com vídeo"); não é coluna esperada, então ausente não vira aviso. O n8n e o Balcão não a tocam.
- **Quem está no teste** (`leituraDoAbVideo`): leads do Site enviados a partir do primeiro envio marcado (qualquer valor na coluna), no nicho e na letra mais comuns do braço com vídeo; sem a coluna, conta como sem vídeo. Marcado fora do nicho ou da letra é contado à parte e fica fora da conta; coluna diferente do sorteio com o sal do teste vira aviso forte ("conferir antes de ler"). Por isso marque só leads ainda **não enviados**: marcar um enviado antigo puxa o início do teste para trás. Marcar os dois braços (`video` e `sem-video`) é o mais seguro: só com `video`, um lead sem vídeo enviado antes do primeiro com vídeo fica de fora.
- **Tela:** em Resultados, a seção "Por vídeo no envio (teste A/B)" (critério `video` de `resultados.ts`: "Com vídeo" / "Sem vídeo") aparece só com a coluna preenchida, ignora o período e mostra "N de 20 enviados" por braço, o estado (amostra insuficiente / leitura em DD/MM / lido) e, só depois da leitura, as taxas, a diferença em pontos, o p e o veredito. A ficha diz "com vídeo (teste A/B)" junto da mensagem e do site.
- **O vídeo sai à mão:** o `wa.me?text=` não anexa mídia. Na fila "Enviar um por um", o lead do braço com vídeo ganha a etiqueta "Com vídeo", o passo "logo depois da mensagem, mande à mão o vídeo de 15 s do demo de <empresa>" e, depois do toque, o botão "Vídeo enviado", lembrado como o toque da fila (`localStorage` `squadone:crm:videos-enviados`, 30 min, só neste navegador, nunca na planilha). Com o vídeo pendente, o cartão não some quando o retrato confirma o envio da mensagem.
- **Gerar os braços de uma lista:** `npx tsx scripts/ab-video-bracos.ts place_ids.txt` (ou pela entrada padrão; um `place_id` por linha) imprime `place_id<TAB>braco_video` na mesma ordem, para colar na coluna. Só calcula.
- **Fora do repo por enquanto:** o pipeline que gera o vídeo de cada demo (o protótipo existe, fora daqui). Nada no SquadOne gera, guarda ou envia vídeo.

## A/B estratificado da 1ª mensagem do Site (14/10/2026)

Pergunta: qual letra da 1ª mensagem (`VARIACOES` em `deploy/dell/claude-ops/site-mensagem.js`) rende mais "respondeu de gente"? Medido até 14/10/2026: 221 envios, A 41 (24% responderam, 3 interesses), B 25 (8%, 0), C 5. A diferença A×B **não está provada** (Fisher p = 0,11) e é **confundida**: a B só é elegível com nota ≥ 4,3 e ≥ 15 avaliações (`fatosDoGoogle`), a C só com o Raio-X no ar (`raioXDe`), e a letra saía de `hash(place_id) % (letras elegíveis)`, sem equilíbrio por nicho (só advocacia, 48 envios, teve amostra nas duas, e lá A 4/24 × B 2/21 é empate). A comparação "A de todo mundo × B de quem tem nota boa" mede a nota, não o texto.

- **O que é balanceado (Balcão, `alocarRodada`, PURA em `site-mensagem.js`):** o estrato é **nicho** (coluna `vertical`, sem caixa, acento nem espaço sobrando; vazio é um estrato só, "sem nicho") **× conjunto de letras elegíveis** ("A", "AB", "AC", "ABC"). A letra de um lead novo é, entre as elegíveis, a que tem **menos** leads já atribuídos naquele estrato (minimização), contando todas as linhas da planilha com letra A/B/C e `ab_elegiveis` válidos que contêm a letra (pronto, enviado, recusado, tudo); `manual`, `EN`, vazio e linha sem `ab_elegiveis` não contam. Empate: o hash antigo do `place_id` entre as empatadas (com o estrato vazio, é exatamente a regra antiga). Os leads da rodada vão em ordem de `place_id` e cada letra nova é somada antes do próximo, para dois leads da mesma rodada não caírem juntos na mesma letra. Um elegível só (só A): A, sem sorteio. EUA: `EN`, fora do teste. Manual continua `manual` (o observador grava). **Demo sob pedido** (mesmo dia): o lead sem demo (`sem_demo`, recibo do Raio-X avulso sem `site_url`) só cabia na C, porque A e B dizem "montei uma demonstração". **Desde 15/10/2026** (decisão do Rômulo: o demo é feito se o lead responder), a A também cabe sem demo: o conjunto é `AC` com raio-x e `A` sem ele, inclusive para o lead sem recibo nenhum (gerador que falhou, fila antiga), que o Balcão agora também marca `pronto`. A B continua só com demo. Nos EUA, sem demo, não há mensagem (`alocarVariante` devolve null) e o lead segue a fila do gerador. Quando o demo sai antes do envio, o conjunto muda (A/AC → AB/ABC) e ele é sorteado de novo; depois do envio, nada muda. **Textos revistos em 15/10/2026** (B e C sem "do PRUMO", como a A; o mesmo pedido no fim): a B e a C de antes e de depois dessa data são textos diferentes com a mesma letra, então o A × B que conta é o de leads enviados a partir de 15/10. **Textos humanizados em 19/10/2026** (pedido do Rômulo, depois de ver o primeiro contato do time comercial, que manda este mesmo texto): a A fica como ele ditou (é o controle); a B e a C ficaram mais soltas, sem "por conta própria" nem argumento de venda, e fecham com "Quer que eu te mande…? Sem compromisso.". Agora o corte é do código: `TEXTO_DESDE` em `ab-mensagem.ts` (B e C desde a meia-noite de SP de 20/10, porque o Balcão remonta o `wa_link` dos `pronto` de hora em hora) e o par só conta envios a partir do mais recente das duas letras, a A inclusive, para comparar o mesmo período.
- **Coluna `ab_elegiveis` (aba Leads, no fim, pelo `COLUNAS_NOVAS`/`--colunas` de `site-antes-da-venda.py`):** as letras elegíveis no momento do sorteio, ordenadas. Gravada na **mesma** escrita que `mensagem_variante`, enquanto o lead está `pronto`; vazia nos EUA e sem telefone. É ela que diz com quem a letra pode ser comparada.
- **Congelamento:** a letra salva fica enquanto o `ab_elegiveis` salvo for **igual** ao conjunto de agora e contiver a letra. Sorteia de novo (no estrato novo, sem contar a própria letra antiga) quando: a linha não tem conjunto (vazia, ou letra do sorteio antigo pelo hash, sem `ab_elegiveis`: na primeira rodada do Balcão novo os `pronto` antigos são sorteados de novo, o que é inofensivo porque ainda não saíram); o conjunto mudou porque o Raio-X chegou depois (AB → ABC: a troca para C continua possível, agora pela contagem); ou porque o Raio-X sumiu (ABC → AB: a C deixa de caber). A nota e as avaliações não mudam depois do Caçador, então na prática só o Raio-X muda o conjunto. O Balcão só reescreve `mensagem_variante`/`ab_elegiveis` de lead `pronto` (ou novo virando pronto): **o que já foi enviado nunca muda**, nem a letra nem o conjunto.
- **Regra de comparação (CRM, `src/operations/ab-mensagem.ts`, bloco "A × B (mesmo sorteio, por nicho)" em Resultados, logo depois de "Por mensagem"):** só leads do Site **enviados** com `ab_elegiveis`; a letra X só é comparada com a Y entre leads cujo conjunto contém **as duas** e que receberam uma delas (A×B sempre; A×C e B×C quando há envio nos dois braços). Métrica: respondeu de gente (o robô, tipo `bot`, não conta), pela mesma conta de `resultados.ts`. Quebra por nicho para ver; o total do par é que leva o teste (com a letra equilibrada em cada nicho, o total não é confundido pelo nicho). Ignora o período da tela: o teste conta inteiro, a partir do `TEXTO_DESDE` das duas letras (texto trocado recomeça a contagem). `server/crm.ts` lê a coluna como `abordagem.elegiveis` (`elegiveisDaColuna`); não é coluna esperada, então ausente não vira aviso.
- **Regra dos 30 e veredito (as mesmas de honestidade do vídeo):** com menos de **30 envios em algum braço**, a tela mostra só "N de 30 enviados" e "faltam N envios" — a taxa, as respostas, o p e o veredito nem são calculados (sem espiar). Com 30+ nos dois: taxas, diferença em pontos, Fisher exato bilateral (`fisherExato` de `ab-video.ts`) e veredito: "mensagem X ganhou" só com **+20 pontos E p < 0,10** (`DIFERENCA_MINIMA_PP`, `P_MAXIMO`); qualquer outra coisa é "não provado". O placar "Por mensagem" segue igual, com o aviso de amostra pequena abaixo de 10.
- **Fora do teste:** o histórico — os 150 envios sem letra (até 07/10/2026) e os sorteados só pelo hash (07/10 a 14/10/2026), que não têm `ab_elegiveis` — e a letra trocada para `manual`; a tela diz quantos e "só vale para envios sorteados desde <data do primeiro envio com a coluna>". O aviso do n8n **05 · Acompanhamento** (follow-up do 3º dia) não é sorteado nem entra: o teste é da 1ª mensagem (quem respondeu depois do follow-up ainda conta como resposta, igual nos dois braços).
- **Instalar:** `python3 site-antes-da-venda.py --balcao` no Dell (cria a coluna e publica o Balcão); ver `deploy/dell/README.md`.

## Avaliação de turno (desligada)

`POST /api/turnos/:turnoId/avaliacao {nota 1–5, motivos[≤3], comentario?}` guarda a opinião do usuário sobre um turno que **este processo** acabou de devolver: com `SQUADONE_AVALIACOES=true`, `/api/orquestrar` devolve `turno_id` e guarda um resumo sem dados pessoais num cache em memória (30 min, 100 turnos). Grava em `data/avaliacoes-turno.json`, fora do roster e do prompt: a nota não treina nada sozinha. Nenhum componente da UI chama a rota ainda. Desligada é o padrão, e é o que mantém a persistência de produção só em `squad.json` + `google-auth.json`.

## Luna em modo sombra (desligada por padrão; ligada na Mel, sem tráfego)

**Estado real em 19/10/2026:** segundo a auditoria (não conferível pelo repositório), `SQUADONE_LUNA_SOMBRA=true` está no `operations.env` da Mel, mas desde que o Assistente substituiu o Pedir no
`operations` a mesma auditoria não achou tráfego novo: só uma demanda mandada pelo Telegram chegaria a `rodarDemanda`, que é onde a sombra observa. Desligar ou apontar
a sombra para o Assistente é decisão do Rômulo (`docs/auditoria-de-fluxos-2026-10-19.md`). **Não é motor:** a Luna que decide algo é outra coisa, o
`luna-workflows.service` (`deploy/dell/claude-ops/luna_workflows.py`), que desde 18/10/2026 classifica o Caçador do Site e responde a Fonte do
PRUMO para o n8n (autorizado pelo Rômulo depois dos erros 503 do Gemini; só dois contratos fixos, sem ferramenta de escrita; ver
`deploy/dell/README.md`, "Luna nos workflows do Caçador"). A sombra mede, o `luna-workflows` opera: a regra "medição, nunca motor" vale só para a primeira.

Medição, não motor (ARCHITECTURE "Luna em modo sombra"; ligar e ler em `deploy/dell/README.md`, "Luna em sombra"). Com `SQUADONE_LUNA_SOMBRA=true`, só no `operations` com a agenda, cada turno real do Gemini chama `aoTerminarTurno` (`PedidoDeTurno`) com o `systemInstruction` usado e as `functionCalls` cruas; `rodarDemanda` devolve o `TurnoResult` e, **sem `await`**, chama `sombra.observar(...)`. A sombra (`server/luna-sombra.ts`) roda a Luna (`gpt-6-luna`) pelo `codex exec` com o **mesmo** prompt e a mesma demanda, pede só `{"chamadas":[{"nome","args"}]}`, **não executa nada**, compara com o Gemini (`compararChamadas`: `igual` | `parcial` | `diferente` — mesmo nome, `responsavel_id`, `tipo`, datas, duração/esforço em ±25 %, `squad_id` de troca) e grava uma linha em `SQUADONE_DATA_DIR/luna-sombra/<AAAA-MM>.jsonl` (600; sem a demanda em claro a não ser com `SQUADONE_LUNA_GUARDAR_DEMANDA=true`; as chamadas só com os campos comparados, nunca título ou notas).

- Fila serial própria, teto diário (`SQUADONE_LUNA_TETO_DIA`, 10, zera à meia-noite de São Paulo e conta as linhas de hoje ao subir), timeout 120 s com `kill`, sem retry. Erro de cota do `codex` = log uma vez e parada até o dia seguinte.
- `execFile` sem shell, prompt por **stdin**, `--model gpt-6-luna --sandbox read-only --skip-git-repo-check --output-last-message <arquivo no cwd>`, `cwd` = `luna-sombra/cwd` (vazio, 700). No boot confere `codex exec --help` contra cada flag usada e desliga com log se faltar uma: o binário do Dell não foi conferido pelo PC.
- Não conta em `turnosEmAndamento`; falha nunca afeta o turno nem o Telegram; nunca realimenta o Gemini. Só turnos de texto (a transcrição de áudio já é texto); "gastei …" não é turno e nada de finanças chega ao prompt (RULES 24). Com redirecionamento de squad são **dois** turnos do Gemini e duas observações.
- Resumo: `npx tsx scripts/luna-sombra-resumo.ts ~/.local/share/squadone/luna-sombra` (só lê).

## Jev em sombra (desligado por padrão; ligado na Mel, sem tráfego)

**Estado real em 19/10/2026:** como a Luna, segundo a auditoria `SQUADONE_JEV_SOMBRA=true` está ligado na Mel (`jev.env` + `operations.env`) e sem tráfego novo desde
que o Assistente substituiu o Pedir; a fase 3 do Assistente (o Jev medindo a intenção) segue pendente. Decisão do Rômulo (desligar ou apontar).

Medição, não motor (RULES 27; ligar e ler em `deploy/dell/README.md`, "Jev em sombra"). O Jev (`typesafe/jev-1.13`, da TypeSafe, servido pela OpenRouter em `POST /api/alpha/decisions`) não gera texto: recebe um `state` e perguntas e devolve probabilidades. Com `SQUADONE_JEV_SOMBRA=true` e a `OPENROUTER_API_KEY` no `~/.config/squadone/jev.env`, só no `operations` com a agenda, `rodarDemanda` devolve o `TurnoResult` e, **sem `await`**, chama `jev.observarDemanda(...)` **uma vez por demanda** (com redirecionamento são dois turnos do Gemini e uma observação, com as chamadas do último). `server/jev-sombra.ts` pergunta ao Jev:

| Pergunta | Tipo | Opções | Comparada com |
|---|---|---|---|
| `squad` | choice | squads ativas (rótulo = id, descrição = nome + escopo) | a squad onde o turno terminou (a de destino, com redirecionamento) |
| `dominio` | choice | salas ativas da squad final | o domínio do `responsavel_id` da primeira `agendar_evento`/`criar_tarefa` |
| `natureza` | choice | `agenda` \| `tarefa` | `agendar_evento` → agenda; só `criar_tarefa` → tarefa |
| `pede_contratacao` | noul | — | `criar_po_dominio` ou `contratar_integrante` no turno (corte em 0,5) |

- **Ordem das opções embaralhada** a cada chamada e gravada (`ordem`), para medir o viés da primeira opção. `squad`/`dominio` só entram com duas opções ou mais. A pergunta de domínio é condicionada à squad final (não é cega à squad do Gemini); a de squad é.
- **Finanças nunca vão** (RULES 24 e 27): demanda que parece finanças (`gastei …`, `R$`, fatura, saldo, orçamento, boleto, pix, parcela… e, desde 15/10/2026, salário, dívida, imposto, DARF, IRPF, IPTU, IPVA, INSS, FGTS, dinheiro, juros, financiamento, rendimento, mensalidade, CDB, Selic; "conta", "cartão" e "transferência" sozinhos continuam passando por serem ambíguos) ou cuja sala no Gemini é a de finanças **ou a sala Contas** (`pessoal--contas`: boletos, assinaturas, vencimentos; decisão do Rômulo em 15/10/2026, o nome casa com `/finan|\bcontas\b/`) nem sai do processo — vira linha `{"pulada":"financas"}`, fora dos tetos. Sala de finanças entra nas opções só pelo nome; valor em dinheiro sai de qualquer escopo. Conservador de propósito: uma medição perdida custa nada.
- **Máscara antes de qualquer envio** (`mascararParaJev`, em `server/openrouter-decisoes.ts`, aplicada no `montarPedido` e no `state` da sombra): telefones BR → `[TEL]`, e-mails → `[EMAIL]`, CPF/CNPJ → `[DOC]`, URL com caminho/query → `[URL]`, chaves, tokens, `Bearer`, `senha: …` e hex longo → `[SEGREDO]`.
- **Retenção:** todo pedido leva `provider: { data_collection: "deny", zdr: true }` (`SQUADONE_JEV_ZDR=false` tira o `zdr`, só para teste). O endpoint `typesafe/jev-1.13` está na lista ZDR da OpenRouter (`https://openrouter.ai/api/v1/endpoints/zdr`, conferida em 11/10/2026), mas **ZDR é a classificação da OpenRouter**: a TypeSafe não publica prazo de retenção, a resposta não prova retenção zero, e o processamento é **nos EUA**. A squad Pay4Fun foi liberada pelo Rômulo para este terceiro (11/10/2026). **Respostas de leads** só foram aprovadas por ele (11/10/2026) em sombra, com recorte e máscara, pelo n8n (seção abaixo), nunca por este caminho.
- **Transporte** (`server/openrouter-decisoes.ts`): `questions` é um OBJETO indexado pelo nome (array dá 400); só `noul` e `choice` (o `score` não foi testado e nada depende dele); a resposta é **dado**: escolha fora dos rótulos enviados, probabilidade fora de 0..1, sem `usage.cost` numérico ou `model` sem data = `respostaInvalida`. Erros classificados (`ErroDeJev.motivo`): `credencial` (401/403) e `semCredito` (402) **desligam o Jev até reiniciar** com log uma vez; `pedidoInvalido` (400/413: contrato do schema alpha), `limite` (429), `indisponivel` (5xx, 524, 529, timeout, rede), `respostaInvalida`. Timeout por `AbortController` (`SQUADONE_JEV_TIMEOUT_MS`, 5 s), **sem retry**. A chave, os cabeçalhos e o corpo nunca entram em erro, log ou JSONL.
- **Tetos:** `SQUADONE_JEV_TETO_DIA` (50 chamadas por dia de São Paulo, contando as linhas de hoje ao subir; conta a tentativa, não o sucesso) e `SQUADONE_JEV_TETO_USD` (US$ 1 no TOTAL: a soma de `cost` de todos os JSONL do Jev, lida no boot e somada a cada resposta; atingido, a sombra para até mudar a env e reiniciar). Custo medido ~US$ 0,00001–0,00003 por chamada; saldo da conta em 11/10/2026 ~US$ 4,06.
- **Registro:** `SQUADONE_DATA_DIR/jev-sombra/<AAAA-MM>.jsonl` (600, pasta 700), uma linha por demanda: `quando`, `modeloPedido`, `modeloRespondeu`, `modo`, `hashDaDemanda` (sha256), `tamanhoDaDemanda`, `squadExplicita` (`pedido.squadId !== undefined`), `squadInicial`, `squadFinal`, `redirecionado`, `ordem`, `respostas` compactas (`c`, `p`, `conf`, `probs`), `gemini` (resumo: squad, domínio, natureza, tipo, crescimento, troca sugerida), `comparacao` por pergunta (`jev`, `p`, `gemini`, `concorda`), `input_tokens`, `output_tokens`, `cost`, `latenciaMs` e `falha?` (`motivo`, `status`). A demanda (já mascarada) só com `SQUADONE_JEV_GUARDAR_DEMANDA=true`, **ligado na Mel desde 15/10/2026** (decisão do Rômulo, para adjudicar as divergências; as 6 linhas anteriores ficaram só com hash). Mascarar não é anonimizar: é texto pessoal em arquivo 600 que não sai da Mel, e finanças nunca chegam a ele. Nada vai a aviso, Telegram ou `status.json`.
- Fila serial própria; não conta em `turnosEmAndamento`; falha nunca afeta o turno nem o Telegram; nada realimenta o Gemini, o roster ou a UI. Nunca no Easypanel: `prepararJevSombra` devolve null fora do `operations` com a agenda.
- Resumo: `npx tsx scripts/jev-sombra-resumo.ts ~/.local/share/squadone/jev-sombra` (só lê): falhas, concordância por pergunta, discordâncias com p ≥ 0,90, % de redirecionamentos, latência p50/p95, custo acumulado, viés de ordem e os critérios abaixo. Desde 15/10/2026 também separa a concordância de **domínio só onde a squad concordou** (a pergunta de sala usa as salas da squad final do Gemini, então comparar sala com squad diferente não mede nada) e mostra o **ganho líquido de squad**: redirecionamentos que o Jev antecipou menos erros que ele induziria (turno sem redirecionamento em que apontou outra squad). Com `trocaSugerida` (o Gemini ainda achava a squad errada no teto de um salto), squad e domínio gravam `concorda: null`: o gabarito não vale. A demanda é mascarada **antes** de cortar em 2000 caracteres, para um telefone na fronteira não vazar pela metade.

**Critérios de promoção (para o futuro; promover é decisão do Rômulo).** O roteamento de squad só pode sair da sombra com **100 demandas reais, entre elas 15 redirecionamentos**, e ao mesmo tempo: concordância com o Gemini **≥ 97 %**, **zero** discordância com p ≥ 0,90, **p95 < 1,5 s**, falhas **< 2 %** e redirecionamento **≥ 10 %** das demandas (sem isso a amostra não exercita o caso difícil). Em 11/10/2026, no teste à mão, `noul` e `natureza` foram bons em português, mas o roteamento de squad variou ±0,06 entre chamadas iguais e errou um caso: por isso só mede.

## Jev em sombra nas respostas de lead (11/10/2026; código pronto, nada aplicado no n8n)

Medição, não motor, como a Luna: o Jev (`typesafe/jev-1.13`, TypeSafe, pela Decisions API da OpenRouter) classifica em paralelo as respostas de lead por WhatsApp que o Gemini já classifica no fluxo "WhatsApp — resposta de lead" (`deploy/dell/claude-ops/whatsapp-conversa.py`), e o resultado só vai para a Data Table `jev_sombra_respostas` do n8n da Mel. Nunca muda a saída de "Decidir pela resposta", a planilha, o aviso nem a resposta ao observador; toda falha dele termina sem registro. Detalhes, tabela da máscara e comandos em `deploy/dell/README.md`, "Jev em sombra nas respostas". O ramo só entra no fluxo quando existe a credencial "OpenRouter Jev" no n8n e alguém republica; até lá **nada disto está aplicado**. É independente do Jev das demandas (seção acima): outra chave (dedicada ao n8n da Mel, com limite de crédito próprio, nunca o `jev.env` do servidor), outra máscara (`mascarar` em JS dentro do nó Code, porque o n8n não importa `server/openrouter-decisoes.ts`; ela também troca nome do lead e da empresa e pega URL sem caminho) e outro registro (a Data Table, não o JSONL).

- **Vai ao Jev:** só o texto da **última** resposta do lead, mascarado antes do envio e cortado em 600 caracteres, mais as perguntas fixas (`questions` como objeto) e `provider {zdr: true, data_collection: "deny"}`. **Não vai:** histórico, cabeçalho e prompt do Gemini, nome do lead, nome da empresa, telefone, chave, chat id, `place_id`/`ID`.
- **Máscara:** telefone BR (com e sem +55, com e sem DDD, 8 e 9 dígitos, com espaços/pontos/traços/parênteses) → `[TEL]`; e-mail → `[EMAIL]`; CPF e CNPJ com e sem pontuação → `[DOC]`; URL → `[URL]`; chave/token/senha (`sk-...`, `AIza...`, `ghp_...`, `Bearer ...`, hex/base64 longos) → `[SEGREDO]`; nome do lead e da empresa, quando a linha da planilha os tem, sem diferenciar maiúsculas e acentos → `[NOME]`/`[EMPRESA]`. Texto vazio ou só rótulos depois da máscara: o Jev não é chamado.
- **Mascarar não é anonimizar:** nome próprio fora da planilha, endereço e contexto passam; continua sendo dado pessoal de terceiro, processado nos EUA (transferência internacional, LGPD). A tabela guarda o lead só como sha256 com sal fixo (pseudônimo, não anônimo: por isso não sai da Mel); o vínculo lead ↔ resultado se refaz só do lado do usuário (`jev-respostas-resumo.py --revisar`/`--hash`).
- **Risco aceito:** endpoint na lista ZDR da OpenRouter e a TypeSafe diz que não treina com os prompts, mas não há DPA nem prazo de retenção publicado. Antes de sair da sombra: pedir a `privacy@typesafe.ai` DPA, subprocessadores, prazo de retenção e ZDR Enterprise.
- **Regra de promoção** (`jev-respostas-resumo.py`, só lê): ≥ 60 **leads** com resposta revista por humano (desde 15/10/2026 conta lead, não linha: a tabela tem uma linha por execução, e fica a mais recente de cada lead), concordância do Jev com a revisão ≥ 95 % e nenhum "interesse" (do Gemini ou da revisão, em qualquer linha) que o Jev tenha chamado de negativa ou exclusão. Passar na regra não basta sem o DPA.
- **Revisão em ordem de utilidade** (`--revisar`, 15/10/2026): perigosas (Gemini viu interesse, Jev chamou de negativa/exclusão), depois divergências, depois concordâncias com confiança < 0,5, depois o resto; avisa lead com várias linhas. Revisar só as divergências deixa a concordância medida abaixo da real (estimativa conservadora). O trecho vem do `crm.json` das fontes `prumo`, `iris` e `estampa`; resposta de **bot** nunca tem trecho (o fluxo grava vazio de propósito, para não sujar a coluna "Resposta" do CRM) e uma resposta posterior do mesmo lead sobrescreve a anterior na planilha: nesses casos, confira no WhatsApp.
- **Descrições dos tipos reescritas (15/10/2026, no repositório; só valem quando o fluxo for republicado):** `pedidoJev` agora usa os mesmos exemplos do prompt do Gemini. As 40 linhas gravadas antes da republicação usaram a redação antiga ("neutra: só agradecimento ou comentário" levou "Sim, achei bem legal" a neutra); não misture as duas redações numa mesma taxa sem separar. Ficaram de fora, por exigirem coluna nova na Data Table e `contexto_v`: a ordem embaralhada e gravada das opções, e o contexto fixo (o que foi enviado, variante A/B/C, balde de tempo desde o envio).
- **Desligar:** desativar o nó "Jev: classificar (sombra)" no editor, ou republicar com `--sem-jev`, ou apagar a credencial e republicar; revogar a chave na OpenRouter corta na hora.

## Copiloto do PRUMO (15/10/2026; fase 1 em sombra, desligado)

Funil real em 15/10/2026: 221 envios, 5 interesses, 0 propostas. O gargalo é do interesse até a proposta (regra: proposta em até 24 h depois de cada "gostei"). Decisão da conversa com o Rômulo: **canal × cérebro**. O Hermes segue como secretário e ponte do WhatsApp (só lê e avisa); o cérebro da venda mora no SquadOne, com o provedor trocável (o ChatGPT pelo codex hoje, o Gemini, ou outro amanhã).

> **Desde 17/10/2026 (fase 2 do Assistente) a sugestão não mora mais na Ficha.** A aba Copiloto e `CrmCopiloto.vue` saíram; a sugestão aparece no cartão "Sugestão do copiloto" do painel do Assistente (`casca/AssistenteSugestao.vue`, aberto pelo "Perguntar sobre este lead" em "Como vender"), com os mesmos Copiar e a mesma medição. A Ficha só **lê** a guardada (`GET /crm/copiloto/sugestao`) para a proposta de um toque e o "Agora"; o Assistente também só lê (`copiloto.ler`), então quem gera é o automático (abaixo). O "Pedir sugestão" e o "Gerar de novo" descritos aqui eram da aba; o `POST /crm/copiloto/sugestao` segue no servidor, sem botão na tela.

- **O que faz:** na Ficha de um lead nos passos **Respondeu, Viu o Raio-X, Conversa, Mapa respondido ou Proposta** (`PASSOS_DO_COPILOTO`, de `jornada.ts`), o bloco **"Sugestão do copiloto"** (`CrmCopiloto.vue`, antes da Colinha, até 17/10/2026) tinha "Pedir sugestão". Volta a **próxima mensagem** (botão Copiar), **o que oferecer e por quê** e o **rascunho dos itens da proposta** (botão Copiar o rascunho, no formato da proposta-modelo do prumo). **Nunca envia nada**: o envio continua à mão pelo WhatsApp, e copiar não marca envio.
- **Pedido, e desde 16/10/2026 também automático** só para quem está com a vez (ver "O copiloto sozinho" abaixo): gerar para todo lead a cada retrato seria gasto. A sugestão fica **guardada pelo hash do dossiê** (relida do JSONL do mês quando a Central reinicia); lead sem mudança devolve a mesma, "Gerar de novo" força. Uma geração por lead de cada vez (clique duplo).
- **O dossiê** (`montarDossie`, PURO em `src/operations/copiloto.ts`): empresa, nicho, cidade, funil (o Plus pelo da oferta), etapa e dias no passo; passo, próximo passo e oferta (agora, depois, **não oferecer**, a confirmar) de `jornada.ts`; a última resposta classificada; os 12 últimos eventos com as **notas da Ficha**; objeções reconhecidas com a resposta pronta da colinha; o **texto do Raio-X** (`raio-x.html` sem tags, até 4000 caracteres: Site na pasta do lead em `~/auto-site/<lugar>/<slug>/`, PRUMO e o avulso em `~/prumo-entregas/prumo-raio-x/<slug>.html`); o cardápio com o preço **como se diz ao cliente** ("sob proposta"). Iris e estamparias levam só as ofertas próprias. **Telefone, e-mail e wa.me saem** de tudo antes do prompt.
- **Limite da fase 1 (superado em 16/10/2026):** o observador não guardava a conversa, e o dossiê tinha só o trecho classificado e as notas da Ficha. Desde 16/10 ele guarda (as duas direções), e o dossiê leva as 20 últimas mensagens, mascaradas.
- **A saída é dado** (`lerSaidaDoCopiloto`): só JSON `{mensagem, porque, ofertas[{id,porque}], proposta{itens[{id,porque}], observacao}, falta_saber[]}`. **Recusa** (vira falha 502 classificada, não fica guardada): vazio, não-JSON, fora do formato, id fora do cardápio e das ofertas próprias, e **preço proibido na mensagem**: só passam os "R$" dos serviços com preço aberto (Encontrado, Anúncios, Redes: `PRECOS_ABERTOS`); Respondido, Fonte e Fonte em dia nunca (sob proposta, 08/10/2026), nem com "reais" por extenso. **Avisos** (a sugestão passa, a Ficha mostra "Confira antes de mandar"): oferta que a jornada manda não oferecer, oferta própria × cardápio trocados, Raio-X/Mapa na proposta (saem: são grátis), e **número da mensagem que não está no dossiê** (a regra "sem inventar fato"). Os preços do rascunho da proposta saem de `colinha.ts`, nunca do modelo.
- **Provedor** (`ProvedorDoCopiloto`, `server/copiloto.ts`): `codex` (padrão: o ChatGPT pelo login do Codex no Dell, como a Luna: `execFile` sem shell, prompt por stdin, ambiente limpo, `--sandbox read-only`, resposta por arquivo em `copiloto/cwd`, `codex exec --help` conferido no boot; sem `SQUADONE_COPILOTO_MODELO`, o modelo padrão da conta) ou `gemini` (o cliente do servidor, `responseMimeType: application/json`, com o retry e os modelos reserva do `gerarComRetry`). O que vai ao provedor: o dossiê acima (nome da empresa e o que o lead escreveu, sem telefone): para o codex, é a OpenAI; para o Gemini, o Google (que já classifica a resposta no n8n).
- **Env:** `SQUADONE_COPILOTO=true` liga (padrão desligado); `SQUADONE_COPILOTO_PROVEDOR` = `codex` | `gemini`; `SQUADONE_COPILOTO_TETO_DIA` (20, conta a tentativa, zera à meia-noite de São Paulo, sobrevive a reinício); `SQUADONE_COPILOTO_MODELO` (opcional); `SQUADONE_CODEX_BIN` (o mesmo da Luna). Valor ilegível = log de erro e desligado. **Só no `operations`** com o CRM configurado; no Easypanel a env é ignorada com log. Nada de finanças pessoais (RULES 24): o CRM não tem nenhuma.
- **Rotas** (`server/operations.ts`): `GET /api/operations/crm/copiloto` (`{ligado:false}` ou estado com uso do dia; a Ficha escondia o bloco desligado, até 17/10/2026), `GET /crm/copiloto/sugestao?produto&id` (a guardada, sem chamar o modelo), `POST /crm/copiloto/sugestao {produto,id,forcar?}` (404 lead fora do CRM, 409 passo sem copiloto, 429 teto, 502 `falha:{motivo,detalhe}`), `POST /crm/copiloto/copiou {produto,id,hash,oQue}`. O lead sai da visão do CRM no servidor, nunca do corpo do pedido.
- **Medição:** `<SQUADONE_OPERATIONS_DATA_DIR>/copiloto/<AAAA-MM>.jsonl` (600, pasta 700): `{tipo:"sugestao", quando, lead "produto:id", passo, provedor, hashDoDossie, duracaoMs, sugestao|falha, avisos}` e `{tipo:"copiou", quando, lead, hashDoDossie, oQue}`. Daqui a 30 dias responde quantas sugestões o Rômulo usou e se o tempo do "gostei" até a proposta caiu. Sair da sombra (gerar sozinho, mandar pelo WhatsApp) é decisão do Rômulo.
- **Sinais do site no dossiê** (17/10/2026): o dossiê ganha `sinaisDoSite` (`sinaisParaODossie` em `src/operations/copiloto.ts`) só com os sinais de `server/sinais-do-site.ts` que têm fonte (`true`/`false`; `null` some), cada um como observação checável e cautelosa (`{ sinal, observacao, serveParaAbrir }`): tag do Google Ads ou pixel do Meta "instalado" nunca vira gasto; "não achei" não prova ausência; a agência (`temAgencia === true`, nome limpo, sem telefone) é só contexto e nunca abre a mensagem. O prompt só ganha as regras (`REGRAS_DOS_SINAIS`: UMA observação específica na primeira linha, nunca mais de uma, sem tom de auditoria, nunca inventar sinal) quando o dossiê traz sinais. Sem sinal com fonte a chave não existe: dossiê, prompt e **hash idênticos aos de antes** (nenhuma sugestão guardada é invalidada); com sinal novo o hash muda e a sugestão é gerada de novo (conta no teto). O gate de pré-envio e as travas de R$, id e número fora do dossiê seguem iguais. **Nenhum modelo de mensagem mudou** (`site-mensagem.*`, `prumo-mensagem.ts`, `plus-mensagem.ts`): a 1ª mensagem A/B/C é um experimento (a letra não pode mudar o texto no meio) e o Balcão envia antes de qualquer leitura de sinal; o copiloto só cobre a conversa já aberta.
- **Ligar na Mel:** `SQUADONE_COPILOTO=true` no ambiente do serviço da Central e reiniciar; o log do boot diz `[copiloto] ligado: …` ou o motivo de não ligar.

## Próxima venda e o vendedor do Telegram (16/10/2026)

> **O que mudou em 19/10/2026 (auditoria dos fluxos, `docs/auditoria-de-fluxos-2026-10-19.md`). Onde este texto fala de "Próxima venda", "A fazer" ou
> "Números", leia com isto por cima.**
> - **`ProximaVenda.vue` saiu**, e com ele `plano-do-dia.ts`, `fila-de-envio.ts` e `anotacao-de-envio.ts`. A fila de venda
>   (`proxima-venda.ts`, PURA) continua sendo a única, mas ninguém a desenha como cartão: ela alimenta a Ficha (o "Agora", via
>   `acaoDoLead`), o "Envie para X" do Telegram e a lista **"Conversas para você"** (`conversas-para-conduzir.ts`, `conversasParaVoce`).
> - **Os nomes das abas são `NOME_DAS_ABAS`** (`vendas-abas.ts`; os ids e os endereços não mudaram): **Conversas para você** (id
>   `afazer`, `/crm`), **Primeiros contatos** (id `triagem`, `/crm?ver=triagem`: o painel do time comercial em cima e a Triagem
>   embaixo) e **Entender** com Funil, **Diagnóstico** (id `numeros`) e Resultados. Os textos que mandavam o Rômulo para "A fazer",
>   "Triagem" e "Números" apontavam para abas que não existem mais com esses nomes.
> - **"Conversas para você" é a fila inteira de quem já foi contatado:** a conversa guardada e o combinado (como antes) mais, vindos da
>   fila de venda, o follow-up do 3º dia, o "o que achou?" 20–72 h depois do link, a proposta sem retorno, a recusa a marcar e a
>   proposta a mandar (`DO_PASSO`). Primeiro contato não entra (é do time comercial e do Telegram). É a mesma lista na aba e no "Sua vez"
>   da Central; o "Enviei"/"Pular" do dia (`GET /crm/venda`, `resolvidas`) tira o passo dela.
> - **Abrir o WhatsApp nunca registra envio** (regra `[abrir-nao-envia]`): o link é um `<a>` comum. Quem grava é o botão explícito na
>   missão da conversa (`MissaoDaConversa.vue`): **"Enviei"** (ou "Enviei a proposta") anota na aba CRM quando o passo tem o que
>   anotar (`POST /crm/venda/anotar`, uma vez por ação no dia) e resolve a ação (`POST /crm/venda { chave, como }`), o que fecha o aviso
>   aberto no Telegram; **"Marcar a recusa"** anota o desfecho; **"Pular por hoje"** manda o passo para o fim. O envio também é marcado
>   pelo observador do WhatsApp quando a mensagem aparece na conversa. O fluxo 04 do n8n se chama "04 · Clique no wa_link (registra o
>   clique)": só grava `clique_em`.
> - **Follow-up e Perdido têm um dono só, a Central** (`server/crm.ts`): o follow-up vale do 3º ao 6º dia depois do envio, só para
>   quem leu; 7 dias sem mensagem é Perdido (`DIAS_SEM_RESPOSTA`). O n8n **05 · Acompanhamento só expira, no 7º dia** (era o 10º, e a
>   planilha e o CRM se desencontravam) e não marca nem avisa follow-up.
> - **A Ficha de um lead Novo** mostra o botão de primeiro contato com as travas de horário e ritmo (`primeiro-da-ficha.ts`); o
>   convite aberto e não confirmado pelo servidor vale no ritmo só naquele aparelho, e a tela diz isso.
> - **O vendedor do Telegram** (`server/vendedor.ts`) usa a regra da Central de quem faz o primeiro contato (`primeirosDoTime`): com o
>   time pausado ou sem fila, o lead novo volta a ser avisado ao Rômulo. O teto de 40 conta só os avisos que de fato saíram
>   (`avisosHoje`; o que a Central resolveu e o barrado pelo gate não contam) e o "quero ver" quente passa por cima dele. Só espera o
>   copiloto por 4 min quando a última mensagem da conversa é do lead (`COM_COPILOTO` é só `responder`); nos outros passos o copiloto
>   nunca responde, e esperar era à toa. O `vendedor.json` não guarda mais os primeiros contatos (a fonte é o `venda-do-dia.json`);
>   se o dia do servidor não pode ser lido, a volta é pulada com log (e o toque num aviso responde "Não consegui ler o dia agora");
>   a gravação do estado que falha não reenvia o aviso (fica em `pendentes`) e, em 3 falhas seguidas, o laço para até reiniciar a
>   Central. O arquivo do dia só vira "dia novo" quando não existe (`ENOENT`); outro erro sobe.
> - **Os dois laços de sombra e o vendedor** usam `server/em-serie.ts` (fila de uma tarefa por vez e `anexarJsonl`, JSONL 600 em pasta
>   700) em vez de uma cópia cada um; o dia de São Paulo vem de `server/tempo.ts`.
> - **Visão do CRM com cache de 20 s** (`TTL_DA_VISAO_MS`, `CrmStore.visao()`): copiloto, vendedor, lead quente, abas e Assistente a
>   pediam, cada um, a cada minuto, e cada chamada relia pastas, mapas, Raio-X, Plus e até 3000 conversas. A promessa em voo é
>   compartilhada e toda escrita (`registrar`) descarta o cache. Quem passa `agora` (testes) não usa o cache.
> - **Copiloto automático** (`server/copiloto.ts`): a falha de um dossiê vale só no dia (`{hash, dia}`); cota esgotada pausa o laço por
>   10 min (`PAUSA_POR_COTA_MS`) sem carimbar o lead; teto do dia nem tenta; e a volta de 1 min não relê o Raio-X nem a conversa de quem
>   não mudou (reaproveita o hash por até 15 min, `RELEITURA_DO_DOSSIE_MS`).
> - **Gate de envio:** `server/gate-de-envio.ts` é a fonte única. A cópia em JS que o Balcão do n8n rodava em modo "avisar" só escrevia
>   uma coluna que ninguém lia e saiu; a 1ª mensagem é conferida quando a Central ou o vendedor a oferecem e quando o time pede a reserva.
> - **Preços:** `src/operations-precos.test.ts` falha se o cardápio do Roteiro (`colinha.ts`) divergir de `deploy/dell/prumo-mapa/precos.json`,
>   a fonte única.

> **As outras otimizações do blueprint (16–17/10/2026).** OT-01: "A fazer" é só a Próxima venda (a fila única); a folha "Enviar um
> por um" saiu (o filtro por nicho e o "Vídeo enviado" vieram para a Próxima venda), o Funil virou consulta, e o "Enviei"/"Pular" mora
> no servidor (`server/venda-do-dia.ts`, `GET/POST /api/operations/crm/venda`), dividido com o vendedor do Telegram; o 05 · Acompanhamento
> não avisa mais o follow-up (só grava o `followup_em`). OT-04: o "Agora" da Ficha é a ação da fila para o lead, com a jornada como
> contexto. OT-05: aba Triagem (`?ver=triagem`, lotes de 10). OT-06: registros `recusou`/`recusou_desfeito` (perda manual, como o sem
> contato), "Marcar a recusa" na fila, no Telegram e na Ficha. OT-08: na Hoje só o gargalo; os degraus em Números. OT-10: teste do
> follow-up sem recibo (`ab-recibo.ts`). OT-12: Vendas, Números e Roteiro também na URL. OT-13: a conversa do Plus vale como resposta.
> OT-15: `followupDoTerceiroDia` em `server/crm.ts`, uma regra para todas as ofertas.
>
> **Depois do blueprint (16/10/2026, OT-02 e OT-09).** Uma janela de horário só: `EXPEDIENTE_DE_VENDA` e
> `noExpedienteDeVenda` moraram para `trava-de-horario.ts` (a Próxima venda reexporta) e o `avisoDeHorario` das telas do
> CRM passou a usá-la, então o sábado de manhã e o 17h30–18h deixaram de passar sem "Liberar". A Próxima venda ganhou o
> mesmo "Liberar" por lead (só com o ritmo livre, `podeMandarPrimeiroContato`), e o trecho do Roteiro na Ficha não abre o
> WhatsApp de quem ainda espera a primeira mensagem (`aindaSemPrimeiroContato`). Medida: o vendedor grava cada aviso e o que
> houve com ele (`avisado`, `enviei`, `pulou`, `expirou`, `saiu`, com a espera) em
> `<SQUADONE_OPERATIONS_DATA_DIR>/vendedor-historico.jsonl` (600, poda em 180 dias); `GET /api/operations/crm/vendedor` devolve
> o resumo dos 30 dias, e Números abre com "Depois do sim" (`velocidade.ts`, PURO: do "quero ver" ao link, do link à
> proposta, mediana, quantos em até 2 h e quem espera agora).
>
> **Hierarquia de Vendas (17/10/2026).** Pedido do Rômulo: "o UI de Vendas está complicado, sem hierarquia clara, não sei o
> que fazer e em que ordem". Uma ação principal por tela, na ordem Fazer → Triar → Entender:
> - **Abas** (`vendas-abas.ts`, PURO e testado): A fazer, Triagem e Entender, com Funil, Números e Resultados num segmentado e o
>   botão "Roteiro de venda" (para `/mais?abrir=roteiro`). Os endereços de antes seguem valendo (`?ver=funil|numeros|resultados|
>   triagem`, `?ver=jornada` no Funil com `?passo=`, `?ver=roteiro|colinha` no Mais, `?lead=`). O topo é uma linha de saúde do
>   retrato com o Atualizar; os avisos do retrato ficam em "Avisos (n)", aberto sozinho só quando o retrato falhou; a dica de cada
>   aba foi para o `title`; as ofertas num "Filtros" fechado fora da A fazer.
> - **Próxima venda**: um primário (o que a ação pede; depois do toque no WhatsApp, "Enviei, próxima" no lugar dele) e o "Pular";
>   "Abrir a Ficha", "Vídeo enviado" e reabrir o WhatsApp em "Mais ações" (o rótulo avisa "falta o vídeo"). A conversa, a leitura
>   do copiloto, o "Como", o vídeo e a mensagem pronta numa dobra "Por quê e como", fechada, aberta sozinha quando não há texto
>   pronto. O filtro de nicho numa dobra no fim. "Depois: …" continua à vista.
> - **Travas** (`recado-de-travas.ts`, PURO, sobre as funções de `trava-de-horario.ts` e `trava-de-ritmo.ts`, que não mudaram):
>   um recado só, com o próximo passo ("Fora do expediente: volta segunda às 8h", "Libera às 14:20 (ritmo)", "Teto de hoje (10 de
>   10): volta segunda às 8h", "Pode enviar agora") e o que continua livre. Na Próxima venda, na Triagem e na Ficha
>   (`RecadoDeTravas.vue`, BP-TRAVAS); o "Liberar" é link nele, só quando o horário segura.
> - **Triagem**: abre num botão só, "Triar (N)"; o Convidar da primeira linha que pode é o primário, Dispensar secundário; o
>   "Liberar" é um por lote (lead a lead no servidor, `liberados.ts`, como sempre).
> - **Números**: os três A/B (vídeo, 1ª mensagem, recibo) numa dobra "Experimentos" fechada; o placar do período voltou a ser
>   Resultados (`CrmResultados.vue` com `parte`).

Pedido do Rômulo: "podia ser mais proativo, um aviso 'Envie mensagem para xpto' com tudo já organizado, só pra eu
revisar", "a Hoje não está entregando valor" e "automatize o envio da primeira mensagem, de segunda a sexta, das 8h
às 17h30". Decisão dele no mesmo dia, entre as opções: **semi-automático** (nada sai ao lead sem o toque dele; a
Evolution no mesmo chip do Hermes, que levou restrição em 15/10, ficou de fora) e **a rampa 10/20/30 por dia mantida**.

- **A fila** (`src/operations/proxima-venda.ts`, PURA): uma ação por vez, na ordem responder → mandar a proposta → combinado → "o que
  achou?" (20–72 h depois do link, sem resposta dele) → proposta sem retorno → follow-up → primeiro contato (só com a
  trava de ritmo e o expediente livres, no máximo um na fila). Cada ação traz o porquê (o `detalhe` da Hoje do CRM),
  a tática do momento e a mensagem pronta (o `?text=` do wa.me, ou a primeira mensagem do Balcão).
- **Na tela (histórico: `ProximaVenda.vue` saiu em 19/10/2026, ver o bloco acima):** `ProximaVenda.vue` era a aba "A fazer" de Vendas (até 17/10/2026 era também o primeiro cartão da Hoje do Dell; a Central de comando mostra só uma faixa com o passo da vez). O toque no link anota
  como no CRM (2ª mensagem, follow-up, Plus) e conta o primeiro contato na trava; "Enviei, próxima" e "Pular" vão ao
  servidor (desde OT-01; o localStorage do dia é a reserva). Desde 17/10/2026 o "Enviei, próxima" vira o primário depois do toque.
- **No Telegram** (`server/vendedor.ts`): `SQUADONE_VENDEDOR=true` no `operations` com o bot ligado. A cada minuto, de seg
  a sex das 08:00 às 17:30 (`EXPEDIENTE_DE_VENDA`), manda a próxima ação com "Abrir no WhatsApp com a mensagem" (botão de
  URL), "✓ Enviei" e "Pular" (callback `v:<token>:e|p`) e, com `SQUADONE_ORIGEM_CENTRAL`
  (`https://<máquina>.ts.net:8443`), "Ver a ficha". Um aviso aberto por vez; 30 min sem toque vira pulado; um "quero
  ver" novo fura a espera; teto de 40 avisos/dia (os que saíram; o "quero ver" quente passa por cima). "Enviei" anota no CRM o que o link não marca sozinho e conta o
  primeiro contato na trava pelo `venda-do-dia.json`. Estado em `<SQUADONE_OPERATIONS_DATA_DIR>/vendedor.json` (600).
  Pelo Telegram e não pela fila do Hermes (exceção de 16/10/2026 à RULES 20): precisa de botões e sairia pelo mesmo
  número que fala com os leads.
- **"Mandar a proposta" em um toque** (`src/operations/mandar-proposta.ts`, PURO; 16/10/2026): o diagnóstico mostrou 0
  propostas para 3 "quero ver" atendidos, porque a proposta era um formulário no fim da Ficha e ninguém marcava. Agora, quando
  a última resposta é de interesse **depois do link** (a 2ª mensagem; "gostei", ou o "quanto fica" que o n8n deixa como neutra e a
  colinha reconhece), a Ficha tem o primário **"Mandar a proposta"** e a fila ganha o tipo `mandar-proposta` logo depois do
  "responder" (substitui o "responder" desse lead). Entre o link e a proposta sem esse "gostei" (passos 2ª mensagem, conversa e
  Mapa), o botão fica ao lado, como secundário. O toque abre o wa.me com o texto e anota `proposta` (POST
  `/api/operations/crm/registro`, data de hoje); nada sai sem o toque, e a planilha confirma no retrato (RULES 11). O texto: os
  itens da sugestão **guardada** do copiloto (a Ficha só lê, nunca pede ao modelo) com nome, entrega e preço do cardápio ("a
  partir de" nos serviços sob proposta, sem a `condicao`, que mistura nota interna); sem copiloto ou sem item pago, o texto base da
  colinha (Encontrado; Fonte depois do Mapa; Respondido no resto do PRUMO), cujos colchetes a Ficha pede para completar. Um "R$"
  fora de `PRECOS_DO_CARDAPIO` some com o botão. Iris e estamparias ficam de fora (sem cardápio). A fila e o Telegram usam o texto
  da colinha; o do copiloto só na Ficha.
- **"Por que não está vendendo"** (`por-que-nao-vende.ts`, `PorQueNaoVende.vue`): o funil dos 30 dias em degraus (enviados,
  leram com recibo, responderam, "quero ver", próximo passo, proposta, ganho) contra referências de prospecção por
  mensagem (60/15/30/100/40/25 %), com o degrau mais abaixo marcado (só com 3+ na base) e o que fazer nele.
- **A conversa na Ficha** (`server/conversa-do-lead.ts`): o observador passou a gravar as mensagens dos leads em
  `WHATSAPP_CONVERSAS_DIR` (padrão `~/.local/share/whatsapp-conversas/<chave>.jsonl`); a Ficha mostra a conversa e o
  Hermes lê pelo skill `conversa-do-lead`. Antes, só o trecho classificado chegava ao CRM.
- **Áudio, papel, contexto e "licenca"** (17/10/2026; o caso: um áudio de recusa nunca foi ouvido, e o "Claro, pode
  enviar sim" a "posso mandar o vídeo? Sem compromisso" virou `interesse`). Contrato da linha da conversa:
  `{em, direcao, texto<=2000, origem, id?, papel?}`, com `papel` `recepcao` ("*[Nome]* ...") ou `robo` ("[Atendimento]
  ...", "[Bot ...]"), ausente = gente. Áudio de lead: `"[áudio 27s]"` sem transcrição, `"[áudio 27s] <transcrição>"`
  com (o observador do PRUMO baixa da Evolution e transcreve com o Gemini, até 120 s, 5 MB e 20 por dia de São Paulo).
  O classificador do n8n recebe também as 3 últimas mensagens do Rômulo e as 3 anteriores do lead e ganhou o tipo
  `licenca` (o "sim" foi licença para mandar o material, não interesse; o aviso manda enviar o material igual).
  Regras fixas em "Decidir pela resposta" (`TIPO_FINAL_JS`): lote só de áudio sem transcrição é `neutra` e não
  sobrescreve resposta de gente; lote só de ROBÔ não vira `interesse` nem `licenca` (a recepção, desde a revisão de
  17/10/2026, fica com o modelo: é gente, e rebaixá-la apagava interesse de verdade); `neutra` não apaga
  `negativa`/`exclusao`. No máximo um aviso por áudio: a instância da bridge (só "[áudio]", sem `audio` no registro)
  não manda ao n8n lote só de marcador; a do PRUMO manda a transcrição ou, se ela não sair, o marcador uma vez. O
  Jev em sombra compara a `licenca` do Gemini como `interesse` e registra `tipo_final` ao lado do bruto. Detalhes e
  instalação em `deploy/dell/README.md`, "Observador do número do PRUMO".
- **Consciente da conversa** (16/10/2026, "essa ideia está muito boa, mas ainda não está consciente do que está
  acontecendo"; o caso: a Kulniski disse "pode sim" em 14/10, o link e o preço saíram à mão minutos depois, e dois dias
  depois o cartão dizia "o link ainda não foi mandado" e oferecia a mesma mensagem). Três coisas:
  - **A chave do arquivo é a do número** (`chaveDoNumero`: DDD + 8 últimos dígitos, a regra do observador). Até aqui a
    Central procurava pelo id da planilha e nunca achava: a Ficha e o copiloto trabalhavam sem conversa.
  - **O CRM lê todas as conversas** a cada visão (`lerConversas`, `crm.conversas` na config, padrão a pasta acima) e
    resume cada uma no lead (`lead.conversa`: última mensagem, de quem, trecho; `linkEm`, a última mensagem nossa que
    levou o demo, o site ou o Raio-X). O link visto na conversa vale como a 2ª mensagem, mesmo mandado à mão; o toque em
    "Mandar o link" que não tem mensagem nossa perto (até 30 min depois) não vale, salvo se for de antes da conversa
    guardada ou de menos de 30 min (o observador lê com atraso). Mensagem nossa depois da última dele encerra a vez de
    responder (menos no "quero ver": aí só o link); mensagem dele depois da nossa volta a ser resposta nova, sem o
    limite de 48 h, e cada uma é uma vez nova (`leadId|responder|<instante>`).
  - **A Próxima venda e o aviso mostram a última mensagem** ("Última mensagem: você, há 2 dias: “…”") e, sem conversa
    guardada, pedem para conferir no WhatsApp antes de mandar.
- **O copiloto sozinho** (16/10/2026, "preciso que o Hermes, o Jev ou o Gemini, quem quer que seja, esteja consciente das
  conversas de forma autônoma e sugira as melhores mensagens imediatamente"): quem sugere é o copiloto (o cérebro da venda,
  provedor `codex` ou `gemini`); o Hermes segue só como ponte, e o Jev só mede. Com o copiloto ligado,
  `iniciarCopilotoAutomatico` relê o CRM a cada minuto e, para o lead mais recente cuja vez é do Rômulo (`respostaNova`,
  ou ele escreveu por último) e que ainda não tem sugestão para a conversa de agora, gera uma em segundo plano. Uma
  geração por vez na Central; o teto do dia vale igual; o dossiê que falhou não é tentado de novo até mudar. O dossiê agora
  leva a conversa de verdade e o link do demo (`demo`), e o prompt manda não repetir o que já saiu. `GET
  /api/operations/crm/copiloto/prontas` devolve as sugestões que valem (só lê); a Próxima venda e o vendedor põem a
  mensagem do copiloto no lugar do texto pronto (o texto padrão fica em "Ver o texto padrão da esteira"), sem anotar
  envio sozinha. O vendedor segura o aviso até 4 min (`ESPERA_DO_COPILOTO_MS`) enquanto o copiloto escreve. Nada é
  enviado ao lead: continua semi-automático. `SQUADONE_COPILOTO_AUTOMATICO=false` volta ao só-sob-pedido.
- **Quem está respondendo** (16/10/2026, a Conecta Kids e a Gaius). Três correções do mesmo dia:
  - **Sem conversa, sem sugestão automática**: o automático (e o que a Próxima venda e o Telegram mostram) só vale com
    a conversa guardada e a última mensagem DELE (`conversaDaVez`). Às cegas ele sugeriu "sua última mensagem não
    apareceu para mim" e mandar de novo o Raio-X que já tinha saído com o demo e o preço. Na Ficha, pedir continua livre.
  - **O adaptador lê mensagem de empresa** (`texto_de_empresa` em `evolution-adaptador.py`): menu de botões
    (`buttonsMessage`), texto com assinatura (`templateMessage`), `interactiveMessage` e listas viram texto (corpo,
    "— rodapé" e "[opções: …]"). Antes o observador sabia que "alguém respondeu", nunca o quê.
  - **O copiloto diz quem responde** (`momento`: `decisor` | `recepcao` | `robo` | `nao_sei`, com a leitura e o passo).
    Robô e recepção não decidem: a mensagem desfaz o engano ("não sou paciente") e pede quem coordena; os itens da
    proposta saem e preço vira aviso. A Próxima venda e o Telegram trocam o título ("quem respondeu foi a recepção") e
    o "Como" pelo passo do copiloto; na Ficha, o "Agora" mostra o passo e a leitura dele quando quem respondeu não
    decide (o passo marcado à mão continua valendo).
- **A Baobá: áudio, recepção, licença e vídeo** (17/10/2026, Iris). O lead mandou um áudio; o Rômulo perguntou "posso
  de toda forma mandar o vídeo?"; a recepção respondeu "*[Patricia Adriano]* CLaro, pode enviar sim."; o n8n leu
  "interesse", o cartão disse "disse sim: combine a demonstração", e depois do vídeo seguiu em "responder" (vídeo é mídia,
  não URL). O lado TypeScript (o Python que grava e classifica é outra entrega):
  - **Contrato do JSONL**: a entrada pode trazer `papel: "recepcao" | "robo"`; ausente, o texto decide
    (`papelDaMensagem` em `src/operations/marcadores-da-conversa.ts`: "[" + Atendimento|Bot como palavra inteira até o
    "]" = robô ("[Botafogo]" e "[Botão]" não), "*[Nome]*" de 1 a 80 caracteres no começo = recepção; sem sinal = gente;
    a MESMA regra do observador, com a mesma tabela de casos nos dois testes:
    `deploy/dell/whatsapp-observador/papel-da-mensagem.casos.json`). O áudio vem como "[áudio 27s]" ou "[áudio 27s] transcrição"
    (o antigo "[áudio]" vale); a mídia nossa, como "[vídeo]", "[documento]" ou "[imagem]".
  - **Material é link**: a saída com "[vídeo]", "[documento]" ou "[imagem]" conta como a 2ª mensagem (`saidasDaConversa`),
    então o interesse parado sai da vez de responder e, de 20 h a 72 h depois, entra o "o que achou?".
  - **Robô não é resposta**: `lead.conversa.ultimaEntrada` é a última de gente (lead ou recepção); o robô fica em
    `ultimaEntradaRobo`, não recomeça o prazo de Perdido nem vira "resposta nova". `resultados.ts` (`quemRespondeu`):
    conversa que cobre a resposta e só tem robô não conta como "respondeu"; só a recepção conta como respondeu e, desde
    a revisão de 17/10/2026, o interesse ou a licença dela contam como "quero ver" (o classificador já leu com o papel;
    excluí-la aqui rebaixava interesse de verdade). Recepção com resposta neutra não conta, como qualquer neutra.
  - **`resposta.tipo = "licenca"`**: o "sim" foi permissão para mandar o material. Espera o material como o interesse
    parado ("Mande para X o que ele autorizou", sem preço), depois o "o que achou?". Nas métricas conta igual ao
    interesse (revisão de 17/10/2026): `pedeMaterial` (`marcadores-da-conversa.ts`, reusado por `server/crm.ts`) é a
    regra única de `quisVer`, `enviosAnotados`, "Por que não está vendendo", a velocidade depois do "sim", o `quente` da
    fila (a licença nova fura o aviso aberto do vendedor e entra no "Quero ver" dele), o "Mandar a proposta" depois do
    link e a coluna "interesse" do `funil-aprendizado.py`: até 17/10 o mesmo "pode mandar" era gravado como interesse,
    e o tipo novo não pode encolher contagem nenhuma. A diferença fica só na frase e na tática do cartão.
  - **Nunca "disse sim" com a última mensagem nossa**: a frase vira "Você já respondeu a X; falta …" (fila, Telegram,
    Ficha e a Hoje do servidor). E o "Respondeu ontem" do cartão é a última mensagem de gente, não o marco
    `respondeu` (a primeira resposta, que segue valendo para o funil).
  - **Áudio**: na tela, "áudio não ouvido (27s)" ou "(áudio 27s) transcrição"; no dossiê do copiloto e do Assistente,
    "[áudio de 27s que o sistema não ouviu: o conteúdo é DESCONHECIDO, não suponha que seja interesse]". O dossiê leva
    também o `papel` de cada mensagem do lead.

## Time comercial: o agente que envia o 1º contato (18–19/10/2026; ativo no config, timer parado)

**Estado real em 19/10/2026 (auditoria dos fluxos).** Há dois interruptores e eles estão em desacordo: o `frente-comercial-config.json` diz
`ativo: true` (o Rômulo autorizou em 18/10) e o `frente-comercial.timer` do systemd está parado na Mel (desabilitado em 19/10 às ~09:25, sem ter
enviado nada). Sem o timer o script não roda, então **nada é enviado**. Até aqui a tela dizia "ativo" mesmo assim; agora `GET /crm/frente`
devolve `ultimaRodadaEm` (a hora que o próprio script grava a cada rodada, ou o mtime do `frente-comercial.json`) e `cicloParado` (ativo, no
expediente de venda e sem rodada há mais de 5 min, `CICLO_PARADO_APOS_MS`), e a folha do time diz "ativo, mas o ciclo está parado desde HH:MM" e
lista "Quem envia hoje" (o time comercial, o vendedor do Telegram e o Rômulo, cada um com o que a Central sabe dele). **Ligar o timer, ou pausar pelo config, é decisão do Rômulo**;
este documento não religa nada. A leitura do time é uma só por aba (`src/casca/frente.ts`, `lerFrente`: as chamadas simultâneas viram uma e a
última vale por alguns segundos), usada pela Central e pelo painel.

`deploy/dell/frente-comercial.py` (timer `frente-comercial.timer`, a cada minuto) com três agentes (Diego, Elisa, Carla) que avaliam os
leads e um executor sem modelo que manda o **primeiro contato** pelo número do PRUMO (Evolution, `POST /message/sendText/prumo`). É o
único agente do SquadOne que envia mensagem a lead. Respostas e tudo depois do primeiro contato seguem com o Rômulo.

**Por que as regras abaixo.** Ligado na Mel em 18/10/2026 sem elas, ele escolheu 35 estamparias em `revisar` (passava por cima da
Triagem), tinha ritmo próprio (100/dia, 12/h, 5 min, até 18h) contra o da Central, um dia depois da restrição de 24 h do WhatsApp por
25 envios em 25 min (15/10), e não anotava nada no CRM; a Próxima venda e o Telegram ofereciam os mesmos leads ao Rômulo. Foi parado e
o timer desabilitado em 19/10 às ~09:25, sem ter enviado nada.

- **Elegibilidade** (`elegivel` no .py, `elegivelParaOTime` em `src/operations/primeiro-contato.ts`, a Central confere de novo): só o
  Site em `pronto` (Novo, sem marco, conversa, resposta ou próximo passo), com o link rastreado (`links.enviar`) e a mensagem do Balcão
  (`mensagemPronta`). `revisar` é a Triagem: lá o "Convidar" do Rômulo já é o envio (o convite rastreado), então nenhum lead convidado
  chega ao time sem ter recebido a mensagem. Plus fica fora (saudação própria). PRUMO, Iris e estamparias não têm `pronto`: ficam fora até
  existir uma decisão "Convidar pelo time" gravada no CRM (não existe hoje).
- **Uma regra de ritmo e expediente**: o .py não tem mais ritmo. Cada envio pede `POST /api/operations/crm/frente/reservar { leadId }`;
  a Central decide com `EXPEDIENTE_DE_VENDA` e `REGRAS_DO_RITMO` (`reservaDoTime`), contando o retrato (`marcos.enviado`) e os primeiros do
  dia de todas as superfícies (venda-do-dia.json), confere a mensagem no gate de envio em modo "bloquear" e, podendo, grava o primeiro do
  dia `por: "time"` no mesmo passo da fila (dois pedidos juntos não passam os dois). As telas e o Telegram passam a contar o do time.
  Os números são os de `REGRAS_DO_RITMO`: desde 19/10/2026 (decisão do Rômulo), 5 min entre primeiros contatos, 12 por hora móvel e
  100 por dia de São Paulo, somando time, telas e Telegram (antes: 4 min, 8/h e a rampa 10/20/30). São tetos internos, não um limite
  publicado pelo WhatsApp; `pausadoAte` segue sendo o freio depois de um aviso ou restrição.
- **O registro é o da Central**: antes de enviar, o time faz o clique no link rastreado do n8n (`http://127.0.0.1:5679/webhook/enviar?place_id=`,
  fluxo "04 · Clique no wa_link"), que grava `clique_em` (abrir nunca marca envio: regra `[abrir-nao-envia]` de 18/10/2026); o
  observador, vendo a saída até 15 min depois do clique, marca `status = enviado` e `enviado_em` e mantém a `mensagem_variante` e o
  `ab_elegiveis` que o Balcão gravou (sem clique, "manual"). Vale igual para o toque do Rômulo no link da Central: de 18/10 até o
  `clique_em` (19/10), todo envio do Site saía "manual" e o A/B da 1ª mensagem não contava. O redirecionamento tem de levar ao número
  do lead e ao texto reservado. O texto enviado é o do Balcão, sem troca: o envio
  entra na trava de ritmo, em Números, na taxa do nicho e nos A/B como se o Rômulo tivesse tocado. Clique falhou: nada sai e o número volta a ficar livre no registro do time. Envio confirmado: nota na Ficha.
  Se o envio falhar depois do clique, o lead continua "pronto" (o clique não marca envio); o registro do time fica "incerto" e bloqueia
  novos envios até a reconciliação.
- **Quem faz o 1º contato** (`quemFazOPrimeiroContato`): lead na fila do time, com o time ligado, ou cujo envio o time já começou
  (incerto/enviado), é do time; o resto é do Rômulo. `GET /crm/venda` devolve `doTime` e a Próxima venda e o vendedor do Telegram tiram da
  fila o primeiro contato desses leads; o time não pede reserva para lead que o Rômulo já tocou hoje (Central ou Telegram).
- **Ligar** (decisão do Rômulo; nada disto roda sozinho). A Central precisa estar na `main` com a rota `/crm/frente/reservar`
  (sem ela a reserva dá 404 e nada sai). Na Mel: `install -m 755 ~/SquadOne/deploy/dell/frente-comercial.py ~/.local/bin/frente-comercial`,
  `install -m 644 ~/SquadOne/deploy/dell/frente-comercial.{service,timer} ~/.config/systemd/user/`, `systemctl --user daemon-reload`,
  `dell-status --instalados` (confere a cópia), `curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:9120'
  -d '{"ativo":true}' http://127.0.0.1:9120/api/operations/crm/frente/config` e `systemctl --user enable --now frente-comercial.timer`.
  Pausar: o mesmo POST com `{"ativo":false}`, ou `systemctl --user disable --now frente-comercial.timer`.

## Agente que mantém o lead quente — fase de SOMBRA (17/10/2026; desligado, nada é enviado)

Decisão do Rômulo em 17/10/2026: ele **continua** fazendo os primeiros contatos e mandando o primeiro link; um agente passa a **manter o
lead quente depois que o link saiu e o lead escreve de novo**. Esta fase é só a decisão: o agente não envia nada. A Evolution na Mel só lê (a exceção, desde 19/10/2026, é o
primeiro contato do time comercial, desligado por padrão: seção acima), o chip é o mesmo do Hermes e levou restrição de 24 h em 15/10 por rajada de primeiros contatos, então o envio é uma decisão à parte (abaixo).

- **A decisão (PURA, `server/lead-quente.ts`)**: `decidirLeadQuente({ lead, mensagens, sugestao, agora, jaDecididas, toques })` devolve
  `responder`, `escalar`, `calar` ou `aguardar` (a sugestão do copiloto ainda não saiu; nunca é gravado). Sem fetch, relógio, env nem disco.
  O texto de um `responder` é **sempre o da sugestão do copiloto** (que já conferiu ids do cardápio, R$ e números do dossiê): o agente escolhe, não escreve.
- **Chave de dedupe**: `${lead.id}|responder|${ultimaEntrada}`, a mesma da Próxima venda e do vendedor (uma decisão por mensagem nova do lead).
- **Gate de `responder`** (todos juntos): lead em `contato` (proposta escala; novo/ganho/perdido calam), o lead escreveu **depois** do link
  (`conversa.linkEm`; antes dele o passo é do Rômulo e o vendedor já avisa), o Rômulo **não** escreveu à mão depois do link nas últimas 6 h
  (`SQUADONE_LEAD_QUENTE_CALAR_HORAS`; no JSONL da conversa toda `saida` é dele, e o próprio envio do link não conta), resposta classificada
  `interesse` (nem `neutra`, `bot`, `negativa`, `exclusao`; `licenca` escala), mensagem curta (até 160 caracteres e 3 mensagens na rajada),
  sem sinal negativo nas 3 últimas mensagens de gente, sugestão do copiloto presente, sem aviso dele, sem item de proposta, sem valor em dinheiro
  no texto (`temValorEmDinheiro` e `precosProibidos`: nem o preço aberto do cardápio, preço é do Rômulo) e teto de toques.
- **`escalar`** (motivos em `FRASE_DO_MOTIVO`): preço, proposta, fechar, ligação/pessoa, objeção, **áudio** (com ou sem transcrição),
  irritação, sinal de recusa, recepção, licença, mensagem longa, lead já na proposta, resposta pronta com valor/fora do dossiê, sem sugestão depois
  de 5 min, teto de toques. Os sinais são regex sobre o texto sem acento (`SINAIS`) e erram para o lado de escalar.
- **`calar`**: sem novidade (última mensagem é nossa, só o robô falou, mensagem com mais de 24 h), etapa, já decidida, antes do link, Rômulo assumiu, recusa, robô, sem interesse dito.
  Só os calar que são decisão (`romulo-assumiu`, `negativa`, `robo`, `sem-interesse`) vão para o JSONL (`CALAR_SEM_REGISTRO` lista os outros).
- **Teto de toques** (`podeTocar(toques, mensagens)`): no máximo **2 respostas do agente seguidas sem o Rômulo escrever**; a terceira escala.
  O follow-up de quem **não** responde (um depois do link, um depois do 3º dia) saiu do módulo em 19/10/2026: era código sem laço que o
  disparasse; a fase de envio, se o Rômulo a decidir, acrescenta `TipoDeToque`. **7 dias sem mensagem segue sendo Perdido** (`server/crm.ts`).
- **A cola (`server/lead-quente-sombra.ts`)**: `SQUADONE_LEAD_QUENTE_SOMBRA=true` (desligada por padrão), **só no `operations`**, com o bot do
  Telegram e o copiloto ligados (sem eles, log de erro e null; nunca no Easypanel). A cada minuto relê o CRM; para cada lead com mensagem
  nova dele sem resposta nossa, decide, grava em `<SQUADONE_OPERATIONS_DATA_DIR>/lead-quente-sombra/AAAA-MM.jsonl` (600, pasta 700) e avisa o chat do
  Rômulo: **"Sombra: eu teria respondido a X: <texto>"** ou **"Sombra: eu teria escalado X (pediu preço): assuma"**, com 👍 Concordo / 👎 Discordo.
  Teto de **30 avisos/dia** (`SQUADONE_LEAD_QUENTE_TETO_DIA`): passado o teto a decisão é gravada com `semAviso: "teto"`. Das 22h às 7h o aviso
  chega sem som. O registro leva a empresa, a chave, a ação, o motivo e o texto do agente; **nunca** telefone nem a mensagem do lead. O copiloto
  é só LIDO (`prontas`, que nunca chama o modelo); quem gera é o copiloto automático.
- **Robustez (19/10/2026):** a gravação que falha depois do aviso não o reenvia (as chaves ficam em `avisadosSemGravar`, que também contam no teto do
  dia) e, depois de 3 falhas seguidas (`MAX_FALHAS_DE_GRAVACAO`), o laço para até reiniciar a Central, com o erro no log; o leitor dos JSONL
  (`criarLeitorDeRegistros`) guarda os registros em memória e só relê quando o tamanho ou o mtime do arquivo mudam por fora; o laço ainda não
  devolve função de parar ao `server.ts` (não entra nos paradores do SIGTERM).
- **Nenhum código chama Evolution, `sendText` nem qualquer envio ao lead.** O único `enviarMensagem` é o aviso ao chat do próprio Rômulo, e
  `server/lead-quente.test.ts` varre o código-fonte dos dois módulos (sem comentários) atrás de `sendText`, `evolution`, `wa.me` e afins.
- **Medição** (`GET /api/operations/crm/lead-quente`, `resumoDoLeadQuente`, 30 dias): quantos `responder`/`escalar`/`calar` (e por motivo), avisos
  e os cortados pelo teto; os votos do Rômulo; os **falsos positivos do classificador de `interesse`** (dos `responder` votados, quantos 👎;
  sem voto não há taxa); e o **tempo entre a mensagem do lead e a resposta humana real** (a cola confere a conversa a cada 10 min por 3 dias e
  grava `humano`), com a mediana separada para os `responder` (o quanto o agente teria encurtado a espera).
- **Ligar** (não nesta entrega): `SQUADONE_LEAD_QUENTE_SOMBRA=true` no `operations.env` da Mel, com `SQUADONE_COPILOTO=true` e o bot já ligados, e
  reiniciar a Central. Não há nada a instalar fora do deploy normal. Desligar: tirar a linha (ou `false`) e reiniciar; o JSONL fica.
- **Como ler o resultado**: uma semana de sombra com pelo menos ~30 `responder` votados. Taxa de 👎 acima de ~10% nos `responder`, ou qualquer
  `responder` que o Rômulo marque como "não podia ter ido", segura a fase de envio e vira ajuste do gate (`SINAIS`, limites) primeiro.

### Decisão aberta: a fase de ENVIO (não implementar sem o Rômulo)

Mandar a resposta de verdade **exige mudar o invariante "nunca envia ao lead"** (vendedor, copiloto, Assistente, Luna e Jev dizem o mesmo; a
Evolution na Mel é só leitura) e abrir a escrita na Evolution num chip compartilhado com o Hermes. Antes disso o Rômulo precisa decidir:

1. **Veto de 3 min no Telegram**: o aviso sai com o texto e um botão "Vetar"; passados 3 min sem veto, o agente envia (e o 👍/👎 vira o feedback). Sem resposta
   do Telegram (caiu, madrugada) o padrão é **não enviar**.
2. **O agente se identifica como assistente do Rômulo?** ("Sou o assistente do Rômulo…") ou fala como ele. Há o lado ético/de confiança (o lead acha que
   fala com uma pessoa) e o de política do WhatsApp; sem decisão, nada é enviado. Se se identificar, o texto do copiloto precisa de uma abertura
   fixa, fora do modelo.
3. **Ritmo e restrição do número**: o envio do agente conta na trava de ritmo (`trava-de-ritmo.ts`) e na janela de expediente; resposta a quem acabou
   de escrever é o caso de menor risco (conversa iniciada pelo lead), mas o teto de 2 respostas seguidas e o "Rômulo assumiu" precisam valer no envio real.
   Em envio real a conversa passa a ter saídas do agente: a regra "toda saída é do Rômulo" muda, e o observador precisa marcar a origem (`origem`
   já existe no JSONL; falta o agente escrever o dele).
4. **Como mandar**: Evolution `sendText` com o número do lead vindo da Central, nunca do modelo; o envio fica num módulo à parte, sob flag própria
   (`SQUADONE_LEAD_QUENTE_ENVIO`), nunca na mesma de sombra; `texto` registrado no JSONL; botão geral "Parar agente" no Telegram.
5. **Finanças** nunca entram: o agente não lê nem cita nada do banco `financas.db`; nenhum valor em dinheiro numa resposta (já é o gate de hoje).

## Plus: os leads do Catálogo de Negócios Maçônicos (15/10/2026)

Pedido do Rômulo (já foi maçom e tem o catálogo do macons.org): os melhores leads num filtro próprio, "Plus", que podem ser de qualquer
um dos quatro fluxos e abrem com a saudação da Ordem.

- **Importar:** `npx tsx scripts/plus-importar.ts "<catalogo.pdf>" <saida>/leads.json --relatorio`. Lê o PDF com o pdfjs (grade de 3 colunas, cidade
  do cabeçalho mais próximo acima, carregada de uma página para a outra), normaliza o telefone (zero de operadora, 55, fixo de 10 dígitos), junta
  o mesmo WhatsApp num lead só (`tambem` guarda os outros nomes) e deixa de fora marca de montadora, banco, token e livro. Quem não tem telefone
  legível vai para `semTelefone` no mesmo arquivo (não entra no CRM). Em 15/10/2026: 440 cartões, 310 leads (265 site, 38 prumo, 3 iris, 4 estampa),
  97 sem telefone, 6 fora, 14 fixos. O arquivo vai para `~/prumo-entregas/plus/leads.json` no Dell e **nunca entra no git**.
- **Oferta (`plus.oferta`):** roupa (camiseta, silk, uniforme, bordado) = `estampa` (caneca e brinde não: é o mesmo recorte do caçador de estamparias);
  psicologia/psicanálise/fono/terapia = `iris`; tem site próprio (Instagram e linktree não contam) = `prumo`; o resto = `site`.
- **Mensagem (`server/plus-mensagem.ts`):** "Meu Ir.'., tudo bem? Me chamo Rômulo e encontrei {a/o empresa} no Catálogo de Negócios Maçônicos." + o pedido da
  oferta + a saída fácil + "T.F.A.". Segue o guia dos outros textos (sem preço, sem link, sem dar como pronto o que não existe; as ofertas só
  são prometidas depois do sim). Nome longo ou com título ("Advogado - Regularização de Imóveis…") vira "o seu negócio".
- **Estado:** só pelos registros da aba CRM (produto `plus`): o toque em "Enviar pelo WhatsApp" anota `plus_enviado` (Hoje, Funil e Ficha; "Já enviei
  por fora" na Ficha cobre o envio feito de outro jeito) e a Ficha tem "Respondeu no WhatsApp: anotar" (`plus_respondeu`, de novo a cada resposta para
  recomeçar os 7 dias). O n8n `08 · CRM` aceita `plus` e os dois tipos desde a republicação do `crm.py`.
- **Ritmo:** a Hoje mostra só os 10 primeiros Plus (o fixo por último) e a trava de horário vale como nos outros primeiros contatos. Plus fica fora de
  "Enviar um por um", porque a fila não anota o envio.
