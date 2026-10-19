# PRUMO no n8n

Esta pasta **não é a fonte** dos fluxos do PRUMO. Os JSONs de exportação que
moravam aqui (Lead Scout, Preparar planilha, Diagnóstico) descreviam o desenho
anterior a 23/09/2026 (aba `Leads`, etapa `Contato aceito`, `Convite pronto`) e
foram apagados, junto com o script que os regenerava: importá-los de volta
desfaria o fluxo vivo.

## De onde vêm os fluxos hoje

Cada fluxo é montado e publicado por um construtor em
`deploy/dell/claude-ops/`, idempotente, pela API do n8n:

| Fluxo | Construtor |
|---|---|
| Diagnóstico do dono (pontuação, avisos, ramo do Mapa) e "Clique em Enviar convite" do PRUMO | `prumo-simples.py` (o ramo do Mapa vem de `prumo-mapa-n8n.py`) |
| Caçadores e cliques de convite do Iris e do CRM de estamparia | `prumo-ofertas.py` (+ `prumo-ofertas.json`) |
| 08 · CRM (retrato das planilhas para a Central) | `crm.py` |
| Fonte com IA e Medição de eventos (site público) | `prumo-publico.py` |

O Lead Scout (convite frio a distribuidoras) está **desligado desde
08/10/2026** (`DESLIGADOS` em `claude-ops/n8n.py`); o fluxo inativo continua no
n8n, mas nenhum construtor o recria.

## O fluxo real da fila

A planilha do PRUMO tem a aba `Prospects` (a única do dia a dia) e a oculta
`Descartados`. A coluna `Etapa` anda assim:

```text
Revisar -> Convite enviado -> Diagnóstico pronto -> Concluído | Sem interesse
```

- **Revisar**: o caçador grava o prospect com o botão "Enviar convite" (link
  rastreado do n8n).
- **Convite enviado**: quem muda a Etapa é o **observador do WhatsApp**
  (`whatsapp-conversa.py`), quando a mensagem sai de verdade. O clique em
  "Enviar convite" só abre o WhatsApp com o texto pronto; não marca nada.
- **Diagnóstico pronto**: a pontuação (de hora em hora) lê o formulário, grava
  Índice (média) e Briefing na linha. O aviso para o Rômulo é o do Mapa
  (`prumo_mapa.py`), que tem o índice de 18 itens.

## Arquivo que sobrou

A pasta `workflows/` ficou vazia. O export do Diagnóstico mudou para
`deploy/dell/claude-ops/testes/prumo-diagnostico.fixture.json`: é só fixture de teste,
de onde `claude-ops/workflow_confiabilidade.test.py` lê o questionário de 16 perguntas.
Não é importável nem representa o fluxo vivo.
