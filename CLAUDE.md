# SquadOne

## Qualidade da Prumo (21/10/2026)

A Prumo é a fonte dos critérios, nomes e aceite; o SquadOne executa. Leia `docs/referencia/organizacao-prumo.md` e `../prumo/00-contexto/organizacao.md` antes de criar ou alterar ofertas e fluxos. Site e Raio-X passam por `deploy/dell/lib/qualidade_prumo.py` antes de publicar. Homologação é identificada; Profissional exige todos os obrigatórios, IQS completo, referência e manifesto exatos. O gerador não publica diretamente nem assina aceite; avaliações aprovadas ficam na área privada, fora da pasta do lead. O Mapa continua como rascunho, sem envio automático.

`prumo_contexto.py` injeta o guia canônico em cada entrada dos workflows Prumo/Site e seus subworkflows. O `n8n.py` mantém essa integração nas regenerações; `prumo-contexto.timer` confere a sincronização a cada 15 minutos e preserva os fluxos pausados. A cópia operacional é identificada por SHA256 em `~/.local/share/prumo-contexto/`.

Escritório isométrico onde squads de agentes de IA (Pessoal, Pay4Fun...) recebem demandas em linguagem natural e as transforma em eventos no Google Calendar. Uso pessoal, um usuário só.

## Comandos

```bash
npm run dev      # tsx server.ts — Express + Vite em middleware mode, porta 3000
npm run build    # vite build + esbuild do server para dist/server.cjs
npm start        # node dist/server.cjs — o que roda em produção
npx vue-tsc --noEmit   # typecheck (o script `lint` chama isto)
npm test         # tsx --test server/*.test.ts server/financas/*.test.ts src/*.test.ts src/office/*.test.ts src/casca/*.test.ts src/blueprint/*.test.ts (node:test, sem framework extra)
```

Os testes são pontuais: só as regras puras que dá para fixar em tabela de casos, em
`node:test`, sem montar o Vue e sem tocar o Google (`fetch` é dublê; o que grava usa
diretório temporário, nunca `data/`). Inventário arquivo a arquivo em
`docs/referencia/testes.md`. O monitor do Dell tem os seus em Python
(`python3 deploy/dell/dell-status.test.py`). A verificação continua sendo typecheck +
build + exercitar a rota.

### Grafo do código (Graphify)

- **Quem gera:** o Dell, todo dia às 03:00 (`graphify-projetos.timer` do systemd desde
  11/10/2026; era o job "Graphify — projetos" do Hermes, hoje pausado): só AST, **não gasta
  token**. Nunca construir, indexar ou rodar `graphify update` no PC.
  `dev/_grafos/` no PC é um retrato de 04/10/2026: não é fonte, não confie nele.
- **Como perguntar** (roda no Dell por SSH, sem copiar grafo; `global` no lugar do projeto
  cruza todos): `scripts/grafo.sh explain SquadOne "orchestrator.ts"` lista quem importa o
  arquivo e o que ele importa, ou seja, o raio de impacto de uma mudança (barato, preciso);
  `scripts/grafo.sh path SquadOne "telegram-bot.ts" "calendar.ts"` dá o caminho mais curto
  entre dois módulos (duas linhas); `scripts/grafo.sh query SquadOne "pergunta" [orçamento]`
  é busca livre: trunca (centenas de nós) e mistura testes, deixe por último.
- **Quando vale:** impacto de mudança, "quem chama X", "como A chega em B" fora do mapa
  abaixo, projetos grandes sem mapa (`auto-site`, `Iris`, `Aladdin`) e perguntas entre
  projetos. **Quando não vale:** para achar onde algo mora no SquadOne, o mapa de
  "Arquitetura" e o Grep resolvem mais barato. O grafo é de AST: não vê rota montada em
  runtime nem regra que só está em texto.

## Arquitetura

Um processo Express serve a API e a SPA Vue. Sem banco.

```
server.ts                 Express: monta o webhook do Telegram antes do porteiro, o porteiro, as rotas e o Vite/estáticos
  server/acesso.ts        porteiro de IP (403 antes de qualquer rota); no Dell, identidade do Serve e escrita da mesma origem
  server/dados.ts         SQUADONE_DATA_DIR e a trava que só liga a agenda no Dell com ele fora do clone
  server/auth-store.ts    credencial do Google: code flow, refresh, cifra em disco
  server/squad.ts         roster v3 em árvore, migração, regras de id; única fonte de verdade das squads
  server/roster-historico.ts  cópia datada do squad.json anterior a cada gravação, poda 30/90 dias (PURO: nome e poda; I/O: cópia)
  server/hire.ts          contratação (card ou UI), nova squad, substituição de PO
  server/ciclo-de-vida.ts editar, arquivar e reativar pessoa/domínio/squad
  server/redacao.ts       Gemini redige papel + escopo (não grava)
  server/orchestrator.ts  um turno: demanda -> 1 chamada ao Gemini -> capacidades
  server/turno.ts         demanda já validada -> um turno; ponto único usado por /api/orquestrar e pelo bot do Telegram
  server/capabilities.ts  as capacidades que o modelo pode invocar (agendar_evento, criar_tarefa, crescimento, troca de squad)
  server/alocador.ts      PURO: ocupação + janela + pedido + agora -> slots
  server/agenda.ts        ocupação do turno: 1 leitura do primary + reservas
  server/agendamento.ts   compromisso -> eventos (foco, ou marco + blocos)
  server/quest.ts         recusa classificada e validação comum das rotas de quest
  server/plano-de-ajuste.ts  PURO: duração/esforço aprovados sobre o alocador
  server/ajuste.ts        aplica o ajuste aprovado no Google
  server/calendar.ts      leitura/escrita no Google Calendar (listar, GET/PATCH/POST de um evento)
  server/avisos.ts        Aviso no schema da fila de avisos do Dell, gravação atômica, P0 e as origens de falha só pela outbox do Telegram (nunca WhatsApp; lista única `ORIGENS_QUE_EXIGEM_TELEGRAM`, espelho da do Dell), sem R$;
                          lembrete e alerta de finanças pelo Telegram, fila só de reserva (publicarAvisoPessoal, OT-14); a chave de 24 h dos avisos pessoais
                          fica em disco (RegistroDeEnviados, avisos-enviados.json), porque a Central reinicia a cada merge; o cartão de decisão saiu (19/10/2026)
  server/lembretes.ts     PURO: quais eventos avisar, quando e com que texto (um Aviso)
  server/vigia.ts         laço de 60 s: relê a agenda (cada leitura com prazo de 15 s) e publica os lembretes devidos e, às 7h30–11h, o resumo matinal (1 por dia);
                          ultimaVarreduraOkEm alimenta o sinal de vida e ocupada() o /api/runtime
  server/resumo-matinal.ts  PURO (17/10/2026): quando sai (resumoDevido) e o texto da agenda do dia (montarResumo); SQUADONE_RESUMO_MATINAL=false desliga
  server/sinal-de-vida.ts ping ao healthchecks.io (DEADMAN_URL); /fail com o WhatsApp fora há > 15 min ou a vigia sem varredura completa há > 5 min
  server/tempo.ts         PURO (19/10/2026): o relógio de São Paulo num lugar só (diaDeSP, horaDeSP, ehMadrugada 22h–7h); era "menos 3 h" copiado por módulo
  server/em-serie.ts      fila de uma tarefa por vez (criarEmSerie) e anexarJsonl (JSONL 600 em pasta 700): vendedor, venda-do-dia, lead quente, copiloto, Assistente
  server/time.ts          time vivo da Hoje: agruparTimePorSquad (PURO) + leitor de /api/time (1 leitura por calendário, cache 60 s)
  server/passos.ts        PURO: normaliza os passos, título da lista, notas e due da tarefa-mãe, escopo concedido
  server/tasks.ts         transporte do Google Tasks: lista, tarefa, ErroTasks classificado, timeout 10 s
  server/passos-no-google.ts  lista por squad (single-flight) + tarefa-mãe + subtarefas + vínculo no evento
  server/telegram.ts      transporte da Bot API: lê a config do ambiente, segredo do webhook em tempo constante, sendMessage/sendChatAction/setWebhook
  server/telegram-entrada.ts  PURO: update do Telegram -> comando/demanda/ignorar, dedupe de update_id em memória
  server/telegram-resposta.ts PURO: TurnoResult -> texto do chat (sem parse_mode), reusa linhasDosEventosCriados
  server/telegram-bot.ts  cola: portão (segredo) + receber/processar (allowlist via telegram-entrada, 200 imediato, fila serial, áudio, botões de contratação)
  server/telegram-polling.ts  entrada por getUpdates (Dell): offset persistido ao enfileirar, nunca setWebhook
  server/transcricao.ts   áudio do Telegram -> texto da demanda (uma chamada ao Gemini)
  server/avaliacoes-turno.ts  nota do usuário sobre um turno recém-entregue (desligada por padrão)
  server/luna-sombra.ts   Luna em sombra (desligada): prompt, leitura da saída e comparação PUROS; cola com fila, teto/dia, codex exec sem shell, JSONL 600
  server/openrouter-decisoes.ts  transporte do Jev (OpenRouter /alpha/decisions): pedido, máscara, validação e erro PUROS; deny + ZDR, sem retry, chave nunca em log
  server/jev-sombra.ts    Jev em sombra (desligado, RULES 27): 4 perguntas por demanda e comparação com o Gemini PURAS; fila, teto/dia e de US$, JSONL 600; finanças nunca vão
  server/copiloto.ts      copiloto do PRUMO (desligado, só operations): provedor trocável (codex | gemini), sugestão guardada pelo hash do dossiê, teto/dia, JSONL 600, Raio-X do disco;
                          automático (16/10/2026): quando a vez é do Rômulo, sugere sozinho, uma geração por vez (SQUADONE_COPILOTO_AUTOMATICO=false desliga);
                          sinais do site (17/10/2026): o dossiê leva sinaisDoSite (sinaisParaODossie, PURO) só com sinais COM fonte, em observação cautelosa (tag/pixel instalado nunca vira gasto; agência só
                          contexto, sem abrir), e o prompt ganha a regra de UMA observação na 1ª linha só quando há sinais; sem sinais o hash do dossiê não muda; nenhum template do funil muda (experimento A/B/C)
  server/vendedor.ts      (16/10/2026, SQUADONE_VENDEDOR=true, só operations com o bot) "Envie para X" no Telegram, das 7h às 22h
                          (das 22h às 7h `silencioDoVendedor` não sai nada):
                          um aviso por vez com a mensagem pronta (a do copiloto quando há, esperando até 4 min só se a última mensagem é do lead) e "Abrir no WhatsApp", "Enviei", "Pular"; `decidir` PURO; nunca envia ao lead;
                          desde 28/10/2026 só a lista branca `vaiAoTelegram` (responder de gente, sem robô/recepção; mandar-proposta; o "o que achou?"
                          `|depois-do-link`; o "quanto custa" `|negociacao-humana`; e o urgente), teto de 8 avisos que SAÍRAM por dia (`MAX_AVISOS_POR_DIA`)
                          e 1 por lead por dia (`leadsAvisados`); o urgente (`avisoUrgente`: "quero ver" quente, pagamento, aceite, Pix, contrato) passa por cima
                          dos dois; primeiro contato, follow-up, cadência, revisões e internos ficam só na Central; o dia do servidor (venda-do-dia) é obrigatório
  server/frente-comercial.ts  (19/10/2026) a Central do time comercial: GET /crm/frente (estado, sem número), POST /crm/frente/config ({ ativo }),
                          POST /crm/frente/reservar (o time pede UM primeiro contato: mesma janela e ritmo da Central, gate em "bloquear", grava o
                          primeiro do dia `por: "time"` na fila do venda-do-dia); `doTime` em GET /crm/venda. O time em si é deploy/dell/frente-comercial.py:
                          o ÚNICO agente que ENVIA a lead (o 1º contato do Site `pronto`, texto do Balcão, pela Evolution do PRUMO). Dois interruptores: `ativo` no config e o
                          timer do systemd; GET /crm/frente diz `cicloParado` (ativo, sem rodada há > 5 min no expediente) e `ultimaRodadaEm`. Estado real: ver "Perfis"
  server/gate-de-envio.ts PURO (17/10/2026, ideia do Harvey): gate de pré-envio sem modelo: marca de modelo sem preencher, frase de IA/emoji, tamanho e links por tipo, nome vazio/com lixo,
                          "R$" fora dos permitidos (reusa precosProibidos do copiloto) e número do wa.me ≠ o do registro (chaveDoNumero). `modo`: copiloto e vendedor com mensagem do
                          copiloto = "bloquear" (falha gate_de_envio, sem Copiar, aviso do Telegram barrado com o motivo); texto da esteira = "avisar" (linha "Confira", botão fica);
                          destinatario_diferente bloqueia sempre. Nunca reescreve nem envia. Fonte única desde 19/10/2026 (a cópia em JS do Balcão, que só escrevia uma coluna que
                          ninguém lia, saiu); o time comercial também o cumpre em "bloquear" ao pedir a reserva.
  server/sinais-do-site.ts  PURO (17/10/2026, estágio PROFILE do Harvey, MIT): HTML do site do lead -> sinais tri-estado (temAgencia com confiança ≥ 0,75, rodandoGoogleAds/MetaAds,
                          semAgendamentoOnline, semSchema, blogParado, semSite; null = sem fonte), ajusteDaPrioridade (−4 a +6: anúncio +4, sem agenda +2, agência −4) e linhasDosSinais (a Ficha)
  server/sinais-do-site-leitor.ts  leitura sob demanda de UM lead (POST /api/operations/crm/sinais, ao abrir a Ficha): ≤ 3 requisições, 10 s, 2 MB, bloqueio de SSRF (IP privado/loopback/
                          metadata/tailnet, redirecionamento conferido, IP conferido na conexão), cache em disco 600 (sinais-do-site/sinais.json, 7 dias); SQUADONE_SINAIS_DO_SITE=false desliga
  server/lead-quente.ts   (17/10/2026, SOMBRA) o agente que mantém o lead quente depois do link: decisão PURA responder|escalar|calar a cada mensagem nova do lead
                          (gate estrito, teto de toques, texto só do copiloto, sem R$); NADA envia ao lead. Fase de envio = decisão aberta do Rômulo
  server/lead-quente-sombra.ts  a cola (SQUADONE_LEAD_QUENTE_SOMBRA, desligada, só operations com bot e copiloto): JSONL 600 em lead-quente-sombra/,
                          aviso "Eu teria respondido/escalado" no Telegram com 👍/👎 (callback q:), teto/dia, GET /api/operations/crm/lead-quente
  server/venda-do-dia.ts  (16/10/2026, OT-01) o "Enviei"/"Pular" do dia num arquivo só (venda-do-dia.json), dividido pela Próxima
                          venda (GET/POST /api/operations/crm/venda) e pelo vendedor do Telegram; zera à meia-noite de SP;
                          desde 17/10/2026 (AC-06) é a fonte única do dia: por onde cada ação se resolveu (central, telegram,
                          expirou), a anotação no CRM uma vez por ação + tipo (/crm/venda/anotar) e os primeiros contatos das duas
                          superfícies (/crm/venda/primeiro, a trava de ritmo); o aviso aberto no Telegram fecha quando a Central resolve;
                          e os liberados do dia (AC-21, POST /api/operations/crm/venda/liberar), o mesmo "Liberar" para a fila de venda, a Triagem e a Ficha
  server/conversa-do-lead.ts  (16/10/2026) a conversa do lead como o observador grava (~/.local/share/whatsapp-conversas/<chave>.jsonl, chave = DDD + 8
                          últimos dígitos do NÚMERO, nunca o id da planilha); resumo PURO (última mensagem, link já mandado) que o CRM, a Próxima
                          venda e o copiloto usam; toque em "Mandar o link" sem mensagem perto não conta como envio; GET /api/operations/crm/conversa?id=;
                          desde 17/10/2026 (a Baobá) o `papel` da entrada (recepção/robô; o robô não é resposta nem recomeça o prazo), a mídia nossa
                          ("[vídeo]") vale como o link e o áudio não ouvido é dito assim (src/operations/marcadores-da-conversa.ts, PURO);
                          `resposta.tipo = "licenca"` é permissão para mandar o material, nunca "quero ver"
  server/decisoes-comerciais.ts, revisao-resposta.ts, importar-conversa.ts, protecao-comercial.ts, convite-mensagem.ts  (18–19/10/2026) a decisão humana sobre o lead,
                          como nota na aba CRM pelo n8n e, nas de decisão, com o hash do contexto do lead (409 se mudou, trava de repetição de 15 min): confirmar a revisão da
                          classificação ou um convite enviado à mão (POST /crm/decisao/confirmar), ajustar o próximo passo (POST /crm/proximo-passo/ajustar, GET /crm/resposta/contexto),
                          importar a exportação do WhatsApp para a conversa em disco (POST /crm/conversa/importar), e proteger a demo/pedir revisão (PURAS). Nada gera nem envia mensagem
  server/entrada-proxy.ts repasse fechado de /entrada/ ao serviço da Entrada da Mel (127.0.0.1:9130, deploy/dell/entrada/), antes do express.json (RULES 23)
  server/operations.ts    perfil `operations` (só Dell): SQUADONE_MODE, bind loopback, rotas /api/operations/*
  server/auto-production.ts   Central: leitura das pastas de ~/auto-site para o CRM (somente leitura)
  server/crm.ts           Central: CRM do PRUMO (/crm) a partir do retrato das planilhas que o n8n grava; registro pelo webhook do n8n;
                          quatro ofertas no mesmo funil: Site antes da venda, serviços PRUMO, Iris, CRM de estamparia (14/10/2026);
                          registros ganhou/dispensado (+ _desfeito, 17/10/2026, AC-08/AC-10): Ganho em todas as ofertas e Perdido
                          (Descartado) saindo da Triagem; a Prioridade da Triagem é da Central (prioridadeDaTriagem, PURA), não do caçador
  server/site-mensagem.ts PURO: espelho do site-mensagem.js do n8n (follow-up e segunda mensagem, EN nos EUA) para os links do CRM;
                          o reenvio do só-robô (REENVIO_ROBO*, "Pedir o responsável") é só do CRM, sem par no JS nem inglês
  server/prumo-mensagem.ts PURO: 2ª mensagem (o Raio-X) e reenvio do só-robô do PRUMO (só número 55)
  server/plus-catalogo.ts PURO: o PDF do Catálogo de Negócios Maçônicos (itens posicionados) -> leads Plus (oferta, nicho, dedupe por WhatsApp);
                          scripts/plus-importar.ts abre o PDF e grava ~/prumo-entregas/plus/leads.json (fora do repo: telefones de terceiros)
  server/plus-mensagem.ts PURO: 1ª mensagem e follow-up do Plus, com a saudação maçônica ("Meu Ir.'., tudo bem? Me chamo Rômulo… T.F.A.")
  server/dell-status.ts   Central: lê o status.json gravado pelo monitor deploy/dell/dell-status.py (o_que_fazer, acao, sozinho)
  server/uso.ts           Central: contador de uso (17/10/2026, AC-28): telas da SPA (beacon da casca) e escritas da API por dia de
                          SP, sem id/telefone/valor/query além de ver/produto; uso/AAAA-MM-DD.json 600, debounce 30 s, poda 90 dias;
                          GET /api/operations/uso?dias=14 (PURO: normalizar, somar, podar)
  server/financas/        Central: finanças (Meu Pluggy + fatura em PDF do Santander), banco financas.db; ver ARCHITECTURE "Finanças"
    tipos, comum, natureza, categoria, transferencias, dedupe, parcelas, visoes, processar, resumo, pluggy-mapa, fatura-santander: PUROS
    organizacao (categorias, semáforo, orçamento, recorrentes), alertas (70/90/100%), gasto-falado, extrato (OFX/CSV): PUROS
    explicacao (PURO): o texto exato do "Explicar este mês", o hash da prévia e o prompt fixo; só sai a pedido (SQUADONE_FINANCAS_IA)
    pluggy.ts (transporte), banco.ts (better-sqlite3, 600, migrações), sync.ts (polling), pdf-texto.ts (pdfjs), rotas.ts (/api/financas;
                          POST /gasto, 17/10/2026: o cartão de gasto do Assistente, relido por lerPedidoDeGasto, chave painel:<id>)
    servico.ts (cola: resumo com a organização, depois de cada escrita, avisador, gasto anotado)
src/main.ts -> src/RootApp.vue  pergunta /api/runtime (perfil e `agenda`) e monta a casca com { perfil, agentes }
src/App.vue               a casca (07/10/2026): rota atual, barra inferior/lateral, Ctrl+K, folhas do roster, aviso; no operations
                          três menus desde 17/10/2026 (Central de comando · ＋ Assistente · Vendas) e a Manutenção discreta (engrenagem)
  src/casca/              frente.ts (a leitura do time comercial, uma por aba, compartilhada pela Central e pelo painel), destinos.ts (PURO: rota por perfil, barra, destinoDiscreto, Ctrl+K), central.ts (PURO, 17/10/2026: as faixas da
                          Central de comando, o andar do mapa, ?abrir=), hoje.ts (PURO: ordem da Hoje,
                          semáforo das finanças, estado do time só com fonte, linha do funil; no operations a Hoje não tem o bloco Time, AC-18),
                          paleta.ts (PURO, AC-23: leads no Ctrl+K pelo nome da empresa, 8 no máximo, nunca telefone nem id na tela, leitura
                          do CRM guardada 60 s; reaberturaDepoisDeIr), mais.ts (PURO: secaoDoMais, ?abrir=manutencao|roteiro, e ferramentasDoMais;
                          Desconectar o Google está em Mais › Manutenção, AC-25), rota.ts (pushState sem roteador),
                          overview.ts (retrato do Dell), ditado.ts (microfone do Pedir), pilhaDeFolhas.ts;
                          BarraInferior, BarraLateral, CascaTopo, PedirFolha, Paleta, DellAlerta, FinancasAlerta,
                          PrecisaDeVoce (os até 3 cartões, Hoje e Central), EscritorioVivo (o mapa da Central, sem editar o roster)
  src/rotas/              CentralRota (/ no operations), HojeRota (/ no app), AgendaRota (/agenda), EscritorioRota (/squadone),
                          MaisRota (/mais; Manutenção no operations). As rotas fora dos menus seguem por endereço
  src/agentes/estado.ts   estado e ações dos agentes (era o <script> do App.vue): roster, squad ativa, Mochila,
                          turno, cartões, folhas; um por aba (`useAgentes`), com as guardas de isLoading e abertura
  src/agentes/ListaDeQuests.vue  compromissos da Mochila: "próximos 3" na Hoje e a Agenda por dia
  src/operations/         Central de Operações (só perfil operations), montada como rotas da casca
    ComoFuncionaPanel.vue os fluxos da operação, um por vez, e "Um dia"; conteúdo em fluxos.ts (estático, versionado);
                          ?fluxo=&passo= abre um fluxo com o passo em destaque (o link do robô no Escritório)
    alertas.ts            PURO: separa falha / fila / vale olhar / resolve sozinho; links só do Dell; contagem das filas;
                          resumoDoDell (17/10/2026, AC-17) é o número único do topo, da Hoje e do Mais ("precisam de você" e
                          "resolvem sozinhas"); a Hoje mostra só os títulos, o técnico fica em Mais › Manutenção
    AccessPanel.vue, DellConferePanel.vue (tudo que o Dell confere, fechado): em Mais; agenda-window.ts: a agenda do dia na Hoje sem os agentes
    Crm*.vue, crm-formato.ts  Vendas (/crm): Conversas para você (id afazer), Primeiros contatos (id triagem: o painel do time e a Triagem), Funil (Quadro | Lista, filtros Buscar, Nicho, Cidade e Passo;
                          ?ver=jornada cai no Funil com ?passo=) e Diagnóstico (id numeros), mais a Ficha (folha cheia); os nomes da tela são NOME_DAS_ABAS (vendas-abas.ts); o Roteiro mora em Mais › Entender
                          (/mais?abrir=roteiro), e ?ver=roteiro/colinha vão para lá; no celular as abas rolam de lado e as ofertas ficam num
                          "Filtros" fechado, nunca nas Conversas para você; abrir o WhatsApp nunca registra envio: "Enviei", "Marcar a recusa" e "Pular por hoje" (MissaoDaConversa.vue) gravam e resolvem; SIGLA_DO_PRODUTO é o rótulo curto único (ROTULO_DO_PRODUTO, o longo);
                          textoDaSubEtapa/textoDoEvento traduzem o "Fechou"/"Viu" do servidor para Ganho/Leu (AC-13)
    glossario.ts          PURO (17/10/2026, AC-13): um nome por coisa na UI (Vendas, Ganho/Ganhou, Roteiro, 2ª mensagem, Leram,
                          Atualizar, Escritório, A fazer, as ofertas) e os nomes proibidos; src/operations-glossario.test.ts varre o texto
                          visível de todo .vue e .ts de src/ e falha se um deles voltar
    liberados.ts          o espelho único do "Liberar" do dia (AC-21), do corpo de GET /crm/venda; primeiro-da-ficha.ts PURO (AC-22): quando a
    proxima-venda.ts      PURO (16/10/2026): a fila de venda, uma ação por vez na ordem de quem está mais perto de comprar (responder > mandar a proposta > combinado >
                          "o que achou?" 20–72 h depois do link > proposta sem retorno > follow-up > recusa para marcar (OT-06) > primeiro contato, este só com a trava de ritmo
                          livre), com o porquê, a tática e a mensagem pronta. `PRIORIDADE_DA_FILA` é a fonte única dessa ordem (a lista "Conversas para você" lê dela; a revisão vale 5, depois da proposta sem retorno). Ninguém a desenha como cartão desde 19/10/2026 (ProximaVenda.vue saiu): ela é o "Agora" da Ficha
                          (acaoDoLead/agoraDaFicha), o "Envie para X" do Telegram e, por filaDaTela, a lista "Conversas para você". fraseDaAcao é a frase única do passo (AC-12),
                          linkDoPasso escolhe o link pelo tipo e nunca abre o gerar_demo (AC-05), desfechosDoLead alimenta a faixa "Desfecho" da Ficha (AC-08), anotacoesAMao o
                          anotar à mão (AC-09); COM_COPILOTO é só `responder` (nos outros passos o copiloto nunca responde)
    conversas-para-conduzir.ts  PURO (18–19/10/2026): "Conversas para você", a aba inicial de Vendas e o "Sua vez" da Central, uma lista só: a conversa guardada e o combinado
                          de hoje ou atrasado mais, vindos da fila de venda, o follow-up do 3º dia, o "o que achou?", a proposta sem retorno, a recusa a marcar e a proposta a mandar
                          (conversasParaVoce); primeiro contato não entra (é do time e do Telegram); o "Enviei"/"Pular" do dia (GET /crm/venda) tira o passo ou o manda para o fim
    guardador.ts          o pedaço de Storage que as marcas locais usam (ritmo, Triagem, filtro por motivo); localStorage pode lançar, quem usa envolve em try/catch
    aprendizado-comercial, historico-comercial, decisoes-comerciais, retomadas, retorno-da-venda, acompanhamento-observado, ajuste-do-passo, revisao-resposta, importar-conversa  (PUROS, 18–19/10/2026)
                          a camada de decisão humana sobre o lead, tudo sobre as notas da aba CRM (nenhuma fonte nova): o aprendizado (fato, hipótese, teste, resultado; a automática nunca vira
                          humana), a cobertura honesta do histórico (ausência exige revisão), a revisão de classificação e o convite à mão (decisoes-comerciais), os próximos passos datados do dia
                          em SP (retomadas), o retorno como a última anotação humana, o que um evento observado prova (envio sim, tarefa concluída nunca), o ajuste do passo, o hash do contexto
                          antes de abrir a mensagem (revisao-resposta) e a exportação do WhatsApp (importar-conversa); os testes ficam em src/office/ e src/operations-*.test.ts
  src/office/ (camada comercial)  missao.ts (os marcos da missão da conversa), andamento.ts, comando.ts (o controle por sala), rascunhos.ts, movimento.ts, foco.ts; SalaComando,
                          MissaoDaConversa (os botões explícitos Enviei/Marcar a recusa/Pular), ConversaDoAgente, RevisarResposta, AjustarProximoPasso, AndamentoDaVenda, AcompanhamentoObservado, SpriteDaSala
  src/casca/ (resto)      atualizacao-viva.ts (uma leitura por vez, com prazo, retomada ao voltar ao app), tema.ts (PURO)/temaVivo.ts/SeletorDeTema.vue (claro/escuro), AssistentePainel/AssistenteCartao.vue
                          Ficha oferece o primeiro contato de um Novo (o ritmo antes do horário, desabilitado com o motivo)
    primeiro-contato.ts   PURO (19/10/2026): quem faz o 1º contato (quemFazOPrimeiroContato: a fila do time ligado, ou o envio que ele começou,
                          é do time; o resto, do Rômulo), elegivelParaOTime (só Site `pronto`, nunca `revisar`/Plus) e reservaDoTime (EXPEDIENTE_DE_VENDA
                          e REGRAS_DO_RITMO contando todas as superfícies). A fila de venda e o vendedor tiram o 1º contato dos leads do time
    mandar-proposta.ts    PURO (16/10/2026): "Mandar a proposta" em um toque: quem gostou depois do link ("gostei", "quanto fica")
                          ganha o primário na Ficha e o passo na fila; o toque abre o wa.me com a proposta (itens do copiloto e preços
                          do cardápio, ou o texto base da colinha) e anota `proposta` com a data de hoje; "R$" fora do cardápio = sem botão
    por-que-nao-vende.ts  PURO (16/10/2026): o funil dos 30 dias em degraus e o gargalo contra referências (PorQueNaoVende.vue:
                          na Hoje o gargalo, quem está parado nele (nomes que abrem a Ficha) e a trilha dos degraus numa linha,
                          `resumido`; as barras e a taxa esperada em Números, OT-08; 17/10/2026)
    ab-recibo.ts          PURO (16/10/2026, OT-10): teste do follow-up para quem não manda recibo: Site enviado desde 17/10, metade
                          por sorteio fixo da chave recebe o follow-up do 3º dia; Números compara resposta e exclusão (Fisher)
    velocidade.ts         PURO (16/10/2026, OT-09): Números abre com "Depois do sim": do "quero ver" ao link e do link à proposta
                          (mediana, quantos em até 2 h, quem espera agora); o vendedor do Telegram mede em vendedor-historico.jsonl
                          (GET /api/operations/crm/vendedor)
    resultados.ts         PURO: Resultados (?ver=resultados): enviados no período por nicho, mensagem, versão do site e horário;
                          avisoDeHorario: a fila avisa fora do expediente, com a taxa medida dentro e fora;
                          sem letra, a mensagem vai pelo regime da data; follow-up anotado e quem respondeu depois;
                          leu/respondeuDeGente/quisVer/enviadoNosUltimos são a ÚNICA regra de Números e do "Por que não
                          está vendendo", e taxaPorExpediente (só Site) alimenta o avisoDeHorario (17/10/2026, AC-03)
    triagem.ts            PURO (17/10/2026, AC-10): a Triagem (/crm?ver=triagem, CrmHoje.vue) em lotes de 10 fixos (o próximo só
                          depois de decidir o atual); Convidar (travas de horário e ritmo com o motivo curto) e Dispensar (registro
                          dispensado, Desfazer por 8 s, "Dispensar os que sobraram" em série com segundo toque); marca local podada
                          quando o retrato confirma
    cohort.ts             PURO (17/10/2026): filtro por motivo da Triagem ("cohort como consulta", ideia do Harvey): "deve" (todos) e "desqualifica" (qualquer um) sobre campos
                          do lead (oferta, nicho, cidade, passo, site, WhatsApp publicado, pontuação) e sobre `lead.sinais` do servidor (ChaveDeSinal; null/ausente = sem leitura).
                          Sem leitura nunca bate nem desqualifica: vai para semLeitura e a tela diz "N sem leitura". Só filtra quem entra nos lotes de 10; as travas, o Convidar,
                          o Dispensar e o Desfazer ficam como estão. Guarda em localStorage (try/catch); CrmCohort.vue é a dobra "Filtro por motivo" (BP-DOBRA + BP-ESCOLHAS) no CrmHoje.vue
    leitura-de-sinais.ts  PURO (17/10/2026): "Ler os sinais deste lote" na Triagem (CrmHoje.vue): só o lote de 10 e só quando a pessoa toca, em série pelo POST /crm/sinais, com pausa de 1,5 s entre
                          leituras que foram ao site; 409/422/site fora do ar são contados e não são erro, parar aborta, e ao fim a visão é relida (o lote não muda)
    funil-lista.ts        PURO (16/10/2026): a Lista do Funil no desktop (Quadro | Lista, BP-TABELA): um sinal por linha, o mais
                          forte (Resposta nova > Follow-up hoje > Perdido amanhã > Divergência > resto), ordem por último toque e
                          próximo passo. Os Lançamentos também viram <table> a partir de 64 rem (FinEditorDeLancamento.vue)
    trava-de-horario.ts   PURO (14/10/2026): o aviso também TRAVA o link de primeiro contato (fila, Hoje, Funil, Ficha) até o
                          "Liberar" daquele lead, só em memória (depois das 18h: 0 de 29 envios com resposta);
                          desde 16/10 (OT-02) é a janela única de envio (EXPEDIENTE_DE_VENDA, seg–sex 8h–17h30) para o CRM, a
                          fila de venda (que ganhou o "Liberar"), o time comercial e o Telegram; o trecho do Roteiro não abre o WhatsApp antes do 1º contato;
                          primeiro contato = envio, convite e o reenvio do só-robô (linksDePrimeiroContato), nunca o follow-up de sempre
    trava-de-ritmo.ts     PURO (15/10/2026, depois da restrição de 24 h do WhatsApp por 25 envios em 25 min): primeiro contato
                          no máximo 1 a cada 30 min, 2 por hora e 15 por dia compartilhados, com dez pendentes por rodada (retomada
                          de 22–23/10/2026; os números valem só em REGRAS_DO_RITMO, e src/ritmo-nos-documentos.test.ts falha se um
                          documento citar outros; tetosPorSemana ainda aceita rampa), AVISO_DO_RITMO no recado,
                          pausadoAte; sem "Liberar". Conta o retrato e os toques desta tela (localStorage, 24 h). No servidor,
                          no mesmo dia: follow-up só para quem leu (Site, PRUMO e o 05 · Acompanhamento) e Revisar com o
                          WhatsApp publicado antes do "não confirmado"
    recado-de-travas.ts   PURO (17/10/2026, hierarquia de Vendas): as duas travas num recado só com o próximo passo ("Fora do
                          expediente: volta segunda às 8h", "Libera às 14:20 (ritmo)") e o que continua livre; RecadoDeTravas.vue
                          (BP-TRAVAS) na Triagem (o "Liberar" uma vez por lote) e na Ficha. Não muda as travas
    vendas-abas.ts        PURO (17/10/2026): as abas de Vendas na ordem Fazer → Triar → Entender (Funil, Diagnóstico, Resultados num segmentado + "Roteiro de venda"), o nome
                          de cada uma num mapa só (NOME_DAS_ABAS, 19/10/2026) e o endereço ?ver= de cada uma (os links antigos seguem)
    ab-video.ts           PURO: A/B do vídeo no envio (coluna braco_video, sorteio pelo place_id, Fisher, veredito);
                          só mede, nada ligado sem a coluna; ver docs/referencia/perfis-e-experimentos.md
    ab-mensagem.ts        PURO (14/10/2026): A/B estratificado da 1ª mensagem em Resultados ("A × B (mesmo sorteio, por nicho)"):
                          só enviados com ab_elegiveis contendo as duas letras, por nicho; nada de taxa antes de 30 por braço,
                          Fisher de ab-video.ts, "ganhou" só com +20 pontos e p < 0,10. Quem sorteia é o Balcão (alocarRodada,
                          site-mensagem.js: menos atribuídos no nicho × conjunto, congela com o mesmo conjunto); o histórico
                          (150 envios sem letra e os do hash) e o follow-up do 05 · Acompanhamento ficam fora
    abertura-prumo.ts     PURO (19/10/2026, Fase 3): o A × D da 1ª mensagem dos serviços PRUMO, separado do Site (D = evento crítico do Raio-X, um fato verificável
                          de `eventoCriticoDe`); estratificado por nicho, só confirma o que de fato saiu; aprovada pelo Rômulo em 19/10 (EVENTO_CRITICO_APROVADO)
    followup-experimento.ts  PURO (19/10/2026): follow-up A (texto de sempre) × B (texto novo por oferta), braço por hash do lead; FOLLOWUP_NOVO_APROVADO
                          (aprovado em 19/10); sem taxa antes de 30 confirmações por braço; o envio continua humano
    plus-experimento.ts   PURO (19/10/2026): o teste dos 20 primeiros envios do Plus (a partir de 19/10, `plus_enviado` manual) contra o Site no mesmo período:
                          respostas de gente, "quero ver" e propostas, em Números
    spiced.ts             PURO (19/10/2026, Fase 2): a qualificação SPICED confirmada pelo Rômulo (registro `spiced` na aba CRM, ≤ 200 caracteres por campo, 1000 no JSON,
                          data real); `qualificadoParaProposta` = dor + impacto + decisor confirmado, a TRAVA da proposta nas cinco linhas (mandar-proposta, proxima-venda,
                          copiloto, AssistenteSugestao). Sugestão do copiloto nunca entra no registro. CrmSpiced.vue = faixa BP-SPICED da Ficha
    cadencia.ts           PURO (19/10/2026, Fase 3): o que fazer depois do silêncio, em dias úteis (seg–sex, sem feriado). Proposta: nada no dia 0, toque no 1º e no 3º dia útil, perde
                          no 10º dia corrido; conversa: um toque no 2º dia útil depois da nossa saída, revisão no 7º corrido. Recusa, perda manual, pausa, resposta humana e próximo
                          passo futuro preservam. Só vira fato com `cadencia_enviada` (confirmação humana, uma por proposta e degrau); entra na fila de venda (proxima-venda.ts)
    aarr.ts               PURO (19/10/2026, Fase 4): AARRR comercial só de fatos confirmados na aba CRM (valor_proposta, pagamento_confirmado, receita_desfeita, origem, motivo_perda,
                          retencao_3m, indicacao_*), desde 19/10; centavos vêm do catálogo da oferta (precos-iris.ts: Iris por ficha ativa em faixas marginais; Estamparia sem preço).
                          A Estrela-guia = recebimentos (pagamentos) confirmados na semana de São Paulo, nas cinco linhas; "ganhou" não é dinheiro; sem registro é "não medida".
                          CrmReceita.vue grava os fatos na Ficha; `leituraAarr` também agrega por origem (`canais`, taxa só com 10+ enviados), motivo de perda (`perdas`) e valor de proposta registrado (`propostas`), na seção BP-AARRR de Números; a faixa AARRR e os testes (Plus, abertura A × D, follow-up) moram em CrmResultados.vue (Números)
    copiloto.ts           PURO (15/10/2026): dossiê do lead do "respondeu" à proposta (jornada, colinha, Raio-X, notas; sem telefone),
                          prompt, leitura da saída (id só do cardápio, "R$" só dos preços abertos, número fora do dossiê = aviso)
                          e o rascunho da proposta com preço do cardápio; desde 17/10/2026 a sugestão aparece no cartão do
                          Assistente (casca/AssistenteSugestao.vue), que só copia, nunca envia; a Ficha só lê a guardada
    colinha.ts            PURO: colinha de atendimento do PRUMO (cardápio, roteiro, objeções, CDL; texto do plano de 08/10/2026,
                          cardápio na hierarquia de 09/10/2026: ver → arrumar → manter, Raio-X e Mapa grátis, Fonte só depois do Mapa);
                          colinhaDoLead escolhe pela etapa e pela resposta. Bloco "Colinha" na Ficha e /crm?ver=colinha
                          (CrmColinha, CrmTrecho, CrmMomento, CrmObjecao). Esteira importada de server/site-mensagem.ts; R$ só do cardápio;
                          Respondido, Fonte e Fonte em dia "sob proposta" para o cliente (o valor fica como base interna);
                          sem cliente fundador nem desconto em troca de depoimento (08/10/2026)
    jornada.ts            PURO (15/10/2026): a jornada do cliente do PRUMO, um passo por vez (quem faz, quando entra, o que tira,
                          prazo, parado depois de N dias), os dois trilhos combináveis (por fora: Encontrado/Respondido/Anúncios/Redes;
                          por dentro: Mapa → Fonte, só equipe) e a oferta por lead (agora, depois, não oferecer, a confirmar).
                          Bloco "Jornada" na Ficha (CrmJornada) e o filtro Passo do Funil; gera
                          docs/referencia/jornada-do-cliente.md (scripts/jornada-guia.ts; o teste falha se ficar para trás)
    financas/             Finanças: Visão (tenho, devo, gastei, orçamento, todo mês), Lançamentos (editor de categoria) e Organizar; saúde e "dados até" em toda tela
  src/estilos/            tokens.css (paleta + modo escuro), casca.css (layout), agentes.css (cartões, botões, campos), design.md
  src/blueprint/          (16/10/2026) tokens.ts (PURO: lê o tokens.css cru, contraste WCAG, pedido de mudança, regras de
                          homogeneidade que o teste aplica a todo CSS de src/), catalogo.ts (códigos BP-… das peças e a
                          anatomia da Ficha), exemplo.ts (lead inventado); a página é src/rotas/DesignSystemRota.vue (/design-system,
                          nos dois perfis, pelo Mais e pelo Ctrl+K). Para mudar o visual, comece por ela e cite o código BP-
  src/auth/google.ts      invólucro fino sobre /api/auth/*
  src/squadAtiva.ts       squad ativa da aba (localStorage)
  src/mochila.ts          sem Vue: "Bloco i/N" e intervalo de dia inteiro, derivados da lista
  src/rosterApi.ts        escritas do roster com erro classificado
  src/contribuicao.ts     sem Vue: formata minutos, resume o turno e o ajuste, monta o ajuste do usuário
  src/components/         Sheet (folha acessível), GameMap (import dinâmico), GrowthCard, AjusteCard,
                          TrocaSquadCard, SquadSelector, SalasPainel, SalaCartao,
                          ContratarFolha, EditarFolha (Arquivar a squad mora nela, AC-25), NovaSquadFolha, ArquivoFolha
  src/office/             geometria isométrica, salas, sprites
  src/office/vista.ts     PURO: Lista|Mapa (localStorage com try/catch, a da Central à parte) e a escala inteira do mapa
  src/office/baloes.ts    PURO (17/10/2026): o texto de cada balão do mapa só com fonte ("Sem sinal" sem ela) e a sala que o PO raiz
                          visita por um robô em falha (destinoDoSupervisor); o GameMap recebe pessoa → balão e `visita`
  src/office/salas.ts     diferença de salas (abrir/fechar/trocar dono), pura
  src/office/postos.ts    PURO: posto de cada pessoa na sala (cadeiras, depois espalhado); tiles livres
  src/office/trabalhadores.ts  trabalhador automático (n8n, timer) → sala, DERIVADO do campo `trabalhador` de fluxos.ts; FORA do prompt (RULES 26)
  src/office/operacao.ts  PURO (15/10/2026): o Escritório como mapa da operação; leads de cada sala do PRUMO por passo da jornada
                          (painelDaJornada no filtro do produto), parados e robôs com o estado do status.json; "Sem sinal" sem fonte
  src/office/salaFinancas.ts  PURO: Sala Finanças (domínio "Finanças") e o balão do PO com % do cartão e do orçamento
  src/office/pixelProps.ts  SVG pixel art dos móveis (mesa, cadeira, planta, estante...)
  src/office/useOffice.ts loop rAF, câmera, atores; passeio ambiente vs. movimento por comando
seed/squad.seed.json      roster inicial — FORA de data/, ver "Volume" abaixo
data/                     volume em produção; nada aqui é versionado
```

### Quatro invariantes que o código assume

**1. O roster é uma árvore de três níveis.** `roster → squad → domínio → { po, integrantes }`. Uma squad = um escritório 3x3; uma sala = um domínio. Contratar um integrante entra na sala existente; criar um domínio ocupa o primeiro slot livre de `unlockOrder` (derivado dos slots ocupados, não de `dominios.length`). Máximo 9 domínios por squad. Squad nasce com 1 domínio + PO (o `GameMap` precisa de `dominios[0].po`). Ids de domínio e de pessoa são únicos entre **todas** as squads e `idsAposentados`; domínio novo é `<squad>--<slug>`, os legados (`po`, `geral`) ficam como estão.

**2. O roster é o prompt.** A árvore **da squad ativa** vai literal para o `systemInstruction` em `orchestrator.ts`; as outras squads entram só por id, nome e escopo, para o modelo poder chamar `sugerir_troca_squad` sem conseguir agendar nelas (o servidor então troca e reprocessa sozinho — ver "Redirecionamento automático de squad"). A squad ativa é escolha da aba (`localStorage`), mandada como `squadId` em `/api/orquestrar` e `/api/mochila`; a rota resolve a squad antes de pedir token e antes do Gemini. Não existe "treinamento do agente" guardado em outro lugar: `papel` + `escopo` de cada `Pessoa` *são* o treino. Persistir o roster já persiste os agentes. O escopo de pessoa (até 1500 caracteres, cinco linhas: Missão, Cuida de, Não cuida de, Ao opinar sobre um compromisso, Sinais de alerta) é o treino; entra em bloco recuado na árvore.

**3. As quests vivem no Google Calendar, não aqui.** `GET /api/mochila` lê do Google a cada chamada. Editar ou apagar no Google reflete na próxima leitura. `quests` no frontend é cache da última resposta, nunca fonte de verdade. A leitura vai 7 dias para trás, mas o card some quando a quest **termina** (`questTerminou` em `src/mochila.ts`, relógio de 30 s): filtro só da vista, a lista cheia segue alimentando "Bloco i/N".

**4. Arquivar não apaga.** Pessoa, domínio e squad arquivados ficam na árvore com `arquivado: true` e somem do prompt, do mapa e da vista (`paraVista` só põe ativos em `dominios`/`squads`; o resto vai em `arquivo`/`squadsArquivadas`). Arquivar grava o id em `idsAposentados` (só acréscimo, e reativar não tira). O PO não se arquiva: substitui-se, e o anterior vira integrante arquivado. `dominios[0]` e a última squad ativa nunca se arquivam. Helpers de turno, Mochila, prompt e slots veem só ativos; os de unicidade de id veem tudo. `agendar_evento` tira a cor do índice no array **cru**, para a cor de um domínio não mudar quando outro é arquivado. Nada no ciclo de vida chama o Google (a rota de renomear squad chama o Tasks depois, fora dele — ver "Passos no Google Tasks").

## Detalhes por assunto

O texto completo de cada assunto está em `docs/referencia/`. **Leia o arquivo antes de
mexer nos módulos da coluna do meio**; abaixo ficam só as regras que não podem se perder.

| Assunto | Módulos | Arquivo |
|---|---|---|
| Marcas, modos, agendamento, Tasks, ajuste | `orchestrator`, `capabilities`, `alocador`, `agenda`, `agendamento`, `calendar`, `ajuste`, `passos*`, `tasks`, `turno` | `agenda-e-turno.md` |
| Agenda no Dell, avisos, lembretes | `acesso`, `dados`, `avisos`, `lembretes`, `vigia`, `sinal-de-vida` | `agenda-no-dell.md` |
| Bot do Telegram | `telegram*`, `transcricao`, `financas/gasto-falado` | `telegram.md` |
| Roster, contratação, Escritório | `squad`, `hire`, `ciclo-de-vida`, `roster-historico`, `src/office/*` | `roster-e-escritorio.md` |
| Perfis, avaliação de turno, Luna, Jev, copiloto, lead quente | `operations`, `RootApp`, `casca/*`, `avaliacoes-turno`, `luna-sombra`, `jev-sombra`, `openrouter-decisoes`, `copiloto`, `lead-quente*` | `perfis-e-experimentos.md` |
| Persistência, Google, porteiro, env | `auth-store`, `dados`, `acesso`, `.env` | `persistencia-e-acesso.md` |
| WhatsApp do número do PRUMO (Evolution API: o observador só lê; o time comercial, ver "Perfis", é o único que envia, e só o 1º contato) | `deploy/dell/whatsapp-observador/evolution-adaptador.py`, `observador.py`, `deploy/dell/evolution/` | `deploy/dell/README.md`, seção "Observador do número do PRUMO" (decisão de 16/10: sem segundo número; a Evolution e o Hermes dividem o 27 99976-2786, protegidos pelas travas de horário e de ritmo) |
| Jornada do cliente do PRUMO (ordem, quem faz, o que oferecer a cada lead) | `src/operations/jornada.ts`, `colinha.ts` | `jornada-do-cliente.md` (gerado; leia antes de atender ou montar algo para um lead) |
| Fluxos do n8n da Mel (os 21, gerador de cada um, ganchos do `n8n.py`, pendências) e oferta nova do PRUMO | `deploy/dell/claude-ops/*`, `prumo-ofertas.json` (registro único das ofertas próprias, 28/10/2026: lido por `ofertas.py` e gerado para o TS em `server/ofertas.gerado.ts` por `scripts/ofertas-gerar.ts`), `nova-oferta.py` | `ops/n8n/CATALOGO.md` e `ops/n8n/NOVA-OFERTA.md` (leia antes de criar ou mudar um fluxo; editar só no editor do n8n se perde na regeneração) |
| Inventário de testes | todos os `*.test.ts` | `testes.md` |
| Service blueprint (Site, PRUMO, Ofertas, Agenda; códigos `SITE-3-B2`; desde 16/10 de uso: Lado a lado, Telas `TELA-nn` e otimizações `OT-nn` com a triagem do Rômulo no banco do Artifact) | `docs/blueprint/servico.json` (fonte), `servico.html` (Artifact) | `docs/blueprint/README.md`; atualize o cartão no mesmo commit em que o passo muda (o teste confere códigos e arquivos); antes de atacar uma OT, leia a decisão dela (`ArtifactData list decisoes`) |

**Agenda e turno.** O modelo decide a intenção (tipo, duração ou esforço, prazo); o servidor
escolhe o horário. `alocador.ts` é PURO (sem `fetch`, relógio, env ou import): mantenha.
`foco` e `baixa_prioridade` gravam `time_blocking`; a baixa prioridade busca até o 7º dia útil
e entra por último na série. Todo evento criado leva as marcas `squadone_*`
(`marcasDoEvento`) e todo PATCH passa por `atualizarPreservandoMarcas` (`If-Match`,
`sendUpdates=none`, `extendedProperties.private` completo). Janela ilegível
(`JANELA_TRABALHO`, `DIAS_TRABALHO`) é 500 `configuracao`, nunca o padrão calado. Os
`agendar_evento` de um turno rodam em série. Falha do Tasks nunca desfaz um compromisso
(vira aviso); em `criar_tarefa` a falha é erro. Redirecionamento de squad: um salto por
turno, 2ª chamada ao Gemini só nesse caso. O ajuste só roda com aprovação e relê tudo do
Google. Gemini: 45 s por tentativa, pior caso de uma geração ≈ 3 min.

**Agenda no Dell.** A agenda só liga no `operations` com `SQUADONE_DATA_DIR` fora do
checkout; no Dell nunca semeia o roster (`RosterAusente`). `SQUADONE_ROSTER_CONGELADO=true`
recusa escrita (409). Acesso: identidade do Tailscale Serve em todo pedido e escrita só da
mesma origem (curl local de escrita precisa de `-H 'Origin: http://127.0.0.1:9120'`). OAuth do
Google só pelo loopback. Avisos: schema da fila do Dell, gravação atômica, nenhum "R$" passa,
P0 e as origens `socorro`, `dell-status`, `backup-dell`, `atualizar-central` e `silmer-drive-sync` ficam numa outbox exclusiva do Telegram, sem expirar e sem WhatsApp mesmo com o bot fora (a lista é a mesma em `dell-status.py`, `lib/aviso.py` e `server/avisos.ts`, com teste de paridade; o prefixo `n8n:` prefere o Telegram mas ainda tem reserva no WhatsApp: decisão de produto em aberto); lembrete e alerta de finanças vão SÓ pelo Telegram (sem som das 22h às 7h,
fila do WhatsApp de reserva; OT-14, 16/10/2026, `SQUADONE_LEMBRETES_PELO_TELEGRAM=false` desfaz), com a chave de 24 h em disco (`avisos-enviados.json`); as falhas do
`dell-status`, o `socorro`, o backup, o `atualizar-central`, o sync do Silmer e os avisos dos fluxos do n8n também, com o token lido do `operations.env`, nunca copiado. Lembretes: a vigia relê a agenda a cada 60 s e nada é agendado
para o futuro; só o `operations` roda vigia (dois processos duplicariam cada aviso).
`POST /api/avisos/varrer` simula sem gravar.

**Telegram.** Webhook (Easypanel) ou polling (Dell, obrigatório no `operations`; nunca chama
`setWebhook`). A rota do webhook é a única fora do porteiro de IP; segredo no header, em tempo
constante, antes de ler o corpo. Allowlist de `chat_id` **fecha quando vazia**; chat fora da
lista recebe 200 sem resposta; só chat privado. Responde 200 na hora e roda o turno numa fila
serial; `update_id` deduplicado; demanda com mais de 10 min de atraso não roda. Resposta em
texto puro. Contratação por botão (uso único, só em memória). Áudio custa uma geração a mais.
"gastei 30 no mercado" é gasto, não demanda, e a resposta não repete o valor.

**Roster e Escritório.** Toda mutação do roster passa por `atualizarRoster()` (fila única);
`writeRoster` grava `.tmp` e renomeia, e copia o anterior para `historico/`. O formato do
arquivo não muda (o Easypanel, reserva fria, o lê). Contratação aplica na squad da proposta.
O Escritório é só frontend e não grava nada; estado de pessoa só com fonte, nunca inventado.

**Perfis.** `SQUADONE_MODE`: `app` (Easypanel) ou `operations` (Dell, só loopback); valor
desconhecido derruba o boot. A Central é somente leitura para **serviços e infraestrutura** (nunca para, reinicia nem reconfigura n8n, Hermes, Docker, systemd),
mas **grava domínio**, por gesto ou regra fixa: o registro do CRM (pelo webhook do n8n), o dia da venda (`venda-do-dia.json`), o estado do vendedor e do lead quente,
os JSONL do copiloto e do Assistente, o contador de uso, a conversa importada, o config do time comercial, as finanças e a fila de avisos. A home (Central de comando no
operations, Hoje no app) mostra no
máximo 3 cartões (RULES 13). Avaliação de turno e Luna em sombra nascem **desligadas** (padrão do código); a Luna em sombra é medição, nunca motor, e nunca vai ao Easypanel.
O Jev em sombra (RULES 27) também: desligado por padrão, só mede, nunca no Easypanel, finanças nunca vão a ele. **Na Mel, segundo a auditoria de 19/10/2026, as duas estão
LIGADAS** (`operations.env`/`jev.env`) **mas sem tráfego novo** desde que o Assistente substituiu o Pedir: desligar ou apontar para o Assistente é decisão do Rômulo. A "Luna é
medição, nunca motor" vale só para a sombra: o `luna-workflows.service` (desde 18/10/2026, autorizado após erros 503 do Gemini) classifica o Caçador do Site e responde a Fonte do PRUMO
para o n8n, com dois contratos fixos e sem ferramenta de escrita (`deploy/dell/README.md`).
O copiloto do PRUMO (15/10/2026, `SQUADONE_COPILOTO=true`) também nasce desligado e só no `operations`: sugere
a próxima mensagem e a proposta (desde 17/10/2026 no cartão do Assistente, não mais numa aba da Ficha), nunca envia; o modelo escolhe itens, os preços vêm do cardápio.
O agente que mantém o lead quente (17/10/2026, decisão do Rômulo: ele segue nos primeiros contatos e no primeiro link; o agente cuida do lead depois
que o link saiu e o lead escreve) está só em **sombra** (`SQUADONE_LEAD_QUENTE_SOMBRA`, desligada, só `operations` com bot e copiloto): decide
responder/escalar/calar, grava JSONL e avisa o Rômulo no Telegram; **nada é enviado ao lead**, e a fase de envio (veto de 3 min, o agente se
identificar como assistente) é decisão aberta dele em `perfis-e-experimentos.md`.
O time comercial (19/10/2026, `deploy/dell/frente-comercial.py` + `server/frente-comercial.ts`) é o único agente que **envia** a lead:
o primeiro contato do Site `pronto`, com o texto do Balcão, pela Evolution do número do PRUMO (o adaptador e o observador da Evolution só leem; quem envia é este). Há **dois interruptores em desacordo**:
o `frente-comercial-config.json` está com `ativo: true` (autorizado pelo Rômulo em 18/10) e o `frente-comercial.timer` está parado na Mel, então nada é enviado; a tela mostra "ativo, mas o ciclo
está parado" (`cicloParado`). Ligar o timer ou pausar o config é decisão do Rômulo. Cada envio pede reserva à Central (a mesma janela e o
mesmo ritmo das telas e do Telegram, contando todos) e passa antes pelo clique rastreado do n8n (o registro de `enviado_em`, da letra e
do `ab_elegiveis`); a Triagem (`revisar`) e o Plus ficam com o Rômulo. Detalhes em `perfis-e-experimentos.md`.
O Assistente da Central (RULES 28 e a exceção da RULES 20, aprovadas em 17/10/2026; MVP construído no mesmo dia e LIGADO
na Mel às 13:40 de 17/10/2026, depois de ele ver funcionando numa instância-sombra: SQUADONE_ASSISTENTE=true e
SQUADONE_ASSISTENTE_HERMES=true no operations.env, cópia anterior em operations.env.antes-do-assistente-20261017): server/assistente.ts (cola: fila serial, tetos, prazo de 4 min, JSONL 600),
server/assistente-ferramentas.ts (leituras e propor_*), server/hermes-consulta.ts (o Hermes consultado), src/operations/assistente.ts
(PURO), server/financas/parece-financas.ts (a régua única de "parece finanças", também do Jev), src/casca/Assistente*.vue e
assistente.ts (o painel); contrato em src/operations/assistente-contrato.ts. Chat que
substitui o Pedir no `operations`; Gemini roteia com leitura, o Hermes é consultado sem ferramentas (`hermes -z -t clarify`,
contexto mascarado pela Central, sem sessão guardada), o Jev só mede; só propõe cartões, nada a lead, finanças e R$ de
proposta fora de modelo; `SQUADONE_ASSISTENTE` e `SQUADONE_ASSISTENTE_HERMES` nascem desligadas.
Fase 2 (17/10/2026): o copiloto entra no painel (leitura `ler_sugestao_do_copiloto`, que nunca gera; o cartão
`sugestao_do_copiloto` leva só a referência do lead e o hash, e AssistenteSugestao.vue relê a sugestão com o preço do
cardápio), "Perguntar sobre este lead" na Ficha abre o painel (no celular, folha por cima da Ficha), e o gasto falado vira
cartão na aba por regra fixa, sem ir ao servidor do Assistente (AssistenteGasto.vue, grava por POST /api/financas/gasto).
Fase 3 pendente: Jev medindo a intenção em sombra e o /a no Telegram.
Na config da Central, `tools.syncthing` é opcional (aposentado em 12/10/2026): ausente, some do painel.
PRUMO como holding (14/10/2026): o PRUMO fica sob o SquadOne e as quatro ofertas sob o PRUMO, no mesmo
CRM (`site`, `prumo`, `iris`, `estampa`). Iris e estamparias saem das abas Clínicas e Estamparias com o
contrato do Prospects (`OFERTA_DE_PROSPECCAO`); os caçadores delas (`deploy/dell/claude-ops/prumo-ofertas.py`)
nasceram desligados, foram ligados em 16/10/2026 e **pausados em 17/10/2026** pelo Rômulo (AC-11 da auditoria: ~1.800
achados num dia e 1.423 parados na Triagem contra 10 envios/dia; religar quando a Triagem cair para ~2 semanas de envio).
Ligados, rodam em dias úteis às 9h, só enchem a aba em Revisar e avisam, nada é enviado; `python3 prumo-ofertas.py --estado|--ativar|--desativar`, a partir de
`~/.local/share/claude-ops`); cliente do PRUMO (a Silmer) nunca vira prospect.
A/B da 1ª mensagem do Site (14/10/2026): a letra só se compara entre leads com o mesmo conjunto
elegível (coluna `ab_elegiveis`, gravada pelo Balcão com a letra) e é equilibrada por nicho; sem
30 envios por braço não há taxa, e o que já foi enviado nunca troca de letra. O histórico sem a
coluna e o follow-up do 05 · Acompanhamento não entram (detalhes em `perfis-e-experimentos.md`).
Mensagem A sem demo (15/10/2026, decisão do Rômulo): a A vale para lead sem demo, inclusive sem recibo
nenhum (o Balcão marca `pronto`); quem responde "quero ver" ganha o "Gerar demo", e o demo sai depois.
Todos os textos das mensagens seguem um guia só, no topo das `VARIACOES` em `site-mensagem.js`.

Plus (15/10/2026, pedido do Rômulo): quinto filtro do CRM (`produto: "plus"`) com os melhores leads, vindos do Catálogo de
Negócios Maçônicos. Não é uma quinta oferta: cada lead leva `plus.oferta` (site = sem site; prumo = com site; iris = psicologia/terapia;
estampa = roupa) e recebe o texto dela, sempre aberto pela saudação da Ordem. Sem planilha: `lerPlus` lê `plus/leads.json` e o estado
sai só dos registros da aba CRM (`plus_enviado`, anotado pelo toque no link de envio; `plus_respondeu`, à mão na Ficha) e, desde
17/10/2026 (OT-13), da conversa guardada (a mensagem dele depois do envio vale como resposta); depois valem
follow-up do 3º dia, 7 dias sem mensagem = Perdido, proposta e sem contato como nos outros funis. A Hoje mostra só os 10 primeiros Plus
(`LIMITE_DO_PLUS_NA_HOJE`; o ritmo do WhatsApp é de poucos por dia), na frente dos do Site. Detalhes em
`docs/referencia/perfis-e-experimentos.md`.

**Persistência e acesso.** Persistência só em `squad.json` e `google-auth.json` (mais o que o
Dell acrescenta); a seed fica fora de `data/`. O browser nunca vê token do Google; `prompt=consent`
é obrigatório; ampliar escopo é refazer `/api/auth/google`, **nunca logout**; só `invalid_grant`
apaga a credencial. Rollback da Fase 1: implantar o commit anterior **e depois** restaurar
`squad.v2.bak.json`. `IPS_PERMITIDOS` vazia desliga o porteiro. Tabela de variáveis de ambiente
no arquivo.

## Deploy

Easypanel, projeto `aladdin`, app `squadone-app`, em `https://aladdin-squadone-app.jicnzg.easypanel.host`. Nixpacks a partir do GitHub (`romulosutil/SquadOne`, branch `main`). **Implantação automática ligada** (24/09/2026): todo push/merge em `main` dispara o build no Easypanel — não existe mais "clicar Implantar" como passo. Dois merges seguidos disparam dois builds e o segundo pode cancelar o primeiro ("context canceled" no log): confira em Implantações se o último ficou verde, e se não ficou clique **Implantar** uma vez. Onde este arquivo ainda diz "clicar **Implantar**", leia "fazer push em `main`". **Apagar** uma variável do Ambiente só vale depois de um build novo: **Implantar** sem commit novo só reinicia a imagem, e o `.env` que o build gravou nela traz a variável de volta pelo `dotenv` (visto em 07/10/2026; ver `deploy/dell/CUTOVER-AGENDA.md`, passo 1).

## Convenções

- Comentários e identificadores em **português**. Comentário explica *por quê*, não *o quê* — a maioria dos blocos aqui documenta a decisão e o que aconteceria sem ela.
- Erros carregam classificação, não só mensagem: `ErroDeDominio.credencial`, `PedidoInvalido` (400) vs `ConflitoDeRoster` (409), `SquadInexistente` (409 + `squadInexistente: true`: a UI recarrega e cai na primeira squad), `SquadArquivada` (filha dela, mesmo 409 + flag), `RedacaoInvalida` (502 + `redacaoFalhou`), `ModeloOcupado` (503 + `modeloOcupado`), `RosterIlegivel` (500), `PrecisaConectar` vs `ErroDeConfig`, `JanelaMalConfigurada` (500 + `configuracao`), `ErroTarefa.motivo` (`precisaConectar`, `configuracao`, `semHorarioLivre`, `agendaIndisponivel`), `ErroTasks` (`ehCredencial` só 401, `escopoInsuficiente`, `apiDesligada`), `ListaSumiu`, `TasksSemResposta`, `EscopoNegado` (callback → `?auth=escopo_calendar_negado`), `AvisoTarefa.motivo: "ampliarAcesso"` (`server/orchestrator.ts`; carregado internamente em `AvisoDoCompromisso`, passos sem o escopo do Tasks: toast com "Autorizar Google Tasks", nunca logout), `TelegramMalConfigurado` (env do bot presente e ilegível: log de erro no boot, bot desligado, resto do app igual), `ErroDeTelegram` (`status` da Bot API, `null` quando nem houve resposta; só `console.error`, nunca derruba o turno nem a rota), `RosterAusente` (503 + `rosterAusente`: Dell sem o roster de produção), `RosterCongelado` (409 + `rosterCongelado`), `AvisoInvalido` (fora do schema da fila ou com R$: o aviso não é gravado), `SinalMalConfigurado` (`DEADMAN_URL` ilegível: log, sem sinal). A UI decide o que fazer pelo tipo.
- Falha de uma parte não derruba o resto: um domínio com erro no Calendar não zera a Mochila inteira; um turno sem credencial ainda roda as capacidades que não tocam o Google; um compromisso que falha não impede os seguintes da série; a checklist do Tasks que falha não desfaz o compromisso.
- Ao terminar tarefa: `git commit` + `git push`. O grafo é do Dell (`graphify-projetos.timer` do systemd, às 03:00, sobre os clones vivos e os espelhos de todos os repositórios do GitHub; o PC consulta por SSH com `scripts/grafo.sh`); no Dell, `graphify update .` depois de mudar código; nunca no Windows. Depois do push, a Central do Dell se atualiza sozinha em até 10 min (`atualizar-central.timer`).

### Remote Infrastructure Directives
- **Sem PR (14/10/2026, autorizado pelo Rômulo: "não é um produto").** Terminou, faz merge direto na `main` e push; não abra pull request. Vale também para o repo `prumo`. Branch remota muito atrás da `main` não entra sem olhar: reporte.
- **O PC novo (Jarvis, Windows, `paiduben` na tailnet) é a máquina de controle desde 04/10/2026**; o Dell é a Mel (`romulo-sutil-corr-a-latitude-7420`, sempre ligado). De 28/09 a 04/10 o próprio Dell controlou, porque o PC antigo queimou (NVMe): o que não tinha sincronizado foi perdido, não procure nem reconstrua. Estado, túneis e checklist: `deploy/pc/README.md`.
- **No PC:** o apelido SSH é `mel` (`ssh mel`, só chave); o antigo `dell-worker` não existe no PC novo. Editor do n8n e code-server só pelo túnel (`deploy/pc/instalar-tuneis.ps1`). Git em clones do GitHub em `C:\Users\sutil\dev`, fora de pasta sincronizada.
- **Numa sessão que roda no Dell** (local ou sessão SSH do app Claude do PC): `docker` direto; `~/SquadOne` é o checkout de produção da Central (não edite nem troque de branch: worktree em `~/.cache/mel-work/` e merge direto na `main`); nunca Git na réplica congelada `~/Pessoal-dev`. Instalar, systemd, Docker, n8n e rclone só numa sessão no Dell. Arquivo do repo que roda no Dell a partir de uma cópia (`~/.local/bin`, `claude-ops`, units...) entra em `deploy/dell/instalados.json` no mesmo commit; depois do merge, reinstale a cópia (`dell-status --instalados` diz o que está atrás).
- Local Windows Docker service is disabled by design. All containers run exclusively on the Dell.
- Never search Windows paths for container binaries or Nginx executables.
- From the PC, run container commands via `ssh mel "docker ..."` or `DOCKER_HOST="ssh://mel"`.
- Container mounts map to `~/workspace/` on the Dell. Nothing is mirrored from the PC anymore (Syncthing has no paired device since 04/10/2026 and was retired on 12/10/2026; `~/Pessoal-dev` is a frozen replica): code reaches the Dell through GitHub.

## Fase 0 do diagnóstico de vendas (19/10/2026)

Decisão do Rômulo já tomada, com os números da retomada de 22–23/10/2026 (fonte única: `REGRAS_DO_RITMO` em `src/operations/trava-de-ritmo.ts`): teto único de 15 primeiros contatos/dia compartilhados, somando time comercial, telas e Telegram; 2/h, 30 min entre envios e dez pendentes por rodada. Nenhuma linha fica congelada; até o 1º pagamento o mix do PM divide os 15 (`docs/PRUMO-DECISOES-PM-2026-10-28.md`). Iris e CRM de estamparia estão prontos; os caçadores continuam pausados (AC-11). Plus é rede quente: teste de 20 envios feitos só pelo Rômulo, fora do executor automático. A abertura com um fato verificável do Raio-X virou a variante D do A/B e o follow-up novo o braço B, ambos aprovados pelo Rômulo em 19/10 para teste ("Aprovar os textos para teste"; o envio segue humano). Registro completo em `docs/referencia/perfis-e-experimentos.md`, seção "Fase 0 do diagnóstico de vendas".
