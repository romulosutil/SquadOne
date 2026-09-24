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
   perfil deve escutar exclusivamente em loopback.
8. Health checks operacionais são alvos fixos da configuração local. O
   navegador nunca envia comandos, processos ou URLs para serem executados.
9. Projetos locais ficam fora do Git, exigem nome e destino e recusam esquemas
   diferentes de `http` e `https`.
10. A superfície operacional é somente leitura para serviços: não adicionar
    ações de parar, reiniciar ou reconfigurar infraestrutura.
11. A Produção Auto deriva artefatos apenas do `autoDirectory` local, lê
    evidências operacionais dos caminhos fixos da configuração e mantém marcos
    humanos em `SQUADONE_OPERATIONS_DATA_DIR`; não gravar esses marcos dentro
    das pastas dos clientes.
12. `publicado.json` é somente um registro local. Disponibilidade pública,
    leitura, aprovação ou publicação pelo cliente exigem evidência própria e
    nunca podem ser inferidas pela interface.
13. A home da Central responde três perguntas e nada mais: o Dell está bem
    (retrato de `dell-status`), o que há na agenda hoje e onde abrir cada
    ferramenta. Dashboards completos pertencem a rotas de projeto.
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
    `wa_link` do Site antes da venda (`pronto` → `enviado`).
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
