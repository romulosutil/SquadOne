#!/usr/bin/env python3
"""Testes da Entrada (recebimento, bloqueio, cofre, fila). python3 entrada.test.py

Usa o age de verdade para o cofre (sem ele, os testes que o precisam pulam).
Segredos falsos, montados em tempo de execução.
"""
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import entrada as e  # noqa: E402
from cofre import Cofre  # noqa: E402

TEM_AGE = bool(shutil.which("age") and shutil.which("age-keygen"))
AGE_FALSA = "AGE-SECRET" + "-KEY-1" + "Q" * 40
GHP = "gh" + "p_" + "A1b2C3d4" * 5
SENHA = "s3nh4-Forte-9X"
ENT_FALSA = "Zk9Qx2Lm4Vb7Nc1Rt8Yw3Ph6Df5Gj0Ae9Sx2Kq"
PEM = "-----BEGIN " + "OPENSSH PRIVATE" + " KEY-----\nAAAAB3NzaC1\n-----END OPENSSH PRIVATE KEY-----"


def corpo(dados):
    b = dados.encode() if isinstance(dados, str) else dados
    return io.BytesIO(b), len(b)


class Base(unittest.TestCase):
    com_cofre = True

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="entrada-teste-"))
        self.cofre = None
        if self.com_cofre and TEM_AGE:
            raiz = self.tmp / "Cofre"
            raiz.mkdir(mode=0o700)
            self.ident = self.tmp / "mel.txt"
            subprocess.run(["age-keygen", "-o", str(self.ident)], check=True, capture_output=True)
            pub = subprocess.run(["age-keygen", "-y", str(self.ident)], check=True, capture_output=True, text=True).stdout.strip()
            (raiz / "recipients.txt").write_text(pub + "\n")
            self.cofre = Cofre(raiz, self.ident)
        self.ent = e.Entrada(self.tmp / "Entrada", self.cofre, agora=lambda: datetime(2026, 10, 4, 19, 0, 0))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)       # só a pasta temporária do teste

    def enviar(self, acao, dados, **kw):
        b, n = corpo(dados)
        return self.ent.receber(acao, b, n, **kw)

    def arquivos(self, pasta):
        return sorted(p.name for p in pasta.iterdir() if not p.name.startswith("."))

    def tudo_no_disco(self):
        """Bytes de todos os arquivos do teste, menos as identidades privadas."""
        out = b""
        for p in self.tmp.rglob("*"):
            if p.is_file() and p.name != "mel.txt":
                out += p.read_bytes()
        return out

    def diario(self):
        p = self.ent.arq_diario
        return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []


class Cofre_(Base):
    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_cofre_cifra_indexa_e_recupera_sem_vazar(self):
        """Critério da Fase 6: 'Cofre' cifra, o índice e o diário não têm o valor, age -d recupera."""
        r = self.enviar("cofre", f"# gerada em teste\n{AGE_FALSA}\n", rotulo="chave de teste", nome="chave-teste.txt")
        self.assertTrue(r["ok"])
        self.assertNotIn(AGE_FALSA, json.dumps(r))
        self.assertEqual(self.arquivos(self.ent.chegou), [])                  # nada em claro
        self.assertEqual(self.arquivos(self.ent.fila), [])                    # nada para o agente
        self.assertNotIn(AGE_FALSA.encode(), self.tudo_no_disco())            # só existe cifrado
        idx = (self.tmp / "Cofre/indice.json").read_text()
        self.assertNotIn(AGE_FALSA, idx)
        self.assertIn("chave de teste", idx)
        self.assertNotIn(AGE_FALSA, self.ent.arq_diario.read_text())
        self.assertEqual(self.cofre.ler(r["id"]).decode(), f"# gerada em teste\n{AGE_FALSA}\n")
        dec = subprocess.run(["age", "-d", "-i", str(self.ident), str(self.tmp / "Cofre" / f"{r['id']}.age")],
                             capture_output=True, check=True).stdout.decode()
        self.assertIn(AGE_FALSA, dec)

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_cofre_exige_rotulo_e_rotulo_nao_pode_ser_segredo(self):
        with self.assertRaises(e.Recusado) as x:
            self.enviar("cofre", "valor")
        self.assertEqual(x.exception.codigo, 400)
        with self.assertRaises(e.Recusado) as x:
            self.enviar("cofre", "valor", rotulo=f"é {GHP}")
        self.assertEqual(x.exception.codigo, 422)
        self.assertNotIn(GHP, x.exception.mensagem)
        self.assertEqual(self.cofre.listar(), [])

    def test_sem_cofre_configurado(self):
        ent = e.Entrada(self.tmp / "E2", None)
        b, n = corpo("v")
        with self.assertRaises(e.Recusado) as x:
            ent.receber("cofre", b, n, rotulo="x")
        self.assertEqual(x.exception.codigo, 503)


class Organizar(Base):
    def test_texto_limpo_entra_na_fila_com_trecho_para_o_agente(self):
        r = self.enviar("organizar", "Reunião com o cliente na terça. Levar o contrato.", rotulo="anotação")
        self.assertTrue(r["ok"])
        itens = self.ent.pendentes()
        self.assertEqual(len(itens), 1)
        it = itens[0]
        self.assertEqual((it["estado"], it["tipo"], it["rotulo"], it["tentativas"]), ("pendente", "texto", "anotação", 0))
        self.assertIn("Levar o contrato", it["texto"])
        self.assertTrue((self.ent.chegou / it["arquivo"]).is_file())
        self.assertEqual(self.arquivos(self.ent.tmp), [])
        self.assertEqual([d["evento"] for d in self.diario()], ["na-fila"])

    def test_chave_teste_com_age_falsa_e_bloqueada_e_nada_fica_em_disco(self):
        """Critério da Fase 6: 'Organizar' BLOQUEIA o chave-teste.txt com AGE-SECRET-KEY falsa."""
        with self.assertRaises(e.Recusado) as x:
            self.enviar("organizar", f"minha chave:\n{AGE_FALSA}\n", nome="chave-teste.txt")
        ex = x.exception
        self.assertEqual(ex.codigo, 422)
        self.assertTrue(ex.extra["bloqueado"])
        self.assertIn("age-chave-secreta", ex.extra["regras"])
        self.assertNotIn(AGE_FALSA, json.dumps([ex.mensagem, ex.extra]))
        self.assertEqual(self.arquivos(self.ent.chegou), [])
        self.assertEqual(self.arquivos(self.ent.fila), [])
        self.assertEqual(self.arquivos(self.ent.tmp), [])
        self.assertNotIn(AGE_FALSA.encode(), self.tudo_no_disco())
        self.assertEqual([d["evento"] for d in self.diario()], ["bloqueado"])

    def test_segredo_so_de_entropia_tambem_bloqueia(self):
        with self.assertRaises(e.Recusado):
            self.enviar("organizar", "a chave é Zk9Qx2Lm4Vb7Nc1Rt8Yw3Ph6Df5Gj0Ae9Sx2Kq e pronto")
        self.assertEqual(self.ent.pendentes(), [])

    def test_rotulo_ou_nome_com_segredo_bloqueia(self):
        for kw in ({"rotulo": f"token {GHP}"}, {"nome": f"{GHP}.txt"}):
            with self.assertRaises(e.Recusado) as x:
                self.enviar("organizar", "texto limpo", **kw)
            self.assertEqual(x.exception.codigo, 422)
        self.assertEqual(self.arquivos(self.ent.fila), [])

    def test_binario_limpo_vai_para_a_fila_sem_texto_para_o_modelo(self):
        dados = b"\x89PNG\r\n\x1a\n\x00\x00" + bytes(range(256)) * 20
        r = self.enviar("organizar", dados, nome="foto.png")
        it = self.ent.pendentes()[0]
        self.assertTrue(r["ok"])
        self.assertIsNone(it["texto"])
        self.assertEqual(it["tipo"], "image/png")
        self.assertEqual((self.ent.chegou / it["arquivo"]).read_bytes(), dados)

    def test_binario_com_chave_privada_dentro_e_bloqueado(self):
        with self.assertRaises(e.Recusado):
            self.enviar("organizar", b"\x00\x01\x02 lixo " + PEM.encode() + b" mais lixo\x00", nome="x.bin")
        self.assertEqual(self.arquivos(self.ent.chegou), [])
        self.assertEqual(self.arquivos(self.ent.tmp), [])

    def test_segredo_na_emenda_de_pedacos_de_arquivo_grande_e_pego(self):
        # 6 MB (acima do limite de texto): a varredura é por bytes, com sobra entre pedaços
        corte = e.PEDACO
        dados = b"\x00" + b"a" * (corte - 1 - 20) + AGE_FALSA.encode() + b"b" * (6 * 1024 * 1024)
        with self.assertRaises(e.Recusado) as x:
            self.enviar("organizar", dados, nome="grande.bin")
        self.assertIn("age-chave-secreta", x.exception.extra["regras"])
        self.assertEqual(self.arquivos(self.ent.chegou), [])

    def test_limite_de_tamanho(self):
        ent = e.Entrada(self.tmp / "E3", None, limite=100)
        b, n = corpo(b"x" * 101)
        with self.assertRaises(e.Recusado) as x:
            ent.receber("organizar", b, n)
        self.assertEqual(x.exception.codigo, 413)

    def test_corpo_menor_que_o_anunciado_nao_deixa_rastro(self):
        with self.assertRaises(e.Recusado) as x:
            self.ent.receber("organizar", io.BytesIO(b"curto"), 50)
        self.assertEqual(x.exception.codigo, 400)
        self.assertEqual(self.arquivos(self.ent.tmp), [])
        self.assertEqual(self.arquivos(self.ent.chegou), [])

    def test_acao_desconhecida_e_vazio(self):
        for acao, n in (("apagar", 3), ("organizar", 0)):
            with self.assertRaises(e.Recusado):
                self.ent.receber(acao, io.BytesIO(b"abc"), n)


class RedigirNoCofre(Base):
    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_segundo_clique_guarda_o_segredo_no_cofre_e_segue_so_o_resto(self):
        texto = f"Servidor novo do cliente.\nsenha: {SENHA}\nchave do repo {GHP}\nCombinar a migração."
        with self.assertRaises(e.Recusado) as x:
            self.enviar("organizar", texto, rotulo="acesso do cliente")
        self.assertTrue(x.exception.extra["pode_redigir"])
        r = self.enviar("organizar", texto, rotulo="acesso do cliente", com_cofre=True)
        self.assertEqual(len(r["segredos_no_cofre"]), 2)
        it = self.ent.pendentes()[0]
        self.assertIn("{{SEGREDO:" + r["segredos_no_cofre"][0] + "}}", it["texto"])
        self.assertIn("Combinar a migração.", it["texto"])
        for valor in (SENHA, GHP):
            self.assertNotIn(valor, it["texto"])
            self.assertNotIn(valor.encode(), self.tudo_no_disco(), "o valor só pode existir cifrado")
        self.assertNotIn(SENHA, self.ent.arq_diario.read_text())
        self.assertEqual(self.arquivos(self.ent.tmp), [])
        # cada segredo está no cofre e recupera
        achados = {self.cofre.ler(i).decode() for i in r["segredos_no_cofre"]}
        self.assertEqual(achados, {SENHA, GHP})
        self.assertEqual(len(self.cofre.listar()), 2)

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_binario_nao_se_redige_nem_com_o_segundo_clique(self):
        with self.assertRaises(e.Recusado) as x:
            self.enviar("organizar", b"\x00" + PEM.encode(), nome="k.bin", com_cofre=True)
        self.assertTrue(x.exception.extra["bloqueado"])
        self.assertEqual(self.cofre.listar(), [])
        self.assertEqual(self.arquivos(self.ent.chegou), [])
        self.assertNotIn(b"OPENSSH PRIVATE", self.tudo_no_disco())

    def test_sem_segredo_o_segundo_clique_nao_muda_nada(self):
        r = self.enviar("organizar", "só anotação comum", com_cofre=True)
        self.assertEqual(r["segredos_no_cofre"], [])


class Guardar(Base):
    def test_guardar_tambem_bloqueia_segredo_e_nada_fica_em_disco(self):
        for dados in (f"senha: {SENHA}", f"x\n{AGE_FALSA}\n", f"token {GHP}"):
            with self.assertRaises(e.Recusado) as x:
                self.enviar("guardar", dados, nome="notas.txt")
            self.assertEqual(x.exception.codigo, 422)
            self.assertTrue(x.exception.extra["bloqueado"])
            self.assertNotIn(SENHA, json.dumps([x.exception.mensagem, x.exception.extra]))
        self.assertEqual(self.arquivos(self.ent.chegou), [])
        self.assertEqual(self.arquivos(self.ent.fila), [])
        self.assertNotIn(SENHA.encode(), self.tudo_no_disco())
        self.assertNotIn(AGE_FALSA.encode(), self.tudo_no_disco())

    def test_guardar_limpo_vai_para_chegou_sem_fila(self):
        r = self.enviar("guardar", "uma ideia solta", nome="ideia.txt")
        self.assertNotIn("aviso", r)
        self.assertEqual(self.arquivos(self.ent.fila), [])
        self.assertEqual([d["evento"] for d in self.diario()], ["guardado"])

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_guardar_com_o_segundo_clique_manda_o_segredo_ao_cofre_e_guarda_o_resto(self):
        r = self.enviar("guardar", f"nota\nsenha: {SENHA}\nfim", nome="notas.txt", com_cofre=True)
        self.assertEqual(len(r["segredos_no_cofre"]), 1)
        guardado = next(self.ent.chegou.iterdir()).read_text()
        self.assertNotIn(SENHA, guardado)
        self.assertIn("{{SEGREDO:" + r["segredos_no_cofre"][0] + "}}", guardado)
        self.assertEqual(self.cofre.ler(r["segredos_no_cofre"][0]).decode(), SENHA)
        self.assertNotIn(SENHA.encode(), self.tudo_no_disco())


class Nomes(unittest.TestCase):
    def test_nome_seguro(self):
        casos = {"../../etc/passwd": "passwd", "..\\..\\x.txt": "x.txt", ".bashrc": "bashrc", "a/b/c.pdf": "c.pdf",
                 "relatório final (v2).pdf": "relatório final (v2).pdf", "": "arquivo", None: "arquivo",
                 "x\x00y.txt": "x_y.txt", "  ": "arquivo", "...": "arquivo"}
        for entrada_, esperado in casos.items():
            self.assertEqual(e.nome_seguro(entrada_), esperado, repr(entrada_))
        longo = e.nome_seguro("a" * 300 + ".pdf")
        self.assertLessEqual(len(longo.encode()), e.MAX_NOME_BYTES)
        self.assertTrue(longo.endswith(".pdf"))
        cjk = e.nome_seguro("あ" * 96 + ".txt")                       # 3 bytes por caractere: 96 caracteres estourariam o disco
        self.assertLessEqual(len(cjk.encode()), e.MAX_NOME_BYTES)
        self.assertTrue(cjk.endswith(".txt"))

    def test_nome_do_arquivo_nao_escapa_de_chegou(self):
        tmp = Path(tempfile.mkdtemp(prefix="entrada-teste-"))
        try:
            ent = e.Entrada(tmp / "E", None)
            b, n = corpo("oi")
            ent.receber("guardar", b, n, nome="../../fora.txt")
            self.assertEqual([p.name.split("-", 4)[-1] for p in ent.chegou.iterdir()], ["fora.txt"])
            self.assertFalse((tmp / "fora.txt").exists())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Diario(Base):
    def test_diario_troca_segredo_por_oculto(self):
        self.ent.diario("teste", campo=f"valor {GHP}", ok="texto normal", n=3)
        reg = self.diario()[-1]
        self.assertEqual((reg["campo"], reg["ok"], reg["n"]), ("<oculto>", "texto normal", 3))
        self.assertNotIn(GHP, self.ent.arq_diario.read_text())

    def test_permissoes_das_pastas(self):
        import stat
        for p in (self.ent.raiz, self.ent.chegou, self.ent.fila, self.ent.organizado, self.ent.requisicoes, self.ent.tmp):
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700, p)
        self.ent.diario("x")
        self.assertEqual(stat.S_IMODE(self.ent.arq_diario.stat().st_mode), 0o600)


class Revisao_de_seguranca(Base):
    """O que a revisão adversarial de 04/10 conseguiu quebrar, agora como teste."""

    def test_processo_morto_no_meio_do_envio_nao_deixa_texto_claro(self):
        import signal
        codigo = (
            "import io, os, sys, signal\n"
            f"sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n"
            "import entrada as e\n"
            "class Corpo:\n"
            "    n = 0\n"
            "    def read(self, k):\n"
            "        self.n += 1\n"
            "        if self.n == 1:\n"
            "            return b'ola, tudo certo por aqui ' * 1000 + b'MARCA-EM-CLARO-NO-DISCO ' + b'x' * 100\n"
            "        os.kill(os.getpid(), signal.SIGKILL)\n"
            f"ent = e.Entrada(__import__('pathlib').Path({str(self.tmp / 'Entrada')!r}), None)\n"
            "ent.receber('guardar', Corpo(), 3_000_000, nome='x.txt')\n"
        )
        r = subprocess.run([sys.executable, "-c", codigo], capture_output=True, timeout=60)
        self.assertEqual(r.returncode, -signal.SIGKILL, r.stderr[-300:])
        self.assertNotIn(b"MARCA-EM-CLARO-NO-DISCO", self.tudo_no_disco(), "o temporário não tem nome nem sobra")
        self.assertEqual([p.name for p in self.ent.tmp.iterdir()], [])

    def test_na_subida_apaga_temporarios_antigos_com_nome(self):
        velho = self.ent.tmp / "abcdef.parte"
        velho.write_bytes(b"texto claro de uma versao antiga")
        e.Entrada(self.tmp / "Entrada", None)
        self.assertFalse(velho.exists())

    def test_segundo_clique_nao_grava_o_texto_inteiro_em_claro_antes_de_redigir(self):
        # o texto fica só em memória: nenhum arquivo (nem sem nome) com o segredo existe durante a redação
        vistos = []
        orig = e.Entrada._redigir_no_cofre

        def espiao(self_, texto, rotulo):
            vistos.append(self_.tudo_no_disco() if hasattr(self_, "tudo_no_disco") else
                          b"".join(p.read_bytes() for p in (self_.raiz).rglob("*") if p.is_file()))
            return orig(self_, texto, rotulo)
        e.Entrada._redigir_no_cofre = espiao
        try:
            if TEM_AGE:
                self.enviar("organizar", f"nota\nsenha: {SENHA}\nfim", com_cofre=True)
        finally:
            e.Entrada._redigir_no_cofre = orig
        for v in vistos:
            self.assertNotIn(SENHA.encode(), v)

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_segundo_clique_tem_teto_de_segredos_e_nao_guarda_nada_antes_de_recusar(self):
        texto = "\n".join(f"token=abc{n:05d}xyz" for n in range(e.MAX_SEGREDOS_REDIGIR + 5))
        with self.assertRaises(e.Recusado) as x:
            self.enviar("organizar", texto, com_cofre=True)
        self.assertTrue(x.exception.extra["bloqueado"])
        self.assertFalse(x.exception.extra["pode_redigir"])
        self.assertEqual(self.cofre.listar(), [], "nada vai ao cofre quando passa do teto")
        # e o primeiro clique já não oferece o botão
        with self.assertRaises(e.Recusado) as x:
            self.enviar("organizar", texto)
        self.assertFalse(x.exception.extra["pode_redigir"])

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_segundo_clique_guarda_a_frase_senha_inteira_no_cofre(self):
        for valor in ["cavalo correto bateria grampo", 'ela disse "oi" e saiu; depois (voltou)', "Kx9;mP2)vL8]"]:
            r = self.enviar("organizar", f"servidor\nsenha: {valor}\nfim", com_cofre=True)
            self.assertEqual({self.cofre.ler(i).decode() for i in r["segredos_no_cofre"]}, {valor})
            visto = (self.ent.chegou / next(p.name for p in self.ent.chegou.iterdir() if r["id"] in p.name)).read_text()
            self.assertNotIn(valor[:6], visto)

    def test_utf16_latin1_e_arquivo_grande_com_segredo_sao_bloqueados(self):
        casos = [("utf-16", f"x\nsenha: {SENHA}\n"), ("utf-16", AGE_FALSA), ("latin-1", f"ação\nAWS={ENT_FALSA}\n"),
                 ("utf-8", "linha\n" * 900_000 + f"x_{ENT_FALSA}\n")]                  # ~6 MB: só varredura de bytes
        for codif, texto in casos:
            for acao in ("organizar", "guardar"):
                with self.assertRaises(e.Recusado, msg=f"{codif}/{acao}"):
                    self.enviar(acao, texto.encode(codif), nome="x.txt")
        self.assertEqual(self.arquivos(self.ent.chegou), [])
        self.assertEqual(self.arquivos(self.ent.fila), [])

    def test_arquivo_utf16_limpo_vira_texto_para_o_agente(self):
        self.enviar("organizar", "Reunião com o cliente na terça.".encode("utf-16"), nome="nota.txt")
        it = self.ent.pendentes()[0]
        self.assertEqual(it["tipo"], "texto")
        self.assertIn("Reunião com o cliente", it["texto"])

    def test_o_trecho_do_agente_e_mascarado_e_cortado_em_fim_de_linha(self):
        hex64 = "9f2c" * 16
        self.enviar("organizar", f"Anotação nova\nchave {hex64}\nfim", nome="anotacao.txt")
        it = self.ent.pendentes()[0]
        self.assertNotIn(hex64, it["texto"])
        self.assertNotIn(hex64[:8], it["texto"])
        self.assertIn("Anotação nova", it["texto"])
        longo = "linha de anotação comum\n" * 600
        self.enviar("organizar", longo, nome="longo.txt")
        it2 = [i for i in self.ent.pendentes() if i["nome_original"] == "longo.txt"][0]
        self.assertTrue(it2["texto_truncado"])
        self.assertTrue(it2["texto"].endswith("anotação comum"))
        self.assertLessEqual(len(it2["texto"]), e.TRECHO_MODELO)

    def test_segredo_partido_em_linhas_nao_manda_texto_ao_agente(self):
        a, b = "gh" + "p_A1b2C3d4", "E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
        with self.assertRaises(e.Recusado):
            self.enviar("organizar", f"token\n{a}\n{b}\n")
        # o segundo clique também recusa (não há posição para redigir)
        if TEM_AGE:
            with self.assertRaises(e.Recusado) as x:
                self.enviar("organizar", f"token\n{a}\n{b}\n", com_cofre=True)
            self.assertFalse(x.exception.extra["pode_redigir"])

    def test_id_repetido_e_pulado_e_nao_sobrescreve_o_item_anterior(self):
        from unittest import mock
        self.enviar("organizar", "um", nome="um.txt")
        primeiro = self.ent.pendentes()[0]["id"]
        sufixo = primeiro.rsplit("-", 1)[1]
        with mock.patch.object(e._secrets, "token_hex", side_effect=[sufixo, sufixo, "0badc0de"] + ["00000000"] * 8):
            self.enviar("organizar", "dois", nome="dois.txt")
        ids = sorted(i["id"] for i in self.ent.itens())
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(self.arquivos(self.ent.chegou)), 2)

    def test_nome_multibyte_longo_nao_estoura_o_disco(self):
        r = self.enviar("organizar", "oi", nome="あ" * 96 + ".txt")
        self.assertTrue(r["ok"])

    def test_rotulo_com_invisivel_ou_direcao_e_recusado(self):
        for rotulo in ("nota\u202eotxt", "nota\u200bx", "nota\x85x", "a\ud800b"):
            with self.assertRaises(e.Recusado):
                self.enviar("organizar", "oi", rotulo=rotulo)

    def test_diario_aguenta_surrogate_solto(self):
        self.ent.diario("teste", campo="oi \ud800 fim")
        self.assertIn('"evento": "teste"', self.ent.arq_diario.read_text())


class Segunda_rodada_de_revisao(Base):
    """Achados da 2ª rodada de revisão adversarial (04/10/2026)."""

    def test_bom_utf16_falso_nao_esconde_o_segredo(self):
        # arquivo que só COMEÇA com o BOM e é ASCII: virava ideogramas reversíveis e passava pelo filtro
        for corpo_ascii in (f"# chave\n{AGE_FALSA}\nsenha do banco: x\n", f"senha: {SENHA}\n", f"nota\n{PEM}\n"):
            for extra in ("", "x"):                              # tamanho par e ímpar
                dados = b"\xff\xfe" + (corpo_ascii + extra).encode()
                for acao in ("organizar", "guardar"):
                    with self.assertRaises(e.Recusado, msg=f"{acao}/{len(dados)}"):
                        self.enviar(acao, dados, nome="x.txt")
        self.assertEqual(self.arquivos(self.ent.chegou), [])
        self.assertEqual(self.arquivos(self.ent.fila), [])
        self.assertNotIn(AGE_FALSA[:20].encode(), self.tudo_no_disco())

    def test_utf16_de_verdade_com_ascii_acrescentado_depois_e_bloqueado(self):
        # o `echo ... >> arquivo.txt` do cmd do Windows acrescenta ASCII a um arquivo UTF-16 com BOM. Com um corpo
        # longo o resultado ainda parece texto (passa na checagem de plausibilidade): só a varredura dos BYTES pega.
        corpo_longo = ("Reunião com o cliente sobre a proposta de 2026 e o contrato revisado.\r\n" * 30)
        rabo = f"senha: {SENHA} \r\n".encode()
        self.assertEqual(len(rabo) % 2, 0, "rabo de tamanho par: senão o decode de UTF-16 falha por outro motivo")
        dados = corpo_longo.encode("utf-16") + rabo
        self.assertIsNotNone(e.Entrada._decodificar(dados), "o corpo longo ainda é plausível: o teste só vale assim")
        for acao in ("organizar", "guardar"):
            with self.assertRaises(e.Recusado, msg=acao):
                self.enviar(acao, dados, nome="nota.txt")
        self.assertEqual(self.arquivos(self.ent.fila), [])
        self.assertEqual(self.arquivos(self.ent.chegou), [])

    def test_bom_falso_sem_segredo_e_tratado_como_binario_e_nao_vira_texto_para_o_modelo(self):
        dados = b"\xff\xfe" + "so uma anotacao simples aqui!\n".encode()
        self.assertEqual(len(dados) % 2, 0, "tamanho par: senão o decode falha por outro motivo")
        self.assertIsNotNone(dados.decode("utf-16"), "decodifica (em ideogramas): só a plausibilidade o recusa")
        self.enviar("organizar", dados, nome="nota.dat")
        it = self.ent.pendentes()[0]
        self.assertIsNone(it["texto"])
        self.assertNotEqual(it["tipo"], "texto")

    def test_utf16_com_acentos_e_cirilico_continua_texto(self):
        self.enviar("organizar", "Reunião — Привет мир, ação 2026".encode("utf-16"), nome="nota.txt")
        it = self.ent.pendentes()[0]
        self.assertEqual(it["tipo"], "texto")
        self.assertIn("Привет", it["texto"])

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_sobra_de_segredo_depois_de_redigir_recusa_e_nao_guarda_nada(self):
        # o cinto de segurança (`tem_segredo(novo)`): um redigir que deixe segredo no texto não pode seguir
        from unittest import mock
        with mock.patch.object(e.segredos, "redigir", return_value=(f"senha: {SENHA}\n", [])):
            with self.assertRaises(e.Recusado) as x:
                self.enviar("organizar", f"senha: {SENHA}\n", com_cofre=True)
        self.assertEqual(x.exception.codigo, 422)
        self.assertIn("Sobrou", str(x.exception))
        self.assertFalse(x.exception.extra["pode_redigir"])
        self.assertEqual(self.arquivos(self.ent.chegou), [])
        self.assertEqual(self.arquivos(self.ent.fila), [])
        self.assertNotIn("redigido", [d["evento"] for d in self.diario()])


if __name__ == "__main__":
    unittest.main(verbosity=1)
