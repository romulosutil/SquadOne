# SquadOne

SquadOne é uma aplicação pessoal para operar squads, agenda e agentes. A
interface atual materializa cada squad como um escritório com domínios, pessoas
e trabalho agendado.

Este repositório também pode conter protótipos isolados em `prototypes/`. Eles
servem para validar linguagem visual e interação sem alterar fluxos produtivos
ou representar integrações como concluídas.

## Perfis de execução

- `SQUADONE_MODE=app`: aplicação remota normal. Não registra rotas, lê dados
  nem carrega configuração da Central de Operações.
- `SQUADONE_MODE=operations`: perfil local do Dell. Serve a Central em `/`,
  mantém o aplicativo completo em `/squadone` e força o servidor a escutar em
  `127.0.0.1`.

O perfil local usa um arquivo privado baseado em
`config/operations.example.json` e grava projetos em
`SQUADONE_OPERATIONS_DATA_DIR`; ambos ficam fora do Git.

Os arquivos não sensíveis do radar PNCP operado pelo n8n no Dell ficam
versionados em `deploy/dell/licitacoes-automation/`. Segredos, dados coletados,
histórico e backups permanecem exclusivamente no diretório operacional do
worker.

A seção Produção Auto usa `autoDirectory` desse arquivo privado para ler
artefatos locais. Ela também acompanha as evidências já produzidas pela
automação: estado e log do runner em `.logs/`, saúde do Hermes e do WhatsApp e
a lista local de avisos enviados pelo watcher. Os marcos humanos continuam em
`SQUADONE_OPERATIONS_DATA_DIR/auto-production.json`.

O navegador mantém um canal de eventos com o servidor local. Esse canal
atualiza o painel sem recarregar a página, mas não cria uma segunda automação:
a pasta sincronizada, o runner e o Hermes permanecem como fontes de verdade.

A Central separa o resumo diário (`/`), o catálogo escalável (`/projetos`), os
dashboards de projeto e a caixa de leituras do Hermes (`/leituras`). Leituras
locais podem ser fornecidas em
`SQUADONE_OPERATIONS_DATA_DIR/hermes-readings.json`; o contrato de exemplo está
em `config/hermes-readings.example.json`.
