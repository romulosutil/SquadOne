# Publicação da classificação e conferência dos envios — 22/10/2026

Publicado no Dell e no n8n às 16h36 de São Paulo; conferido às 16h37.
Release recuperável: `classificacao-20261022-163044` na área privada do Dell.

## Publicação

O pacote foi reconstruído sobre a fonte instalada, com o identificador público
OAuth de produção. Foram preservadas as mudanças posteriores da interface,
incluindo confirmação de próximo passo e a medição de origem dos contatos.
O pacote local anterior de validação, com OAuth fictício, não foi publicado.

No workflow de classificação, somente os códigos de Montar pergunta, Decidir pela
resposta e Jev: mascarar e montar pedido foram atualizados. Demais nós, conexões,
credenciais, ramo de persistência e configurações permaneceram iguais. A versão
ativa do workflow corresponde à versão salva. Os estados ativos/pausados de todos
os workflows foram comparados antes e depois e permaneceram iguais.

A classificação contextual aparece nos 3.522 leads do CRM. Nos 343 com envio
registrado, a leitura do estado atual ficou:

| Classe | Contatos |
| --- | ---: |
| Sem resposta registrada | 207 |
| Resposta automática | 68 |
| Recusa | 28 |
| Resposta neutra | 19 |
| Permissão para material | 6 |
| Acesso ou encaminhamento | 6 |
| Curiosidade | 1 |
| Contexto pendente de revisão | 8 |
| Interesse comercial explícito no trecho atual | 0 |
| **Total** | **343** |

São categorias do estado atual, não uma contagem de tudo que cada pessoa já disse.
O zero de interesse explícito não apaga perguntas comerciais, elogios ou propostas
históricas, nem prova que não existam oportunidades. Os trechos e os registros de
origem continuam disponíveis. O sistema não reescreveu retrospectivamente as
planilhas nem reabriu recusas ou exclusões.

Os 13 rótulos antigos de interesse se repartiram em cinco permissões, quatro
acessos, uma curiosidade, duas respostas neutras e um caso pendente. Onze respostas
reajustadas na leitura operacional conservam `respostaFonte`. Entre os 207 contatos
sem resposta, dez têm leitura confirmada e 197 não têm leitura confirmada.

## Por que parou em cinco

É o teto efetivo da retomada de 22/10: **5 primeiros contatos por dia, 2 por hora
e intervalo mínimo de 30 minutos**, compartilhado pelas superfícies do sistema.
A regra usa teto único `[5]`; não há aumento automático pelo passar dos dias.
O campo legado `limite: 100` no arquivo de ativação não amplia esse teto: a
proteção compartilhada prevalece. Nenhum desses valores foi alterado.

O serviço e seu timer estavam ativos, sem pausa automática ou erro. O estado diz
explicitamente que o teto compartilhado do dia foi atingido. Foram encontrados
cinco recibos de envio confirmados hoje; o último é de 14h37, antes da publicação.
O contador permaneceu em cinco durante a operação. O orçamento diário reinicia
à meia-noite; o expediente permite os próximos primeiros contatos a partir de
23/10 às 8h de São Paulo, condicionado às demais proteções e à saúde da conexão.

## Verificações

- 3.722 testes do projeto, 71 do classificador e 82 do executor aprovados no Dell.
- Verificação de tipos e build de produção aprovados.
- Executor instalado corresponde exatamente à fonte testada.
- Central, executor agendado, Hermes, adaptador e observadores ativos; Hermes conectado.
- JavaScript e CSS da versão publicada respondendo HTTP 200.
- Quinze execuções recentes do classificador e quinze do observador com sucesso;
  cinco do acompanhamento com sucesso. As últimas execuções do classificador são
  anteriores à publicação: a confirmação da versão nova usa a versão ativa e o
  código instalado, sem provocar uma mensagem real como teste.
- Arquivos de ativação/pausa e estados dos workflows preservados por comparação.

Na validação houve uma chamada inicial do executor com uma opção que não era de
teste. Ela não acrescentou recibos nem disparou contatos: o teto permaneceu
atingido. A chamada foi corrigida e os 82 testes isolados foram executados.

Backups do workflow, fontes e pacote anterior ficaram na pasta privada da release.
O Grok continua independente; seu agendamento não foi modificado por esta publicação.

Evidências agregadas locais: `output/publicacao-classificacao-2026-10-22/`.
