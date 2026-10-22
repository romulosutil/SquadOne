# Organização da Prumo no SquadOne

A fonte oficial é [prumo/00-contexto/organizacao.md](https://github.com/romulosutil/prumo/blob/main/00-contexto/organizacao.md), também disponível no checkout irmão `../prumo/00-contexto/organizacao.md`. Leia essa fonte antes de criar nomes, oferta, serviço ou fluxo.

No Dell: `~/prumo/00-contexto/organizacao.md`. A cópia operacional fica em `~/.local/share/prumo-contexto/organizacao.md`, acompanhada do hash da origem em `contexto.json`. O contexto dos workflows é mantido por `prumo-contexto.timer` e pelo hook permanente do `n8n.py`. Não editar cópias manualmente.

Publicações de Site e Raio-X passam pela trava `deploy/dell/lib/qualidade_prumo.py`: prévias são identificadas como homologação; entrega Profissional exige 100% dos obrigatórios, IQS completo, referência e manifesto exato. O aceite não fica na pasta gravável pelo gerador.
