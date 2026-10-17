# Testes: o que cada arquivo cobre

> Movido do `CLAUDE.md` em 11/10/2026 para a sessão não carregar isto toda vez.
> O texto é o original, sem alteração; o `CLAUDE.md` guarda só o resumo das regras.

Os testes são pontuais — só as regras puras que dá para fixar em tabela de casos
(hoje `server/baixa-prioridade.test.ts`,
`server/lembretes.test.ts`, `server/vigia.test.ts` (inclui, desde 17/10/2026, a cola do resumo matinal: um por dia,
retentativa, leitura incompleta não vira "dia livre"), `server/resumo-matinal.test.ts` (janela 07:30–11:00, agrupamento,
foco somado, nenhum R$, corte em 30 linhas), `server/auth-store.test.ts`,
`server/passos.test.ts`, `server/tasks.test.ts`, `server/passos-no-google.test.ts`,
`server/auth-escopos.test.ts`, `server/squad.test.ts`, `server/calendar.test.ts`,
`server/prompt-passos.test.ts`, `server/telegram.test.ts`,
`server/telegram-entrada.test.ts`, `server/telegram-resposta.test.ts`,
`server/telegram-bot.test.ts`, `server/avaliacoes-turno.test.ts`,
`server/operations.test.ts` (inclui a config das ferramentas com e sem o Syncthing
opcional e o `/overview` num servidor de saúde dublê em loopback), `server/auto-production.test.ts` (desde 15/10/2026,
os achados do Raio-X no recibo: só ids conhecidos e números com sentido),
`server/dell-status.test.ts`, `server/prumo-workflows.test.ts`,
`server/prumo-ofertas.test.ts` (14/10/2026: contrato entre `deploy/dell/claude-ops/prumo-ofertas.json`, o que
os caçadores do Iris e das estamparias gravam, e o CRM: aba e caminho do convite iguais aos de
`OFERTA_DE_PROSPECCAO`, cabeçalho com toda coluna que o CRM lê, cada Etapa da lista com lugar no funil, convite
sem nome, R$, link nem segunda pergunta, cliente do PRUMO e não-cliente-final fora),
`server/tarefa-avulsa.test.ts`, `server/horizonte.test.ts`,
`server/crm.test.ts` (inclui, desde 15/10/2026, os achados do Raio-X e o porte pelo CNPJ no lead, com `equipe` só
quando o porte foi conferido, e o follow-up só para quem leu, no Site e no PRUMO, e o Revisar com o
WhatsApp não confirmado depois de todo confirmado; desde 14/10/2026, o loop fechado: interesse parado além de 48 h que só some
com a 2ª mensagem anotada depois da resposta, `followup_enviado` que apaga o follow-up do dia, o regime da
mensagem pelas mesmas datas de corte do `funil-aprendizado.py`, a validação do envio por etapa e a
idempotência de 2 min com `fetch` dublê: clique duplo, toques simultâneos e retrato já refeito; o reenvio do
só-robô: elegível do dia seguinte ao envio pelo calendário de São Paulo ao 6º dia, fora do dia do `followup_em`,
some com o `followup_enviado`, EUA e Site sem demo no follow-up de sempre, ação e rótulo na Hoje com quem sai
antes na frente, e o prazo que recomeça no reenvio só para o só-robô, inclusive com a planilha já "expirado"; e o
demo sob pedido: Raio-X avulso sem demo, só o raio-x na segunda, o "Gerar demo" até o pedido e a mensagem do demo depois;
a mensagem A sem demo (15/10/2026): "pronto" com o aviso de sem demo, "Primeiro contato para enviar", e quem quer ver só com o "Gerar demo";
e a coluna `ab_elegiveis` lida como `abordagem.elegiveis`, normalizada, ilegível ou ausente sem aviso),
`server/site-mensagem.test.ts` (roda o `site-mensagem.js` do n8n num `vm` e compara com o espelho, também nos casos do
Raio-X avulso; o reenvio do só-robô, que é só do CRM: artigo e nome, a versão do raio-x para quem recebeu a C, sem
R$/saudação/"ontem", EUA sem reenvio; desde 14/10/2026 o essencial do A/B estratificado (`alocarRodada`): conjunto
elegível, 30 leads em 10/10/10, contagem vinda da planilha sem manual/EN, congelamento e novo sorteio, sem demo só a C
ou nenhuma mensagem, EUA, só A e nicho vazio; os casos completos estão no `site-antes-da-venda.py --testar`),
`server/prumo-mensagem.test.ts` (o reenvio do só-robô do PRUMO: nome como o dono escreve, artigo, só número 55),
`server/plus.test.ts` (filtro Plus: leitura do PDF em colunas, telefone, oferta e dedupe, mensagem maçônica com o artigo certo, funil só pelos registros, Hoje limitada, `lerPlus` e gravação em diretório temporário), `server/acesso.test.ts`,
`server/avisos.test.ts` (desde 16/10/2026 também o aviso pessoal pelo Telegram, OT-14: não grava na fila, sem som das 22h às 7h,
fila de reserva com o bot fora, P0 nos dois canais, R$ recusado antes de sair, a variável só desliga com `false`),
`server/telegram-polling.test.ts` (offset, 409, e quando declarar queda, 17/10/2026, AC-07: tabela de `declararQueda`/`tipoDaFalha`;
soluço de uma tentativa não loga "inacessível" nem "voltou", e a queda real loga os dois, com backoff),
`server/uso.test.ts` (17/10/2026, AC-28, o contador de uso: a tela normalizada (`lead=` vira "(ficha)", finanças só pelo caminho,
query e telefone fora, "(outra)"), a chave da escrita (ids e telefones viram `:id`, GET e o próprio beacon não contam), o corpo do
beacon, a virada do dia em São Paulo, o teto de chaves, a poda de 90 dias e a gravação com debounce em diretório temporário),
`server/sinal-de-vida.test.ts`, `server/agenda-no-dell.test.ts`,
`server/roster-historico.test.ts`,
`server/time.test.ts` (o time vivo agrupado por squad e o leitor com cache),
`server/luna-sombra.test.ts` (a saída da Luna como dado, a comparação com o
Gemini, as flags do `codex exec --help`, e a cola — teto do dia, fila serial,
cota, JSONL — com o `codex` dublado num diretório temporário),
`server/openrouter-decisoes.test.ts` (o transporte do Jev com `fetch` dublê e
chave inventada: `questions` é objeto, `provider` sempre com `data_collection:
"deny"` e ZDR, a máscara de telefone/e-mail/CPF/CNPJ/URL/segredo, a resposta
validada contra os rótulos enviados, 402/401 desligam até reiniciar, 429 sem
retry, timeout, corpo sem `usage`, config ilegível e a chave nunca em erro nem log),
`server/jev-sombra.test.ts` (as quatro perguntas com a ordem embaralhada e gravada,
nada de finanças nas opções nem na demanda, o resumo do Gemini e a comparação, e a
troca sugerida sem gabarito, a máscara antes do corte de 2000 caracteres, e a
cola com `fetch` dublê num diretório temporário: fila serial, teto do dia que
sobrevive a reinício, teto total de gasto, JSONL 600, 402 desliga, observação
sem `await` que não segura o turno, falha que nunca lança, e null fora do `operations`),
`server/copiloto.test.ts` (o copiloto do PRUMO, 15/10/2026, com provedor dublê num diretório temporário: a sugestão
guardada pelo hash do dossiê e relida do JSONL depois de reiniciar, forçar e dossiê novo geram de novo, clique duplo
vira uma geração, teto do dia que conta a tentativa e sobrevive a reinício, preço sob proposta vira falha que não fica
guardada, lead fora do CRM e passo sem copiloto, a cópia registrada; o codex por `execFile` com stdin, read-only e o
arquivo da resposta apagado, cota/timeout/sem mensagem; o Gemini pedindo JSON; config ilegível lança, null fora do
`operations` e com o codex que não confere; o caminho do Raio-X sem `..`),
os de finanças em `server/financas/` (`natureza`, `transferencias`, `dedupe`,
`parcelas`, `visoes` — com o obrigatório "o mesmo gasto nunca conta duas
vezes" —, `resumo` (e os nomes das contas de cada conexão para o selo de saúde, AC-26,
em tabela: corrente antes de cartão, nome repetido uma vez, a manual fora, nenhum valor),
`pluggy-mapa`, `fatura-santander`, `rotas` (as travas de acesso
e o "Explicar este mês": sem a flag 404, hash errado 409, o dublê do Gemini recebe o
texto da prévia, `ModeloOcupado` 503, o `/visao` com as contas de cada conexão; desde 17/10/2026, o
`POST /gasto` do cartão do Assistente: mesma origem exigida, grava na conta manual, o mesmo cartão tocado de novo não
duplica, 400 para frase que não é gasto — com um SQLite num diretório temporário),
`organizacao`, `alertas` (nenhum R$ sai), `gasto-falado` (e, desde 17/10/2026, `lerPedidoDeGasto` em tabela: texto até
300, origem fora do formato recusada, a chave `painel:<id>`), `extrato`, `explicacao`
(o pacote padrão sem R$ nem estabelecimento, o que cada toggle acrescenta, o hash),
e `sync` e `organizar`, estes dois com um SQLite num diretório temporário),
`server/telegram-gasto.test.ts`,
`src/ajuste-do-usuario.test.ts`,
`src/operations-agenda-window.test.ts`, `src/operations-alertas.test.ts` (além de `separarAlertas`, links e filas, desde 17/10/2026,
AC-17, `resumoDoDell` em tabela: sem retrato, sem horário, retrato com mais de 5 min, tudo ok, só falhas, só filas, só "resolvem sozinhas",
a mistura de 43 de 49 e um aviso, conferindo `total − ok = precisam + sozinhas`; e `semFraseCortada`),
`src/operations-fila-de-envio.test.ts` (marcas de envio no navegador, a fila por nicho, pular, o passo e a marca "vídeo enviado" do A/B),
`src/operations-resultados.test.ts` (o placar do CRM: só enviados no período, robô não é resposta, recusa só entre enviados;
sem letra, a linha da mensagem pelo regime; follow-up anotado e quem respondeu depois, com amostra pequena; desde 17/10/2026,
AC-03, uma regra por métrica: `leu`/`respondeuDeGente`/`quisVer` em tabela (robô, `respondeu_em` sem classificação, classificação sem a
coluna, Plus), o funil e o placar dão o mesmo número na mesma janela de 30 dias, e a taxa do expediente é a mesma com ou sem o filtro do Site),
os do Assistente da Central (17/10/2026, RULES 28): `server/assistente.test.ts` (finanças sem modelo e sem o texto no JSONL,
máscara no prompt e no arquivo, cartão proposto sem escrita, teto da tentativa e das respostas por regra, corrida de dois POSTs, o
Hermes que falha ou responde e que NUNCA volta ao Gemini no histórico (também depois de reiniciar), releitura, poda por data de linha,
prazo de 4 min, rotas com Express real e guarda de origem, imports sem escrita; desde a fase 2, 17/10/2026, a leitura do copiloto:
o cartão `sugestao_do_copiloto` leva só a referência, nem R$ nem o texto da sugestão no JSONL, sem copiloto a leitura nem é declarada,
um cartão por lead), `server/assistente-ponta.test.ts` (de ponta a ponta com
as funções reais do painel: Ficha → buscar_lead/ler_lead → cartão de anotação aceito pelo validarRegistro; id inteiro ou só a chave;
tela de Finanças sem leitura nem modelo; os desvios 400 pendente e 404), `src/operations-assistente.test.ts` (rotearLocal, prepararTexto,
promptDoRoteador sem telefone/R$/trabalhador, lerCartaoProposto em tabela, valor com cara de preço recusado nos três cartões, fontes,
histórico com a marca do Hermes, poda; fase 2: `sugestaoParaOModelo` sem preço e `cartaoDaSugestao`), `server/hermes-consulta.test.ts` (Hermes consultado: prompt marca o pacote como dado; saída sem
ANSI, código, JSON de ação nem R$; sessões da pasta apagadas antes e depois; ambiente sem SQUADONE_/GEMINI; timeout, ocupado, teto em
arquivo 600; pasta não vazia falha fechada; diretório temporário, nunca o HOME real), `server/financas/parece-financas.test.ts` (a régua
única de "parece finanças": 51 casos que barram, inclusive plurais, BRL/US$/R＄, aluguel, conta de luz, banco, "1.200 do aluguel", e 22 que
passam, como "o que devo responder?" e "mil desculpas") e `src/casca/assistente.test.ts` (o painel: contexto do endereço, atalhos por
página sem Finanças, junção pelo `n`, etapas e falhas, erro HTTP → falha, chave do registro, o cartão com a oferta e o aviso de outro lead,
polling com relógio e visibilidade falsos; fase 2: `gastoDoTexto`, `textoDoValor` e `linhaDoTempo`, que intercala os gastos da aba
com as mensagens do servidor),
`server/crm-desfecho.test.ts` (17/10/2026, AC-08 e AC-10: ganho e dispensa marcados na Central nas cinco ofertas, com desfazer e
ganho × perda (vale o mais novo); `validarRegistro`/`conferirDesfecho` em tabela; `prioridadeDaTriagem`, `notaDoGoogle` e
`taxasDeRespostaPorNicho` em tabela),
`src/operations-agora-e-desfecho.test.ts` (17/10/2026, AC-05/08/09/12: `fraseDaAcao`, uma frase por tipo de ação e a mesma no cartão da
Próxima venda e no "Agora" da Ficha, com e sem o copiloto; `acaoDoLead` dá ação ao segundo lead "pronto"; `agoraDaFicha` sem ação (ganho,
perdido, próximo passo salvo, esperando desde, vez do robô); `linkDoPasso` nunca abre o gerar_demo; `desfechosDoLead`, estados e desfazer
por caso; `anotacoesAMao`, 2ª mensagem e follow-up no passo ou com falha),
`src/operations-triagem.test.ts` (17/10/2026, AC-10, `triagem.ts`: o lote nasce com os 10 primeiros na ordem do servidor; dispensar tira o
item na hora sem puxar o 11º; o convidado fica à vista sem contar como pendente; decidido o lote, vêm os 10 seguintes; dispensado no retrato
(`perdaManual`) fica fora; poda da marca local (dispensado confirmado, convidado fora da Revisar, lead sumido, vencida); storage quebrado;
o corpo do registro; a pontuação só quando diferencia; o motivo curto do Convidar desligado),
`src/operations-proxima-venda.test.ts` (17/10/2026, AC-02: a contagem da fila do dia (`resumoDoDia`: total igual à soma da quebra por tipo,
primeiros contatos prontos e quantos o ritmo ainda deixa hoje, 0 na pausa), `textoDosPrimeiros`, `filaDaTela` (um primeiro contato por vez,
só no expediente e com ritmo livre; "Enviei" sai, "Pular" vai para o fim) e as resolvidas do dia no storage (outro dia e storage ilegível = vazio)),
`src/operations-anotacao-de-envio.test.ts` (a anotação do toque na 2ª mensagem e no follow-up: qual link anota, o primeiro
toque vale, storage que lança, poda quando o retrato confirma, anotados no fim do grupo da Hoje),
`src/operations-trava-de-horario.test.ts` (a trava do envio fora do expediente: só com aviso, liberação por lead sem mutar o conjunto, 19h e domingo travam, 10h não;
o que trava em tabela: envio, convite e o reenvio do só-robô, nunca o follow-up de sempre nem a 2ª mensagem; o rótulo "Pedir o responsável";
desde 16/10/2026, OT-02: a janela única seg–sex 8h–17h30 em tabela (17h45 e sábado agora travam), a Próxima venda usa a mesma função,
"pode mandar" = expediente ou liberado e sempre com o ritmo livre, e o trecho do Roteiro sem WhatsApp antes do primeiro contato),
`src/operations-velocidade.test.ts` (16/10/2026, OT-09: do "quero ver" ao link pela 2ª anotada ou pelo link visto na conversa, link antes do
interesse não conta, do link à proposta, perdido não espera e fora dos 30 dias não entra, mediana e duração legível),
`src/operations-financas-importar.test.ts` (16/10/2026, OT-11: o "Importar" único de Finanças manda PDF à fatura e OFX/CSV/.txt ao extrato pela
extensão, MIME só sem extensão, .xlsx/.jpg recusados na tela; e, em `casca.test.ts`, o Usar do Mais só com o que a barra da tela não alcança),
`src/operations-trava-de-ritmo.test.ts` (a trava de ritmo de 15/10/2026: o caso real de 25 envios em 25 min vira intervalo de 4 min, 8 por hora e
10 no dia; teto por semana desde o início do número; dia de São Paulo; pausa antes de tudo; de onde vêm os instantes: enviado do retrato, o reenvio do
só-robô, o toque desta tela sem contar duas vezes; storage de 24 h que lança),
`src/operations-funil-lista.test.ts` (a Lista do Funil no desktop, 16/10/2026: o sinal mais forte por ordem (Resposta nova > Follow-up hoje >
Perdido amanhã > Divergência > o resto), follow-up anotado deixa de ser "hoje", ordenar por último toque e próximo passo com quem não tem data no fim
nos dois sentidos, as etapas abertas, e a vista guardada com storage que lança; desde 17/10/2026, AC-03, `contagemDaEtapa`: Quadro e Lista
contam igual para a mesma escolha de "Mostrar descartados", e o que fica de fora vira "+N descartados antes do contato"; AC-19:
a coluna Próximo passo pela `acaoDoLead`, `opcoesDeNicho` (uma opção por grafia do nicho), o filtro Passo e o rótulo curto único da oferta),
`src/operations-ab-video.test.ts` (A/B do vídeo: hash estável em tabela e ~50/50 em 1000 ids, Fisher exato contra o R, veredito com +20 pontos e p < 0,10, amostra insuficiente, leitura só depois dos 7 dias, quem entra no teste, braço trocado),
`src/operations-ab-mensagem.test.ts` (A/B estratificado da 1ª mensagem, 14/10/2026: sem `ab_elegiveis` o bloco fica vazio e o histórico é contado como fora; 29 × 31 só "faltam", sem taxa nem respostas; 30 × 30 com taxa, Fisher e veredito; +20 pontos e p < 0,10 nos dois sentidos; robô não conta; só entre quem podia receber as duas letras; estrato por nicho),
`src/operations-colinha.test.ts` (a colinha do PRUMO: o trecho de cada etapa e resposta, a objeção reconhecida no texto, a esteira vinda de `site-mensagem`, o lead do Site que recebeu a C só com textos do raio-x (segunda e follow-up; com o Raio-X avulso, o raio-x sozinho antes do demo e a mensagem do demo depois), nenhum R$ fora do cardápio, o cardápio ver → arrumar → manter com o Mapa grátis, o convite para o Mapa só depois do Raio-X e com equipe, Respondido/Fonte "sob proposta" sem valor nas mensagens fora da proposta, e nenhum cliente fundador),
`src/operations-jornada.test.ts` (a jornada do cliente, 15/10/2026: o passo atual pelo retrato, o caminho de cada funil (PRUMO com os dois trilhos, Site sem Mapa, Iris e estamparias no caminho curto, Plus pela oferta), o estado de cada passo (outro trilho "depois", fecho "sem registro"), o próximo passo (o salvo à mão manda; depois do Raio-X, o Mapa e o site), a oferta por lead (Raio-X antes de tudo, Encontrado para quem não tem site, Mapa só com equipe, "já temos site"; e a oferta
sob medida: a tabela de casos em que o que o Raio-X achou ordena as ofertas e entra no porquê com o número, e o porte do CNPJ põe o Mapa agora), a vista por passo com o parado só quando espera você, nenhum R$ e o guia `jornada-do-cliente.md` igual ao gerado),
`src/operations-copiloto.test.ts` (o dossiê e a leitura da saída do copiloto, 15/10/2026: onde ele vale (do respondeu à proposta), a máscara de telefone/e-mail/wa.me, o texto do Raio-X sem script nem tags, o dossiê com jornada, oferta, objeção da colinha, histórico mascarado, Iris sem cardápio e Plus pelo funil; os preços que a mensagem pode ter (só Encontrado, Anúncios e Redes, com e sem "R$"); recusas classificadas (JSON, formato, id inventado, preço sob proposta) e avisos (não oferecer, oferta própria, grátis na proposta, número fora do dossiê); o rascunho da proposta com preço do cardápio),
`server/conversa-consciente.test.ts` (16/10/2026, a Próxima venda consciente da conversa, com o caso da Kulniski: a
chave do arquivo pelo número; o resumo (link do demo numa mensagem nossa, saída sem texto nunca é link); o toque que não
virou mensagem não conta e o link visto entra; o "o que achou?" no lugar de mandar o link de novo; "vou pedir o link" não
encerra o "quero ver"; sem conversa, o cartão pede para conferir; mensagem nova dele é uma vez nova; a sugestão do
copiloto no lugar do texto pronto sem anotar envio; quem o automático lê primeiro; o vendedor esperando o copiloto até 4
min e saindo com a mensagem dele quando está pronta; diretório temporário próprio),
`server/jornadas-de-venda.test.ts` (16/10/2026, a simulação das jornadas: um lead do Site passa pelo retrato de verdade
(`montarCrm`) do pronto ao "quero ver", e a fila de venda (`proxima-venda.ts`) diz o que fazer em cada passo: primeira
mensagem com o texto do Balcão e só com a trava de ritmo livre; nada para quem não leu; follow-up de quem leu; o "quero ver"
quente com o link do demo; depois da 2ª anotada, ele sai das respostas (achado da simulação, corrigido em `server/crm.ts`);
o "o que achou?" de 20 h a 72 h depois do link; a proposta sem reenviar o preço; o reenvio do só-robô como primeiro contato;
fora do expediente só o lead liberado entra na fila, e nunca com o ritmo travado (OT-02); o histórico do vendedor: "expirou" e "saiu" de
um aviso que fecha sem toque, o resumo dos 30 dias com os "quero ver" à parte e a leitura que pula linha cortada (OT-09);
quem disse não vira "marcar a recusa" no lugar de responder, a exclusão sem mensagem, e o registro recusou encerra e o desfeito volta (OT-06);
o braço do teste do recibo e a regra antiga para quem foi enviado antes ou leu (OT-10); a regra única do follow-up do 3º dia em tabela (OT-15).
`server/venda-do-dia.test.ts` (16/10/2026, OT-01 e OT-10: a memória do "Enviei"/"Pular" zera no dia novo, descarta lixo, a última decisão vale,
grava e relê em diretório temporário; a leitura do teste do recibo por braço, com a exclusão à parte e o p só com o mínimo dos dois lados;
desde 17/10/2026, AC-06: como e por onde cada ação se resolveu (central, telegram, expirou), a anotação uma vez por ação + tipo no dia, os
primeiros contatos das duas superfícies e a leitura do formato de 16/10; AC-21: os liberados do dia (dia novo zera, o formato sem a
chave ainda lê, liberar duas vezes é uma),
`server/vendedor.test.ts` (17/10/2026, AC-06: o aviso aberto resolvido na Central fecha na volta seguinte sem botões, o "Enviei" atrasado
responde "Já estava feito." sem anotar de novo, o aviso expirado vira pulado também para a Central, e a trava de ritmo soma retrato,
servidor e reforço local contando cada lead uma vez).
E o vendedor (`server/vendedor.ts`): expediente seg–sex 08:00–17:30, um aviso por vez, 30 min sem toque vira pulado, o
"quero ver" fura a espera, o "Enviei" de primeiro contato conta na trava antes do retrato, o texto e os botões do Telegram
(callback ≤ 64 bytes). E o "por que não está vendendo" (`por-que-nao-vende.ts`): o gargalo depois do "gostei"),
`server/mandar-proposta.test.ts` (16/10/2026, o "Mandar a proposta" em um toque: tabela de respostas pelo retrato de verdade
(`montarCrm`): "gostei" e "quanto fica" depois do link entram na fila, anotam `proposta` e tiram o "responder" do mesmo lead;
interesse antes do link, neutra sem preço, negativa, sem link e proposta já marcada não entram; entra antes do combinado. O
texto em tabela: Site pela colinha, PRUMO pelos itens do copiloto com "a partir de" e sem a nota interna nem o Raio-X grátis,
só grátis cai na colinha, Fonte com colchetes, Iris e lead sem WhatsApp sem botão; nenhum "R$" fora do cardápio, item por
item; e quando a Ficha oferece a proposta como primário ou ao lado),
`src/office/postos.test.ts`, `src/office/trabalhadores.test.ts` (o catálogo único, 15/10/2026: nasce dos passos de `fluxos.ts`
com o `quando` e a verificação deles, a sala de cada trabalhador em tabela, os caçadores do Iris e das Estamparias, o Plus sem robô,
o link para o passo em Como funciona e o endereço que o abre, e nenhum módulo do servidor importando catálogo, fluxos ou operação),
`src/office/operacao.test.ts` (o Escritório como mapa da operação: o recorte da jornada de cada sala do PRUMO, contagens por passo
com o filtro do produto do CRM, com você e parados sem contar o estoque, o "Ver no Funil" no filtro da oferta (desde 17/10/2026,
com um passo só, também no filtro Passo, no `?passo=` que o Funil lê); desde 16/10/2026
(OT-07) só a contagem, nenhum lead listado na sala; CRM não lido ou sem
retrato = sem sinal (nunca zero), retrato velho marcado, o estado de cada robô só pelo `status.json` com "Sem sinal" para retrato
ausente ou vencido, robô sem verificação ou fora do retrato; desde 17/10/2026, AC-03, o total da sala por etapa do CRM (Em contato +
Proposta) bate com as colunas do Funil),
`src/operations-mapa-unico.test.ts` (16/10/2026, OT-03: todo código `blueprint` de `fluxos.ts` e `jornada.ts` existe como passo ou cartão
em `docs/blueprint/servico.json`, todo passo da jornada tem o seu, o link do Artifact, e os fatos que tinham divergido não voltam: caçadores
ligados, observador lendo Clínicas e Estamparias, revisão na Triagem, lembrete e falha pelo Telegram; desde 17/10/2026, AC-24, um link de
blueprint por fluxo),
`src/operations-glossario.test.ts` (17/10/2026, AC-13, um nome por coisa: o glossário de `src/operations/glossario.ts` aplicado a todo
`.vue` e `.ts` de `src/`, lidos crus; só o texto visível conta (template, mustache, `aria-label`/`title`/`placeholder` e literais com
espaço ou maiúscula), comentário, regex, classe, `href` e chave ficam fora; as exceções que são outra coisa (a aba CRM, o `08 · CRM`, o
CRM de estamparia, `colinha.ts`, "quem fechou" numa mensagem ao lead) em tabela; e a varredura lê de fato o texto das telas),
`src/operations-primeiro-e-nicho.test.ts` (17/10/2026, AC-16, 21 e 22: o nicho normalizado (caixa, acento, espaço) e o filtro da fila
por ele; `liberadosDoCorpo`; quando a Ficha oferece o primeiro contato de um Novo, o ritmo antes do horário, e desabilitado com o motivo),
`src/operations-financas-formato.test.ts` (o dia de São Paulo, as parcelas futuras separadas e em ordem, as opções do filtro de mês e
o nome de cada conexão no selo),
`src/office/vista.test.ts` (Lista|Mapa e escala inteira), `src/office/salaFinancas.test.ts` e
`src/casca/casca.test.ts` (rotas por perfil, Ctrl+K, a ordem da Hoje com o
semáforo das finanças, estado do time só com fonte, com e sem `/api/time`,
linha do funil, o cartão de respostas com o interesse parado na frente; desde 16/10/2026 o `/design-system`),
`src/casca/paleta.test.ts` (17/10/2026, o Ctrl+K, AC-23: as abas de Vendas, Finanças e do Mais só no `operations`, com a dica em
palavras; leads por prefixo de palavra sem acento nem caixa, no máximo 8, nada no perfil `app`, o id só no destino; e quando a mesma
tela precisa de `popstate` (`/crm`) ou de remontar (Mais)),
`src/casca/mais.test.ts` (17/10/2026: qual seção o endereço do Mais abre, `?abrir=manutencao|roteiro` e `?fluxo=`; as Ferramentas
sem Syncthing, CRM nem Agentes, e a reserva fria neutra) e
`src/blueprint/blueprint.test.ts` (16/10/2026: lê o `tokens.css` real; contraste WCAG; o pedido de mudança;
códigos `BP-` únicos; e as regras de homogeneidade sobre todo `.css` e `<style>` de `src/`: nada de rem/px
solto em padding, margin, gap e font-size, nem peso numérico, e todo `var(--x)` definido. Exceção só com
motivo, em `EXCECOES` no próprio teste: hoje só o `GameMap.vue`, pela geometria do mapa),
`server/entrada-pagina.test.ts` (16/10/2026: a cópia dos tokens na página da Entrada da Mel, que a CSP impede
de ler o CSS do app, tem os mesmos valores do `tokens.css`, claro e escuro; nenhum token que muda no escuro fica
de fora; todo `var(--x)` da página é definido nela; a fonte é a Inter servida pela própria Entrada) e
`src/blueprint/servico.test.ts` (16/10/2026: o service blueprint `docs/blueprint/servico.json` tem as cinco
faixas e as três linhas, códigos únicos e no formato `SITE-3-B2`, todo passo com a ação do cliente, ligações
para cartões que existem e todo arquivo citado presente no repositório; versão 2: todo passo de venda numa etapa
comum, otimizações `OT-nn` e telas `TELA-nn` em sequência, com tipo, impacto, esforço e veredito conhecidos e
apontando para cartões e telas que existem, números do funil com data e fonte)). O monitor do Dell tem os seus em Python:
`python3 deploy/dell/dell-status.test.py` (136, só na Mel por causa do `fcntl`; desde 16/10/2026 as falhas pelo
Telegram, OT-14: config do `operations.env` temporário com o ambiente por cima, sem bot/grupo/token ruim/`false` = nada,
`disable_notification` das 22h às 7h, log sem o token, corte em 4096, o "Quebrou" e o socorro da fila pelo bot e pelo
WhatsApp quando o bot falha, com silêncio e teto; a Bot API é dublê e o `operations.env` de verdade nunca é lido; também a verificação
"WhatsApp do PRUMO (Evolution)": tabela de casos da função pura, a verificação some sem o compose, `/saude` com o
segredo só no cabeçalho e nenhum segredo, chave ou telefone no resultado; Docker, systemd e rede são dublês; e o pedido
ao socorro: só falha nova grava, desligado ou não instalado não grava e o "Quebrou" fica igual), o socorro,
`python3 deploy/dell/socorro.test.py` (31, roda no PC e no Dell, 16/10/2026: o aviso gravado pela lib e drenado pelo
dell-status vai pelo Telegram, sem som de noite, e cai no WhatsApp com o bot fora (só no Dell, que importa o dell-status); a lista branca por verificação e detalhe,
todo remédio é restart/start e nada mais, a leitura só lê, os tetos de 2 remédios e 1 Hermes por verificação a cada
6 h e 6 Hermes por dia, a chave de desligar, remédio do Hermes fora da lista nunca roda, telefone e token mascarados
no prompt e no aviso, e o atendimento inteiro com systemctl, docker, reconferência e Hermes dublês); a lib da fila de avisos,
`python3 deploy/dell/lib/aviso.test.py` (formato igual ao do dell-status, cortes,
recusas, R$, gravação atômica, nunca levanta) e o primeiro script que a usa,
`python3 deploy/dell/auto-entrada.test.py`, `python3 deploy/dell/site-pastas.test.py`,
`python3 deploy/dell/site-demos-limpeza.test.py` e `python3 deploy/dell/site-demos-pausa.test.py`
(aviso idêntico byte a byte ao jeito antigo, aceito pelo dell-status, o jeito
antigo sem a lib, a fila ausente sem derrubar a rodada; na limpeza e na pausa
também o texto do aviso do acervo inteiro dentro de 4000 caracteres e, na limpeza,
o estado "avisado" só quando o aviso ficou na fila; a pausa roda o `main` inteiro
com a Vercel dublada). Os demais scripts trocados para a lib (12/10/2026) têm os
seus, todos rodados à mão no Dell: `deploy/dell/prumo-mapa/prumo_mapa.test.py`
(18; "R$" recusado com linha no journal, `[teste]` preservado, pacote ruim não
derruba os outros), `deploy/dell/backup/backup-dell.test.py` (42, só no Dell por
causa do `fcntl`; o código de saída do ensaio não muda com fila ausente, estragada ou
lib que levanta), `deploy/dell/gerador-de-sites.test.py` (108; desde 15/10/2026 também o `seo-do-site.py`: o JSON-LD
lido de volta com os campos que o Google pede, campo a mais ou valor mudado reprovado como "sem fonte"/"diverge da
fonte", nota só quando a página a mostra e nunca em advocacia, pergunta sem `data-fonte` recusada, Places dublado e
cache de 30 dias, robots/sitemap/llms, e o gerador levando os três arquivos ao palco; inclui o `main()` sem
login e, desde 14/10/2026, o demo sob pedido: a fila só com o pedido e o lead de fora do Brasil, o pedido gerado em
`_em-conversa/` com o recibo do Raio-X mesclado, uma tentativa por toque, o DESCARTAR ignorado), o `raio-x --testar`
(61; o avulso: recibo criado sem `site_url`, a página feita à mão continua no deploy, republicar com o demo no mesmo
endereço, deploy que falha tira a página da pasta, quem fica de fora dos novos), o `site-pastas.test.py` (o toque "Gerar
demo" grava o pedido sem mover a pasta), o `raio-x-ia.test.py` (32, roda no PC e no Dell; Raio-X de IA, fase 1, só
mede: a pergunta tirada da busca do Raio-X, termo vago fora, os nomes da linha `NOMES:` ou do negrito, o lead casado pelo
núcleo do nome sem cidade nem ofício e nunca pela palavra genérica, estabilidade entre execuções, o JSON do `codex
--json` e do Gemini com grounding, o resumo; HOME temporário, nada chama a rede), o `site-antes-da-venda.py --testar` (35; o Balcão com o recibo só do Raio-X:
só a C, EUA fica de fora, o enviado não é regravado toda hora, o demo pedido depois não troca a primeira mensagem; e,
desde 14/10/2026, a alocação balanceada: 30 leads divididos com diferença ≤ 1, dois nichos independentes, mesma saída
em qualquer ordem, congelamento, novo sorteio quando o conjunto muda, a própria letra fora da contagem, só letra válida
conta, sem demo só a C (conjunto "C") ou nenhuma mensagem, EUA, nicho vazio e grafia do nicho, dois leads da mesma
rodada e um pronto que não muda de rodada para rodada; importa o `n8n.py`, que lê a chave em `~/.config/claude-ops`:
fora do Dell, rode com `HOME`/`USERPROFILE` apontando para uma pasta temporária com uma chave falsa),
`deploy/dell/claude-ops/site-acompanhamento.test.py` (23; `__main__` ponta a
ponta com dublês; desde 17/10/2026, OT-01: o "Montar avisos" do 05 no node só avisa os expirados e o `followup_em`
continua gravado), `deploy/dell/funil-aprendizado.test.py` (72; modo 660 sob umask
022 e dado pessoal ainda recusado com a lib), `deploy/dell/whatsapp-observador/observador.test.py`
(89; nada sobe o serviço nem lê o `bridge.log` real nem o `plus/leads.json` real; desde 17/10/2026 o áudio de lead
com Evolution e Gemini dublês (urlopen trocado, nenhuma rede): transcrição na conversa e no lote, teto de 20 por dia de
São Paulo em JSON 600 (contador ilegível não gasta), cada falha grava só "[áudio Ns]" com o motivo e sem texto nem chave
no journal, a linha "[áudio]" da outra instância é trocada pela transcrita (nunca o contrário), `papel` pela marca no
texto e o `contexto` do lote; `OBSERVADOR_TRANSCREVER=0` antes do import; desde 17/10/2026, OT-13, os leads do
Plus entram no filtro da bridge e na conversa em disco e nada deles vai ao n8n, quem está no Plus e numa planilha segue
igual, arquivo ilegível é vazio e a releitura vale com o n8n fora; desde 16/10/2026 a conversa do lead em disco: entrada e saída com
id e hora UTC, o mesmo id não entra duas vezes nem pelo outro observador, quem não é lead não tem arquivo, recibo não é
linha, texto em 2000, nome saneado, poda de 120 dias uma vez por dia, falha ao gravar não derruba a classificação, e
a pasta padrão aponta para um temporário antes do import),
`deploy/dell/whatsapp-observador/evolution-adaptador.test.py` (90; webhooks de mentira, pasta temporária e HTTP no
loopback em porta efêmera; o último grupo faz o `observador.py` de verdade ler o que o adaptador escreveu, com o n8n
de mentira, inclusive a conversa do lead nas duas direções; desde 17/10/2026 o áudio de lead leva "[áudio Ns]" e só os
campos do download, sem miniatura nem bytes, até 120 s, e chega transcrito ao n8n com um transcritor dublê, e o "sim"
chega com a pergunta do Rômulo no `contexto`) e
`deploy/hermes/scripts/patch_bridge_envios.test.py` (20; desde 16/10/2026 roda no node o bloco `squadone:envios`: o
texto do que o dono escreve só a lead vai para `enviadas.jsonl`, o log ganha o id e nunca o texto). Os de
`src/` cobrem módulos sem Vue, não componentes: nada monta o Vue nem toca o
Google, e o texto depende de locale/fuso passados por parâmetro para não variar
com a máquina. `auth-escopos`, `squad` e `agenda-no-dell` gravam num diretório
temporário (chdir/env antes do import) e nunca em `data/`; `avisos` e
`telegram-polling` gravam a fila e o offset em temporário; `fetch` é dublê em todos. A verificação
continua sendo typecheck + build + exercitar a rota.
