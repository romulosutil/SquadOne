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
7. Rotas e dados da Central só existem quando `SQUADONE_MODE=operations`; esse
   perfil deve escutar exclusivamente em loopback. Fora do Dell, a Central só é
   alcançada pela tailnet do Rômulo: Tailscale Serve (nunca Funnel) na porta
   HTTPS 8443 repassa ao loopback, e o porteiro de IP (`IPS_PERMITIDOS`) admite
   só loopback e as faixas da tailnet (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`).
8. Health checks operacionais são alvos fixos da configuração local. O
   navegador nunca envia comandos, processos ou URLs para serem executados.
9. Projetos locais ficam fora do Git, exigem nome e destino e recusam esquemas
   diferentes de `http` e `https`.
10. A superfície operacional é somente leitura para serviços: não adicionar
    ações de parar, reiniciar ou reconfigurar infraestrutura.
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
13. A home da Central responde, e nada mais: o que precisa do Rômulo agora e
    o que fazer com cada alerta (retrato de `dell-status`, com `o_que_fazer`),
    como a operação funciona (os fluxos, conteúdo versionado em
    `src/operations/fluxos.ts`), o que há na agenda hoje e onde abrir cada
    ferramenta (os agentes do SquadOne são um botão para o app do Easypanel).
    Dashboards completos pertencem a rotas de projeto.
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
20. Papéis do ecossistema: Claude e Codex controlam e corrigem (SSH, Tailscale,
    Syncthing); o Hermes é o secretário que avisa pelo WhatsApp; o SquadOne é o
    gerente de agendas; o n8n do Dell é o gerente de fluxos e todo fluxo termina
    respondendo a alguém; o Docker do Dell é o servidor de projetos.
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
    (o mesmo script o leria), só origem própria resolveria.
