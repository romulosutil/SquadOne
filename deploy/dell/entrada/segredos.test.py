#!/usr/bin/env python3
"""Testes do filtro de segredos da Entrada. python3 segredos.test.py

Todo segredo aqui é FALSO e montado em tempo de execução (pedaços concatenados ou sorteados com
semente fixa), para este arquivo não disparar nenhum scanner de segredo.

Regra de ouro: nada de "o valor inteiro não aparece". Segredo redigido pela metade passaria nesse
teste e vazaria quase tudo; por isso se procura PEDAÇOS do valor (`vaza`).
"""
import random
import re
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import segredos as s  # noqa: E402

GHP = "gh" + "p_" + "A1b2C3d4" * 5
GHP_PAT = "github" + "_pat_" + "Ab1" * 10
AKIA = "AK" + "IA" + "ABCDEFGHIJKLMNOP"
SK = "s" + "k-" + "proj-" + "Zq8" * 8
SK_ANT = "s" + "k-" + "ant-" + "Qw3" * 10
JWT = "ey" + "J" + "a" * 12 + "." + "b" * 12 + "." + "c" * 8
PEM = "-----BEGIN " + "OPENSSH PRIVATE" + " KEY-----\nAAAAB3NzaC1\n-----END OPENSSH PRIVATE KEY-----"
PEM_CORTADA = "-----BEGIN " + "RSA PRIVATE" + " KEY-----\nMIIEow"
AGE = "AGE-SECRET" + "-KEY-1" + "Q" * 40
SLACK = "xo" + "xb-" + "1234567890-abcdefghij"
GOOGLE = "AI" + "za" + "S" * 35
SENHA = "s3nh4-Forte-9X"
SENHA_BOA = "Pq7" + "wLz2Nv"
URL = "postgres://app:" + "s3nh4Forte9" + "@db:5432/x"
ENT = "Zk9Qx2Lm4Vb7Nc1Rt8Yw3Ph6Df5Gj0Ae9Sx2Kq"       # 39 caracteres, misturado
ID1 = "c-20261004-121212-abcd"
ID2 = "c-20261004-121212-0002"
ASCII94 = "".join(chr(c) for c in range(33, 127))
ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def regras(texto, **kw):
    return {a.regra for a in s.procurar(texto, **kw)}


def vaza(visao, valor):
    """O valor (ou um pedaço dele) está em `visao`? Para valor longo, qualquer pedaço de 6 caracteres conta."""
    if visao is None:
        return False
    if len(valor) < 10:
        return valor in visao
    return any(valor[i:i + 6] in visao for i in range(len(valor) - 5))


def aleatorio(r, n, alfabeto):
    return "".join(r.choice(alfabeto) for _ in range(n))


class Positivos(unittest.TestCase):
    def test_cada_regra_acha_o_seu(self):
        casos = {
            "token-conhecido": [f"export X={GHP}", GHP_PAT, SK, SK_ANT, f"id {AKIA} fim", SLACK, GOOGLE, f"tok {JWT}",
                                "gl" + "pat-" + "Ab1" * 10, "sk" + "_live_" + "Ab1" * 8],
            "chave-privada": [PEM, "texto antes\n" + PEM_CORTADA],
            "age-chave-secreta": [AGE, f"# created\n{AGE}\n"],
            "authorization": ["Authorization: Bearer abcdef1234567890", "authorization = Basic dXNlcjpwYXNz"],
            "url-com-credencial": [URL, "https://u:" + "x9y8z7w6" + "@host/p"],
            "chave-valor": [f"senha: {SENHA}", f"password={SENHA}", f'"password": "{SENHA}"', f"DB_TOKEN = {SENHA}",
                            f"api_key => {SENHA}", f"client-secret: {SENHA}", f"senha do wifi: {SENHA_BOA}",
                            f"a senha é {SENHA_BOA}", f"chave da API do cliente: {SENHA_BOA}", "senha: x7k",
                            f"DB_PWD={SENHA_BOA}", f"passphrase: {SENHA_BOA}", "PIN do cartão: 4821",
                            "MY_COMPANY_APPLICATION_PRODUCTION_PRIMARY_DATABASE_PASSWORD=" + SENHA_BOA],
            "linha-de-comando": [f"mysql -u root --password {SENHA_BOA} -h db", f"mysql -uroot -p{SENHA_BOA} prod",
                                 f"curl -u admin:{SENHA_BOA} https://api.x/v1", f"cmd --token={SENHA_BOA}"],
            "tag-xml": [f"<password>{SENHA_BOA}</password>"],
            "alta-entropia": [f"o código foi {ENT} ontem"],
            "base64-de-usuario-e-senha": ["dXNlcjpzZW5oYTEyMw=="],
        }
        for regra, textos in casos.items():
            for t in textos:
                self.assertIn(regra, regras(t), f"{regra}: {t[:50]!r} -> {regras(t)}")

    def test_prefixo_de_token_colado_a_outra_coisa_tambem_e_pego(self):
        # "\\b" falhava aqui: x_ghp_... e id=AKIA... (quem ganha a fusão pode ser a entropia: o que importa é bloquear)
        for t in ["x_" + GHP, "id=" + AKIA, "k:" + GHP_PAT, "(" + SK + ")"]:
            a = s.procurar(t)
            self.assertTrue(a, t)
            self.assertTrue(any(t[x.inicio:x.fim] in t and (GHP[5:] in t[x.inicio:x.fim] or AKIA[4:] in t[x.inicio:x.fim]
                                                            or GHP_PAT[11:] in t[x.inicio:x.fim] or SK[8:] in t[x.inicio:x.fim])
                            for x in a), t)

    def test_o_achado_aponta_o_valor_e_a_linha_sem_guarda_lo(self):
        t = f"linha 1\nsenha: {SENHA}\nlinha 3"
        a = s.procurar(t)[0]
        self.assertEqual(t[a.inicio:a.fim], SENHA)
        self.assertEqual(a.linha, 2)
        r = s.resumo([a])
        self.assertEqual(r, {"total": 1, "regras": ["chave-valor"], "linhas": [2]})
        self.assertNotIn(SENHA, repr(r))

    def test_valor_vai_ate_o_fim_da_linha(self):
        for t, valor in [("senha: Kx9;mP2)vL8]", "Kx9;mP2)vL8]"),
                         ('db:\n  password: "cavalo correto bateria grampo"', '"cavalo correto bateria grampo"'),
                         (f"token: {{{SENHA_BOA}}}", f"{{{SENHA_BOA}}}")]:
            a = s.procurar(t)
            self.assertEqual(len(a), 1, t)
            self.assertEqual(t[a[0].inicio:a[0].fim], valor)

    def test_pem_inteira_vira_um_achado_so(self):
        t = f"antes\n{PEM}\ndepois"
        a = s.procurar(t)
        self.assertEqual([x.regra for x in a], ["chave-privada"])
        self.assertEqual(t[a[0].inicio:a[0].fim], PEM)

    def test_sobreposicao_conta_uma_vez(self):
        self.assertEqual(len(s.procurar(f"senha: {AGE}")), 1)

    def test_senha_so_de_letras_tambem_e_pega(self):
        # as senhas fracas de banco da Mel são assim; valor curto e comum não pode escapar
        self.assertIn("chave-valor", regras("senha: abcdefg"))
        self.assertIn("chave-valor", regras("senha: abc"))

    def test_palavra_fraca_so_vale_com_valor_de_cara_de_segredo(self):
        self.assertIn("chave-valor", regras(f"chave: {SENHA_BOA}"))
        self.assertIn("chave-valor", regras(f"ssh key: {SENHA_BOA}"))
        for t in ["key: name", "chave: dono", "pin: ok", "seed: pessoal", "chave do problema é a comunicação"]:
            self.assertNotIn("chave-valor", regras(t), t)


class Negativos(unittest.TestCase):
    def test_prosa_e_dados_comuns_passam(self):
        for t in [
            "Reunião com o cliente na terça. Levar o contrato e o orçamento.",
            "commit 3f786850e387550fdab836ed7e6dc881de23001b na main",
            "id 123e4567-e89b-12d3-a456-426614174000",
            "arquivo /home/romulo/Pasta Grande/relatorio-trimestral-final-2026-v2.pdf",
            "politica-de-privacidade-e-termos-de-uso-do-site-2026",
            "passo a passo: 12345678 itens, 1 de 2",
            "o token de acesso expira em 1h",
            "senha: ********",
            "password=${DB_PASS}",
            "PASSWORD: $SENHA_DO_BANCO",
            "senha = {{SEGREDO:" + ID1 + "}}",
            "a chave do repo é {{SEGREDO:" + ID1 + "}}",
            "tokenizar o texto em palavras",
            "2026-10-04 18:35:00",
            "Rodei `age -d` para decifrar e deu certo.",
            "credentials: null",
            "anticonstitucionalissimamente",
            "ssh -p22 mel hostname",
            "docker run -p8080:80 nginx",
            "compass: north",
            "https://github.com/romulosutil/SquadOne/pull/8",
            "token: ${{ secrets.GITHUB_TOKEN }}",
            "pass",
        ]:
            self.assertEqual(regras(t), set(), t)

    def test_marcador_nosso_nao_e_segredo(self):
        self.assertEqual(s.procurar("a senha do banco é {{SEGREDO:" + ID1 + "}}"), [])

    def test_marcador_com_outro_conteudo_nao_esconde_segredo(self):
        # {{SEGREDO:...}} só vale com um id de cofre de verdade; qualquer outra coisa dentro é achada,
        # com ou sem uma palavra de segredo antes (a reprocura depois do valor ignorado)
        for t in ["{{SEGREDO:" + GHP + "}}", "{{SEGREDO:" + SENHA + "}}", "{{SEGREDO:" + AGE + "}}",
                  "senha: {{SEGREDO:" + SENHA + "}}", "password={{SEGREDO:" + SENHA_BOA + "}}", "token: {" + SENHA_BOA + "}"]:
            self.assertTrue(s.procurar(t), t)
        # e o marcador verdadeiro, ao lado de segredo de verdade, não impede de achá-lo
        self.assertEqual(regras("{{SEGREDO:" + ID1 + "}} e senha: " + SENHA), {"chave-valor"})


class Corpus_do_revisor(unittest.TestCase):
    """Os segredos falsos que o primeiro filtro deixava passar (revisão adversarial de 04/10).
    Cada um tem que ser BLOQUEADO (`procurar`) ou, nos tipos que só se mascaram, ficar fora da visão do modelo."""
    HEX64 = "9f2c" * 16
    HEX32 = "a1b2c3d4" * 4
    TOTP = "JBSWY3DPEHPK3PXP"

    def casos(self):
        aws_a, aws_b = "wJalrXUtnFEMI/K7MDENG", "bPxRfiCYEXAMPLEKEY"
        ghp_a, ghp_b = "gh" + "p_A1b2C3d4E5f6G7h8", "I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4"
        frase = "cavalo correto bateria grampo lua mesa rio ponte vento pedra fogo nuvem"
        return [
            # (texto, valor, deve_bloquear)
            (f"Anotações da casa\nsenha do wifi: {SENHA_BOA}\n", SENHA_BOA, True),
            (f"Do banco: a senha é {SENHA_BOA}, não esquecer", SENHA_BOA, True),
            (f"chave da API do cliente: {SENHA_BOA}", SENHA_BOA, True),
            ("servidor novo\nsenha: Kx9;" + "mP2)vL8]\n", "Kx9;" + "mP2)vL8]", True),
            ("password: $" + "uperS3nh4!2026", "$" + "uperS3nh4!2026", True),
            ("senha=%" + "Tr0ub4dor&3", "%" + "Tr0ub4dor&3", True),
            ("token: {" + "Abc123}Xyz", "{" + "Abc123}Xyz", True),
            ("senha: x7k", "x7k", True),
            ('db:\n  password: "cavalo correto ' + 'bateria grampo"\n', "cavalo correto bateria grampo", True),
            (f"mysql -u root --password {SENHA_BOA} -h db", SENHA_BOA, True),
            (f"mysql -uroot -p{SENHA_BOA} prod", SENHA_BOA, True),
            (f"curl -u admin:{SENHA_BOA} https://api.x/v1", SENHA_BOA, True),
            (f"<password>{SENHA_BOA}</password>", SENHA_BOA, True),
            (f"DB_PWD={SENHA_BOA}", SENHA_BOA, True),
            (f"MY_COMPANY_APPLICATION_PRODUCTION_PRIMARY_DATABASE_PASSWORD={SENHA_BOA}", SENHA_BOA, True),
            (f"passphrase: {SENHA_BOA}", SENHA_BOA, True),
            ("PIN do cartão: 4821", "4821", True),
            (f"chave privada da carteira {self.HEX64}", self.HEX64, False),
            (f"api {self.HEX32}", self.HEX32, False),
            (f"2FA do banco {self.TOTP}", self.TOTP, False),
            ("gl" + "pat-" + "Ab1Cd2Ef3Gh4Ij5Kl6Mn7", "gl" + "pat-" + "Ab1Cd2Ef3Gh4Ij5Kl6Mn7", True),
            (frase, frase, False),
            ("dXNlcjpzZW5oYTEyMw==", "dXNlcjpzZW5oYTEyMw==", True),
            (f"aws secret\n{aws_a}\n{aws_b}\n", aws_a + aws_b, True),
            (f"token do github\n{ghp_a}\n{ghp_b}\n", ghp_a + ghp_b, True),
            (f"aws {aws_a} {aws_b}", aws_a + aws_b, True),
            ("gh­p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", True),
        ]

    def test_cada_caso_e_bloqueado_ou_mascarado(self):
        for texto, valor, deve_bloquear in self.casos():
            if deve_bloquear:
                self.assertTrue(s.procurar(texto), f"não bloqueou: {texto[:60]!r}")
            # a visão do modelo é a segunda barreira, e vale mesmo para o que foi bloqueado
            visao = s.mascarar_para_o_modelo(texto)
            self.assertFalse(vaza(visao, valor), f"a visão do modelo tem o valor: {texto[:60]!r} -> {visao!r}")


class Propriedade(unittest.TestCase):
    """Senhas aleatórias de 94 caracteres ASCII, em vários formatos, com semente fixa."""
    FORMATOS = ["senha: {v}", "password={v}", '"password": "{v}"', "DB_PASSWORD={v}", "a senha é {v}",
                "senha do wifi: {v}", "token: {v}", "api_key: {v}", "secret = {v}"]

    def test_todo_formato_e_bloqueado_e_redigido_por_inteiro(self):
        r = random.Random(20261004)
        for fmt in self.FORMATOS:
            for _ in range(150):
                v = aleatorio(r, r.randint(12, 24), ASCII94)
                texto = f"Anotações\n{fmt.format(v=v)}\nfim"
                self.assertTrue(s.procurar(texto), f"não bloqueou {fmt!r}: valor de {len(v)} caracteres")
                novo, _ = s.redigir(texto, lambda val, regra: ID1)
                self.assertFalse(vaza(novo, v), f"redigiu só em parte em {fmt!r}")
                self.assertEqual(s.procurar(novo), [], f"sobrou algo achável depois de redigir em {fmt!r}")
                self.assertFalse(vaza(s.mascarar_para_o_modelo(texto), v), f"a visão do modelo tem o valor em {fmt!r}")

    def test_senha_so_com_letras_minusculas_na_visao_do_modelo(self):
        r = random.Random(7)
        for _ in range(100):
            v = aleatorio(r, 12, "abcdefghijklmnopqrstuvwxyz")
            self.assertFalse(vaza(s.mascarar_para_o_modelo(f"senha: {v}"), v))

    def test_senha_solta_sem_palavra_chave_a_camada_do_modelo_esconde_quase_todas(self):
        # sem palavra-chave não há como bloquear (parece texto), mas o modelo não pode ver o valor
        r = random.Random(5)
        for n, minimo in ((10, 0.95), (12, 0.98), (16, 1.0), (24, 1.0)):
            escondidas = 0
            for _ in range(400):
                v = aleatorio(r, n, ASCII94)
                escondidas += not vaza(s.mascarar_para_o_modelo(f"anotei isto: {v} para depois"), v)
            self.assertGreaterEqual(escondidas / 400, minimo, f"{n} caracteres")
        for n in (16, 24):                                     # só letras e números: 16+ é pego; abaixo disso é indistinguível de palavra
            for _ in range(300):
                v = aleatorio(r, n, ALNUM)
                self.assertFalse(vaza(s.mascarar_para_o_modelo(f"o código foi {v} ontem"), v))

    def test_senhas_aleatorias_soltas_na_visao_do_modelo(self):
        # sem palavra-chave nenhuma: o que a camada do modelo pega só pela forma
        r = random.Random(11)
        for _ in range(300):
            v = aleatorio(r, r.randint(16, 28), ALNUM)
            self.assertFalse(vaza(s.mascarar_para_o_modelo(f"o código foi {v} ontem"), v), v)


class Invisiveis_e_partido(unittest.TestCase):
    def test_invisiveis_nao_escondem_o_segredo_e_saem_por_inteiro_na_redacao(self):
        for inv in ("­", "​", "‍", "⁠", "﻿"):
            texto = f"x\n{GHP[:10]}{inv}{GHP[10:]}\ny"
            a = s.procurar(texto)
            self.assertEqual(len(a), 1, repr(inv))
            self.assertTrue(a[0].redigivel)
            self.assertEqual(a[0].linha, 2)
            novo, _ = s.redigir(texto, lambda v, r: ID1)
            self.assertEqual(novo, f"x\n{{{{SEGREDO:{ID1}}}}}\ny")

    def test_posicoes_voltam_certas_com_invisiveis_em_varios_lugares(self):
        zw = "\u200b"
        casos = [
            f"{zw}{zw}x\n{zw}senha:{zw} {SENHA}{zw} fim",                       # antes e depois do valor
            f"a{zw}b{zw}{zw}c senha: {SENHA[:4]}{zw}{SENHA[4:]}",               # dentro do valor
            f"{SENHA_BOA}\n" + f"{zw}" * 50 + f"senha: {SENHA}",                  # muitos antes
            f"senha: {SENHA}{zw}{zw}{zw}",                                      # só depois
        ]
        for texto in casos:
            achados = s.procurar(texto)
            self.assertTrue(achados, repr(texto[:30]))
            cobertos = "".join(texto[a.inicio:a.fim] for a in achados).replace(zw, "")
            self.assertIn(SENHA[:4], cobertos)
            novo, _ = s.redigir(texto, lambda v, r: ID1)
            self.assertFalse(vaza(novo.replace(zw, ""), SENHA), repr(texto[:30]))
            self.assertEqual(s.procurar(novo), [])
            self.assertEqual([a.linha for a in achados][0], texto[:achados[0].inicio].count("\n") + 1)

    def test_segredo_partido_com_uma_metade_curta_bloqueia_nao_se_redige_e_nao_vai_ao_modelo(self):
        a, b = "gh" + "p_A1b2C3d4", "E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"     # a primeira metade é curta demais para o filtro comum
        texto = f"token do github\n{a}\n{b}\n"
        achados = s.procurar(texto)
        self.assertTrue(any(not x.redigivel for x in achados), achados)
        with self.assertRaises(s.NaoRedigivel):
            s.redigir(texto, lambda v, r: ID1)
        self.assertIsNone(s.mascarar_para_o_modelo(texto), "sem confiança, nenhum texto vai ao modelo")

    def test_segredo_partido_com_as_duas_metades_pegas_e_redigido_por_inteiro(self):
        a, b = "gh" + "p_A1b2C3d4E5f6G7h8", "I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4"   # cada metade o filtro comum já pega
        texto = f"x\n{a}\n{b}\ny"
        novo, _ = s.redigir(texto, lambda v, r: ID1)
        self.assertFalse(vaza(novo, a + b))
        self.assertFalse(vaza(s.mascarar_para_o_modelo(texto), a + b))

    def test_chave_completa_seguida_de_palavra_comum_nao_e_segredo_partido(self):
        # o falso positivo do começo: a linha de baixo não é parte do segredo
        t = f"chave do repo {GHP}\nCombinar a migração com o cliente."
        achados = s.procurar(t)
        self.assertTrue(achados)
        self.assertTrue(all(x.redigivel for x in achados), achados)
        novo, _ = s.redigir(t, lambda v, r: ID1)
        self.assertIn("Combinar a migração com o cliente.", novo)

    def test_pedaco_colado_ao_marcador_recusa(self):
        # simula um filtro que pegou só parte do valor: o resto ficaria colado ao marcador
        parcial = [s.Achado("chave-valor", 7, 10, 1)]
        with mock.patch.object(s, "procurar", return_value=parcial):
            with self.assertRaises(s.NaoRedigivel):
                s.redigir("senha: abcdef", lambda v, r: ID1)
        self.assertTrue(re.search(r"\}\}[A-Za-z0-9_\-+/=]", "{{SEGREDO:" + ID1 + "}}resto"))


class Redigir(unittest.TestCase):
    def test_troca_o_valor_pelo_marcador_e_entrega_ao_cofre(self):
        guardados = []

        def armazenar(valor, regra):
            guardados.append((valor, regra))
            return f"c-20261004-121212-{len(guardados):04x}"

        t = f"user admin\nsenha: {SENHA}\nchave do repo {GHP}\nfim"
        novo, achados = s.redigir(t, armazenar)
        self.assertEqual(len(achados), 2)
        self.assertEqual([g[0] for g in guardados], [SENHA, GHP])
        self.assertIn("senha: {{SEGREDO:c-20261004-121212-0001}}", novo)
        self.assertIn("chave do repo {{SEGREDO:c-20261004-121212-0002}}", novo)
        self.assertNotIn(SENHA, novo)
        self.assertNotIn(GHP, novo)
        self.assertEqual(s.procurar(novo), [], "o texto redigido não pode ter mais nada a achar")

    def test_sem_segredo_devolve_o_mesmo_texto_e_nao_chama_o_cofre(self):
        def nao_deve(*a):
            raise AssertionError("não devia guardar nada")
        t = "só anotações\ncom duas linhas"
        self.assertEqual(s.redigir(t, nao_deve), (t, []))

    def test_pem_redigida_some_inteira(self):
        novo, _ = s.redigir(f"x\n{PEM}\ny", lambda v, r: ID2)
        self.assertEqual(novo, "x\n{{SEGREDO:" + ID2 + "}}\ny")

    def test_frase_senha_com_espacos_e_aspas_vai_inteira_para_o_cofre(self):
        for v in ["cavalo correto bateria grampo", 'ela disse "oi" e saiu; depois (voltou)', "a@b.com:x y"]:
            guardados = []
            novo, _ = s.redigir(f"senha: {v}\nfim", lambda val, r: guardados.append(val) or ID1)
            self.assertEqual(guardados, [v])
            self.assertFalse(vaza(novo, v))


class Camada_do_modelo(unittest.TestCase):
    def test_prosa_comum_passa_inteira(self):
        t = "Reunião com o cliente na terça.\nLevar o contrato e o orçamento revisado."
        self.assertEqual(s.mascarar_para_o_modelo(t), t)

    def test_resto_da_linha_com_palavra_de_segredo_e_ocultado(self):
        self.assertEqual(s.mascarar_para_o_modelo("a senha do wifi está no post-it azul"), "a senha <oculto>")
        self.assertEqual(s.mascarar_para_o_modelo("Reunião\nmeu token de acesso novo\nfim"), "Reunião\nmeu token <oculto>\nfim")

    def test_marcador_do_cofre_atravessa_a_camada(self):
        t = "senha: {{SEGREDO:" + ID1 + "}}\nchave do repo {{SEGREDO:" + ID2 + "}}\nCombinar a migração."
        v = s.mascarar_para_o_modelo(t)
        self.assertIn("{{SEGREDO:" + ID1 + "}}", v)
        self.assertIn("{{SEGREDO:" + ID2 + "}}", v)
        self.assertIn("Combinar a migração.", v)

    def test_pedacos_de_senha_viram_oculto(self):
        for tok in ["Kx9;mP2)vL8]", "9f2c" * 8, "JBSWY3DPEHPK3PXP", "abc123def456ghi789jkl", "https://x.io/a1b2c3d4e5f6g7h8"]:
            v = s.mascarar_para_o_modelo(f"anota aí {tok} depois")
            self.assertNotIn(tok, v, tok)
            self.assertIn("<oculto>", v)

    def test_frase_semente_vira_oculto(self):
        self.assertEqual(s.mascarar_para_o_modelo("cavalo correto bateria grampo lua mesa rio ponte vento pedra fogo nuvem"),
                         "<oculto>")

    def test_palavras_fracas_so_com_separador(self):
        self.assertEqual(s.mascarar_para_o_modelo("a chave do problema fica no texto"), "a chave do problema fica no texto")
        self.assertIn("<oculto>", s.mascarar_para_o_modelo("chave: x"))

    def test_cortar_em_linha(self):
        trecho, cortou = s.cortar_em_linha("linha um\n" * 200, 100)
        self.assertTrue(cortou)
        self.assertTrue(trecho.endswith("linha um"))
        self.assertEqual(s.cortar_em_linha("curto", 100), ("curto", False))
        # corte que cairia entre "senha:" e o valor não deixa a linha seguinte virar o valor
        trecho2, _ = s.cortar_em_linha("x" * 90 + "\nsenha:\n[[/TEXTO]]\n", 97)
        self.assertNotIn("senha", trecho2)


class Varredura(unittest.TestCase):
    def test_acha_padrao_cortado_na_emenda_dos_pedacos(self):
        dados = (b"x" * 5000) + PEM_CORTADA.encode() + (b"y" * 3000)
        corte = 5000 + 12                                  # no meio do "-----BEGIN ..."
        v = s.Varredor()
        self.assertFalse(v.alimentar(dados[:corte]))
        self.assertTrue(v.alimentar(dados[corte:]))
        self.assertIn("chave-privada", v.regras)

    def test_utf16_e_latin1_nao_escondem_o_segredo(self):
        for codif, texto in (("utf-16", f"x\nsenha: {SENHA}\n"), ("utf-16-le", AGE), ("latin-1", f"ação\nAWS: {ENT}\n")):
            self.assertTrue(s.Varredor().alimentar(texto.encode(codif)), codif)

    def test_binario_aleatorio_nao_dispara(self):
        r = random.Random(7)
        lixo = bytes(r.getrandbits(8) for _ in range(300_000))
        self.assertFalse(s.Varredor().alimentar(lixo))

    def test_arquivo_limpo_passa(self):
        v = s.Varredor()
        for _ in range(20):
            self.assertFalse(v.alimentar(b"nada de mais aqui, so texto comum\n" * 2000))


class Desempenho(unittest.TestCase):
    """Cerca de 1 s por MB, também COM a palavra-chave presente (a regra pesada tem que rodar)."""

    @staticmethod
    def tempo(fn):
        ini = time.time()
        fn()
        return time.time() - ini

    def test_sem_dica(self):
        for t in ["a." * 1_000_000, "a" * 2_000_000, "-" * 2_000_000, "://" * 300_000]:
            self.assertLess(self.tempo(lambda: s.procurar(t)), 3, t[:6])

    def test_com_dica_a_regra_pesada_roda_e_continua_linear(self):
        for t in ["-" * 1_000_000 + " senha", "-." * 500_000 + " password", "senha" * 200_000,
                  ("x" * 99 + "\n") * 10_000 + "token: ", "senha: " * 100_000]:
            self.assertLess(self.tempo(lambda: s.procurar(t)), 4, t[:12])

    def test_muitos_achados(self):
        t = "token=abcd\n" * 90_000                          # ~1 MB, 90 mil achados
        self.assertLess(self.tempo(lambda: s.procurar(t)), 5)
        self.assertLess(self.tempo(lambda: s.tem_segredo(t)), 0.5, "tem_segredo para no primeiro achado")
        self.assertLess(self.tempo(lambda: s.Varredor().alimentar(t.encode())), 1.5)

    def test_base64_em_muitas_linhas_nao_e_quadratico(self):
        # e-mail/HTML com anexo: cada linha é um achado e todas se "colam" na visão de segredo partido
        r = random.Random(3)
        alfa = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        texto = "\n".join("".join(r.choice(alfa) for _ in range(76)) for _ in range(10_000))        # ~0,8 MB
        self.assertLess(self.tempo(lambda: s.procurar(texto)), 3)
        self.assertLess(self.tempo(lambda: s.tem_segredo(texto)), 1)

    def test_linha_de_comando_xml_e_separador_nao_sao_quadraticos(self):
        # entradas comuns que faziam o filtro levar minutos e segurar o servidor inteiro (revisão de 04/10)
        casos = {
            "mysql repetido + -p": ("mysql " * 100_000)[:300_000] + "\nfind . -path x",
            "curl repetido + -u": ("curl " * 100_000)[:300_000] + "\nx -u",
            "<password sem >": "<password " * 30_000,
            "palavra e muitos tabs": ("senha" + "\t" * 2000) * 150,
            "palavra, conectores e espaços": ("senha do do do " + " " * 1500) * 200,
            "muitas 'key ' numa linha": "key " * 75_000,
        }
        for nome, t in casos.items():
            mb = max(len(t) / 1e6, 0.1)
            for fn in (s.procurar, s.tem_segredo, lambda x: s.Varredor().alimentar(x.encode())):
                self.assertLess(self.tempo(lambda: fn(t)) / mb, 3, nome)

    def test_um_invisivel_num_texto_grande_nao_estoura_tempo_nem_memoria(self):
        import tracemalloc
        texto = "linha de texto comum aqui\n" * 40_000 + "\u00ad"                 # ~1 MB com UM invisível no fim
        tracemalloc.start()
        ini = time.time()
        s.procurar(texto)
        d = time.time() - ini
        _, pico = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        self.assertLess(pico / 1e6, 40, f"pico de {pico / 1e6:.0f} MB")
        self.assertLess(d, 8)

    def test_camada_do_modelo_em_trecho(self):
        t = ("Reunião com o cliente Abc sobre o contrato 2026 e a proposta revisada.\n" * 120)[:8000]
        self.assertLess(self.tempo(lambda: s.mascarar_para_o_modelo(t)), 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
