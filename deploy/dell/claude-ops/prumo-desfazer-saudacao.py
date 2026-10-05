"""Desfaz as "respostas" do PRUMO que eram a saudação automática do WhatsApp (05/10/2026).

Até 05/10/2026 o fluxo "WhatsApp — conversa com lead" marcava "Respondeu no
WhatsApp em ..." na Próxima ação de qualquer prospect em "Convite enviado" que
escrevesse, saudação automática do WhatsApp Business incluída (ver
whatsapp-conversa.py). 20 prospects ficaram assim, todos com a "resposta" até
cerca de 5 min depois do convite e 17 em menos de 1 min; 18 estavam em "Convite
enviado" e o CRM os mostrava como "Conversando", com "Respostas para responder"
que não existiam. Os 2 em "Sem interesse" não são tocados.

Este script devolve a Próxima ação desses prospects ao texto do convite
("Aguarde o dono responder ..."), e só mexe nessa coluna: Etapa, datas e o resto
da linha ficam como estão. O critério é conservador: a hora da marca só tem
minuto, então vale o fim do minuto, e só volta quem comprovadamente respondeu a
menos de 5 min do convite. Quem respondeu depois fica como está.

Limite conhecido: o fluxo antigo só gravava a primeira mensagem do lead e
ignorava o segundo aviso do observador. Se algum desses prospects respondeu de
verdade depois da saudação, isso nunca foi registrado; ao voltar para "Convite
enviado" ele cai no follow-up do 3º dia, e quem conferir a conversa no WhatsApp
resolve. O script grava os valores antigos em ~/Arquivo/<data>/ antes de
mexer, para desfazer.

Uso: python3 prumo-desfazer-saudacao.py            simula com o retrato da Central (não toca no n8n nem na planilha)
     python3 prumo-desfazer-saudacao.py --aplicar  lê a planilha ao vivo (fluxo temporário do n8n), guarda o
                                                   backup e grava só a coluna Próxima ação das linhas afetadas
     python3 prumo-desfazer-saudacao.py --testar   testa o critério com casos de mentira
"""
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

PLANILHA = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U"
ABA = "Prospects"
FUSO = ZoneInfo("America/Sao_Paulo")
RETRATO = Path.home() / ".local/share/n8n-estado/crm.json"
SAUDACAO_S = 5 * 60
# Mesmo texto que o fluxo grava no clique de "Enviar convite" (CONVITE em whatsapp-conversa.py).
CONVITE = "Aguarde o dono responder (16 perguntas, uns 10 minutos). Sem resposta em 3 dias, ofereça fazer por telefone."
RESPONDEU = re.compile(r"^Respondeu no WhatsApp em (\d\d)/(\d\d), (\d\d):(\d\d)")


def era_saudacao(etapa, proxima_acao, convite_em):
    """('sim' | 'nao' | 'sem data' | 'n/a', segundos entre o convite e o fim do minuto da marca)."""
    m = RESPONDEU.match(str(proxima_acao or "").strip())
    if etapa != "Convite enviado" or not m:
        return "n/a", None
    try:
        envio = datetime.fromisoformat(str(convite_em).replace("Z", "+00:00")).astimezone(FUSO)
    except ValueError:
        return "sem data", None
    dia, mes, hora, minuto = (int(x) for x in m.groups())
    try:
        resposta = datetime(envio.year, mes, dia, hora, minuto, tzinfo=FUSO)
        if resposta < envio - timedelta(days=30):  # virada do ano: convite em dezembro, marca em janeiro
            resposta = resposta.replace(year=envio.year + 1)
    except ValueError:
        return "sem data", None
    ate = (resposta + timedelta(seconds=59) - envio).total_seconds()
    return ("sim" if ate < SAUDACAO_S else "nao"), ate


def classificar(linhas):
    """linhas: dicts com ID, Empresa, Etapa, 'Convite enviado em', 'Próxima ação' e a linha da planilha."""
    sim, nao, sem_data = [], [], []
    for l in linhas:
        veredito, ate = era_saudacao(l.get("Etapa"), l.get("Próxima ação"), l.get("Convite enviado em"))
        if veredito == "sim":
            sim.append({**l, "segundos": ate})
        elif veredito == "nao":
            nao.append({**l, "segundos": ate})
        elif veredito == "sem data":
            sem_data.append(l)
    return sim, nao, sem_data


def do_retrato():
    f = json.loads(RETRATO.read_text(encoding="utf-8"))["fontes"]["prumo"]
    return [{**l, "linha": int(l["row_number"])} for l in f["linhas"]]


def da_planilha(s):
    v = s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote(f"{ABA}!A1:P1000") + "?valueRenderOption=FORMULA").get("values", [])
    cab = v[0]
    for nome in ("ID", "Empresa", "Etapa", "Convite enviado em", "Próxima ação"):
        if nome not in cab:
            raise SystemExit(f"coluna {nome!r} não está na aba {ABA}: {cab}. Nada foi mudado.")
    linhas = []
    for n, l in enumerate(v[1:], start=2):  # linha da planilha, contando o cabeçalho; linhas vazias entram na conta
        l = l + [""] * (len(cab) - len(l))
        if any(l):
            linhas.append({**dict(zip(cab, l)), "linha": n})
    return cab, linhas


def mostrar(sim, nao, sem_data):
    print(f"Voltam para 'Convite enviado' ({len(sim)}): resposta a menos de 5 min do convite")
    for l in sorted(sim, key=lambda x: x["linha"]):
        print(f"  linha {l['linha']:>3} | {l['segundos']:6.0f}s | {str(l['Empresa'])[:42]:42} | {l['Próxima ação'][:46]}")
    print(f"Ficam como estão ({len(nao)}): resposta a 5 min ou mais do convite")
    for l in nao:
        print(f"  linha {l['linha']:>3} | {l['segundos']:6.0f}s | {str(l['Empresa'])[:42]}")
    if sem_data:
        print(f"Ficam como estão ({len(sem_data)}): sem 'Convite enviado em' legível, não dá para saber")
        for l in sem_data:
            print(f"  linha {l['linha']:>3} | {str(l['Empresa'])[:42]}")


def main(aplicar):
    if not aplicar:
        sim, nao, sem_data = classificar(do_retrato())
        mostrar(sim, nao, sem_data)
        print("Simulação com o retrato da Central: nada foi gravado. --aplicar relê a planilha ao vivo e grava.")
        return
    from sheets_proxy import SheetsProxy

    with SheetsProxy([PLANILHA]) as s:
        cab, linhas = da_planilha(s)
        sim, nao, sem_data = classificar(linhas)
        mostrar(sim, nao, sem_data)
        if not sim:
            print("Nada a desfazer.")
            return
        pasta = Path.home() / "Arquivo" / date.today().isoformat()
        pasta.mkdir(parents=True, exist_ok=True)
        backup = pasta / "prumo-saudacao-antes.json"
        backup.write_text(json.dumps([{"linha": l["linha"], "ID": l["ID"], "Empresa": l["Empresa"], "antes": l["Próxima ação"]}
                                      for l in sim], ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Valores antigos guardados em {backup}")
        col = chr(ord("A") + cab.index("Próxima ação"))
        dados = [{"range": f"{ABA}!{col}{l['linha']}", "values": [[CONVITE]]} for l in sim]
        s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchUpdate", {"valueInputOption": "RAW", "data": dados})
        # Confere relendo: as linhas escolhidas ficaram com o texto do convite e as demais não mudaram.
        antes = {l["linha"]: l["Próxima ação"] for l in linhas}
        escolhidas = {l["linha"] for l in sim}
        _, depois = da_planilha(s)
        feitas = sum(1 for l in depois if l["linha"] in escolhidas and l["Próxima ação"] == CONVITE)
        mexidas = [l["linha"] for l in depois if l["linha"] not in escolhidas and l["Próxima ação"] != antes.get(l["linha"])]
        print(f"{feitas} de {len(sim)} linhas voltaram para o texto do convite" + (f"; CONFIRA as linhas {mexidas}" if mexidas else "."))


# ---------------------------------------------------------------- teste (sem n8n nem planilha)

def testar():
    import unittest

    def linha(proxima, convite="2026-10-05T12:41:32.065Z", etapa="Convite enviado", **k):
        return {"linha": 9, "ID": "x", "Empresa": "Empresa Teste", "Etapa": etapa, "Convite enviado em": convite,
                "Próxima ação": proxima, **k}

    class Criterio(unittest.TestCase):
        def veredito(self, proxima, **k):
            l = linha(proxima, **k)
            return era_saudacao(l["Etapa"], l["Próxima ação"], l["Convite enviado em"])[0]

        def test_resposta_no_mesmo_minuto_do_convite_e_saudacao(self):
            # convite 09:41:32 (hora de Brasília), marca 09:41: até 09:41:59, 27 s depois.
            veredito, ate = era_saudacao("Convite enviado", "Respondeu no WhatsApp em 05/10, 09:41. Continue a conversa.",
                                         "2026-10-05T12:41:32.065Z")
            self.assertEqual(veredito, "sim")
            self.assertAlmostEqual(ate, 26.935, places=3)

        def test_limite_de_5_min_usa_o_fim_do_minuto(self):
            # convite 09:50:00: marca 09:54 (até 09:54:59 = 299 s) ainda é saudação; 09:55 (até 359 s) não se sabe.
            self.assertEqual(self.veredito("Respondeu no WhatsApp em 05/10, 09:54.", convite="2026-10-05T12:50:00Z"), "sim")
            self.assertEqual(self.veredito("Respondeu no WhatsApp em 05/10, 09:55.", convite="2026-10-05T12:50:00Z"), "nao")

        def test_resposta_dias_depois_fica(self):
            self.assertEqual(self.veredito("Respondeu no WhatsApp em 07/10, 14:20.", convite="2026-10-05T12:41:00Z"), "nao")

        def test_virada_do_ano(self):
            # convite 31/12 23:58 (Brasília = 02:58Z de 01/01), marca 01/01 00:00.
            self.assertEqual(self.veredito("Respondeu no WhatsApp em 01/01, 00:00.", convite="2027-01-01T02:58:00Z"), "sim")

        def test_sem_data_do_convite_nao_arrisca(self):
            self.assertEqual(self.veredito("Respondeu no WhatsApp em 05/10, 09:41.", convite=""), "sem data")
            self.assertEqual(self.veredito("Respondeu no WhatsApp em 05/10, 09:41.", convite="não é data"), "sem data")

        def test_so_mexe_em_convite_enviado_que_diz_respondeu(self):
            self.assertEqual(self.veredito("Leu o convite em 05/10, 09:41."), "n/a")
            self.assertEqual(self.veredito(CONVITE), "n/a")
            for etapa in ("Revisar", "Diagnóstico pronto", "Concluído", "Sem interesse"):
                self.assertEqual(self.veredito("Respondeu no WhatsApp em 05/10, 09:41.", etapa=etapa), "n/a")

        def test_classificar_separa_os_tres_grupos(self):
            sim, nao, sem = classificar([linha("Respondeu no WhatsApp em 05/10, 09:41."),
                                         linha("Respondeu no WhatsApp em 06/10, 10:00."),
                                         linha("Respondeu no WhatsApp em 05/10, 09:41.", convite=""),
                                         linha(CONVITE)])
            self.assertEqual((len(sim), len(nao), len(sem)), (1, 1, 1))

    suite = unittest.TestLoader().loadTestsFromTestCase(Criterio)
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    if "--testar" in sys.argv:
        raise SystemExit(testar())
    main(aplicar="--aplicar" in sys.argv)
