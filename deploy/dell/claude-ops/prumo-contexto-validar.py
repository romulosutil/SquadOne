"""Ensaio real do contexto no n8n, isolado e sem ações comerciais."""
import json
import urllib.request
import uuid

from n8n import api
from prumo_contexto import carregar


def main():
    contexto = carregar()
    rota = "prumo-contexto-qa-" + uuid.uuid4().hex
    wf = {"name": "PRUMO · QA isolado de contexto", "nodes": [
        {"id": "entrada", "name": "Entrada sintética", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
         "position": [0, 0], "parameters": {"httpMethod": "POST", "path": rota, "responseMode": "lastNode", "options": {}}},
        {"id": "validacao", "name": "Conferir contexto e dados", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [400, 0], "parameters": {"jsCode": "const c=$getWorkflowStaticData('global').prumo_contexto;return [{json:{sha:c.organizacao_sha256,entrada:$input.first().json.body}}];"}}
    ], "connections": {"Entrada sintética": {"main": [[{"node": "Conferir contexto e dados", "type": "main", "index": 0}]]}},
        "settings": {"executionOrder": "v1"}}
    criado = api("POST", "/workflows", wf)
    id_ = criado["id"]
    try:
        api("POST", f"/workflows/{id_}/activate")
        req = urllib.request.Request("http://127.0.0.1:5679/webhook/" + rota, data=b'{"teste":"contexto-sem-envio"}',
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=40) as r:
            resultado = json.load(r)
        if isinstance(resultado, list):
            resultado = resultado[0]
        if resultado["sha"] != contexto["organizacao_sha256"] or resultado["entrada"] != {"teste": "contexto-sem-envio"}:
            raise RuntimeError("Contexto ou dados divergiram no ensaio")
        print(json.dumps({"n8n_real": "aprovado", "contexto_sha256": resultado["sha"], "dados_preservados": True, "mensagens_enviadas": 0}))
    finally:
        api("POST", f"/workflows/{id_}/deactivate")
        api("DELETE", f"/workflows/{id_}")


if __name__ == "__main__":
    main()
