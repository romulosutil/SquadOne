#!/usr/bin/env python3
"""Lote contínuo do "Site antes da venda" no Dell (07/10/2026): cria sites personalizados
até acabar o que há para fazer ou o limite de uso do Claude.

Pedido do Rômulo: seguir criando sem parar, sempre personalizado e com movimento de nível
especialista, e ir apagando os demos antigos. Uma unidade systemd transitória roda isto:

    systemd-run --user --unit=lote-continuo --collect \\
      -p EnvironmentFile=%h/.config/claude-ops/gerador.env -p Nice=10 \\
      /usr/bin/python3 %h/.local/bin/lote-continuo

Três trabalhos ao mesmo tempo:
1. Caçador (thread): roda "01 · Caçador" uma busca por vez (rodar-agora.py) enquanto trouxer
   lead; para depois de CACADOR_VAZIAS execuções seguidas sem lead novo.
2. Gerador (laço principal), em levas curtas para reavaliar o que fazer entre uma e outra:
   a) fila com lead novo -> `gerador-de-sites --personalizado` (lead novo já personalizado);
   b) senão, refaz demos publicados e NÃO enviados com a versão de personalização mais antiga
      (`personalizado.json` com versao < VERSAO_ALVO); quem nunca foi refeito vai primeiro;
   c) senão, espera o Caçador; sem Caçador e sem trabalho, termina.
3. Limpeza (uma vez por dia, depois das 10h): `site-demos-limpeza --apagar`, que apaga o projeto
   da Vercel de quem está em Perdido no CRM há 2+ dias (a regra é a do script).

Limite de uso do Claude: espera 30 min e tenta de novo, até MAX_LIMITES seguidas. Limite de
deploys da Vercel (hobby: 100 por dia): espera 1 h. `~/auto-site/.parar-lote` encerra no fim da leva.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

HOME = Path.home()
AUTO = HOME / "auto-site"
LOGS = AUTO / ".logs"
LOG = LOGS / "lote-continuo.log"
LOG_FILA = LOGS / "execucao-fila.log"
PARAR = AUTO / ".parar-lote"
RUNNER = HOME / ".local/bin/gerador-de-sites"
LIMPEZA = HOME / ".local/bin/site-demos-limpeza"
CLAUDE_OPS = HOME / ".local/share/claude-ops"
RETRATO = HOME / ".local/share/n8n-estado/site-leads.json"
CACADOR_ID = "oow8TkxrAf4fVvTj"  # "01 · Caçador" no n8n do Dell

# GERADOR_PREMIUM=1 (ou `--premium`): todo lead, novo ou refeito, sai no modo premium (referências do Refero,
# UX/UI, crítica visual). Os demos de versão menor são refeitos; leva de 1 lead, que reavalia a fila a cada site.
PREMIUM = "--premium" in sys.argv[1:] or os.environ.get("GERADOR_PREMIUM", "").strip().lower() in ("1", "true", "sim")
# Desligado em 13/10/2026 (ver PREMIUM_DESLIGADO no gerador-de-sites.py): pedido sem o GERADOR_PREMIUM_LIGADO=1,
# o lote segue no personalizado em vez de mandar ao gerador um --premium que ele recusa.
PREMIUM_PEDIDO_E_DESLIGADO = PREMIUM and os.environ.get("GERADOR_PREMIUM_LIGADO", "").strip().lower() not in ("1", "true", "sim")
if PREMIUM_PEDIDO_E_DESLIGADO:
    PREMIUM = False
VERSAO_ALVO = 3 if PREMIUM else 2
TIMEOUT_MIN = 180 if PREMIUM else 90   # por lead (o premium pesquisa, constrói e critica 3 vezes)
LEVA_NOVOS = 1 if PREMIUM else 3       # leads novos por leva
LEVA_REFAZER = 1 if PREMIUM else 3     # demos refeitos por leva
CACADOR_VAZIAS = 5
CACADOR_MAX = 80
MAX_LIMITES = 16          # 16 x 30 min = 8 h de limite de uso seguidas
ESPERA_LIMITE_S = 30 * 60
ESPERA_DEPLOY_S = 60 * 60
LIMITE_DE_USO = re.compile(r"Limite de uso do Claude")
LIMITE_DE_DEPLOY = re.compile(r"(?i)api-deployments-free-per-day|Resource is limited|too many deployments"
                              r"|api-projects|too many projects|project limit|maximum number of projects")
SALVOS = re.compile(r"Salvar lead na planilha: \w+ itens=(\d+)")


def agora() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str) -> None:
    linha = f"[{agora()}] {msg}"
    print(linha, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def ler_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------------ o que há para fazer

def fila_nova() -> int:
    """Leads novos na fila do gerador (a lista que o próprio runner mostra)."""
    r = subprocess.run([sys.executable, str(RUNNER), "--listar"], capture_output=True, text=True, timeout=120)
    return sum(1 for l in r.stdout.splitlines() if l.strip() and "(fora da fila" not in l)


def candidatos_refazer(retrato: dict | None = None, auto: Path | None = None) -> list[str]:
    """Slugs de demos publicados e não enviados cuja personalização é mais antiga que VERSAO_ALVO.
    Quem nunca foi refeito (sem `_vN/`) vem antes de quem já teve uma versão personalizada.
    `auto` existe para o teste apontar para uma pasta temporária (nunca mude a variável global AUTO)."""
    raiz = auto or AUTO
    d = retrato if retrato is not None else ler_json(RETRATO)
    if not isinstance(d, dict):
        return []
    achados = []
    for l in d.get("leads", []):
        pasta = str(l.get("pasta") or "")
        if l.get("status") != "pronto" or not pasta or "/" in pasta:
            continue
        p = raiz / pasta
        recibo = ler_json(p / "publicado.json")
        if not isinstance(recibo, dict) or recibo.get("apagado_em") or not (p / "index.html").is_file():
            continue
        marca = ler_json(p / "personalizado.json") or {}
        if int(marca.get("versao") or 0) >= VERSAO_ALVO:
            continue
        refeitos = len([x for x in p.glob("_v[0-9]*") if x.is_dir()])
        achados.append((refeitos, str(recibo.get("publicado_em") or ""), pasta))
    return [pasta for _, _, pasta in sorted(achados)]


# ------------------------------------------------------------------ Caçador

class Cacador(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True, name="cacador")
        self.salvos = 0
        self.execucoes = 0

    def run(self) -> None:
        vazias = 0
        while self.execucoes < CACADOR_MAX and vazias < CACADOR_VAZIAS and not PARAR.exists():
            self.execucoes += 1
            try:
                r = subprocess.run([sys.executable, "rodar-agora.py", CACADOR_ID], cwd=CLAUDE_OPS,
                                   capture_output=True, text=True, timeout=1500)
                saida = (r.stdout or "") + (r.stderr or "")
            except (subprocess.TimeoutExpired, OSError) as e:
                log(f"Caçador {self.execucoes}: {type(e).__name__}: {e}")
                vazias += 1
                time.sleep(120)
                continue
            ok = "status: success" in saida
            novos = sum(int(m) for m in SALVOS.findall(saida))
            self.salvos += novos
            vazias = 0 if novos else vazias + 1
            log(f"Caçador {self.execucoes}: {'ok' if ok else 'ERRO'}; {novos} lead(s) novo(s) (total {self.salvos}); "
                f"{vazias} execução(ões) seguida(s) sem lead")
            time.sleep(20)
        log(f"Caçador terminou: {self.execucoes} execução(ões), {self.salvos} lead(s) novo(s).")


# ------------------------------------------------------------------ gerador

def tamanho_log() -> int:
    try:
        return LOG_FILA.stat().st_size
    except OSError:
        return 0


def novo_no_log(desde: int) -> str:
    try:
        with open(LOG_FILA, "rb") as f:
            f.seek(desde)
            return f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def rodar_leva(args: list[str], rotulo: str) -> tuple[bool, bool]:
    """Roda o gerador e devolve (bateu no limite de uso, bateu no limite de deploys)."""
    inicio = tamanho_log()
    desde = time.time()
    log(f"Leva: {rotulo}")
    r = subprocess.run([sys.executable, str(RUNNER), *args], timeout=12 * 3600)
    texto = novo_no_log(inicio)
    concluidos = len(re.findall(r"Lead concluído:", texto))
    log(f"Leva terminou (exit {r.returncode}): {concluidos} concluído(s).")
    # O erro da Vercel aparece no log do lead (o deploy roda dentro do Claude ou no runner), não no da fila.
    texto += limite_nos_logs_dos_leads(desde)
    return bool(LIMITE_DE_USO.search(texto)), bool(LIMITE_DE_DEPLOY.search(texto))


def limite_nos_logs_dos_leads(desde: float, logs: Path | None = None) -> str:
    """Trechos dos logs de lead alterados depois de `desde` que casam com o limite de deploys/projetos da Vercel.
    `logs` existe para o teste apontar para uma pasta temporária."""
    achados = []
    try:
        for p in (logs or LOGS).glob("execucao-*.log"):
            if p.name == "execucao-fila.log" or p.stat().st_mtime < desde:
                continue
            m = LIMITE_DE_DEPLOY.search(p.read_text(encoding="utf-8", errors="replace")[-20000:])
            if m:
                achados.append(f" {m.group(0)}")
    except OSError:
        pass
    return "".join(achados)


def limpar_antigos() -> None:
    """Apaga os demos enviados há 10+ dias sem interação (a regra e a trava são do próprio script)."""
    if not LIMPEZA.exists():
        return
    r = subprocess.run([sys.executable, str(LIMPEZA), "--apagar"], capture_output=True, text=True, timeout=1800)
    resumo = " | ".join(l for l in (r.stdout or "").splitlines() if l.strip())[:400]
    log(f"Limpeza dos antigos (exit {r.returncode}): {resumo}")


def main() -> int:
    log("Lote contínuo iniciado.")
    if PREMIUM_PEDIDO_E_DESLIGADO:
        log("Premium pedido, mas desligado desde 13/10/2026: o lote segue no modo personalizado.")
    cacador = Cacador()
    cacador.start()
    ultima_limpeza = None
    limites = 0
    while True:
        if PARAR.exists():
            PARAR.unlink(missing_ok=True)
            log("Sinal .parar-lote recebido; encerrando.")
            break
        hoje = dt.date.today()
        if ultima_limpeza != hoje and dt.datetime.now().hour >= 10:
            limpar_antigos()
            ultima_limpeza = hoje
        novos = fila_nova()
        modo = ["--premium"] if PREMIUM else []
        if novos:
            uso, deploy = rodar_leva(["--personalizado", *modo, "--quantidade", str(LEVA_NOVOS), "--timeout-min", str(TIMEOUT_MIN),
                                      "--teto-horas", "8"], f"{novos} lead(s) novo(s) na fila")
        else:
            refazer = candidatos_refazer()[:LEVA_REFAZER]
            if refazer:
                uso, deploy = rodar_leva(["--refazer", *refazer, *modo, "--timeout-min", str(TIMEOUT_MIN), "--teto-horas", "8"],
                                         "refazer " + ", ".join(refazer))
            elif cacador.is_alive():
                time.sleep(180)
                continue
            else:
                log("Sem lead novo, sem demo para refazer e Caçador terminado: fim do lote.")
                break
        if uso:
            limites += 1
            log(f"Limite de uso do Claude ({limites}/{MAX_LIMITES}); espera {ESPERA_LIMITE_S // 60} min.")
            if limites >= MAX_LIMITES:
                log("Limite de uso persistente; encerrando o lote.")
                break
            time.sleep(ESPERA_LIMITE_S)
        else:
            limites = 0
        if deploy:
            # Pedido do Rômulo (08/10/2026): seguir "até chegar ao limite da Vercel". Chegou: para e avisa;
            # o limite de deploys do hobby zera em 24 h, o de projetos só com `site-demos-limpeza`.
            log("Limite da Vercel (deploys por dia ou projetos); encerrando o lote.")
            break
    limpar_antigos()
    log(f"Lote contínuo terminou. Fila nova: {fila_nova()}; a refazer: {len(candidatos_refazer())}.")
    return 0


def testar() -> int:
    import tempfile
    import unittest

    class Casos(unittest.TestCase):
        def setUp(self):
            # Pasta própria do teste. NUNCA mexa na variável global AUTO nem apague outro caminho:
            # em 07/10/2026 um tearDown que devolvia o AUTO real antes da limpeza fez o rmtree apagar
            # o ~/auto-site inteiro do Dell.
            self.raiz = Path(tempfile.mkdtemp(prefix="lote-teste-"))
            assert str(self.raiz).startswith(tempfile.gettempdir()) and self.raiz != AUTO
            self.addCleanup(self.apagar_a_propria_raiz)

        def apagar_a_propria_raiz(self):
            if str(self.raiz).startswith(tempfile.gettempdir() + "/lote-teste-"):
                __import__("shutil").rmtree(self.raiz, ignore_errors=True)

        def lead(self, slug, status="pronto", versao=None, v_dirs=0, apagado=False, publicado_em="2026-10-07T12:00:00-03:00"):
            p = self.raiz / slug
            p.mkdir()
            (p / "index.html").write_text("<html></html>")
            (p / "publicado.json").write_text(json.dumps({"publicado_em": publicado_em, **({"apagado_em": "x"} if apagado else {})}))
            if versao is not None:
                (p / "personalizado.json").write_text(json.dumps({"versao": versao}))
            for i in range(v_dirs):
                (p / f"_v{i + 1}").mkdir()
            return {"pasta": slug, "status": status}

        def test_so_refaz_pronto_e_de_versao_antiga(self):
            leads = [self.lead("a"), self.lead("b", versao=2), self.lead("c", versao=1, v_dirs=1),
                     self.lead("d", status="enviado"), self.lead("e", apagado=True)]
            self.assertEqual(candidatos_refazer({"leads": leads}, self.raiz), ["a", "c"])

        def test_quem_nunca_foi_refeito_vem_primeiro(self):
            leads = [self.lead("velho-ja-refeito", versao=1, v_dirs=1, publicado_em="2026-10-01T00:00:00-03:00"),
                     self.lead("novo-nunca", publicado_em="2026-10-07T00:00:00-03:00")]
            self.assertEqual(candidatos_refazer({"leads": leads}, self.raiz), ["novo-nunca", "velho-ja-refeito"])

        def test_pasta_fora_da_raiz_e_retrato_ilegivel(self):
            self.assertEqual(candidatos_refazer({"leads": [{"pasta": "_recusados/x", "status": "pronto"}]}, self.raiz), [])
            self.assertEqual(candidatos_refazer({}, self.raiz), [])

        def test_detecta_os_limites_no_log(self):
            self.assertTrue(LIMITE_DE_USO.search("[ERRO] Limite de uso do Claude: parando a lista de refazer."))
            self.assertTrue(LIMITE_DE_DEPLOY.search("Error: Resource is limited - try again in 24 hours (more than 100, code: api-deployments-free-per-day)"))
            self.assertFalse(LIMITE_DE_DEPLOY.search("Aliased: https://demo-x.vercel.app"))

        def test_limite_da_vercel_no_log_do_lead_so_conta_se_for_desta_leva(self):
            (self.raiz / "execucao-a.log").write_text("Error: Resource is limited - try again in 24 hours (api-deployments-free-per-day)")
            (self.raiz / "execucao-b.log").write_text("Aliased: https://demo-b.vercel.app")
            (self.raiz / "execucao-fila.log").write_text("api-deployments-free-per-day")  # o da fila não conta aqui
            self.assertIn("Resource is limited", limite_nos_logs_dos_leads(0, self.raiz))
            self.assertEqual(limite_nos_logs_dos_leads(time.time() + 3600, self.raiz), "")  # log velho: de outra leva
            (self.raiz / "execucao-a.log").unlink()
            self.assertEqual(limite_nos_logs_dos_leads(0, self.raiz), "")

        def test_limite_de_projetos_tambem_para_o_lote(self):
            self.assertTrue(LIMITE_DE_DEPLOY.search("Error: Your team has reached the maximum number of projects"))

        def test_conta_leads_salvos_do_cacador(self):
            saida = "  Salvar lead na planilha: success itens=4 \n  Salvar lead na planilha: success itens=0 \n"
            self.assertEqual(sum(int(m) for m in SALVOS.findall(saida)), 4)

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Casos))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(testar() if "--testar" in sys.argv[1:] else main())
