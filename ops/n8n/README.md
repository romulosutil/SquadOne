# PRUMO no n8n

Os dois JSONs em `workflows/` são os artefatos importáveis da integração:

- `prumo-lead-scout.json`: descobre e pontua empresas, procura um WhatsApp
  publicado no site institucional, persiste `company_id` e prepara o convite
  quando a coluna `Etapa` recebe `Contato aceito`;
- `prumo-diagnostico.json`: acompanha as respostas do Forms, consolida as cinco
  perspectivas e devolve estado, índice e briefing à mesma linha da fila;
- `prumo-preparar-planilha.json`: aplica cabeçalhos em português, blocos de cor,
  filtros, larguras, congelamento, notas e validações na guia `Leads`. As
  células amarelas são as destinadas ao preenchimento humano.

## Contrato da fila

A guia `Leads` expõe um contrato humano. Os nomes técnicos continuam internos
ao workflow; na planilha, os campos de integração são:

```text
ID da empresa
Situação do diagnóstico
Formulário do diagnóstico
Mensagem do convite
Enviar convite
Convite enviado em
Última resposta em
Quem respondeu
Quem falta responder
Sessões recebidas
Respostas válidas
Índice PRUMO
Resultado por área
Lacunas observadas
Briefing interno
Próxima ação
Diagnóstico concluído em
Atualizado em
Erro técnico
```

O formulário recebe no campo `Empresa` o valor pré-preenchido
`<ID da empresa>::<Empresa>`. O identificador fica oculto no uso diário e não
deve ser alterado: ele substitui
a comparação frágil por nome e permite devolver o diagnóstico ao lead correto.

## Priorização comercial

O Lead Scout consulta somente sites públicos válidos e considera elegível para
revisão comercial apenas a empresa cujo HTML publicado contém um link explícito
do WhatsApp (`wa.me`, `api.whatsapp.com`, `web.whatsapp.com` ou
`whatsapp://send`). Telefone do Google Places, mesmo celular, não comprova
WhatsApp. Quando o link expõe um número, ele precisa ser um celular brasileiro;
fixos e 0800 são recusados mesmo dentro de um link do WhatsApp. Links diretos
`wa.me/message` continuam válidos. Falhas técnicas continuam registradas
separadamente para operação.

Os quatro campos da triagem têm limites estáveis e somam no máximo 100:

- `Aderência` (0–60): operação ativa, termos do segmento no nome/categorias,
  nota pública graduada, volume de avaliações em escala logarítmica e endereço;
- `Complexidade` (0–20): proxy de presença operacional pública, usando volume
  de avaliações, diversidade de categorias e existência de site;
- `Facilidade de contato` (0 ou 20): recebe 20 somente com WhatsApp publicado
  e confirmado no site;
- `Prioridade` (0–100): soma dos três componentes anteriores.

Para entrar em `Revisar`, a empresa precisa ter WhatsApp confirmado **e** obter
ao menos 60 pontos. A pontuação ordena a pesquisa humana; ela não diagnostica a
empresa nem comprova que o número chega ao decisor. Sites que montam o link
apenas via JavaScript podem gerar falso negativo e ficam fora da abordagem
automática.

## Estados

```text
Revisar
  -> Contato aceito                   (decisão humana)
  -> Convite pronto                   (workflow gera link e mensagem)
  -> Diagnóstico em andamento         (primeira a quarta perspectiva)
  -> Diagnóstico para revisar         (cinco perspectivas completas)
```

`Convite pronto` não significa enviado. O envio automático exige uma credencial
de canal e uma política de destinatário; enquanto isso, a coluna
`Enviar convite` abre uma mensagem pronta para envio humano.

## Regra do WhatsApp

O telefone retornado pelo Google Places permanece na coluna `Telefone`, mas
não é tratado automaticamente como WhatsApp. O Lead Scout só preenche `Canal
de contato` e `Destino do contato` quando encontra no site institucional um
link público de WhatsApp (`wa.me` ou `api.whatsapp.com`). Um celular sem essa
evidência fica pendente de confirmação humana; um telefone fixo não recebe
pontuação de canal direto, mesmo se estiver embalado em um link do WhatsApp.

## Uso humano

1. Filtre `Etapa = Revisar`; a lista já contém somente WhatsApps publicados,
   mas ainda exige confirmação humana de segmento, porte, número e decisor.
2. Preencha as células amarelas. `Canal de contato` possui lista de opções,
   datas aceitam somente datas válidas e `Não contatar` é uma caixa de seleção.
3. Confirme manualmente o WhatsApp quando houver apenas um celular público e
   selecione `WhatsApp confirmado manualmente`; não reutilize um telefone fixo.
4. Depois do aceite da empresa, selecione `Contato aceito` em `Etapa`.
5. Em até cinco minutos, abra `Enviar convite`; o link já identifica a empresa.
6. Acompanhe `Quem respondeu`, `Quem falta responder` e `Próxima ação`.
7. Quando aparecer `Diagnóstico para revisar`, abra o `Briefing interno`.

## Regeneração

Partindo de exports atuais do n8n:

```bash
node scripts/prepare-prumo-workflows.mjs lead-export.json diagnostico-export.json
```

Os testes de contrato estão em `server/prumo-workflows.test.ts`.
