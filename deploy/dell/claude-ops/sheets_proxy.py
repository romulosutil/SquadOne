"""Chamadas diretas à API do Google Sheets usando a credencial OAuth do n8n.

A credencial é cifrada dentro do n8n; em vez de extrair token, o script cria
um workflow temporário (webhook -> HTTP Request com a credencial) que só aceita
URLs das planilhas listadas, usa e apaga no fim.

O webhook é ATIVO enquanto o proxy vive e usa a credencial do Google, então: o path leva um
sufixo aleatório (secrets.token_urlsafe, não adivinhável), o nó "Validar" exige um header com um
segredo gerado na hora (descartado ao sair) e, ao entrar, o proxy apaga os "ZZ proxy Sheets"
que sobraram de um script que morreu no meio (só os criados há mais de 15 minutos, para não
derrubar o de outro script em andamento).

    with SheetsProxy([PLANILHA]) as s:
        s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")
        s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": [...]})
"""
import json
import secrets
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from n8n import api

SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
BASE = "https://sheets.googleapis.com"
NOME_DO_FLUXO = "ZZ proxy Sheets (apagar)"
HEADER_DO_SEGREDO = "x-proxy-segredo"


def apagar_sobras(minutos=15):
    """Apaga os proxies que um script morto deixou ativos (criados há mais de `minutos`)."""
    limite = datetime.now(timezone.utc) - timedelta(minutes=minutos)
    for w in api("GET", "/workflows?limit=250")["data"]:
        if not w["name"].startswith("ZZ proxy Sheets"):
            continue
        criado = datetime.fromisoformat(str(w.get("createdAt", "")).replace("Z", "+00:00")) if w.get("createdAt") else limite
        if criado.tzinfo is None:
            criado = criado.replace(tzinfo=timezone.utc)
        if criado <= limite:
            try:  # api() sai com SystemExit no erro HTTP; limpar sobra não pode impedir o trabalho de verdade
                api("POST", f"/workflows/{w['id']}/deactivate")
                api("DELETE", f"/workflows/{w['id']}")
                print(f"sheets_proxy: apaguei o proxy esquecido {w['id']} (criado em {w.get('createdAt')})")
            except SystemExit as e:
                print(f"sheets_proxy: não consegui apagar o proxy esquecido {w['id']}: {e}")


class SheetsProxy:
    def __init__(self, planilhas):
        self.planilhas = planilhas
        self.caminho = "sheets-proxy-" + secrets.token_urlsafe(24)
        self.segredo = secrets.token_urlsafe(32)
        self.wf = None

    def __enter__(self):
        apagar_sobras()
        permitido = json.dumps([f"{BASE}/v4/spreadsheets/{p}" for p in self.planilhas])
        validar = (f"if (($json.headers ?? {{}})[{json.dumps(HEADER_DO_SEGREDO)}] !== {json.dumps(self.segredo)}) throw new Error('não autorizado');\n"
                   "const b = $json.body ?? {};\n"
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
             "webhookId": "0c1d2e3f-4a5b-4c6d-8e7f-" + secrets.token_hex(6),
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
        self.wf = api("POST", "/workflows", {"name": NOME_DO_FLUXO, "nodes": nos, "connections": con,
                                             "settings": {"executionOrder": "v1"}})
        try:
            api("POST", f"/workflows/{self.wf['id']}/activate")
            time.sleep(2)
        except BaseException:
            self.__exit__(None, None, None)  # ativar falhou: não deixa um proxy para trás
            raise
        return self

    def _chamar(self, metodo, caminho, corpo=None):
        dados = json.dumps({"method": metodo, "url": BASE + caminho, "body": corpo or {}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:5679/webhook/{self.caminho}", data=dados, method="POST",
                                     headers={"Content-Type": "application/json", HEADER_DO_SEGREDO: self.segredo})
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
