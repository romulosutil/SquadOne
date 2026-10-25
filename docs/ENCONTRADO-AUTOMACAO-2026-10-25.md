# Automação do Encontrado — primeiro lote

Autorização: Rômulo pediu implementar em ordem a operação, começando pelo
Encontrado, com o máximo de automação e somente decisões necessárias na fila
humana. Autorizou escolher provedores ainda não definidos. Decisão técnica:
Asaas para cobrança e Autentique para assinatura. Contas, credenciais e modelos
finais ainda não foram provisionados; este lote não chama essas APIs.

## Capacidade implementada

- Política executável do catálogo: preço padrão, escopo, prazo sem promessa e
  saudação em respostas determinísticas, sem geração de preço por modelo.
- Execução somente para uma oportunidade Site inequivocamente vinculada à
  conta Prumo, com entrada original posterior à ativação e contexto atual.
- Reserva privada durável antes do transporte; crash e timeout não repetem o
  envio. Reconciliação exige saída exata com identidade e horário demonstrados.
- Conferência autenticada de conexão e identidade da instância existente antes
  de cada envio. Sem criar conta, sessão, QR ou rota pública.
- Trava por conversa compartilhada entre envio e tomada humana. Escrita humana
  de responsável continua usando as confirmações e journal existentes.
- Trabalho do time sai da fila humana/Telegram e permanece no acompanhamento.
  Falha técnica recebe nova conferência; persistência sem solução ou resultado
  incerto por cinco minutos pede intervenção específica.

Não reativa aquisição nem retoma históricos. Não altera o cenário, sprites,
credenciais, n8n ou condições individuais. FAQ de preço não é proposta enviada,
qualificação, aceite, cobrança ou pagamento. As etapas posteriores ainda usam
seus contratos assistidos; não há vendedor autônomo completo neste lote.

## Configuração e operação

O executor no perfil operations consulta
`SQUADONE_OPERATIONS_DATA_DIR/encontrado-automacao.json`, privado, modo 0600:

```json
{"v":1,"modo":"pausado","desde":"2026-10-25T00:00:00.000Z","catalogoHash":"HASH_CANONICO_DO_PACOTE"}
```

`HASH_CATALOGO_ENCONTRADO` é calculado pelo código, a partir do padrão vigente.
Na ativação autorizada, usar `modo=respostas` e o instante real da ativação;
não retroagir o corte. Ausência mantém o caminho assistido. Arquivo inválido
recusa execução; mudança do catálogo pede revisão da política. Alterar para
`pausado` é relido antes de executar, sem apagar reservas.

GET autenticado `/api/operations/crm/encontrado/automacao` mostra modo, corte,
hash e contagens operacionais, sem contatos, texto ou segredos. Reservas em
`encontrado-saidas/` não são outra base de negociação.

## Critérios de verificação

Testes com dados fictícios cobrem respostas compostas, condições históricas,
restrições, identidade, múltiplos executores, tomada humana, mudança de
contexto/política durante a execução, timeout, reinício, reconciliação e filas.
O transporte é dublado. Não enviar mensagens reais para testar.

Publicação: comparar preimagens com o Dell, preservar fontes/dist/configuração,
validar a integração Linux e instalar seletivamente. Conferir modo e corte no
endpoint, identidade do WhatsApp, serviço e pausa da prospecção. Uma nova entrada
natural ainda é necessária para comprovar uso operacional; teste sintético não
representa venda nem resposta real a cliente.

## Próximos lotes em ordem

1. Qualificação observada com referência à conversa, sem marcar inferência como
   confirmação humana, e preparação automática de material solicitado.
2. Proposta padrão versionada, documento aprovado e integração de aceite.
3. Asaas com referência por obrigação/competência e conciliação de recebimento;
   preservar o gatilho de o cliente ver o site no ar antes da cobrança.
4. Entrega, coleta de materiais, qualidade, manutenção e acompanhamento.
5. Aumento de aquisição somente depois de provar atendimento e capacidade.

## Reversão

Pausar a política antes de reverter o bundle, conferir execução em curso pelo
runtime e preservar todas as reservas, capturas e fatos comerciais novos.
Restaurar somente os arquivos deste lote pelas preimagens. Não apagar a inbox,
o journal, os históricos ou o estado de aquisição; não reativar 05/06, Grok ou
caçadores. Um envio incerto continua bloqueando repetição após rollback.

## Publicação conferida

Primeiro lote instalado no Dell em 25/10/2026 às 18h13 de São Paulo, commit
`61a53a4`, com fontes anteriores e bundle preservados. Política ativa somente
para entradas originais a partir de `2026-10-25T21:13:35.045Z`. Saúde e identidade
da conta foram conferidas por leitura autenticada; prospecção permanece pausada,
21 workflows/16 ativos e mesmos grafos. Nenhuma mensagem de teste foi enviada.

Homologação Linux inicial: 4.163 testes TS/JS aprovados, sem falhas/skips,
tipagem/build e 14 testes do leitor Hermes aprovados. Na interface publicada,
escritório, seis personagens, abertura/fechamento das decisões, canal da Carla
e retorno à sala foram conferidos no desktop, sem enviar comando ou registrar
fato comercial. Não foi alegado teste em aparelho móvel neste lote.

Revisão adicional cobre recuperação concorrente de trava abandonada com um
recuperador exclusivo, para impedir que dois leitores antigos retirem uma nova
reserva. Esse reforço mantém a política e o corte originais. Publicação e
homologação finais ficam no recibo privado do lote complementar. Ainda falta
uma nova entrada natural para comprovar o atendimento em uso real; os testes
isolados não representam venda nem confirmação financeira.
