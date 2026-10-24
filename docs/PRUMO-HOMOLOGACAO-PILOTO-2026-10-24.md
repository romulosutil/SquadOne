# Homologação do piloto comercial — 24/10/2026

## Resultado

Homologação técnica concluída com três históricos reais elegíveis para o transporte PRUMO: ControEco, Casa do Bordado e TPrint. Estampa Cor foi usada como controle negativo de origem. O usuário confirmou o recebimento do aviso no Telegram e informou que o link abriu no celular após nova tentativa. A causa da falha inicial de conexão não foi comprovada. Nenhuma configuração de Tailscale, ACL ou exposição pública foi alterada.

Esses casos validam revisão interna, espera e proteção contra repetição. Nenhum dos contextos contém qualificação humana suficiente para proposta final, aceite, cobrança ou pagamento. O ciclo comercial permanece dependente de fatos reais e da decisão de Rômulo.

## Casos e resultados observados

| Caso | Evidência original, Brasília | Resultado técnico e comercial |
|---|---|---|
| ControEco / Kelisson | Entrada PRUMO de 22/10, 20:06:51; há saída posterior registrada por outra origem. Histórico comercial informa avaliação com sócios. | Evento conferido por ID, origem, horário e hash. Revisão interna na ficha e um aviso automático no Telegram. Sem rascunho de contato. Preservar espera e condições: gestão de tráfego R$ 500/mês, verba de anúncios à parte; mensalidade do site não combinada. |
| Casa do Bordado | Entrada PRUMO de 19/10, 15:55:46; apresentação posterior confirmada na fonte PRUMO e no CRM. | Evento concluído e tarefa derivada suprimida. Não criar outra cobrança só porque houve confirmação de acesso ao responsável. O próximo passo antigo vencido continua sujeito à revisão humana; não foi apagado nem convertido em reunião aceita. |
| TPrint | Entrada PRUMO de 22/10, 12:49:45; apresentação posterior registrada por outra origem, com orientação de aguardar. | Revisão interna e um aviso automático no Telegram. Conferir o histórico e preservar a espera; sem contato automático. |
| Estampa Cor, controle fora da amostra de transporte | Entradas preservadas estão marcadas como origem pessoal. O “não” foi à pergunta se já possuía CRM. | Nenhum envelope PRUMO produzido. Não reescrever a origem para completar a amostra. Ausência de CRM não comprova necessidade ou compra; também não é recusa automática à oferta. |

A divergência de origem indica uma pendência de governança: a conta/origem da captura precisa permanecer verificável em importações e coletores. O teste manteve os dados como estavam. TPrint e ControEco foram encaminhados internamente justamente porque a confirmação de atendimento por outra origem não encerra silenciosamente o controle PRUMO.

## Percurso exercitado

1. Código publicado 1046b70 e fonte JSONL real, com a mensagem original preservada. Sem gerar nova resposta do cliente ou alterar seu horário.
2. Helper do observador produziu três envelopes reais. Em cópia privada, fonte, deduplicação e reinício em outro processo passaram; cada evento conservou um único registro concluído e não ganhou nova reserva.
3. Os três envelopes passaram pelo transporte real a partir do container n8n, pela ponte existente até a inbox da Central. Cada primeiro POST retornou 202 pendente e a repetição exata retornou 202 repetido. Foram acrescentados três eventos históricos à inbox, sem chamar o classificador/modelo nem regravar a classificação antiga.
4. O controlador publicado concluiu os três eventos. ControEco e TPrint apareceram como tarefas internas; Casa do Bordado foi suprimida pela saída confirmada. Não houve estado ambíguo novo.
5. As rotas reais de preparo de ControEco e TPrint retornaram procedimento interno, mensagem nula e abertura de WhatsApp bloqueada. Nenhum texto foi oferecido como mensagem de cliente.
6. O vendedor em produção registrou um aviso automático por tarefa de ControEco/TPrint, com recibo do Telegram e botões Abrir Central e Pular. O teste puro com os avisos reais confirmou que Enviei é rejeitado. Nenhum callback de envio ou Pular foi executado na produção; enviadosHoje permaneceu zero.
7. Um aviso identificado de homologação foi enviado ao único chat privado permitido de Rômulo, com links de fichas. Depois foi atualizado com o resultado final. O recebimento e a abertura no celular foram confirmados pelo usuário; os três destinos de ficha foram também conferidos no navegador desktop.

## Gates de proposta, contrato e pagamento

Com os quatro contextos reais, 16 tentativas sintéticas de transição sem referência — proposta enviada, aceite, cobrança e pagamento — foram rejeitadas em memória, sem fetch, append ou journal de produção. Esses testes não geraram notas humano:true na fonte, receita, proposta, contrato ou pagamento. Não houve tentativa de assinatura, cobrança bancária ou pagamento real.

A tomada de responsabilidade não foi simulada como se Rômulo tivesse clicado. O formulário permanece disponível, mas sua adoção humana no atendimento precisa ocorrer na prática.

## Estado preservado e limites

- Escritório, cena, personagens, quadros e navegação preservados; não houve alteração de código nesta homologação.
- Os 31 arquivos preexistentes alterados/não rastreados no Dell permaneceram byte a byte. Worktree canônica preserva RULES.md e o output anterior fora do commit da documentação.
- Os 21 workflows mantiveram seus estados individuais, com 18 ativos. Nenhum caçador ou tarefa Grok foi reativado.
- A conta Evolution PRUMO respondeu open na consulta direta. A frente de primeiros contatos continuou pausada pelo registro anterior de desconexão, de 24/10 às 03:37; não houve retomada durante o piloto.
- Zero novas notas humanas de responsável, qualificação ou ciclo comercial no CRM. A homologação não enviou WhatsApp aos clientes.
- Este foi um reprocessamento controlado de entradas já existentes. Ainda falta observar uma resposta nova de cliente percorrendo espontaneamente o classificador, a captura e a qualificação. Não apresentar o replay como resposta nova, contratação ou venda.
- Não foram encontrados três clientes com intenção de compra e próximo passo comercial abertos ao mesmo tempo. Roda Mais e Comece continuam fora da retomada, com suas esperas respeitadas.

## Evidências

Cópias privadas, envelopes, manifestos e recibos técnicos ficam no Dell sob `~/.cache/mel-work/homologacao-comercial-20261024T113147Z/`, diretório 700 e arquivos 600. O relatório final é `homologacao-final-sanitizada.json`; testes isolados em `confiabilidade-final/`; transporte em `transporte-real-resultados.json`; avisos automáticos e rotas em `avisos-automaticos-e-rotas.json`. Dados de contato, tokens, números dos destinatários e textos integrais das conversas não foram levados à documentação do repositório.
