"""Acrescenta `origem` aos avisos que os fluxos VIVOS do n8n gravam na fila do
dell-status (~/.local/share/avisos/fila).

Desde 06/10/2026 o dell-status recusa aviso sem `origem`. Os geradores daqui
(`n8n.aviso_nodes`, `site-acompanhamento.py`) já a incluem, mas os fluxos
publicados antes disso têm o JSON montado sem ela. Este script troca, nos nós
Code, `JSON.stringify({ titulo..., texto })` por
`JSON.stringify({ titulo..., texto, origem: 'n8n:' + nome do fluxo })` e
republica o fluxo. Idempotente: nó que já tem `origem` é pulado.

Rode ANTES de instalar o dell-status novo: o antigo ignora o campo a mais, o
novo recusa aviso sem ele.

  python3 aviso-origem.py            # só mostra o que mudaria
  python3 aviso-origem.py --aplicar  # grava e republica os fluxos ativos
"""
import re
import sys

from n8n import ORIGEM_JS, api, put

MONTAGEM = re.compile(r'JSON\.stringify\(\{ titulo(?P<valor>: "[^"\n]*")?, texto \}\)')


def com_origem(js: str) -> tuple[str, int]:
    return MONTAGEM.subn(lambda m: "JSON.stringify({ titulo" + (m.group("valor") or "") + ", texto, " + ORIGEM_JS + " })", js)


def main() -> int:
    aplicar = "--aplicar" in sys.argv[1:]
    mudou = 0
    for resumo in api("GET", "/workflows?limit=250")["data"]:
        wf = api("GET", f"/workflows/{resumo['id']}")
        trocas = []
        for no in wf["nodes"]:
            js = (no.get("parameters") or {}).get("jsCode")
            if not isinstance(js, str) or "titulo" not in js:
                continue
            novo, n = com_origem(js)
            if n:
                no["parameters"]["jsCode"] = novo
                trocas.append(f"{no['name']} ({n})")
            elif "JSON.stringify" in js and "origem" not in js and "texto" in js:
                print(f"  ATENÇÃO {wf['name']} | {no['name']}: monta aviso num formato que não reconheço; ajuste à mão")
        if not trocas:
            continue
        mudou += 1
        print(("ajustado: " if aplicar else "mudaria: ") + wf["name"] + " -> " + ", ".join(trocas))
        if aplicar:
            put(wf)
            if resumo.get("active"):
                api("POST", f"/workflows/{resumo['id']}/activate")  # republica a versão nova
    print(f"{mudou} fluxo(s) {'ajustados' if aplicar else 'a ajustar (rode com --aplicar)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
