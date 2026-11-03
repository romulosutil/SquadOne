# Organização da Prumo no SquadOne

A fonte oficial é [prumo/00-contexto/organizacao.md](https://github.com/romulosutil/prumo/blob/main/00-contexto/organizacao.md), também disponível no checkout irmão `../prumo/00-contexto/organizacao.md`. Leia essa fonte antes de criar nomes, oferta, serviço ou fluxo.

No Dell: `~/prumo/00-contexto/organizacao.md`. A cópia operacional fica em `~/.local/share/prumo-contexto/organizacao.md`, acompanhada do hash da origem em `contexto.json`. O contexto dos workflows é mantido por `prumo-contexto.timer` e pelo hook permanente do `n8n.py`. Não editar cópias manualmente.

Publicações de Site e Raio-X passam pela trava `deploy/dell/lib/qualidade_prumo.py`: prévias são identificadas como homologação; entrega Profissional exige 100% dos obrigatórios, IQS completo, referência e manifesto exato. O aceite não fica na pasta gravável pelo gerador.

## Apresentação institucional e objetivos comuns (30/10/2026)

A apresentação institucional revisada fica no checkout irmão, em [`prumo/04-venda/apresentacao/`](../../../prumo/04-venda/apresentacao/README.md). Os objetivos comuns estão na fonte oficial [`prumo/00-contexto/negocio.md`](../../../prumo/00-contexto/negocio.md), seção “Objetivos compartilhados com o SquadOne”. Não manter uma cópia da apresentação neste repositório.

A Prumo define público, oferta, preço e qualidade da entrega; o SquadOne sustenta descoberta, CRM e acompanhamento com evidências e próximos passos. A apresentação distingue trajetória profissional de Rômulo, operação interna documentada, piloto da Fonte em homologação e demonstração fictícia. O CRM operacional do SquadOne não é o CRM de estamparia do portfólio.

Site/Encontrado conserva a prioridade entre candidatos aprovados registrada em 26/10. A decisão da Prumo de 28/10 sobre o custo de vender produtos de volume individualmente também permanece: prioridade da fila não comprova margem ou melhor canal. Avaliar conversa qualificada, proposta, aceite, recebimento, ciclo e margem quando houver dados de custos e horas. Produtos por assinatura têm caminho próprio, e o CRM de estamparia exige a qualificação já definida. A atualização de 30/10 corrige as fontes de descrição do guia e reutiliza `CONCEITO_PRUMO` no Assistente e no copiloto. O conceito canônico de `prumo/00-contexto/organizacao.md` acompanha os workflows pelo sincronizador existente. Preços, passos da jornada, cadência e autorizações de contato permanecem vigentes.

