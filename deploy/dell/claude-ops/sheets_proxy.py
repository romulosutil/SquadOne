"""Chamadas diretas à API do Google Sheets usando a credencial OAuth do n8n.

A credencial é cifrada dentro do n8n; em vez de extrair token, o script cria
um workflow temporário (webhook -> HTTP Request com a credencial) que só aceita
URLs das planilhas listadas, usa e apaga no fim.

    with SheetsProxy([PLANILHA]) as s:
        s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")
        s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": [...]})
"""
import json
import time
import urllib.request

from n8n import api

SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
BASE = "https://sheets.googleapis.com"


class SheetsProxy:
    def __init__(self, planilhas):
        self.planilhas = planilhas
        self.caminho = f"sheets-proxy-{int(time.time())}"

    def __enter__(self):
        permitido = json.dumps([f"{BASE}/v4/spreadsheets/{p}" for p in self.planilhas])
        validar = ("const b = $json.body ?? {};\n"
                   f"const ok = {permitido}.some(p => String(b.url ?? '').startsWith(p));\n"
                   "if (!ok) throw new Error('URL fora das planilhas permitidas');\n"
                   "return [{ json: { method: b.method === 'GET' ? 'GET' : 'POST', url: b.url, corpo: b.body ?? {} } }];")
        http = lambda nome, metodo, x, extra: {
            "id": nome, "name": nome, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, 0],
            "credentials": SHEETS, "parameters": {
                "method": metodo, "url": "={{ $json.url }}", "authentication": "predefinedCredentialType",
                "nodeCredentialType": "googleSheetsOAuth2Api", **extra,
                "options": {"response": {"response": {"neverError": True, "fullResponse": False}}}}}
        nos = [
            {"id": "w", "name": "Chamada", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
             "webhookId": "0c1d2e3f-4a5b-4c6d-8e7f-" + str(int(time.time()))[-12:].rjust(12, "0"),
             "parameters": {"httpMethod": "POST", "path": self.caminho, "responseMode": "lastNode", "options": {}}},
            {"id": "v", "name": "Validar", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [200, 0],
             "parameters": {"jsCode": validar}},
            {"id": "se", "name": "GET?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [400, 0],
             "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                           "combinator": "and", "conditions": [{"id": "g", "leftValue": "={{ $json.method }}", "rightValue": "GET",
                                                                                "operator": {"type": "string", "operation": "equals"}}]}, "options": {}}},
            http("Ler", "GET", 600, {}),
            http("Escrever", "POST", 600, {"sendBody": True, "contentType": "json", "specifyBody": "json",
                                           "jsonBody": "={{ JSON.stringify($json.corpo) }}"}),
        ]
        con = {"Chamada": {"main": [[{"node": "Validar", "type": "main", "index": 0}]]},
               "Validar": {"main": [[{"node": "GET?", "type": "main", "index": 0}]]},
               "GET?": {"main": [[{"node": "Ler", "type": "main", "index": 0}], [{"node": "Escrever", "type": "main", "index": 0}]]}}
        self.wf = api("POST", "/workflows", {"name": "ZZ proxy Sheets (apagar)", "nodes": nos, "connections": con,
                                             "settings": {"executionOrder": "v1"}})
        api("POST", f"/workflows/{self.wf['id']}/activate")
        time.sleep(2)
        return self

    def _chamar(self, metodo, caminho, corpo=None):
        dados = json.dumps({"method": metodo, "url": BASE + caminho, "body": corpo or {}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:5679/webhook/{self.caminho}", data=dados, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            resposta = json.loads(r.read() or b"{}")
        if isinstance(resposta, dict) and resposta.get("error"):
            raise RuntimeError(f"{metodo} {caminho}: {json.dumps(resposta['error'], ensure_ascii=False)[:500]}")
        return resposta

    def get(self, caminho):
        return self._chamar("GET", caminho)

    def post(self, caminho, corpo):
        return self._chamar("POST", caminho, corpo)

    def __exit__(self, *exc):
        api("POST", f"/workflows/{self.wf['id']}/deactivate")
        api("DELETE", f"/workflows/{self.wf['id']}")
        return False
