# n8n na operação da Prumo

O [Estado atual](../../ESTADO-ATUAL.md#n8n) contém a conferência de 18/11.
O [guia da Mel](../../ops/n8n/README.md) registra as agendas atuais, os
consumidores e as fontes de manutenção. A revisão de 25/10 e os procedimentos
dos três caçadores abaixo são históricos.

Revisão: 25/10/2026. O n8n executa rotinas determinísticas e integrações autorizadas; a Central/CRM conserva os fatos comerciais e Rômulo decide qualificação, negociação, aceite e recebimento. Esta entrega não envia mensagens nem libera prospecção.

## Pesquisa Google sob demanda no Mel

O fluxo **PRUMO · Pesquisa de empresas** (`pwNiZI1rBGzMJ2dP`) tem uma entrada autenticada `POST /webhook/prumo-pesquisa-google` no n8n do Mel (`127.0.0.1:5679` via SSH). O corpo `{}` consulta os três nichos em 45 dias. Para restringir a rodada, envie por exemplo `{"nicho":"servicos-tecnicos","dias":30}`. Os outros nichos são `escritorios` e `agencias`. A janela aceita de 7 a 60 dias. A entrada usa a credencial de cabeçalho da revisão existente.

O fluxo consulta o RSS do Google Notícias e retorna JSON com o estado de cada consulta, data, veículo, link e checagens que faltam. Para buscas complementares, retorna links do Google Web, inclusive consultas sobre contratação de fornecedores em publicações públicas. Uma notícia de mudança ou inauguração entra como sinal. Antes de passar para proposta, confirme na fonte original um pedido ainda aberto ou uma lacuna verificável até o orçamento, além do encaixe no Encontrado e do canal empresarial. A execução sob demanda tem custo zero e termina no relatório de pesquisa.

O relatório de WhatsApp usa a mesma triagem de RSS. Cada consulta mantém seu
lugar mesmo quando a busca ou o XML falha. A execução diária grava o relatório
para revisão humana. A rodada agendada de pesquisa e higiene emite seu
próprio retrato e uma leitura para a Central.

## Responsabilidade e passagem

| Entrada | Trabalho do n8n | Saída e condição de conclusão |
| --- | --- | --- |
| Aquisição autorizada | Ler fonte existente, aplicar critérios versionados, deduplicar por identidade e persistir | Registro confirmado na fonte; falha de leitura ou persistência impede afirmar conclusão |
| Resposta observada | Correlacionar identidade e preservar evento antes de confirmar recebimento | Contexto atual na ficha; ambiguidade fica para conferência, sem atribuir por nome parecido |
| Interesse, preço, objeção, proposta, contratação ou pagamento | Encaminhar para a fila humana existente com fonte e próxima ação | Rômulo assume; aviso entregue não confirma atendimento nem aceite |
| Proposta preparada | Usar catálogo canônico por código e evidências humanas suficientes | Rascunho identificado; nunca preço criado pelo modelo, envio ou aceite presumido |
| Falha técnica | Preservar execução/evidência privada e avisar pelo canal operacional vigente | Operador confere a causa e o efeito; falha não autoriza reexecução com efeito externo |

Cada automação deve declarar origem, responsável, entrada, saída, erro, estado de pausa e evidência de aceite. Não nasce fila comercial paralela no n8n. O contexto canônico da Prumo permanece em cada entrada e subworkflow pela integração `prumo_contexto.py`; sua sincronização preserva as pausas.

## Estado conferido e rotina

Na leitura de produção desta revisão havia 21 workflows, 16 ativos. O legado `01 · Caçador` permanecia ativo; Iris, Estamparia e fluxos 05/06 permaneciam pausados. Esse inventário técnico não autoriza novos contatos. A frente comercial continua pausada, com as guardas operacionais e `DESLIGADOS` preservados. Não converter automaticamente todo workflow ativo em autorização comercial nem desativar outras rotinas por associação.

No início do dia, o operador confere frescor do monitor, erros novos, fila de decisões e bloqueios. Ao longo do dia, os encaminhamentos usam a ficha atual e a responsabilidade definida nas regras de passagem. No fechamento, cada falha conserva referência técnica, efeito conhecido ou incerto, responsável e condição de resolução. Uma fila de saída pendente continua pendente: o processador a exclui do conjunto de trabalho pelo próprio contrato, sem perder sua evidência ou apresentá-la como tarefa nova.

A capacidade humana foi confirmada qualitativamente por Rômulo. Paralelismo técnico não constitui capacidade de entrega nem promessa de prazo. Os indicadores comerciais vêm do modelo comum; para n8n, acompanhar falha por workflow, execução sem saída comprovada, bloqueio durável de aquisição e sincronização do contexto. Quantidade de execuções ou mensagens não é venda, receita ou sucesso de entrega.

## Concorrência da aquisição corrigida

O upsert por ID/place_id, a releitura antes da escrita e o tratamento fechado de erro de leitura não impediam dois caçadores de ler a mesma ausência simultaneamente. A solução implementada reserva uma única posse durável **antes da primeira leitura da fonte**, compartilhada somente por:

- `01 · Caçador`
- `PRUMO · Iris — Caçador de clínicas`
- `PRUMO · CRM de estamparia — Caçador de estamparias`

O serviço `aquisicao-guarda` usa SQLite com transação `BEGIN IMMEDIATE`, journal privado, token de posse e persistência síncrona. Uma segunda execução recebe `acquired=false` e termina silenciosamente, sem salvar lead ou avisar que persistiu. O mesmo identificador de execução nunca adquire novamente, mesmo depois de concluído. Liberação exige workflow, execução e token correspondentes; repetição da liberação confirmada é idempotente.

A transformação preserva gatilhos manuais/agendados e o contexto inicial. O núcleo original fica num subworkflow inline aguardado integralmente; apenas após sua conclusão chega a liberação. `alwaysOutputData` permite liberar quando o núcleo termina com zero itens. Erro, crash ou resposta ambígua conserva a posse. Não há TTL, vencimento ou liberação automática por reinício. Wait, subworkflow assíncrono e escrita Sheets com erro tolerado são recusados na preparação.

Os critérios originais, conexões internas, callerIds, settings, IDs externos e estados ativos permanecem iguais. O contexto Prumo também entra no núcleo com identidade compatível com o sincronizador. Geradores desembrulham, aplicam os hooks existentes e reconstroem a guarda por último. Clones auxiliares com o grafo de aquisição e outro nome são recusados, inclusive o atalho temporário usado por `--rodar`. Retirar a configuração de um grafo já protegido recusa a publicação.

Esse serviço adicional é necessário porque a API de Sheets não fornece uma transação compartilhada para a sequência leitura/ausência/escrita dos três produtores. Não altera concorrência global do n8n, não usa staticData/DataTable como trava e não adiciona modelo ou outro banco remoto. Não oferece garantia para escritas diretas na planilha, API administrativa/UI que contorne o publicador, ou novos produtores fora deste contrato.

## Implantação pelo responsável técnico

O código está implementado e homologado; esta frente não instalou o serviço nem publicou os grafos em produção. A implantação deve integrar as fontes locais já alteradas no Dell, preservando seus outros diffs.

1. Guardar backups privados 0600 dos três grafos completos, fontes e cópias instaladas dos publicadores, configuração e inventário de ativos. Registrar hashes e IDs retornados pela API. Verificar que nenhuma execução antiga dos três caçadores está `running`, `new` ou `waiting`, inclusive subexecuções; não publicar enquanto houver escritor antigo em curso ou evento agendado concorrente. A migração tem janela coordenada; publicar parcialmente com um gravador antigo ativo não assegura exclusão.
2. Confirmar a rede observada: container `licitacoes-automation-n8n-1`, bridge `licitacoes_n8n_network`, IP 172.23.0.3, gateway 172.23.0.1; porta 8791 livre. O serviço liga somente no gateway privado `172.23.0.1:8791`, aceita a rede `172.23.0.0/16` e loopback e exige autenticação nas rotas de estado/mutação. Não ligar em 0.0.0.0, Tailscale ou porta pública. Se a rede mudou, revisar serviço, validador e testes juntos antes de instalar. O INPUT/UFW do host também precisa permitir TCP 8791 somente na bridge `br-ecef3b89e8bc`, da origem efetiva do container (observada 172.23.0.3) para 172.23.0.1. Uma regra por IP /32 é mais restrita e exige reconferir o IP após recriação; se a operação escolher a sub-rede, documentar essa escolha. Não usar liberação geral da porta ou da LAN.
3. Instalar `deploy/dell/aquisicao-guarda.py` como `~/.local/bin/aquisicao-guarda` (0700) e a unidade como `~/.config/systemd/user/aquisicao-guarda.service` (0600). Gerar segredo aleatório com pelo menos 32 caracteres em `~/.config/claude-ops/aquisicao-token` (0600), sem imprimir, copiar ao Git ou sobrescrever um token existente. Conservar o banco existente em `~/.local/state/prumo-aquisicao/guarda.db`; nunca inicializar outro para liberar posse.
4. Criar credencial n8n de tipo `httpHeaderAuth`, nome sugerido `Prumo · Guarda da aquisição`, com `data.name=X-Aquisicao-Token` e `data.value` igual ao arquivo privado. Usar a API `/credentials` autenticada pelo operador sem imprimir segredo/corpo. Guardar somente ID e nome retornados na configuração abaixo. Não reutilizar credencial de CRM, Google ou modelo.
5. Instalar `serializacao_aquisicao.py` junto do `n8n.py` efetivamente usado pelos geradores e sincronizador. Integrar somente o diff autorizado de `n8n.py` e `workflow_confiabilidade.py`; manter os demais módulos instalados. A configuração privada `~/.config/claude-ops/workflow-aquisicao.json` (0600) tem exatamente:

```json
{"v":1,"enabled":true,"url":"http://172.23.0.1:8791","credentialId":"ID_RETORNADO","credentialName":"Prumo · Guarda da aquisição"}
```

6. Executar `systemctl --user daemon-reload` e `systemctl --user enable --now aquisicao-guarda.service`. Isso inicia somente o guardião; não reinicia n8n, Central, Hermes, timer ou canal. Conferir processo, bind, permissões e GET `/health`; consultar GET autenticado `/status` ou CLI `aquisicao-guarda --status`. **Não chamar `/claim` ou `/release` para testar produção.** Na primeira instalação, esperar `held=false` e `claims=0`. Conferir a rota pelo container após a regra de firewall. Para a consulta pelo host, ligar a origem da conexão a `127.0.0.1`: a regra MASQUERADE existente do Docker reescreve origem 172.23 do host que sai por loopback para o IP LAN, que a guarda corretamente recusa. Isso não justifica liberar a LAN no serviço. `http.client.HTTPConnection("172.23.0.1",8791,source_address=("127.0.0.1",0))` permite a conferência GET local sem essa tradução. Não usar proxy ambiente.
7. Ler novamente os três grafos por seus IDs originais e comparar ao backup imediatamente antes da troca. Para cada alvo, o publicador existente oferece `n8n.put(wf)`: aplica os hooks permanentes e a guarda pelo opt-in acima, filtra somente settings já aceitos e faz PUT no ID original. Não chamar activate, deactivate, execute, webhook ou scripts geradores com `--rodar`. Preparar previamente em memória e guardar o diff privado do grafo; conferir que somente o envelope da guarda/contexto adicional muda. O teste de roundtrip vale para a transformação; os hooks existentes também devem estar estáveis no diff antes de usar o publicador.
8. Ler a API novamente e conferir: três envelopes presentes, IDs/settings/callerIds preservados, estado ativo original preservado, critérios e núcleo iguais após desembrulhar, sincronização Prumo compatível e inventário ainda 21/16. Conferir que 05/06/Iris/Estampa continuam pausados e guardas de contato não mudaram. GET `/status` deve continuar sem claim artificial. Após uso natural autorizado, a prova de execução usa apenas metadados privados; a instalação não precisa gerar lead ou mensagem.

Se a janela de migração não puder excluir execuções antigas concorrentes, deixar a publicação aguardando essa janela; não enfraquecer a guarda para obter um resultado verde. O estado ativo original é uma condição de retorno, não motivo para permitir corrida durante a troca.

## Recuperação de posse incerta

Uma posse retida representa aquisição cujo resultado exige conferência, mesmo que a execução esteja vermelha no n8n. O operador conserva export privado da execução, fonte/planilha e efeitos de todos os ramos. O responsável técnico consulta o estado sem chamar claim. Não repetir workflow, alterar ID, apagar banco, trocar arquivo de estado ou expirar por relógio.

A reconciliação é somente CLI local do responsável técnico. Primeiro comprovar término no motor e conferir todas as persistências; uma execução `waiting` ou `running` nunca pode ser liberada. O comando verifica a execução pela API GET e exige nome igual, status final e `stoppedAt`; a confirmação da planilha continua humana:

```text
~/.local/bin/aquisicao-guarda --reconciliar --workflow 'NOME_EXATO' --execution 'ID_ORIGINAL' --referencia 'evidencias/revisao-IDENTIDADE' --persistencia-conferida
```

A referência é técnica, sem contato/texto do lead. O journal permanece e a mesma execução continua impedida de adquirir. A reconciliação libera apenas uma futura execução autorizada; não repete automaticamente o efeito incerto. Se a execução não está mais disponível na API ou o efeito continua desconhecido, manter bloqueado e tratar caso específico; ausência não comprova que a escrita não ocorreu.

Retorno ao código anterior exige a mesma conferência de ausência de escritores e de efeitos pendentes. Restaurar backup do workflow ou retirar a guarda com posse incerta pode repetir gravação; não é rollback seguro. Preservar a configuração e o banco como evidências mesmo quando o serviço estiver parado.

## Critérios para liberar automação comercial

A guarda de concorrência é apenas um requisito técnico. Retomar prospecção exige decisão explícita de Rômulo, fonte canônica de preço/versão correta, dor/impacto/decisor confirmados para proposta nova, identidade sem conflito, dono e condição de passagem definidos, capacidade e entrega aceitáveis, WhatsApp atual conferido e limites/cadências vigentes. Autenticação, journal, recuperação e observabilidade precisam estar instalados e conferidos. Sem isso, preparar e revisar internamente. Não há autorização de envio neste documento.

## Homologação e limites da prova

- 51 testes Python passaram no Linux do Dell em réplica privada isolada: guarda 12, serialização 9, confiabilidade 17, contexto Prumo 7, contrato de prospecção 6; zero skips. Guarda e serialização também passaram no Windows.
- Concorrência com 18 pedidos por seis processos produziu um único titular. Crash real após commit, reinício, relógio antigo, token/dono errado, replay, autenticação, corrupção e reconciliação foram testados com arquivos temporários.
- As fábricas Iris/Estampa e o Site legado sanitizado passaram preservação de gatilhos/settings/callerIds/active/critérios, regeneração idempotente e compatibilidade com contexto e editores Site. Os três grafos atuais de produção também passaram roundtrip exato em memória após GET, sem publicar.
- Engine real n8n 2.38.7, na imagem Docker já instalada `sha256:a8c95f75c6fdf65f5f2b7a7b354744eaa1c62bb911b5c00af6499c3f38e4cd32`: fixture de dois ramos liberou apenas após ambos terminarem; zero itens liberou; erro final manteve posse. Container com `--network none`, rootfs somente leitura, tmpfs, sem ambiente/credenciais/mounts de produção, sem download e somente mock HTTP em loopback. Sheets e Places reais não foram executados.
- Provas privadas no Dell: `~/.cache/mel-work/n8n-aquisicao-homologacao-20261025/python-proof.json`, `live-readonly-transform-proof.json` e `engine-stdout.txt`; fixtures e stderr no mesmo diretório. Esses arquivos não entram no Git.

Os testes não comprovam instalação futura, comportamento de credenciais em produção, entrega de mensagem ou venda. A interface HTTP exige token e origem da rede permitida, mas não substitui isolamento por processo ou autorização administrativa do n8n. A política do publicador não é ACL universal. O banco mantém até 100.000 reservas e fecha ao atingir o limite; planejar revisão/arquivo preservado antes disso, sem apagar o histórico para destravar.

Fontes: `RULES.md`, integrações e testes citados; [Execute Sub-workflow — documentação n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/) e a execução isolada da versão instalada. A autoridade dos critérios comerciais permanece nos documentos canônicos da Prumo e no modelo operacional comum.

## Implantação coordenada — 25/10/2026, 12h17 BRT

Guarda, credencial exclusiva, configuração privada e unidade instaladas. Regra UFW restrita à bridge `br-ecef3b89e8bc`, origem do container `172.23.0.3/32`, destino `172.23.0.1/32`, TCP 8791; nenhuma porta pública aberta. GET autenticado do host com origem loopback e do container respondeu: saudável, zero reservas, sem posse retida. A mudança de IP/bridge exige revisão explícita; não ampliar a regra para resolver indisponibilidade.

A migração ocorreu com zero execuções `running`, `waiting` ou `new` no motor. Site tem próximo gatilho às 6h BRT do dia seguinte; Iris/Estampa continuam pausados. Três grafos receberam somente o envelope revisado por PUT na identidade original. GET posterior comprovou os núcleos exatos após desembrulhar, mesmos settings/callerIds e estados; os outros dezoito grafos ficaram estruturalmente iguais. Inventário final: 21 workflows, 16 ativos, com 05/06/Iris/Estampa ainda pausados. Nenhuma ativação ou execução manual.

Divergência anterior corrigida: `workflow_confiabilidade.py` instalado estava 40 linhas atrás do fonte Dell homologado. A instalação preservou o backup de ambas as versões e realinhou o helper às proteções já existentes no fonte: dedupe estrito, appendOrUpdate por place_id e ausência de retry automático da escrita. O código instalado, normalizado apenas quanto a fim de linha, confere com a versão homologada. O novo hook de posse entra por último no publicador, sem perder os demais hooks.

Backups completos dos três workflows, fontes, firewall anterior e provas ficam em `~/.cache/mel-work/modelo-operacional-20261025/`, privados. Reversão não apaga o journal nem retira uma guarda com efeitos pendentes; exige as verificações de término e persistência descritas acima. Instalação e GET não substituem prova natural futura; não se criou claim ou lead para produzir um teste verde.
