# Integração PC/Dell e atualizador — 16/11/2026

> As restrições de aquisição abaixo se referem à janela de implantação de
> 16/11. A retomada e a troca das agendas estão no
> [Estado atual](../ESTADO-ATUAL.md).

A integração parte da main e das fontes vigentes do Dell. Incorpora as melhorias
compatíveis do PC e conserva as versões anteriores em snapshots e backups Git.
Inclui a carteira comercial, o plano do dia, a distinção entre tarefas internas e
fatos financeiros, responsabilidade v2, capturas duráveis e a direção comercial
da Prumo. ACK de gravação não representa confirmação de proposta ou recebimento.

O atualizador valida o commit candidato em uma área isolada. Exige aquisição
bloqueada, campanhas inativas e timers de aquisição/prospecção desativados antes
e depois da troca. Só faz fast-forward com checkout sem alterações rastreadas;
arquivos não rastreados que colidem impedem o avanço. Um marcador identifica o
commit realmente construído e verificado, permitindo retentar falhas de build.

O bootstrap instalado executa `deploy/dell/atualizar_central.py` do checkout.
Não há liberação de disparos, reconexão do WhatsApp ou instalação geral de
serviços. Falhas ficam no journal, sem enfileirar mensagens. Estado de ocupação
incerto ou central ocupada impede interrupção do processo. A consulta não reserva
a admissão de novas tarefas: há nova conferência imediatamente antes da parada.

Mudanças apenas em Markdown têm validação do candidato sem reinício. Dependências
são reutilizadas quando os mapas não mudam; quando necessário, são instaladas em
staging e trocadas junto do build. A recuperação preserva backups e usa
`git reset --keep` somente se o checkout permanecer no estado esperado, sem
sobrescrever edições concorrentes. Trabalho ativo ou estado ambíguo impede parada
forçada para recuperação. Uma interrupção abrupta durante a troca exige conferir
os backups e o serviço antes de prosseguir.

A reativação autorizada é exclusivamente `atualizar-central.timer`. Os timers
`frente-comercial.timer` e `prospeccao-diaria.timer`, a frente e a campanha vigente
continuam desativados. O bloqueio de aquisição também existe na reserva Node e no
transporte Python, sem liberação por configuração ou simples reconexão.

As evidências e os identificadores do commit, backups, validação e estado final
ficam em `outputs/integracao-pc-dell-20261116/`, fora do versionamento de fontes.
