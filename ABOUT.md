# SquadOne

SquadOne reúne a operação comercial da Prumo e uma aplicação de squads,
agenda e agentes. Na Prumo, a Central abre na carteira com quem precisa de
atenção, o último evento confirmado, o responsável e a próxima ação.

Comece pelo [Estado atual](ESTADO-ATUAL.md) para ver o que está em operação,
como conferir cada fluxo e onde manter a documentação operacional.

Este repositório também pode conter protótipos isolados em `prototypes/`. Eles
servem para validar linguagem visual e interação sem alterar fluxos produtivos
ou representar integrações como concluídas.

## Perfis de execução

- `SQUADONE_MODE=app`: aplicação remota normal. Não registra rotas, lê dados
  nem carrega configuração da Central de Operações.
- `SQUADONE_MODE=operations`: perfil local do Dell. A carteira da Prumo abre em
  `/`. Fichas e links de Vendas em `/crm` continuam válidos. Primeiros contatos
  apresenta pedidos, envios confirmados e resultados incertos dos canais.
  O Escritório fica disponível pelo endereço `/squadone` quando a agenda está
  neste processo. O servidor escuta em `127.0.0.1`.

[Contrato de eventos, evidências e reversão da Central da Prumo](docs/referencia/central-prumo.md).

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
