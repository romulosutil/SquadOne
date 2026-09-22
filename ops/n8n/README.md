# PRUMO no n8n

Os dois JSONs em `workflows/` são os artefatos importáveis da integração:

- `prumo-lead-scout.json`: descobre e pontua empresas, persiste `company_id` e
  prepara o convite quando a coluna `Etapa` recebe `Contato aceito`;
- `prumo-diagnostico.json`: acompanha as respostas do Forms, consolida as cinco
  perspectivas e devolve estado, índice e briefing à mesma linha da fila;
- `prumo-preparar-planilha.json`: aplica cabeçalhos em português, blocos de cor,
  filtros, larguras, congelamento, notas e listas de estados na guia `Leads`.

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

## Uso humano

1. Filtre `Etapa = Revisar` e confirme segmento, porte e decisor.
2. Preencha responsável, canal e destino do contato.
3. Depois do aceite da empresa, selecione `Contato aceito` em `Etapa`.
4. Em até cinco minutos, abra `Enviar convite`; o link já identifica a empresa.
5. Acompanhe `Quem respondeu`, `Quem falta responder` e `Próxima ação`.
6. Quando aparecer `Diagnóstico para revisar`, abra o `Briefing interno`.

## Regeneração

Partindo de exports atuais do n8n:

```bash
node scripts/prepare-prumo-workflows.mjs lead-export.json diagnostico-export.json
```

Os testes de contrato estão em `server/prumo-workflows.test.ts`.
