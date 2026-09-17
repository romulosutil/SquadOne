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

A seção Produção Auto usa `autoDirectory` desse arquivo privado para ler
artefatos locais e mantém seus marcos manuais em
`SQUADONE_OPERATIONS_DATA_DIR/auto-production.json`.
