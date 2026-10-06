"""Site antes da venda: migração de nicho de 05/10/2026 (idempotente).

Até 05/10: 83 enviados, 11 respostas, as 11 "não tenho interesse", 0 vendas.
Os nichos testados (pousada, eventos, buffet, odontologia, pilates, academia,
estética, vidraçaria, marcenaria, climatização, escola infantil, pet shop) são
B2C de vitrine: a demanda vem do Instagram, do Booking ou da indicação, e quem
fica sem site ali escolheu vender por esses canais. O que tem evidência
(pesquisa de 05/10, TIC Empresas, CPC por segmento) é o oposto: serviço que o
cliente final DIGITA no Google para contratar, com cliente de ticket alto ou
empresa do outro lado. Primeira leva:

- urgência: desentupidora, dedetizadora, caçamba de entulho;
- escritório: contabilidade, advocacia previdenciária e trabalhista;
- B2B: usinagem, caldeiraria, locação de andaimes;
- obra: empresa de reformas.

Google Trends (Brasil, 5 anos, 05/10/2026; média relativa a "site para
advogado" = 1): o dono que procura site sozinho é advogado: "site para
advogado" 1, "site de advocacia" 0,62, "site jurídico" 0,41, "site para
advogados" 0,24 (≈ 2,3 somados). Depois clínica/médico (≈ 0,9), imobiliário
(≈ 0,75), engenharia 0,63 e restaurante (≈ 0,6). Contabilidade, dentista,
psicólogo, nutricionista, arquiteto, academia, salão e pet shop ficam perto de
zero. Por isso advocacia tem 4 buscas e é a PREFERIDA do Caçador
(site-cacador-escolha.py). Contabilidade fica pela credibilidade B2B, não pela
busca. Os estados que mais procuram "criação de sites": DF, SP, GO, SC, PR.

Fora de propósito: saúde (CFO/CFM/CFP proíbem depoimento, e as avaliações do
Google são o diferencial da demo), beleza, restaurante (cliente vale pouco no
Google), imobiliária (CRM com site embutido a R$130/mês), hospedagem e eventos
(vendem por OTA e Instagram), autoescola (setor em crise desde o Contran de
12/2025).

O que este script faz:
1. aba Buscas: as buscas ativas que não são da lista nova viram `ativa` FALSE
   com `pausada_em` e `pausa_motivo`; as novas entram no fim, ativas (a mesma
   query na mesma coordenada não entra duas vezes);
2. "01 · Caçador": a regra 1 do Gemini aceita escritório, indústria, empresa
   que atende no endereço do cliente e profissional liberal com escritório
   (antes só estabelecimento com espaço físico e equipe; advogado em nome
   próprio era descarte); o "Pontuar" dá +15 a serviço que se procura no
   Google para contratar e não tira 10 de quem não posta no Instagram nesses
   ramos (escritório e indústria quase não postam);
3. `FEMININOS` (artigo da mensagem: "da Desentupidora X") em todo nó que tem a
   lista, a partir de site-mensagem.js;
4. ~/auto-site/CLAUDE.md: seção do gerador para os ramos novos (OAB sóbria,
   B2B com pedido de orçamento, urgência com botão fixo), entre marcadores.

A vez entre as buscas é do site-cacador-escolha.py (PREFERIDAS vazia desde
esta data) e a pausa de quem não tem interesse, do site-acompanhamento.py.

Uso: python3 site-nichos.py                aplica tudo (backups em ~/.local/share/claude-ops/backups/)
     python3 site-nichos.py --testar       funções puras e o código dos nós no node, sem n8n nem planilha
     python3 site-nichos.py --testar-vivo  lê o Caçador do Dell, aplica em memória e pontua leads de mentira (não grava)
"""
import copy
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent
CACADOR = "oow8TkxrAf4fVvTj"  # "01 · Caçador" no n8n do Dell
PLANILHA = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o"  # "Leads — Site antes da venda"
BACKUPS = Path.home() / ".local/share/claude-ops/backups"
GERADOR = Path.home() / "auto-site/CLAUDE.md"
MOTIVO_PAUSA = "migração de nicho 05/10/2026: 0 interesse em 83 envios (B2C de vitrine)"

# query, lat, lng, raio_m, vertical. Cidades médias: nas capitais quase todo
# escritório e indústria já tem site; o raio maior cobre polo industrial.
BUSCAS_NOVAS = [
    ("desentupidora", "-22.9056", "-47.0608", "12000", "desentupidora"),                  # Campinas
    ("desentupidora", "-16.6869", "-49.2648", "12000", "desentupidora"),                  # Goiânia
    ("dedetizadora", "-23.5015", "-47.4526", "12000", "dedetização"),                     # Sorocaba
    ("dedetizadora", "-25.4284", "-49.2733", "10000", "dedetização"),                     # Curitiba
    ("caçamba de entulho", "-22.9056", "-47.0608", "12000", "caçamba"),                   # Campinas
    ("escritório de contabilidade", "-23.3045", "-51.1696", "8000", "contabilidade"),     # Londrina
    ("escritório de contabilidade", "-18.9186", "-48.2772", "8000", "contabilidade"),     # Uberlândia
    ("advogado previdenciário", "-21.1775", "-47.8103", "8000", "advocacia"),             # Ribeirão Preto
    ("advogado trabalhista", "-26.3045", "-48.8487", "8000", "advocacia"),                # Joinville
    ("advogado", "-15.7939", "-47.8828", "10000", "advocacia"),                           # Brasília
    ("advogado de família", "-16.6869", "-49.2648", "10000", "advocacia"),                # Goiânia
    ("escritório de engenharia", "-25.4284", "-49.2733", "10000", "engenharia"),          # Curitiba
    ("usinagem", "-29.1678", "-51.1794", "15000", "usinagem"),                            # Caxias do Sul
    ("caldeiraria", "-23.5015", "-47.4526", "15000", "caldeiraria"),                      # Sorocaba
    ("locação de andaimes", "-16.6869", "-49.2648", "15000", "locação de equipamentos"),  # Goiânia
    ("empresa de reformas", "-23.1857", "-46.8978", "10000", "reformas"),                 # Jundiaí
]
COLUNAS = ["query", "lat", "lng", "raio_m", "vertical", "ativa", "ultima_rodada", "pausada_em", "pausa_motivo"]

REGRA_1 = ("1. É um negócio que contrata site? Conta: estabelecimento com espaço físico e equipe (loja, oficina, "
           "indústria, escritório, clínica, studio); empresa de serviço com nome comercial, inclusive a que atende no "
           "endereço do cliente (desentupidora, dedetizadora, caçamba, reformas, locação); profissional liberal com "
           "escritório (advogado, contador, engenheiro, arquiteto), mesmo em nome próprio (\"Fulano Advocacia\", "
           "\"Dr. Fulano Advogado\"). Não conta: consultório individual de saúde, personal trainer, pessoa física sem "
           "nome comercial que faz bico.")

# Radicais (sem acento, minúsculos) da vertical do Gemini ou do tipo do Google.
ALTA_INTENCAO = ["desentup", "dedetiz", "pragas", "cacamba", "contab", "contador", "advoc", "advog", "usinag",
                 "caldeir", "metalurg", "andaime", "locacao de equip", "locadora", "reforma", "engenhar", "construtora"]

DEF_ALTA = ("// Migração de nicho (05/10/2026, site-nichos.py): serviço que o cliente procura no Google para\n"
            "// contratar. Ali o site é o canal de venda, não enfeite; e escritório e indústria quase não postam.\n"
            "const ALTA_INTENCAO = " + json.dumps(ALTA_INTENCAO) + ";\n")
ANCORA_DEF = "const NOTA_MINIMA = 60;\n"
ANCORA_PRESENCA = ("  const presencaNula = !p.site_morto && !p.rede_social && !igAtivo && whatsapp.length < 10;\n"
                   "  if (presencaNula) soma(-10, 'nenhum sinal fora do Google (sem Instagram ativo, sem WhatsApp publicado)');\n")
NOVO_PRESENCA = ("  const intencao = ALTA_INTENCAO.find(r => normalizar((c.vertical || '') + ' ' + (p.tipo || '')).includes(r));\n"
                 "  if (intencao) soma(15, 'serviço que o cliente procura no Google para contratar (' + (c.vertical || p.tipo) + ')');\n"
                 "  const presencaNula = !p.site_morto && !p.rede_social && !igAtivo && whatsapp.length < 10;\n"
                 "  if (presencaNula && !intencao) soma(-10, 'nenhum sinal fora do Google (sem Instagram ativo, sem WhatsApp publicado)');\n")

INICIO_GERADOR = "<!-- site-nichos.py: início (não edite entre os marcadores; rode o script) -->"
FIM_GERADOR = "<!-- site-nichos.py: fim -->"
SECAO_GERADOR = f"""{INICIO_GERADOR}
### Ramos novos: urgência, escritório, indústria (desde 05/10/2026)

Migração de nicho do Rômulo: 83 demos de B2C de vitrine (pousada, eventos,
estética, academia...) deram 0 interesse. Agora o Caçador traz serviço que o
cliente procura no Google para contratar. A premissa "sem site" e o "nada
inventado" continuam; muda o que a página precisa provar para quem chega
pelo Google:

- **Advocacia** (Provimento 205/2021 da OAB): sóbria e informativa. Sem
  avaliações nem depoimentos de clientes na página, sem promessa de resultado
  ("garantido", "ganhe sua causa"), sem preço, sem superlativo ("o melhor",
  "referência"), sem chamada de venda ("consulta grátis", "promoção").
  Entra: áreas de atuação explicadas em linguagem simples, quem atende, como
  funciona o primeiro atendimento, endereço e contato. Número da OAB só se o
  próprio advogado o publica. CTA: "Falar com o escritório" no WhatsApp.
- **Contabilidade**: serviços (abertura de empresa, MEI, Simples, folha,
  imposto de renda), para que porte de empresa, quem atende. CRC só se
  publicado. Avaliações podem entrar.
- **Indústria e B2B** (usinagem, caldeiraria, locação de equipamentos): quem
  compra é empresa. Capacidades, processos, materiais, setores atendidos e
  região de entrega, sem inventar máquina nem certificação: o que as fotos, as
  avaliações e a pesquisa não mostram fica genérico ("peças sob desenho").
  CTA: "Pedir orçamento" no WhatsApp, com o texto já pedindo desenho ou
  quantidade.
- **Urgência** (desentupidora, dedetizadora, caçamba): o cliente chega com
  pressa, pelo celular. WhatsApp e ligar fixos na tela, região atendida,
  serviços em lista, horário como o Google diz ("24 horas" só se estiver lá).
  Laudo ou certificado para condomínio e Vigilância só se o negócio já cita.
- **Saúde** (psicologia, odontologia, medicina) saiu das buscas: os conselhos
  proíbem depoimento. Se um lead assim aparecer, nada de avaliações na página.
{FIM_GERADOR}"""


# ------------------------------------------------------------------ funções puras

def aplicar_cacador(wf: dict) -> dict:
    """Regra 1 do Gemini e "Pontuar". Rodar de novo não muda nada."""
    wf = copy.deepcopy(wf)
    por = {n["name"]: n for n in wf["nodes"]}
    msg = por["Gemini: classificar e checar na web"]["parameters"]["messages"]["values"][0]
    if not re.search(r"^1\. .*$", msg["content"], flags=re.M):
        raise SystemExit("Caçador: regra 1 do Gemini não encontrada; nada foi aplicado")
    msg["content"] = re.sub(r"^1\. .*$", lambda _: REGRA_1, msg["content"], count=1, flags=re.M)
    pont = por["Pontuar"]["parameters"]
    js = pont["jsCode"]
    if "const ALTA_INTENCAO = " in js:
        js = re.sub(r"const ALTA_INTENCAO = \[[^\]]*\];", lambda _: "const ALTA_INTENCAO = " + json.dumps(ALTA_INTENCAO) + ";", js)
    else:
        if ANCORA_DEF not in js or ANCORA_PRESENCA not in js:
            raise SystemExit("Caçador: o Pontuar mudou desde 05/10/2026 (âncora não encontrada); nada foi aplicado")
        js = js.replace(ANCORA_DEF, ANCORA_DEF + DEF_ALTA, 1).replace(ANCORA_PRESENCA, NOVO_PRESENCA, 1)
    pont["jsCode"] = js
    return wf


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


def ativa(v) -> bool:
    return str(v or "").strip().lower() in ("true", "verdadeiro", "sim", "x", "1")


def plano_buscas(valores: list, agora: str) -> tuple:
    """Da aba Buscas crua (cabeçalho + linhas) para (pausas, novas).
    pausas: [(row_number, pausada_em, motivo)]; novas: linhas a acrescentar."""
    cab = valores[0]
    faltam = [c for c in COLUNAS if c not in cab]
    if faltam:
        raise SystemExit(f"aba Buscas sem as colunas {faltam}")
    linhas = [dict(zip(cab, v + [""] * (len(cab) - len(v)))) for v in valores[1:]]
    chave = lambda q, lat, lng: (q.strip().lower(), str(lat).strip(), str(lng).strip())
    novas_chaves = {chave(b[0], b[1], b[2]) for b in BUSCAS_NOVAS}
    pausas = [(i + 2, agora, MOTIVO_PAUSA) for i, l in enumerate(linhas)
              if ativa(l["ativa"]) and chave(l["query"], l["lat"], l["lng"]) not in novas_chaves]
    existentes = {chave(l["query"], l["lat"], l["lng"]) for l in linhas}
    novas = [[q, lat, lng, raio, vert, "TRUE", "", "", ""] for q, lat, lng, raio, vert in BUSCAS_NOVAS
             if chave(q, lat, lng) not in existentes]
    return pausas, novas


def aplicar_gerador(texto: str) -> str:
    if INICIO_GERADOR in texto:
        ini, fim = texto.index(INICIO_GERADOR), texto.index(FIM_GERADOR) + len(FIM_GERADOR)
        return texto[:ini] + SECAO_GERADOR + texto[fim:]
    # Logo depois da Regionalidade, que é onde o gerador lê o que muda por mercado.
    ancora = "### Regras do arquivo"
    if ancora in texto:
        return texto.replace(ancora, SECAO_GERADOR + "\n\n" + ancora, 1)
    return texto.rstrip() + "\n\n" + SECAO_GERADOR + "\n"


# ------------------------------------------------------------------ node

def node() -> str:
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    if not exe:
        raise SystemExit("node não encontrado")
    return str(exe)


def pontuar_no_node(js: str, itens: list, agora_iso: str) -> list:
    prog = (f"Date.now = () => Date.parse({json.dumps(agora_iso)});\n"
            "const $input = { all: () => " + json.dumps(itens, ensure_ascii=False) + ".map(json => ({ json })) };\n"
            "const r = (() => {\n" + js + "\n})();\nconsole.log(JSON.stringify(r.map(i => i.json)));\n")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "pontuar.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([node(), arq], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def lead(nome, tipo, vertical, **k):
    """Lead de mentira na forma que chega ao "Pontuar"."""
    classif = {"e_estabelecimento": True, "vertical": vertical, "motivo": "", "site_no_ar": "", "e_rede": False,
               "fechado": False, "instagram": "", "ultimo_post": "", "instagram_ativo": False, "whatsapp": "",
               "dono_acessivel": True, "atrito": False, "atrito_motivo": ""}
    classif.update(k.pop("classif", {}))
    base = {"nome": nome, "tipo": tipo, "endereco": "Rua A, 1 - Centro, Campinas - SP", "telefone": "+55 19 99876-5432",
            "pais": "Brasil", "site_morto": False, "rede_social": "", "photos": [], "regularOpeningHours": {"x": 1},
            "ultima_avaliacao": "2026-09-20T12:00:00Z", "userRatingCount": 12, "rating": 4.8,
            "classificacao": json.dumps(classif)}
    base.update(k)
    return base


def casos_de_pontuacao(js: str) -> dict:
    agora = "2026-10-05T12:00:00-03:00"
    itens = [lead("Desentupidora Rápida", "Desentupidora", "desentupidora"),
             lead("Studio Bem Estar", "Academia", "academia"),
             lead("Silva Advocacia", "Advogado", "advocacia")]
    return {x["nome"]: x for x in pontuar_no_node(js, itens, agora)}


# ------------------------------------------------------------------ testes

PONTUAR_DE_MENTIRA = (
    "const NOTA_MINIMA = 60;\n"
    "function normalizar(texto) { return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }\n"
    "const saida = [];\n"
    "$input.all().forEach((item, i) => {\n"
    "  const p = item.json; const c = JSON.parse(p.classificacao);\n"
    "  const sinais = []; let score = 50; const igAtivo = false; const whatsapp = '';\n"
    "  const soma = (pontos, texto) => { score += pontos; sinais.push(pontos + ' ' + texto); };\n"
    + ANCORA_PRESENCA +
    "  saida.push({ json: { nome: p.nome, score, sinais } });\n"
    "});\n"
    "return saida;\n")


def testar() -> int:
    import unittest

    def wf_falso():
        return {"nodes": [
            {"name": "Gemini: classificar e checar na web", "parameters": {"messages": {"values": [{"content":
                "Negócio:\n\n1. É estabelecimento com espaço físico e equipe (studio)?\n2. Já tem site?"}]}}},
            {"name": "Pontuar", "parameters": {"jsCode": PONTUAR_DE_MENTIRA}},
            {"name": "Balcão", "parameters": {"jsCode": "const X = 1;\nconst FEMININOS = ['clinica'];\nconst Y = 2;"}},
        ], "connections": {}}

    class Nichos(unittest.TestCase):
        def test_cacador_troca_a_regra_1_e_e_idempotente(self):
            uma = aplicar_cacador(wf_falso())
            msg = uma["nodes"][0]["parameters"]["messages"]["values"][0]["content"]
            self.assertIn("Dr. Fulano Advogado", msg)
            self.assertIn("2. Já tem site?", msg)
            self.assertNotIn("É estabelecimento com espaço", msg)
            self.assertEqual(aplicar_cacador(uma), uma)

        def test_pontuar_da_15_a_alta_intencao_e_poupa_o_instagram(self):
            js = aplicar_cacador(wf_falso())["nodes"][1]["parameters"]["jsCode"]
            r = casos_de_pontuacao(js)
            self.assertEqual(r["Desentupidora Rápida"]["score"], 65)   # 50 + 15, sem o -10
            self.assertEqual(r["Silva Advocacia"]["score"], 65)
            self.assertEqual(r["Studio Bem Estar"]["score"], 40)       # 50 - 10: ramo de vitrine segue igual

        def test_pontuar_sem_ancora_nao_aplica(self):
            wf = wf_falso()
            wf["nodes"][1]["parameters"]["jsCode"] = "const NOTA_MINIMA = 70;"
            with self.assertRaises(SystemExit):
                aplicar_cacador(wf)

        def test_femininos_troca_so_a_lista(self):
            wf, n = aplicar_femininos(wf_falso(), linha_femininos())
            self.assertEqual(n, 1)
            js = wf["nodes"][2]["parameters"]["jsCode"]
            self.assertIn("'desentupidora'", js)
            self.assertTrue(js.startswith("const X = 1;") and js.endswith("const Y = 2;"))
            self.assertEqual(aplicar_femininos(wf, linha_femininos())[1], 0)

        def test_artigo_da_mensagem(self):
            prog = ((AQUI / "site-mensagem.js").read_text(encoding="utf-8")
                    + "\nconsole.log(JSON.stringify(['Desentupidora Rápida', 'Contabilidade Silva', 'Escritório Lima',"
                      " 'Usinagem Precisão', 'Silva Advocacia'].map(artigoDe)));")
            with tempfile.TemporaryDirectory() as d:
                arq = Path(d) / "m.js"
                arq.write_text(prog, encoding="utf-8")
                r = subprocess.run([node(), arq], capture_output=True, text=True, timeout=60)
            self.assertEqual(json.loads(r.stdout), ["da", "da", "do", "da", "do"])

        def test_plano_pausa_as_velhas_e_acrescenta_as_novas_uma_vez(self):
            cab = COLUNAS
            valores = [cab,
                       ["pousada", "-23.2178", "-44.7131", "5000", "pousada", "TRUE", "2026-09-29T06:00"],
                       ["academia", "-19.9385", "-43.9343", "3000", "fitness", "FALSE", "2026-09-18T06:00"],
                       ["desentupidora", "-22.9056", "-47.0608", "12000", "desentupidora", "TRUE", "", "", ""]]
            pausas, novas = plano_buscas(valores, "2026-10-05T20:00")
            self.assertEqual(pausas, [(2, "2026-10-05T20:00", MOTIVO_PAUSA)])
            self.assertEqual(len(novas), len(BUSCAS_NOVAS) - 1)
            self.assertTrue(all(n[5] == "TRUE" and len(n) == len(COLUNAS) for n in novas))
            # Depois de aplicado: nada a pausar (a velha já está FALSE) nem a acrescentar.
            depois = [cab, valores[1][:5] + ["FALSE", "2026-09-29T06:00", "x", "y"], valores[2], valores[3]] + novas
            self.assertEqual(plano_buscas(depois, "2026-10-05T21:00"), ([], []))

        def test_gerador_entra_antes_das_regras_e_e_idempotente(self):
            texto = "# Gerador\n\n### Regionalidade\nx\n\n### Regras do arquivo\n- Um arquivo só.\n"
            uma = aplicar_gerador(texto)
            self.assertLess(uma.index("Ramos novos"), uma.index("### Regras do arquivo"))
            self.assertEqual(aplicar_gerador(uma), uma)

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Nichos))
    return 0 if r.wasSuccessful() else 1


def testar_vivo() -> int:
    from n8n import api
    wf = aplicar_cacador(api("GET", f"/workflows/{CACADOR}"))
    js = next(n for n in wf["nodes"] if n["name"] == "Pontuar")["parameters"]["jsCode"]
    for nome, x in casos_de_pontuacao(js).items():
        print(f"{nome}: score {x['score']}, aprovado {x['aprovado']}, {x['motivo_descarte'] or 'ok'}")
        print("   " + " | ".join(x["sinais"]))
    return 0


# ------------------------------------------------------------------ aplicar

def guardar(nome: str, wf: dict) -> Path:
    BACKUPS.mkdir(parents=True, exist_ok=True)
    copia = BACKUPS / f"{nome}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    copia.write_text(json.dumps(wf, ensure_ascii=False), encoding="utf-8")
    return copia


def main() -> int:
    from n8n import api, put
    from sheets_proxy import SheetsProxy

    atual = api("GET", f"/workflows/{CACADOR}")
    novo = aplicar_cacador(atual)
    if novo["nodes"] != atual["nodes"]:
        copia = guardar("cacador", atual)
        put(novo)
        api("POST", f"/workflows/{CACADOR}/activate")  # o PUT guarda; ativar publica a versão nova
        print(f"Caçador: regra 1 e Pontuar dos ramos novos (anterior em {copia})")
    else:
        print("Caçador: já estava com a regra dos ramos novos")

    linha = linha_femininos()
    for resumo in api("GET", "/workflows?limit=200")["data"]:
        wf = api("GET", f"/workflows/{resumo['id']}")
        novo, mudou = aplicar_femininos(wf, linha)
        if mudou:
            copia = guardar("femininos-" + wf["id"], wf)
            put(novo)
            if wf.get("active"):
                api("POST", f"/workflows/{wf['id']}/activate")
            print(f"{wf['name']}: FEMININOS em {mudou} nó(s) (anterior em {copia})")

    agora = time.strftime("%Y-%m-%dT%H:%M")
    base = f"/v4/spreadsheets/{PLANILHA}"
    with SheetsProxy([PLANILHA]) as s:
        valores = s.get(f"{base}/values/Buscas!A1:Z500").get("values", [])
        cab = valores[0]
        pausas, novas = plano_buscas(valores, agora)
        letra = lambda col: chr(ord("A") + cab.index(col))
        dados = []
        for linha_n, em, motivo in pausas:
            dados.append({"range": f"Buscas!{letra('ativa')}{linha_n}", "values": [["FALSE"]]})
            dados.append({"range": f"Buscas!{letra('pausada_em')}{linha_n}", "values": [[em]]})
            dados.append({"range": f"Buscas!{letra('pausa_motivo')}{linha_n}", "values": [[motivo]]})
        if dados:
            s.post(f"{base}/values:batchUpdate", {"valueInputOption": "RAW", "data": dados})
        if novas:
            # Na ordem das colunas da aba, que pode ter coluna a mais no fim.
            linhas = [[dict(zip(COLUNAS, n)).get(c, "") for c in cab] for n in novas]
            s.post(f"{base}/values/Buscas!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {"values": linhas})
    print(f"Buscas: {len(pausas)} pausada(s), {len(novas)} nova(s) ativa(s)")

    if GERADOR.exists():
        texto = GERADOR.read_text(encoding="utf-8")
        novo_texto = aplicar_gerador(texto)
        if novo_texto != texto:
            BACKUPS.mkdir(parents=True, exist_ok=True)
            shutil.copy2(GERADOR, BACKUPS / f"auto-site-CLAUDE-{time.strftime('%Y%m%d-%H%M%S')}.md")
            GERADOR.write_text(novo_texto, encoding="utf-8")
            print("Gerador: seção dos ramos novos no ~/auto-site/CLAUDE.md")
    return 0


if __name__ == "__main__":
    if "--testar" in sys.argv:
        sys.exit(testar())
    if "--testar-vivo" in sys.argv:
        sys.exit(testar_vivo())
    sys.exit(main())
