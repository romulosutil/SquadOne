# Painéis e jornada de atendimento — 25/10/2026

## Evidência da entrevista

Participante real: Rômulo, dono e operador do SquadOne, persona principal.

- O escritório e os dois quadros permitem entender o trabalho do time e suas
  próprias pendências. Ele deseja preservá-los.
- A dificuldade começa depois dos quadros: a experiência não é clara nem linear.
- No uso atual, os agentes fazem o envio inicial e Rômulo conversa diretamente
  com o cliente no WhatsApp. Ele relata não conseguir conduzir o restante pelo CRM.
- Ao abrir um cliente, espera clareza da etapa, como puxar assunto, o que dizer e
  em que momento falar.

Os papéis de operador eventual e cliente atendido são perspectivas hipotéticas;
não houve entrevista com outros participantes nem teste de usabilidade humano
dos painéis novos. A inspeção de interface pelo agente é verificação técnica.

## Direção e critérios de aceite

Preservar cenário, sprites, quadros, câmera e navegação do escritório. Trabalhar
nos painéis abertos por esses acessos.

1. **Orientação:** identificar cliente e etapa, próximo passo, responsável,
   momento, procedimento e resultado buscado.
2. **Mensagem:** mostrar interpretação e texto revisável; continuar no WhatsApp.
   O modelo de mensagem continua vindo do preparo existente no servidor.
3. **Acompanhamento:** distinguir abertura, envio observado, resposta e próximo
   combinado. Abrir um link não confirma envio, aceite ou pagamento.

As três etapas são navegáveis. Espera e conferência exibem o procedimento
pertinente; não sugerem escrever só porque um template antigo ainda existe.
Data registrada sem hora não vira um horário recomendado inventado.

Critério da persona: ao abrir um cliente, Rômulo consegue explicar o que fará,
por que fará naquele momento e o resultado que acompanhará, com referência ao
histórico disponível.

## Fundação visual implementada

| Camada | Função |
|---|---|
| Título da página | Identifica cliente ou tarefa, maior e mais forte |
| Cabeçalho do bloco | Contexto discreto, título de trabalho e descrição opcional |
| Corpo | Instrução principal, dados organizados e procedimento numerado |
| Evidência | Bloco próprio de leitura, com autor, data e trecho |
| Ação | Um primário amarelo, sem sombra pesada; secundárias leves |

Componentes: `PainelOperacional` e `OrientacaoDaConversa`. O catálogo vivo começa
com uma demonstração desses blocos nos estados responder, aguardar e conferir.
Os campos e controles preservam contraste e alvo mínimo de toque. A sombra da
folha mantém sua separação do escritório.

Na ficha, “Agora” volta a preceder os formulários de qualificação, contratação e
receita. Esses formulários ficam em seções nomeadas. A exibição de rascunho e
ação de contato também consulta a orientação atual, além dos gates existentes.

## Verificação e limites

- Tokens, componentes e regras de composição conferidos por testes e tipos.
- Verificação final focada na UI: **98 testes aprovados**, incluindo etiquetas
  reais nos dois temas, orientação de contato, espera, tarefa interna, datas,
  fila, marcos, acompanhamento e glossário. Tipos aprovados.
- Navegador: desktop em 1280 × 1000 e celular em 390 × 844, claro e escuro;
  edição refletida no link do WhatsApp, mensagem vazia bloqueada, espera sem
  contato antecipado e ficha de contexto sem ação conflitante. Sem rolagem
  horizontal da página na largura de celular conferida. Nenhum envio real.
- Contraste real das etiquetas no tema escuro: sucesso 1,73 → **9,21**; atenção
  1,81 → **8,82**. A regressão lê as combinações reais no CSS.
- Suíte geral: **3.230 aprovados, duas falhas, dois ignorados** em 3.234 testes.
  A execução isolada inicialmente teve bloqueios de rede e rename; o resultado
  acima veio da execução com temporários próprios e sem essas restrições.
- Falhas remanescentes: proposta sem conteúdo em `server/jornadas-de-venda.test.ts`
  e `server/plus.test.ts`. Seus grafos de importação não incluem os arquivos
  alterados nesta revisão de UI; não foram alteradas essas regras comerciais.
- Compilação Vite de verificação feita com OAuth Client ID fictício no ambiente
  do comando, com saída em `output/ui-implementacao-2026-10-25/build`. Essa saída é
  exclusivamente de teste, sem autenticação funcional e sem publicação.
- Prévia local em `output/ui-jornadas-2026-10-25/index.html`: dados fictícios,
  APIs substituídas por respostas locais e registros desativados. Não é produção.
- Cópias anteriores dos arquivos editados em `output/ui-jornadas-2026-10-25/antes`.

## Integração no aplicativo após aprovação

O código do CRM usa os mesmos componentes de orientação dos quadros. O ambiente
de validação monta `CrmPanel` diretamente; não mantém uma cópia da interface.

- Vendas tem três entradas principais: Conversas, Primeiros contatos e Entender.
  BI, Funil, Diagnóstico e Resultados ficam dentro de Entender; os endereços
  existentes continuam válidos.
- A fila mostra responsável, momento, evidência e condição em blocos concretos.
  “Conduzir atendimento” abre Orientação → Mensagem → Acompanhamento. A ficha
  completa e seus registros permanecem acessíveis no mesmo diálogo.
- `AtendimentoCliente` compõe a missão e a ficha com a mesma orientação calculada
  por `orientacaoDoAtendimento`. Uma tarefa atribuída ao time conserva responsável
  e condição de espera; não vira sugestão de mensagem para Rômulo.
- O rascunho acompanha a troca entre orientação e ficha e a reabertura do cliente.
  O cache guarda somente texto em memória desta aba, por cliente, oferta e hash
  do contexto, limitado a 16 clientes. Não guarda autorização: cada montagem
  prepara novamente a mensagem no servidor, respeitando os gates existentes.
- `?detalhe=orientacao` e `?detalhe=ficha`, associados a `?lead=`, permitem recarregar
  o modo correto e preservam os filtros. A consulta da ficha continua possível
  com leitura atrasada; ações e registros exigem fonte disponível e recente.
- O escritório, cenário, personagens, câmera e acessos dos quadros foram preservados.

Verificação adicional no navegador: CRM real com APIs substituídas por dados
fictícios, 1280 × 900 e 390 × 844, claro e escuro. Conferidos navegação para
Entender, recarga do endereço da ficha, preservação de texto, tarefa do time sem
link de envio e bloqueio por fonte atrasada. Largura de 320 px também conferida
sem rolagem horizontal da página no atendimento. As etapas ficam em linhas
separadas em telas estreitas para preservar os nomes completos. Console sem
erros na checagem final. Nenhum envio real ou registro externo durante a validação.

Evidências e logs: `output/ui-implementacao-2026-10-25`; capturas desktop e celular,
`testes-ui.log`, `testes-completos.log` e `build.log`. A validação integrada local
fica em `http://127.0.0.1:5176/crm`. O build e o servidor de verificação não foram
publicados no Dell. Alterações de outras frentes neste checkout foram preservadas.

Essa entrega implementa a condução e a hierarquia dos painéis. Não comprova
fechamento de venda, recebimento nem conclusão de todas as fases comerciais do
plano de 23/10. A validação da nova experiência com Rômulo permanece necessária.

## Publicação no Dell — 25/10, 14h18

Após autorização explícita de publicação, a revisão foi integrada à main atual
do Dell no commit `48d8d41e781dbdc587221cf6448575d082761526` e enviada ao GitHub.
A integração preserva o planejador comercial, os avisos de novas respostas, a
preparação interna, os formulários recentes de qualificação/contrato/pagamento
e o BI que já estavam presentes no ambiente. O componente da fila usa o plano
comercial vigente e abre a mesma orientação compartilhada dos quadros.

A validação Linux da revisão passou em **4.106 testes, sem falhas**, tipos e
build. O pacote com as alterações anteriores do Dell preservadas também passou
em tipos e build, usando a configuração OAuth real do ambiente. As contagens
e falhas anteriores desta nota correspondem à validação inicial no checkout
Windows, anterior à integração sobre a main atual.

Publicação somente da interface: assets novos foram instalados antes da troca
atômica do HTML. O pacote do servidor e seu processo permaneceram iguais. Foram
preservados os 88 arquivos de alterações anteriores encontrados na preparação;
os componentes de BI já existentes foram incorporados à revisão versionada.
Serviço e timer do atualizador ativos ao concluir; marcador de versão construída
corresponde ao commit publicado. Grafo AST atualizado no Dell.

Conferência na URL real: escritório, quadros, retorno à sala, ficha completa,
orientação do mesmo cliente das capturas do usuário e largura de 390 px.
Navegador sem erros na conferência; nenhum envio de mensagem nem registro de
fato comercial foi submetido. Não houve alteração de pausas ou limites comerciais.

Backup recuperável privado no Dell:
`~/.local/state/squadone-releases/ui-jornadas-20261025/`.
Evidências locais em `output/ui-implementacao-2026-10-25/`: `publicacao-dell.json`,
`ui-publicada.patch`, `testes-dell.log`, `build-dell.log`,
`publicado-minhas-decisoes.jpg` e `publicado-mobile.jpg`.

Endereço publicado:
`https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/`.
