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
