# Operação da Prumo

Revisão: 25/10/2026. Fonte do negócio, portfólio, promessa e qualidade. O SquadOne organiza a execução e conserva o CRM; não cria uma oferta comercial independente. Este procedimento é geral e não reescreve condições individuais, preços canônicos ou fatos de clientes.

## Como vender e fazer a entrega funcionar

1. Identificar a necessidade real e o público. A planilha de origem não escolhe a solução. Consultoria digital usa os diagnósticos quando adequados; produto próprio tem sua jornada e ficha.
2. Selecionar a menor entrega adequada no catálogo operacional. Separar família, modalidade comercial e situação da qualidade. `pronta` significa padrão comercial para qualificar/preparar proposta, não liberação de artefato.
3. Conferir fonte e versão de escopo/preço; preservar acordo individual confirmado. Íris conserva tabela marginal própria. Estamparia sem preço aprovado e incubação permanecem com suas lacunas; não preencher com o preço de outro serviço.
4. Fechar a proposta por compromisso: entregáveis, exclusões, dependências do cliente, custos externos, responsável, prazo e início, suporte e condição de cobrança. Disponibilidade qualitativa de Rômulo foi confirmada; nenhuma hora ou cota numérica é inventada.
5. Conferir conteúdo e versão do documento. Proposta preparada, envio, aceite, cobrança e recebimento precisam de evidências distintas. Orçamento sob medida não é autorização para iniciar ou cobrar.
6. Produzir o artefato no contrato autorizado, conferir os requisitos do produto e a referência/manifesto exatos. Gerador não aprova sua própria entrega. Homologação é identificada; Profissional exige obrigatórios e IQS comprovados.
7. Apresentar a entrega conforme a autorização e registrar o fato real. Para Site Encontrado, preservar cobrança somente após o cliente vê-lo funcionando no ar. Concluir escopo e aceite sem presumir pagamento.
8. Acompanhar suporte e manutenção conforme o contratado. Mudança de escopo, novo assunto ou dependência externa produz revisão e nova condição explícita; não ampliar o serviço por texto de apoio antigo.

## Fontes e versionamento

| Assunto | Fonte canônica | Uso pelo SquadOne |
| --- | --- | --- |
| Nomes, família e modalidade | `prumo/00-contexto/organizacao.md` e `glossario.md` | Rótulos e explicação do catálogo |
| Promessa e jornada | `prumo/00-contexto/negocio.md` e `decisoes.md` | Oferta, abordagem e limites de proposta |
| Preços de serviços | `prumo/04-venda/piloto-cdl/precos.json`, commit `114f9b306dd59e669477ebd9ebc79ae8af7ef793` | Consumidores e rascunhos com condição individual preservada |
| Produto próprio | `prumo/00-contexto/produtos.md` e sua ficha/repositório | Estado, público, titularidade, operação e suporte |
| Qualidade e entrega | `prumo/06-qualidade/README.md` e régua do produto | Referência, versão, manifesto, evidência e aceite próprios |
| Operação diária | `docs/revops/catalogo-operacional.md`, passagens e capacidade | Definição geral de leitura, sem nova base de clientes |

O catálogo derivado fica em `src/operations/modelo-operacional/catalogo.json`. As regras da área apresentadas no painel ficam em `area-prumo.json`. Não editar esses derivados para alterar um preço de negócio: a decisão e a fonte canônica vêm primeiro, seguidas da conferência dos consumidores. Histórico comercial real nunca é substituído por um novo catálogo.

## Correções de consumidor deste lote

- **Manutenção da Fonte:** o texto de `colinha.ts` prometia leitura dos números e conversa de 45 minutos. A fonte vigente é até dez mudanças por mês, feitas em até dois dias úteis após os trinta dias iniciais de ajustes; cancelamento conforme a condição canônica. A colinha passa a refletir esse escopo, sem acrescentar consultoria.
- **Mapa:** a frase “sem nenhum dado financeiro” não representava o método, que admite números aproximados relatados pelo dono. O consumidor agora explicita estimativas, sem extratos nem senhas. A devolutiva de 45 minutos do Mapa foi preservada, pois é parte dessa oferta.
- **Prazo de proposta:** `negocio.md` registra a regra interna de velocidade de até 24 h após abertura comercial. Essa meta foi preservada como orientação interna. Frases ao cliente deixam de prometer automaticamente 24 h ou amanhã: o prazo é combinado após conferir informações, escopo e compromisso. Não foi criada uma nova regra comercial nem imposto prazo a uma conversa histórica.

Nenhum preço, ID de oferta, tabela Íris, valor negociado, gatilho do Site, arquivo canônico da Prumo ou condição individual foi alterado. Scripts são sugestões revisáveis; não enviam mensagens.

## Exceções e dono da decisão

| Exceção | Ação | Evidência para avançar |
| --- | --- | --- |
| Fonte ou consumidor divergente | Rômulo usa a condição canônica/individual e o time corrige o consumidor | Fonte, versão e diff conferidos antes da apresentação |
| Escopo ou prazo em aberto | Preparar revisão interna e manter o campo desconhecido | Responsável, dependências e compromisso concreto confirmados |
| Artefato sem liberação | Conservar como rascunho/homologação, sem selo de produção | Checklist, versão e manifesto conferidos por quem aceita |
| Cliente aguardando ou recusou | Preservar espera/recusa e não gerar uma nova abordagem | Fato legítimo posterior e revisão humana coerente |
| Mudança, suporte ou atraso | Rever impacto e próximo compromisso, sem alterar silêncio ou histórico | Nova condição explícita e referência ao escopo anterior |

A disponibilidade de Rômulo permite conduzir o piloto; não autoriza prospecção, mensagens, negociação autônoma ou criação de fatos. Os agentes executam somente os contratos autorizados. Contratação, aceite, cobrança e recebimento permanecem decisões e evidências humanas.

## Validação e reversão

Testes do consumidor verificam manutenção conforme o catálogo, uso de estimativas no Mapa, ausência de promessa automática de 24 h nas frases de cliente e preservação dos valores/IDs. JSON tem o schema de área usado pelo painel e contém somente definições gerais, sem contatos ou conversas. Reversão é restrita aos arquivos deste lote; não restaura versões de catálogo sobre acordos existentes. Publicação e verificação visual do painel são registradas pela integração coordenada.
