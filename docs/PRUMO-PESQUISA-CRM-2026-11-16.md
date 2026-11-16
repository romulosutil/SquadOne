# Base de pesquisa para a reconstrução comercial

Pesquisa em 16/11/2026 para orientar o [plano decisório](PRUMO-RECONSTRUCAO-COMERCIAL-2026-11-16.md). Conclusão: há capacidade técnica e portfólio, mas a operação ainda precisa demonstrar contratação, recebimento e repetição econômica. A evidência não autoriza eleger um produto vencedor nem concluir que não existe mercado.

## Fatos internos e alcance

| Evidência | Fato observado | Limite |
|---|---|---|
| [Retrato do CRM](../outputs/analise-negocio-20261116/evidencias.json) | 3.622 relações de oferta/canal; duas propostas atuais; zero ganhos registrados; zero eventos de ciclo comercial estruturado na consulta | Não são empresas únicas; não comprova inexistência de pagamento fora do CRM |
| Mesmo retrato | Envios marcados: Site 377, Prumo 59, Íris 41, estampa 37, Plus 2 | Coortes distintas; respostas humanas sinalizadas não são auditoria integral nem intenção de compra |
| [Auditoria operacional complementar de 16/11](../outputs/reconstrucao-crm-20261116/auditoria-cadencia.json) | Em 13/11, 49 marcos de primeiro envio nas quatro fontes auditadas: 1 às 15h, 28 às 16h e 20 às 17h, horário de São Paulo | Não representa mensagens totais da conta, follow-ups ou todos os destinatários; não confundir com 28 recibos de outra janela histórica |
| Relato do usuário | Softban do WhatsApp por spam após os disparos de sexta-feira, 13/11 | A consulta técnica observou desconexão; não mediu limiar interno nem regra de decisão da Meta |
| Auditoria operacional complementar | Frente com `ativo=false`, timer ativo e manifesto de campanha com `ativo=true` | Pausa em uma configuração não prova bloqueio persistente de todos os emissores |
| [Foco de 13/11](referencia/foco-comercial-2026-11-13.md) | Site priorizado; implantação de IA sob diagnóstico/proposta; protótipos fora da prospecção geral | Prioridade operacional não comprova demanda, margem ou canal adequado |

Não atribuir causalidade comercial às diferenças entre as ofertas: públicos, tempos, mensagens e estados não são comparáveis. O incidente demonstra a necessidade de controlar o canal; não prova, sozinho, que o preço ou o produto causou a baixa conversão.

A [nova projeção aplicada em memória ao retrato de 16/11 às 11h40](../outputs/reconstrucao-crm-20261116/carteira-projetada.json) encontrou três oportunidades documentadas: duas em revisão e uma encerrada; três marcos históricos de proposta, zero contratação estruturada e zero recebimento confirmado. Identificou 1.807 contas provisórias e 109 vínculos com participação humana sinalizada. Sem qualificação e responsável confirmados no contrato estruturado, não promover essas conversas a negócios ativos. A projeção preserva os cadastros e não comprova fatos fora das fontes.

## Fontes canônicas internas

- [Organização da Prumo](../../prumo/00-contexto/organizacao.md): consultoria e produtos digitais; provas com origem e estado explícitos; SquadOne como operação interna.
- [Negócio](../../prumo/00-contexto/negocio.md): posicionamento, público, jornada, método e lacunas de entrega. Registra Respondido/Acompanhado sem construção para cliente à época; experiência interna não equivale a oferta universal pronta.
- [Portfólio](../../prumo/00-contexto/produtos.md): Íris com faturamento homologado historicamente e pendências de confirmação; estamparia com aceite/go-live dependentes; demais produtos em protótipo ou ideia. Estados documentais exigem atualização por evidência da versão atual.
- [Decisões](../../prumo/00-contexto/decisoes.md): preservar histórico e marcar substituições; a exceção de descoberta de pilotos de 30/10 não os promove a produtos prontos.
- [Tabela de preços](../../prumo/04-venda/piloto-cdl/precos.json): Site R$ 690 + R$ 39/mês; produtos sob medida a partir de R$ 2.400 + R$ 290/mês; Fonte a partir de R$ 1.500. Não alterada.
- [Regras do repositório](../RULES.md) e [perfis operacionais](referencia/perfis-e-experimentos.md): histórico de aquisição, permissões, captura, copiloto e modelos. Regras antigas precisam de substituição explícita nas fontes executáveis.

## Evidência externa primária

### WhatsApp é canal relevante e condicionado à permissão

A [política oficial do WhatsApp](https://business.whatsapp.com/policy), consultada em 16/11 e marcada como atualizada em 23/09/2026, exige número fornecido pelo destinatário e opt-in para mensagens subsequentes. Exige respeito à recusa e permite limitar/remover acesso por violação. A Platform acrescenta templates aprovados e janela de 24 horas para respostas sem template. Isso sustenta aquisição consentida; não oferece fórmula de volume seguro nem justifica contornar restrições com outras contas.

A [Pulso 2026 divulgada pelo Sebrae](https://agenciasebrae.com.br/dados/whatsapp-se-consolida-nas-vendas-on-line-enquanto-facebook-e-lojas-proprias-perdem-folego/) informa WhatsApp como principal canal de comunicação/vendas para 82% dos respondentes e ferramentas on-line de venda em 73%; ouviu mais de 8,2 mil empreendedores em fevereiro e março. Adoção não comprova disposição a contratar a Prumo. O recuo de lojas virtuais próprias é contraponto à tese de necessidade universal de site; loja virtual não é sinônimo de site institucional.

**Implicação proposta:** implantar melhor atendimento pode ser relevante, mas a necessidade deve ser demonstrada. Usar WhatsApp na operação do comprador não implica aceitar prospecção fria nesse canal.

### Descoberta conduzida pelo fundador

Na [apresentação de Eric Migicovsky para a YC](https://yc-startup-school.relayto.com/e/how-to-talk-to-users-rmdawvc59tr6j), a descoberta busca episódios reais, alternativas utilizadas, frequência, consequência, orçamento e autoridade. Recomenda conexão direta do fundador com usuários. É orientação de prática, não estudo causal de conversão de serviços brasileiros; não importar metas de product-market fit do material para esta amostra.

[Paul Graham](https://paulgraham.com/ds.html) descreve recrutamento manual e proximidade com os primeiros usuários como mecanismos de aprendizagem e início de aquisição. Sustenta conversas dirigidas antes de escalar, não uma autorização para trabalho gratuito ilimitado nem evidência de que toda venda consultiva será rentável.

**Implicação proposta:** Rômulo entrevista e vende; os agentes reduzem preparação e registro. O custo de aprender deve ser separado do custo repetível de vender.

### Compromisso vale mais que opinião

A [Strategyzer](https://www.strategyzer.com/library/ways-to-test-your-value-proposition-and-business-model) distingue o que pessoas dizem do que fazem e alerta que a presença do pesquisador altera comportamento. Entrevistas ajudam a descobrir experiências; compra e uso verificam hipóteses mais fortes. A recomendação de combinar evidências não fornece uma taxa universal de aprovação.

**Implicação proposta:** próximo passo assumido, acesso ao processo, proposta, aceite, pagamento e adoção são evidências diferentes. Um “gostei” ou “mande o material” não confirma necessidade nem compra. Os cortes numéricos do plano são critérios propostos, revisáveis e anteriores ao resultado, não números extraídos da fonte.

### Economia do canal e possibilidade de produto

[David Skok](https://www.forentrepreneurs.com/startup-killer/) relaciona custo de aquisição à capacidade de monetizar: aquisição inclui venda/marketing e a margem precisa considerar instalação, serviço e suporte. Os valores e referências SaaS do artigo pertencem a outros contextos; não calcular a margem da Prumo com esses benchmarks.

O [relato da Basecamp](https://basecamp.com/about) descreve um produto nascido do trabalho de web design e da demanda dos clientes. A empresa abandonou serviços quando a receita do produto os superou. É caso individual sujeito a viés de sobrevivência, não prova de que projetos sob medida sempre originam SaaS rentável.

**Implicação proposta:** medir custos e horas desde o primeiro contrato; productizar somente após repetição demonstrada. Serviços podem continuar sendo o negócio principal. Produto próprio pode ganhar foco quando prontidão, demanda e economia o justificarem.

## Hipóteses e contrapontos que precisam permanecer vivos

As referências de produto também sustentam separar pesquisa de negócio: o [Leads Inbox do Pipedrive](https://support.pipedrive.com/en/article/leads-inbox) mantém contatos ainda não qualificados fora do pipeline; suas [atividades](https://support.pipedrive.com/en/article/activities) registram ações associadas a pessoas, organizações, leads ou negócios. O [modelo de associações do HubSpot](https://knowledge.hubspot.com/records/associate-records) preserva registros distintos e seus vínculos; seus [estágios de ciclo de vida](https://knowledge.hubspot.com/records/use-lifecycle-stages) categorizam contatos/empresas e distinguem oportunidade de cliente. São referências de modelagem, não recomendação de migração nem prova de conversão. Negócio fechado não equivale a pagamento confirmado; separar recebimento é decisão própria da Prumo. Nenhuma dessas fontes justifica fundir empresas por telefone.

| Hipótese de trabalho | Evidência contrária ou risco | Como distinguir |
|---|---|---|
| Site é boa entrada | Negócio pode vender bem com perfil, indicação e WhatsApp; personalização gratuita consome margem | Necessidade confirmada, pagamento e horas integrais por contrato |
| Automação de orçamento é valiosa | Pode faltar demanda; ferramenta nativa pode bastar; processo ainda instável | Observar casos reais e testar a menor mudança eficaz |
| Serviço antes de SaaS reduz risco | Sob medida pode prender o fundador em projetos irrepetíveis | Comparar escopo, horas, suporte e núcleo comum em entregas pagas |
| Prumo precisa ser vendida antes da oferta | Explicação institucional pode adicionar uma etapa sem valor ao comprador | Começar pela necessidade; usar marca e provas para sustentar confiança |
| Produtos de nicho merecem menos foco | Íris ou estamparia podem possuir dor mais específica e melhor acesso ao comprador | Avaliação dirigida de prontidão e compromisso, sem campanha ampla antecipada |
| Indicação/parceria é melhor canal inicial | Rede pode ser pequena, favorecer elogios e exigir comissões/esforço alto | Registrar origem, comprador real e custo total; não presumir canal gratuito |

Os dados não sustentam trocar toda a empresa por uma nova marca, elevar preços, descartar permanentemente os pilotos ou perseguir apenas Site/IA. Sustentam um corte temporário de aquisição, compromisso verificável e expansão guiada por entrega e dinheiro recebido.
