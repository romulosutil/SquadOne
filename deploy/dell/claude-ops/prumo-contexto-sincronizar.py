"""Sincroniza o contexto da Prumo nos workflows sem alterar seus estados ativos."""
import argparse
import json
from pathlib import Path
from datetime import datetime

from prumo_contexto import carregar, do_escopo, preparar


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aplicar", action="store_true")
    args = ap.parse_args()
    from n8n import api, put
    contexto = carregar()
    if args.aplicar:
        espelho = Path.home() / ".local/share/prumo-contexto"
        espelho.mkdir(parents=True, exist_ok=True, mode=0o700)
        for nome, texto in (("organizacao.md", contexto["organizacao"]), ("contexto.json", json.dumps(contexto, ensure_ascii=False, indent=2))):
            tmp = espelho / (nome + ".tmp")
            tmp.write_text(texto, encoding="utf-8")
            tmp.replace(espelho / nome)
    pasta = Path.home() / ".local/share/claude-ops/backups" / ("contexto-prumo-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    modificados = []
    caminho = "/workflows?limit=100"
    while caminho:
        pagina = api("GET", caminho)
        for resumo in pagina["data"]:
            if not do_escopo(resumo):
                continue
            wf = api("GET", "/workflows/" + resumo["id"])
            preparado = preparar(wf, contexto)
            if preparado == wf:
                continue
            if args.aplicar:
                pasta.mkdir(parents=True, exist_ok=True, mode=0o700)
                backup = pasta / (wf["id"] + ".json")
                backup.write_text(json.dumps(wf, ensure_ascii=False), encoding="utf-8")
                backup.chmod(0o600)
                # A chamada passa pelo guard permanente e preserva settings e credenciais.
                put(preparado)
                atual = api("GET", "/workflows/" + wf["id"])
                if bool(atual["active"]) != bool(wf["active"]):
                    raise RuntimeError("Estado ativo mudou inesperadamente: " + wf["id"])
                # PUT não deve depender de publicar a versão editada manualmente no editor.
                if wf["active"]:
                    api("POST", "/workflows/" + wf["id"] + "/activate")
            modificados.append({"id": wf["id"], "nome": wf["name"], "ativo": wf["active"]})
        cursor = pagina.get("nextCursor")
        if cursor:
            from urllib.parse import quote
            caminho = "/workflows?limit=100&cursor=" + quote(cursor)
        else:
            caminho = None
    print(json.dumps({"aplicado": args.aplicar, "organizacao_sha256": contexto["organizacao_sha256"], "workflows": modificados}, ensure_ascii=False))


if __name__ == "__main__":
    main()
