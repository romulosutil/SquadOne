# Cobrança mínima do Site (Encontrado)

29/10/2026. O mínimo para o primeiro pagamento do Site, aprovado pelo PM de 28/10/2026 como exceção ao
congelamento: contrato de uma página, o roteiro de cobrança por Pix e o registro do aceite e do
pagamento na Central. Sem gateway, sem Asaas, sem Autentique: a cobrança é manual e o Rômulo confere o
dinheiro no app do banco (`docs/PRUMO-QUALIFICACAO-CONTRATACAO-PAGAMENTO.md`, "Da proposta ao dinheiro").

Condição do cardápio (`src/operations/colinha.ts`, oferta `encontrado`): **R$ 690 uma vez e R$ 39 por
mês; o cliente só paga depois de ver o site funcionando no ar.** Nenhum outro valor entra nos textos.

Tudo entre colchetes é dado que só o Rômulo tem ou decisão dele. Nada aqui foi inventado: onde havia
uma sugestão já escrita no repositório (prazo, aviso), ela aparece como sugestão, ainda entre colchetes.

## O que o Rômulo precisa fornecer antes de cobrar

1. **Chave Pix** que vai receber (CNPJ, e-mail, telefone ou aleatória) e o **nome do titular** que o banco
   mostra ao pagador. O cliente confere esse nome antes de pagar; nome diferente do contrato gera desconfiança.
2. **Prestador**: razão social e CNPJ (a decisão de 25/10/2026 é prestar como pessoa jurídica,
   `docs/ENCONTRADO-PROPOSTA-AUTENTIQUE-2026-10-25.md`) ou, se ainda não houver CNPJ, nome completo e CPF;
   cidade/UF do foro.
3. **Prazo de entrega** depois dos materiais (sugestão já escrita no repositório: 5 dias úteis; confirmar).
4. **Domínio**: o endereço do site e em nome de quem fica registrado (cliente ou prestador). Muda a
   cláusula de cancelamento.
5. **Início da mensalidade** (sugestão já escrita: no mês seguinte ao site no ar; confirmar) e o dia de
   vencimento.
6. **Aviso de cancelamento** da mensalidade (sugestão já escrita: 30 dias; confirmar).
7. **Referência do contrato**, sem dado de contato nem de pagamento. Proposta para o primeiro:
   `ENC-2026-001`. É ela que vai no aceite e nos registros da Central.
8. Onde guardar o PDF assinado ou o print do aceite e do Pix: fora do Git (pasta privada do Dell ou o
   Drive). Na aba CRM entra só a referência.

## Contrato de uma página

> **Contrato de prestação de serviço — Site (Encontrado)** · Referência [ENC-2026-001] · versão 1
>
> **Partes.** Prestador: [RAZÃO SOCIAL/CPF-CNPJ DO PRESTADOR], [CIDADE/UF]. Cliente: [NOME OU RAZÃO
> SOCIAL DO CLIENTE], [CPF/CNPJ DO CLIENTE], [CIDADE/UF].
>
> **1. Escopo.** Site da empresa do cliente publicado na internet no endereço da empresa, com os
> serviços e o botão de WhatsApp, a partir da demonstração já apresentada; revisão do perfil da empresa
> no Google. Não inclui anúncios pagos nem gestão de redes sociais. Pedido fora do escopo é orçado à
> parte, antes de ser feito.
>
> **2. Materiais e prazo.** O cliente envia os dados e as fotos que quer no site e confirma os textos.
> O site fica pronto em até [PRAZO EM DIAS ÚTEIS] dias úteis depois de o cliente enviar os materiais. Atraso
> no envio dos materiais adia o prazo pelo mesmo tempo.
>
> **3. Valor e quando pagar.** Implantação: R$ 690, pagamento único, **somente depois de o cliente ver o
> site funcionando no ar** no endereço [DOMÍNIO DO SITE]. Mensalidade: R$ 39 por mês, a partir de
> [MÊS DA PRIMEIRA MENSALIDADE], com vencimento no dia [DIA DO VENCIMENTO]. Forma: Pix na chave
> [CHAVE PIX], titular [NOME DO TITULAR DA CHAVE]. O pagamento vale quando aparece na conta do prestador;
> comprovante enviado não substitui o recebimento.
>
> **4. O que a mensalidade cobre.** Domínio, hospedagem e um ajuste por mês no conteúdo do site (troca
> de texto, foto, horário ou serviço). Alteração maior que um ajuste é orçada à parte.
>
> **5. Domínio e hospedagem.** O domínio [DOMÍNIO DO SITE] fica registrado em nome de [CLIENTE OU
> PRESTADOR]. Enquanto a mensalidade estiver em dia, o prestador mantém o site no ar e renova o domínio.
>
> **6. Cancelamento.** O cliente pode cancelar a mensalidade a qualquer momento, avisando com [PRAZO DE
> AVISO] dias de antecedência por mensagem de WhatsApp. Antes de o site ir ao ar, o cliente pode desistir
> sem pagar nada. Depois do cancelamento o site sai do ar ao fim do mês pago; [SE O DOMÍNIO ESTIVER EM
> NOME DO PRESTADOR: o prestador transfere o domínio ao cliente, se ele pedir, sem custo de serviço].
> Mensalidade atrasada há mais de [DIAS DE ATRASO] dias permite ao prestador tirar o site do ar, com
> aviso prévio por WhatsApp.
>
> **7. Dados pessoais (LGPD).** O prestador usa os dados do cliente apenas para fazer, manter e cobrar o
> site, e não os vende nem os repassa. Os contatos que chegarem pelo site ou pelo botão de WhatsApp são
> do cliente, que é o responsável por eles; o prestador não os guarda nem os usa. O site não coleta dado
> pessoal além do que o visitante decidir mandar pelo WhatsApp. O cliente pode pedir a qualquer momento
> a correção ou a exclusão dos seus dados que o prestador guarda.
>
> **8. Conteúdo.** O cliente confirma que tem direito de usar os textos, fotos e marcas que enviar e que
> o conteúdo segue as regras da sua profissão (para advogado, as de publicidade da OAB). O prestador não
> publica texto que o cliente não aprovou.
>
> **9. Aceite.** Este contrato vale a partir do aceite do cliente por mensagem de WhatsApp com o texto
> exato: **"Li o contrato [ENC-2026-001] versão 1 e aceito as condições."** Foro: [CIDADE/UF DO FORO].

O texto do aceite é fixo de propósito: a frase cita a referência e a versão, e é ela que vai como
evidência no registro da Central. "Ok", "fechado" ou um emoji não são aceite; peça a frase.

## Roteiro de cobrança em 4 passos

Os textos seguem o guia do `site-mensagem.js` (uma pergunta só por mensagem, preço legível "R$ 690 uma
vez e R$ 39 por mês", sem emoji, sem link) e passam no gate `server/gate-de-envio.ts`
(`conferirMensagem`, tipo `conversa`, modo `bloquear`, com os colchetes marcados para completar). Os
colchetes são preenchidos pelo Rômulo antes de enviar; nenhum texto sai pelo sistema.

**Passo 1. Pedir o aceite** (com o PDF do contrato anexado na conversa; anexo não é link):

> Bruno, segue o contrato do site em uma página, com as condições que te passei: R$ 690 uma vez e R$ 39 por mês, e você só paga depois de ver o site no ar. Se estiver de acordo, me responda com esta frase: "Li o contrato [ENC-2026-001] versão 1 e aceito as condições." Pode ser assim?

Registrar o aceite na Central (item D, chamada 3) e o próximo passo com a data em que o site vai ao ar
(chamada 4). Sem a resposta, não cobrar e não insistir fora da cadência da proposta.

**Passo 2. Mostrar no ar e mandar a chave Pix.** Primeiro o site no ar (o gatilho do contrato):

> Bruno, o site está no ar no endereço [DOMÍNIO DO SITE]. Ficou do jeito que você queria?

Só depois de ele dizer que viu funcionando:

> Que bom! Para a implantação são R$ 690, por Pix na chave [CHAVE PIX], no nome de [NOME DO TITULAR DA CHAVE]. Me avisa por aqui quando fizer?

**Passo 3. Conferir o recebimento no app do banco** (sem mensagem ao lead): abrir o extrato da conta da
chave Pix, achar a entrada de R$ 690 com o nome do pagador e a data. Print ou comprovante enviado pelo
cliente não confirma: só a entrada no extrato. Valor diferente de R$ 690 não se registra como
implantação; parar e conversar com o cliente.

**Passo 4. Confirmar ao cliente e registrar** (item D, chamada 5):

> Bruno, recebi o Pix da implantação, obrigado! A mensalidade de R$ 39 começa em [MÊS DA PRIMEIRA MENSALIDADE]. Quer que eu ajuste mais alguma coisa no site?

Mensalidade: todo mês, o mesmo passo 3 e um registro de pagamento com referência própria por mês
(`ENC-2026-001-2026-12`, por exemplo).

## Diagnóstico do registro (29/10/2026)

Leitura de `/tmp/crm.json` e de `/api/runtime` na Mel, sem escrever nada, e do código na `main`.

- **Proposta do Bruno.** Foi anotada com o registro `proposta` ("Proposta enviada" da Ficha), que move a
  etapa e não leva valor. `aarr.propostas` só conta o registro `valor_proposta` (Ficha › Receita e
  registros anteriores) ou a versão enviada do ciclo comercial; nenhum dos 3.527 leads tem um dos dois,
  por isso Resultados mostra "2 em Proposta sem valor registrado". Não é falha: é o registro que falta.
- **Ciclo comercial bloqueado hoje.** O envio e o aceite do ciclo exigem a qualificação confirmada
  (`qualificadoParaProposta`: dor, impacto e decisor "sim"); o Bruno não tem nenhuma. Para o primeiro
  pagamento o caminho possível agora é o da Receita (`valor_proposta` e `pagamento_confirmado`), que o
  fluxo 08 aceita para o Site (`deploy/dell/claude-ops/crm.py`, só `encontrado`). Não misturar os dois no
  mesmo lead: depois da primeira nota do ciclo, a Central recusa novos registros da Receita.
- **Falha silenciosa corrigida.** O pagamento confirmado pela Receita não encerrava a cadência da proposta
  (o ciclo encerrava pelo `recebido`; a Receita não tinha par). O lead que pagou continuaria recebendo
  "Conseguiu olhar a proposta?" na fila e, no D+10, iria para Perdido como "sumiu", contado nas perdas
  com o dinheiro contado na receita. Corrigido em `src/operations/cadencia.ts` (`pagamentoConfirmado`),
  com teste em `src/operations-cadencia.test.ts` e de ponta a ponta em `server/crm-aarr.test.ts`.
- **Prazo do Bruno.** A proposta de 29/10 vence no D+10, **08/11/2026**, se ele não escrever e não houver
  próximo passo com data futura. O próximo passo de 30/10 só protege até lá. Depois do aceite, registre
  o próximo passo com a data do site no ar (chamada 4).
- **Aceite.** A Receita não tem tipo de aceite; ele entra como nota com a frase exata e a referência
  (chamada 3), no mesmo formato das notas "[Envio confirmado pelo operador · data]" que já existem.

## Os registros preparados (não executados)

Rodar na Mel (`ssh mel`), um por vez, só depois do fato acontecer. Cada chamada acrescenta **uma linha à
aba CRM** pelo fluxo 08 do n8n; o retrato mostra no ciclo seguinte. A Ficha faz o mesmo sem terminal:
Ficha do Bruno › Receita e registros anteriores › Registrar um fato comercial. Datas em AAAA-MM-DD, nunca
futuras (a Central recusa). Resposta `201` = gravado; `400` traz o motivo e nada foi enviado.

Função de apoio (cola no terminal da Mel; monta o corpo com o `texto` como JSON dentro de JSON):

```bash
registrar() {  # registrar <tipo> <texto> [data]
  python3 -c 'import json,sys; print(json.dumps({"produto":"site","id":"ChIJ6ankrqOzGgcRPhI4J9MJOt4","tipo":sys.argv[1],"texto":sys.argv[2],"data":sys.argv[3] if len(sys.argv)>3 else ""}))' "$@" \
  | curl -sS -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:9120/api/operations/crm/registro \
      -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:9120' --data-binary @-
}
```

**1 e 2. Valor da proposta enviada em 29/10** (agora; conta na meta de propostas):

```bash
registrar valor_proposta '{"versao":1,"oferta":"encontrado","componente":"implantacao","valor_centavos":69000,"referencia":"ENC-2026-001","data":"2026-10-29"}'
registrar valor_proposta '{"versao":1,"oferta":"encontrado","componente":"mensalidade","valor_centavos":3900,"referencia":"ENC-2026-001","data":"2026-10-29"}'
```

Altera: `aarr.propostas` do Bruno ganha implantação (69000) e mensalidade (3900); Resultados passa a
"2 valores registrados em 1 lead" e o "sem valor registrado" cai de 2 para 1. Etapa e cadência não mudam.

**3. Aceite** (quando ele mandar a frase; troque a data e o local da prova):

```bash
registrar nota '[Aceite confirmado pelo operador · AAAA-MM-DD] Bruno aceitou por WhatsApp o contrato ENC-2026-001 versão 1 (Site, R$ 690 uma vez e R$ 39 por mês, paga depois de ver no ar) com a frase: "Li o contrato ENC-2026-001 versão 1 e aceito as condições." Prova: print guardado em [LOCAL PRIVADO].'
```

Altera: só a linha do tempo da Ficha (nota). Não move etapa nem números.

**4. Próximo passo até o site no ar** (logo depois do aceite; a data é a prevista para publicar):

```bash
registrar proximo_passo 'Publicar o site do Bruno e pedir que ele confira no ar antes do Pix' AAAA-MM-DD
```

Altera: o próximo passo da Ficha; com data futura, a cadência fica em "preservar" e a proposta não vence.

**5. Pagamento da implantação** (só depois do passo 3 do roteiro; data = dia do Pix no extrato):

```bash
registrar pagamento_confirmado '{"versao":1,"oferta":"encontrado","componente":"implantacao","valor_centavos":69000,"referencia":"ENC-2026-001","data":"AAAA-MM-DD"}'
```

Altera: `aarr.pagamentos` do Bruno (69000); `receita.valorCentavos` e a Estrela-guia da semana contam
1 pagamento; com a correção desta data, a cadência da proposta acaba (sem toque e sem vencimento). O
desfecho continua à parte: marque "Ganhou" na Ficha se o Rômulo der a venda por fechada. Errou?
"Conferir valores registrados e corrigir" › desfazer, e registrar o certo; nunca editar a planilha.
