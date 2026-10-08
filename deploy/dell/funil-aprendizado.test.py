#!/usr/bin/env python3
"""Testes do funil-aprendizado.py: python3 deploy/dell/funil-aprendizado.test.py

Nada aqui toca o ~/auto-site, o crm.json nem a fila de verdade: o HOME vira um
temporário ANTES do import, cada teste monta a própria raiz `funil-teste-*` e a
passa por parâmetro (Caminhos), e só apaga o que ele mesmo criou, conferindo o
prefixo. Em 07/10/2026 um teste que trocava uma global de caminho no setUp
apagou o ~/auto-site real. O Claude é um dublê (e, num teste, um executável
falso no PATH); a leitura certa da Baby School é fixada pela saída dublada e
pelo validador, e o teste vivo (`funil-aprendizado testar-vivo`) confere o
modelo de verdade no Dell.
"""

import atexit
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="funil-teste-home-")
os.environ["HOME"] = os.environ["USERPROFILE"] = _HOME
for _var in ("AUTO_DIR", "N8N_ESTADO", "FUNIL_APRENDIZADO_DIR", "FUNIL_APRENDIZADO_ESTADO", "SQUADONE_AVISOS_FILA",
             "SQUADONE_REPO", "FUNIL_MODELO", "GERADOR_MODELO"):
    os.environ.pop(_var, None)


def _apagar_se_meu(p: str) -> None:
    if Path(p).name.startswith("funil-teste-") and Path(p).parent == Path(tempfile.gettempdir()):
        shutil.rmtree(p, ignore_errors=True)


atexit.register(_apagar_se_meu, _HOME)

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("funil", AQUI / "funil-aprendizado.py")
fa = importlib.util.module_from_spec(_spec)
sys.modules["funil"] = fa  # o @dataclass procura o módulo em sys.modules
_spec.loader.exec_module(fa)

POSIX = os.name == "posix"
BABY = fa.BABY_SCHOOL
TRECHO_BABY = ("Na verdade hoje já temos uma agência, fiquei curioso mesmo para ver o resultado, de qualquer forma "
               "agradeço, se puder excluir esse conteúdo por gentileza")
AGORA = datetime(2026, 10, 8, 10, 0, tzinfo=timezone.utc)

# Fixtures da Baby School copiadas das fontes reais de 07/10/2026, com telefones falsos.
CONTENT_BABY = """# Baby School Berçário & Maternal

- **Vertical:** escola infantil
- **Cidade:** Campinas
- **Telefone:** +55 19 98888-7777
- **WhatsApp achado na busca do Caçador:** +5519988887777 (confirmar à mão antes de publicar)
- **Site antigo, fora do ar:** https://www.babyschool.com.br/ (não responde (timeout of 15000ms exceeded))
- **Google Maps:** https://maps.google.com/?cid=12345678901234567890
- **place_id:** ChIJH8lXhyzFyJQRoydoh868Npk
- **Slug:** baby-school-bercario-maternal

## Classificação

Estabelecimento com espaço físico e equipe. Possui estrutura física com equipe pedagógica, não tem site próprio no ar e é unidade única.

## Decisão do Rômulo (05/10/2026): reabrir como REDESIGN

O Rômulo reabriu este lead de propósito, sabendo que o negócio já tem site. **Esta decisão vale por cima das regras de descarte do CLAUDE.md**.

- O "Site antigo, fora do ar" acima está errado. `www.babyschool.com.br` dá 301 para `https://babyschool.com.br/`, que responde 200 (WordPress completo). O timeout foi falha pontual do Caçador.
- Conferido no site atual: o WhatsApp (19 98888-7777) e o Instagram (@babyschooloficial) batem com os desta ficha.
"""
REGISTRO = """| Data | Lead | Slug | URL | Decisão |
|---|---|---|---|---|
| 05/10/2026 | Baby School Berçário & Maternal (Campinas/SP) | baby-school-bercario-maternal | — (não publicado) | **Descartado porque o site existe e está no ar, completo — o `content.md` errou a premissa.** `curl -I` deu 301 para `https://babyschool.com.br/`, que responde 200 com WordPress completo. |
| 05/10/2026 | Baby School Berçário & Maternal (Campinas/SP) | baby-school-bercario-maternal | — (não publicado) | **Segunda chamada na mesma rodada.** Não reabri o lead. |
| 06/10/2026 | Baby School Berçário & Maternal (Campinas/SP) | baby-school-bercario-maternal | https://demo-baby-school-bercario-maternal.vercel.app | **Terceira chamada no mesmo lead — desta vez publicado.** Demo de redesign. |
| 06/10/2026 | Outro Lead | outro-lead | — | nada |
"""
LICAO_CERTA = {
    "etapa": "qualificacao",
    "evidencia": [{"fonte": "resposta", "trecho": "Na verdade hoje já temos uma agência"},
                  {"fonte": "registro.md", "trecho": "Descartado porque o site existe e está no ar, completo"}],
    "o_que_funcionou": "A mensagem em duas etapas fez a pessoa abrir o demo: \"fiquei curioso mesmo para ver o resultado\".",
    "hipotese": "O negócio já tinha site no ar (WordPress) e agência; a triagem o descartou duas vezes e ele foi "
                "reaberto à mão como redesign.",
    "nao_se_conclui": "Que o site precisava de mais personalização: a pessoa não falou do demo.",
    "mudanca_proposta": {"alvo": "decisao_manual",
                         "texto": "Não reabrir como redesign lead que a triagem descartou por ter site no ar e fornecedor."},
    "confianca": "alta",
}
# A leitura que a docstring do gerador registrou e o texto dela não sustenta.
LICAO_ERRADA = {
    "etapa": "site",
    "evidencia": [{"fonte": "resposta", "trecho": "fiquei curioso mesmo para ver o resultado"}],
    "o_que_funcionou": "",
    "hipotese": "O site precisava de mais personalização: não parecia feito para ela.",
    "nao_se_conclui": "",
    "mudanca_proposta": {"alvo": "gerador", "texto": "Personalizar mais cada demo."},
    "confianca": "media",
}


def linha_baby(**k) -> dict:
    return {"row_number": "336", "place_id": BABY, "nome": "Baby School Berçário & Maternal",
            "vertical": "escola infantil", "cidade": "Campinas", "status": "recusado",
            "vercel_project": "demo-baby-school-bercario-maternal", "criado_em": "2026-10-05T06:04:01.336-03:00",
            "enviado_em": "2026-10-07T19:49:39.727Z", "respondeu_em": "2026-10-07T16:51:21-0300", "followup_em": "",
            "status_anterior": "enviado", "recusado_em": "2026-10-07T20:15:41.153Z", "fechado_em": "",
            "visto_em": "2026-10-07T19:56:23.000Z", "resposta_tipo": "negativa", "resposta_trecho": TRECHO_BABY,
            "resposta_em": "2026-10-07T17:14:04-0300", "wa_me": "https://wa.me/5519988887777",
            "wa_link": "https://wa.me/5519988887777?text=oi", "acoes_link": "https://x/webhook/lead?id=1", **k}


def linha(pid: str, **k) -> dict:
    base = {"place_id": pid, "nome": f"Negócio {pid[-3:]}", "vertical": "contabilidade", "cidade": "Vitória",
            "status": "enviado", "enviado_em": "2026-10-06T12:00:00.000Z", "wa_me": "https://wa.me/5527999998888"}
    return {**base, **k}


class Duble:
    """O Claude de mentira: devolve as saídas na ordem e guarda o que recebeu."""

    def __init__(self, *saidas):
        self.saidas, self.chamadas = list(saidas), []

    def __call__(self, sistema, entrada):
        self.chamadas.append((sistema, entrada))
        s = self.saidas.pop(0) if self.saidas else LICAO_CERTA
        if isinstance(s, fa.Resultado):
            return s
        return fa.Resultado(s if isinstance(s, str) else json.dumps(s, ensure_ascii=False), False, None)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="funil-teste-"))
        self.addCleanup(_apagar_se_meu, str(self.tmp))
        t = self.tmp
        self.c = fa.Caminhos(home=t / "home", auto=t / "auto-site", n8n=t / "n8n", dados=t / "dados",
                             estado=t / "estado", fila=t / "fila", repo=t / "repo")
        self.c.fila.mkdir(parents=True)
        self.logs = []

    def log(self, *a):
        self.logs.append(" ".join(map(str, a)))

    def crm(self, linhas, gerado=None):
        gerado = gerado or (AGORA - timedelta(minutes=5))
        self.c.n8n.mkdir(parents=True, exist_ok=True)
        (self.c.n8n / "crm.json").write_text(json.dumps({
            "versao": 1, "geradoEm": gerado.isoformat().replace("+00:00", "Z"),
            "fontes": {"site": {"linhas": linhas}}}, ensure_ascii=False), encoding="utf-8")

    def baby(self, linha_extra=None, design=True):
        p = self.c.auto / "_recusados" / "baby-school-bercario-maternal"
        p.mkdir(parents=True)
        (p / "content.md").write_text(CONTENT_BABY, encoding="utf-8")
        (p / "publicado.json").write_text(json.dumps({"place_id": BABY, "apagado_em": "x"}), encoding="utf-8")
        if design:
            (p / "DESIGN.md").write_text("Referência Geniestudio (Refero).", encoding="utf-8")
        (self.c.auto / "registro.md").write_text(REGISTRO, encoding="utf-8")
        self.c.n8n.mkdir(parents=True, exist_ok=True)
        (self.c.n8n / "site-leads.json").write_text(json.dumps(
            {"leads": [{"place_id": BABY, "pasta": "_recusados/baby-school-bercario-maternal"}]}), encoding="utf-8")
        self.crm([linha_baby()] + (linha_extra or []))

    def coletar(self, executor, **k):
        return fa.coletar(self.c, AGORA, executor, log=self.log, **k)

    def licoes(self):
        return fa.ler_jsonl(self.c.licoes)


# ------------------------------------------------------------------ coleta

class BabySchool(Base):
    def test_licao_certa_e_gravada_sem_telefone(self):
        self.baby()
        duble = Duble(LICAO_CERTA)
        self.assertEqual(self.coletar(duble), 0)
        [l] = self.licoes()
        self.assertEqual((l["etapa"], l["desfecho"], l["confianca"]), ("qualificacao", "negativa", "alta"))
        self.assertEqual(l["chave"], f"{BABY}|resposta|{fa.sha8(TRECHO_BABY)}")
        self.assertEqual((l["mensagem_regime"], l["slug"], l["pasta"]),
                         ("duas_mensagens", "baby-school-bercario-maternal", "_recusados/baby-school-bercario-maternal"))
        self.assertIn("fiquei curioso", l["o_que_funcionou"])
        self.assertIn("personalização", l["nao_se_conclui"])
        self.assertEqual(l["mudanca_proposta"]["alvo"], "decisao_manual")
        bruto = self.c.licoes.read_text(encoding="utf-8")
        self.assertNotIn("98888", bruto)
        self.assertNotIn("5519988887777", bruto)
        st = json.loads(self.c.status.read_text())
        self.assertEqual((st["licoes_novas"], st["erro"]), (1, None))

    def test_leitura_da_personalizacao_e_recusada_e_repetida_com_os_motivos(self):
        self.baby()
        duble = Duble(LICAO_ERRADA, LICAO_ERRADA)
        self.coletar(duble)
        self.assertEqual(self.licoes(), [])
        self.assertEqual(len(duble.chamadas), 2)
        self.assertIn("já tem fornecedor", duble.chamadas[1][1])
        [rej] = fa.ler_jsonl(self.c.rejeitadas)
        self.assertTrue(any("fornecedor" in m for m in rej["motivos"]))
        self.assertEqual(json.loads(self.c.estado_coleta.read_text())["tentativas"][rej["chave"]], 1)

    def test_segunda_tentativa_certa_grava(self):
        self.baby()
        duble = Duble(LICAO_ERRADA, LICAO_CERTA)
        self.coletar(duble)
        self.assertEqual([l["etapa"] for l in self.licoes()], ["qualificacao"])

    def test_evidencia_nao_literal_e_recusada(self):
        errada = {**LICAO_ERRADA, "etapa": "mensagem",
                  "evidencia": [{"fonte": "resposta", "trecho": "não parecia feito para ela, o site"}]}
        licao, motivos = fa.validar_licao(errada, {"resposta": TRECHO_BABY}, "negativa")
        self.assertIsNone(licao)
        self.assertTrue(any("não aparece literalmente" in m for m in motivos))

    def test_dossie_tem_os_fatos_decisivos_e_nenhum_telefone(self):
        self.baby()
        linhas, _ = fa.ler_retrato(self.c, AGORA)
        [d] = fa.desfechos(linhas, AGORA)[0]
        pastas = fa.Pastas(self.c.auto, fa.pastas_do_retrato(fa.ler_json(self.c.site_leads)))
        dossie, fontes, _ = fa.preparar(d, self.c, pastas, fa.ler_registro(self.c.auto), [])
        for fato in (TRECHO_BABY, "WordPress completo", "Descartado porque o site existe", fa.MARCA_DECISAO,
                     "duas_mensagens", "Decisão do Rômulo (05/10/2026): reabrir como REDESIGN"):
            self.assertIn(fato, dossie)
        for proibido in ("98888", "5519988887777", "12345678901234567890", "não parecia feito", "Geniestudio",
                         "outro-lead"):
            self.assertNotIn(proibido, dossie)
        self.assertEqual(set(fontes), {"resposta", "planilha", "content.md", "registro.md"})
        self.assertIn("Não conclua além da evidência", fa.SISTEMA_COLETA)
        self.assertIn("Sem palavras dela sobre o site, nunca é site", fa.SISTEMA_COLETA)


class Desfechos(Base):
    def test_sem_texto_vira_contagem(self):
        manual = "(marcada à mão em 03/10: resposta negativa; o texto não foi guardado)"
        lista, cont = fa.desfechos([linha("ChIJaaaaaaaaaa1", resposta_tipo="negativa", resposta_trecho=manual,
                                          resposta_em="2026-10-03T12:00:00Z"),
                                    linha("ChIJaaaaaaaaaa2", resposta_tipo="neutra", resposta_trecho="",
                                          resposta_em="2026-10-03T12:00:00Z")], AGORA)
        self.assertEqual(lista, [])
        semana = cont["2026-W40"]
        self.assertEqual((semana["negativa_sem_texto"], semana["neutra_sem_texto"]),
                         ({"contabilidade": 1}, {"contabilidade": 1}))

    def test_silencio_com_e_sem_leitura_so_conta(self):
        dez = (AGORA - timedelta(days=10, minutes=1)).isoformat()
        nove = (AGORA - timedelta(days=9)).isoformat()
        lista, cont = fa.desfechos([linha("ChIJaaaaaaaaaa1", enviado_em=dez, visto_em=dez),
                                    linha("ChIJaaaaaaaaaa2", enviado_em=nove, visto_em=nove),
                                    linha("ChIJaaaaaaaaaa3", enviado_em=dez, status="expirado")], AGORA)
        self.assertEqual(lista, [])
        tipos = {t for s in cont.values() for t in s}
        self.assertEqual(tipos, {"silencio_visto", "silencio_sem_visto"})

    def test_recusa_pelo_botao_conta_e_a_do_acervo_nao(self):
        lista, cont = fa.desfechos([linha("ChIJaaaaaaaaaa1", status="recusado", recusado_em="2026-09-25T12:00:00Z"),
                                    linha("ChIJaaaaaaaaaa2", status="recusado", recusado_em="2026-10-01T12:00:00Z")],
                                   AGORA)
        self.assertEqual(lista, [])
        self.assertEqual(sum(n for s in cont.values() for t, por in s.items() for n in por.values()
                             if t == "recusou_sem_texto"), 1)

    def test_negativa_seguida_de_recusa_e_um_desfecho_so(self):
        lista, cont = fa.desfechos([linha_baby()], AGORA)
        self.assertEqual([d["desfecho"] for d in lista], ["negativa"])
        self.assertEqual(cont, {})

    def test_fechou_bot_desconhecido_e_exclusao(self):
        lista, cont = fa.desfechos([
            linha("ChIJaaaaaaaaaa1", status="fechado", fechado_em="2026-10-07T12:00:00-0300"),
            linha("ChIJaaaaaaaaaa2", resposta_tipo="bot", resposta_trecho="Olá! Em breve retornaremos."),
            linha("ChIJaaaaaaaaaa3", resposta_tipo="talvez", resposta_trecho="vou ver"),
            linha("ChIJaaaaaaaaaa4", resposta_tipo="exclusao", resposta_trecho="Por favor apague meus dados daí",
                  resposta_em="2026-10-07T12:00:00Z")], AGORA)
        self.assertEqual(sorted(d["desfecho"] for d in lista), ["exclusao", "fechou"])
        self.assertIn("tipo_desconhecido", {t for s in cont.values() for t in s})

    def test_datas_com_z_e_com_0300_sao_o_mesmo_instante(self):
        self.assertEqual(fa.instante("2026-10-07T17:14:04-0300"), fa.instante("2026-10-07T20:14:04Z"))
        self.assertEqual(fa.instante("2026-10-07T17:14:04-03:00"), fa.instante("2026-10-07T20:14:04.000Z"))
        self.assertIsNone(fa.instante("ontem"))

    def test_regime_pela_data_do_envio(self):
        self.assertEqual([fa.regime_da_mensagem(fa.instante(t)) for t in
                          ("2026-09-29T20:00:00-03:00", "2026-09-30T08:00:00-03:00", "2026-10-04T23:00:00-03:00",
                           "2026-10-05T01:00:00-03:00")],
                         ["curta_com_link", "prumo_com_link", "prumo_com_link", "duas_mensagens"])


class Rodada(Base):
    def test_idempotente_e_reclassificar_nao_duplica(self):
        self.baby()
        duble = Duble(LICAO_CERTA)
        self.coletar(duble)
        self.coletar(duble)
        self.assertEqual(len(self.licoes()), 1)
        self.assertEqual(len(duble.chamadas), 1)
        self.crm([linha_baby(resposta_tipo="exclusao")])  # o classificador mudou o tipo, o texto é o mesmo
        self.coletar(duble)
        self.assertEqual(len(duble.chamadas), 1)
        self.crm([linha_baby(resposta_trecho="Já disse que temos agência, por favor apaguem",
                             resposta_em="2026-10-07T21:00:00-0300")])
        self.coletar(Duble({**LICAO_CERTA, "evidencia": [{"fonte": "resposta", "trecho": "Já disse que temos agência"}]}))
        self.assertEqual(len(self.licoes()), 2)

    def test_segunda_licao_do_lead_leva_a_primeira_como_contexto(self):
        self.baby()
        self.coletar(Duble(LICAO_CERTA))
        self.crm([linha_baby(resposta_trecho="Já disse que temos agência, por favor apaguem")])
        duble = Duble({**LICAO_CERTA, "evidencia": [{"fonte": "resposta", "trecho": "Já disse que temos agência"}]})
        self.coletar(duble)
        self.assertIn("Lições anteriores deste lead", duble.chamadas[0][1])

    def test_retrato_velho_nao_chama_nada(self):
        self.baby()
        self.crm([linha_baby()], gerado=AGORA - timedelta(hours=4))
        duble = Duble()
        self.assertEqual(self.coletar(duble), 1)
        self.assertEqual(duble.chamadas, [])
        self.assertIn("velho", json.loads(self.c.status.read_text())["erro"])

    def test_limite_de_uso_para_sem_contar_tentativa(self):
        self.baby()
        self.coletar(Duble(fa.Resultado(None, True, "limite de uso")))
        st = json.loads(self.c.status.read_text())
        self.assertEqual((st["limite"], st["invalidas"]), (True, 0))
        self.assertEqual(json.loads(self.c.estado_coleta.read_text())["tentativas"], {})
        self.coletar(Duble(LICAO_CERTA))
        self.assertEqual(len(self.licoes()), 1)

    def test_erro_do_claude_para_a_rodada_com_o_motivo(self):
        self.baby()
        self.assertEqual(self.coletar(Duble(fa.Resultado(None, False, "claude falhou (código 1)"))), 1)
        self.assertIn("claude falhou", json.loads(self.c.status.read_text())["erro"])

    def test_desiste_depois_de_duas_rodadas_invalidas(self):
        self.baby()
        for _ in range(3):
            self.coletar(Duble("isto não é JSON", "nem isto"))
        est = json.loads(self.c.estado_coleta.read_text())
        self.assertEqual(len(est["desistidas"]), 1)
        self.assertEqual(len(fa.ler_jsonl(self.c.rejeitadas)), 2)  # a 3ª rodada nem tentou

    def test_teto_por_rodada(self):
        linhas = [linha(f"ChIJbbbbbbbbbb{i}", resposta_tipo="neutra", resposta_trecho=f"Vou pensar e te falo, {i}",
                        resposta_em=f"2026-10-0{i + 1}T12:00:00Z") for i in range(3)]
        self.crm(linhas)
        saida = {"etapa": "timing", "evidencia": [{"fonte": "planilha", "trecho": "vertical: contabilidade"}],
                 "hipotese": "Ainda não sabe.", "mudanca_proposta": None, "confianca": "baixa"}
        duble = Duble(saida, saida, saida)
        self.coletar(duble, teto=2)
        self.assertEqual(len(duble.chamadas), 2)
        self.assertEqual(json.loads(self.c.status.read_text())["pendentes"], 1)

    def test_lead_sem_pasta_ainda_vira_licao_com_a_resposta(self):
        self.crm([linha("ChIJcccccccccc1", resposta_tipo="negativa", resposta_trecho="Não tenho interesse, obrigado",
                        resposta_em="2026-10-07T12:00:00Z")])
        duble = Duble({"etapa": "sem_sinal", "evidencia": [{"fonte": "resposta", "trecho": "Não tenho interesse, obrigado"}],
                       "hipotese": "Recusa sem motivo.", "mudanca_proposta": None, "confianca": "baixa"})
        self.coletar(duble)
        self.assertIn("pasta: não encontrada", duble.chamadas[0][1])
        self.assertEqual(self.licoes()[0]["pasta"], None)

    def test_pasta_achada_pelo_place_id_quando_o_retrato_erra(self):
        self.baby()
        (self.c.n8n / "site-leads.json").write_text(json.dumps({"leads": [{"place_id": BABY, "pasta": "baby-errada"}]}))
        pastas = fa.Pastas(self.c.auto, fa.pastas_do_retrato(fa.ler_json(self.c.site_leads)))
        self.assertEqual(pastas.achar(BABY), self.c.auto / "_recusados" / "baby-school-bercario-maternal")

    @unittest.skipUnless(POSIX, "flock e modos de arquivo só no Linux")
    def test_rodada_concorrente_sai_sem_fazer_nada_e_arquivos_sao_600(self):
        self.baby()
        with fa.Trava(self.c.estado / "coleta.lock") as livre:
            self.assertTrue(livre)
            duble = Duble()
            self.assertEqual(self.coletar(duble), 0)
            self.assertEqual(duble.chamadas, [])
        self.coletar(Duble(LICAO_CERTA))
        for p in (self.c.licoes, self.c.status, self.c.contagens):
            self.assertEqual(p.stat().st_mode & 0o777, 0o600, p)
        self.assertEqual(self.c.dados.stat().st_mode & 0o777, 0o700)


class Validador(unittest.TestCase):
    FONTES = {"resposta": TRECHO_BABY, "planilha": "vertical: escola infantil"}

    def validar(self, **muda):
        return fa.validar_licao({**LICAO_CERTA, "evidencia": [{"fonte": "resposta", "trecho": "Na verdade hoje já temos uma agência"}],
                                 **muda}, self.FONTES, "negativa")

    def test_tabela(self):
        casos = [
            ({}, None),
            ({"etapa": "vendas"}, "etapa inválida"),
            ({"confianca": 0.9}, "confianca inválida"),
            ({"extra": 1}, "fora do formato"),
            ({"evidencia": []}, "1 a 3"),
            ({"evidencia": [{"fonte": "DOSSIE.md", "trecho": "Na verdade hoje já temos uma agência"}]}, "não está no dossiê"),
            ({"evidencia": [{"fonte": "resposta", "trecho": "agência"}]}, "de 15 a 200"),
            ({"hipotese": ""}, "hipotese vazia"),
            ({"hipotese": "x" * 401}, "passa de 400"),
            ({"mudanca_proposta": {"alvo": "vercel", "texto": "x"}}, "mudanca_proposta deve ser"),
            ({"etapa": "sem_sinal"}, "sem_sinal exige"),
            ({"hipotese": "Ligar para (19) 98888-7777."}, "telefone"),
            ({"o_que_funcionou": "escreveu de dono@escola.com.br"}, "telefone, e-mail"),
            ({"etapa": "site"}, "já tem fornecedor"),
        ]
        for muda, esperado in casos:
            licao, motivos = self.validar(**muda)
            if esperado is None:
                self.assertIsNotNone(licao, motivos)
            else:
                self.assertIsNone(licao, muda)
                self.assertTrue(any(esperado in m for m in motivos), (muda, motivos))

    def test_aspas_em_volta_e_espacos_nao_quebram_a_evidencia_literal(self):
        licao, motivos = self.validar(evidencia=[{"fonte": "resposta", "trecho": "“Na verdade  hoje já temos uma agência”"}])
        self.assertIsNotNone(licao, motivos)

    def test_site_vale_quando_o_lead_falou_do_demo(self):
        licao, motivos = fa.validar_licao(
            {**LICAO_ERRADA, "evidencia": [{"fonte": "resposta", "trecho": "Não gostei das fotos que vocês usaram"}]},
            {"resposta": "Não gostei das fotos que vocês usaram"}, "negativa")
        self.assertIsNotNone(licao, motivos)

    def test_interesse_de_quem_ja_tem_site_pode_ser_qualquer_etapa(self):
        trecho = "Já temos site, mas quanto custa o de vocês?"
        licao, motivos = fa.validar_licao(
            {"etapa": "oferta", "evidencia": [{"fonte": "resposta", "trecho": trecho}], "hipotese": "Quer saber o preço.",
             "mudanca_proposta": None, "confianca": "media"}, {"resposta": trecho}, "interesse")
        self.assertIsNotNone(licao, motivos)

    def test_extrair_json_com_cerca_e_texto_em_volta(self):
        self.assertEqual(fa.extrair_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(fa.extrair_json('Aqui está: {"a": {"b": 2}} pronto'), {"a": {"b": 2}})
        self.assertIsNone(fa.extrair_json("nada"))


class Redacao(unittest.TestCase):
    def test_tabela(self):
        casos = [
            ("Telefone: +55 19 98888-7777", "Telefone: [tel]"),
            ("WhatsApp: +5519988887777 (confirmar)", "WhatsApp: [tel] (confirmar)"),
            ("ligue (19) 98888-7777", "ligue [tel]"),
            ("o WhatsApp (19 98888-7777)", "o WhatsApp [tel])"),
            ("fixo 19 3643-7155", "fixo [tel]"),
            ("sem DDD 3643-7155 ou 98888-7777", "sem DDD [tel] ou [tel]"),
            ("link wa.me/5519988887777 e mais 1", "link [tel] e mais 1"),
            ("https://api.whatsapp.com/send?phone=5519988887777", "[tel]"),
            ("escreva para dono@escola.com.br", "escreva para [email]"),
            ("EUA +1 305-642-0504", "EUA [tel]"),
            ("cid=12345678901234567890", "cid=[tel]"),
            ("CEP 13087-590", "CEP 13087-590"),
            ("2026-10-07T19:49:39.727Z", "2026-10-07T19:49:39.727Z"),
            ("em 2026-10-05 19:16", "em 2026-10-05 19:16"),
            ("Score +40 site próprio, +15 12 foto(s)", "Score +40 site próprio, +15 12 foto(s)"),
            ("Nota 4.9 (215 avaliações)", "Nota 4.9 (215 avaliações)"),
        ]
        for entrada, esperado in casos:
            self.assertEqual(fa.redigir(entrada), esperado, entrada)


class Claude(Base):
    def test_comando_sem_ferramentas_e_sem_pular_permissoes(self):
        cmd = fa.Claude(self.c.cwd_claude, "claude-opus-5-5").comando("SISTEMA")
        i = cmd.index("--tools")
        self.assertEqual(cmd[i + 1], "")
        for flag in ("--safe-mode", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--permission-mode") + 1], "dontAsk")
        negadas = json.loads(cmd[cmd.index("--settings") + 1])["permissions"]["deny"]
        self.assertTrue({"Bash", "Read", "Edit", "Write", "WebFetch", "mcp__*"} <= set(negadas))
        self.assertNotIn("--dangerously-skip-permissions", cmd)
        self.assertFalse(any("allow" in a for a in cmd))
        self.assertEqual(cmd[-2:], ["--model", "claude-opus-5-5"])

    def test_interpretar_saida(self):
        ok = json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "429 avaliações"})
        self.assertEqual(fa.interpretar_saida(0, ok, ""), fa.Resultado("429 avaliações", False, None))
        limite = json.dumps({"type": "result", "subtype": "success", "is_error": True,
                             "result": "Claude AI usage limit reached|1760000000"})
        self.assertTrue(fa.interpretar_saida(1, limite, "").limite)
        r = fa.interpretar_saida(1, "", "Error: something broke")
        self.assertEqual((r.texto, r.limite), (None, False))
        self.assertIn("código 1", r.erro)

    @unittest.skipUnless(POSIX, "executável falso só no Linux")
    def test_claude_falso_no_path_recebe_o_prompt_pelo_stdin_no_cwd_vazio(self):
        bin_ = self.tmp / "bin"
        bin_.mkdir()
        registro = self.tmp / "chamada.json"
        flags = " ".join(fa.FLAGS_DO_CLAUDE)
        falso = bin_ / "claude"
        falso.write_text(f"""#!/usr/bin/env python3
import json, os, sys
if "--help" in sys.argv:
    print("Usage: claude {flags}")
    sys.exit(0)
entrada = sys.stdin.read()
json.dump({{"argv": sys.argv[1:], "stdin": entrada, "cwd": os.getcwd(), "cwd_vazio": os.listdir(".") == []}},
          open({str(registro)!r}, "w"))
print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "result": '{{"ok": 1}}'}}))
""")
        falso.chmod(0o755)
        claude = fa.Claude(self.c.cwd_claude, None, str(falso))
        r = claude("SISTEMA", "o dossiê do lead")
        self.assertEqual(r, fa.Resultado('{"ok": 1}', False, None))
        visto = json.loads(registro.read_text())
        self.assertEqual(visto["stdin"], "o dossiê do lead")
        self.assertEqual(Path(visto["cwd"]).resolve(), self.c.cwd_claude.resolve())
        self.assertTrue(visto["cwd_vazio"])
        self.assertIn("SISTEMA", visto["argv"])

    @unittest.skipUnless(POSIX, "executável falso só no Linux")
    def test_claude_sem_uma_flag_e_erro_da_rodada(self):
        falso = self.tmp / "claude"
        falso.write_text("#!/bin/sh\necho 'Usage: claude --print --tools'\n")
        falso.chmod(0o755)
        with self.assertRaises(fa.ErroDoFunil) as e:
            fa.Claude(self.c.cwd_claude, None, str(falso))("S", "E")
        self.assertIn("--safe-mode", str(e.exception))


# ------------------------------------------------------------------ revisão

CLAUDE_MD = """# Workspace `auto`

### Triagem

**Teste o domínio do e-mail antes de concluir "sem site".** Se o e-mail é de domínio próprio, abra o domínio.

### Regras do arquivo
- Um arquivo só.
"""
GERADOR = '''PROGRAMAS_LIVRES = ("python3", "node")
PROMPT = (
    "/lead-novo {slug} com mais movimento"
)


def permissoes_do_claude(slug):
    return {"allow": ["Bash(python3 *)"]}


def instrucoes_personalizado(slug):
    return f"""MODO PERSONALIZADO. Um site que serviria a qualquer concorrente do ramo é o defeito a eliminar.
- Escreva o texto à mão."""
'''
JS = ("// variantes\nconst VARIACOES = ['Oi, tudo bem? Aqui é o Rômulo. Montei uma demonstração de site {ARTIGO} {NOME}{DETALHE}. "
      "Posso te mandar o link?', null, null];\nconst SEGUNDA = 'Aqui está: {URL}';\n")


def licao_pronta(pid, etapa="qualificacao", alvo="claude_md", confianca="media", trecho=None, dias=1, **k):
    trecho = trecho or f"Não precisamos, já resolvemos isso com outra pessoa ({pid[-2:]})"
    return {"versao": 1, "chave": f"{pid}|resposta|{fa.sha8(trecho)}", "em": (AGORA - timedelta(days=dias)).isoformat(),
            "place_id": pid, "slug": f"lead-{pid[-2:]}", "nicho": "contabilidade", "desfecho": "negativa",
            "mensagem_regime": "duas_mensagens", "mensagem_variante": None, "site_versao": None, "etapa": etapa,
            "evidencia": [{"fonte": "resposta", "trecho": trecho[:200]}], "o_que_funcionou": "",
            "hipotese": "Já tinha fornecedor.", "nao_se_conclui": "",
            "mudanca_proposta": {"alvo": alvo, "texto": "Conferir fornecedor antes de abordar."},
            "confianca": confianca, "modelo": "padrão", "prompt_versao": 1, "_trecho": trecho, **k}


class Revisao(Base):
    def setUp(self):
        super().setUp()
        for rel, texto in (("deploy/dell/auto-site/auto-site-CLAUDE.md", CLAUDE_MD),
                           ("deploy/dell/gerador-de-sites.py", GERADOR),
                           ("deploy/dell/claude-ops/site-mensagem.js", JS)):
            p = self.c.repo / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(texto, encoding="utf-8")
        (self.c.repo / ".git" / "refs" / "heads").mkdir(parents=True)
        (self.c.repo / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
        (self.c.repo / ".git" / "refs" / "heads" / "main").write_text("04c5162abcdef\n")

    def gravar(self, *licoes):
        self.c.dados.mkdir(parents=True, exist_ok=True)
        linhas = []
        for l in licoes:
            trecho = l.pop("_trecho")
            fa.anexar_linha(self.c.licoes, l)
            linhas.append(linha(l["place_id"], resposta_tipo=l["desfecho"], resposta_trecho=trecho,
                                resposta_em=l["em"], vertical="contabilidade"))
        self.crm(linhas)

    def revisar(self, executor, agora=AGORA, **k):
        return fa.revisar(self.c, agora, executor, log=self.log, **k)

    def avisos(self):
        return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(self.c.fila.glob("*.json"))]

    def propostas_md(self, agora=AGORA):
        return (self.c.propostas / f"PROPOSTAS-{agora.astimezone(fa.FUSO):%Y-%m-%d}.md").read_text(encoding="utf-8")

    TROCA = {"hipotese_comum": True, "resumo": "Procurar fornecedor antes de concluir sem site.",
             "trocas": [{"arquivo": "deploy/dell/auto-site/auto-site-CLAUDE.md",
                         "antes": "**Teste o domínio do e-mail antes de concluir \"sem site\".**",
                         "depois": "**Teste o domínio do e-mail e procure nome + cidade antes de concluir \"sem site\".**"}],
             "como_medir": "Lições de qualificação nas próximas 4 semanas."}

    def test_dois_leads_do_mesmo_grupo_viram_proposta_com_diff_e_um_aviso(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        duble = Duble(self.TROCA)
        self.assertEqual(self.revisar(duble), 0)
        md = self.propostas_md()
        self.assertIn("## 1. Triagem do gerador (qualificação)", md)
        self.assertIn("critério: 2 leads", md)
        self.assertIn("+**Teste o domínio do e-mail e procure nome + cidade", md)
        self.assertIn("04c5162", md)
        patch = (self.c.propostas / "2026-10-08" / "1.patch").read_text(encoding="utf-8")
        self.assertTrue(patch.startswith("--- a/deploy/dell/auto-site/auto-site-CLAUDE.md"))
        [aviso] = self.avisos()
        self.assertEqual((aviso["origem"], aviso["prioridade"], aviso["chave"]),
                         ("funil-aprendizado", 3, "funil-aprendizado:propostas:2026-10-08"))
        self.assertIn("1. Triagem do gerador (qualificação) (2 leads)", aviso["texto"])
        self.assertIn("faça o PR da proposta N de PROPOSTAS-2026-10-08", aviso["texto"])
        self.assertNotIn("resolvemos", aviso["texto"])  # nada de texto de lead no aviso
        self.assertNotIn("R$", json.dumps(aviso, ensure_ascii=False))
        self.assertIn("<<<ARQUIVO deploy/dell/auto-site/auto-site-CLAUDE.md>>>", duble.chamadas[0][1])
        self.assertEqual(CLAUDE_MD, (self.c.repo / "deploy/dell/auto-site/auto-site-CLAUDE.md").read_text(encoding="utf-8"))

    @unittest.skipUnless(POSIX, "o dell-status importa fcntl")
    def test_aviso_passa_no_validar_aviso_do_dell_status(self):
        spec = importlib.util.spec_from_file_location("ds", AQUI / "dell-status.py")
        ds = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ds)
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        self.revisar(Duble(self.TROCA))
        [aviso] = self.avisos()
        self.assertEqual(ds.validar_aviso(aviso)["origem"], "funil-aprendizado")
        self.assertEqual(ds.validar_aviso(fa.aviso_de_erro("2026-10-08", ValueError("trecho de lead")))["prioridade"], 2)
        self.assertNotIn("trecho de lead", json.dumps(fa.aviso_de_erro("2026-10-08", ValueError("trecho de lead"))))

    def test_um_caso_fraco_nao_propoe_nem_avisa(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"))
        duble = Duble()
        self.revisar(duble)
        self.assertIn("Nenhuma proposta nesta semana", self.propostas_md())
        self.assertEqual((self.avisos(), duble.chamadas), ([], []))

    def test_a_baby_school_sozinha_e_caso_forte_e_vira_recomendacao_sem_diff(self):
        baby = licao_pronta(BABY, alvo="decisao_manual", confianca="alta", trecho=TRECHO_BABY)
        baby["evidencia"] = [{"fonte": "resposta", "trecho": "Na verdade hoje já temos uma agência"}]
        self.gravar(baby)
        duble = Duble()
        self.revisar(duble)
        md = self.propostas_md()
        self.assertIn("## 1. Recomendação ao Rômulo", md)
        self.assertIn("1 caso forte (confiança alta + palavras do lead: \"já temos uma agência\")", md)
        self.assertIn("Sem diff: recomendação ao Rômulo", md)
        self.assertEqual(duble.chamadas, [])
        self.assertIn("são recomendações para você ler e decidir", md)
        self.assertNotIn("faça o PR", md)
        [aviso] = self.avisos()
        self.assertIn("Recomendação ao Rômulo (1 caso forte, sem diff)", aviso["texto"])
        self.assertNotIn("faça o PR", aviso["texto"])

    def test_funil_semanal_desta_semana(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"))
        quinta = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
        (self.c.n8n / "site-funil.json").write_text(json.dumps({"geradoEm": "2026-10-05T11:00:47Z"}))
        self.revisar(Duble(), agora=quinta)
        self.assertNotIn("não rodou", self.propostas_md(quinta))
        (self.c.n8n / "site-funil.json").write_text(json.dumps({"geradoEm": "2026-09-28T11:00:47Z"}))
        self.revisar(Duble(), agora=quinta, refazer=True)
        self.assertIn("\"06 · Funil semanal\" desta semana não rodou (último: 28/09/2026)", self.propostas_md(quinta))

    def test_forte_sem_palavras_do_lead_nao_basta(self):
        l = licao_pronta("ChIJdddddddddd01", confianca="alta", trecho="Obrigado pelo contato, mas não agora")
        l["evidencia"] = [{"fonte": "content.md", "trecho": "já temos uma agência que cuida disso"}]
        self.gravar(l)
        self.revisar(Duble())
        self.assertEqual(self.avisos(), [])

    def test_o_mesmo_lead_duas_vezes_conta_um(self):
        a = licao_pronta("ChIJdddddddddd01", dias=3)
        b = licao_pronta("ChIJdddddddddd01", trecho="Já falei que não precisamos, temos outra pessoa", dias=1)
        self.gravar(a, b)
        self.revisar(Duble())
        self.assertEqual(self.avisos(), [])

    def test_desfecho_desfeito_na_planilha_sai_da_revisao(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        crm = json.loads(self.c.crm.read_text(encoding="utf-8"))
        crm["fontes"]["site"]["linhas"][1]["resposta_tipo"] = ""
        self.c.crm.write_text(json.dumps(crm), encoding="utf-8")
        self.revisar(Duble(self.TROCA))
        self.assertEqual(self.avisos(), [])

    def test_fora_da_janela_e_sem_sinal_nao_entram(self):
        self.gravar(licao_pronta("ChIJdddddddddd01", dias=40), licao_pronta("ChIJdddddddddd02"),
                    licao_pronta("ChIJdddddddddd03", etapa="sem_sinal"))
        self.revisar(Duble())
        self.assertEqual(self.avisos(), [])

    def test_mesmo_dia_nao_repete_e_semana_seguinte_nao_recita(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        self.revisar(Duble(self.TROCA))
        self.revisar(Duble(self.TROCA))
        self.assertEqual(len(self.avisos()), 1)
        semana = AGORA + timedelta(days=7)
        self.revisar(Duble(self.TROCA), agora=semana)
        self.assertEqual(len(self.avisos()), 1)
        self.assertIn("Nenhuma proposta", self.propostas_md(semana))

    def test_aviso_perdido_e_regravado_no_mesmo_dia(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        self.revisar(Duble(self.TROCA))
        for p in self.c.fila.glob("*.json"):
            p.unlink()
        estado = json.loads(self.c.estado_revisao.read_text())
        estado["avisado"] = None
        self.c.estado_revisao.write_text(json.dumps(estado))
        self.revisar(Duble())
        self.assertEqual(len(self.avisos()), 1)

    def test_antes_ausente_vira_rascunho_depois_de_uma_nova_tentativa(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        ruim = {**self.TROCA, "trocas": [{**self.TROCA["trocas"][0], "antes": "texto que não existe no arquivo"}]}
        duble = Duble(ruim, ruim)
        self.revisar(duble)
        self.assertEqual(len(duble.chamadas), 2)
        self.assertIn("aparece 0 vez(es)", duble.chamadas[1][1])
        md = self.propostas_md()
        self.assertIn("Sem diff: rascunho sem diff", md)
        self.assertIn("(2 leads, sem diff)", self.avisos()[0]["texto"])

    def test_sem_claude_e_limite_viram_rascunho(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        self.revisar(None)
        self.assertIn("--sem-claude", self.propostas_md())
        self.revisar(Duble(fa.Resultado(None, True, "limite de uso")), refazer=True)
        self.assertIn("limite de uso do Claude", self.propostas_md())

    def test_fila_ausente_e_erro_mas_o_arquivo_fica(self):
        self.c.fila.rmdir()
        self.gravar(licao_pronta("ChIJdddddddddd01"), licao_pronta("ChIJdddddddddd02"))
        with self.assertRaises(fa.ErroDoFunil):
            self.revisar(Duble(self.TROCA))
        self.assertIn("## 1.", self.propostas_md())
        self.assertFalse(self.c.fila.exists())

    def test_variante_de_mensagem_entra_na_vaga_b(self):
        self.gravar(licao_pronta("ChIJdddddddddd01", etapa="mensagem", alvo="mensagem"),
                    licao_pronta("ChIJdddddddddd02", etapa="mensagem", alvo="mensagem"))
        texto = "Oi! Aqui é o Rômulo, de Vitória. Fiz uma demonstração de site {ARTIGO} {NOME}. Quer ver?"
        self.revisar(Duble({"hipotese_comum": True, "resumo": "Dizer de onde escreve.", "variante": texto,
                            "como_medir": "Respostas da B contra a A."}))
        md = self.propostas_md()
        self.assertIn("## 1. Mensagem: variante nova", md)
        self.assertIn("variante B proposta pela revisão", md)
        self.assertIn("site-antes-da-venda.py --balcao", md)

    def test_funil_por_variante_no_arquivo(self):
        self.gravar(licao_pronta("ChIJdddddddddd01"))
        crm = json.loads(self.c.crm.read_text(encoding="utf-8"))
        crm["fontes"]["site"]["linhas"] += [linha("ChIJeeeeeeeeee1", mensagem_variante="B", site_versao="personalizado-v2"),
                                            linha("ChIJeeeeeeeeee2", enviado_em="")]
        self.c.crm.write_text(json.dumps(crm), encoding="utf-8")
        self.revisar(Duble())
        md = self.propostas_md()
        self.assertIn("| (duas_mensagens) | 1 | 1 | 0 | 1 | 0 |", md)
        self.assertIn("| B | 1 | 0 | 0 | 0 | 0 |", md)
        self.assertIn("| personalizado-v2 | 1 |", md)
        self.assertIn("antes de 30 envios", md)


class Diffs(unittest.TestCase):
    def test_variante_b_depois_c_depois_esperando_vaga(self):
        texto = "Oi {NOME}, posso mandar?"
        js_b, letra, _ = fa.inserir_variante(JS, texto, AGORA, 2)
        self.assertEqual(letra, "B")
        self.assertIn("'Oi {NOME}, posso mandar?', null];", js_b)
        js_c, letra, _ = fa.inserir_variante(js_b, "Olá {NOME}, it's me", AGORA, 2)
        self.assertEqual(letra, "C")
        self.assertIn("'Olá {NOME}, it\\'s me'", js_c)
        nada, letra, motivo = fa.inserir_variante(js_c, texto, AGORA, 2)
        self.assertEqual((nada, letra), (None, None))
        self.assertIn("esperando vaga", motivo)
        if shutil.which("node"):
            self.assertIsNone(fa.conferir_variante_no_node(js_c, 2, "Olá {NOME}, it's me"))

    @unittest.skipUnless(shutil.which("node"), "sem node")
    def test_variante_no_site_mensagem_js_de_verdade(self):
        real = (AQUI / "claude-ops" / "site-mensagem.js").read_text(encoding="utf-8")
        texto = "Oi, tudo bem? Sou o Rômulo, de Vitória. Fiz uma demonstração de site {ARTIGO} {NOME}{DETALHE}. Posso mandar?"
        novo, letra, motivo = fa.inserir_variante(real, texto, AGORA, 2)
        self.assertIsNotNone(novo, motivo)
        self.assertIsNone(fa.conferir_variante_no_node(novo, "ABC".index(letra), texto))

    def test_validar_variante(self):
        self.assertEqual(fa.validar_variante("Oi {ARTIGO} {NOME}{DETALHE}, posso mandar?"), [])
        for ruim, motivo in (("Oi, posso mandar?", "{NOME}"), ("Oi {NOME}: {URL}", "{URL}"),
                             ("Oi {NOME}, custa R$ 300", "R$"), ("Oi {NOME}\nposso?", "uma linha")):
            self.assertTrue(any(motivo in m for m in fa.validar_variante(ruim)), ruim)

    def test_antes_duplicado_ou_ausente(self):
        texto = "linha A\nlinha A\nlinha B\n"
        for antes, esperado in (("linha A", "aparece 2 vez(es)"), ("linha C", "aparece 0 vez(es)")):
            novo, motivos = fa.aplicar_trocas("x.md", texto, [{"antes": antes, "depois": "nova"}])
            self.assertIsNone(novo)
            self.assertIn(esperado, motivos[0])
        novo, _ = fa.aplicar_trocas("x.md", texto, [{"antes": "linha B", "depois": "veja https://x.com"}])
        self.assertIsNone(novo)

    def test_gerador_so_nas_regioes_de_texto_e_compilando(self):
        rel = "deploy/dell/gerador-de-sites.py"
        ok, motivos = fa.aplicar_trocas(rel, GERADOR, [{"antes": "- Escreva o texto à mão.",
                                                        "depois": "- Escreva o texto à mão, com as palavras do dono."}])
        self.assertIsNotNone(ok, motivos)
        for antes, depois, esperado in (
                ('["Bash(python3 *)"]', '["Bash(*)"]', "fora da região"),
                ('PROGRAMAS_LIVRES = ("python3", "node")', 'PROGRAMAS_LIVRES = ("python3", "node", "bash")', "fora da região"),
                ('"/lead-novo {slug} com mais movimento"', '"/lead-novo {slug} com (', "não compila")):
            novo, motivos = fa.aplicar_trocas(rel, GERADOR, [{"antes": antes, "depois": depois}])
            self.assertIsNone(novo, antes)
            self.assertTrue(any(esperado in m for m in motivos), motivos)

    def test_cacador_so_a_linha_preferidas(self):
        py = "CODIGO = r'''\nconst PREFERIDAS = ['advog', 'advoc'];\nconst PESO = 2;\n'''\n"
        rel = "deploy/dell/claude-ops/site-cacador-escolha.py"
        ok, motivos = fa.aplicar_trocas(rel, py, [{"antes": "['advog', 'advoc']", "depois": "['advog', 'advoc', 'contab']"}])
        self.assertIsNotNone(ok, motivos)
        novo, motivos = fa.aplicar_trocas(rel, py, [{"antes": "const PESO = 2;", "depois": "const PESO = 9;"}])
        self.assertIsNone(novo)


class Caminhos(unittest.TestCase):
    def test_nada_e_calculado_na_importacao_e_saida_desvia_tudo(self):
        self.assertFalse(any(isinstance(v, Path) for k, v in vars(fa).items() if k.isupper()))
        c = fa.Caminhos.de_home(Path("/h"), {})
        self.assertEqual((c.auto, c.licoes, c.fila), (Path("/h/auto-site"), Path("/h/.local/share/funil-aprendizado/licoes.jsonl"),
                                                       Path("/h/.local/share/avisos/fila")))
        s = c.com_saida(Path("/tmp/funil-fumaca"))
        self.assertEqual((s.licoes, s.estado_coleta, s.fila, s.auto, s.repo),
                         (Path("/tmp/funil-fumaca/licoes.jsonl"), Path("/tmp/funil-fumaca/.estado/coleta.json"),
                          Path("/tmp/funil-fumaca/fila"), Path("/h/auto-site"), Path("/h/SquadOne")))


if __name__ == "__main__":
    r = unittest.main(verbosity=2, exit=False)
    sys.exit(0 if r.result.wasSuccessful() else 1)
