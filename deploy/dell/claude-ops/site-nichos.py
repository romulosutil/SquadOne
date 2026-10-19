"""Site antes da venda: a lista FEMININOS (artigo da mensagem) em todo fluxo que a tem (idempotente).

"da Desentupidora X", "do Escritório Y": o artigo sai da primeira palavra do nome do negócio, contra a
lista FEMININOS de site-mensagem.js. Cada nó Code do n8n que copia essa lista (o Balcão, o Acompanhamento,
o que mais montar mensagem) precisa da mesma. Este script lê a lista do site-mensagem.js e a troca em
todo nó que tem `const FEMININOS = [...]`; rodar de novo não muda nada.

História (19/10/2026): este arquivo era a migração de nicho de 05/10/2026 e fazia mais três coisas, todas
já aplicadas e apagadas daqui: (1) pausava TODA busca ativa fora da lista de 16 buscas daquele dia, o que,
rodado hoje, pausaria as ~80 que o site-buscas-ampliar.py acrescentou e as que o Rômulo religou; (2) trocava
a regra 1 do Gemini e o "Pontuar" do Caçador (os ramos de urgência, escritório e indústria; o fluxo vivo no
n8n já os tem); (3) escrevia a seção "Ramos novos" no ~/auto-site/CLAUDE.md, que desde 08/10/2026 é versionado
em deploy/dell/auto-site/auto-site-CLAUDE.md (mude por lá). A explicação do nicho (Google Trends, o que ficou
de fora) está na seção "Migração de nicho" do deploy/dell/README.md.

A vez entre as buscas é do site-cacador-escolha.py (PREFERIDAS = advocacia, com o atraso contando em
dobro) e a pausa de quem não tem sinal de compra, do site-acompanhamento.py.

Uso: python3 site-nichos.py           troca FEMININOS em todo fluxo que tem a lista (backups em ~/.local/share/claude-ops/backups/)
     python3 site-nichos.py --testar  funções puras, sem n8n nem planilha
"""
import copy
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent
BACKUPS = Path.home() / ".local/share/claude-ops/backups"


# ------------------------------------------------------------------ funções puras

def linha_femininos() -> str:
    m = re.search(r"const FEMININOS = \[[^\]]*\];", (AQUI / "site-mensagem.js").read_text(encoding="utf-8"))
    return m.group(0)


def aplicar_femininos(wf: dict, linha: str) -> tuple:
    """Troca a lista em todo nó Code que a tem. Devolve (wf, quantos nós mudaram)."""
    wf = copy.deepcopy(wf)
    mudou = 0
    for n in wf["nodes"]:
        js = n.get("parameters", {}).get("jsCode")
        if not js or "const FEMININOS = [" not in js:
            continue
        novo = re.sub(r"const FEMININOS = \[[^\]]*\];", lambda _: linha, js)
        if novo != js:
            n["parameters"]["jsCode"] = novo
            mudou += 1
    return wf, mudou


# ------------------------------------------------------------------ node

def node() -> str:
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    if not exe:
        raise SystemExit("node não encontrado")
    return str(exe)


# ------------------------------------------------------------------ testes

def testar() -> int:
    import json
    import unittest

    def wf_falso():
        return {"nodes": [
            {"name": "Balcão", "parameters": {"jsCode": "const X = 1;\nconst FEMININOS = ['clinica'];\nconst Y = 2;"}},
            {"name": "Sem lista", "parameters": {"jsCode": "const Z = 3;"}},
        ], "connections": {}}

    class Nichos(unittest.TestCase):
        def test_femininos_troca_so_a_lista(self):
            wf, n = aplicar_femininos(wf_falso(), linha_femininos())
            self.assertEqual(n, 1)
            js = wf["nodes"][0]["parameters"]["jsCode"]
            self.assertIn("'desentupidora'", js)
            self.assertTrue(js.startswith("const X = 1;") and js.endswith("const Y = 2;"))
            self.assertEqual(wf["nodes"][1], wf_falso()["nodes"][1])
            self.assertEqual(aplicar_femininos(wf, linha_femininos())[1], 0)

        def test_o_original_nao_e_alterado(self):
            original = wf_falso()
            aplicar_femininos(original, linha_femininos())
            self.assertEqual(original, wf_falso())

        def test_artigo_da_mensagem(self):
            prog = ((AQUI / "site-mensagem.js").read_text(encoding="utf-8")
                    + "\nconsole.log(JSON.stringify(['Desentupidora Rápida', 'Contabilidade Silva', 'Escritório Lima',"
                      " 'Usinagem Precisão', 'Silva Advocacia'].map(artigoDe)));")
            with tempfile.TemporaryDirectory() as d:
                arq = Path(d) / "m.js"
                arq.write_text(prog, encoding="utf-8")
                r = subprocess.run([node(), arq], capture_output=True, text=True, timeout=60)
            self.assertEqual(json.loads(r.stdout), ["da", "da", "do", "da", "do"])

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Nichos))
    return 0 if r.wasSuccessful() else 1


# ------------------------------------------------------------------ aplicar

def guardar(nome: str, wf: dict) -> Path:
    import json
    BACKUPS.mkdir(parents=True, exist_ok=True)
    copia = BACKUPS / f"{nome}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    copia.write_text(json.dumps(wf, ensure_ascii=False), encoding="utf-8")
    return copia


def main() -> int:
    from n8n import api, put

    linha = linha_femininos()
    achou = 0
    for resumo in api("GET", "/workflows?limit=200")["data"]:
        if resumo.get("isArchived"):
            continue  # arquivado não aceita PUT (400) e não roda
        wf = api("GET", f"/workflows/{resumo['id']}")
        novo, mudou = aplicar_femininos(wf, linha)
        if mudou:
            achou += 1
            copia = guardar("femininos-" + wf["id"], wf)
            put(novo)
            if wf.get("active"):
                api("POST", f"/workflows/{wf['id']}/activate")
            print(f"{wf['name']}: FEMININOS em {mudou} nó(s) (anterior em {copia})")
    if not achou:
        print("FEMININOS: todos os fluxos já estavam com a lista de site-mensagem.js")
    return 0


if __name__ == "__main__":
    sys.exit(testar() if "--testar" in sys.argv else main())
