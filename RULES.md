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
13. A home da Central é um resumo: dashboards completos pertencem a rotas de
    projeto, e apenas projetos fixados e leituras recentes aparecem na raiz.
14. Leituras do Hermes exigem projeto, origem, instante e evidência explícitos;
    arquivo ausente significa estado vazio e não autoriza dados demonstrativos.
15. Um slug no estado do watcher prova somente que `hermes send` foi concluído;
    não prova leitura da mensagem. Saúde conectada do WhatsApp prova somente a
    disponibilidade atual do canal, não a entrega de mensagens anteriores.
16. Atualização persistente da Central é somente leitura: o canal SSE pode
    solicitar nova consulta, mas não iniciar runner, serviço, sincronização ou
    envio.
17. Workflows PRUMO usam `ID da empresa` (`company_id` internamente) como
    vínculo canônico. Preparar um link ou uma ação de contato não prova envio;
    somente evidência do canal pode promover `Situação do diagnóstico` de
    `Convite pronto` para `Convite enviado`.
