"""Filtro de porte pelo CNPJ no Lead Scout do PRUMO (idempotente).

O Lead Scout media o porte pelo número de avaliações no Google e trazia redes
(Assaí, Royal) e micros (MEI, site no Netlify, 1 avaliação). Agora, depois da
pontuação, o nó "Porte — conferir CNPJ" (código em prumo-porte-cnpj.js) acha o
CNPJ no site, consulta a Receita e descarta MEI/microempresa, CNPJ baixado,
atividade fora do comércio, rede e empresa com menos de 1 ano. O motivo vai
para Descartados; quem passa leva o resumo do CNPJ na coluna Briefing.

Também tira "atacadista" solto do rodízio (a busca que trazia hipermercado).

Roda sobre o Lead Scout que está no n8n (inativo desde 08/10/2026, n8n.DESLIGADOS): nenhum construtor o
recria mais (prumo-simples.py não tem mais o ramo do Lead Scout, e os remendos que o montavam foram apagados em
19/10/2026). O fluxo vivo já traz os nós que este script pressupõe ("Remover duplicados", "Linha de prospect",
"Config — mercado-alvo"...); se algum faltar, o script para sem mexer em nada. Ligar o Lead Scout de novo é
decisão à parte (tirar o id de DESLIGADOS e ativar no n8n).
"""
from pathlib import Path

from n8n import api, put

LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"
PORTE = "Porte — conferir CNPJ"
CODIGO = (Path(__file__).parent / "prumo-porte-cnpj.js").read_text(encoding="utf-8")
DEPOIS = ["É prospect?", "Linha de prospect", "Linha de descarte", "Gravar prospect", "Gravar descarte"]


def main():
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    nos = {n["name"]: n for n in wf["nodes"]}
    faltam = [n for n in ("Config — mercado-alvo", "Remover duplicados", "É prospect?", "Linha de prospect",
                          "Resumo da busca: montar aviso") if n not in nos]
    if faltam:
        raise SystemExit(f"Lead Scout sem os nós {faltam}: nada aplicado (o fluxo não é o que este script pressupõe).")

    cfg = nos["Config — mercado-alvo"]["parameters"]
    cfg["jsCode"] = cfg["jsCode"].replace("'distribuidora de bebidas', 'atacadista',", "'distribuidora de bebidas',")

    if PORTE not in nos:
        x, y = nos["É prospect?"]["position"]
        for nome in DEPOIS:
            nos[nome]["position"] = [nos[nome]["position"][0] + 240, nos[nome]["position"][1]]
        no = {"id": "prumo-porte-cnpj", "name": PORTE, "type": "n8n-nodes-base.code", "typeVersion": 2,
              "position": [x, y], "parameters": {"mode": "runOnceForAllItems", "jsCode": ""}}
        wf["nodes"].append(no)
        nos[PORTE] = no
    nos[PORTE]["parameters"]["jsCode"] = CODIGO

    con = wf["connections"]
    con["Remover duplicados"] = {"main": [[{"node": PORTE, "type": "main", "index": 0}]]}
    con[PORTE] = {"main": [[{"node": "É prospect?", "type": "main", "index": 0}]]}

    linha = nos["Linha de prospect"]["parameters"]
    linha["jsCode"] = linha["jsCode"].replace(
        "'Próxima ação': 'Veja o site; se fizer sentido, clique em Enviar convite.', 'Briefing': '',",
        "'Próxima ação': l.proxima_acao ?? 'Veja o site; se fizer sentido, clique em Enviar convite.', 'Briefing': l.porte_resumo ?? '',")
    assert "l.porte_resumo" in linha["jsCode"], "Linha de prospect mudou: revise o replace"

    resumo = nos["Resumo da busca: montar aviso"]["parameters"]
    resumo["jsCode"] = resumo["jsCode"].replace(
        'As que publicam WhatsApp no site entram como "Revisar" na fila.',
        'As que publicam WhatsApp no site e passam no filtro de porte (CNPJ) entram como "Revisar" na fila.')

    put(wf)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    vivo = api("GET", f"/workflows/{LEAD_SCOUT}")
    ligado = vivo["connections"]["Remover duplicados"]["main"][0][0]["node"] == PORTE
    print(f"Lead Scout com filtro de porte: {'ok' if ligado else 'FALHOU'} (ativo={vivo['active']})")


if __name__ == "__main__":
    main()
