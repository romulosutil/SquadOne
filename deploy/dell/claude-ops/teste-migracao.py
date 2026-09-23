"""Viabilidade da migração do Site antes da venda para o n8n do Dell:
a credencial Google do Dell lê a planilha de leads? O n8n cria subpastas em
/home/node/.n8n-files/auto (espelho do G:\\Meu Drive\\auto)? Tudo num fluxo
descartável que é apagado no fim.
"""
import json
import os
import shutil
import time
import urllib.request

from n8n import api

PLANILHA = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o"
SHEETS_CRED = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}

nos = [
    {"id": "w", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
     "parameters": {"httpMethod": "POST", "path": "teste-migracao-claude", "responseMode": "lastNode"},
     "webhookId": "7b9f0c1e-0000-4000-8000-migracao0001"},
    {"id": "s", "name": "Ler Buscas", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [220, 0],
     "parameters": {"resource": "sheet", "operation": "read",
                    "documentId": {"__rl": True, "mode": "id", "value": PLANILHA},
                    "sheetName": {"__rl": True, "mode": "id", "value": "52197070"}, "options": {}},
     "credentials": SHEETS_CRED, "executeOnce": True, "alwaysOutputData": True},
    {"id": "c", "name": "Montar arquivo", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0],
     "parameters": {"jsCode": "const linhas = $input.all();\n"
                    "const txt = 'linhas=' + linhas.length + ' colunas=' + Object.keys(linhas[0]?.json ?? {}).join(',');\n"
                    "return [{ json: { txt }, binary: { data: { data: Buffer.from(txt).toString('base64'), mimeType: 'text/plain', fileName: 't.txt' } } }];"}},
    {"id": "f", "name": "Gravar em subpasta nova", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
     "position": [660, 0], "parameters": {"operation": "write",
                                          "fileName": "/home/node/.n8n-files/auto/_teste-claude/sub/teste.txt",
                                          "dataPropertyName": "data"}},
]
con = {"Webhook": {"main": [[{"node": "Ler Buscas", "type": "main", "index": 0}]]},
       "Ler Buscas": {"main": [[{"node": "Montar arquivo", "type": "main", "index": 0}]]},
       "Montar arquivo": {"main": [[{"node": "Gravar em subpasta nova", "type": "main", "index": 0}]]}}

t = api("POST", "/workflows", {"name": "ZZ teste migração (apagar)", "nodes": nos, "connections": con,
                               "settings": {"executionOrder": "v1"}})
try:
    api("POST", f"/workflows/{t['id']}/activate")
    time.sleep(2)
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            "http://127.0.0.1:5679/webhook/teste-migracao-claude", data=b"{}", method="POST",
            headers={"Content-Type": "application/json"}), timeout=60).read()
        print("resposta:", r[:300])
    except urllib.error.HTTPError as e:
        print("webhook erro", e.code, e.read()[:300])
    time.sleep(2)
    ex = api("GET", f"/executions?workflowId={t['id']}&limit=1&includeData=true")["data"]
    for e in ex:
        for nome, runs in e["data"]["resultData"]["runData"].items():
            err = (runs[0].get("error") or {}).get("message")
            itens = len(((runs[0].get("data") or {}).get("main") or [[]])[0] or [])
            print(f"  {nome}: {runs[0].get('executionStatus')} itens={itens} {err or ''}")
    caminho = os.path.expanduser("~/auto-site/_teste-claude/sub/teste.txt")
    print("arquivo no host:", open(caminho).read() if os.path.exists(caminho) else "NÃO criado")
finally:
    api("POST", f"/workflows/{t['id']}/deactivate")
    api("DELETE", f"/workflows/{t['id']}")
    shutil.rmtree(os.path.expanduser("~/auto-site/_teste-claude"), ignore_errors=True)
    print("teste removido")
