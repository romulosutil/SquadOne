# Publicação das primeiras mensagens comerciais

Em 27 de outubro de 2026, Rômulo autorizou aplicar os ajustes do teste adversarial e publicar na operação. A Central da Mel, os quatro fluxos de primeira abordagem e o resumo usado pelo classificador de respostas receberam a revisão.

## Textos publicados

- Site com demonstração: identifica o Prumo como prestador de criação de sites e apresenta a demonstração como independente, feita com informações públicas.
- Site sob pedido: oferece preparar a demonstração independente; não afirma que ela está pronta.
- Site com análise: explicita a atividade comercial, mantém o achado verificável e oferece a análise gratuita de uma página.
- Prumo: oferece exemplo ilustrativo de regras organizadas para a equipe, sem pressupor dependência do dono.
- CRM de estamparia: oferece ficha de exemplo sem dados de clientes, sem pressupor troca ou integração já autorizada.
- Iris: oferece exemplo fictício dos relatórios de reavaliação, sem presumir atendimento ou vínculo com convênio.
- Plus, CDL e inglês: seguem os mesmos princípios, preservando a origem verdadeira e as condições próprias do canal.

Os resumos do classificador distinguem as versões antigas que pediam o responsável das versões novas que oferecem material. A pergunta realmente enviada continua sendo a referência para interpretar um “sim”.

## Verificação da operação

| Verificação | Resultado |
|---|---|
| Testes do pacote na Mel | 198 aprovados, zero falhas |
| Build isolado, build com a fonte atual da operação e typecheck | Aprovados |
| Sintaxe dos quatro fluxos de entrada | Aprovada antes da atualização |
| Convites Prumo, Iris e CRM publicados versus função da Central | Textos coincidentes em execução isolada com dados fictícios, sem rede |
| Abordagens pendentes do Site atualizadas | 122: 109 na variante A e 13 na C |
| Textos de contatos anteriores conferidos | 1.599, sem reescrita |
| Nova leitura da base após atualização | Zero textos pendentes antigos elegíveis |
| Site na API da Central após sincronização | 122 aberturas prontas, zero textos antigos |
| Iris, CRM e Plus na Central | Novas aberturas conferidas em 639, 723 e 308 leads novos, respectivamente |
| Leitura de recusas | Versão `respostas-2026-10-27-adversarial` confirmada na API |

A conferência dos convites usa dados fictícios e compara o texto gerado pelo código publicado nos workflows com o texto do servidor. Não abre wa.me, não faz requisição externa e não envia mensagens aos leads.

As duas correções identificadas pelo teste adversarial também estão na operação: pedido direto de exclusão do contato e recusa educada do material deixam de ser lidos como resposta neutra. A leitura não afirma que uma exclusão de dados já foi executada.

## Preservação e rastreabilidade

A publicação foi preparada em worktree isolada na Mel. O runtime foi construído preservando os demais arquivos que já estavam em uso. A comparação posterior não encontrou alteração em outros arquivos da fonte fora do pacote.

O código das primeiras mensagens foi aplicado pelo commit `b34362b`; os commits seguintes alinham os resumos de interpretação e os utilitários da publicação. Backups das fontes, do build e dos workflows, stashes de recuperação e recibos das atualizações ficam na área privada `~/.cache/mel-work/aberturas-adversarial-20261027/` da Mel.

A atualização da planilha limitou-se aos campos de mensagem e metadata A/B de registros ainda em `pronto`, sem primeiro envio ou resposta registrados. Não alterou status, preços ou limites de contato. A leitura posterior confirmou os textos antigos preservados.

Os timers foram restaurados após cada transação, inclusive nas tentativas que aguardaram a rodada ou o turno terminarem. A atualização não reativou caçadores. Os cinco workflows alterados conservaram o estado ativo anterior. A implantação foi verificada com a Central saudável.

Esta publicação aplica as candidatas aprovadas; não transforma simulação em resultado de pesquisa com clientes reais nem declara vencedor de conversão.
