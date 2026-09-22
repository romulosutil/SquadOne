# PRUMO no n8n

Os dois JSONs em `workflows/` são os artefatos importáveis da integração:

- `prumo-lead-scout.json`: descobre e pontua empresas, persiste `company_id` e
  prepara o convite quando a linha recebe `status=CONTACT_ACCEPTED`;
- `prumo-diagnostico.json`: acompanha as respostas do Forms, consolida as cinco
  perspectivas e devolve estado, índice e briefing à mesma linha da fila.

## Contrato da fila

Além das colunas originais, a guia `Leads` precisa conter:

```text
company_id
diagnostic_status
diagnostic_form_url
diagnostic_invite_message
diagnostic_invite_action_url
diagnostic_invited_at
diagnostic_last_response_at
diagnostic_roles_received
diagnostic_missing_roles
diagnostic_session_count
diagnostic_answer_count
prumo_index
diagnostic_areas
diagnostic_gaps
diagnostic_briefing
diagnostic_next_action
diagnostic_result_at
diagnostic_updated_at
diagnostic_error
```

O formulário recebe no campo `Empresa` o valor pré-preenchido
`<company_id>::<company_name>`. Esse valor não deve ser alterado: ele substitui
a comparação frágil por nome e permite devolver o diagnóstico ao lead correto.

## Estados

```text
REVIEW
  -> CONTACT_ACCEPTED                 (decisão humana)
  -> DIAGNOSTIC_INVITE_READY          (workflow gera link e mensagem)
  -> DIAGNOSTIC_IN_PROGRESS           (primeira a quarta perspectiva)
  -> DIAGNOSTIC_REVIEW                (cinco perspectivas completas)
```

`INVITE_READY` não significa enviado. O envio automático exige uma credencial
de canal e uma política de destinatário; enquanto isso, a coluna
`diagnostic_invite_action_url` abre uma mensagem pronta para envio humano.

## Regeneração

Partindo de exports atuais do n8n:

```bash
node scripts/prepare-prumo-workflows.mjs lead-export.json diagnostico-export.json
```

Os testes de contrato estão em `server/prumo-workflows.test.ts`.
