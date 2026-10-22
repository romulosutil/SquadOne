"""Contexto canônico da Prumo em todo início de execução do n8n; sem IO na transformação."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path

PREFIXO = "prumo-organizacao-"
GATILHOS = {"scheduleTrigger", "manualTrigger", "webhook", "executeWorkflowTrigger", "formTrigger", "errorTrigger", "cron"}


def carregar(raiz=None):
    raiz = Path(raiz or os.environ.get("PRUMO_REPO", str(Path.home() / "prumo")))
    doc = (raiz / "00-contexto/organizacao.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    catalogo = json.loads((raiz / "06-qualidade/catalogo.json").read_text(encoding="utf-8"))
    return {"versao": 1, "organizacao_sha256": hashlib.sha256(doc.encode()).hexdigest(),
            "origem": "https://github.com/romulosutil/prumo/blob/main/00-contexto/organizacao.md",
            "organizacao": doc, "familias": catalogo["familias"],
            "produtos": {p["id"]: p["nome"] for p in catalogo["produtos"]},
            "regra": "Profissional exige 100% dos obrigatórios e IQS completo. Pronto no funil não é selo de qualidade. A publicação é validada pelo executor sobre os bytes finais.",
            "indices": {"conformidade": "0–100% dos obrigatórios", "iqs": "Comunicação e Estrutura, 50% cada", "indice_prumo": "0–18, diagnóstico do cliente"}}


def do_escopo(wf):
    nome = wf.get("name", "").casefold()
    return any(x in nome for x in ("prumo", "site antes da venda", "01 · caçador", "whatsapp —", "04 · clique no wa_link", "00 · avisar falha"))


def preparar(wf, contexto, forcar=False):
    if not forcar and not do_escopo(wf):
        return wf
    out = deepcopy(wf)
    codigo = ("// Gerado de prumo/00-contexto/organizacao.md. Não editar a cópia.\n"
              "const contexto = " + json.dumps(contexto, ensure_ascii=False) + ";\n"
              "if (contexto.versao !== 1 || !contexto.organizacao_sha256) throw new Error('Contexto Prumo inválido');\n"
              "$getWorkflowStaticData('global').prumo_contexto = contexto;\n"
              "return $input.all();")
    nos = out.setdefault("nodes", [])
    conexoes = out.setdefault("connections", {})
    for n in list(nos):
        # O contexto também acompanha subworkflows de persistência reconstruídos pelos outros guards.
        p = n.get("parameters", {})
        filho = p.get("workflowJson")
        if isinstance(filho, str):
            try:
                p["workflowJson"] = json.dumps(preparar(json.loads(filho), contexto, True), ensure_ascii=False)
            except json.JSONDecodeError:
                pass
        if n.get("disabled") or n.get("type", "").split(".")[-1] not in GATILHOS:
            continue
        id_ = PREFIXO + n["id"]
        nome = "Prumo · organização · " + n["name"]
        existentes = [x for x in nos if x.get("id") == id_ or x.get("id", "").startswith(id_ + " · ")]
        if existentes:
            for existente in existentes:
                existente["parameters"]["jsCode"] = codigo
                existente["notes"] = "Fonte canônica: " + contexto["origem"] + " · SHA256 " + contexto["organizacao_sha256"]
            continue
        saida = conexoes.get(n["name"])
        if not saida or not saida.get("main"):
            continue
        # Um nó por saída preserva o roteamento original de webhooks com múltiplos ramos.
        for indice, destinos in enumerate(saida["main"]):
            if not destinos:
                continue
            sufixo = "" if indice == 0 else f" · {indice}"
            novo = {"id": id_ + sufixo, "name": nome + sufixo, "type": "n8n-nodes-base.code", "typeVersion": 2,
                    "position": [n.get("position", [0, 0])[0] + 160, n.get("position", [0, 0])[1] + 100 * indice],
                    "parameters": {"mode": "runOnceForAllItems", "jsCode": codigo},
                    "notes": "Fonte canônica: " + contexto["origem"] + " · SHA256 " + contexto["organizacao_sha256"]}
            nos.append(novo)
            conexoes[novo["name"]] = {"main": [deepcopy(destinos)]}
            destinos[:] = [{"node": novo["name"], "type": "main", "index": 0}]
    return out
