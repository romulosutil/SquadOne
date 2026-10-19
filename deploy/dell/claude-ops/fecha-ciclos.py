"""Link rastreado do wa_link do Site (idempotente): o fluxo "04 · Clique no wa_link (registra o clique)".

- "Clique no wa_link" (GET /webhook/enviar?place_id=): redireciona para o wa.me
  guardado em wa_me e, num lead "pronto", grava `clique_em` (19/10/2026: o rastro
  do clique, nunca o envio). Quem marca "enviado" é o observador, quando a mensagem
  sai de verdade; com um clique até 15 min antes, ele mantém a letra do Balcão em
  mensagem_variante (o texto que saiu é o do wa_me), e sem clique grava "manual".
  Até 18/10/2026 o clique marcava "enviado" (status + enviado_em) direto; a regra
  [abrir-nao-envia] de workflow_confiabilidade.py tirou isso, e o A/B da 1ª
  mensagem parou de contar (todo envio virava "manual") até o clique_em.
  Com `&marcar=nao` (01/10/2026) só redireciona, sem rastro: é o caminho do operador do
  Dell, que envia pelo WhatsApp Web. Limite conhecido (07/10/2026): o observador não sabe
  desse clique, então o envio que vem depois grava mensagem_variante "manual", e não a
  letra do Balcão; quem automatizar o envio por esse caminho precisa deixar o rastro.
  Nome (19/10/2026): o fluxo era "04 · Clique no wa_link (marca enviado)" e o nó
  "Marcar como enviado"; o nome mentia desde a regra acima. Agora "(registra o clique)" e
  "Gravar clique_em". Ao publicar, o fluxo antigo é achado pelo nome velho e RENOMEADO pelo
  id: não nasce um segundo fluxo com o mesmo path /webhook/enviar.

`webhook_workflow` monta um fluxo de link rastreado; hoje só o 04 do Site o chama. O convite do PRUMO
tem o próprio `clique_workflow` em prumo-simples.py, que aproveita daqui só SHEETS, doc, LINKS e schema.
O nó que grava o clique tem nome configurável (`nome_do_no_marcar`, padrão "Marcar como enviado"); o
workflow_confiabilidade.py reconhece os dois nomes e, se um nó assim gravar status ou enviado_em, força
`marcar: false` (abrir um link nunca marca envio).

Até 29/09/2026 os links usavam 127.0.0.1:5679, que só abria no Dell (ou pelo túnel do PC).
Desde então passam pela tailnet: `tailscale serve` publica /webhook do n8n em LINKS, só para
aparelhos da tailnet (não é Funnel), então o link abre no celular com o Tailscale ligado. O
wa_link do Site é remontado pelo Balcão a cada hora (balcao-cruzar.js).

Até 19/10/2026 este arquivo também trazia o Lead Scout do PRUMO (lead_scout()), o texto de
pendências dele e a opção --tailnet: eram de antes do prumo-simples.py (23/09/2026), que os
substituiu, e rodá-los desfaria o PRUMO simples. Foram apagados.

Uso: python3 fecha-ciclos.py        (refaz só o 04 do Site)
"""
import importlib.util
from pathlib import Path

from n8n import api, put

# As constantes do Site moram no site-antes-da-venda.py (uma fonte só, SITE-16).
_spec = importlib.util.spec_from_file_location("site_antes_da_venda", Path(__file__).resolve().parent / "site-antes-da-venda.py")
sv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sv)

SHEETS = sv.SHEETS
SITE = sv.PLANILHA
LEADS_GID = sv.LEADS_GID
LINKS = sv.LINKS

NOME_DO_04 = "04 · Clique no wa_link (registra o clique)"
NOME_ANTIGO_DO_04 = "04 · Clique no wa_link (marca enviado)"


def doc(planilha, gid, aba):
    return {"documentId": {"__rl": True, "mode": "id", "value": planilha},
            "sheetName": {"__rl": True, "mode": "id", "value": gid, "cachedResultName": aba}}


def schema(colunas, chave):
    return [{"id": c, "displayName": c, "required": False, "defaultMatch": c == chave, "display": True,
             "type": "string", "canBeUsedToMatch": c == chave} for c in colunas]


def achar_fluxo(todos, nome, nomes_antigos=()):
    """Os fluxos da lista que se chamam `nome` ou um dos `nomes_antigos`; o de `nome` vem primeiro."""
    nomes = (nome, *nomes_antigos)
    return sorted((w for w in todos if w["name"] in nomes), key=lambda w: nomes.index(w["name"]))


def webhook_workflow(nome, caminho, webhook_id, planilha, gid, aba, coluna_chave, parametro, decidir_js, marca,
                     nome_do_no_marcar="Marcar como enviado", nomes_antigos=()):
    """Publica (ou atualiza) um fluxo de link rastreado.

    `nome_do_no_marcar`: nome do nó que grava `marca` na planilha. O padrão é o de sempre (os convites do PRUMO);
    o 04 do Site passa "Gravar clique_em", porque só grava o clique. `nomes_antigos`: nomes que este fluxo já
    teve; se o fluxo existe com um deles, é ele que é atualizado (e renomeado pelo id), em vez de criar um
    segundo fluxo com o mesmo path de webhook."""
    gatilho = f"Clique ({caminho})"
    nos = [
        {"id": "clique", "name": gatilho, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
         "webhookId": webhook_id, "parameters": {"httpMethod": "GET", "path": caminho, "responseMode": "responseNode", "options": {}}},
        {"id": "ler", "name": "Ler a linha", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [220, 0],
         "credentials": SHEETS, "alwaysOutputData": True, "executeOnce": True, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "read", **doc(planilha, gid, aba),
                        "filtersUI": {"values": [{"lookupColumn": coluna_chave,
                                                  "lookupValue": "={{ $json.query." + parametro + " }}"}]}, "options": {}}},
        {"id": "decidir", "name": "Decidir", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": decidir_js}},
        {"id": "primeiro", "name": "Primeiro clique?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [660, 0],
         "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                       "combinator": "and", "conditions": [{"id": "marcar", "leftValue": "={{ $json.marcar }}", "rightValue": "",
                                                                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
                        "options": {}}},
        {"id": "marcar", "name": nome_do_no_marcar, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [880, -120],
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(planilha, gid, aba),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": [coluna_chave],
                                    "value": {coluna_chave: "={{ $json.chave }}", **marca},
                                    "schema": schema([coluna_chave, *marca.keys()], coluna_chave)},
                        "options": {"cellFormat": "RAW"}}},
        {"id": "abrir", "name": "Abrir o canal", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [1100, 0],
         "parameters": {"respondWith": "redirect", "redirectURL": "={{ $('Decidir').first().json.destino }}", "options": {}}},
    ]
    con = {
        gatilho: {"main": [[{"node": "Ler a linha", "type": "main", "index": 0}]]},
        "Ler a linha": {"main": [[{"node": "Decidir", "type": "main", "index": 0}]]},
        "Decidir": {"main": [[{"node": "Primeiro clique?", "type": "main", "index": 0}]]},
        "Primeiro clique?": {"main": [[{"node": nome_do_no_marcar, "type": "main", "index": 0}],
                                      [{"node": "Abrir o canal", "type": "main", "index": 0}]]},
        nome_do_no_marcar: {"main": [[{"node": "Abrir o canal", "type": "main", "index": 0}]]},
    }
    todos = api("GET", "/workflows?limit=200")["data"]
    erro = next(w["id"] for w in todos if w["name"] == "00 · Avisar falha pelo Hermes")
    wf = {"name": nome, "nodes": nos, "connections": con,
          "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}
    existentes = achar_fluxo(todos, nome, nomes_antigos)
    if existentes:
        wf["id"] = existentes[0]["id"]
        put(wf)  # o PUT leva o nome novo: renomeia o fluxo antigo pelo id
        wid = wf["id"]
    else:
        wid = api("POST", "/workflows", wf)["id"]
    api("POST", f"/workflows/{wid}/activate")
    print(nome, "->", wid, f"{LINKS}/{caminho}")


DECIDIR_SITE = """const q = $('Clique (enviar)').first().json.query ?? {};
const pid = String(q.place_id ?? '');
// marcar=nao: só abre o WhatsApp, sem rastro (o observador grava "manual"). Sem ele, o clique num
// lead "pronto" grava clique_em: é o que o observador usa para manter a letra (nunca marca enviado).
const soAbrir = String(q.marcar ?? '') === 'nao';
const l = $input.first()?.json ?? {};
const achou = pid !== '' && l.place_id === pid;
const waMe = String(l.wa_me || '').trim() || (String(l.wa_link || '').startsWith('https://wa.me/') ? String(l.wa_link) : '');
// Sem wa.me (lead sem telefone ou não achado): abre a planilha para decidir à mão.
const destino = achou && waMe ? waMe : 'https://docs.google.com/spreadsheets/d/""" + SITE + """/edit#gid=""" + LEADS_GID + """';
return [{ json: { chave: pid, destino, marcar: !soAbrir && achou && waMe !== '' && String(l.status).trim() === 'pronto', agora: new Date().toISOString() } }];"""


if __name__ == "__main__":
    webhook_workflow(NOME_DO_04, "enviar", "5b1c2d3e-4f50-4a61-8b72-c3d4e5f60001",
                     SITE, LEADS_GID, "Leads", "place_id", "place_id", DECIDIR_SITE,
                     {"clique_em": "={{ $json.agora }}"},
                     nome_do_no_marcar="Gravar clique_em", nomes_antigos=(NOME_ANTIGO_DO_04,))
