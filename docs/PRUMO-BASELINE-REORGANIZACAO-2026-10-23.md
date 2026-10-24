# Baseline técnico da reorganização PRUMO — 23/10/2026

## Escopo e método

Levantamento somente de leitura feito nesta sessão, com acesso SSH à Mel e GETs locais da API do n8n. O primeiro acesso no sandbox falhou por resolução de nome; o acesso de leitura com a permissão de rede apropriada funcionou.

Não houve execução de modelo, envio de mensagem, disparo de workflow, mudança de configuração, instalação, ativação, reinício ou publicação. Os arquivos de código da produção e do PC não foram alterados por esta frente. Foram criados apenas artefatos locais de baseline e este documento.

A pausa das tarefas externas da VM VENDAS não foi verificada nesta coleta. O Dell não controla essa VM.

## Referências observadas

Primeiro baseline da Mel em **23/10/2026, 21:43:03 de São Paulo**:

- HEAD do checkout Dell: `eec619696ac52937296585f78af89d195df207ad`.
- HEAD local Windows: `ff91abcc22aa09ad60e0e3ec29aec0986d5f2063`; há mudanças locais preexistentes e trabalho concorrente.
- n8n: imagem `n8nio/n8n:2.38.7`, **21 workflows, 18 ativos**.
- Aplicação SquadOne, dois observadores e serviço Luna de workflows: `active` na consulta.
- `frente-comercial.service`: `inactive` naquele instante. É um serviço oneshot; esse resultado isolado não prova que o timer ou a operação estejam pausados.
- Retenção configurada das execuções n8n: `EXECUTIONS_DATA_MAX_AGE=336` horas. O fluxo CRM não salva sucessos.
- Hash do bundle compilado não foi coletado nesta frente. Não se presume que HEAD, fonte de checkout, cópia instalada e bundle executado sejam equivalentes.

### Fontes e cópias instaladas

SHA-256 de `deploy/dell/claude-ops/n8n.py`:

| Origem | SHA-256 |
|---|---|
| PC, antes de qualquer alteração desta frente | `03c6ec6594b5ad3f7cd6911d0b275faac172e08bcf9bfeee1e584a1083286483` |
| Checkout Dell | `4be0b47d5c50b2cc66d2fc62eb2f2a1e660f4574e9151853af8660a5b281ebf3` |
| Cópia instalada Dell em `~/.local/share/claude-ops/n8n.py` | `4be0b47d5c50b2cc66d2fc62eb2f2a1e660f4574e9151853af8660a5b281ebf3` |

A diferença PC/Dell nesse arquivo limita-se ao comentário de proteção dos workflows desligados. Nenhuma alteração de atomicidade foi aplicada ou preparada nele.

Na comparação dos quatro arquivos de missão/decisões, todos estavam versionados e sem alteração no checkout Dell. No PC estavam não versionados. Hashes abaixo são SHA-256 após normalização de BOM/CRLF; nessa coleta coincidiram com os hashes dos bytes originais.

| Arquivo | Dell | Windows |
|---|---|---|
| `src/office/missao.ts` | `872ad520aba65fc762f624400f736c1fdae048e06597b8f522427635f1ef0016` | `9dfd91de9918778c3b910a129b1be227e823fff113cdd7f92deeafb0654e0329` |
| `src/office/missao.test.ts` | `43d143c5759286d6a48ef5d7e3b8f2561fd86c4906a4731e182d42534412888c` | `477c4fe623f02ae0a04944c81e9e856f981653b922f59f91da830ef70eaa6bde` |
| `src/office/decisoes.ts` | `4ec6e16aed9d46adc12a0667c20fac1048cf3791d7d5903aa6f5ee5b18a3feed` | `7e180bc48c4d0ed1ad204d72fddb81ec4a47629fc4ba10c3f864fca5667b8098` |
| `src/office/decisoes.test.ts` | `178c7f6b8172744236b3072e4a78c855f99d37bb82c82750a64f8b887a62840d` | `ec718024142e50c467744878f18af2b8548fb74a4b725f37145b7feaaddfb439` |

O `missao.ts` Dell tinha 120 linhas e exportava `MovimentoDaMissao`/`movimentoDaMissao`, ausentes na cópia PC de 36 linhas. O `decisoes.ts` Dell preservava ordenação por `prioridadeDaAcao`/`PRIORIDADE_DA_FILA`, além dos dados de prioridade e instante das conversas. Copiar os arquivos Windows integralmente apagaria comportamentos da produção; a integração deve partir da fonte Dell e portar apenas os deltas necessários. Este registro é um recorte anterior à integração, não a versão final aprovada.

## Contrato do retrato CRM observado

- Workflow: `08 · CRM: retrato e registros (Site antes da venda + PRUMO)`.
- ID: `AsjxktRCqRJSmj9P`; ativo.
- `versionId`: `a8629f97-d288-41bb-9492-cea482734b3c`.
- Atualização informada pelo n8n: `2026-10-22T02:22:26.585Z`.
- Configuração: `executionOrder=v1`, `saveDataSuccessExecution=none`, `saveDataErrorExecution=all`.
- Nó final `Gravar retrato`: `n8n-nodes-base.readWriteFile`, operação `write`, binário `data`.
- Caminho no container: `/home/node/.n8n-files/estado/` + `$json.arquivo`.
- Retrato no host: `~/.local/share/n8n-estado/crm.json`; a pasta está montada com escrita no container.
- A Central lê esse retrato; registros comerciais continuam na aba CRM das planilhas. Não foi criada outra fonte comercial.

O arquivo existente era JSON válido, schema `versao=1`, com **2.856.856 bytes**, gerado em `2026-10-24T00:40:47.425Z` (**23/10, 21:40:47 de São Paulo**). Continha as fontes `site`, `prumo`, `iris`, `estampa` e `registros`.

SHA-256 do arquivo nesse instante: `367ad69c46dc6b47d0dda88fb309b266c80f2047aafc83bfc8a54a544b087a1c`. O hash mudará nas atualizações normais. Nenhum conteúdo comercial ou identificador pessoal foi incluído neste baseline.

## Achado: publicação do retrato não é atômica

A inspeção do código instalado do n8n confirmou:

1. `ReadWriteFile/actions/write.operation.js` chama `this.helpers.writeContentToFile`.
2. `n8n-core/.../file-system-helper-functions.js` abre o destino e chama `fileHandle.truncate(0)`, seguido de `writeFile` ou stream no mesmo arquivo.
3. O nó não oferece opção de rename/publicação atômica.

Isso permite uma janela em que a Central leia o arquivo vazio ou parcialmente gravado. Interrupção durante a gravação pode deixar o destino incompleto. A constatação é estrutural: **não foi provocada uma interrupção nem comprovada corrupção persistente nesta leitura**; o retrato observado estava válido.

Não é suficiente trocar o nome do arquivo para `.tmp`: ainda seria necessário validar e substituir o destino final por rename no mesmo filesystem.

## Limitação de implementação e decisão

Não substituir o nó por JavaScript que presume `require('fs')` disponível:

- A configuração do container não declarava `NODE_FUNCTION_ALLOW_BUILTIN` nem `NODE_FUNCTION_ALLOW_EXTERNAL`.
- A implementação instalada do sandbox JavaScript consultada usa lista vazia de builtins na ausência de configuração.
- O padrão instalado de `NodesConfig.exclude` exclui `n8n-nodes-base.executeCommand` e `localFileTrigger`; não havia override `NODES_EXCLUDE` no ambiente inspecionado.
- Não foi executado um workflow de ensaio para contornar essas restrições.

**Decisão desta rodada:** manter a correção de atomicidade em lote próprio. Não habilitar acesso geral a filesystem no sandbox, não habilitar shell e não reiniciar n8n para concluir o lote de missão/decisões. Nenhum arquivo de código de automação foi modificado, e nenhum teste de correção inexistente foi apresentado como aprovado.

## Caminho técnico recomendado para o lote de atomicidade

Preparar um publicador local com contrato fechado, compatível com as capacidades já disponíveis, sem endpoint genérico de escrita ou comandos livres. A integração exata deve ser validada antes de alterar o workflow.

O contrato mínimo deve:

- aceitar apenas os destinos CRM explicitamente aprovados e recusar caminhos escolhidos pelo chamador;
- validar limite de tamanho, JSON, versão e estrutura compatível com o contrato atual, sem reclassificar ou alterar os dados comerciais;
- preservar o retrato válido anterior em qualquer falha de leitura, validação ou gravação;
- serializar a publicação e rejeitar um retrato anterior ao já publicado, evitando regressão por execuções concorrentes;
- escrever arquivo privado temporário no mesmo diretório/filesystem, concluir a gravação e executar rename sobre o destino;
- definir confirmação de publicação verificável e falhas sanitizadas, sem conteúdo, telefone ou dados de leads;
- conservar `crm.json`, schema e caminho de leitura da Central para não exigir migração de fonte.

Aceite: testes isolados com dados fictícios cobrindo leitura concorrente, entrada inválida, falha antes do rename, concorrência entre gerações e preservação do último retrato válido. A publicação nunca deve expor JSON parcial ao leitor. A instalação deve ser estreita e reversível, preservando as alterações já existentes no Dell.

## Artefatos de reprodução

Somente código e metadados sanitizados foram guardados em:

- `output/reorganizacao-prumo-20261023/baseline/n8n.py.antes-atomicidade`: preimagem exata do PC.
- `output/reorganizacao-prumo-20261023/baseline/automacao-snapshot-baseline.json`: versões, hashes e contrato sanitizado.
- `output/reorganizacao-prumo-20261023/baseline/comparacao-regras-automacao.json`: contagem de linhas e diferenças de exports.
- Arquivos `*.dell`, `*.windows` e `*.diff` no mesmo diretório: fontes comparadas e diferenças exatas.

Não há backup do conteúdo de leads, export de credenciais ou execução de automação nesses artefatos.
