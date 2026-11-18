# Hermes na operação de RevOps e Sales Ops

O [Estado atual](../../ESTADO-ATUAL.md#hermes) reúne as decisões operacionais.

## Uso e custo por função — 18/11/2026

Janela de 12/11 às 00h até 18/11 por volta de 17h45, no fuso de São Paulo.
A conferência usou contagens agregadas de sessões, registros de rodadas,
estado do systemd e consultas GET de saúde. O custo dos modelos aparece como
incluído na assinatura, com estimativa de US$ 0,00 e sem valor faturado
registrado por sessão. A memória é uma amostra das units no Dell.

| Função | Uso e resultado | Custo observado e decisão |
| --- | --- | --- |
| LinkedIn | 42 rodadas: 38 sem candidato, 3 bloqueadas e 1 aguardando login. Zero contatos confirmados no ledger. | 38 sessões de modelo, 275 chamadas, 863.323 tokens de entrada e 13.055 de saída. 41 logs somaram cerca de 26 minutos entre criação e última escrita. Runtime mantido para o executor dedicado. |
| Assistente da Central | O GET confirmou a integração Hermes habilitada e zero solicitações no dia. A pasta efetiva da Central não tinha contador de consultas Hermes nem arquivo de último uso. | Sem custo de modelo registrado para a integração. A flag é lida na inicialização da Central. A conferência manteve a disponibilidade do serviço. |
| Gateway de WhatsApp | A ponte respondeu `connected` e sustenta a captura do observador. O banco tinha 84 registros com papel `assistant` em uma sessão WhatsApp na janela. | Cerca de 342 MiB na amostra, sem custo de modelo isolado disponível. Gateway mantido. |
| Dashboard | A rota de saúde respondeu HTTP 200 e é consultada pelo monitor do Dell. Uso humano da interface sem contagem. | Cerca de 208 MiB na amostra. Mantido com a dependência de monitoramento. |
| Navegador Google | O CDP respondeu com uma página vazia na sondagem. O monitor acompanha este navegador. O LinkedIn usa outro. | Cerca de 11 MiB na amostra. Uso histórico de coletas sem contagem. Serviço mantido com a dependência de monitoramento. |
| Visão semanal de receita | Um turno na janela e cinco relatórios locais desde 19/10. O relatório de 16/11 foi gravado, com última entrega pelo WhatsApp em `delivery_failed`. | 7 chamadas, 53.289 tokens de entrada e 2.033 de saída. Rotina mantida pela produção do relatório. |
| Socorro | Duas sessões associadas ao diretório do Socorro. O medidor registrou uso em 16/11. | 2 chamadas, 39.307 tokens de entrada e 935 de saída. Mantido para diagnóstico de falhas. |
| Fonte com IA | Fluxo n8n já pausado. Último arquivo de uso datado de 22/10. | Sem chamada recente comprovada. |
| Foto mensal de skills | Duas fotos preservadas. A auditoria das fontes e das unidades instaladas não encontrou leitor automatizado das fotos. O runtime mantém o contador nativo. | Coleta local, sem modelo ou rede. Timer desabilitado às 17h47. |

O perfil principal também registrou nove sessões avulsas com 47 chamadas
e uma sessão desktop com três chamadas. A auditoria não atribuiu a finalidade
individual dessas sessões.

A conferência após a pausa mostrou o timer `hermes-uso-skills.timer` desabilitado,
as duas fotos preservadas e gateway, painel, navegadores e Central em operação.
As unidades e o recibo estão em
`~/.local/state/squadone-hermes-pausas/20261118T204723-738807Z/` no Dell.
Às 18h01, o código de retirada do atualizador moveu o executável e as duas
unidades para `~/.local/state/atualizar-central/retiradas/hermes-uso-skills/`.
O monitor reconhece o recibo para evitar cobrar a cópia retirada durante a
transição do manifesto. As fotos permanecem no diretório histórico. Para
reverter, restaurar os três arquivos a partir do backup, remover o marcador
`concluido`, alinhar a reversão no repositório e então recarregar o systemd
do usuário e habilitar o timer. A verificação ocorreu sem iniciar turnos ou
disparar mensagens de teste.

## Contrato de leitura — revisão de 25/10/2026

O Hermes é o secretário de leitura, diagnóstico e explicação; não é outra base comercial ou fechador. A disponibilidade qualitativa do Rômulo está confirmada e não foi convertida em horas, prazos ou permissão de envio.

## Como usar

Para “como fazemos vender e funcionar?”, o Hermes deve começar pelo modelo geral **Como vender e operar**, acessível em Configurações e no topo de Vendas. Explica oferta/limites, passagens, rotina, capacidade, indicadores e critérios de automação. Uma pergunta geral não deve terminar só numa lista de leads.

Para uma oportunidade, usa a skill `conversa-do-lead` e o leitor instalado `python3 ~/.hermes/scripts/ler_comercial.py`, com seleção `--nome` ou `--referencia` quando necessária. O CLI aceita somente esses argumentos, faz GET fixo à Central, não segue redirecionamento e recusa fonte antiga/contrato inválido. A seleção ambígua não é resolvida por memória ou nome parecido.

A resposta útil contém fonte/frescor, estado ou regra, evidência/lacuna, próxima ação interna, responsável e condição de conclusão/espera. A ficha vem da fonte da Central; o Hermes não monta endereço ou cria uma fila paralela. A classificação de um modelo, o clique em link e o recebimento de aviso não confirmam qualificação, proposta, aceite ou pagamento.

## Contrato de execução e decisão

| Entrada | Hermes faz | Saída verificável | Quem decide/executa depois |
| --- | --- | --- | --- |
| Pergunta geral sobre vender/operar | Consulta e explica o modelo comum, sem reduzir a resposta a casos | Procedimento, autoridade e limite claros | Rômulo conduz a rotina; cada executor mantém seu contrato |
| Oportunidade identificada | GET atual e leitura de qualificação, ciclo, responsável e bloqueios | Fonte atual/indisponível, lacunas e próxima ação interna | Rômulo confirma fatos e condições na ficha |
| Fonte inválida ou contexto conflitante | Declara desconhecido, conserva restrições | Conferência específica solicitada, sem nova abordagem | Operador confere fonte e identidade |
| Preço, negociação, contrato ou pagamento | Encaminha a decisão com as lacunas existentes | Ficha e decisão necessária, sem valor inventado | Rômulo negocia, valida documento e confirma cada marco |
| Falha técnica | Diagnóstico do que foi observado | Sintoma, evidência e impacto para correção autorizada | Codex/Claude; Socorro somente no contrato próprio |

## Caminho da informação

```mermaid
flowchart LR
  Modelo[Como vender e operar] --> Hermes[Hermes: explica e sintetiza]
  CRM[Fontes comerciais e confirmações humanas] --> Central[Central: projeção atual]
  Central --> Leitor[GET fixo e sanitizado]
  Leitor --> Hermes
  Hermes --> Romulo[Rômulo: decide e conduz]
  Romulo --> Ficha[Registro humano na ficha existente]
  Ficha --> CRM
```

Não há seta de envio ou gravação automática do Hermes. O transporte Telegram/WhatsApp conserva seus próprios contratos e não recebe autorização nova por este modelo.

## Verificação realizada sem turno ou envio

- Gateway e painel estavam ativos na leitura de 25/10.
- Antes da alteração deste lote, SOUL e três skills instalados estavam iguais às fontes correspondentes do checkout Dell. Os alvos são `~/.hermes/SOUL.md`, `~/.hermes/skills/conversa-do-lead/SKILL.md`, `~/.hermes/skills/dell-operations-manager/SKILL.md` e `~/.hermes/skills/mapa-do-ecossistema/SKILL.md`.
- Leitor instalado igual ao fonte; consulta GET devolveu `somenteLeitura=true`, `contatoAutorizado=false`, fonte atual e lista sanitizada limitada a 20. Não foram retornadas conversas ou condições financeiras nesta auditoria.
- Token Google: seis escopos declarados `readonly`, arquivo 600. Isso não testa refresh/capacidade real das APIs nem a sessão do navegador.
- Cron: nove jobs, um habilitado. A leitura não alterou jobs nem copiou prompts. Ativo não é prova de resultado comercial.
- Configuração usa terminal local e presets `hermes-whatsapp`/`hermes-telegram`. O código desses presets inclui terminal, escrita/patch e cron; não há ferramenta `send_message` chamável diretamente nesses bundles, mas isso não prova impossibilidade de ação por outras capacidades.
- Serviço observado com `ProtectHome=no`, `ProtectSystem=no` e `NoNewPrivileges=no`. O papel comercial de leitura é uma regra operacional e não uma demonstração de sandbox completo.

## Instruções preparadas e carregamento sem reinício

O lote altera apenas quatro fontes versionadas: SOUL e as três skills acima. Elas passam a apontar o modelo geral da Central e distinguem procedimento geral de estado comercial atual. Não contêm cópia integral de catálogo, valores financeiros, horários de trabalhadores, transcrições ou nova base comercial. Papéis históricos desatualizados do SOUL foram ajustados para CRM/agenda da Central, n8n executor e Easypanel reserva fria.

A instalação deve comparar o baseline antes, guardar backup privado, substituir atomicamente e conferir hashes. Não precisa reiniciar o gateway para instalar arquivos. O código Hermes lê SOUL ao construir um agente fresco; a assinatura de cache não inclui mtime/hash de SOUL, e agentes já em cache conservam o prompt até renovação natural (idle TTL padrão de uma hora; sem override observado). Não se afirma recarga instantânea da sessão existente. A consulta `skill_view` lê o arquivo; seu dedup invalida por mtime/tamanho, e a descoberta tem TTL de 30 segundos. Aderência futura continua distinta da presença correta no disco.

Não executar turno, reset, reload ou mensagem de teste para “comprovar” carregamento. Reiniciar pode emitir aviso de desligamento; este lote preserva o gateway em execução. Próxima conversa legítima usa as instruções aplicáveis, e eventual sessão antiga é tratada com esse limite explícito.

## Falha, recuperação e aceite

Fonte indisponível é não verificada, nunca fila vazia. Identidade, pausa, recusa, espera, responsável humano e contexto atualizado continuam bloqueando ações incompatíveis. O operador mantém a decisão sobre condições, documento, cobrança e recebimento.

Aceite da área: modelo geral visível, leitor vigente sanitizado, alvos de instrução verificados e limites de autoridade/capacidade explícitos. Aderência numa interação natural exige observação futura sem fabricar evento. Isolamento completo de ferramentas não foi alterado por esta entrega e não é declarado concluído.

Reversão: restaurar somente as quatro instruções do backup após verificar mudanças posteriores; não alterar configuração, memória, cron, credenciais, ferramentas, serviços pessoais ou Silmer. A referência no painel pode voltar sem reescrever fatos do CRM.

## Implantação coordenada — 25/10/2026

A coordenação instalou as quatro instruções revisadas no Hermes e os mesmos fontes em `~/SquadOne`, com comparação dos hashes anteriores, troca atômica e backup privado em `~/.cache/mel-work/modelo-operacional-20261025/backup-hermes/`. Os quatro hashes finais conferiram. Gateway não foi reiniciado e nenhum modelo foi chamado; a construção de agente fresco ou a renovação natural do cache determina quando o SOUL novo entra em cada sessão. Não se declara recarga instantânea de sessões existentes.
