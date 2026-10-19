# Testes: o que cada arquivo cobre

## Permissões: validar no Linux

`lead-quente-sombra.test.ts` e `roster-historico.test.ts` têm uma verificação
POSIX cada, pulada exclusivamente no Windows, que não representa os modos de
grupo/outros. Não remover essa condição nem simular o resultado no Windows.
Antes de concluir a validação, executar `npm test` na Dell ou em outro Linux:
esses dois testes precisam executar, sem pulo. Em 18/10/2026, a suíte da `main`
executou 3.147 testes no Linux com zero falhas e zero pulos.

Os mesmos casos cobrem criação e reutilização de pasta/arquivo. O teste do lead
quente abre um JSONL em `644` numa pasta `755`, grava outra decisão e exige
arquivo `600` e pasta `700`, preservando as duas decisões. O histórico restringe
uma pasta existente em `755` para `700` antes de guardar a próxima cópia `600`.
Os modos passados só à criação não corrigiam esses casos, reproduzidos antes da
correção. O `atualizar-central` executa os 53 testes desses dois arquivos na Dell
antes do build e reinício; uma falha interrompe a atualização.

## Inventário

> Movido do `CLAUDE.md` em 11/10/2026 para a sessão não carregar isto toda vez.
> O texto é o original, sem alteração; o `CLAUDE.md` guarda só o resumo das regras.

Os testes são pontuais — só as regras puras que dá para fixar em tabela de casos
(hoje `server/baixa-prioridade.test.ts`,
`server/lembretes.test.ts`, `server/vigia.test.ts` (inclui, desde 17/10/2026, a cola do resumo matinal: um por dia,
retentativa, leitura incompleta não vira "dia livre"; desde 19/10/2026: a chave fixa do "Google desconectado" que a vigia esquece quando o Google volta, cada leitura com `AbortSignal` de prazo e repassado ao `fetch`, calendário que falha marca a varredura como incompleta, `ultimaVarreduraOkEm` e `ocupada` e o reinício da Central sem lembrete nem aviso repetido), `server/resumo-matinal.test.ts` (janela 07:30–11:00, agrupamento,
foco somado, nenhum R$, corte em 30 linhas), `server/auth-store.test.ts`,
`server/passos.test.ts`, `server/tasks.test.ts`, `server/passos-no-google.test.ts`,
`server/auth-escopos.test.ts`, `server/squad.test.ts`, `server/calendar.test.ts`,
`server/prompt-passos.test.ts`, `server/telegram.test.ts`,
`server/telegram-entrada.test.ts`, `server/telegram-resposta.test.ts`,
`server/telegram-bot.test.ts`, `server/avaliacoes-turno.test.ts`,
`server/operations.test.ts` (inclui a config das ferramentas com e sem o Syncthing
opcional e o `/overview` num servidor de saúde dublê em loopback), `server/auto-production.test.ts` (desde 15/10/2026,
os achados do Raio-X no recibo: só ids conhecidos e números com sentido),
`server/dell-status.test.ts`,
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
ou nenhuma mensagem, EUA, só A e nicho vazio; desde 19/10/2026, A, B e C passam no gate de envio do primeiro contato; os casos completos estão no `site-antes-da-venda.py --testar`),
`server/prumo-mensagem.test.ts` (o reenvio do só-robô do PRUMO: nome como o dono escreve, artigo, só número 55),
`server/plus.test.ts` (filtro Plus: leitura do PDF em colunas, telefone, oferta e dedupe, mensagem maçônica com o artigo certo, funil só pelos registros, Hoje limitada, `lerPlus` e gravação em diretório temporário), `server/acesso.test.ts`,
`server/avisos.test.ts` (desde 16/10/2026 também o aviso pessoal pelo Telegram, OT-14: não grava na fila, sem som das 22h às 7h,
fila de reserva com o bot fora, P0 nos dois canais, R$ recusado antes de sair, a variável só desliga com `false`; desde 19/10/2026 o `RegistroDeEnviados` em disco: a chave sai uma vez em 24 h mesmo depois de "reiniciar" (outra instância sobre o mesmo arquivo), a gravação seguinte poda o velho, `esquecer`, arquivo torto recomeça vazio, gravação que falha não lança, aviso que não saiu não é marcado, a fila de reserva também marca, e `avisoDeCartao` saiu junto com o cartão de decisão),
`server/telegram-polling.test.ts` (offset, 409, e quando declarar queda, 17/10/2026, AC-07: tabela de `declararQueda`/`tipoDaFalha`;
soluço de uma tentativa não loga "inacessível" nem "voltou", e a queda real loga os dois, com backoff),
`server/uso.test.ts` (17/10/2026, AC-28, o contador de uso: a tela normalizada (`lead=` vira "(ficha)", finanças só pelo caminho,
query e telefone fora, "(outra)"), a chave da escrita (ids e telefones viram `:id`, GET e o próprio beacon não contam), o corpo do
beacon, a virada do dia em São Paulo, o teto de chaves, a poda de 90 dias e a gravação com debounce em diretório temporário),
`server/sinal-de-vida.test.ts` (o WhatsApp fora há mais de 15 min e, desde 19/10/2026, `vigiaParada`: 5 min sem varredura completa vira /fail, a carência do boot, e sem a vigia no processo ela nunca é falha), `server/agenda-no-dell.test.ts`,
`server/tempo.test.ts` (19/10/2026, o relógio de São Paulo de `server/tempo.ts`: `diaDeSP` vira às 03:00 UTC, `horaDeSP`, `ehMadrugada` de 22h a 7h atravessando a meia-noite),
`server/roster-historico.test.ts`,
`server/time.test.ts` (o time vivo agrupado por squad e o leitor com cache),
`server/luna-sombra.test.ts` (a saída da Luna como dado, a comparação com o
Gemini, as flags do `codex exec --help`, e a cola — teto do dia, fila serial,
cota, JSONL — com o `codex` dublado num diretório temporário; desde 19/10/2026, demanda que parece finanças nem chega ao `codex` nem gasta o teto),
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
`operations` e com o codex que não confere; o caminho do Raio-X sem `..`; desde 19/10/2026 o automático: a falha vale só no dia, a cota esgotada pausa o laço por 10 min sem carimbar o lead, o teto do dia nem tenta, e a volta de 1 min não relê o Raio-X nem a conversa de quem não mudou),
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
`src/operations-resultados.test.ts` (o placar do CRM: só enviados no período, robô não é resposta, recusa só entre enviados;
sem letra, a linha da mensagem pelo regime; follow-up anotado e quem respondeu depois, com amostra pequena; desde 17/10/2026,
AC-03, uma regra por métrica: `leu`/`respondeuDeGente`/`quisVer` em tabela (robô, `respondeu_em` sem classificação, classificação sem a
coluna, Plus), o funil e o placar dão o mesmo número na mesma janela de 30 dias, e a taxa do expediente é a mesma com ou sem o filtro do Site;
desde a revisão de 17/10/2026, a licença conta igual ao interesse em "quiseram ver", na 2ª anotada e nos degraus do diagnóstico),
os do Assistente da Central (17/10/2026, RULES 28): `server/assistente.test.ts` (finanças sem modelo e sem o texto no JSONL,
máscara no prompt e no arquivo, cartão proposto sem escrita, teto da tentativa e das respostas por regra, corrida de dois POSTs, o
Hermes que falha ou responde e que NUNCA volta ao Gemini no histórico (também depois de reiniciar), releitura, poda por data de linha,
prazo de 4 min (desde 19/10/2026 o prazo aborta a geração em voo e a fila só libera a próxima quando a anterior parou), rotas com Express real e guarda de origem, imports sem escrita; desde a fase 2, 17/10/2026, a leitura do copiloto:
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
por caso; `anotacoesAMao`, 2ª mensagem e follow-up no passo ou com falha; desde 17/10/2026, a licença e o "Você já respondeu"
na tabela do `fraseDaAcao`),
`src/operations-cohort.test.ts` (17/10/2026, `cohort.ts`, filtro por motivo da Triagem: E / E NÃO sobre sinais, sem leitura que não bate nem desqualifica, critérios dos campos do lead, cohort vazio, texto de `descreverCohort` e `motivosDoLead`, opções que só aparecem quando dividem o grupo, edição, leitura e gravação no storage com lixo e storage que lança),
`src/operations-leitura-de-sinais.test.ts` (17/10/2026: `podeLerSinais` e `alvosDoLote` (só o lote, na ordem, sem repetir, sem quem já foi tentado), `desfechoDaResposta` (409, 422 e 503; estado e origem), `lerEmSerie` (pausa só entre leituras que foram ao site, a falha de um não derruba os outros, parar interrompe, 503 para) e `textoDoResumo`),
`src/operations-copiloto.test.ts` ganhou o bloco "sinais do site no dossiê" (com e sem sinais: hash, JSON e prompt idênticos sem fonte; `null` some; agência com e sem nome limpo de telefone e marcação; cautela de anúncio instalado; ordem de peso; `serveParaAbrir`; regras no prompt só com sinais) e `server/copiloto.test.ts` +2 (prompt com a observação e a cautela, hash novo só com sinal, gate ainda barra),
`server/gate-de-envio.test.ts` (17/10/2026; fonte única desde 19/10/2026, a cópia em JS do Balcão saiu: tabela por código de problema, modos bloquear/avisar e o gate sobre TODOS os textos atuais (VARIACOES do JS do n8n via vm, site-mensagem, prumo-mensagem, plus-mensagem, colinha inteira, rascunho de proposta) exigindo zero problema; também há casos do gate em `copiloto.test.ts`, `vendedor.test.ts` e `jornadas-de-venda.test.ts`),
`server/sinais-do-site.test.ts` (17/10/2026: extração em tabela com HTML sintético em português: anúncios, agendamento, schema, agência com confiança e rótulo fraco não registrado, blog pelo sitemap, tri-estado e página-casca; `ehSiteProprio`/`siteProprioDoLead`, ajuste da Prioridade, linhas da Ficha, validação do que vem do disco),
`server/sinais-do-site-leitor.test.ts` (17/10/2026: `ipEhPublico` e SSRF (loopback, 10.x, 169.254.x, tailnet, IPv6, v4 embutido, `.ts.net`, porta, usuário na URL, redirecionamento para rede privada sem fazer a requisição), orçamento de 3 requisições, laço de redirecionamento, ISO-8859-1, cache em pasta temporária (validade, `forcar`, single-flight, arquivo ilegível) e o buscador real contra `localhost`; mais o bloco "CRM: sinais do site" em `crm.test.ts`),
`src/operations-triagem.test.ts` (17/10/2026, AC-10, `triagem.ts`: o lote nasce com os 10 primeiros na ordem do servidor; dispensar tira o
item na hora sem puxar o 11º; o convidado fica à vista sem contar como pendente; decidido o lote, vêm os 10 seguintes; dispensado no retrato
(`perdaManual`) fica fora; poda da marca local (dispensado confirmado, convidado fora da Revisar, lead sumido, vencida); storage quebrado;
o corpo do registro; a pontuação só quando diferencia; o motivo curto do Convidar desligado),
`src/operations-proxima-venda.test.ts` (17/10/2026, AC-02: a contagem da fila do dia (`resumoDoDia`: total igual à soma da quebra por tipo,
primeiros contatos prontos e quantos o ritmo ainda deixa hoje, 0 na pausa), `textoDosPrimeiros`, `filaDaTela` (um primeiro contato por vez,
só no expediente e com ritmo livre; "Enviei" sai, "Pular" vai para o fim) e as resolvidas do dia no storage (outro dia e storage ilegível = vazio)),
`src/operations-trava-de-horario.test.ts` (a trava do envio fora do expediente: só com aviso, liberação por lead sem mutar o conjunto, 19h e domingo travam, 10h não;
o que trava em tabela: envio, convite e o reenvio do só-robô, nunca o follow-up de sempre nem a 2ª mensagem; o rótulo "Pedir o responsável";
desde 16/10/2026, OT-02: a janela única seg–sex 8h–17h30 em tabela (17h45 e sábado agora travam), a Próxima venda usa a mesma função,
"pode mandar" = expediente ou liberado e sempre com o ritmo livre, e o trecho do Roteiro sem WhatsApp antes do primeiro contato),
`src/operations-velocidade.test.ts` (16/10/2026, OT-09: do "quero ver" ao link pela 2ª anotada ou pelo link visto na conversa, link antes do
interesse não conta, do link à proposta, perdido não espera e fora dos 30 dias não entra, mediana e duração legível; desde a revisão de
17/10/2026, a licença também começa a espera pelo link),
`src/operations-financas-importar.test.ts` (16/10/2026, OT-11: o "Importar" único de Finanças manda PDF à fatura e OFX/CSV/.txt ao extrato pela
extensão, MIME só sem extensão, .xlsx/.jpg recusados na tela; o Usar do Mais saiu em 17/10/2026 com a Central de comando),
`src/operations-trava-de-ritmo.test.ts` (a trava de ritmo de 15/10/2026: o caso real de 25 envios em 25 min vira intervalo de 5 min, 12 por hora e
100 no dia (decisão de 19/10/2026; antes 4 min, 8/h e a rampa 10/20/30); teto por semana desde o início do número; dia de São Paulo; pausa antes de tudo; de onde vêm os instantes: enviado do retrato, o reenvio do
só-robô, o toque desta tela sem contar duas vezes; storage de 24 h que lança),
`src/operations-recado-de-travas.test.ts` (17/10/2026, hierarquia de Vendas, `recado-de-travas.ts`: quando o expediente volta (hoje, amanhã,
sexta à noite e o fim de semana caem em "segunda às 8h", hora quebrada "8h30"); um recado por estado com o quando: pode enviar, fora do
expediente com o Liberar e a taxa, liberado, "Libera às 14:20 (ritmo)", teto do dia que volta na segunda, pausa com a data; o ritmo antes do
horário, sem Liberar; `pode` sempre igual a `podeMandarPrimeiroContato` em tabela; o rótulo do Liberar por tela; desde a revisão de
17/10/2026, `liberadoNaFila`: o "liberado" só com um primeiro contato liberado de fato na fila, nunca com todos pulados, feitos ou filtrados),
`src/operations-vendas-abas.test.ts` (17/10/2026, hierarquia de Vendas, `vendas-abas.ts`: três abas Fazer → Triar → Entender, as seções Funil,
Números e Resultados; os links de antes continuam: ?ver=funil|numeros|resultados|triagem, ?ver=jornada no Funil com ?passo=, ?ver=roteiro e
?ver=colinha para o Roteiro no Mais, ?lead= e ?produto= em qualquer vista; o endereço escrito de volta e a ida e volta; desde 19/10/2026 `NOME_DAS_ABAS` é o mapa único dos nomes (a barra e as seções leem dele e o caminho diz "Vendas › nome")),
`src/operations-funil-lista.test.ts` (a Lista do Funil no desktop, 16/10/2026: o sinal mais forte por ordem (Resposta nova > Follow-up hoje >
Perdido amanhã > Divergência > o resto), follow-up anotado deixa de ser "hoje", ordenar por último toque e próximo passo com quem não tem data no fim
nos dois sentidos, as etapas abertas, e a vista guardada com storage que lança; desde 17/10/2026, AC-03, `contagemDaEtapa`: Quadro e Lista
contam igual para a mesma escolha de "Mostrar descartados", e o que fica de fora vira "+N descartados antes do contato"; AC-19:
a coluna Próximo passo pela `acaoDoLead`, `opcoesDeNicho` (uma opção por grafia do nicho), o filtro Passo e o rótulo curto único da oferta),
`src/operations-ab-video.test.ts` (A/B do vídeo: hash estável em tabela e ~50/50 em 1000 ids, Fisher exato contra o R, veredito com +20 pontos e p < 0,10, amostra insuficiente, leitura só depois dos 7 dias, quem entra no teste, braço trocado),
`src/operations-ab-mensagem.test.ts` (A/B estratificado da 1ª mensagem, 14/10/2026: sem `ab_elegiveis` o bloco fica vazio e o histórico é contado como fora; 29 × 31 só "faltam", sem taxa nem respostas; 30 × 30 com taxa, Fisher e veredito; +20 pontos e p < 0,10 nos dois sentidos; robô não conta; só entre quem podia receber as duas letras; estrato por nicho; texto trocado recomeça a contagem pelo `TEXTO_DESDE`, 19/10/2026),
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
`server/conversa-baoba.test.ts` (17/10/2026, o caso Baobá de ponta a ponta pelo `montarCrm` e pela fila: o papel gravado ou
lido do texto na leitura do JSONL; o resumo sem o robô na última de gente e com o vídeo como link; antes do vídeo, a licença
pede "o que ele autorizou" sem "disse sim" e o cartão diz "Respondeu ontem" pela última mensagem; com a última mensagem
nossa, "Você já respondeu"; depois do vídeo, só o "o que achou?" no dia seguinte e nada logo depois; o prazo de Perdido não
recomeça com o robô e recomeça com a recepção),
`src/operations-marcadores-da-conversa.test.ts` (17/10/2026, tabelas PURAS de `marcadores-da-conversa.ts`: `papelDaMensagem`
(campo gravado, assinatura de atendente, menu de atendimento; desde a revisão de 17/10/2026 também a tabela ÚNICA
`deploy/dell/whatsapp-observador/papel-da-mensagem.casos.json`, a mesma do `observador.test.py`), `pedeMaterial`, áudio com e
sem transcrição e o marcador antigo na tela e para o modelo, `levouMaterial`; `quemRespondeu`/`respondeuDeGente`/`quisVer` com
robô, recepção (interesse dela conta, neutra não) e licença (conta como "quero ver"); a linha da conversa com
áudio e papel; a licença anotável como 2ª mensagem; o dossiê do copiloto com o áudio desconhecido e o papel),
`server/jornadas-de-venda.test.ts` (16/10/2026, a simulação das jornadas: um lead do Site passa pelo retrato de verdade
(`montarCrm`) do pronto ao "quero ver", e a fila de venda (`proxima-venda.ts`) diz o que fazer em cada passo: primeira
mensagem com o texto do Balcão e só com a trava de ritmo livre; nada para quem não leu; follow-up de quem leu; o "quero ver"
quente com o link do demo; depois da 2ª anotada, ele sai das respostas (achado da simulação, corrigido em `server/crm.ts`);
o "o que achou?" de 20 h a 72 h depois do link; a proposta sem reenviar o preço; o reenvio do só-robô como primeiro contato;
fora do expediente só o lead liberado entra na fila, e nunca com o ritmo travado (OT-02); o histórico do vendedor: "expirou" e "saiu" de
um aviso que fecha sem toque, o resumo dos 30 dias com os "quero ver" à parte e a leitura que pula linha cortada (OT-09);
quem disse não vira "marcar a recusa" no lugar de responder, a exclusão sem mensagem, e o registro recusou encerra e o desfeito volta (OT-06);
o braço do teste do recibo e a regra antiga para quem foi enviado antes ou leu (OT-10); a regra única do follow-up do 3º dia em tabela (OT-15);
desde a revisão de 17/10/2026, a licença nova (1 h) fura o aviso aberto de outro lead que segue na fila, quente como o "quero ver").
`server/venda-do-dia.test.ts` (16/10/2026, OT-01 e OT-10: a memória do "Enviei"/"Pular" zera no dia novo, descarta lixo, a última decisão vale,
grava e relê em diretório temporário; a leitura do teste do recibo por braço, com a exclusão à parte e o p só com o mínimo dos dois lados;
desde 17/10/2026, AC-06: como e por onde cada ação se resolveu (central, telegram, expirou), a anotação uma vez por ação + tipo no dia, os
primeiros contatos das duas superfícies e a leitura do formato de 16/10; AC-21: os liberados do dia (dia novo zera, o formato sem a
chave ainda lê, liberar duas vezes é uma),
`server/lead-quente.test.ts` (17/10/2026, o agente do lead quente em SOMBRA, regras puras em tabela: a mensagem pendente e a chave
(a mesma do vendedor), o gate de `responder`, cada `calar` (antes do link, Rômulo assumiu há 1 h e há 7 h, recusa, robô, neutra, etapa), cada
motivo de `escalar` (preço, proposta, fechar, ligação, objeção, áudio, irritação, recusa, recepção, licença, mensagem longa, valor na
resposta pronta, aviso do copiloto), esperar a sugestão por 5 min, o teto de toques e os follow-ups, o aviso sem valor nem a mensagem do lead,
o resumo (falso positivo de `interesse`, mediana da resposta humana) e a varredura do código-fonte atrás de qualquer envio ao WhatsApp; desde 19/10/2026 `podeTocar(toques, mensagens)` só conhece a resposta: duas respostas depois da última saída do Rômulo fecham, uma deixa, e os follow-ups da fase de envio saíram do módulo),
`server/lead-quente-sombra.test.ts` (a cola com CRM, conversa, copiloto e Telegram dublês num diretório temporário: flag desligada não deixa
rastro, só no operations com bot e copiloto, uma decisão por mensagem mesmo reiniciando, teto do dia que sobrevive a reinício, Telegram fora do
ar, aviso sem som de madrugada, voto 👍/👎, resposta humana conferida uma vez, JSONL sem telefone nem a mensagem do lead, 600/700; desde 19/10/2026 a gravação que falha depois do aviso não o reenvia e, em 3 falhas seguidas, o laço para com erro no log, e o leitor mantém os registros em memória: lê o arquivo uma vez, acrescenta o que grava e só relê quando o tamanho ou o mtime muda por fora),
`server/telegram-entrada.test.ts` (também o callback `q:<token>:c|d` do voto da sombra),
`server/frente-comercial.test.ts` (19/10/2026, o time comercial na Central, com a memória do dia num diretório temporário: a reserva
devolve o texto do Balcão e grava o primeiro `por: "time"`; o intervalo de 5 min vale entre o time e a Central nos dois sentidos; lead
tocado pela Central é recusado ao time; dois pedidos juntos, só um passa; Triagem, fora da fila, time pausado, gate e fora do expediente
recusam; só da mesma origem; o estado não vaza número nem chave; desde 19/10/2026 `ativo` com o ciclo parado: sem rodada há mais de 5 min dentro do expediente o estado diz `cicloParado`, com `ultimaRodadaEm`),
`src/operations-primeiro-contato.test.ts` (19/10/2026: quem faz o 1º contato, só Site `pronto` é elegível, a janela e o ritmo da Central
contando retrato e todas as superfícies, e a Próxima venda e o vendedor do Telegram pulando os leads do time),
`deploy/dell/frente-comercial.test.py` (Python, roda no Dell: sem ritmo próprio, a reserva recusada não envia, o clique rastreado antes
do envio e conferido pelo redirecionamento, clique que falha não envia e libera o número, lead tocado pelo Rômulo não é pedido, plano
antigo com `revisar` não vira fila, a fila parcial não substitui a anterior),
`server/vendedor.test.ts` (17/10/2026, AC-06: o aviso aberto resolvido na Central fecha na volta seguinte sem botões, o "Enviei" atrasado
responde "Já estava feito." sem anotar de novo, o aviso expirado vira pulado também para a Central, e a trava de ritmo soma retrato,
servidor e reforço local contando cada lead uma vez; desde 19/10/2026 o dia do servidor é a única fonte dos primeiros contatos e o vendedor não os guarda mais; o teto de avisos do dia, a gravação que falha sem reenviar e a volta pulada com o dia ilegível ainda NÃO têm teste próprio).
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
`src/office/vista.test.ts` (Lista|Mapa e escala inteira; desde 17/10/2026 a vista da Central, mapa por padrão e guardada à parte),
`src/office/salaFinancas.test.ts`,
`src/office/baloes.test.ts` (17/10/2026, Central de comando: o texto do balão por fonte, robô que falhou > pede olhar > leads com
você > parados > contagem, "Sem sinal" sem Vendas ou sem retrato, finanças só em % e semáforo, a agenda em bloco antes do próximo,
a sala que o PO raiz visita só por problema em destaque e o balão que ele leva, o corte em uma linha),
`src/casca/central.test.ts` (17/10/2026: as cinco faixas na ordem, "Sem sinal" com o motivo em cada uma e nada afirmado lendo, o passo
e a oferta de Vendas com o gargalo, o semáforo e as % das finanças (sem R$), a agenda, o selo da Entrada, a saúde do Dell sem repetir o número
do cabeçalho, o andar do mapa, o `?abrir=` e o status do mapa; desde a revisão de 17/10/2026, `depoisDaTrocaDeAndar`: troca de
squad recusada fica na Central e avisa, nunca abre o Escritório na squad errada),
`src/casca/casca.test.ts` (rotas por perfil; desde 17/10/2026 os três menus do Dell, Central de comando e Vendas, com a Manutenção
discreta, o Easypanel igual, `aria-current` das rotas que viraram faixa; Ctrl+K com o Assistente e os saltos para a Central; a ordem
dos cartões com o semáforo das finanças, estado do time só com fonte, com e sem `/api/time`, linha do funil; o `/design-system`),
`src/casca/paleta.test.ts` (17/10/2026, o Ctrl+K, AC-23: as abas de Vendas, os saltos para as faixas da Central (`/?abrir=`) e a
Manutenção só no `operations`, com a dica em palavras; leads por prefixo de palavra sem acento nem caixa, no máximo 8, nada no perfil
`app`, o id só no destino; e quando a mesma tela precisa de `popstate` (`/crm`) ou de remontar (Mais e Central)),
`src/casca/mais.test.ts` (17/10/2026: qual seção o endereço do Mais abre, `?abrir=manutencao|roteiro` e `?fluxo=`; as Ferramentas
sem Syncthing, CRM nem Agentes, e a reserva fria neutra) e
`src/casca/tema.test.ts` (17/10/2026: o tema claro/escuro; sem escolha guardada é claro, valor inválido ou storage
que lança caem no claro, automático tira o `data-theme`; e o `<script>` do `index.html`, rodado num `vm`, dá o mesmo
atributo que `tema.ts` para cada valor guardado),
`src/blueprint/blueprint.test.ts` (16/10/2026: lê o `tokens.css` real; contraste WCAG; desde 17/10/2026 cada par de
`PARES_DE_CONTRASTE` é CALCULADO nos dois temas a partir do `tokens.css` (var() resolvido em cadeia), com o
`--negativo` sobre o `--erro-fundo`, e os dois blocos escuros (media query e `data-theme`) têm de ser iguais; o pedido de mudança;
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
`python3 deploy/dell/dell-status.test.py` (177 por `def test_`, só na Mel por causa do `fcntl`; desde 19/10/2026 também os prazos (`com_prazo`, `executar_verificacoes` com o teto de 100 s, o `status.json` gravado antes dos avisos), os checks `central`, `telegram`, `central-atualizada` e `units-falhas`, a segunda rodada em falha dos serviços HTTP, as marcas de pausa de daemons, `.path` e containers, o `socorro` só pedido quando há remédio ou leitura, as origens que saem pelo Telegram (`n8n:*`, backup, atualizar-central, silmer) e a chave por fluxo no aviso do 00; desde 16/10/2026 as falhas pelo
Telegram, OT-14: config do `operations.env` temporário com o ambiente por cima, sem bot/grupo/token ruim/`false` = nada,
`disable_notification` das 22h às 7h, log sem o token, corte em 4096, o "Quebrou" e o socorro da fila pelo bot e pelo
WhatsApp quando o bot falha, com silêncio e teto; a Bot API é dublê e o `operations.env` de verdade nunca é lido; também a verificação
"WhatsApp do PRUMO (Evolution)": tabela de casos da função pura, a verificação some sem o compose, `/saude` com o
segredo só no cabeçalho e nenhum segredo, chave ou telefone no resultado; Docker, systemd e rede são dublês; e o pedido
ao socorro: só falha nova grava, desligado ou não instalado não grava e o "Quebrou" fica igual), o socorro,
`python3 deploy/dell/socorro.test.py` (34, roda no PC e no Dell, 16/10/2026: o aviso gravado pela lib e drenado pelo
dell-status vai pelo Telegram, sem som de noite, e cai no WhatsApp com o bot fora (só no Dell, que importa o dell-status); a lista branca por verificação e detalhe,
todo remédio é restart/start e nada mais, a leitura só lê, os tetos de 2 remédios e 1 Hermes por verificação a cada
6 h e 6 Hermes por dia, a chave de desligar, remédio do Hermes fora da lista nunca roda, telefone e token mascarados
no prompt e no aviso, e o atendimento inteiro com systemctl, docker, reconferência e Hermes dublês); a lib da fila de avisos,
`python3 deploy/dell/lib/aviso.test.py` (formato igual ao do dell-status, cortes,
recusas, R$, gravação atômica, nunca levanta) e o primeiro script que a usa,
`python3 deploy/dell/auto-entrada.test.py`, `python3 deploy/dell/site-pastas.test.py` e
`python3 deploy/dell/site-demos-limpeza.test.py`
(aviso aceito pelo dell-status, a fila ausente sem derrubar a rodada; desde 19/10/2026 sem o
"jeito antigo": sem a lib o aviso não é gravado e vai ao stderr; na limpeza também o texto do aviso do
acervo inteiro dentro de 4000 caracteres e o estado "avisado" só quando o aviso ficou na fila; o
`site-demos-pausa` e o teste dele saíram em 19/10/2026). Os demais scripts trocados para a lib (12/10/2026) têm os
seus, todos rodados à mão no Dell: `deploy/dell/prumo-mapa/prumo_mapa.test.py`
(17; "R$" recusado com linha no journal, `[teste]` preservado, pacote ruim não
derruba os outros), `deploy/dell/backup/backup-dell.test.py` (42, só no Dell por
causa do `fcntl`; o código de saída do ensaio não muda com fila ausente, estragada ou
lib que levanta), `deploy/dell/gerador-de-sites.test.py` (106; desde 15/10/2026 também o `seo-do-site.py`: o JSON-LD
lido de volta com os campos que o Google pede, campo a mais ou valor mudado reprovado como "sem fonte"/"diverge da
fonte", nota só quando a página a mostra e nunca em advocacia, pergunta sem `data-fonte` recusada, Places dublado e
cache de 30 dias, robots/sitemap/llms, e o gerador levando os três arquivos ao palco; inclui o `main()` sem
login e, desde 14/10/2026, o demo sob pedido: a fila só com o pedido e o lead de fora do Brasil, o pedido gerado em
`_em-conversa/` com o recibo do Raio-X mesclado, uma tentativa por toque, o DESCARTAR ignorado), o `raio-x --testar`
(65; o avulso: recibo criado sem `site_url`, a página feita à mão continua no deploy, republicar com o demo no mesmo
endereço, deploy que falha tira a página da pasta, quem fica de fora dos novos), o `site-pastas.test.py` (o toque "Gerar
demo" grava o pedido sem mover a pasta), o `raio-x-ia.test.py` (32, roda no PC e no Dell; Raio-X de IA, fase 1, só
mede: a pergunta tirada da busca do Raio-X, termo vago fora, os nomes da linha `NOMES:` ou do negrito, o lead casado pelo
núcleo do nome sem cidade nem ofício e nunca pela palavra genérica, estabilidade entre execuções, o JSON do `codex
--json` e do Gemini com grounding, o resumo; HOME temporário, nada chama a rede), o `site-antes-da-venda.py --testar` (43; desde 19/10/2026 sem a classe do gate: o Balcão não o escreve mais, `test_o_balcao_nao_escreve_mais_o_gate`, e a pasta do lead, o "sem recibo" e a URL da tailnet no `balcao-cruzar.js`; o Balcão com o recibo só do Raio-X:
só a C, EUA fica de fora, o enviado não é regravado toda hora, o demo pedido depois não troca a primeira mensagem; e,
desde 14/10/2026, a alocação balanceada: 30 leads divididos com diferença ≤ 1, dois nichos independentes, mesma saída
em qualquer ordem, congelamento, novo sorteio quando o conjunto muda, a própria letra fora da contagem, só letra válida
conta, sem demo só a C (conjunto "C") ou nenhuma mensagem, EUA, nicho vazio e grafia do nicho, dois leads da mesma
rodada e um pronto que não muda de rodada para rodada; importa o `n8n.py`, que lê a chave em `~/.config/claude-ops`:
fora do Dell, rode com `HOME`/`USERPROFILE` apontando para uma pasta temporária com uma chave falsa),
`deploy/dell/claude-ops/site-acompanhamento.test.py` (24; `__main__` ponta a
ponta com dublês; desde 17/10/2026, OT-01: o "Montar avisos" do 05 no node só avisa os expirados e o `followup_em`
continua gravado), `deploy/dell/funil-aprendizado.test.py` (70; desde a revisão de 17/10/2026 a licença conta na coluna
"interesse" do funil por variante; modo 660 sob umask
022 e dado pessoal ainda recusado com a lib), `deploy/dell/whatsapp-observador/observador.test.py`
(101; nada sobe o serviço nem lê o `bridge.log` real nem o `plus/leads.json` real; desde 17/10/2026 o áudio de lead
com Evolution e Gemini dublês (urlopen trocado, nenhuma rede): transcrição na conversa e no lote, teto de 20 por dia de
São Paulo em JSON 600 (desde a revisão de 17/10/2026: JSON quebrado ou `usadas` que não é número recomeça a conta com
`contador_ilegivel`, conta que não grava não gasta com `contador_sem_gravar`, download que falha não consome cota), as duas
instâncias no mesmo n8n dão UM lote por áudio (transcrito, não transcrito, longo; a bridge com texto junto manda como antes),
uma queda no meio da transcrição não perde nem duplica (o `.lendo` só sai depois do lote, a transcrição já gravada não é
paga de novo) e parar o serviço com áudio pendente deixa o lote para o próximo início; a tabela de `papel` é a mesma
da Central (`papel-da-mensagem.casos.json`), cada falha grava só "[áudio Ns]" com o motivo e sem texto nem chave
no journal, a linha "[áudio]" da outra instância é trocada pela transcrita (nunca o contrário), `papel` pela marca no
texto e o `contexto` do lote; `OBSERVADOR_TRANSCREVER=0` antes do import; desde 17/10/2026, OT-13, os leads do
Plus entram no filtro da bridge e na conversa em disco e nada deles vai ao n8n, quem está no Plus e numa planilha segue
igual, arquivo ilegível é vazio e a releitura vale com o n8n fora; desde 16/10/2026 a conversa do lead em disco: entrada e saída com
id e hora UTC, o mesmo id não entra duas vezes nem pelo outro observador, quem não é lead não tem arquivo, recibo não é
linha, texto em 2000, nome saneado, poda de 120 dias uma vez por dia, falha ao gravar não derruba a classificação, e
a pasta padrão aponta para um temporário antes do import),
`deploy/dell/whatsapp-observador/evolution-adaptador.test.py` (92; webhooks de mentira, pasta temporária e HTTP no
loopback em porta efêmera; o último grupo faz o `observador.py` de verdade ler o que o adaptador escreveu, com o n8n
de mentira, inclusive a conversa do lead nas duas direções; desde 17/10/2026 o áudio de lead leva "[áudio Ns]" e só os
campos do download, sem miniatura nem bytes, até 120 s (o longo e o sem duração levam só a marca `audio: {seg}` / `{}`,
desde a revisão de 17/10/2026), e chega transcrito ao n8n com um transcritor dublê, e o "sim"
chega com a pergunta do Rômulo no `contexto`) e
`deploy/hermes/scripts/patch_bridge_envios.test.py` (18; desde 16/10/2026 roda no node o bloco `squadone:envios`: o
texto do que o dono escreve só a lead vai para `enviadas.jsonl`, o log ganha o id e nunca o texto). Os de
`src/` cobrem módulos sem Vue, não componentes: nada monta o Vue nem toca o
Google, e o texto depende de locale/fuso passados por parâmetro para não variar
com a máquina. `auth-escopos`, `squad` e `agenda-no-dell` gravam num diretório
temporário (chdir/env antes do import) e nunca em `data/`; `avisos` e
`telegram-polling` gravam a fila e o offset em temporário; `fetch` é dublê em todos. A verificação
continua sendo typecheck + build + exercitar a rota.

## Arquivos que faltavam no inventário (acrescentados em 19/10/2026)

Todos rodam no `npm test` (os `.ts`) ou à mão (os `.py` e `.mjs`, em `HOME` temporário quando mexem em pasta). As contagens de Python deste arquivo são por `def test_`, conferidas em 19/10/2026.

**Servidor (`server/`)**
- `crm-retrato-texto.test.ts`: o nó real de montagem do retrato (extraído do `crm.py`) preserva notas de 1000 caracteres e o JSON do aprendizado, e corta o resto nos limites de sempre.
- `decisoes-comerciais.test.ts`: a revisão humana da classificação da fonte (reabrir/manter) e o convite enviado à mão, gravados como nota na aba CRM: a revisão reabre sem apagar histórico, o convite usa destino direto e a hora real confirmada, e a confirmação valida o contexto e não repete.
- `protecao-comercial.test.ts`: conversa posterior à recusa exige revisão (nunca vira interesse sozinha), encerramento atual × resposta ou proposta posterior, silêncio de 7 dias pede conferência, robô não é conversa humana, pausa conserva o próximo passo e tira o contato da fila; é daqui que a limpeza da demo se protege.
- `revisao-resposta.test.ts`: `POST /crm/proximo-passo/ajustar` e `GET /crm/resposta/contexto`: falha de gravação bloqueia a repetição do mesmo contexto, o ajuste exige o contexto atual e grava uma vez, e a conferência lê só o lead exato.
- `importar-conversa.test.ts`: a exportação individual PT-BR do WhatsApp: o original recuperado substitui a transcrição aproximada do print, importar acrescenta sem substituir, deduplica exportações e eventos já observados e recusa telefone livre.
- `hermes-historico.test.ts`: a consulta ao histórico pela ponte do Hermes, na conexão existente (autentica, filtra leads, usa âncora real e só arquiva os retornos pedidos).
- `entrada-proxy.test.ts`: o repasse da Entrada pela Central (RULES 23): lista fechada de rotas, redirecionamento sem a barra final, envio em fluxo byte a byte, cabeçalhos que não seguem, query descartada, 404/405 sem chegar à Entrada.
- `prumo-nome-paridade.test.ts` (19/10/2026): `claude-ops/prumo-nome.js` (a regra do nome da empresa nos convites do n8n) e `nomeDaEmpresa` do CRM dão o mesmo resultado numa tabela, e os construtores embutem o arquivo em vez de guardar cópia.
- `tempo.test.ts` (19/10/2026): `server/tempo.ts`, descrito acima.

**Front (`src/office/` e `src/`)**: estes testes ficam em `src/office/`, mas cobrem módulos de `src/operations/` e `src/office/` da camada de conversa comercial ("Minhas decisões" e a sala de comando).
- `src/office/acompanhamento-observado.test.ts`, `retorno-da-venda.test.ts`, `andamento.test.ts` e `ajuste-do-passo.test.ts`: o que um evento observado prova (envio sim, conclusão de tarefa nunca), o retorno como a última anotação humana (data do fato × data do registro), as anotações de andamento e o ajuste do próximo passo (datas impossíveis recusadas).
- `src/office/missao.test.ts`, `rascunhos.test.ts`, `retomadas.test.ts` e `conversas-para-conduzir.test.ts`: a missão da conversa e seus marcos (resposta humana e material pronto não presumem envio nem venda; 2ª mensagem com preço conta como proposta), o rascunho por oferta e lead (antes da data só prepara), a retomada do dia em São Paulo, e a lista "Conversas para você" (lacuna de histórico não vira prioridade, espera combinada fica com o time, o follow-up do 3º dia aparece, o primeiro contato não, um lead por linha; "Enviei" tira o passo e "Pular" manda para o fim).
- `src/office/revisao-resposta.test.ts`: a revisão antes de abrir a mensagem ao cliente: o atalho chega ao modelo sem o bloqueio de finanças, o texto editado vai ao destino exato do `wa.me` sem link rastreado nem confirmação de envio, e destino externo, esquemas e texto incompleto são recusados.
- `src/office/comando.test.ts`, `movimento.test.ts` e `sprites.test.ts`: o controle por sala (Atendimento reúne as conversas das ofertas, Prospecção fica com o estoque), o movimento que segue o sistema com a escolha explícita à frente, e a identidade visual (nomes antigos do roster mantêm personagem e cor, o mapa não usa emoji de reserva).
- `src/operations-aprendizado-comercial.test.ts` e `src/operations-historico-comercial.test.ts`: o aprendizado comercial (fato, hipótese, teste e resultado separados, sobrevive à nota do CRM, anotação automática nunca vira aprendizado humano) e a cobertura honesta do histórico (ausência e arquivo parcial exigem revisão, revisão humana libera, evento posterior invalida).
- `src/operations-precos.test.ts` (19/10/2026): `PRECOS_DO_CARDAPIO` e todo "R$" do cardápio do Roteiro (`colinha.ts`) existem em `deploy/dell/prumo-mapa/precos.json`, a fonte única dos preços.

**Python e Node em `deploy/`**
- `deploy/dell/claude-ops/prumo-construtores.test.py` (11, 19/10/2026): o clique do convite sem "primeiro clique" nem "marcar como enviado", o fluxo com o nome antigo trocado pelo id sem duplicar, o `decidir` que só devolve o destino e usa a regra única do nome.
- `deploy/dell/claude-ops/workflow_confiabilidade.test.py` (16): confirmação só depois de todas as gravações, checkpoint só depois do subfluxo, abrir o convite nunca marca envio, GET não escreve e POST exige origem e contexto, e o diagnóstico do dono lido do fixture `claude-ops/testes/prumo-diagnostico.fixture.json`.
- `deploy/dell/claude-ops/fonte_luna.test.py` (4) e `luna_workflows.test.py` (3): a Fonte e a classificação do Caçador pela Luna: fichas restritas fora do prompt, referência fora do perfil falha fechado, modelo, comando e ferramenta vindos do cliente recusados, sessão limpa, classificação incompleta falha fechada.
- `deploy/dell/backup/estrutura-coletar.test.py` (34): o filtro de segredos da coleta da Estrutura (casos positivos e negativos), a prova contra vazamento e a montagem da área de preparo.
- `deploy/dell/entrada/` (a Entrada da Mel): `entrada.test.py` (52, recebimento, bloqueio, cofre, fila), `segredos.test.py` (91, o filtro de segredos, todos falsos), `cofre.test.py` (16) e `cofre_cli.test.py` (9) (usam o `age` de verdade; sem ele, pulam), `executor.test.py` (40, a barreira entre o que o modelo propõe e o disco), `organizar.test.py` (84, o job do Hermes, com o `hermes` de mentira) e `servidor.test.py` (35, HTTP em loopback, CSP com nonce, host de fora recusado).
- `deploy/dell/prumo-mapa/calculo_prumo.test.py` (35): a escala e as faixas do Índice, o Vale Norte batendo a simulação, a calculadora do Raio-X em Python e no JS da página.
- `deploy/dell/hermes-uso-skills.test.py` (4): contagem das skills nunca usadas, só os campos conhecidos, arquivo 600.
- `deploy/hermes/scripts/graphify_projetos.test.py` (52), `projetos_verificar.test.py` (25) e `sites_e_pendencias.test.py` (18): o planejamento dos espelhos e a rodada do grafo, o verificador do registro de projetos, e o aviso diário (o job do Hermes trocado pelo timer, gravado pela lib de aviso).
- `deploy/dell/licitacoes-automation/scripts/collect-pncp.test.mjs` e `collector-server.test.mjs` (`node --test`): prazo antes de coleta + 3 h não é qualificado, o relatório separa o descartado, e o collector responde na hora, deduplica e persiste a falha controlada (Radar PNCP, RULES 22).
