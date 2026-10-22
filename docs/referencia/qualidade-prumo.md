# Qualidade da Prumo executada pelo SquadOne

A fonte dos critérios e avaliações é `prumo/06-qualidade/`. O SquadOne é o executor, mesmo estando acima na hierarquia operacional. A régua, a oferta e o aceite pertencem à Prumo. Não duplicar percentuais ou checklists no executor.

O adaptador `SquadOne/scripts/prumo-qualidade.py` chama o avaliador canônico. A origem do adaptador está em `prumo/06-qualidade/integracoes/squadone-qualidade.py`. Seu código de saída é preservado; falta de fonte é bloqueio, nunca aprovação.

```powershell
python scripts/prumo-qualidade.py --prumo ../prumo --validar
python scripts/prumo-qualidade.py --prumo ../prumo --relatorio
python scripts/prumo-qualidade.py --prumo ../prumo --liberar ID-DA-AVALIACAO
```

O adaptador atende à consulta manual. Nos caminhos automáticos de Site e Raio-X, a biblioteca `deploy/dell/lib/qualidade_prumo.py` executa `publicacao.py` diretamente sobre o pacote final, antes da chamada à Vercel. O runner registra a fase no recibo; o agente que desenha não publica diretamente. Homologação recebe identificação visível e não é entrega Profissional.

## Evidências que o executor deve produzir

| Requisitos | Responsabilidade do SquadOne | O que volta para a Prumo |
|---|---|---|
| RX02 | Reproduzir diagnósticos e conferir cópia de modelos/preços | Registro dos comandos, versão/commit, resultado e divergências resolvidas |
| MP01 | Correlacionar formulário à empresa/dono e tratar repetição | Casos de identificação ausente, duplicação, resposta nova e pacote completo |
| C03/C04/FN01 | Testar implementação, permissões, repetição, erros e recuperação | Registro de homologação e workflow sanitizado, sem credenciais |
| AC02/AC04 | Medir primeira resposta útil e continuidade com eventos observados | Amostra anonimizada com início/fim, pausas e resultado; abrir WhatsApp não prova envio |
| ED02/ED04/ED05 | Testar jornada, acesso, teclado e recuperação | URLs/versão, tarefas, falhas, alertas e recuperação testados |
| SA01–SA04 | Apoiar o responsável de cada SaaS | Evidência do produto correto, não do CRM interno do SquadOne |

Ausência de evidência permanece visível como não verificado. O monitor ou o agente não pode preencher aceite humano, simular conversa ou inferir saúde pelo silêncio.

## Integração produtiva

Cada publicação identifica produto, referência pseudonimizada, versão calculada do pacote e todos os arquivos que está prestes a entregar. O avaliador consulta as fontes atuais antes da ação; ausência, alteração ou vencimento de evidência bloqueia a entrega Profissional. Uma avaliação de outra referência/versão ou manifesto parcial também é rejeitada. Se a fase solicitada for Profissional, falha não vira homologação silenciosamente.

As avaliações de aceite ficam em `~/.config/prumo-qualidade/entregas/<referencia>/<produto>.json`, fora da pasta gravável pelo gerador. O candidato `.prumo-candidato-<produto>.json` nasce sem aprovação e precisa de revisão do responsável. O Mapa continua gerando rascunhos sem envio automático. Novos publicadores devem usar a mesma biblioteca antes do deploy; uma integração SaaS externa ao SquadOne não é presumida protegida por ela.

O guia canônico é compartilhado com o executor por `docs/referencia/organizacao-prumo.md`. No Dell, `prumo_contexto.py` injeta a origem, hash e conteúdo em cada entrada dos workflows comerciais e seus subworkflows. O hook do `n8n.py` mantém o contexto nas reconstruções e `prumo-contexto.timer` o confere a cada 15 minutos. O estado ativo/inativo de cada fluxo é preservado. Os nós Code acessam `$getWorkflowStaticData('global').prumo_contexto`; dados do cliente não são acrescentados a esse contexto.

O relatório serve para consulta. Uma integração deve executar `--liberar` novamente; o JSON gerado anteriormente pode estar vencido ou referir-se a outra versão.
