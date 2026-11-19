# Estado atual do SquadOne

Última conferência da Central e dos canais em 18/11/2026, às 22h04 de São Paulo,
no Dell (Mel), com build `ca64d12`. As outras áreas abaixo refletem a
conferência das 19h06, salvo indicação.
Foram consultados a API do n8n, o systemd e os registros locais em modo de
leitura. [RULES.md](RULES.md) registra as autorizações.

## Implantação da retirada

A [PR 121](https://github.com/romulosutil/SquadOne/pull/121) foi mesclada na
`main`. O atualizador do Dell terminou às 18h11min05s. O checkout e o marcador
do build apontavam para `dbc94901b2accd04ff38203b41e17bf444874530`. As cópias
do monitor e do instalador da Medição correspondiam ao código implantado.

O executável e as duas unidades da coleta mensal das skills continuam
retirados, com duas fotos históricas preservadas. O aviso privado da Fonte
continua arquivado no n8n e a Fonte com IA segue pausada. A conferência
após a implantação usou consultas e registros existentes, sem disparos de teste.

## O que opera hoje

| Área | Estado conferido | Onde confirmar |
| --- | --- | --- |
| App de squads e agenda | O app remoto tem perfil próprio. No Dell, o app completo fica em `/squadone`. | [Perfis no ABOUT](ABOUT.md#perfis-de-execução). A instância remota ficou fora desta conferência. |
| Central no Dell | O serviço `squadone-operations` estava ativo. No build observado às 22h04, `/` abre o Escritório e o CRM abre em uma folha em `/crm`. A atualização de carteira abaixo está validada em ambiente isolado. | Estado da unit e [guia do Dell](deploy/dell/README.md). |
| WhatsApp comercial | Agenda do n8n a cada 2 minutos, todos os dias. O Dell executa a reposição e o primeiro contato, com transporte pela Evolution. O registro local confirmou **10 envios no dia**. A frente informou `limite-do-dia` e 10 recibos distintos coincidiram por ID com saídas capturadas e com fichas do CRM. | Estado da frente, registro de envios e [n8n](ops/n8n/README.md). |
| LinkedIn comercial | Agenda do n8n a cada 10 minutos, todos os dias. A execução `136089`, das 19h20, confirmou duas consultas, sem candidato elegível e zero envios. A execução `136425`, das 22h00, entregou o pedido e o executor registrou pausa. O ledger estava sem reservas e envios. | Ledger e histórico do worker no Dell. [LinkedIn no Dell](ops/n8n/README.md#linkedin-no-dell). |
| Respostas comerciais | Rômulo assume as respostas. A política operacional do Dell estava em `primeiro-contato`, com `respostasAutomaticas: false`. | Política privada do runtime e [regras atuais](RULES.md). O arquivo [versionado](config/aquisicao-comercial.json) é o padrão de instalação pausado. |

O teto autorizado é de **até 10 primeiros contatos elegíveis por canal por dia de
São Paulo**. Reservas e deduplicação continuam valendo. A agenda confirma a
entrega de um pedido ao Dell. O recibo da Evolution ou o ledger do LinkedIn
confirma o envio.

## n8n

Após a retirada de 18/11 às 18h01, o inventário da Mel mostrou **25 workflows:
8 ativos, 16 arquivados e 1 inativo fora do arquivo**. O inventário foi
reconfirmado às 19h06. Os timers antigos da frente e da reposição estavam
desabilitados. O WhatsApp recebe a agenda pelo `whatsapp-agenda.path` e o
timer `linkedin-agente` consome pedidos da agenda do LinkedIn.

| Workflow | Evidência e uso |
| --- | --- |
| CRM | A Central respondeu HTTP 200, com retrato das 19h00 e seis fontes exibidas sem erro. |
| Entrada WhatsApp | Último sucesso salvo às 19h05. As 16 recusas de permissão ocorreram até 11h13 em um nó retirado do grafo ativo. O relatório rastreou oito execuções ao mesmo registro de leitura e confirmou no CRM marcos iguais ou posteriores. As demais ficaram sem reconciliação individual. |
| Agenda WhatsApp | Pedido entregue às 19h04. O registro do dia tinha dez envios confirmados. |
| Agenda LinkedIn | Pedido entregue às 19h00. O ledger do dia ainda estava zerado. |
| Pesquisa de empresas e Pesquisa diária para WhatsApp | A rodada agendada de pesquisa e higiene gerou retrato às 18h10. O relatório da validação no Dell confirmou HTTP 200 na entrada RSS sob demanda, com duas consultas concluídas. Também confirmou a execução do relatório diário, com saída gravada, zero mensagens e zero alterações comerciais. |
| Avisar falha pelo Hermes | Fluxo geral ativo. A fila estava vazia às 19h06 e o último aceite registrado do Telegram era das 17h29, sem falhas consecutivas. A via direta do n8n tem o registro de sucessos desabilitado. |
| Medição de eventos | Painel privado respondeu HTTP 200 com dados das 19h05. A lista de origens autorizadas continua publicada pelo workflow. |
| Fonte — falha sem dados | Arquivado às 18h01. A Fonte com IA, já pausada, era o único workflow que o referenciava. O aviso sanitizado e a referência foram preservados. |

O sincronizador `prumo-contexto.service` registrou execução bem-sucedida às
19h03. Os consumidores, os IDs, as fontes e a reversão da pausa ficam no
[guia do n8n](ops/n8n/README.md#auditoria-de-consumidores--18112026).

## Recuperação e pendências

O ensaio isolado restaurou 48,6 GB e terminou às 17h09. Conferiu o PostgreSQL
do n8n, a decifragem de suas credenciais e a integridade de bancos do Hermes.
O snapshot registrou 12,01 GB novos antes da compactação e 1,03 GB
compactado. O próximo cofre agendado é a primeira rodada prevista para
registrar ambos os valores no monitor. O alerta de volume continua aberto.

A entrega da Visão semanal segue por confirmar em 23/11 às 08h30. No
Easypanel, a conexão real ao Google Calendar e a persistência após redeploy
dependem de conferência pelo acesso autorizado.

## Hermes

| Componente | Utilidade observada | Estado após a conferência |
| --- | --- | --- |
| Runtime e perfil `prumo-linkedin` | Na janela da auditoria até 17h45, houve 42 rodadas, 275 chamadas de modelo e zero contatos confirmados. | Ativo, com perfil dedicado. |
| Gateway | A ponte respondeu `connected` e sustenta a captura do observador. A frente comercial do WhatsApp envia pela Evolution. | Ativo. |
| Assistente da Central | Integração Hermes habilitada, zero solicitações ao Assistente no dia e ausência de arquivos de uso do Hermes. | Disponível. A flag da integração é lida quando a Central sobe. |
| Dashboard e navegador Google | Ambos responderam às sondagens. O monitor do Dell consulta os dois. O LinkedIn usa um navegador separado. | Ativos. |
| Visão semanal | Produziu o relatório local de 16/11 com sete chamadas de modelo. A entrega pelo WhatsApp falhou. | Cron mantido. |
| Foto mensal de skills | Duas fotos históricas. A auditoria encontrou o produtor e referências de manutenção. O contador nativo funciona separadamente. | Executável, serviço e timer retirados às 18h01. As fotos e as cópias removidas foram preservadas. |

[Uso, custo e reversão da pausa](docs/revops/hermes.md#uso-e-custo-por-função--18112026) ·
[Operação do LinkedIn](ops/n8n/README.md#linkedin-no-dell) ·
[Integração com o Assistente](server/hermes-consulta.ts)

## Parecer para a Prumo

**Recuperar o núcleo em etapas.** A Prumo pode usar a Central para acompanhar
a carteira, os primeiros contatos confirmados e as respostas que Rômulo assume.
A atualização do CRM e os caminhos de pesquisa precisam de diagnóstico antes
de depender deles sem supervisão. O projeto acumulou funções e gerações de
automação demais para o fluxo comercial atual. Uma reversão ampla arriscaria
perder correções de identidade, captura e deduplicação. Uma reescrita também
teria de migrar a carteira, os registros, os webhooks e a operação que já
funciona. Se um componente falhar repetidamente depois de isolado, avaliar
substituí-lo com os contratos existentes.

**Qualidade na prática.** Preservar a passagem humana, a identidade da conversa,
a deduplicação e o vínculo entre ação e recibo. A Central precisa mostrar
qual trabalho exige atenção, quem assume, qual evidência sustenta o estado
e quando a fonte ficou desatualizada. No n8n, cada workflow precisa ter uma
função clara, consumidor identificado e falha que o operador consiga
diagnosticar. Considerar o núcleo recuperado quando, em um ciclo natural,
o CRM atualizar, uma entrada aparecer na carteira certa, os registros do
executor baterem com o painel e uma falha observada chegar ao responsável.

## Central da Prumo em revisão

A implementação abre a carteira em `/` com o recorte **Precisa de atenção**.
A ficha preserva a passagem humana, o histórico e os bloqueios. A aba Primeiros
contatos distingue a agenda, os recibos e os resultados incertos. A retirada
da tela imersiva vale para o percurso padrão da Prumo. O perfil app e a rota
direta `/squadone` preservam a gestão de equipes.

O retrato natural de WhatsApp confirmou os dez recibos do dia e a passagem
de uma resposta humana à ficha única e à fila de Rômulo. O LinkedIn apresentou
uma busca concluída com zero envios. A PR está validada em ambiente fictício.
A implantação na Mel e a conferência de um ciclo natural na interface nova
ficam para depois da revisão. O especialista do n8n confirmou os comprovantes
novos às 22h18 no WhatsApp e às 22h20 no LinkedIn.

[Fluxos, evidências e procedimento de reversão](docs/referencia/central-prumo.md).

## Manutenção deste documento

- Registre decisões em [RULES.md](RULES.md) e atualize esta página ao confirmar
  no Dell uma mudança de cota, agenda, integração, responsável, pausa ou deploy.
- Informe data e fuso, commit implantado e evidência do resultado. Uma entrega
  de agenda confirma o pedido ao executor. Use o recibo do canal para atualizar
  a contagem de contatos.
- Atualize o guia do componente quando mudar o procedimento de operação ou
  reversão. Use o [catálogo histórico do n8n](ops/n8n/CATALOGO.md) para rastrear
  contratos e chamadores antigos.
