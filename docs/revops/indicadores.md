# Indicadores da operação comercial

Revisão: 25/10/2026. Leitura operacional da fonte CRM existente; nenhum indicador escreve fato humano ou libera envio. A disponibilidade e a condição de trabalho do Rômulo foram confirmadas qualitativamente. Não inferimos horas, capacidade, prazo de resposta ou estabilidade a partir dessa confirmação.

## Onde usar

Na abertura e no fechamento da rotina, conferir os oito cartões do modelo operacional. Eles mostram o trabalho acompanhado e os marcos registrados, não uma lista de compradores. Os quatro primeiros usam a mesma função de prioridade do escritório. A definição estruturada está em `src/operations/modelo-operacional/indicadores.json`; o cálculo puro está em `indicadores.ts` na mesma pasta.

| Indicador | Como interpretar e agir |
| --- | --- |
| Conferências internas | Conferir fonte, contexto ou condição antes de escolher a ação; não autoriza contato. |
| Próxima lacuna de qualificação | Preparar uma lacuna pertinente por vez; pedir preço passa ao humano mesmo incompleto. Não é contagem de clientes qualificados. |
| Em espera | Preservar o combinado. Espera não é atendimento atrasado nem cobrança vencida por silêncio. |
| Decisões comerciais | Rômulo confere a evidência e o próximo marco do ciclo. Não representa venda provável ou dinheiro. |
| Passagens sem identidade confirmada | Resolver a prova de conta/conversa. Pode sobrepor os grupos anteriores; não somar como total da fila. |
| Versões de proposta enviadas | Marco válido e ativo de envio da versão exata no ciclo. Não contar rascunho ou proposta legada isolada como envio versionado. |
| Aceites registrados | Aceite válido, documentado e ligado à versão enviada. Não confirma cobrança liberada nem recebimento. |
| Recebimentos registrados | Contagem canônica AARRR desde 19/10/2026, incluindo fatos válidos legados e novos, deduplicados e corrigidos. Sem valores financeiros no cartão. Não distingue receita existente de nova e não prova a primeira venda nova. |

## Recorte e frescor

O recorte acompanhado inclui etapa contato/proposta, atendimento presente, qualificação humana explícita ou ciclo registrado. Lead novo sem contexto não entra como conferência por ausência de dados. Recusa e desfecho são preservados pelo plano canônico; encerrados não viram qualificação, decisão ou espera. Os marcos de proposta, aceite e recebimento consultam todos os registros válidos da visão, inclusive de oportunidades encerradas, para preservar fatos históricos reais.

Os números só são produzidos quando: estado da visão é `ok`; data de geração é válida e não futura; idade está dentro de `minutosAteVelho` informado pela própria API; as fontes Site, Prumo, Íris, Estamparia e Registros estão presentes; não há erro de fonte, coluna ausente ou última publicação falha. Em qualquer outra situação os oito valores ficam desconhecidos (`null`), apresentados como Sem dados. Nenhum cache antigo vira zero atual.

Zero significa nenhum fato observado naquela definição/janela, não prova de ausência de atividade ou pagamento fora da fonte. A fonte conhecida de R$4.100/mês da Silmer e a participação online não são injetadas nesse cálculo. Mesmo um recebimento válido registrado de cliente existente não satisfaz, sozinho, a primeira venda nova. Essa confirmação permanece separada, sustentada pelo cadastro e fatos reais, sem inferência por nome de empresa.

## Tempo e metas

Não é exibido um tempo de atendimento fictício. Medir entrada até assumir ou resposta útil exige datas originais de entrada e de ação humana comparáveis; importação, aviso entregue ou abertura de link não substituem esses marcos. O alvo interno histórico de passagem no expediente não é promessa ao cliente nem prova de capacidade. Taxas e metas comerciais dependem de janela e amostra explícitas; os oito cartões não fabricam percentual com amostra insuficiente.

A revisão semanal verifica tendência, acúmulo de conferências, passagens sem prova e progressão real entre marcos. Mudanças de público, preço, ritmo ou autonomia exigem sua decisão e as guardas específicas; nenhum limiar desses cartões aciona automação. Conversas e referências financeiras individuais ficam no CRM e nas fontes privadas; o resultado do cálculo só contém contagens e explicações fixas.

## Verificação

Teste isolado em `src/operations-indicadores-modelo.test.ts`: fonte ausente/antiga/futura/incompleta; fonte saudável vazia; prioridade com espera/recusa e novos sem contexto; proposta legada e ganho sem recibo; ciclo válido, pagamento legado, deduplicação, correção e ausência de mutação/valores privados no retorno. As funções reutilizadas são `planoComercialDoLead`, `temQualificacaoComercial`, `cicloDoLead` e `leituraAarr`. Não há rede, modelo, mensagem ou gravação CRM nesse calculador.
Validação concluída: quatro testes passaram, zero falhas/skip; TypeScript dos dois arquivos de código passou sem emissão. O indicador de recebimentos foi testado com registro legado válido do catálogo e fato do novo ciclo, sem relaxar seus validadores.
