# Prioridade comercial da Prumo — 26/10/2026

Decisão de Rômulo neste chat: ajustar a seleção por justificativas comerciais,
com Site/Encontrado como frente principal e CRM de estamparia por oportunidade
com necessidade confirmada. A decisão é uma hipótese de alocação de esforço;
não declara conversão, margem ou ciclo de venda superiores comprovados.

## Justificativa e execução

Site tem preço e escopo definidos na fonte oficial da Prumo, uma demonstração
sob demanda e condição de pagamento após ver no ar. Esses fatores permitem
testar uma oferta definida. Não ter site é sinal a investigar; não prova compra,
perda de vendas, retorno financeiro nem urgência. Para esse primeiro contato,
um achado verificável de site e uma atividade identificável permitem perguntar
ao responsável se a solução é útil: não se exige SPICED confirmado antes da
descoberta. Horário ausente ou fotos de terceiros, isoladamente, não justificam
vender um site.

O CRM organiza pedidos e conversas de estamparias, mas sua assinatura, esforço
de implantação, suporte e reprodução em outra empresa ainda exigem confirmação
nos registros consultados. Ser estamparia ou pedir orçamento no site não prova
perda de pedidos. A seleção automática exige dor, impacto e decisor confirmados
no SPICED da fonte comercial. Sugestões e extrações automáticas não satisfazem
esse requisito. O contato não é descartado e conversas já abertas continuam.

O executor ordena Sites aprovados antes das outras ofertas, mantém diversidade
de setores e três aprovações independentes de pelo menos 65. Não cria quota,
não baixa notas para preencher fila e não amplia os limites. As outras ofertas
continuam com seus critérios; Estamparia recebe a exigência adicional acima.
Taxa de resposta fica descritiva, sem bônus na ordenação. Envios históricos ficam
depois das escolhas prontas, para não parecerem a prioridade comercial atual.

Cada escolha guarda quatro respostas, disponíveis nos detalhes da tela:

- **Por que compraria:** achado específico ou necessidade confirmada, com a
  hipótese de utilidade explicitamente separada de intenção de compra.
- **Por que esta oferta:** benefício demonstrável e coerente com o problema.
- **Por que agora:** próximo passo a validar; sem urgência criada pelo agente.
- **Viabilidade:** condições conhecidas e lacunas de custo, esforço, suporte,
  margem e tempo até recebimento; sem números inventados.

O modelo recebe somente os indicadores booleanos de qualificação. Texto privado
de dor, impacto e decisor não é acrescentado ao prompt. As condições comerciais
não são recalculadas pelo modelo. A qualificação atual é revalidada antes do
envio, e mudanças nela invalidam o hash da avaliação.

## Medição e limites da conclusão

Usar as fontes comerciais existentes para acompanhar contato → conversa
qualificada → proposta → aceite → recebimento. Comparar ofertas com períodos,
denominadores e cobertura explícitos. Margem exige receita recebida, custos e
horas de venda/entrega/suporte; dados ausentes não viram zero. O ajuste não cria
uma estimativa numérica de retorno nem um produto vencedor.

A simulação de leitura do Dell encontrou 28 Sites e 336 contatos de Íris que
satisfazem a elegibilidade antes de deduplicar históricos e registros de envio.
Nenhuma Estamparia satisfez a qualificação comercial mínima. Esses números não
são previsão nem autorização de envio. A fila anterior tinha 51 Estamparias,
47 contatos de Íris e 2 Sites. Fonte: simulação agregada no ambiente de teste,
em 26/10, sem inferência, reserva ou envio.

A falha previamente auditada do caçador de Site não é resolvida por mudar a
prioridade: a reposição de candidatos precisa continuar sendo acompanhada.

## Fontes e validação

- `../prumo/00-contexto/organizacao.md` e `produtos.md`: famílias, estado e
  pendências comerciais por produto.
- `../prumo/04-venda/piloto-cdl/precos.json`: preço e condição do Site.
- `docs/PRUMO-BI-OPERACAO-2026-10-23.md`: respostas não comprovam conversão.
- `deploy/dell/frente-comercial.py`: elegibilidade, ordenação, justificativas,
  versão de avaliação e revalidação antes do envio.
- `deploy/dell/frente-comercial-estrategia.test.py`: testes de política,
  qualificação, histórico, privacidade e perda de confirmação antes do envio.

A instalação usa um patch sobre a versão atual do Dell, que contém proteções
posteriores às do checkout local. Não substituir esse executor pela cópia local
inteira. Os artefatos de revisão ficam em `output/prioridade-comercial-20261026/`
e, no Dell, em `~/.cache/mel-work/prioridade-comercial-20261026/`.

## Publicação e conferência

Instalado no Dell em 26/10/2026, com backup, configuração preservada e nenhuma
mensagem de teste. Central e timer ativos. A política final é
`justificativa-comercial-v3-20261026`: esclarece a descoberta do Site, mantém a
qualificação dirigida do CRM e não usa a falta de qualificação de outra oferta
fria como bloqueio do Site para o mesmo número. Contato anterior, pausa e tomada
humana continuam bloqueando.

Validação final: 108 testes Python na versão Linux instalada, 69 na versão
local, 17 testes da API/campos na versão atual do Dell, tipagem e build. A tela
real foi aberta e as quatro justificativas foram conferidas em uma escolha.
Custos e margem permanecem como lacunas quando não há fonte, sem retorno
financeiro inventado. Avaliações anteriores são reprocessadas pela nova versão;
isso não autoriza repetir mensagens nem retomar conversas antigas.

Provas agregadas e hashes estão em `output/prioridade-comercial-20261026/`.
`producao.patch` registra o delta completo instalado, inclusive a adaptação ao
contrato de leitura compartilhada que existe na versão atual do Dell.

Conferência final às 12h52 de São Paulo: executor e hashes coincidem com a
versão v3, Central e timer ativos, 26 Sites e 6 contatos de Íris prontos, nenhuma
Estamparia pronta sem qualificação. Os cinco primeiros prontos são Sites. A API
retorna 33 justificativas estruturadas no retrato, incluindo resultado já
registrado. Candidatos prontos continuam sujeitos a expediente, ritmo e última
conferência antes do envio; isso não promete envio nem venda.
