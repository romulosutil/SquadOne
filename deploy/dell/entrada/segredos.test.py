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

    def test_a_linha_com_palavra_de_segredo_some_e_fica_so_a_palavra(self):
        # a linha INTEIRA some (o valor pode vir antes da palavra: "X é a senha do wifi"); só a palavra fica
        self.assertEqual(s.mascarar_para_o_modelo("a senha do wifi está no post-it azul"), "<oculto> senha <oculto>")
        self.assertEqual(s.mascarar_para_o_modelo("Reunião\nmeu token de acesso novo\nfim"), "Reunião\n<oculto> token <oculto>\nfim")

    def test_marcador_do_cofre_atravessa_a_camada(self):
        t = "senha: {{SEGREDO:" + ID1 + "}}\nchave do repo {{SEGREDO:" + ID2 + "}}\nCombinar a migração."
        v = s.mascarar_para_o_modelo(t)
        self.assertIn("{{SEGREDO:" + ID1 + "}}", v)
        self.assertIn("{{SEGREDO:" + ID2 + "}}", v)
        # o que vem logo abaixo de uma linha de segredo pode ser mais segredo sem contexto: some junto (revisão de 04/10)
        self.assertNotIn("Combinar a migração.", v)
        # ...mas só as próximas linhas: um parágrafo mais adiante fica
        longe = t + "\n" * 12 + "Combinar a migração."
        self.assertIn("Combinar a migração.", s.mascarar_para_o_modelo(longe))

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


# ---------------------------------------------------------------------------------------------------------------
# 2ª rodada de revisão adversarial (04/10/2026): o mesmo segredo em formatos que furavam as DUAS camadas.
# Valores falsos, montados em tempo de execução.
W = "casa" + "2026"                                   # senha fraca (minúsculas + dígitos), comum na vida real
PIN = "48" + "2193"
FRASE_SENHA = "correct horse " + "battery staple"
SEED = ["abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse", "access", "accident"]
BACKUP = ["1234 " + "5678", "2345 " + "6789", "3456 " + "7890", "4567 " + "8901"]
CARTAO = "4111 1111 " + "1111 1111"
_R = random.Random(20261004)
APP = " ".join(aleatorio(_R, 4, "abcdefghijklmnopqrstuvwxyz") for _ in range(4))             # senha de app do Google
TOTP = " ".join(aleatorio(_R, 4, "abcdefghijklmnopqrstuvwxyz234567") for _ in range(8))      # chave do autenticador
TOTP_U = " ".join(aleatorio(_R, 4, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567") for _ in range(8))
FORTE_GRUPOS = "Kx9;" + " mP2)" + " vL8]"


class Estrutura_variada(unittest.TestCase):
    """Cada caso tem de ser BLOQUEADO ou ter o valor escondido da visão do modelo (as duas barreiras)."""

    def casos(self):
        sem = lambda ws: " ".join(f"{k + 1}. {w}" for k, w in enumerate(ws))      # noqa: E731
        return [
            # (descrição, texto, valor, o filtro principal TEM de bloquear?)
            ("valor na linha de baixo", f"Wi-Fi de casa\nSenha do wifi\n{W}\n", W, False),
            ("'Senha:' sozinha e o valor embaixo", f"Banco\nSenha:\n{W}\n", W, False),
            ("YAML bloco literal", f"db:\n  user: romulo\n  password: |\n    {FRASE_SENHA}\n", FRASE_SENHA, False),
            ("tabela Markdown", f"| Serviço | Usuário | Senha |\n|---|---|---|\n| Banco | romulo | {W} |\n", W, False),
            ("TSV colado de planilha", f"Serviço\tUsuário\tSenha\nBanco\tromulo\t{W}\n", W, False),
            ("CSV com espaço após a vírgula", f"servico, usuario, senha\nbanco, romulo, {W}\n", W, False),
            ("valor ANTES da palavra", f"{W} é a senha do wifi\n", W, False),
            ("'usei X como senha'", f"Usei {W} como senha do banco\n", W, False),
            ("'X (senha do wifi)'", f"{W} (senha do wifi)\n", W, False),
            ("ES: contraseña", f"contraseña: {W}\n", W, False),
            ("ES: clave", f"clave del wifi: {W}\n", W, False),
            ("ES: frase natural", f"la contraseña del wifi es {W}\n", W, False),
            ("DE: Passwort", f"Passwort: {W}\n", W, False),
            ("FR: mot de passe", f"mot de passe : {W}\n", W, False),
            ("PT-PT: palavra-passe", f"palavra-passe: {W}\n", W, False),
            ("psw:", f"psw: {W}\n", W, False),
            ("pw:", f"pw: {W}\n", W, False),
            ("passcode:", f"passcode: {PIN}\n", PIN, False),
            ("código do alarme", f"código do alarme: {PIN}\n", PIN, False),
            ("'acesso: usuário / senha' sem a palavra senha", f"acesso ao banco: romulo / {W}\n", W, False),
            ("Wi-Fi: rede / senha", f"Wi-Fi: CasaRomulo / {W}\n", W, False),
            ("códigos de backup do Google", "Códigos de backup do Google:\n" + "\n".join(BACKUP) + "\n", BACKUP[1], False),
            ("senha de app do Gmail sem a palavra senha", f"Gmail no Thunderbird: {APP}\n", APP, False),
            ("chave TOTP em grupos (minúsculas)", f"Authenticator do GitHub: {TOTP}\n", TOTP, False),
            ("chave TOTP em grupos (MAIÚSCULAS)", f"2º fator do banco\n{TOTP_U}\n", TOTP_U, False),
            ("senha forte em pedaços com símbolo", f"nova: {FORTE_GRUPOS}\n", "Kx9;", False),
            ("número do cartão antes do cvv", f"Cartão Nubank {CARTAO} val 12/29 cvv 123\n", CARTAO, False),
            ("frase-semente com rótulo", "frase de recuperação: " + " ".join(SEED) + "\n", " ".join(SEED[3:6]), False),
            ("frase-semente numerada", sem(SEED) + "\n", SEED[5] + " ", False),
            ("frase-semente uma palavra por linha", "carteira\n" + "\n".join(SEED) + "\n", SEED[10] + "\n" + SEED[11], False),
            ("frase-semente em 3 linhas de 4", "\n".join(" ".join(SEED[i:i + 4]) for i in range(0, 12, 4)) + "\n", " ".join(SEED[4:6]), False),
            ("frase-semente com vírgulas", ", ".join(SEED) + "\n", ", ".join(SEED[2:4]), False),
            ("frase-semente Capitalizada", " ".join(w.capitalize() for w in SEED) + "\n", " ".join(w.capitalize() for w in SEED[2:4]), False),
            # linha de comando: o filtro principal bloqueia
            ("sshpass -p X (com espaço)", f"sshpass -p {W} ssh root@10.0.0.5\n", W, True),
            ("redis-cli -a X", f"redis-cli -h 127.0.0.1 -a {W} ping\n", W, True),
            ("docker login -u u -p X", f"docker login -u romulo -p {W} registry.exemplo.com\n", W, True),
            ("zip -P X", f"zip -P {W} backup.zip notas.txt\n", W, True),
            ("ssh-keygen -N X", f"ssh-keygen -t ed25519 -N {W} -f chave\n", W, True),
            ("mongo -p X", f"mongo -u admin -p {W} --authenticationDatabase admin\n", W, True),
            # e os que já eram bloqueados continuam sendo
            ("wp-config define()", f"define( 'DB_PASSWORD', '{W}' );\n", W, True),
            ("TOML", f'[db]\npassword = "{W}"\n', W, True),
            ("INI", f"[mysql]\nuser=romulo\npassword={W}\n", W, True),
            ("git remote com senha", f"git remote add origin https://romulo:{W}@github.com/x/y.git\n", W, True),
            ("senha na query", f"https://exemplo.com/login?user=romulo&senha={W}\n", W, True),
            # menos óbvios, só escondidos
            ("smbclient -U user%X", f"smbclient //nas/fotos -U romulo%{W}\n", W, False),
            ("net use (Windows)", f"net use Z: \\\\nas\\fotos {W} /user:romulo\n", W, False),
            ("htpasswd -b", f"htpasswd -b /etc/nginx/.htpasswd romulo {W}\n", W, False),
            (".netrc numa linha", f"machine api.heroku.com login r@x.com password {W}\n", W, True),
        ]

    def test_cada_formato_e_bloqueado_ou_escondido(self):
        for desc, texto, valor, deve_bloquear in self.casos():
            if deve_bloquear:
                self.assertTrue(s.procurar(texto), f"o filtro principal devia bloquear: {desc}")
            visao = s.mascarar_para_o_modelo(texto)
            self.assertFalse(vaza(visao, valor), f"o valor chegou à visão do modelo: {desc} -> {visao!r}")

    def test_o_fluxo_real_mascara_duas_vezes_e_a_segunda_nao_muda_nem_revela_nada(self):
        # na fila o trecho é mascarado ao chegar e DE NOVO ao montar o prompt: a proteção não pode depender de uma só passada
        for desc, texto, valor, _ in self.casos():
            um = s.mascarar_para_o_modelo(texto)
            dois = s.mascarar_para_o_modelo(um)
            self.assertEqual(dois, um, f"não idempotente: {desc}")
            self.assertFalse(vaza(dois, valor), desc)

    def test_a_visao_do_modelo_nao_e_bloqueada_de_novo_por_causa_do_que_sobrou(self):
        # o que o modelo recebe passa no filtro principal (senão o organizador barraria tudo)
        for desc, texto, valor, _ in self.casos():
            visao = s.mascarar_para_o_modelo(texto)
            self.assertEqual(s.procurar(visao), [], f"a visão ainda parece segredo: {desc} -> {visao!r}")


class Orcamento_de_falso_positivo(unittest.TestCase):
    """Textos NORMAIS, sem segredo (corpus da revisão de 04/10). O bloqueio custa um clique; num PDF ou imagem, nem
    isso. Antes da correção: 26 de 73 (36%). O teto agora é só o que é credencial de verdade ou indistinguível."""
    CORPUS = {
        "nota": [
            "Reunião com o cliente na terça. Levar o contrato e o orçamento.",
            "Comprar pão, leite, café e frutas. Pagar o boleto da luz até dia 10.",
            "Ideia: site de receitas com assinatura mensal de R$ 19,90.",
            "O segredo é paciência: deixar a massa descansar 2 horas.",
            "Trocar a senha do wifi amanhã (está fraca).",
            "Senha: ver no Bitwarden",
            "Token: expira em 24h, renovar na segunda",
            "Lembrar: o token do cliente vence em dezembro.",
            "Segredo do bolo: manteiga gelada.",
            "Credenciais: pedir ao TI da empresa",
            "Chave do carro está na gaveta da cozinha.",
            "A chave do sucesso é a consistência.",
            "PIN do cadeado: lembrar de trocar",
            "Viagem: voo AD4567 sai 14h35, localizador XKJ9PL.",
            "Treino: 3x12 supino, 4x10 agachamento, 20 min esteira.",
            "Consulta no dentista dia 15/10 às 9h30, Dr. Paulo, sala 304.",
            "Pix do João: joao.silva@gmail.com — devolver R$ 50.",
            "CPF da Ana: 123.456.789-09 (para o contrato).",
            "Telefone do encanador: (11) 98765-4321.",
            "Código de rastreio dos Correios: AA123456789BR",
            "Boleto: 23793.38128 60000.000003 00000.000400 1 84340000012345",
            "Endereço: Rua das Flores, 123, ap 45, CEP 01234-567, São Paulo.",
            "Lista de filmes: Duna 2, Oppenheimer, Pobres Criaturas.",
            "Projeto PRUMO: revisar o funil de vendas e a página de captura.",
        ],
        "e-mail": [
            "Olá Rômulo,\nSegue o relatório do mês.\nAbraços,\nMaria",
            "Seu código de verificação é 482913. Ele expira em 10 minutos.",
            "Sua senha foi alterada com sucesso. Se não foi você, entre em contato.",
            "Para redefinir sua senha, clique no link abaixo.",
            "Token de acesso: expira em 24 horas.",
            "Message-ID: <CAJxqR7b8kQm2vZ9pL4nT6wY3sX1cF5hD0eG@mail.gmail.com>",
            "Assunto: Proposta comercial — PRUMO\nPrezado, segue a proposta em anexo.",
            "Recebemos seu pedido nº 7894561230. Previsão de entrega: 12/10.",
        ],
        "config": [
            '{"name": "app", "version": "1.2.3", "private": true}',
            '{"token_expiry": 3600, "refresh_interval": 600}',
            '{"password_min_length": 12, "password_require_symbol": true}',
            '{"auth": {"token_endpoint": "https://accounts.google.com/o/oauth2/token"}}',
            '{"key": "home.title", "value": "Página inicial"}',
            '[{"key": "ctrl+shift+p", "command": "workbench.action.showCommands"}]',
            '{"seed": 12345, "epochs": 10, "lr": 0.001}',
            "secret_name: app-tls\nnamespace: producao",
            "[database]\nhost = localhost\nport = 5432\nuser = app",
            "TOKEN_TTL=3600\nPASSWORD_RESET_URL=https://app.exemplo.com/reset",
            "spring.datasource.password=${DB_PASSWORD}",
            '"integrity": "sha512-q2DgYxG0vJ8QwNnL3k7JQZ0gq8m2Q1F3cXb5w9Z8yR4t+V0aL6pD2sK7hN1oB3eC9fU5iT4rW6xY8zA0bE2cG=="',
        ],
        "código": [
            "def login(user, password):\n    return auth.check(user, password)",
            "if not token:\n    raise ValueError('sem token')",
            "password = getpass.getpass()",
            "const token = req.headers.authorization;",
            "senha = input('Digite a senha: ')",
            "git commit -m 'fix: token refresh no login'",
            "docker run -e POSTGRES_PASSWORD=$PG_PASS postgres:16",
            "for i in range(10):\n    print(i)",
        ],
        "url": [
            "https://drive.google.com/file/d/1aBcD3fGhIjKlMnOpQrStUvWxYz0123456/view?usp=sharing",
            "https://docs.google.com/document/d/1Xy2Zw3Vu4Ts5Rq6Po7Nm8Lk9Ji0HgFeDcBa/edit",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
            "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=8f3a2b1c9d4e",
            "https://www.notion.so/Planejamento-2026-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
            "https://maps.app.goo.gl/Xk9PqL2mN7vR4sT1",
            "https://www.amazon.com.br/dp/B08N5WRWNW/ref=sr_1_3?keywords=fone",
            "https://github.com/romulosutil/SquadOne/pull/8/commits/889359f",
            "https://meet.google.com/abc-defg-hij",
            "https://www.instagram.com/p/CxYz12AbCdE/",
            "https://wa.me/5511987654321",
        ],
        "log": [
            "2026-10-04 12:00:01 INFO request_id=7f3a9c2e1b4d servico=entrada status=200",
            "2026-10-04 12:00:02 WARN token expirado para usuario=romulo; renovando",
            "2026-10-04 12:00:03 ERROR auth: token=expired user=romulo",
            "Oct 04 12:00:04 mel systemd[1]: Started entrada.service.",
            "trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7",
            "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            "commit 889359f3a2b1c4d5e6f708192a3b4c5d6e7f8091\nAuthor: Romulo",
        ],
    }
    # Sobram de propósito: "a senha é X" é indistinguível de uma frase-senha; `?pwd=` e `session=` são credenciais.
    CONHECIDOS = {"A senha é pessoal e intransferível, diz o manual do banco.",
                  "https://zoom.us/j/98765432100?pwd=VmRtWnNKcFZ2b3JhQ0M4dz09",
                  "[2026-10-04T12:00:05Z] session=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA started"}
    EXTRAS = ["A senha é pessoal e intransferível, diz o manual do banco.",
              "https://zoom.us/j/98765432100?pwd=VmRtWnNKcFZ2b3JhQ0M4dz09",
              "[2026-10-04T12:00:05Z] session=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA started"]

    def test_o_bloqueio_so_pega_o_que_e_credencial_ou_indistinguivel(self):
        bloqueados = [t for cat in self.CORPUS.values() for t in cat if s.procurar(t)]
        self.assertEqual(set(bloqueados) - self.CONHECIDOS, set(), f"falso positivo novo: {set(bloqueados) - self.CONHECIDOS}")
        total = sum(len(c) for c in self.CORPUS.values()) + len(self.EXTRAS)
        self.assertLessEqual((len(bloqueados) + len(self.EXTRAS)) / total, 0.05)

    def test_os_conhecidos_continuam_bloqueados(self):
        for t in self.EXTRAS:
            self.assertTrue(s.procurar(t), t)

    def test_a_camada_do_modelo_nao_come_o_texto_comum(self):
        palavras = ocultas = 0
        for cat in ("nota", "e-mail"):
            for t in self.CORPUS[cat]:
                visao = s.mascarar_para_o_modelo(t) or ""
                palavras += len(t.split())
                ocultas += visao.count(s.OCULTO)
        self.assertLess(ocultas / palavras, 0.2, f"{ocultas}/{palavras} palavras viraram <oculto>")


class Binarios_e_arquivos_reais(unittest.TestCase):
    """PDF e imagem exportados por Word, LibreOffice, Acrobat ou editor de fotos levam o pacote XMP, com um id fixo que
    parece chave. Antes da correção: 8 de 8 bloqueados sem segundo clique (revisão de 04/10)."""
    XMP_ID = "W5M0MpCehiHzreSzNTczkc9d"
    XMP = ('<?xpacket begin="" id="' + XMP_ID + '"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
           '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta><?xpacket end="w"?>').encode()

    def varrer(self, dados: bytes, passo: int = 65536) -> bool:
        v = s.Varredor()
        return any(v.alimentar(dados[i:i + passo]) for i in range(0, len(dados), passo))

    def test_pdf_com_xmp_e_dados_binarios_passa(self):
        r = random.Random(1)
        pdf = b"%PDF-1.7\n" + r.randbytes(150_000) + self.XMP + r.randbytes(150_000) + b"\n%%EOF"
        self.assertFalse(self.varrer(pdf))

    def test_imagem_e_fonte_com_nomes_ascii_no_meio_de_bytes_aleatorios_passam(self):
        r = random.Random(2)
        fonte = r.randbytes(40_000) + b"DejaVuSansCondensed-BoldOblique" + r.randbytes(40_000) + b"Copyright2026BitstreamVeraSans" + r.randbytes(40_000)
        self.assertFalse(self.varrer(fonte))
        jpeg = b"\xff\xd8\xff\xe1" + self.XMP + r.randbytes(200_000) + b"\xff\xd9"
        self.assertFalse(self.varrer(jpeg))

    def test_xmp_em_texto_tambem_passa(self):
        self.assertEqual(s.procurar(self.XMP.decode()), [])
        self.assertFalse(self.varrer(self.XMP))

    def test_o_que_continua_bloqueado_em_binario(self):
        r = random.Random(3)
        self.assertTrue(self.varrer(r.randbytes(5000) + AGE.encode() + r.randbytes(5000)), "chave age no meio de bytes")
        self.assertTrue(self.varrer(r.randbytes(5000) + PEM.encode() + r.randbytes(5000)), "chave privada")
        self.assertTrue(self.varrer(("senha: " + SENHA_BOA + "\n").encode("utf-16")), "UTF-16")
        self.assertTrue(self.varrer(("senha: " + SENHA_BOA + " ação\n").encode("latin-1")), "Latin-1")
        texto_longo = ("linha de texto comum\n" * 40_000 + "chave " + ENT + "\n").encode()
        self.assertTrue(self.varrer(texto_longo), "texto de 1 MB com uma cadeia aleatória no fim")

    def test_a_entropia_so_vale_em_texto(self):
        # a mesma cadeia aleatória: em texto bloqueia; dentro de bytes aleatórios (que não parecem texto) não, pela entropia
        r = random.Random(4)
        self.assertTrue(self.varrer(("x = " + ENT + "\n").encode()))
        self.assertFalse(self.varrer(r.randbytes(20_000) + ENT.encode() + r.randbytes(20_000)))


class Camada_1_nos_dois_sentidos(unittest.TestCase):
    """O que a revisão pediu para parar de bloquear (ruído) e, junto, a prova de que o que é segredo continua sendo."""

    def valores(self, texto):
        achados: list[str] = []
        s.redigir(texto, lambda v, r: achados.append(v) or ID1)
        return achados

    def test_comandos_com_argumento_separado_por_espaco(self):
        for cmd in (f"sshpass -p {W} ssh root@10.0.0.5", f"redis-cli -h 127.0.0.1 -a {W} ping", f"docker login -u r -p {W} reg.exemplo.com",
                    f"zip -P {W} a.zip b.txt", f"ssh-keygen -t ed25519 -N {W} -f k", f"mongo -u admin -p {W} --authenticationDatabase admin"):
            self.assertEqual(self.valores(cmd), [W], cmd)
        for ok in ("mysql -u root -p mydb", "mkdir -p /tmp/a/b", "ls -a notas", "zip -r a.zip pasta", "ssh-keygen -t ed25519 -f chave"):
            self.assertEqual(s.procurar(ok), [], ok)

    def test_senha_de_url_pode_ter_arroba(self):
        self.assertEqual(self.valores("postgres://app:" + "p@ss-" + "Forte9" + "@db:5432/x"), ["p@ss-Forte9"])
        self.assertEqual(self.valores("https://user:pass1234@host.com/caminho"), ["pass1234"])
        self.assertEqual(self.valores("https://user:pass1234@host.com"), ["pass1234"])
        self.assertEqual(s.procurar("escreva para mim@exemplo.com e para ana@x.org"), [])

    def test_referencia_so_vale_como_nome_de_variavel(self):
        for ok in ("senha: ${DB_PASSWORD}", "password=$PG_PASS", "senha: $senha", "senha: %SENHA%", "token: {{ vars.token }}",
                   "senha: <sua-senha>", "senha: ********", "password: null"):
            self.assertEqual(s.procurar(ok), [], ok)
        for forte in ("senha: $Kx9mP2" + "vL8qR", "senha: <aB3$" + "kL9xQ>", "senha: ${Kx9mP2" + "vL8}-x9"):
            self.assertTrue(s.procurar(forte), forte)

    def test_valor_que_descreve_ou_e_codigo_nao_e_segredo(self):
        for ok in ("Senha: ver no Bitwarden", "Token: expira em 24h, renovar na segunda", "Credenciais: pedir ao TI da empresa",
                   "token=expired user=romulo", "password = getpass.getpass()", "const token = req.headers.authorization;",
                   "senha = input('Digite a senha: ')", "docker run -e POSTGRES_PASSWORD=$PG_PASS postgres:16",
                   "Token de acesso: expira em 24 horas."):
            self.assertEqual(s.procurar(ok), [], ok)

    def test_o_que_parece_descricao_mas_e_valor_continua_bloqueado(self):
        for forte in (f"senha: {W}", "password: expira" + "2026", "senha: ver" + "1234", "token: Kx9mP2" + "vL8qR4", f"senha = foo{W}",
                      "token: valido" + "Xk9", f"password = Kx9(mP2)" + "x1", "senha: " + "Ok" + "7Pq2Lm"):
            self.assertTrue(s.procurar(forte), forte)

    def test_chave_de_configuracao_so_com_valor_de_configuracao(self):
        for ok in ("token_expiry: 3600", "password_min_length: 12", "secret_name: app-tls", "TOKEN_TTL=3600", "DB_PASSWORD_FILE=/run/secrets/db",
                   "PASSWORD_RESET_URL=https://app.exemplo.com/reset", "token-endpoint: https://x.io/token", "password_required: true"):
            self.assertEqual(s.procurar(ok), [], ok)
        for forte in (f"password_hint: {W}", "DB_PASSWORD_ID=Kx9mP2" + "vL8qR4", f"secret_name: {W}", "token_length: Pq7" + "wLz2Nv"):
            self.assertTrue(s.procurar(forte), forte)

    def test_segredo_como_assunto_so_com_valor_que_parece_segredo(self):
        for ok in ("Segredo do bolo: manteiga gelada.", "O segredo é paciência: deixar a massa descansar 2 horas.", "o segredo da empresa é a equipe"):
            self.assertEqual(s.procurar(ok), [], ok)
        for forte in (f"segredo: {W}", f"o segredo é {W}", "client_secret=" + "abc12345xyz", f"segredo do wifi: {W}", "secret = Kx9mP2" + "vL8"):
            self.assertTrue(s.procurar(forte), forte)

    def test_a_frase_toda_vai_para_o_cofre_no_ramo_do_e(self):
        # antes o 2º clique guardava só a 1ª palavra e o resto ficava em claro em chegou/
        for texto, esperado in (("a senha do wifi é minha casa azul 2026", "minha casa azul 2026"),
                                ("my password is correct horse battery staple 9", "correct horse battery staple 9")):
            self.assertEqual(self.valores(texto), [esperado], texto)
            novo, _ = s.redigir(texto, lambda v, r: ID1)
            self.assertEqual(s.procurar(novo), [])

    def test_valor_em_bloco_yaml_nas_linhas_de_baixo(self):
        self.assertEqual(self.valores("password: |\n    correct horse battery staple\n"), ["correct horse battery staple"])
        self.assertEqual(self.valores(f"password: >-\n  {W}\n"), [W])
        self.assertEqual(self.valores(f"db:\n  password: |\n    {W}\n  host: x\n"), [W])
        for ok in ("description: |\n  texto normal aqui\n", "password_hint: >\n  o nome do cachorro\n", "password: |\nhost: x\n"):
            self.assertEqual(s.procurar(ok), [], ok)

    def test_cadeia_longa_em_url_e_id_nao_e_chave_mas_parametro_sensivel_e(self):
        for ok in ("https://drive.google.com/file/d/1aBcD3fGhIjKlMnOpQrStUvWxYz0123456/view?usp=sharing",
                   "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
                   "Message-ID: <CAJxqR7b8kQm2vZ9pL4nT6wY3sX1cF5hD0eG@mail.gmail.com>", "id=W5M0MpCehiHzreSzNTczkc9d",
                   '"integrity": "sha512-q2DgYxG0vJ8QwNnL3k7JQZ0gq8m2Q1F3cXb5w9Z8yR4t+V0aL6pD2sK7hN1oB3eC9fU5iT4rW6xY8zA0bE2cG=="'):
            self.assertEqual(s.procurar(ok), [], ok)
        for forte in ("https://zoom.us/j/98765432100?pwd=VmRtWnNKcFZ2b3JhQ0M4dz09", "https://x.io/api?token=" + "Zk9Qx2Lm4Vb7Nc1Rt8Yw3",
                      "https://x.io/a?user=r&sig=" + "Zk9Qx2Lm4Vb7Nc1Rt8Yw3", "Zk9Qx2Lm4Vb7Nc1Rt8Yw3Ph6D", "x = " + ENT):
            self.assertTrue(s.procurar(forte), forte)

    def test_imagem_embutida_e_caminho_relativo_nao_sao_chave(self):
        b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        for ok in (f'<img src="data:image/png;base64,{b64}">', f"url(data:font/woff2;base64,{b64}0123456789)",
                   "Files: examples/functions/substr2", "veja data/profiles/sRGB-v2-nano-coated e docs/guia/passo-a-passo-2026"):
            self.assertEqual(s.procurar(ok), [], ok)
        for forte in (f"foto = {b64}0Zk9Qx2Lm4Vb7Nc1", "x = Zk9Qx2Lm4Vb/7Nc1Rt8Yw3Ph6Df5/Gj0Ae9Sx2Kq",
                      f'<a href="data:text/plain,{b64}Zk9Qx2Lm4Vb7Nc1Rt8Yw3">'):
            self.assertTrue(s.procurar(forte), forte)

    def test_cadeia_de_20_a_31_so_com_letras_nao_e_chave(self):
        self.assertEqual(s.procurar("ClasseGerenciadoraDeRelatorios"), [])          # 30 letras, CamelCase
        # troca aceita: 25 letras aleatórias SEM dígito já não são bloqueadas (só a camada do modelo as esconde);
        # com um dígito, ou com 32+ caracteres, continuam bloqueadas
        solta = "ZkQxLmVbNcRtYwPhDfGjAeSxK"
        self.assertEqual(s.procurar(solta), [])
        self.assertIn("<oculto>", s.mascarar_para_o_modelo(f"anotei {solta} ontem"))
        self.assertTrue(s.procurar("Zk9QxLmVbNcRtYwPhDfGjAeSxK"))
        self.assertTrue(s.procurar("ZkQxLmVbNcRtYwPhDfGjAeSxKbVn" + "TrEwQaZxSw"))


class Camada_do_modelo_reforcada(unittest.TestCase):
    def test_flags_de_senha(self):
        casos = {f"sshpass -p {W} ssh x": W, f"zip -P {W} a.zip": W, f"app --password {W} --x": W, f"app --token={W}": W,
                 f"smbclient //n/f -U romulo%{W}": W, f"net use Z: \\\\n\\f {W} /user:r": W, f"redis-cli -a {W}": W}
        for texto, valor in casos.items():
            self.assertNotIn(valor, s.mascarar_para_o_modelo(texto), texto)
        self.assertEqual(s.mascarar_para_o_modelo("cp a.txt b.txt"), "cp a.txt b.txt")

    def test_grupos_curtos_so_quando_parecem_segredo(self):
        for escondido in ("abcd efgh ijkl mnop", "jbsw y3dp ehpk 3pxp", "1234 5678", "4111 1111 1111 1111", "ABCD-EFGH-IJKL-MNOP", "Kx9; mP2) vL8]"):
            self.assertEqual(s.mascarar_para_o_modelo(f"anota {escondido} aí"), "anota <oculto> aí", escondido)
        for normal in ("reunião às 10h com a Maria", "casa grande azul", "dia 12 do mês 10", "R$ 19,90 por mês", "Duna 2 e Oppenheimer"):
            self.assertEqual(s.mascarar_para_o_modelo(normal), normal, normal)

    def test_semente_em_qualquer_formato_mas_prosa_comum_nao(self):
        for texto in (" ".join(SEED), ", ".join(SEED), "\n".join(SEED), " ".join(f"{k + 1}. {w}" for k, w in enumerate(SEED)),
                      " ".join(w.capitalize() for w in SEED), "frase: " + " ".join(SEED)):
            visao = s.mascarar_para_o_modelo(texto)
            self.assertFalse(any(w in visao.lower() for w in SEED[2:10]), repr(visao))
        prosa = "o cliente pediu uma revisao completa do contrato antes de assinar para evitar problemas depois"
        self.assertEqual(s.mascarar_para_o_modelo(prosa), prosa)
        onze = "ele pediu nova revisao completa antes assinar contrato porque duvidas restavam"      # 11 palavras: não é semente
        self.assertEqual(s.mascarar_para_o_modelo(onze), onze)

    def test_linha_de_rotulo_esconde_as_de_baixo_ate_voltar_a_prosa(self):
        t = "Senha:\n" + "\n".join(f"palavra{k}" for k in range(20)) + "\nDepois disso o cliente respondeu com várias perguntas sobre o prazo da entrega final."
        v = s.mascarar_para_o_modelo(t)
        self.assertNotIn("palavra19", v)
        self.assertIn("o cliente respondeu", v)
        self.assertEqual(s.mascarar_para_o_modelo("Trocar a senha do wifi amanhã, está fraca\nLevar o contrato"), "<oculto> senha <oculto>\nLevar o contrato")

    def test_marcador_do_cofre_sobrevive_a_linha_escondida(self):
        t = f"o código do banco: {{{{SEGREDO:{ID1}}}}} e mais coisa\nfim"
        v = s.mascarar_para_o_modelo(t)
        self.assertIn("{{SEGREDO:" + ID1 + "}}", v)
        self.assertIn("fim", v)

    def test_nome_e_rotulo_so_mudam_quando_tem_cara_de_segredo(self):
        for ok in ("contrato-silmer-2026.pdf", "relatorio_vendas_outubro.xlsx", "foto da viagem.jpg", "Reunião com o cliente"):
            self.assertEqual(s.mascarar_nome_para_o_modelo(ok), ok)
        for nome, ext in ((f"senha-wifi-{W}.txt", ".txt"), (f"wifi {W}.png", ".png")):
            m = s.mascarar_nome_para_o_modelo(nome)
            self.assertNotIn(W, m)
            self.assertTrue(m.endswith(ext), m)
        self.assertNotIn(W, s.mascarar_nome_para_o_modelo(f"senha do wifi {W}"))
        self.assertNotIn(W, s.mascarar_nome_para_o_modelo(f"Wi-Fi CasaRomulo / {W}"))
        m = s.mascarar_nome_para_o_modelo("x" + AGE + ".txt")
        self.assertNotIn("QQQQQQ", m)
        self.assertTrue(m.endswith(".txt"), m)

    def test_e_linear(self):
        # entradas adversárias, no tamanho máximo do trecho do modelo (8000) e 10 vezes isso
        casos = {"grupos": "abcd " * 4000, "grupos com dígito": "ab3d " * 4000, "símbolos": "Kx9; " * 4000, "sementes": "palavra " * 4000,
                 "flags": "-p x " * 4000, "hífens": "abcd-" * 4000, "rótulos": "senha:\n" * 4000, "contexto": "wifi " * 4000,
                 "percentuais": "u%x " * 4000, "numeração": "1. abc " * 4000, "uma palavra só": "a" * 20000, "um token": "ab%" * 20000}
        for nome, t in casos.items():
            for n in (8000, 80000):
                ini = time.time()
                s.mascarar_para_o_modelo(t[:n])
                self.assertLess(time.time() - ini, 2.0, f"{nome} com {n} caracteres")


# ---------------------------------------------------------------------------------------------------------------
# Revisão C (04/10/2026, depois do PR #10 aberto): o que o filtro ainda deixava passar e o que eu afrouxei demais.
def dupla(texto):
    """A visão que o modelo recebe de verdade: mascarada ao chegar e mascarada de novo ao montar o prompt."""
    return s.mascarar_para_o_modelo(s.mascarar_para_o_modelo(texto))


ES = "ábaco abdomen abeja abierto abogado abono aborto abrazo abrir abuelo abuso acabar".split()
FR = "abaisser abandon abdiquer abeille abolir aborder aboutir aboyer abrasif abreuver abriter absence".split()
ES_ACENTO = "canción césped dragón lágrima melón música pájaro razón sábado último volcán corazón".split()


class Contexto_e_estrutura(unittest.TestCase):
    def test_a_segunda_passada_nao_esconde_mais_que_a_primeira(self):
        # "<oculto> senha <oculto>" (saída da 1ª passada) não pode armar a janela das linhas de baixo na 2ª
        t = "Trocar a senha do wifi amanhã, está fraca\nLevar o contrato e o orçamento revisado\nFim"
        um = s.mascarar_para_o_modelo(t)
        self.assertIn("Levar o contrato", um)
        self.assertEqual(dupla(t), um)

    def casos(self):
        return [
            # camelCase: a palavra é prefixo
            ("camelCase JSON", f'{{"senhaAdmin": "{W}"}}\n', W, True),
            ("camelCase const", f'const senhaWifi = "{W}";\n', W, True),
            ("camelCase password", f'passwordRoot = "{W}x"\n', W + "x", True),
            ("camelCase pin", f"pinCartao: {PIN}\n", PIN, True),
            ("valor antes de uma palavra camelCase", f"{W} senhaAdmin\n", W, False),
            ("camelCase token", f"tokenBot: {W}\n", W, True),
            # palavras e idiomas que faltavam
            ("chave do cofre, valor antes", f"{W} é a chave do cofre\n", W, False),
            ("Chave do cofre, valor embaixo", f"Chave do cofre\n{PIN}\n", PIN, False),
            ("chave do portão", f"chave do portão {PIN}\n", PIN, False),
            ("chave do cadeado, valor embaixo", f"Chave do cadeado:\n{PIN}\n", PIN, False),
            ("chave do roteador", f"chave do roteador {W}\n", W, False),
            ("API key + valor embaixo", f"API key\n{W}\n", W, False),
            ("apiKey + valor embaixo", f"apiKey\n{W}\n", W, False),
            ("pswd", f"pswd: {W}\n", W, True),
            ("mdp", f"mdp : {W}\n", W, False),
            ("cód. alarme", f"cód. alarme: {PIN}\n", PIN, False),
            ("combinação do cofre", f"Combinação do cofre: {PIN}\n", PIN, False),
            ("passw0rd", f"passw0rd: {W}\n", W, False),
            ("holandês", f"wachtwoord: {W}\n", W, False),
            ("sueco", f"lösenord: {W}\n", W, False),
            ("polonês", f"hasło: {W}\n", W, False),
            ("turco", f"şifre: {W}\n", W, False),
            ("russo", f"пароль: {W}\n", W, False),
            ("chinês", f"密码: {W}\n", W, False),
            ("japonês", f"パスワード: {W}\n", W, False),
            # comandos
            ("SQL IDENTIFIED BY", f"CREATE USER 'app'@'localhost' IDENTIFIED BY '{W}';\n", W, True),
            ("net user", f"net user administrador {W} /add\n", W, True),
            ("curl -u com aspas", f"curl -u romulo:'minha casa {W}' https://api.exemplo.com\n", W, True),
            ("echo | sudo -S", f'echo "{W}" | sudo -S apt update\n', W, True),
            # unicode
            ("largura total", "ｓｅｎｈａ: " + W + "\n", W, True),
            ("isolado de direção (U+2066)", "se⁦nha: " + W + "\n", W, True),
            ("acento decomposto", "código do alarme: " + PIN + "\n", PIN, False),
            # lista anunciada no plural, com os valores nas linhas de baixo
            ("senhas no plural", f"Seguem as senhas novas do pessoal da firma\nJoana {W}\nPedro mesa4821\n", W, False),
            ("senhas, uma por linha", f"Anotei aqui as senhas do escritório, uma por linha.\n{W}\n", W, False),
            # tabelas e janelas
            ("tabela com coluna de observação", f"| Serviço | Login | Senha | Obs |\n|---|---|---|---|\n| Nubank | romulo | {W} | conta corrente, trocar em dezembro |\n| Itaú | romulo.s | mesa4821 | poupança |\n", "mesa4821", False),
            ("TSV com nota longa", f"Serviço\tUsuário\tSenha\tNota\nNubank\tromulo\t{W}\tconta corrente que precisa ser revisada com cuidado em dezembro\nItaú\tr\tmesa4821\tx\n", "mesa4821", False),
            ("CSV com observação", f"servico, usuario, senha, obs\nnubank, romulo, {W}, conta corrente e poupança de dezembro\nitau, r, mesa4821, x\n", "mesa4821", False),
            ("tabela de 40 linhas", "| Serviço | Senha |\n|---|---|\n" + "".join(f"| s{k} | lua{k:02d}26 |\n" for k in range(40)), "lua3926", False),
            ("muitas linhas em branco", f"Senhas:\n\n\n\n\n\nNubank {W}\n", W, False),
            ("prosa longa no meio da janela", f"Senhas do escritório:\nEstas são as contas que usamos e que precisam ser revisadas com muita atenção por todos antes do fim do mês de dezembro.\nNubank {W}\n", W, False),
            ("depois do marcador do cofre", f"senha: {{{{SEGREDO:{ID1}}}}}\nconvidados: {W}\n", W, False),
        ]

    def test_cada_formato_nas_duas_passadas(self):
        for desc, texto, valor, deve_bloquear in self.casos():
            if deve_bloquear:
                self.assertTrue(s.procurar(texto), f"o filtro principal devia bloquear: {desc}")
            for rotulo, visao in (("1 passada", s.mascarar_para_o_modelo(texto)), ("2 passadas", dupla(texto))):
                self.assertFalse(vaza(visao, valor), f"{rotulo}: o valor chegou à visão do modelo: {desc} -> {visao!r}")

    def test_frase_semente_em_qualquer_formato_e_lingua(self):
        formatos = {
            "1 - w": lambda ws: "\n".join(f"{k + 1} - {w}" for k, w in enumerate(ws)),
            "1: w": lambda ws: "\n".join(f"{k + 1}: {w}" for k, w in enumerate(ws)),
            "#1 w": lambda ws: "\n".join(f"#{k + 1} {w}" for k, w in enumerate(ws)),
            "01 - w": lambda ws: "\n".join(f"{k + 1:02d} - {w}" for k, w in enumerate(ws)),
            "JSON": lambda ws: "words = [" + ", ".join(f'"{w}"' for w in ws) + "]",
            "vírgula sem espaço": lambda ws: ",".join(ws),
            "hífen": lambda ws: "-".join(ws),
            "barra": lambda ws: " / ".join(ws),
            "tabela": lambda ws: "| # | palavra |\n" + "\n".join(f"| {k + 1} | {w} |" for k, w in enumerate(ws)),
            "duas colunas": lambda ws: "\n".join(f"{k + 1}. {ws[k]}    {k + 7}. {ws[k + 6]}" for k in range(6)),
            "canônico": lambda ws: " ".join(ws),
        }
        for lingua, ws in (("EN", SEED), ("ES", ES), ("FR", FR), ("ES com acento", ES_ACENTO)):
            for nome, f in formatos.items():
                for titulo in ("", "Metamask\n"):                       # com e sem palavra de contexto
                    texto = titulo + f(ws) + "\n"
                    visao = dupla(texto)
                    restantes = [w for w in ws[2:10] if w in (visao or "")]
                    self.assertEqual(restantes, [], f"{lingua} {nome} {titulo!r}: {visao!r}")

    def test_prosa_com_muitas_palavras_curtas_nao_e_semente(self):
        prosa = "o cliente pediu uma revisao completa do contrato antes de assinar para evitar problemas depois"
        self.assertEqual(dupla(prosa), prosa)

    def test_chave_so_vira_contexto_com_substantivo_de_credencial(self):
        for comum in ("Chave do carro está na gaveta da cozinha.", "a chave do problema fica no texto",
                      "Chave da casa da praia com a vizinha"):
            self.assertEqual(dupla(comum), comum)

    def test_camelcase_so_com_a_corcunda_e_nao_em_palavra_inteira_maiuscula(self):
        for ok in ("TOKENIZER: texto", "SECRETARY: Joao", "Tokenizer: x", "keyboard: x", "PASSIVE: x"):
            self.assertEqual(s.procurar(ok), [], ok)

    def test_nome_e_rotulo_com_cara_de_segredo_ficam_escondidos_e_o_comum_nao(self):
        for esconde in ("chave-cofre-482193.txt", "senhaWifi-casa2026.txt", "pswd casa2026.txt", "4111 1111 1111 1111 val 12/29",
                        " ".join(SEED), ",".join(SEED), "ZkQxLmVbNcRtYwPhDfGjAeSxK", "netflix Sommer2026!", "roteador Kx9mP2vL8q", "google abcd efgh ijkl mnop",
                        "Wi-Fi CasaRomulo / casa2026"):
            m = s.mascarar_nome_para_o_modelo(esconde)
            self.assertNotEqual(m, esconde, esconde)
            for pedaco in ("482193", "casa2026", "Sommer2026", "Kx9mP2vL8q", "abcd efgh", "4111", "abandon ability", "ZkQxLmVb"):
                if pedaco in esconde:
                    self.assertNotIn(pedaco, m, esconde)
        for normal in ("contrato-silmer-2026.pdf", "Proposta_Silmer_2026.pdf", "IMG_20261004_153012.jpg", "Relatorio-Outubro-2026.xlsx",
                       "foto (1).jpg", "WhatsApp Image 2026-10-04 at 15.30.12.jpeg", "Reunião com o cliente", "nota fiscal 4521.pdf"):
            self.assertEqual(s.mascarar_nome_para_o_modelo(normal), normal)

    def test_nome_com_caractere_de_controle_sai_limpo(self):
        self.assertEqual(s.mascarar_nome_para_o_modelo("nota\x00 da\x01 reuniao.txt"), "nota da reuniao.txt")
        self.assertNotIn("\x00", s.mascarar_nome_para_o_modelo("senha\x00wifi casa2026.txt"))

    def test_rotulo_no_modo_estrito_nao_tem_os_afrouxamentos(self):
        for rotulo in ("api_key: Valid@2026x", "apiKey: ok-Xk9mP2vL8q", "private_key: check-Kx9mP2", "access_key = expired.Pq7wLz2Nv",
                       "senha: ver no Bitwarden", "token_expiry: 3600"):
            self.assertTrue(s.tem_segredo(rotulo, estrito=True), rotulo)
        self.assertFalse(s.tem_segredo("contrato da Silmer 2026", estrito=True))
        # a entropia também: num rótulo, cadeia longa em URL ou só com letras NÃO tem o passe do texto comum
        longa = "https://drive.google.com/file/d/1aBcD3fGhIjKlMnOpQrStUvWxYz0123456/view"
        self.assertFalse(s.tem_segredo(longa))
        self.assertTrue(s.tem_segredo(longa, estrito=True))
        self.assertFalse(s.tem_segredo("ZkQxLmVbNcRtYwPhDfGjAeSxK"))
        self.assertTrue(s.tem_segredo("ZkQxLmVbNcRtYwPhDfGjAeSxK", estrito=True))


class Afrouxamentos_nos_dois_sentidos(unittest.TestCase):
    """Cada afrouxamento da camada 1 tem um limite, e o que fica fora dele continua sendo bloqueado."""

    def test_o_que_o_revisor_mostrou_ser_largo_demais_voltou_a_bloquear(self):
        K = "Xk9mP2vL" + "8qR4tY6w" + "Z1nB3cD5"
        for forte in ("senha: Valid@2026", "password: Check!4821", "senha do roteador: ver-casa-2026", "senha = casa(2026)",
                      "token: abc.def.Ghi2026x", "segredo do wifi: minha casa azul", "senha: $enha123", f"senha: $HOME {W}",
                      "https://discord.com/api/webhooks/123456789012345678/" + K + K,
                      "https://hooks.slack.com/services/T024BE7LD/B024BE7LH/" + K,
                      "https://app.exemplo.com/magic/" + K, f"data:text/plain;base64,{K}", f"<{K}@mail.exemplo.com>", f"sha256-{K}"):
            self.assertTrue(s.procurar(forte), forte)

    def test_o_que_continua_sendo_texto_comum(self):
        K = "Xk9mP2vL" + "8qR4tY6w" + "Z1nB3cD5"
        b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        integridade = "sha512-" + "q2DgYxG0vJ8QwNnL3k7JQZ0gq8m2Q1F3cXb5w9Z8yR4t+V0aL6pD2sK7hN1oB3eC9fU5iT4rW6xY8zA0bE2cG=="
        for ok in (f'<img src="data:image/png;base64,{b64}">', f'"integrity": "{integridade}"',
                   f"Message-ID: <{K}@mail.gmail.com>", "docker run -e POSTGRES_PASSWORD=$PG_PASS postgres:16",
                   "senha: $senha", "password=${DB_PASSWORD}"):
            self.assertEqual(s.procurar(ok), [], ok)

    def test_o_segundo_clique_funciona_para_xml_define_netrc_sql_net_user_e_sudo(self):
        casos = ((f"<password>{W}x</password>", W + "x"), (f"define( 'DB_PASSWORD', '{W}' );", W),
                 (f"machine api.heroku.com login r@x.com password {W}", W), (f"CREATE USER a IDENTIFIED BY '{W}';", W),
                 (f"net user administrador {W} /add", W), (f'echo "{W}" | sudo -S apt update', W))
        for texto, valor in casos:
            achados = []
            novo, _ = s.redigir(texto, lambda v, r: achados.append(v) or ID1)
            self.assertEqual(achados, [valor], texto)
            self.assertEqual(s.procurar(novo), [], f"sobrou algo achável: {novo!r}")

    def test_comando_nao_atravessa_a_quebra_de_linha(self):
        self.assertEqual(s.procurar("sshpass fica na lista de ferramentas\n-p: |\n"), [])
        self.assertEqual(s.procurar("mysql\n-pvalorqualquer"), [], "-p na linha de baixo não é argumento do mysql de cima")
        self.assertEqual(s.procurar("sshpass esta instalado\n-p valorqualquer x"), [])
        self.assertEqual(s.procurar("curl https://x.io\n-u romulo:valorqualquer"), [])
        self.assertTrue(s.procurar("mysql -u r -pvalorqualquer"))

    def test_texto_ofuscado_em_unicode_so_bloqueia_nao_se_redige(self):
        achados = s.procurar("ｓｅｎｈａ: " + W)
        self.assertTrue(achados)
        self.assertTrue(all(not a.redigivel for a in achados if a.regra == "segredo-ofuscado-em-unicode"))
        with self.assertRaises(s.NaoRedigivel):
            s.redigir("ｓｅｎｈａ: " + W, lambda v, r: ID1)

    def test_controles_e_nul_nao_chegam_ao_modelo(self):
        v = s.mascarar_para_o_modelo("linha um\x00linha dois\n\x01\x02\x1bfim\x7f")
        self.assertEqual(v, "linha umlinha dois\nfim")

    def test_utf8_nao_latino_tambem_e_texto_para_a_entropia_do_varredor(self):
        v = s.Varredor()
        corpo = ("Привет, это обычный русский текст для проверки. " * 3000).encode("utf-8")
        chave = ("\nключ: " + ENT + "\n").encode("utf-8")
        self.assertTrue(v.alimentar(corpo + chave), "a chave no meio de 150 KB de cirílico é achada")
        self.assertFalse(s.Varredor().alimentar(corpo))


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

    def test_valor_ignorado_nao_e_mais_lento_que_o_resto(self):
        # descritivo/código/referência são "pulados": o caminho de pular chegou a custar 2,9 s/MB (revisão C)
        casos = {"descritivo": "token=ver x  " * 80_000, "código": "senha = getpass.getpass()\n" * 40_000,
                 "referência": "password=$PG_PASS other\n" * 40_000, "camelCase": "senhaAdmin: a\n" * 70_000,
                 "uma linha só": "token=ver x " * 90_000}
        for nome, t in casos.items():
            mb = len(t) / 1e6
            for fn in (s.procurar, s.tem_segredo):
                self.assertLess(self.tempo(lambda: fn(t)) / mb, 2.0, nome)

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
