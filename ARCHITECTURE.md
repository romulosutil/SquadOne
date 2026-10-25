# Arquitetura

## Encontrado — qualificação e materiais (segundo lote, 25/10/2026)

A qualificação observada é uma projeção reconstruível das mensagens comprovadas,
separada da confirmação humana do CRM. Um leitor local de padrões e respostas às
perguntas originais prepara observações e pedidos com referências; o código escolhe
perguntas, aplica restrições e conserva preço/escopo no catálogo. A projeção é
persistida somente pelo executor; GETs leem e validam resultados. Nenhuma conversa
é enviada a um novo modelo ou serviço externo para essa leitura.

Pedidos de material têm registro operacional durável, identidade da mensagem de
origem e execução restrita aos geradores existentes. O worker técnico recebe
autorização atual da Central antes de reservar o trabalho. Resultado técnico não
é envio, proposta ou aceite; a entrega pelo canal revalida contexto, identidade e
recibo de qualidade dos bytes finais. Não há novo CRM editável, permissão de
prospecção ou aprovação da própria qualidade pelo gerador.

## Automação restrita do Encontrado (25/10/2026)

A Central decide a política por oferta e os executores aplicam seu resultado.
O primeiro lote reutiliza a inbox e a prova de identidade do atendimento para
responder perguntas padronizadas do Encontrado a novas entradas, com política
privada explícita, corte temporal, catálogo versionado, reserva durável anterior
ao transporte e trava compartilhada com a tomada humana da conversa. n8n não
ganha outro parser de condições. A fila humana recebe exceções; execução e
esperas técnicas ficam com o time. Recibo de envio não cria qualificação humana,
proposta, aceite, cobrança nem recebimento. As integrações futuras de Asaas e
Autentique permanecem separadas da execução de mensagens.

## Qualidade da Prumo (21/10/2026)

A Prumo é a fonte dos critérios, nomes e aceite; o SquadOne executa. Leia `docs/referencia/organizacao-prumo.md` e `../prumo/00-contexto/organizacao.md` antes de criar ou alterar ofertas e fluxos. Site e Raio-X passam por `deploy/dell/lib/qualidade_prumo.py` antes de publicar. Homologação é identificada; Profissional exige todos os obrigatórios, IQS completo, referência e manifesto exatos. O gerador não publica diretamente nem assina aceite; avaliações aprovadas ficam na área privada, fora da pasta do lead. O Mapa continua como rascunho, sem envio automático.

`prumo_contexto.py` injeta o guia canônico em cada entrada dos workflows Prumo/Site e seus subworkflows. O `n8n.py` mantém essa integração nas regenerações; `prumo-contexto.timer` confere a sincronização a cada 15 minutos e preserva os fluxos pausados. A cópia operacional é identificada por SHA256 em `~/.local/share/prumo-contexto/`.

CRM ao vivo (21/10/2026): `server/crm-ao-vivo.ts` compartilha observadores do
diretório das conversas e do retrato entre conexões de `GET /crm/ao-vivo`.
Eventos SSE agrupados em 200 ms transportam apenas um sinal de atualização,
sem conteúdo ou identificadores. `useSinalDoCrm` aciona a releitura serializada
na Central e em Vendas; consulta de segurança a cada 15 s, retorno de foco e
reconexão cobrem indisponibilidade. A ficha relê mensagens quando o resumo muda,
mantendo expansão e rascunhos e cancelando requisições do cliente anterior.
O acompanhamento da sala usa evidência observada; notas manuais são complementos
ou contatos por fora. Mensagem capturada não conclui automaticamente uma tarefa
interna, um compromisso ou um desfecho comercial.

Entrada e alertas resilientes (19/10/2026): o adaptador existente mantém eventos úteis em espera privada quando não pode correlacionar com uma lista atual de leads. Mapa LID e identificação de processamento persistem entre reinícios; drenagem e gravação coordenam concorrência, com permissões restritas e sem dados pessoais nos logs. Falha de persistência não retorna sucesso ao emissor. O observador continua sendo o caminho da conversa e do encaminhamento comercial. O mecanismo existente de avisos conserva pendências críticas e as encaminha exclusivamente pelo Telegram, com nova tentativa se o transporte falhar; não depende do WhatsApp comercial. Não há novo serviço de prospecção, nova linha ou reativação de caçador.

AARRR comercial (19/10/2026): funções puras calculam o placar a partir de confirmações na aba CRM existente. Valor de proposta, pagamento, correção, origem, motivo de perda, retenção e indicação são eventos distintos e auditáveis. O preço é determinado pelo catálogo da oferta e seus componentes, em centavos; o Iris usa a quantidade confirmada de fichas ativas e as faixas marginais. Não há valor livre do modelo ou preço presumido para Estamparia. A Ficha exige confirmação humana e aguarda a releitura da fonte; Números mostra aquisição e ativação no período indicado, recebimentos explícitos e a Estrela-guia global da semana de São Paulo. Mensalidade recebida não comprova atividade no terceiro mês. A indicação gera apenas um próximo passo para o Rômulo. Valores e referências comerciais ficam fora dos dossiês enviados aos modelos; Finanças pessoais não fazem parte dessa leitura.

Qualificação e cadência comercial (19/10/2026): o CRM existente continua sendo a fonte, sem banco paralelo de vendas. O tipo `spiced` grava apenas a confirmação humana; sugestões e citações continuam no armazenamento privado do copiloto. Propostas novas são montadas somente com dor, impacto e decisor confirmados. A regra mensal do Iris é um espelho versionado da fonte por ficha ativa, separado da tabela PRUMO e sem dependência de outro checkout em runtime. Os toques da cadência usam registros duráveis vinculados à negociação e ao degrau, compartilhados pela Central e pelo vendedor; a memória diária não comprova que um degrau de outro dia foi cumprido. Datas comerciais usam São Paulo; dias úteis seguem seg–sex do expediente existente. A expiração de proposta sem retorno no décimo dia é uma classificação derivada, protegida por pausa, próximo compromisso e retorno humano. Demos preservam suas proteções e revalidam o CRM antes de qualquer exclusão ou pausa.

Escritório integrado (18/10/2026, refinamento do Rômulo): o cenário usa toda a altura, com navegação flutuante e acesso verde separado ao Assistente, sem imitar o estado ativo de uma página. No desktop o Assistente abre à direita e pode ser recolhido; a preferência é lembrada neste aparelho. No celular abre sob demanda em card central, enquanto a sala ampliada pode ser explorada horizontalmente, sem rolagem da página. O card de agente abre o canal direto; conversas de clientes têm acesso próprio, e agenda, delegação e operação ficam em seções secundárias. Substitui as três abas Conversas/Conversar/Trabalho e a moldura modal do Assistente no desktop; preserva cards centrais nas demais áreas, observação de fatos pelas integrações e proteções do serviço comercial.

Escritório imersivo (18/10/2026, correção explícita do Rômulo): a home é um único ambiente aberto em pixel art, com os agentes animados e clicáveis. Dois telões compartilhados mostram as decisões e o andamento do time e as conversas que dependem do usuário; abrem detalhes sobre o cenário. Navegação fixa no rodapé em todas as larguras: Escritório, Assistente, Vendas e Mais. Sem trilho lateral nem campo de busca visível. Vendas, Assistente e detalhes dos agentes abrem em cards centrais, com margem ao redor, botão Fechar, clique fora e Escape; o Assistente conserva seu escopo geral. Mais dá acesso a Agenda, Finanças, Entrada e Configurações. A sala permanece montada atrás dos painéis, sem rolagem de página ou zoom manual; painéis têm uma única região de rolagem. A indicação “Sua vez” abre uma missão comercial: objetivo, contexto e marcos observados nas integrações. Informar algo ao time registra contexto, sem presumir conclusão ou envio. A direção visual é um escritório aconchegante com madeira, plantas, luz quente e sprites existentes sobre cenário ilustrado. Esta decisão substitui a home de cartões com escritório recolhido, sem alterar o serviço comercial autorizado ou suas proteções.

Central orientada à venda e time de primeiros contatos (18/10/2026): a interface separa ação comercial de configuração e consulta; usa leitura automática com requisições serializadas, prazo, retorno de visibilidade e preservação do último retrato. Um processo de domínio no Dell prepara uma fila diária com avaliações estruturadas de Diego, Elisa e Carla pelo motor já integrado. Persiste plano, limites e recibos antes/depois de cada envio; revalida CRM e conexão, envia somente primeiro contato e nunca repete resultado ambíguo. O app lê o retrato `frente-comercial.json`; a configuração de negócio permite pausar o envio, sem expor segredos ou comandos de infraestrutura. O acompanhamento de conversas é derivado de eventos das integrações: falta de evidência permanece explicitamente não confirmada.

Conclusão dos fluxos de produto (18/10/2026): `/api/operations/crm/decisao/confirmar` relê o contexto, valida seu hash e registra revisão de classificação ou confirmação de convite pela rota de notas já existente da aba CRM. Não há novo armazenamento de domínio nem alteração dos workflows: a visão interpreta apenas notas identificadas e validadas, preservando a classificação original da planilha e o histórico. Revisões se vinculam à classificação de origem e novas interações pedem conferência. Confirmação de convite fornece conteúdo e instante real do envio; abrir `wa.me` só conta tentativa no ritmo. Duplicidade e resultado ambíguo bloqueiam repetição automática. Adiamentos da triagem são preferências locais por 24 horas, explicitamente identificadas e recuperáveis. Avisos do cabeçalho abrem a folha de pendências existente. Controles visuais ficam em uma dobra no celular, preservando mapa e sala.

Preparo de amanhã (18/10/2026): atalho por lead relê o contexto e exige plano ativo para amanhã em São Paulo e hash atual no servidor. Só propõe rascunho, respeitando espera/recusa e sem alterar combinado. Revisão pode guardar texto neste aparelho, identificado por oferta/lead/data/hash; não equivale a envio ou aceite do cliente. Antes da data, o cartão não libera WhatsApp com texto; leitura da conversa segue acessível. Na data, nova conferência do contexto e confirmação humana antes de abrir. Sem lote automático ou novos filtros.

Próximos dias na sala (18/10/2026): leitura dos próximos passos ativos agrupa amanhã e datas posteriores pelo calendário de São Paulo, sem novos filtros, limite de horizonte ou alteração automática. Hoje mantém prioridade; futuros não duplicam outras pendências. Preparar antecipadamente não autoriza antecipar contato. Conclusão, reagendamento e WhatsApp mantêm as confirmações existentes.

Conclusão e reagendamento na sala (18/10/2026): revisão explícita vinculada ao hash atual do lead; servidor recusa contexto alterado e cliques repetidos durante atualização. Reagendar grava um único proximo_passo; concluir grava proximo_passo vazio com a data real da conclusão, limpando o plano ativo sem registrar ganho ou perda. As regras de prazo de Vendas continuam valendo. Vazio sem data continua sendo limpeza legada. Histórico distingue conclusão de limpeza. A fila só muda com a leitura da fonte, sem ocultação otimista; falha ambígua bloqueia repetição automática.

Retomadas na sala (18/10/2026): próximos passos datados da fonte existente destacam hoje e atrasados, sem duplicar fila ou inferir envio pendente por silêncio. Interação posterior ao plano exige conferência. Preparar retomada relê lead e valida contexto e vencimento no servidor; propõe mensagem e revisão do plano, sem envio ou gravação automáticos. Desktop limita a coluna da sala à altura disponível com rolagem própria; celular mantém rolagem única.

## Teto operacional de primeiros contatos (18/10/2026)

Pedido do Rômulo: até 100 por dia. A regra única em
`src/operations/trava-de-ritmo.ts`, já consumida pela Central e pelo vendedor,
passa a 100 por dia de São Paulo, 12 por hora móvel e 5 minutos entre contatos.
Isso permite 100 aberturas distribuídas entre 8h e 16h15, sem alterar o expediente
ou automatizar o envio. O teto diário substitui a rampa semanal 10/20/30.
Pausa por restrição continua prioritária e não é liberada pelo botão de horário.
Mantém retrato, memória compartilhada e reforço local para a contagem existente.
Abrir um link é uma tentativa contada de forma conservadora, não prova de envio.
Envios feitos diretamente no celular podem não aparecer nessa contagem.
Os números são escolhas operacionais, não limites antispam publicados pela Meta.
A interface deixa explícito que não garantem ausência de bloqueio e que o
destinatário precisa ter autorizado o contato. Esta alteração não migra para a
Cloud API e não realiza envios.

Retorno como base da resposta (18/10/2026): o agente usa a nota humana identificada de retorno relida da fonte existente, sem copiar texto no comando. A sala espera a nota aparecer; o servidor valida o hash do contexto e a presença do retorno antes de gerar. Retornos e mensagens são dados, nunca instruções. Próximo passo e abertura no WhatsApp continuam propostas revisadas e confirmadas separadamente. A navegação entre registro e conversa compartilha uma âncora estável; no celular há uma só rolagem da página, sem abas sobrepostas ou saltos por atualização assíncrona.

Confirmações na sala (18/10/2026): envio e retorno são fatos informados explicitamente pelo operador, registrados como notas identificadas pela rota de registro existente. Próximo passo exige texto e data confirmados, sem mudar etapa ou enviar mensagens. A abertura do WhatsApp não registra envio. Erro de transporte não autoriza repetir automaticamente a gravação. Formulários ficam vinculados ao produto e lead, com prévia antes de confirmar.

## Revisar resposta e avançar a venda na sala (18/10/2026)

Autorizado pelo Rômulo: cartões de mensagem e sugestões do copiloto ganham,
somente na sala e para o lead correspondente, editor e confirmação de contexto.
Uma releitura do CRM valida destinatário e recência antes de montar wa.me com
texto editado. Alterar texto invalida a autorização. O WhatsApp envia só pelo
gesto do operador; abrir não muda CRM nem significa envio. O passo seguinte
abre o registro inline na sala para confirmar envio, retorno ou próximo compromisso. Cartões
de próximo passo conservam confirmação separada. A resposta atual fica fora da
rolagem do histórico; conversas anteriores são secundárias. Critérios de avaliação:
retomar contexto após interrupção, mensagem útil à decisão do cliente, envio
humanamente confirmado e avanço/fechamento comprovado no CRM, nunca contagem de cliques.
O GET somente leitura `/crm/resposta/contexto` devolve hash SHA-256 e destino,
sem transferir o retrato completo dos leads a cada revisão no celular.
Rascunho editado e sinal de abertura ficam em sessionStorage por cartão, sem
confundir retomada com envio confirmado; editar exige outra conferência.

## Contexto de lead na sala (18/10/2026)

Decisão do Rômulo: a seleção na lista de leads abre a conversa contextual com
identificação visível da empresa, Ficha e WhatsApp. Reutiliza ContextoDaPagina.lead;
o servidor lê ler_lead antes da geração, com a mesma máscara e fontes do Assistente.
O canal persistido e a instância do cliente incluem produto/id do lead, impedindo
mistura entre empresas, inclusive ao trocar durante uma resposta. Sem CRM ou lead
válido não há análise presumida. A conversa geral por agente continua disponível.

## Conversa por agente no PRUMO (18/10/2026)

Decisão aprovada pelo Rômulo: o sprite abre conversa dentro da sala. O contrato
do Assistente recebe ids de squad, domínio e pessoa; o servidor relê o roster,
recusa arquivados e resolve apenas o perfil escolhido. Nenhum catálogo de robôs
entra no prompt. O canal fica vinculado à conversa e ao JSONL mascarado para
impedir misturar agentes ao retomar. A interface mantém uma conversa por agente,
com rascunho preservado ao trocar de sala. O motor e os limites são os da regra
28; cartões reutilizam as escritas existentes, confirmadas pelo operador.
Leads/ficha/WhatsApp continuam independentes da conversa e sempre acessíveis.

## Implantação do escritório no Dell (18/10/2026)

Pedido do Rômulo: ampliar a área útil, preservar sprites e validar sala → lead
→ WhatsApp no celular com dados reais. Cabeçalho e frentes auxiliares ficam
dentro do escritório; a home usa margens compactas, sem afetar outras rotas.
O retrato animado da sala e o mapa compartilham o catálogo CraftPix. Passeios
ambientes iniciam escalonados e não representam execução; movimento reduzido
continua respeitado. Selecionar sala enquadra o responsável, sem mover agentes
nem escrever dados. A publicação é da interface, sobre os serviços existentes,
com cópia de retorno e preservação dos arquivos comerciais já no Dell.
O controle Animar/Reduzir guarda uma escolha local explícita: sem escolha segue
prefers-reduced-motion; a escolha prevalece tanto no retrato quanto nos passeios.
Pendências do mesmo lead compartilham um cartão, preservando todos os motivos;
a consulta busca em toda a sala e apresenta resultados em blocos de 20.

## Escritório como central — PRUMO (18/10/2026)

Direção aprovada pelo Rômulo: interatividade e controle nas salas. A home
operations apresenta mapa/lista e uma área de trabalho da sala selecionada.
O recorte usa JORNADA_DAS_SALAS, passoAtual e a mesma fila de Vendas, sem
duplicar regras comerciais ou criar agentes. A ficha reutiliza CrmPanel em
modo local: não escreve o endereço da home nem instala navegação de Vendas.
Registros continuam pelas rotas existentes e provocam releitura das salas.
O contexto explícito da ficha chega ao Assistente mesmo sem ?lead na URL.
Pedidos da sala passam pelo estado compartilhado dos agentes, pela troca
guardada de squad e por handleDelegation; reservam agenda/tarefas como antes.
A escolha de responsável é uma indicação ao orquestrador, não uma garantia
de execução. Infraestrutura permanece somente leitura. Outros andares e as
rotas completas continuam disponíveis.

## Classificação e preservação de demos (18/10/2026)

Decisão solicitada pelo Rômulo e conferida no Dell: Comece recusou links, depois
discutiu preço e decisão conjunta; a classificação antiga permaneceu e a limpeza
apagou a demo. O classificador separa objeção ao canal de recusa ao produto.
O CRM conserva conversas humanas sem retorno em Em contato, pedindo revisão,
e sinaliza classificação terminal anterior a novas mensagens humanas. A fila
propõe conferência, sem rascunho, envio ou confirmação de contato.

A limpeza preserva demos com conversa humana, próximo passo, proposta, pausa
ou classificação pendente, salvo encerramento manual posterior ao contexto.
Sem arquivo de conversa também preserva: ausência de histórico não é ausência de resposta.
A pausa de hospedagem consulta a mesma função de proteção e revalida antes de pausar;
pastas antigas, isoladamente, não autorizam tirar uma negociação do ar.
O encerramento manual só vale se posterior à conversa, proposta, próximo passo e pausa;
ele reinicia a folga da limpeza, em vez de herdar a data da classificação automática.
Revalida elegibilidade no CRM imediatamente antes da exclusão; falha de leitura
fecha a operação. A fonte permanece nas planilhas via n8n; a correção da Comece
é uma operação explícita desta demanda, com evidência e registro de auditoria,
sem reclassificação retroativa em massa nem mensagem ao lead.

## Contexto antes da retomada (17/10/2026)

Leitura dirigida, pelo pedido explícito de usar Hermes/Evolution: a bridge existente
pede `fetchMessageHistory` ao aparelho com âncora real. Sem ID, pode experimentar
uma janela anterior a agora com telefone do CRM, omitindo o campo opcional do
protocolo; só o retorno observado vale como dado. Endpoint só no loopback, com
segredo do observador e lista atual de leads. Só mensagens dos leads solicitados
são arquivadas pelo mesmo `Conversas.anexar`, com sua trava. Não consome a fila
`/messages`, não envia ao lead e não reprocessa o histórico no classificador.
Pedido aceito não significa histórico recuperado.

Metadados dos áudios retornados ficam apenas em memória na bridge, no máximo 50
por até 30 minutos. A rota de áudio exige o mesmo segredo e lead autorizado;
não transcreve nem envia conteúdo a fornecedores. Nesta auditoria, transcrição
externa foi autorizada pelo Rômulo somente para o áudio de Jéssica.

`historico-comercial.ts` mede cobertura por lead e lê a conferência humana em
notas `[historico-conferido-v1]` do CRM. A fila da tela e a Ficha trocam o envio
por conferir contexto quando falta revisão atual. O aviso do vendedor também
deve pedir conferência, sem botão de confirmar envio nesse caso.
`CrmHistorico.vue` permite conferir e importar uma exportação individual, com
prévia e confirmação. O POST autenticado de importação resolve o telefone pelo
lead conhecido, valida autores e datas, acrescenta mensagens deduplicadas ao
arquivo existente com permissão 0600 e não chama o classificador ou o vendedor.
As mensagens permanecem parciais; a conferência humana não alega sincronização
completa. Central resume a próxima decisão e encaminha a Vendas, sem repetir o
compositor e o diagnóstico; escritório e fontes ficam em consulta.

## Aprendizado comercial (17/10/2026)

`src/operations/aprendizado-comercial.ts` lê notas humanas com prefixo
`[aprendizado-v1]` dos eventos do CRM. `CrmAprendizado.vue` salva pelo POST de
registro que já existe; `CrmResultados.vue` reúne a última revisão válida por lead.
Não há banco, endpoint nem fonte de verdade adicionais. O conteúdo cabe no limite
de 1000 caracteres da nota. Estratégia continua sendo decisão humana.
O nó “Montar retrato” do fluxo 08 preserva 1000 caracteres na coluna `texto`,
como o endpoint de gravação; o limite antigo de 500 cortava notas estruturadas
e resumos de propostas depois de salvar. Outras colunas mantêm seus limites.
Uma pausa marcada nessa nota tira o lead da fila compartilhada (tela e vendedor).
Só nova entrada humana guardada depois da nota, ou revisão humana desmarcando a
pausa, libera as sugestões; leitura e mensagem nossa não liberam.

Abrir o WhatsApp não anota proposta na Ficha nem na Próxima venda. A confirmação
humana guarda o conteúdo enviado: pelo registro existente na Ficha, ou pelo campo
opcional `texto` em `/api/operations/crm/venda/anotar`, com o mesmo teto de 1000
caracteres e deduplicação já usada pela fila. O Telegram continua confirmando por
“Enviei”; seu contrato permanece compatível. Plano comercial e evidências em
`docs/PRUMO-CICLO-DE-VENDA.md`.

## Aplicação atual

- Frontend Vue em `src/`, com o escritório visual em `src/office/` e
  `src/components/GameMap.vue`.
- Servidor Express em `server.ts` e módulos de domínio em `server/`.
- Dados locais e seeds em `data/` e `seed/`.
- Arte do escritório em `public/sprites/`.

## Protótipos

Protótipos em `prototypes/` são documentos executáveis e autocontidos em HTML,
CSS e JavaScript. Eles não importam módulos da aplicação, não usam endpoints e
não devem carregar segredos, métricas ou estados operacionais reais.

O protótipo `prototypes/central-operacoes/` explora a futura superfície de
operação sem implementar infraestrutura, túneis, autenticação ou integrações.

## App único no Dell (decisão de 05–06/10/2026)

Até 06/10/2026 o SquadOne eram duas metades: o app do Easypanel tinha os
agentes sem o mundo (só a agenda), e a Central do Dell tinha o mundo (CRM,
estado do Dell, fluxos) sem agentes, com um botão de uma para a outra. A
decisão é juntar as duas num **app único, mobile first, no Dell**. Este
documento e o `RULES.md` mudaram antes do código (regra 6); o que está abaixo
é o alvo, e "Transição" diz o que ainda não é verdade hoje.

```
celular ── Telegram ──► bot (getUpdates, buscado pelo Dell) ─┐
celular ── tailnet :8443 (Serve, ACL, header de identidade) ─┤
                                                             ▼
                         SquadOne no Dell, 127.0.0.1:9120 (perfil operations)
                           ├─► Google Calendar e Tasks (credencial do Dell)
                           ├─► finanças (financas.db; Meu Pluggy, OFX/CSV de reserva)
                           ├─► sinais: status.json, retrato do CRM, ~/auto-site
                           ├─► avisos pessoais (lembrete, finanças, falhas do Dell) ─► bot do Telegram do dono
                           └─► fila de avisos (schema e teto) ─► Hermes ─► WhatsApp  (reserva do Telegram; P0 nos dois)
healthchecks.io ◄── sinal de vida do Dell; parou = avisa por Telegram e e-mail
Easypanel: reserva fria, travada, sem TELEGRAM_*
```

- **Um processo, um bind.** O perfil `operations` passa a montar o app (roster,
  turno, Mochila, ajuste, avisos, finanças) além da Central, em
  `127.0.0.1:9120`, publicado só pelo Tailscale Serve na 8443 e nunca pelo
  Funnel. Acesso: ACL do Tailscale com os aparelhos do Rômulo, header
  `Tailscale-User-Login` conferido pelo servidor, `Origin` da mesma origem nas
  escritas e o porteiro de IP por último (regra 7).
- **Escrita só por gesto.** A infraestrutura continua somente leitura; o
  domínio (Calendar, Tasks, roster, CRM, finanças) só muda por gesto do
  usuário ou cartão confirmado (regra 10). Link no WhatsApp abre; confirmar é
  um `POST` na tela.
- **Home "Hoje"**, com barra inferior Hoje · Funil · ＋Pedir · Finanças · Mais
  no celular (lateral a partir de 1024 px). Ordem e teto de cartões na regra
  13. O escritório pixel art continua, em "Mais", com lista como padrão no
  celular.
- **Canais** (regra 20):

  | O quê | Por onde | Por quê |
  |---|---|---|
  | Demandas (texto, áudio, `/foco`, `/baixa`) | Telegram, `getUpdates` pelo Dell | sem URL pública: Funnel é proibido |
  | Resultado do turno e botões | Telegram, na mesma conversa | resposta a um gesto; os botões só existem lá |
  | Lembretes, alertas de finanças, falhas do Dell (OT-14, 16/10/2026) | Telegram do dono, sem som das 22h às 7h; a fila do WhatsApp do Hermes só como reserva | o número do WhatsApp é o mesmo dos leads e já levou restrição; a chave de 24 h dos avisos pessoais fica em `avisos-enviados.json` |
  | Avisos que ainda vão pela fila | WhatsApp do Hermes, com schema e teto | ponto único com teto (o cartão que pedia decisão por link da tailnet saiu em 19/10/2026) |
  | P0 | WhatsApp + Telegram | a sessão do WhatsApp não é oficial e cai; capacidade pronta, nenhum chamador a produz hoje |
  | Dell sumiu | healthchecks.io (Telegram e e-mail) | o Hermes cai junto com o Dell |

  O Hermes é só transporte: o SquadOne decide quando e o quê, grava na fila, e
  o `dell-status` drena com as regras dela (formato e campos em
  `deploy/dell/README.md`, "Fila de avisos"). O ntfy deixa de existir.
- **Finanças** num banco próprio (`financas.db`, permissão 600, backup pelo
  cofre restic), fonte principal Meu Pluggy e OFX/CSV de reserva. A regra que
  segura a dupla contagem: o pagamento da fatura nunca é despesa, só quita o
  cartão. Valores em R$ ficam no app; os canais recebem semáforo e %; nada vai
  ao modelo sem pedido (regra 24).
- **Easypanel como reserva fria**: implantável, travado, sem as variáveis do
  Telegram, sem vigia (regra 25). É a volta ensaiada se o Dell morrer.

### Transição

A transição está **concluída até a fase 7**: tudo o que o diagrama acima
descreve é verdade hoje. O plano completo está no artefato "SquadOne Único",
versão 2 de 06/10/2026. O que foi feito, na ordem:

1. **Higiene** (06/10/2026, PR #20): a escrita do app saiu do perfil
   `operations` enquanto o `data/squad.json` do Dell era um retrato de
   14/09/2026; `/api/runtime` diz `ocupado`; a fila de avisos ganhou schema e
   teto; os bancos Docker entraram no cofre.
2. **Regras** (PR #23): este documento e o `RULES.md`.
3. **Finanças no Dell** (07/10/2026, ver "Finanças"): banco próprio, tela de
   Visão e a casca mobile. A conferência de identidade do Serve entrou junto;
   a lista é a mesma da agenda, `SQUADONE_LOGINS_TAILSCALE`.
4. **Agenda no Dell** (07/10/2026): o roster de **produção** foi a verdade; o
   do Dell ficou arquivado, nunca mesclado, com as contratações congeladas
   durante a troca. Diretório de dados fora do clone, polling do Telegram,
   avisos pela fila, travas de identidade e origem e sinal de vida estão no
   ar; a agenda só liga no Dell com `SQUADONE_DATA_DIR` presente e fora do
   checkout. O runbook, com volta em cada passo, é
   `deploy/dell/CUTOVER-AGENDA.md` (encerrado): `TELEGRAM_*` saiu do
   Easypanel, o `squad.json` de produção foi copiado, o Easypanel ficou
   travado e implantável (reserva fria), `deleteWebhook` sem
   `drop_pending_updates` e `getUpdates` ligado, vigia em sombra pelo WhatsApp
   e, validada a sombra, o ntfy foi apagado (`server/push.ts`, `/api/push/*`,
   `LEMBRETES_NTFY_URL`). O `/squadone` abre os agentes na própria Central.
5. **Casca mobile completa** (07/10/2026): `App.vue` dividido em
   casca + rotas (`src/casca/`, `src/rotas/`, o estado em
   `src/agentes/estado.ts`), sem mudar contrato de API; a Central e o app são
   UMA casca nos dois perfis (`RootApp` passa `{ perfil, agentes }`). Pedir
   como folha no ＋ central, Hoje na ordem da regra 13 (no máximo 3 cartões,
   próximos 3 da agenda, time com estado só com fonte, linha do funil, "resolve
   sozinho" fechado), Agenda própria, escritório com Lista|Mapa (Mapa carregado
   só quando aberto, escala inteira, toque de 44 px, rAF pausado fora de
   vista), Funil do celular com Site/Organizar e abas de etapa, ficha do CRM em
   folha cheia, barra lateral + Ctrl+K a partir de 1024 px. Toda tela usa os
   tokens, com modo escuro: o CRM em `src/operations/crm.css`, os painéis de
   Mais em `src/operations/mais.css`; o `operations.css` (o shell antigo da
   Central, só claro, quase todo sem uso) foi apagado.
6. **Organização das finanças e alertas de 70/90/100%** (07/10/2026, ver
   "Organização das finanças").
7. **PRUMO como uma squad**, com o Site antes da venda como sala
   (07/10/2026, ver "PRUMO como squad").

**Roster em SQLite com Litestream: trocado pelo histórico datado** (fase 8,
07/10/2026). O SQLite mudaria o formato do roster, e o Easypanel, que é a
reserva fria (regra 25), lê o `squad.json`: a volta ensaiada se o Dell morresse
deixaria de funcionar. No lugar, cada gravação guarda o `squad.json`
**anterior** em `historico/squad.<AAAA-MM-DDTHHMMSSZ>.json` (modo 600, 30
cópias ou 90 dias, o que guardar mais), só com `SQUADONE_DATA_DIR` e o roster
não congelado. Nenhum formato, rota ou dependência mudou; `conferir-roster
--historico` lista e compara, e a volta é um `install` (RESTAURAR.md, "Roster").

**Fase 8, feito:** **cartões e time vivo** (07/10/2026). A Hoje ganhou o
cartão de finanças em semáforo da regra 13 (`GET /api/financas/estado`, só
laranja e vermelho, ≥ 90 %; só % e o nome do banco, nunca R$) entre os
cartões dos agentes e a fila, e o estado de **todas** as squads ativas por
`GET /api/time` (`server/time.ts`: um `events.list` por calendário na janela
de −1 a +7 dias, agrupado pelo domínio ativo, cache de 60 s em memória, nada
em disco). Squad cujo calendário não foi lido continua "Sem sinal", com o
motivo.

**Fase 8c, código no ar e desligado:** **Luna em modo sombra** (07/10/2026,
ver "Luna em modo sombra"). Depois de cada turno real do Gemini, a Luna
(`gpt-6-luna`, `codex exec`) responde ao mesmo prompt só com as chamadas que
faria, nada é executado e o veredito da comparação vai para um JSONL no
diretório de dados. Liga-se com `SQUADONE_LUNA_SOMBRA=true`, só no Dell; a
medição aprovada é de ~30 dias com teto de 10 por dia.

**Fase 8d, feito:** **explicação das finanças com IA, a pedido** (07/10/2026,
ver "Explicação com IA (a pedido)" em "Finanças"). Desligada até
`SQUADONE_FINANCAS_IA=true` no `operations.env`.

**Ainda não feito (fase 8, sem data):** nada de código pendente. Hábitos,
check-in e metas foram cortados em 07/10/2026 (só voltam se aparecer pedido
real). Fora do código e sem confirmação registrada: o teste de que o aviso do
Hermes vibra o celular bloqueado (se não vibrar, o Hermes precisa de um chip
próprio) e a cifra do disco do Dell (ver "Riscos aceitos"). O faturamento do
Gemini foi confirmado pelo usuário em 07/10/2026, e é a condição para ligar a
explicação das finanças (no plano grátis o Google usa os prompts).

### PRUMO como squad (07/10/2026)

SquadOne (app) › PRUMO (squad `prumo`) › Site antes da venda (sala). Criada
no roster de produção do Dell pelo fluxo de Nova squad que já existia (Nova
squad, ✎ na sala raiz, Abrir sala três vezes), sem mudar o schema v3. São
quatro salas, no máximo, e cada uma é **quem trabalha**, não uma etapa do
funil — as etapas continuam em `src/operations/fluxos.ts` e nas planilhas:

| Sala (id) | Quem trabalha | Automáticos (catálogo) |
|---|---|---|
| Atendimento e proposta (`prumo--geral`, sala raiz) | todo contato com lead e dono: convite, abordagem com o site, follow-up, conversa, proposta, fechamento; e o do PRUMO sem outra sala | Balcão, Observador do WhatsApp, Acompanhamento (05), Retrato do CRM (08) |
| Prospecção (`prumo--prospeccao`) | achar e qualificar empresas nos dois produtos, antes do primeiro contato | Caçador, Funil por nicho (06) (o Lead Scout foi desligado em 08/10/2026) |
| Site antes da venda (`prumo--site-antes-da-venda`) | fazer, publicar, ajustar e pausar os sites (demo e de quem fechou) | gerador |
| Organizar (`prumo--organizar`) | a consultoria: diagnóstico, Índice PRUMO, Mapa, entrevistas, recomendação, workshop | Diagnóstico, rascunho do Mapa (`prumo-mapa`) |
| Iris (`prumo--iris`, 14/10/2026) | o Iris nas clínicas de terapia | Caçador de clínicas (desligado no n8n) |
| Estamparias (`prumo--estamparias`, 14/10/2026) | o CRM de estamparia | Caçador de estamparias (desligado no n8n) |

- **`prumo--geral` é o Atendimento.** Nova squad sempre nasce com a sala
  "Geral"; ela foi renomeada no ✎, e id nunca muda. Ser a sala raiz combina
  com o papel: o PO dela é quem fala com o cliente e recebe o que não tem
  outra sala.
- **"Não cuida de" explícito em todo escopo** (squad, sala e treino do PO),
  apontando a sala ou a squad certa. É o que evita ida e volta no
  redirecionamento: a squad PJ já tinha uma sala Prospecção (clientes
  freelance). Os dois lados dizem a fronteira: o escopo da squad PRUMO não
  cuida deles, e o da sala `pj--prospeccao` ganhou "Não cuida de: PRUMO e
  Site antes da venda (squad PRUMO)". O treino só existe no roster de
  produção; muda-se pelo ✎, não pelo Git.
- **Telegram `/p`** (`server/telegram-entrada.ts`, `PREFIXOS_DE_SQUAD`):
  prefixo sem estado que fixa a squad `prumo` pelo id, combinável com
  `/foco`/`/baixa` em qualquer ordem e na legenda do áudio. Nenhuma chamada a
  mais ao modelo; o redirecionamento automático continua como rede. Squad
  arquivada ou sumida: o turno falha antes do Gemini e a resposta diz para
  mandar sem o prefixo (regra 20).
- **Catálogo dos trabalhadores automáticos** (regra 26): desde 15/10/2026 é
  **um catálogo só**, o campo `trabalhador` dos passos de
  `src/operations/fluxos.ts` (o "Como funciona" de Mais);
  `src/office/trabalhadores.ts` deriva a lista dele, com o `quando` e a
  `verificacao` do próprio passo. Antes eram duas listas à mão, e os
  caçadores do Iris e das Estamparias estavam numa e não na outra. Fora do
  prompt: o teste confere que nenhum módulo do servidor importa o catálogo,
  os fluxos nem a operação das salas. Todo trabalhador tem verificação viva
  (o teste fixa); a do caçador desligado não aparece no `status.json`, e a
  sala diz "Sem sinal". O Plus tem fluxo em "Como funciona" e nenhum
  trabalhador: o catálogo maçônico é importado à mão.
- **O Escritório como mapa da operação** (15/10/2026, pedido do Rômulo: Entrada,
  Escritório e Finanças pareciam distantes). Sob cada sala do PRUMO, na Lista e
  na folha da sala do Mapa, `src/office/operacao.ts` (PURO) monta: os leads da
  sala por passo da jornada (`painelDaJornada` sobre o retrato de
  `/api/operations/crm`, o mesmo do `/crm`), os parados com ele (os 3 mais
  antigos, com link para a Ficha) e cada robô com o estado do `status.json`
  (`/api/operations/overview`, o retrato que a casca já lê). O recorte de cada
  sala é uma decisão (`JORNADA_DAS_SALAS`): Prospecção = o estoque antes do
  primeiro contato de cada oferta, Plus incluído; Atendimento = as conversas
  em andamento de todas; as salas de oferta = a jornada inteira do produto
  delas (Site, Organizar = `prumo`, Iris, Estamparias = `estampa`). Tocar numa
  contagem abre `/crm?ver=jornada&produto=…`; tocar num robô abre o passo dele
  em `/mais?fluxo=…&passo=…`. Só leitura (nada grava, nada vai ao prompt), e
  só com fonte: sem retrato do CRM a sala diz que não leu (nunca "0"); sem
  retrato do Dell de até 5 min, ou sem a verificação do robô nele, "Sem sinal".
  O CRM (5 MB, revalidado por ETag) só é lido quando a squad ativa tem sala
  com operação, e de novo a cada 5 min com a aba visível. O rascunho do Mapa ganhou a verificação `prumo-mapa` em
  07/10/2026 (gatilho, idade da `mapa-fila` e pasta de erro; ver
  `deploy/dell/README.md`, "Monitor do Dell").

### Luna em modo sombra (fase 8c, 07/10/2026)

A Luna é o `gpt-6-luna` pelo `codex exec`, com o login ChatGPT Pro que já
existe no Dell (nunca a API da OpenAI). **Modo sombra**: depois de cada turno
real do Gemini, a Luna recebe o **mesmo** `systemInstruction` e a mesma demanda
e responde só com as chamadas de capacidade que faria, em JSON. Nada do que ela
responde é executado: o servidor compara com as `functionCalls` do Gemini e
grava o veredito. Serve para medir, ao longo de ~30 dias e com teto de 10 por
dia, se ela substituiria o Gemini como motor do turno — aprovado pelo Rômulo em
07/10/2026, só medir. O código sobe **desligado**; ligar é gesto dele
(`SQUADONE_LUNA_SOMBRA=true`), só no perfil `operations` com a agenda ligada.
Instalação e leitura em `deploy/dell/README.md`, "Luna em sombra".

```
demanda ─► rodarTurno (Gemini) ─► capacidades ─► TurnoResult (como sempre)
              │ aoTerminarTurno(systemInstruction, functionCalls)
              ▼ sem await, fora de turnosEmAndamento
        server/luna-sombra.ts: fila própria (uma por vez), teto do dia, 120 s
              ├─► codex exec --model gpt-6-luna --sandbox read-only … (prompt por stdin)
              ├─► interpretarSaidaDaLuna → compararChamadas: igual | parcial | diferente
              └─► SQUADONE_DATA_DIR/luna-sombra/AAAA-MM.jsonl (600), uma linha por turno
```

- **O que vai à OpenAI:** o `systemInstruction` do turno — a árvore da squad
  ativa (nomes, papéis e o treino de cada pessoa), id, nome e escopo das
  outras squads, a janela de trabalho e a data —, a declaração das
  capacidades e a demanda. É exatamente o que já vai ao Google em todo turno;
  o custo novo é um **segundo provedor** ver o roster.
- **O que nunca vai:** áudio cru (a transcrição já virou texto, e é ela que
  roda); "gastei …" (não é turno: `gasto-falado` o intercepta antes do bot
  chamar o turno); qualquer coisa de finanças (regra 24: o `systemInstruction`
  não as tem); a resposta do Gemini (a comparação é **cega**: ver a resposta
  dele mediria concordância induzida, não a Luna); as pessoas das outras
  squads; credenciais.
- **Por que não decide nada:** `observar` é chamado sem `await` e nunca lança;
  a sombra não conta em `turnosEmAndamento` (`/api/runtime.ocupado` não a
  espera; um reinício no meio perde uma medição, nunca um turno); falha,
  timeout ou cota viram linha com `falha` ou log, nunca aviso nem Telegram; o
  que ela devolve é lido como **dado** (JSON com nomes de `declarations()`),
  e qualquer outra coisa é `falhou` classificado. Nada realimenta o Gemini,
  o turno ou o roster. Sem retry: uma medição perdida é só uma linha a menos.
- **O registro** (`luna-sombra/<AAAA-MM>.jsonl`, 600, no diretório de dados,
  fora do clone): `quando`, `squad`, `modo`, `hashDaDemanda` (sha256),
  `tamanhoDaDemanda`, as chamadas dos dois lados **resumidas aos campos
  comparados** (nome, `responsavel_id`, `tipo`, `a_partir_de`, `prazo_final`,
  `inicio_fixo`, `data`, `duracao_min`, `esforco_min`, `squad_id`,
  `dominio_id`, quantidade de `passos` — nunca título, nota de execução,
  notas ou justificativa, que repetiriam a demanda em claro), `veredito`,
  `detalhes` por chamada, `duracaoMs` e `falha?`. A demanda em claro entra só
  com `SQUADONE_LUNA_GUARDAR_DEMANDA=true`. Nada disto entra em aviso, log ou
  `status.json`; o resumo é `scripts/luna-sombra-resumo.ts`, que só lê.
- **Vereditos** (`compararChamadas`, puro): `igual` quando toda chamada do
  Gemini casa com uma da Luna de mesmo nome, mesma pessoa, mesmo tipo, mesmas
  datas, duração/esforço dentro de ±25 % e mesma squad de troca, sem sobrar;
  `parcial` quando casou com divergência em algum campo, ou faltou/sobrou
  chamada; `diferente` quando nada casa — inclusive Gemini sem chamada e Luna
  com alguma, ou o contrário.
- **Execução:** `child_process.execFile` (nunca shell), binário de
  `SQUADONE_CODEX_BIN` (padrão `codex`; fora do PATH = log uma vez, sombra
  desligada), prompt por **stdin** (por argumento apareceria em `ps` e no
  journal), `--model gpt-6-luna --sandbox read-only --skip-git-repo-check`,
  `cwd` vazio e próprio (`luna-sombra/cwd`, 700: o `codex` não lê o clone nem
  o diretório de dados), última mensagem lida de arquivo
  (`--output-last-message`, dentro desse `cwd`) e não do stdout, que traz o
  progresso. Timeout de 120 s com `kill`. Erro de cota do `codex` = log uma
  vez e sombra parada até o dia seguinte (meia-noite de São Paulo, o mesmo
  relógio do teto). **O `codex` do Dell não foi conferido pelo PC**: no boot a
  sombra roda `codex exec --help` e confere que cada flag usada está lá;
  faltando uma, desliga com log claro — a primeira coisa a fazer ao ligar é
  ler esse log.
- **Riscos aceitos:** `~/.codex` (login do ChatGPT e as sessões, com o prompt
  inteiro) já estava no disco sem cifra (ver "Riscos aceitos"); com a sombra
  ligada, o roster e as demandas passam a existir também ali, em texto. O
  serviço ganha `-%h/.codex` em `ReadWritePaths` só por isso. Antes de ligar,
  conferir na conta ChatGPT que "Melhorar o modelo para todos" está
  desligado: sem isso o roster viraria dado de treino.

### Jev em modo sombra (11/10/2026, desligado)

O Jev (`typesafe/jev-1.13`) é o "modelo de decisão" da TypeSafe servido pela
OpenRouter (`POST https://openrouter.ai/api/alpha/decisions`): não gera texto,
recebe um `state` e perguntas e devolve probabilidades. **Medição até
promoção** (regra 27): depois de cada demanda, sem `await`, ele responde quatro
perguntas — squad, sala, agenda ou tarefa, pede contratação — e o servidor
compara com o que o Gemini fez. Nada decide, nada volta ao turno. Detalhes,
critérios de promoção e o registro em `docs/referencia/perfis-e-experimentos.md`,
"Jev em sombra"; ligar e ler em `deploy/dell/README.md`, "Jev em sombra".

```
demanda ─► rodarDemanda ─► executarTurno (1 ou 2 turnos do Gemini) ─► TurnoResult (como sempre)
              │ observarDemanda(roster, squad inicial/final, chamadas do último turno) — 1 por demanda
              ▼ sem await, fora de turnosEmAndamento
        server/jev-sombra.ts: finanças? → linha "pulada", nada sai
              ├─► perguntasDoTurno (opções embaralhadas, ordem gravada)
              ├─► server/openrouter-decisoes.ts: mascararParaJev → POST (deny + ZDR, timeout 5 s, sem retry)
              ├─► compararComGemini: concorda | discorda | não comparável, por pergunta
              └─► SQUADONE_DATA_DIR/jev-sombra/AAAA-MM.jsonl (600), tetos por dia e em US$
```

- **O que vai à OpenRouter/TypeSafe (EUA):** a demanda mascarada (telefone,
  e-mail, CPF/CNPJ, URL com identificador e segredo viram rótulos) e, como
  opções, id + nome + escopo das squads ativas e das salas da squad final.
  Nada das pessoas, do treino, da agenda ou do Google.
- **O que nunca vai:** finanças (regra 24: demanda que parece finanças nem sai;
  sala de finanças só pelo nome; valor em dinheiro sai de todo escopo); a
  resposta do Gemini; credenciais; respostas de leads (essas, aprovadas em
  11/10/2026 só em sombra, vão por outro caminho: o ramo "Jev:" do fluxo de
  respostas no n8n da Mel, `deploy/dell/claude-ops/whatsapp-conversa.py`, com
  recorte e máscara próprios; ver `deploy/dell/README.md`, "Jev em sombra nas
  respostas").
- **Retenção:** `data_collection: "deny"` e `zdr: true` em todo pedido. O
  endpoint está na lista ZDR da OpenRouter, mas ZDR é classificação **dela**;
  a TypeSafe não publica prazo de retenção. Risco aceito pelo Rômulo em
  11/10/2026, com a Pay4Fun liberada para este terceiro.
- **A chave** (`OPENROUTER_API_KEY`) mora só em `~/.config/squadone/jev.env`
  (600) no Dell; nenhum erro, log ou JSONL a repete. 401/403/402 desligam o
  Jev até reiniciar o processo. Nunca no Easypanel.

### Finanças (07/10/2026)

Como está no código (perfil `operations`; instalação e conferência em
`deploy/dell/README.md`, "Finanças"):

```
Meu Pluggy (Santander, Nubank, Mercado Pago)
  └─ api.pluggy.ai ── polling 1x/dia depois das 7h + botão "Atualizar agora"
       └─ server/financas/sync.ts ── por conexão, numa transação
            ├─ pluggy-mapa.ts (PURO): JSON → conta, fatura, transação
            ├─ dedupe.ts (PURO): PENDENTE→LANÇADO, id trocado, Pluggy vence PDF
            └─ banco.ts: financas.db (SQLite, 600, migrações em user_version)
       └─ processar.ts (PURO), sobre tudo: natureza → fatura → pagamento pelo
          valor → pares entre contas → parcelas → categoria (refeito também ao
          abrir as finanças: uma regra nova vale no deploy)
       └─ VACUUM INTO financas.copia.db (600) → cofre restic
fatura do Santander em PDF ── pdf-texto.ts → fatura-santander.ts (PURO)
  └─ conferência contra o total da fatura da Pluggy → grava no 2º toque
extrato OFX/CSV de reserva ── extrato.ts (PURO) → parearEntreFontes contra a Pluggy
/api/financas/{visao,lancamentos,sincronizar,importar/santander,importar/extrato,
               organizacao,categorias,orcamento,recorrentes,estado,alertas/simular,
               explicar/previa,explicar}
  └─ resumo.ts (PURO): tenho, devo, gastei (competência|caixa), orçamento, recorrentes
  └─ alertas.ts (PURO): 70/90/100% → fila de avisos (só % e semáforo)
  └─ explicacao.ts (PURO): resumo → texto da prévia → Gemini (só a pedido, com a flag)
Telegram "gastei 30 no mercado" ── gasto-falado.ts (PURO) → conta manual
```

- **Dinheiro em centavos inteiros**, com sinal do ponto de vista do
  patrimônio (negativo = saiu ou aumentou a dívida). A conferência da fatura
  exige bater no centavo.
- **A regra da dupla contagem** (`natureza.ts`, teste obrigatório em
  `visoes.test.ts`): o pagamento da fatura na conta é sempre
  `pagamento_fatura`, reconhecido pela descrição/categoria **ou** pelo valor
  (igual a um pagamento registrado na fatura a ±3 dias, ou ao total perto do
  vencimento) **ou** pelo par com o "pagamento recebido" no cartão. Na
  competência conta a compra (no mês da fatura); no caixa, o pagamento; nunca
  os dois.
- **Devo** por cartão = o limite usado que o banco informa, quando ele dá o
  disponível; o detalhe (fatura fechada a pagar + fatura aberta + parcelas
  futuras, sem sobrepor) aparece abaixo, e a diferença vira "sem detalhe" em
  vez de sumir. A fatura aberta soma os lançamentos já listados e as parcelas
  dela que o banco ainda não lançou (o Santander e o Mercado Pago lançam as
  parcelas no dia do fechamento; sem a projeção, um mês inteiro de parcelas
  virava "sem detalhe"). A Pluggy não dá id de compra parcelada: o grupo é heurístico
  (`parcelas.ts`) e a chave é a **data da compra** quando a fonte a dá
  (`purchaseDate`, a data da linha no PDF): datas diferentes são compras
  diferentes, e na mesma data o valor da parcela pode variar até 1% (o
  Santander e o Mercado Pago cobram as primeiras uns centavos acima; com a
  tolerância de 1 centavo a mesma compra virava dois grupos e as parcelas
  que faltam contavam em dobro). Sem a data, valor ±1 centavo e mês de
  origem ±1.
- **O pago de uma fatura sai da data do pagamento** (`pagoDasFaturas`), não
  do `pago` que a fonte põe nela: um pagamento quita a última fatura que já
  tinha fechado. Cada banco informa de um jeito: o Mercado Pago e o Nubank
  põem na fatura o pagamento dela; o Santander põe os pagamentos feitos
  dentro do ciclo, que são da fatura anterior (visto em 07/10/2026: a fatura
  fechada aparecia paga e sumia do "devo").
- **A fatura de um lançamento é a que a fonte deu** (`billId`), quando é uma
  fatura conhecida do cartão; senão, pela data. O dia do fechamento é o caso
  difícil: o Mercado Pago cobra o que entra nele na fatura que fecha; o
  Santander, na SEGUINTE (visto em 07/10/2026 nos 12 meses de nov/2025 a
  set/2026). Durante o mês em que a fatura seguinte ainda não está em
  /bills, o `billId` do Santander aponta para uma fatura desconhecida: um
  `billId` desconhecido no dia do último fechamento é da fatura aberta
  (`dataDoCiclo`, `visoes.ts`). Sem isso, a competência subia um mês e a
  parcela de novembro contava em outubro. Por isso o `billId` fica numa
  coluna própria (`fatura_fonte`, migração 3), que o passe lê e nunca
  reescreve: a `fatura_id` é a derivada, refeita a cada passe, e nela o
  `billId` da fatura aberta se perdia ao reabrir as finanças. Fica como
  antes o dia de um fechamento cuja fatura ainda não apareceu (duas faturas
  fora de /bills): corrige-se quando ela aparece.
- **Categoria por regra**: natureza → regra do Rômulo por estabelecimento →
  tabela da categoria da Pluggy → palavras da descrição; nada vai ao modelo
  (RULES 24). A do usuário (`origem_categoria = usuario`) nunca é
  sobrescrita. A tela de mudar veio com a organização (abaixo).
- **Dependências opcionais**: `better-sqlite3` e `pdfjs-dist` são
  `optionalDependencies`, carregados por `import()` só quando as finanças
  abrem. O perfil `app` (Easypanel) nunca os carrega, e uma instalação que
  falhe neles derruba só as finanças (503), não a Central.
- **Explicação com IA (a pedido)** (fase 8d, 07/10/2026). O botão "Explicar
  este mês" no topo da Visão abre uma folha (`FinExplicar.vue`) com dois
  toggles desligados ("Incluir valores em R$", "Incluir estabelecimentos") e,
  sob "Isto é exatamente o que vai sair para o Gemini", o texto da prévia, que
  vem do servidor: `explicacao.ts` (PURO, determinístico) monta do
  `ResumoFinanceiro` seções fixas (Tenho, Devo por cartão, Gastei por
  categoria com variação contra o mês anterior, Orçamento, Recorrentes,
  Parcelamentos, Saúde das conexões). O padrão leva só categorias, % de
  variação, % do orçamento e do limite, contagens e meses; R$ e até 10
  estabelecimentos por categoria só entram pelo toggle (sem ele, a função nem
  recebe a lista de estabelecimentos, e as descrições de recorrentes e
  parcelamentos não são escritas). `POST /api/financas/explicar/previa`
  devolve `{ pacote, hash, caracteres }`; `POST /api/financas/explicar` remonta
  com os mesmos parâmetros e só chama o Gemini se o hash (sha256, 16 hex)
  bater — senão 409 `previaDesatualizada`, porque sairia um texto que o
  Rômulo não viu. Uma chamada `gerarComRetry`, `contents` = o pacote,
  `systemInstruction` = um prompt fixo (até 15 linhas, sem inventar números,
  sem conselho de investimento), sem ferramentas: a resposta é texto para a
  folha (cortado em 4000, interpolado, nunca `v-html`), nunca uma ação.
  `ModeloOcupado` = 503 `modeloOcupado`. Nada é gravado nem guardado em cache;
  fechar a folha descarta; o log diz só o tamanho e as opções. Nada disso vai
  a Telegram, WhatsApp, fila, Luna, nem ao `systemInstruction` do turno.
  **Desligada por padrão:** sem `SQUADONE_FINANCAS_IA=true` as rotas
  respondem 404 ("Explicação com IA desligada") e o botão não aparece
  (`explicacaoIa` na situação das finanças). Ligar só com a chave do Gemini
  num projeto com faturamento (no plano grátis o Google usa os prompts).
- **Riscos aceitos:** o leitor do PDF do Santander foi escrito pelo layout
  descrito (seções por cartão, Parcelamentos e Despesas com n/total, Resumo) e
  testado com texto sintético; a conferência é a trava contra layout que
  mudou. O pareamento de transferências pode casar dois Pix de mesmo valor a
  até 2 dias entre contas próprias que não eram o mesmo dinheiro.

#### Organização das finanças (07/10/2026)

O banco guarda só o que o Rômulo DECIDIU (migração 2: `categoria_criada`,
`categoria_renomeada`, `regra_categoria`, `orcamento`, `recorrente_marca`,
`alerta_enviado`); o resto é derivado a cada passe. Tela "Organizar"
(`/financas/organizar`) e o editor de cada lançamento em Lançamentos.

- **Categorias editáveis** (`organizacao.ts`, PURO): criar, renomear (para um
  nome que existe = juntar), remover (= juntar em "Outros"). O renome fica num
  mapa que o passe aplica depois da regra embutida, para "Mercado" renomeada
  continuar com o nome novo a cada sincronização. Fixas (as da natureza e
  "Outros") não se renomeiam nem se escolhem à mão.
- **"Aplicar sempre a este estabelecimento"**: a correção de um lançamento vira
  `regra_categoria` (estabelecimento = descrição normalizada), que vale para
  os novos e os antigos, menos os mudados à mão.
- **Orçamento mensal por categoria**, sempre em competência (a compra no mês
  da fatura), com barra e semáforo na Visão: verde < 70, amarelo ≥ 70, laranja
  ≥ 90, vermelho ≥ 100. A % arredonda para baixo.
- **Recorrentes**: mesmo estabelecimento a cada ~30 dias (±10; um mês pulado
  vale), 3 vezes em 120 dias, a última há até 45 dias, valor até o dobro. Marcar
  e desmarcar vencem a detecção; `null` volta para ela.
- **Alertas de 70/90/100%** (`alertas.ts`, PURO) do limite de cada cartão e do
  orçamento de cada categoria, pela fila de avisos (origem
  `squadone:financas`), depois de cada sincronização e de cada escrita. Só
  semáforo e % (categoria e nome do cartão podem; R$, valor e estabelecimento
  nunca; a chave leva o hash da categoria). Uma vez por faixa e período (mês da
  fatura aberta, mês do orçamento), só a faixa mais alta, guardado em
  `alerta_enviado` depois de entrar na fila; 70% é P2, 90/100% P1, nenhum P0.
  `POST /api/financas/alertas/simular` mostra o que sairia, sem gravar.
- **Sala Finanças no escritório**: um domínio comum aberto com o nome
  "Finanças" (ou id `…--financas`). O PO dela mostra num balão a % do cartão
  mais usado e do orçamento (`GET /api/financas/estado`, `src/office/salaFinancas.ts`).
  Nada disso entra no roster nem no prompt.
- **"gastei 30 no mercado" no Telegram** (`gasto-falado.ts`, PURO e
  determinístico): "gastei/paguei/gasto" + valor + onde. Vai à conta manual
  `manual:dinheiro` (sem saldo, fora do "tenho"), chave pela mensagem (reentrega
  não duplica), data da mensagem (sem a guarda de atraso). A resposta é
  "Anotado: <categoria>", sem valor; a frase nunca vira turno, e sem finanças no
  processo o bot só diz isso. Áudio que transcreve para um gasto é anotado sem
  ecoar a transcrição (o áudio em si já passou pelo Gemini para transcrever).
- **Extrato OFX/CSV de reserva** (`extrato.ts`, PURO), para quando uma conexão
  parar: prévia e confirmação, como o PDF. Chave pelo FITID (OFX), pelo
  identificador (CSV) ou pelo conteúdo + ordem. Contra a Pluggy, pareamento UM
  A UM (`parearEntreFontes`, mesma conta e valor, até 2 dias, descrição
  parecida ou candidato único); quando a conexão volta, a Pluggy vence e a linha
  do extrato sai (`dedupe.ts`, caso 3). Risco aceito: duas compras de mesmo
  valor a até 2 dias, uma em cada fonte e com descrições sem nada em comum,
  viram um par.

## Central de Operações

Esta seção descreve o código como está hoje. Com o app único (acima), a
Central vira a parte operacional do mesmo app: o nome continua nos módulos
(`src/operations/`, `server/operations.ts`), não na interface.

A mesma aplicação possui dois perfis selecionados no servidor por
`SQUADONE_MODE`:

- `app` preserva o comportamento remoto e não registra `/api/operations/*`;
- `operations` serve só a Central (em `/`; desde 30/09/2026 sem a cópia do app em `/squadone`, que redireciona ao app do Easypanel), registra
  as rotas locais e troca o bind do Express para `127.0.0.1`. Desde 06/10/2026
  as rotas do app (escritas no roster e no Google) não são montadas nesse
  perfil: do Google ficam só `/api/auth/google` e `/api/auth/callback` (a agenda
  da Central), além de `/api/financas/*` (desde 07/10/2026, ver "Finanças"),
  e o resto de `/api` responde 404 JSON. O `data/squad.json` do
  Dell é um retrato de 14/09/2026 e nada da Central o lê ou escreve.

`src/RootApp.vue` consulta somente `/api/runtime` para escolher a superfície.
A mesma rota diz `ocupado` (turno, fila do bot do Telegram, resposta do Assistente ou uma volta da vigia em andamento),
que o `atualizar-central` do Dell espera virar `false` antes de reiniciar. No SIGTERM a Central para os laços (vigia, sinal de vida, polling,
leitura diária, copiloto automático) antes de fechar o servidor.
Os componentes da Central ficam em `src/operations/`; eles não incorporam o
SquadOne em iframe. `/squadone` redireciona ao app do Easypanel até a mudança
da agenda para o Dell; depois, os agentes moram no mesmo app.

Desde a casca mobile (07/10/2026) a Central são rotas da mesma casca do app
(`src/App.vue`), sem dependência de roteador (`pushState` em `src/casca/rota.ts`):

- `/` é a **Hoje** (regra 13): o que precisa do Rômulo agora, em no máximo 3
  cartões (alertas do `status.json` com "o que fazer", os cartões de decisão
  dos agentes e, desde 08/10/2026, os leads que responderam e esperam
  resposta, lidos do retrato do CRM), os próximos compromissos, o time, a linha do funil e o que
  resolve sozinho, fechado; sem link para o Easypanel. Como a operação
  funciona (`src/operations/fluxos.ts`), os acessos e tudo que o Dell confere
  ficam em `/mais`;
- `/entrada/` abre a página da Entrada da Mel (texto e arquivos para o Hermes organizar; segredos
  vão para o cofre `age`). Não é da SPA: `server/entrada-proxy.ts` repassa quatro rotas fechadas (a página, `api/estado`, `api/enviar` e a fonte) ao
  serviço `deploy/dell/entrada/` em `127.0.0.1:9130`, com o mesmo porteiro de IP, e o item
  "Entrada" do menu fica logo abaixo de CRM. Pela tailnet é a mesma porta 8443 da Central: não há
  outro listener do Tailscale Serve. Detalhes e modelo de segurança em `deploy/dell/entrada/README.md`.
- `/crm` é o CRM do Site antes da venda e do PRUMO (desde 30/09/2026; o antigo
  `/projetos/producao-auto` redireciona para cá).

O estado do Dell vem de `SQUADONE_OPERATIONS_DATA_DIR/status.json`, gravado a
cada minuto por `deploy/dell/dell-status.py` e lido por `server/dell-status.ts`
dentro de `GET /api/operations/overview`. Desde 30/09/2026 cada verificação
pode trazer `o_que_fazer`, `acao` ({rotulo, url}: http(s) ou rota da Central)
e `sozinho` (resolve sem o Rômulo); os três são opcionais e o leitor aceita
retrato antigo sem eles. O mesmo monitor avisa o Rômulo (pelo Telegram, com o WhatsApp do Hermes de reserva) quando algo
quebra e quando volta; desde 19/10/2026 o `status.json` é gravado ANTES de qualquer aviso e cada verificação tem prazo (70 s, 100 s no total),
para um aviso lento ou uma verificação presa não deixarem a Central sem retrato. Retrato com mais de 5 minutos vira a
falha "Monitor do Dell". As rotas de projetos e leituras do Hermes seguem no
servidor, mas saíram da interface em 23/09/2026.

`server/operations.ts` contém a fronteira local:

- valida e persiste projetos em JSON com substituição atômica;
- aceita somente caminhos Linux absolutos ou URLs `http`/`https`;
- verifica uma lista fixa de serviços lida da configuração privada, com timeout
  curto e sem aceitar comandos ou URLs enviados pelo navegador;
- expõe somente launch URLs, estados e detalhes não sensíveis à interface.

### CRM (30/09/2026)

Até 29/09/2026 o estado de um lead morava em três lugares que discordavam: a
planilha, as pastas de `~/auto-site` e os marcos manuais da Produção Auto
(`auto-production.json`). Desde 30/09/2026 a fonte da verdade é a planilha
(aba Leads do Site antes da venda; aba Prospects do PRUMO), as pastas a
espelham (`site-pastas`) e a Central só lê:

- o fluxo `08 · CRM` do n8n lê Leads, Prospects e a aba CRM a cada 10 min (e
  por `POST /webhook/crm-atualizar`) e grava `~/.local/share/n8n-estado/crm.json`,
  as linhas como vieram, com o cabeçalho que a planilha tiver; falha de leitura
  grava `crm-falha.json` e deixa o retrato anterior valendo;
- `server/crm.ts` junta esse retrato com as pastas (`server/auto-production.ts`,
  que agora só lê pastas, artefatos da fila do gerador e `.logs/status.json`) e
  os Mapas de `~/prumo-entregas` e põe cada lead numa das 5 etapas (Novo,
  Em contato, Proposta, Ganho, Perdido) com a subetapa do produto. Desde
  08/10/2026 Contatado e Conversando são Em contato, com prazo: 7 dias sem
  mensagem do lead e ele vai para Perdido (próximo passo ou proposta seguram);
  é cálculo do CRM, a planilha não muda. O `site-demos-limpeza` do Dell lê esta
  visão e apaga na Vercel o demo de quem está em Perdido há 2+ dias.
  As regras ficam em `etapaDoSite`/`etapaDoPrumo` e os nomes de coluna em
  `COLUNAS_DO_*`; coluna ausente vira vazio e aviso na tela;
- divergência entre planilha e pasta vira nota na ficha, nunca correção;
- nota, próximo passo e proposta: `POST /api/operations/crm/registro` →
  servidor da Central → `POST http://127.0.0.1:5679/webhook/crm-registro` com o
  header `X-CRM` → uma linha acrescentada na aba CRM. A Central não grava etapa
  nem registro próprio; `auto-production.json` deixou de ser lido;
- desde 14/10/2026 o toque em "Mandar o link" e "Mandar o follow-up" anota o
  envio pela mesma rota (`segunda_enviada`, `followup_enviado`; idempotente por
  2 min, só para a etapa certa). A 2ª mensagem anotada depois da resposta tira
  o interesse parado da Hoje (antes ele sumia em 48 h sem o CRM saber se o
  link saiu) e o follow-up anotado apaga o "follow-up hoje"; os dois alimentam
  o Resultados. A única memória da Central é a de 2 min contra o clique duplo;
- desde 14/10/2026 o lead em que só a resposta automática do WhatsApp Business
  respondeu (`so-robo`, Site e PRUMO) ganha um reenvio único no mesmo grupo
  "Follow-up para mandar": do dia seguinte ao envio (calendário de São Paulo)
  até o último antes do prazo, sem depender do dia do `followup_em` do n8n, com
  o texto que pede o responsável (`reenvioDoRoboHoje`, `REENVIO_ROBO*` em
  `site-mensagem.ts`/`prumo-mensagem.ts`, só do CRM; EUA e Site sem demo ficam
  com o follow-up de sempre). O `followup_enviado` o tira e recomeça a contagem
  dos 7 dias no reenvio (só para o só-robô; o reenvio anotado também suspende o
  "expirado" da planilha). Fora do expediente ele trava como o envio e o convite;
  o aviso do 05 · Acompanhamento continua com o texto antigo.

`GET /api/operations/crm` não leva o instante da leitura: a resposta só muda
com o retrato, as pastas ou o dia, e o ETag do Express devolve 304 ao celular.

### Acesso pelo celular (30/09/2026)

O processo continua escutando só em `127.0.0.1:9120`. O Tailscale Serve do Dell
publica esse loopback em `https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/`,
só para a tailnet (não é Funnel), numa porta própria: `/` (Hermes) e
`/webhook` (n8n) na 443 não mudam. O Serve reescreve o `X-Forwarded-For` com o
IP do aparelho da tailnet, e o porteiro de IP (`server/acesso.ts`, que desde
então aceita faixas CIDR) admite loopback e as faixas da tailnet.

O porteiro sozinho admite **qualquer** nó da tailnet. Antes de o app (que
escreve no Google e guarda finanças) entrar neste processo, entram as outras
duas travas da regra 7: a ACL do Tailscale restrita aos aparelhos do Rômulo
para a 8443 do Dell, e a conferência do `Tailscale-User-Login` que o Serve põe
em cada requisição (e apaga quando vem do cliente). Requisição local direta,
sem `X-Forwarded-For` do Serve (o `atualizar-central` perguntando
`/api/runtime`, o túnel SSH do PC no callback do OAuth), não tem esse header e
continua aceita. Escrita exige `Origin`/`Sec-Fetch-Site` da mesma origem,
porque o header de identidade também acompanha um POST forjado por outra
página aberta no celular.

No código (07/10/2026, `server/acesso.ts`): uma lista só,
`SQUADONE_LOGINS_TAILSCALE` no `operations.env`. `guardaDeIdentidade` vale para
toda requisição quando a agenda está no processo (lista vazia então fecha a
tailnet) ou quando a lista existe; sem os dois, a Central de hoje segue aberta
à tailnet como antes, e só `/api/financas/*` fecha para quem chega pelo Serve.
"Chegou pelo Serve" = trouxe `X-Forwarded-For`, `Tailscale-User-Login` ou
`Tailscale-Funnel-Request`; Funnel nunca passa. `guardaDeOrigem` exige, em toda
escrita em `/api`, `Origin` com host e porta iguais aos do `Host` e, quando o
navegador manda, `Sec-Fetch-Site: same-origin`. A ACL do Tailscale continua um
passo manual no console.

O fluxo observado é Caçador do n8n → pacote em `auto-entrada` → `~/auto-site`
→ `gerador-de-sites` (Claude Code + Vercel) → `publicado.json` → watcher Linux
→ `hermes send` → WhatsApp; o Balcão do n8n lê os mesmos `publicado.json` em
`~/auto-site`. O Google Drive saiu do fluxo em 23/09/2026: a pasta `auto` do
Drive era só um espelho, pelo PC, e está parada desde 25/09/2026 (ver
`deploy/pc/README.md`). Não existe chamada direta entre n8n e o runner. A
Central não executa, reinicia nem reconfigura nenhum desses serviços; o CRM
relê o retrato a cada 2 min com a aba visível (a rota SSE da Produção Auto saiu
em 30/09/2026).

A listagem de clientes é consultável e paginada no servidor. O resumo e o
funil continuam representando todo o diretório; busca, estágio, ordenação e
página limitam apenas as linhas devolvidas. Isso evita renderizar toda a base
à medida que novos clientes e sites forem anexados.

As leituras do Hermes são uma entrada local, somente leitura, carregada de
`SQUADONE_OPERATIONS_DATA_DIR/hermes-readings.json`. Cada leitura identifica o
projeto, a origem, o instante, o resumo e a evidência disponível. A ausência do
arquivo representa uma caixa vazia; a interface não inventa leituras nem oferece
uma escrita genérica em nome do agente.

A agenda da Central reutiliza o armazenamento OAuth e a leitura do Google
Calendar do processo local do SquadOne. A credencial fica no Dell e é
independente da produção; o callback retorna por loopback. Não existe agenda
paralela: sem essa autorização local, a API devolve explicitamente
`disconnected`. A ação de conexão da Central inicia `/api/auth/google`
diretamente e o callback retorna à raiz da Central.

No Dell, `deploy/dell/squadone-operations.service` é instalado como serviço de
usuário com linger. O arquivo de ambiente, a configuração real e os dados ficam
respectivamente em `~/.config/squadone/operations.env`,
`~/.config/squadone/operations.json` e
`~/.local/share/squadone-operations`.

## Modelo operacional pessoal

O Dell (a Mel) é o worker persistente e o servidor de projetos (Docker).
Claude e Codex controlam e corrigem o ambiente a partir da máquina de controle,
pelo SSH e pela Tailscale; o código vai pelo GitHub.

**Máquina de controle, desde 04/10/2026:** o PC novo (o Jarvis, Windows,
`paiduben` na tailnet). Ele entra na Mel por `ssh mel` (só chave), abre a
Central, a Entrada, o Hermes e os webhooks pela tailnet, e o editor do n8n e o
code-server por túnel SSH; o app Claude do PC também pode abrir sessões do
Claude Code que rodam na Mel. De 28/09 a 04/10/2026 o próprio Dell foi a máquina de
controle, porque o PC antigo queimou (NVMe; visto pela última vez em
25/09/2026); o que não tinha sincronizado com o Dell nem ido ao GitHub foi
perdido. Estado, túneis e checklist em `deploy/pc/README.md`.

**O PRUMO é dono de tudo (28/09/2026).** O Site antes da venda passa a ser a
frente "Vender mais" do PRUMO. A fonte da verdade do PRUMO é o repositório
privado `romulosutil/prumo` (`~/prumo` no Dell). No Drive, o negócio fica em
`PRUMO/`: `Sites antes da venda/` (espelho de `~/auto-site`) e `Consultoria/`
(espelho do repositório). São espelhos só de leitura, feitos pelo próprio Dell.
Um cofre cifrado com o que refaz o Dell (n8n e chave, Hermes, segredos) fica à
parte, em `Backups/dell-worker/`. Tudo sai de um manifesto único
(`deploy/dell/backup/fontes.toml`) e o `dell-status` avisa quando um deles
atrasa. A junção física da esteira dentro do PRUMO (pastas, fluxos) é um passo
seguinte.

O Hermes é o carteiro do WhatsApp: não opera nem decide, só entrega o que
chega pela fila de avisos (do `dell-status`, do n8n e, depois da mudança, do
SquadOne) e o que as rotinas próprias dele produzem. Para o SquadOne ele é só
transporte, não motor nem orquestrador, e trata como dado as mensagens que ele
mesmo enviou (regra 20). O n8n do Dell é o gerente de fluxos e todo fluxo
termina respondendo a alguém (Error Workflow único + avisos pela fila). O
SquadOne é o app: agenda, agentes, CRM e finanças. Antigravity organiza
documentação e arquivos.

O repositório CORPORATIVO é espelhado em `~/Corporativo-dev` como somente
leitura no Dell: era editado no PC e nada no Dell propaga de volta. Sem o PC,
a pasta é o último retrato de 25/09/2026 e não recebe mais nada.

O diretório `~/Pessoal-dev` no Dell é uma réplica da pasta de desenvolvimento
do PC feita pelo Syncthing, congelada em 25/09/2026 (o Syncthing, sem aparelho
pareado desde 04/10/2026, foi aposentado em 12/10/2026; o código chega à Mel
pelo GitHub). Ele serve para o Hermes
enxergar o trabalho, mas não é uma fronteira Git confiável: metadados `.git`
podem estar incompletos. Operações de branch, commit, push e pull usam clones
Git próprios no Dell (o checkout de origem no Windows se perdeu com o PC). O
GitHub é a fronteira de integração entre os agentes.

Credenciais não ficam na pasta sincronizada, em skills ou na configuração do
SquadOne. OAuth do n8n usa o armazenamento cifrado de credenciais do próprio
n8n. Sessões web persistentes podem auxiliar o Hermes, mas login inicial, MFA
e consentimentos sensíveis permanecem sob ação humana. O SquadOne recebe
estado e evidências; ele não recebe senhas, tokens nem poder de controle sobre
os serviços. As credenciais do domínio dele (Google, Pluggy, bot do Telegram)
ficam em arquivos `600` do usuário do serviço, fora do Git, e o Rômulo as
digita no Dell, nunca pelo chat.

O playbook instalável do gestor fica em
`deploy/hermes/skills/dell-operations-manager/SKILL.md`.

O modelo de orquestração, as conexões pendentes e a separação entre credenciais
humanas, OAuth e segredos técnicos estão em
`docs/OPERATIONS-SECRETS-AND-ORCHESTRATION.md`.

## Workflows PRUMO no n8n

Desde 23/09/2026 o PRUMO é simples (decisão do Rômulo). A planilha "PRUMO — Fila
de revisão" tem uma aba de trabalho, **Prospects**, com uma coluna **Etapa**:
Revisar → Convite enviado → Diagnóstico pronto → Concluído | Sem interesse.
"Descartados" (só para não reavaliar) e a antiga "Leads" ficam ocultas.

- **Lead Scout** (desligado no n8n desde 08/10/2026: 57 convites frios a
  distribuidoras, 21 respostas de robô, nenhum dono interessado; a empresa com
  equipe chega pela CDL ao Mapa, grátis, e a Fonte só vem depois dele (09/10) e `n8n.DESLIGADOS` impede os `prumo-*.py` de religá-lo. Era:
  9h, rodízio de 80 buscas segmento × cidade): Google Places →
  WhatsApp publicado no site → nota → Prospects (com o link "Enviar convite ↗")
  ou Descartados; cadastro repetido (mesmo WhatsApp) é descartado. Resumo da
  busca pelo Hermes.
- **Clique em "Enviar convite"** (webhook do n8n pelo túnel): só abre o WhatsApp com
  a mensagem e o formulário já com a empresa e o papel "Dono"; não marca nada. A Etapa
  muda para Convite enviado quando o **observador do WhatsApp** vê a mensagem sair
  (desde 19/10/2026; o nó "Marcar como enviado" nunca gravava e saiu).
- **Diagnóstico do dono** (de hora em hora): a resposta completa mais recente
  da empresa fecha o Índice (a média das 16 respostas, 0 a 100), grava Índice e Briefing na linha e muda a
  Etapa para Diagnóstico pronto. O aviso para o Rômulo é um só, o do Mapa (`prumo_mapa.py`, com o Índice
  do Prumo X/18); o aviso "Diagnóstico pronto" do próprio fluxo saiu em 19/10/2026 (eram dois WhatsApps com dois
  índices para a mesma resposta). Também grava as pendências que a Central mostra em "Esperando você".

O vínculo entre formulário e linha é o `ID` (ID do Google Places), enviado no
campo Empresa como `ID::Nome`. Os scripts que montam tudo isso estão em
`deploy/dell/claude-ops/` (`prumo-simples.py`, que monta o Diagnóstico, a Pontuação e o clique do convite; `prumo-mapa-n8n.py`, o ramo do Mapa; `prumo-ofertas.py`, os caçadores do Iris e das
estamparias; `prumo-publico.py`, a Fonte e a Medição), cada um idempotente pela API do n8n. A regra do nome da empresa é
um arquivo só, `prumo-nome.js`, embutido nos construtores e comparado com `nomeDaEmpresa` do CRM por teste. Os JSON de `ops/n8n/workflows/`, o
`scripts/prepare-prumo-workflows.mjs` e o `prumo-ajuste-planilha.py` descreviam o desenho anterior a 23/09/2026 e foram apagados em 19/10/2026
(`ops/n8n/README.md` explica); resta só a fixture `deploy/dell/claude-ops/testes/prumo-diagnostico.fixture.json`.

## Radar PNCP

O radar PNCP é executado pelo Compose em `~/licitacoes-automation` no Dell, com
fontes versionadas em `deploy/dell/licitacoes-automation/`. O n8n apenas inicia
a coleta: `POST /collect` responde `202 Accepted` com um `collection_id`, e o
collector consulta o PNCP em segundo plano. Uma nova chamada durante a coleta
ativa reutiliza o mesmo ID; `GET /collections/:id` expõe o estado persistido.
Falhas da fonte são gravadas como `source_unavailable` para a próxima execução
agendada tentar novamente sem manter o workflow bloqueado.

## Riscos aceitos

### Disco do Dell sem cifra (registrado em 06/10/2026)

O Dell é ext4 **sem LUKS**. Quem levar o notebook (roubo, assistência técnica,
descarte) e montar o disco em outra máquina lê tudo em claro: o `financas.db`,
o `google-auth.json` **e** a `TOKEN_ENC_KEY` que o decifra (os dois no mesmo
disco), a sessão do WhatsApp do Hermes (o número pessoal), o login do ChatGPT,
o token do bot do Telegram e os segredos do n8n e de `operations.env`. Com o
app único, o Dell passa a guardar finanças e a credencial de produção do
Google, então o risco cresce com a mudança.

O que **não** protege, e por isso não é feito como se protegesse:

- permissão `600`: segura outro usuário ou o container do n8n, não quem tem o
  disco;
- cifrar campo a campo, ou o arquivo inteiro, com a chave no mesmo disco: é só
  aparência, e ainda complica o backup e o diagnóstico (regra 24);
- o backup cifrado (cofre restic): protege a cópia fora do Dell, não o Dell.

O que protege de verdade é o disco cifrado (LUKS), que exige reinstalação ou
uma janela de manutenção e é decisão em aberto do Rômulo. Até lá, se o Dell
sumir, o que fazer é revogar tudo de fora, sem depender dele:

1. remover o nó da tailnet no console do Tailscale;
2. revogar o acesso do app em myaccount.google.com/permissions;
3. revogar os consentimentos no Meu Pluggy e trocar o Client Secret da Pluggy;
4. desconectar o aparelho vinculado no WhatsApp do celular;
5. `/revoke` do token do bot no @BotFather;
6. sair de todas as sessões do ChatGPT;
7. trocar os segredos guardados no cofre que vivam no Dell.

### Confiança no loopback

O header de identidade do Tailscale (regra 7) vale porque o processo escuta só
em `127.0.0.1` e só o Serve chega de fora. Qualquer processo que já roda no
Dell consegue falar com o loopback e forjar o header. Aceito: quem roda no Dell
já lê as credenciais direto do disco, e uma trava contra ele aqui seria
aparência, pelo mesmo motivo do disco acima.
