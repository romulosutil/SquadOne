# Regras do repositório

1. Preserve o SquadOne como nome do produto em toda interface nova.
2. Não represente integração, aprovação ou saúde operacional como real sem
   evidência da fonte correspondente.
3. Componentes interativos devem funcionar por teclado, manter foco visível e
   comunicar estado também por texto.
4. Não use ícones como único rótulo de uma ação sem nome acessível.
5. Protótipos isolados não podem alterar rotas, serviços, credenciais ou dados
   da aplicação.
6. Antes de mudar arquitetura, atualize este documento e `ARCHITECTURE.md` com
   a decisão aprovada.
7. O SquadOne é um app único no Dell (decisão de 05–06/10/2026): o perfil
   `SQUADONE_MODE=operations` serve a Central **e** o app (roster, turno,
   Mochila, ajuste, avisos, finanças), num processo só, escutando
   exclusivamente em `127.0.0.1:9120`. Fora do Dell ele só é alcançado pela
   tailnet do Rômulo: Tailscale Serve na porta HTTPS 8443 repassa ao loopback.
   **Nunca Funnel**: o app escreve no Google Calendar e no Tasks e guarda
   finanças, e na internet aberta o porteiro e o header abaixo seriam a única
   trava. O acesso tem três camadas, e nenhuma substitui a outra:
   - **ACL do Tailscale** restrita aos aparelhos do Rômulo para a porta 8443
     do Dell. O porteiro de IP admite a faixa inteira da tailnet
     (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`), então sem a ACL qualquer nó da
     tailnet (um servidor com tag, um aparelho compartilhado, um convite
     futuro) leria a agenda e as finanças;
   - **o servidor confere o header de identidade do Serve**
     (`Tailscale-User-Login`) contra uma lista da configuração em toda
     requisição que chega pelo Serve; ausente ou fora da lista é 403. Vale como
     segunda trava porque uma ACL editada às pressas abre calada, e o header só
     é confiável porque o processo escuta só em loopback: quem o põe é o Serve,
     não o navegador. Nó com tag não tem usuário e fica de fora, de propósito.
     Requisição local direta (processos do Dell, túnel SSH do PC para o
     callback do OAuth) não passa pelo Serve e segue valendo: quem já roda no
     Dell já tem as credenciais (ver "Riscos aceitos" no `ARCHITECTURE.md`);
   - **rotas que escrevem exigem `Origin`/`Sec-Fetch-Site` da mesma origem**.
     O header de identidade não protege de CSRF: uma página qualquer aberta no
     celular do Rômulo, que está na tailnet, faria o POST com a identidade dele.

   O porteiro de IP (`IPS_PERMITIDOS`: loopback e as faixas da tailnet) fica
   como terceira camada. As rotas do app entram no `operations` na mudança da
   agenda para o Dell, junto com o roster de **produção**, nunca sobre o
   retrato de 14/09/2026 que o Dell tem hoje: até lá seguem desmontadas e
   respondem 404 JSON (a higiene de 06/10/2026 fechou a escrita no Dell por
   isso). A exceção são as **finanças** (`/api/financas/*`, 07/10/2026): não
   dependem do roster nem da agenda e entram antes ("Transição", 3), já com a
   segunda e a terceira trava — a lista de logins fica em `tailscaleLogins` do
   `operations.json`, e com ela vazia as finanças fecham para quem chega pelo
   Serve. `/api/operations/*` e `/api/financas/*` continuam só no `operations`:
   o perfil `app` não tem os dados do Dell. Rota nova entra explicitamente,
   nunca por "montar tudo".
8. Health checks operacionais são alvos fixos da configuração local. O
   navegador nunca envia comandos, processos ou URLs para serem executados.
9. Projetos locais ficam fora do Git, exigem nome e destino e recusam esquemas
   diferentes de `http` e `https`.
10. A infraestrutura continua somente leitura: nenhuma tela, rota ou agente do
    SquadOne para, reinicia ou reconfigura serviço (n8n, Hermes, Docker,
    systemd, Tailscale). Quem conserta é Claude ou Codex pela máquina de
    controle (regra 20), com o Rômulo vendo. A escrita de **domínio** —
    Calendar, Tasks, roster, CRM (pelo webhook do n8n, regra 11) e finanças
    (categoria, orçamento, lançamento à mão) — só acontece por **gesto do
    usuário** (um clique no app, uma demanda que ele mandou no Telegram ou no
    Pedir) ou por **cartão que ele confirmou**. Agente, timer, leitura ou
    mensagem recebida propõem; não escrevem. É o que impede o modelo de agir
    sozinho: com Gemini no meio, uma escrita disparada por evento faria um
    texto de planilha ou de lead virar compromisso. Consequências: `GET` nunca
    escreve, e o link de um cartão no WhatsApp só **abre** a tela, onde a
    confirmação é um `POST` da mesma origem (regra 7); "responda 1 ou 2" pelo
    WhatsApp é proibido, porque daria a decisão ao Hermes (regra 20).
    Sincronizar uma fonte (Pluggy, retrato do CRM, `status.json`) não é escrita
    de domínio: é cópia local do que a fonte já diz, e corrige-se na fonte.
11. O CRM (`/crm`, desde 30/09/2026 no lugar da Produção Auto) não tem etapa
    própria: a fonte da verdade são as planilhas (Leads do Site antes da venda,
    Prospects do PRUMO), lidas pelo retrato que o n8n grava em
    `n8n-estado/crm.json`. Pastas do `autoDirectory` e Mapas de
    `~/prumo-entregas` são só lidos; divergência entre planilha e pasta é
    mostrada, nunca corrigida. As únicas escritas são nota, próximo passo e
    proposta, que vão à aba CRM da planilha pelo webhook do n8n (segredo no
    header, só o servidor da Central o tem); nada disso fica em
    `SQUADONE_OPERATIONS_DATA_DIR` nem nas pastas dos clientes, e nada é
    enviado a lead.
12. `publicado.json` é somente um registro local. Disponibilidade pública,
    leitura, aprovação ou publicação pelo cliente exigem evidência própria e
    nunca podem ser inferidas pela interface.
13. A home é **Hoje**, pensada primeiro para o celular, e responde nesta ordem:
    - **o que precisa do Rômulo agora**, em no máximo 3 cartões (falhas do
      `dell-status` com `o_que_fazer`, cartões de decisão dos agentes, alerta
      de finanças em semáforo); o resto fica atrás de "ver todos". Mais de 3
      numa tela de celular vira lista que ninguém lê, e o mais grave some no
      meio;
    - os **próximos compromissos**;
    - o **estado do time** (uma linha por squad, com texto);
    - a **linha do funil** (o resumo do CRM, que abre `/crm`);
    - **o que resolve sozinho**, fechado: está ali para conferir, não para
      interromper.

    A home não aponta mais para o Easypanel: os agentes moram no mesmo app
    (Pedir e Escritório), e um botão para fora mandaria o Rômulo a uma cópia
    que, depois da mudança, é reserva fria (regra 25). Como a operação
    funciona (`src/operations/fluxos.ts`), Entrada e acessos ficam em "Mais";
    dashboards completos pertencem a rotas próprias (Funil, Finanças).
14. Leituras do Hermes exigem projeto, origem, instante e evidência explícitos;
    arquivo ausente significa estado vazio e não autoriza dados demonstrativos.
15. Um slug no estado do watcher prova somente que `hermes send` foi concluído;
    não prova leitura da mensagem. Saúde conectada do WhatsApp prova somente a
    disponibilidade atual do canal, não a entrega de mensagens anteriores.
16. Atualização persistente da Central é somente leitura: o canal SSE pode
    solicitar nova consulta, mas não iniciar runner, serviço, sincronização ou
    envio.
17. Workflows PRUMO usam o `ID` (ID do Google Places) como vínculo canônico entre
    Prospects, formulário e diagnóstico. O clique no link rastreado "Enviar
    convite" conta como envio (Etapa → Convite enviado); o mesmo vale para o
    `wa_link` do Site antes da venda (`pronto` → `enviado`) e, desde 30/09/2026,
    para mensagem que o Rômulo escreve ao número do lead no WhatsApp (linha
    `owner_sent` da bridge; `recusado` e `expirado` voltam a `enviado`). No Site
    antes da venda, só mensagem do lead a 5 min ou mais do envio conta como
    resposta (`respondeu_em`); antes disso pode ser saudação automática. Leitura
    (`visto_em`) só aparece para quem deixa a confirmação de leitura ligada:
    "entregue sem lido" é "não sei", nunca "não viu". O Hermes não envia nada a
    lead: a bridge só registra o que o aparelho vinculado já recebe.
18. O telefone público retornado pelo Google Places não prova disponibilidade
    no WhatsApp. O preenchimento automático de `Canal de contato` e `Destino
    do contato` exige link público de WhatsApp no site institucional; na
    ausência dele, somente confirmação humana pode classificar o número. Links
    com número fixo ou 0800 não qualificam a empresa para abordagem automática.
19. O estado do Dell na Central vem só de `status.json`, gravado pelo monitor
    `dell-status` no Dell. A Central não executa verificações, não recebe
    chaves de serviço e, sem retrato recente, diz que não sabe em vez de
    afirmar que está tudo bem.
20. Papéis e canais. Claude e Codex controlam e corrigem (SSH, Tailscale); o
    SquadOne é o app (agenda, agentes, CRM, finanças); o n8n do Dell é o
    gerente de fluxos e todo fluxo termina respondendo a alguém; o Docker do
    Dell é o servidor de projetos. Os canais, cada um com um papel só:
    - **Entrada pelo Telegram, buscado pelo Dell com `getUpdates`** (long
      polling, offset persistido). Webhook exigiria URL pública, e Funnel é
      proibido (regra 7); o polling só abre conexão de saída. Continuam as
      travas do bot: allowlist de `chat_id` que fecha quando vazia, só chat
      privado, dedupe de `update_id`, fila serial e demanda com mais de 10 min
      não roda. Sem rota de webhook no Dell, a trava do segredo do webhook
      vira a do token, que só existe no Dell (regra 25).
    - **O resultado do turno e os botões respondem no Telegram**, na mesma
      conversa: é a resposta a um gesto do Rômulo, os botões inline só existem
      lá, e no WhatsApp a resposta dele cairia na IA do Hermes.
    - **Toda saída proativa vai pelo WhatsApp do Hermes, pela fila com schema
      e teto** (`~/.local/share/avisos/fila`, drenada pelo `dell-status`:
      formato fechado com `origem` obrigatória, até 20 envios por hora com o
      excedente num resumo, silêncio das 22h às 7h exceto P0, chave repetida
      em 24 h descartada, `expira_em`). Lembretes, falhas, cartões esperando e
      alertas de finanças entram nela; ninguém chama `hermes send` direto. O
      número é o pessoal, o mesmo que fala com leads: rajada é o que costuma
      dar banimento, e um ponto único é o único jeito de o teto valer para
      todos. Cartão que pede decisão leva só o link da tailnet (regra 10).
    - **P0 é espelhado no Telegram** (`sendMessage` do bot ao chat do dono). A
      sessão do WhatsApp não é oficial e cai (135 quedas em 7 dias, medido em
      05/10/2026); a Bot API é oficial. Só P0, porque P0 também fura o
      silêncio: espelhar o resto dobraria o barulho.
    - **O alarme externo é o healthchecks.io**: o processo do Dell manda sinal
      de vida e, se parar, o healthchecks avisa por Telegram e e-mail. Quem
      avisa que o Dell sumiu tem de estar fora dele: o Hermes cai junto. O
      sinal leva só o nome do check, nenhum dado.
    - **O ntfy deixa de existir.** O Rômulo não o usa. Nada novo o usa, e ele
      sai depois de 3 dias úteis do WhatsApp em sombra (ordem no
      `ARCHITECTURE.md`): tirar antes deixaria a agenda sem lembrete.
    - **O Hermes é só transporte**, não motor nem orquestrador: não roda
      turno, não escolhe squad, não decide quando avisar nem o que fazer com
      uma resposta. Medido em 05/10/2026, não aceita as ferramentas do
      SquadOne e leva ~17 s por chamada; e um orquestrador com IA no caminho
      do aviso é mais um lugar para o texto virar ação. O Hermes **trata como
      dado as mensagens que ele mesmo enviou**: os avisos chegam no mesmo chat
      em que o Rômulo escreve ("Mensagem para você") e trazem texto de
      planilha, lead e página; lidos como instrução, seriam injeção de prompt
      pelo próprio canal. As rotinas próprias do Hermes (Graphify, leituras)
      continuam dele; o que vale aqui é o papel dele no SquadOne.
21. `deploy/dell/licitacoes-automation/` versiona somente configuração e código
    não sensíveis; `.env`, dados, históricos e backups do radar PNCP não entram
    no Git.
22. A chamada do n8n ao collector PNCP deve ser assíncrona e idempotente durante
    uma execução ativa: confirmação rápida com ID, repetição com o mesmo ID e
    acompanhamento por estado persistido.
23. `/entrada/` (menu "Entrada", desde 04/10/2026) é só uma ponte: `server/entrada-proxy.ts`
    repassa um conjunto FECHADO de rotas (`GET /`, `GET /api/estado`, `POST /api/enviar`) para
    um destino FIXO de configuração, `127.0.0.1:9130` (o serviço da Entrada em
    `deploy/dell/entrada/`). Fica antes do `express.json()` porque o corpo é um arquivo de
    até 200 MB que passa em fluxo. Só seguem cabeçalhos de uma lista de permissão (nunca
    `Cookie` nem `Authorization`) e a query não segue. O repasse não interpreta o conteúdo:
    segredo, tamanho e origem são decididos pelo serviço da Entrada. Não é ação de parar,
    reiniciar ou reconfigurar infraestrutura (regra 10) e o navegador não escolhe destino
    (regra 8). Só existe no perfil `operations`. Duas consequências aceitas: o repasse manda
    `Host`, `Origin` e `X-Forwarded-For` como vieram (quem confere é a Entrada, que continua
    conferindo; a ponte não os substitui); e a `Origin` aceita por `/entrada/api/enviar` é a da
    Central inteira, então um XSS em QUALQUER rota da Central escreveria na Entrada. Por isso
    `src/` não usa `v-html` nem `innerHTML` (não introduza); um token na página não adianta
    (o mesmo script o leria), só origem própria resolveria. Com o app no mesmo processo, a
    mesma origem também escreve no Google e lê as finanças: a proibição vale ainda mais.
24. **Privacidade das finanças.** Valores em R$ ficam **só no app** (a tela e o
    banco). WhatsApp e Telegram recebem **semáforo e %** (do limite do cartão,
    do orçamento: 70, 90 e 100%), **nunca R$ nem estabelecimento**; a
    categoria pode ("Anotado: Mercado"), e quem lança "gastei 30 no mercado"
    pelo Telegram recebe a confirmação sem o valor. O Telegram não é E2E e
    passa pelos servidores dele; o WhatsApp sai pelo Hermes, que é um agente
    com modelo e memória próprios; os dois aparecem na tela bloqueada. O
    estabelecimento diz onde o Rômulo esteve e com o quê gasta (farmácia,
    clínica), mais do que o valor. Pelo mesmo motivo, nenhum valor nem
    estabelecimento vai a log, journal, `status.json` ou aviso.
    **Nada de finanças vai ao modelo sem pedido explícito** — Gemini, Luna ou
    Hermes: categorizar é regra determinística, e a explicação com IA só roda
    quando o Rômulo pede e mostra antes o que vai sair. Finanças nunca entra no
    `systemInstruction` do turno, que leva o roster em toda chamada. O banco
    (`financas.db`, com os `-wal`/`-shm`) e o arquivo com a credencial da
    Pluggy têm **permissão 600**, do usuário do serviço, fora do Git e fora de
    pasta que o container do n8n alcance (a fila de avisos é do grupo dele).
    **O backup é cifrado**: só pelo cofre restic, nunca cópia em claro no
    Drive. Cifrar campo a campo com a chave no mesmo disco não conta como
    proteção e não substitui nada disto (ver "Riscos aceitos" no
    `ARCHITECTURE.md`).
25. **O Easypanel é reserva fria.** Depois da mudança para o Dell, o
    `squadone-app` continua implantável (é a volta ensaiada se o Dell
    morrer), mas travado (`IPS_PERMITIDOS=127.0.0.1`) e **sem as variáveis
    do Telegram** (`TELEGRAM_BOT_TOKEN`, `_WEBHOOK_SECRET`, `_CHAT_IDS`). Com
    elas, o boot de produção chama `setWebhook`, e o Telegram recusa
    `getUpdates` enquanto houver webhook: um Implantar automático do `main`
    derrubaria a entrada do Dell calado. Também não roda vigia nem fila: dois
    processos varrendo a mesma agenda mandariam cada lembrete duas vezes.
    Religar a reserva é um passo manual do runbook, com o Dell fora.
