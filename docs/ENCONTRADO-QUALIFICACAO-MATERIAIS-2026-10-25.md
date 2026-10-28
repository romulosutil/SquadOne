# Encontrado — qualificação e materiais solicitados

Segundo lote autorizado por Rômulo: perguntar a próxima lacuna, preparar os
materiais pedidos e acionar o operador somente nas exceções. A aquisição continua
pausada; a capacidade tem seu próprio corte temporal, sem aproveitar backfill como
nova autorização. O primeiro lote e suas reservas permanecem preservados.

## Caminho executável

1. A Central confere conta, conversa, mensagem original, contexto atual e
   responsabilidade. Condições individuais e negativas continuam vetando automação.
2. Um leitor **local**, sem chamada de modelo ou envio de conversa a outro serviço,
   observa necessidade, intenção declarada e participantes da aprovação. Respostas
   às perguntas anteriores recebem referências às tuples originais verificadas.
3. Pergunta uma lacuna por vez. Permissão para material não confirma intenção de
   compra. Ambiguidade recebe um esclarecimento; não repete questionário sem fim.
4. Pedido explícito de demo/Raio-X tem prioridade sobre o questionário. Permissão
   genérica só vale após oferta inequívoca de um único material. Cada pedido leva
   mensagem de origem, referência da empresa e hash da política em arquivo privado
   imutável. A observação não grava `humano:true` nem substitui a qualificação do CRM.
5. `encontrado-materiais.timer` confere a fila a cada dois minutos. Antes de gerar,
   pede autorização atual à Central por loopback + segredo técnico. Não aceita
   comandos, caminhos ou tipos arbitrários. Reutiliza `gerador-de-sites-pedido`
   e `raio-x SLUG`, exclusivamente para pedidos autorizados.
6. Reutiliza material existente somente quando comprovado. Qualidade exige
   referência, manifesto dos bytes finais, organização canônica e pacote publicado
   idêntico. Profissional exige avaliação privada atual; prévia exige identificação.
7. Quando todos os materiais pedidos estão prontos, a Central confere novamente
   publicação, contexto, identidade, política e responsabilidade antes de enviar
   uma resposta com os links. Reserva durável precede o transporte. Entrega não
   confirma aceite, proposta ou obrigação financeira.

O painel da ficha mostra a observação com os trechos originais. GETs não geram,
enviam ou gravam projeções. O acompanhamento continua com o time; filas humanas
recebem condição especial, tomada humana, ambiguidade persistente, qualidade
divergente ou execução sem prova após reconciliação. Não se faz teste com cliente.

## Estado e recuperação

Em `SQUADONE_OPERATIONS_DATA_DIR`: `encontrado-qualificacao/` guarda projeções por
conteúdo/corte/versão; `encontrado-materiais/` guarda pedidos, tentativa e resultado.
Não são um CRM editável nem confirmação comercial. A inbox e a fonte real
permanecem sendo a origem; a qualificação pode ser reconstruída.

Falha temporária da Central/consulta conserva o pedido para nova conferência.
O worker não republica Raio-X após crash/timeout; primeiro procura o recibo real.
Demo usa `PEDIDO-DEMO.json` e acorda o serviço existente de forma idempotente.
Ausência de comprovação por seis horas vira exceção. Divergência na conferência
pré-envio é tentada novamente; após 30 minutos pede intervenção. Pausar política
ou assumir conversa impede novas autorizações e novas mensagens. Trabalho já
iniciado pode terminar; isso não autoriza sua entrega.

Configuração opt-in, acrescentada à política existente **após homologação**:

```json
{"qualificacao":{"v":1,"desde":"INSTANTE_REAL_DA_ATIVACAO","politicaHash":"HASH_QUALIFICACAO_ENCONTRADO"}}
```

O hash vem do código; o corte não antecede a ativação do primeiro lote. Ausência
mantém somente FAQ. Rollback: pausar política e timer, esperar runtime ocioso,
restaurar somente fontes/bundle do lote, conservar pedidos, tentativas e reservas.

## Verificação

Fixtures TS cobrem pergunta seguinte, prova ausente, corte próprio, GET sem efeito,
permissão específica, duas entregas, tomada humana, pausa, mudança de bytes/contexto,
idempotência e falha de publicação. O worker Linux tem fixtures sem rede, gerador,
systemd ou dados reais, incluindo referência errada, publicação diferente, avaliação
ausente, pasta ambígua/encerrada, symlink, tentativa durável e crash.

Uma entrada natural posterior à ativação ainda é necessária para comprovar uso
com cliente. Homologação sintética e serviço ativo não representam venda.

## Limite deliberado

A revisão automática de aprovação rejeitou a alternativa de mandar trechos das
conversas ao Gemini por falta de autorização explícita para esse conteúdo e destino.
O leitor local conclui este lote sem essa transferência. Casos fora dos padrões
locais recebem esclarecimento e, se permanecerem ambíguos, uma decisão humana.

Próximo lote: proposta padrão versionada e aceite; depois cobrança Asaas e
conciliação, respeitando o cliente ver o site no ar antes de cobrar. Asaas e
Autentique continuam sem credenciais ou efeitos reais neste lote.
