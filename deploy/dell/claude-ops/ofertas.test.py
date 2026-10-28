"""Registro de ofertas (ofertas.py) e a paridade das listas que ficaram escritas de propósito.

Sem rede, sem n8n, sem importar os scripts de fora de claude-ops (vários usam fcntl e só rodam no Linux):
as listas são lidas pela AST do arquivo. Uma oferta nova em prumo-ofertas.json faz os testes de paridade
falharem até alguém acrescentá-la, com o mesmo texto, nos arquivos instalados fora de claude-ops
(nova-oferta.py --conferir mostra esta lista).
"""
import ast
import json
import tempfile
import unittest
from pathlib import Path

import ofertas

AQUI = Path(__file__).resolve().parent
DELL = AQUI.parent
DEPLOY = DELL.parent
CFG = ofertas.carregar()
IDS = ofertas.ids(CFG)


def constante(arquivo, nome):
    """O valor literal de `NOME = ...` no nível de cima do arquivo (sem executá-lo)."""
    arvore = ast.parse(Path(arquivo).read_text(encoding="utf-8"))
    for n in arvore.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == nome for t in n.targets):
            valor = n.value
            # frozenset((...)) e set((...)): literal dentro da chamada
            if isinstance(valor, ast.Call) and getattr(valor.func, "id", "") in ("frozenset", "set") and valor.args:
                return set(ast.literal_eval(valor.args[0]))
            return ast.literal_eval(valor)
    raise AssertionError(f"{nome} não está em {arquivo}")


class Registro(unittest.TestCase):
    def test_carregar_falha_alto_sem_json_ou_sem_ofertas(self):
        with tempfile.TemporaryDirectory() as tmp:
            falta = Path(tmp) / "nao-existe.json"
            with self.assertRaisesRegex(ofertas.RegistroInvalido, "ausente"):
                ofertas.carregar(falta)
            ruim = Path(tmp) / "ruim.json"
            ruim.write_text("{ isto não é json", encoding="utf-8")
            with self.assertRaisesRegex(ofertas.RegistroInvalido, "ilegível"):
                ofertas.carregar(ruim)
            for corpo in ({}, {"ofertas": {}}, {"ofertas": []}, {"ofertas": {"x": "texto"}}):
                ruim.write_text(json.dumps(corpo), encoding="utf-8")
                with self.assertRaises(ofertas.RegistroInvalido, msg=corpo):
                    ofertas.carregar(ruim)

    def test_le_o_json_ao_lado_e_os_derivados(self):
        self.assertEqual(ofertas.ARQUIVO, AQUI / "prumo-ofertas.json")
        self.assertEqual(IDS, list(json.loads(ofertas.ARQUIVO.read_text(encoding="utf-8"))["ofertas"]))
        self.assertEqual(ofertas.leituras(CFG), [f"Ler {CFG['ofertas'][k]['aba']}" for k in IDS])
        self.assertEqual(ofertas.produtos_do_crm(CFG), ["site", "prumo", *IDS, "plus"])
        self.assertEqual(ofertas.fontes_do_retrato(CFG), ["site", "prumo", *IDS, "registros"])
        with self.assertRaisesRegex(ofertas.RegistroInvalido, "'inventada'"):
            ofertas.oferta("inventada", CFG)
        with self.assertRaisesRegex(ofertas.RegistroInvalido, "'campo_que_nao_existe'"):
            ofertas.campo(IDS[0], "campo_que_nao_existe", CFG)

    def test_ofertas_reais_passam_no_contrato(self):
        ofertas.conferir(CFG)

    def test_slug_e_texto_literal(self):
        self.assertEqual(ofertas.slug("Clínicas"), "clinicas")
        self.assertEqual(ofertas.slug("Lojas de Bairro"), "lojas-de-bairro")
        self.assertEqual(ofertas.js_texto("Clínicas"), "'Clínicas'")
        for ruim in ("a'b", "a\\b", "a\nb"):
            with self.assertRaises(ofertas.RegistroInvalido):
                ofertas.js_texto(ruim)

    def test_o_contexto_whatsapp_le_toda_aba(self):
        import workflow_contexto_whatsapp as w
        self.assertEqual(w.LEITURAS, ("Ler Prospects", "Ler Leads do site", *ofertas.leituras(CFG)))
        import serializacao_aquisicao as s
        self.assertEqual(s.NOMES, frozenset(("01 · Caçador", *ofertas.fluxos(CFG))))


class ParidadeDasListasEscritas(unittest.TestCase):
    """Scripts que rodam fora de claude-ops (sem o JSON ao lado): a lista fica escrita e tem de bater."""

    def test_observador_tem_o_rotulo_de_cada_oferta(self):
        rotulo = constante(DELL / "whatsapp-observador/observador.py", "ROTULO")
        self.assertEqual(rotulo, {"site": "Site antes da venda", "prumo": "PRUMO",
                                  **{k: CFG["ofertas"][k]["rotulo"] for k in IDS}})

    def test_publicador_crm_aceita_as_fontes_do_retrato(self):
        self.assertEqual(constante(DELL / "publicador-crm.py", "FONTES"), set(ofertas.fontes_do_retrato(CFG)))

    def test_guarda_de_aquisicao_conhece_cada_cacador(self):
        self.assertEqual(constante(DELL / "aquisicao-guarda.py", "WORKFLOWS"), {"01 · Caçador", *ofertas.fluxos(CFG)})

    def test_frente_comercial_mede_todas_e_so_envia_as_aprovadas(self):
        arquivo = DELL / "frente-comercial.py"
        self.assertEqual(constante(arquivo, "PRODUTOS_DO_FUNIL"), tuple(ofertas.produtos_do_crm(CFG)))
        # Opt-in: o executor pode ficar com menos ofertas que o JSON, nunca com uma que não existe.
        self.assertLessEqual(set(constante(arquivo, "OFERTAS_DO_EXECUTOR")), {"prumo", *IDS})

    def test_hermes_le_os_produtos_do_crm(self):
        self.assertEqual(constante(DEPLOY / "hermes/scripts/ler_comercial.py", "PRODUTOS"), set(ofertas.produtos_do_crm(CFG)))


if __name__ == "__main__":
    unittest.main()
