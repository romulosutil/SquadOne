"""O documento do Mapa em HTML: 7 páginas A4, na identidade do PRUMO.

Mesma estrutura e visual do exemplo "Mapa — Distribuidora Vale Norte"
(~/prumo/05-entrega-mapa/mapa-vale-norte-documento.snapshot.html) e da
"Estrutura do documento final" do framework-mapa.md: capa, resumo executivo,
scorecard, o que passa pelo dono, onde a informação mora, as travas em reais
e a recomendação. Tokens de cor e tipografia de ~/prumo/01-marca/design-system.md.

Todo texto que não é conta nem resposta do formulário vem de dados.json;
o que faltar sai como [PREENCHER: ...] em ocre (o "campo a preencher" do
design system) e é contado.
"""
import html
import re

MARCA_RODAPE = "Rômulo Sutil Corrêa · Prumo · Espírito Santo"
FONTE_PRAZO, FONTE_PRECO = "4 a 8 semanas", "R$ 6.500"  # negocio.md: os dois formatos
POR_EXTENSO = {1: "A trava", 2: "As duas travas", 3: "As três travas", 4: "As quatro travas", 5: "As cinco travas"}
SOMANDO = {1: "A trava", 2: "Somando as duas", 3: "Somando as três", 4: "Somando as quatro", 5: "Somando as cinco"}
RISCOS_TITULO = {1: "Um risco que não entra na conta mensal", 2: "Dois riscos que não entram na conta mensal",
                 3: "Três riscos que não entram na conta mensal"}
MARCAS_INVENTARIO = {"vive": "vive", "sim": "vive", "nao_confiavel": "duvida", "parcial": "duvida",
                     "duvida": "duvida", "nao_existe": "nada", "nao": "nada", "": "nada"}

CSS = """
:root{--ferro-900:#1B1512;--ferro-800:#241D19;--ferro-700:#332A24;--ferro-600:#4A3E36;--brasa:#E0490F;
--brasa-clara:#FF6A2B;--oxido:#8A2B0C;--ocre:#E8A33D;--pedra-100:#E4DED6;--pedra-200:#CFC7BD;
--pedra-400:#9A9089;--pedra-600:#6B625B;--quente:#3A1608}
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:210mm 297mm;margin:0}
html{background:var(--pedra-200)}
body{font-family:'Archivo','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.45;color:var(--ferro-900)}
strong{font-variation-settings:'wght' 700;font-weight:700}
.pagina{width:210mm;height:297mm;margin:24px auto;background:var(--pedra-100);padding:54px 56px 40px;
display:flex;flex-direction:column;overflow:hidden;position:relative;break-after:page}
.pagina:last-child{break-after:auto}
@media print{html{background:none}.pagina{margin:0}}
.espaco{flex:1}
.brasa{color:var(--brasa)}
mark.preencher{background:var(--ocre);color:var(--ferro-900);padding:0 4px;font-variation-settings:'wght' 700;
-webkit-box-decoration-break:clone;box-decoration-break:clone}
.estourou::before{content:'PÁGINA ESTOUROU: encurte os textos desta página';position:absolute;z-index:9;top:0;left:0;right:0;
background:#c00;color:#fff;font-size:13px;padding:6px 12px;font-variation-settings:'wght' 800}
.marca{display:flex;align-items:center;gap:7px;font-variation-settings:'wdth' 118,'wght' 900;font-size:14px;letter-spacing:.02em}
.marca .fio{width:2px;height:14px;background:var(--brasa);display:block}
.topo{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:2px solid var(--ferro-900);padding-bottom:10px}
.topo .onde{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-variation-settings:'wght' 700;color:var(--pedra-600)}
h1.titulo{font-variation-settings:'wdth' 112,'wght' 800;font-size:46px;line-height:.95;letter-spacing:-.028em;margin-top:26px;font-weight:800}
.lede{font-size:15px;color:var(--ferro-600);margin-top:10px;max-width:620px}
.kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-variation-settings:'wght' 800;color:var(--oxido)}
.rotulo{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-variation-settings:'wght' 800;color:var(--ocre)}
.miudo{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--pedra-600);font-variation-settings:'wght' 700;display:block}
.barra{background:var(--pedra-200);border:2px solid var(--ferro-900);display:flex}
.barra i{display:block;background:var(--brasa)}
.rodape{display:flex;justify-content:space-between;gap:16px;border-top:2px solid var(--pedra-400);margin-top:20px;padding-top:10px;font-size:11px;color:var(--pedra-600)}
.escura{background:var(--ferro-900);color:var(--pedra-100);padding:20px 24px;display:flex;flex-direction:column;gap:10px}
.quente{background:var(--brasa);color:var(--ferro-900)}
.quente .apoio{color:var(--quente)}
.num{font-variation-settings:'wdth' 118,'wght' 900;letter-spacing:-.03em;line-height:.85}
/* capa */
.capa{background:var(--ferro-900);color:var(--pedra-100);padding:56px}
.capa .marca{font-size:20px;gap:8px}.capa .marca .fio{width:3px;height:20px}
.capa-centro{flex:1;display:flex;flex-direction:column;justify-content:center}
.capa-kicker{font-size:13px;letter-spacing:.18em;text-transform:uppercase;font-variation-settings:'wght' 800;color:var(--ocre);margin-bottom:20px}
.capa-titulo{font-variation-settings:'wdth' 118,'wght' 900;font-size:128px;line-height:.82;letter-spacing:-.035em;font-weight:900}
.capa-traco{width:132px;height:6px;background:var(--brasa);margin-top:30px}
.capa-empresa{font-size:30px;font-variation-settings:'wdth' 108,'wght' 800;line-height:1.1;letter-spacing:-.02em;margin-top:30px}
.capa-desc{font-size:16px;color:var(--pedra-200);margin-top:12px;max-width:560px}
.capa-datas{display:flex;border:2px solid var(--ferro-600)}
.capa-datas>div{flex:1;padding:18px 20px;border-right:2px solid var(--ferro-600);display:flex;flex-direction:column;gap:5px}
.capa-datas>div:last-child{border-right:0}
.capa-datas .miudo{color:var(--pedra-400);letter-spacing:.12em}
.capa-datas b{font-size:15px;font-variation-settings:'wght' 700;font-weight:700}
.capa-indice{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 26px;margin-top:20px}
.capa-indice h2{font-size:20px;font-variation-settings:'wdth' 108,'wght' 800;line-height:1.1;font-weight:800}
.capa-indice p{font-size:14px;max-width:340px}
.capa-indice .num{font-size:62px}.capa-indice .num small{font-size:24px;font-variation-settings:'wdth' 108,'wght' 800}
.capa-rodape{display:flex;justify-content:space-between;gap:16px;margin-top:20px;font-size:11px;color:var(--pedra-600);line-height:1.5}
/* resumo */
.indice-linha{display:flex;align-items:flex-end;gap:24px;margin-top:26px;border-top:2px solid var(--ferro-900);border-bottom:2px solid var(--ferro-900);padding:20px 0}
.indice-linha .num{font-size:76px;line-height:.8;color:var(--oxido)}
.indice-linha .num small{font-size:26px;font-variation-settings:'wdth' 108,'wght' 800;color:var(--ferro-900)}
.indice-linha .lado{flex:1;display:flex;flex-direction:column;gap:9px;padding-bottom:4px}
.indice-linha .lado>span{font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-variation-settings:'wght' 800}
.indice-linha .barra{height:18px}
.indice-linha .leitura{font-size:13px;color:var(--ferro-600)}
.blocos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:24px}
.bloco{display:flex;flex-direction:column;gap:7px}
.bloco .cab,.linha-score .cab{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.bloco .cab span{font-size:13px;font-variation-settings:'wght' 700}
.bloco .cab b{font-size:13px;font-variation-settings:'wght' 800;color:var(--oxido)}
.bloco .barra{height:10px}
.achados{display:flex;flex-direction:column;margin-top:14px;border-top:2px solid var(--pedra-400)}
.achado{display:flex;gap:20px;padding:18px 0;border-bottom:2px solid var(--pedra-400)}
.achado .n{font-variation-settings:'wdth' 118,'wght' 900;font-size:38px;line-height:.8;color:var(--pedra-400);min-width:44px}
.achado h3,.trava h3{font-size:19px;font-variation-settings:'wdth' 106,'wght' 700;line-height:1.2;letter-spacing:-.01em;font-weight:700}
.achado p{font-size:15px;color:var(--ferro-600);margin-top:5px}
.recomenda{border-left:6px solid var(--brasa);gap:6px}
.recomenda p{font-size:18px;font-variation-settings:'wdth' 106,'wght' 700;line-height:1.3}
/* scorecard */
.scores{display:flex;flex-direction:column;margin-top:24px;border-top:2px solid var(--ferro-900)}
.linha-score{display:flex;gap:24px;padding:13px 0;border-bottom:2px solid var(--pedra-400)}
.linha-score .esq{width:236px;flex-shrink:0;display:flex;flex-direction:column;gap:8px}
.linha-score .cab span{font-size:16px;font-variation-settings:'wdth' 106,'wght' 800}
.linha-score .cab b{font-size:16px;font-variation-settings:'wght' 900;color:var(--oxido)}
.linha-score .barra{height:12px}
.linha-score p{flex:1;font-size:14px;color:var(--ferro-700)}
.divergencia{display:flex;gap:12px;font-size:14px;line-height:1.4}
.divergencia .traco{width:10px;height:2px;background:var(--brasa);display:block;margin-top:9px;flex-shrink:0}
.divergencia span span{color:var(--pedra-200)}
.escura .nota{font-size:13px;color:var(--pedra-400);border-top:2px solid var(--ferro-600);padding-top:12px}
/* tabelas */
.tabela{display:flex;flex-direction:column;margin-top:26px;border:2px solid var(--ferro-900)}
.tabela .l{display:grid;border-bottom:2px solid var(--pedra-200);font-size:15px;align-items:center}
.tabela .l>div{padding:13px 12px}.tabela .l>div:first-child{padding-left:16px}.tabela .l>div:last-child{padding-right:16px}
.tabela .cabeca{background:var(--ferro-900);color:var(--pedra-100);font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-variation-settings:'wght' 800;border:0}
.tabela .cabeca>div{padding-top:11px;padding-bottom:11px}
.tabela .total{background:var(--pedra-200);font-variation-settings:'wght' 800;border:0}
.dep .l{grid-template-columns:minmax(0,1fr) 92px 86px 104px}
.dep .l>div:not(:first-child){text-align:right}
.dep .sim{font-variation-settings:'wght' 800;color:var(--oxido)}.dep .nao{color:var(--pedra-600)}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:2px solid var(--ferro-900);margin-top:26px}
.stats>div{padding:20px 18px;border-right:2px solid var(--ferro-900);display:flex;flex-direction:column;gap:6px}
.stats>div:last-child{border-right:0}
.stats .num{font-size:40px}.stats p{font-size:13px;color:var(--ferro-600)}.stats .quente p{color:var(--quente)}
.lembrete{border-left:6px solid var(--pedra-400);padding:4px 0 4px 18px;display:flex;flex-direction:column;gap:8px}
.lembrete p{font-size:15px;color:var(--ferro-700)}.lembrete small{font-size:13px;color:var(--pedra-600)}
.legenda{display:flex;gap:26px;align-items:center;margin-top:20px;font-size:12px;color:var(--ferro-600)}
.legenda div{display:flex;align-items:center;gap:8px}
.m{width:13px;height:13px;display:block}.m.vive{background:var(--brasa)}.m.duvida{border:2px solid var(--oxido)}
.m.nada{height:2px;background:var(--pedra-400)}
.inv{margin-top:20px}.inv .l{grid-template-columns:minmax(0,1fr) 118px 118px 118px}
.inv .l>div:not(:first-child){display:flex;justify-content:center;text-align:center}
.destaque{display:flex;border:2px solid var(--ferro-900)}
.destaque .esq{width:210px;padding:22px 20px;background:var(--ferro-900);color:var(--pedra-100);display:flex;flex-direction:column;gap:4px}
.destaque .esq .num{font-size:46px;color:var(--ocre)}.destaque .esq p{font-size:13px;color:var(--pedra-200)}
.destaque .dir{flex:1;padding:22px;display:flex;flex-direction:column;gap:8px}
.destaque h3{font-size:17px;font-variation-settings:'wdth' 106,'wght' 700;line-height:1.25;font-weight:700}
.destaque .dir p{font-size:14px;color:var(--ferro-600)}
/* travas */
.travas{display:flex;flex-direction:column;margin-top:24px;border-top:2px solid var(--ferro-900)}
.trava{display:grid;grid-template-columns:40px minmax(0,1fr) 150px;gap:16px;align-items:start;padding:16px 0;border-bottom:2px solid var(--pedra-400)}
.trava:last-child{border-bottom-color:var(--ferro-900)}
.trava .n{font-variation-settings:'wdth' 118,'wght' 900;font-size:30px;line-height:.9;color:var(--pedra-400)}
.trava .conta{font-size:13px;color:var(--pedra-600);margin-top:5px}
.trava .valor{text-align:right;font-variation-settings:'wdth' 112,'wght' 900;font-size:24px;line-height:1.1;letter-spacing:-.02em;color:var(--oxido)}
.trava .valor small,.soma small{display:block;font-size:11px;font-variation-settings:'wght' 700;color:var(--pedra-600);letter-spacing:.06em;text-transform:uppercase}
.soma{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 24px;margin-top:22px}
.soma h2{font-size:18px;font-variation-settings:'wdth' 108,'wght' 800;font-weight:800}.soma p{font-size:14px}
.soma .num{font-size:40px;white-space:nowrap;line-height:.9}.soma .num span{font-size:15px;font-variation-settings:'wdth' 108,'wght' 800}
.riscos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
.riscos b{font-variation-settings:'wdth' 112,'wght' 900;font-size:26px;line-height:1;letter-spacing:-.02em;display:block}
.riscos p{font-size:13px;color:var(--pedra-200);margin-top:5px}
/* recomendação */
.acoes{display:flex;flex-direction:column;margin-top:12px;border-top:2px solid var(--ferro-900)}
.acao{display:grid;grid-template-columns:minmax(0,1fr) 168px;gap:16px;align-items:center;padding:12px 0;border-bottom:2px solid var(--pedra-400)}
.acao:last-child{border-bottom-color:var(--ferro-900)}
.acao>p{font-size:16px}.acao>div{font-size:13px;color:var(--ferro-600);text-align:right}
.acao>div b{color:var(--oxido);font-variation-settings:'wght' 700;font-weight:400}
.resumo-acoes{font-size:15px;color:var(--ferro-700);margin-top:14px;border-left:6px solid var(--brasa);padding:2px 0 2px 16px}
.fonte{border:2px solid var(--ferro-900);margin-top:12px;padding:16px 20px;display:flex;flex-direction:column;gap:10px}
.fonte h3{font-size:18px;font-variation-settings:'wdth' 106,'wght' 700;line-height:1.25;font-weight:700}
.fonte p{font-size:15px;color:var(--ferro-700)}
.fonte .fatos{display:flex;border:2px solid var(--pedra-400);margin-top:4px}
.fonte .fatos>div{flex:1;padding:10px 14px;border-right:2px solid var(--pedra-400);font-size:15px;font-variation-settings:'wght' 700}
.fonte .fatos>div:last-child{border-right:0;flex:1.4}
.nao-agora h3{font-size:17px;font-variation-settings:'wdth' 106,'wght' 700;line-height:1.25;font-weight:700}
.nao-agora p{font-size:14px;color:var(--pedra-200)}
.agenda{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:2px solid var(--ferro-900);margin-top:18px}
.agenda>div{padding:14px 18px;border-right:2px solid var(--ferro-900);display:flex;flex-direction:column;gap:3px;font-size:15px;font-variation-settings:'wght' 700}
.agenda>div:last-child{border-right:0}.agenda .quente .miudo{color:var(--quente)}
"""

VERIFICAR_ESTOURO = """<script>
addEventListener('load', () => (document.fonts ? document.fonts.ready : Promise.resolve()).then(() =>
  document.querySelectorAll('.pagina').forEach(p => { if (p.scrollHeight > p.clientHeight + 1) p.classList.add('estourou'); })));
</script>"""


class Documento:
    def __init__(self, dados: dict, calc: dict):
        self.d, self.c = dados, calc
        self.preencher = 0
        self.empresa = str(dados.get("empresa") or "").strip()

    # --- texto
    def ph(self, dica: str) -> str:
        self.preencher += 1
        return f'<mark class="preencher">[PREENCHER{": " + e(dica) if dica else ""}]</mark>'

    @staticmethod
    def q() -> str:
        """Valor que sai da conta quando os campos dela estiverem preenchidos."""
        return '<mark class="preencher">?</mark>'

    def txt(self, valor, dica: str) -> str:
        return rico(valor) if valor not in (None, "") else self.ph(dica)

    # --- peças repetidas
    def topo(self, n: int) -> str:
        return (f'<div class="topo">{MARCA}<div class="onde">O Mapa · {e(self.empresa) or self.ph("empresa")} · '
                f'{n:02d}</div></div>')

    def rodape(self, esquerda: str) -> str:
        mes = (self.d.get("datas") or {}).get("documento")
        return f'<div class="rodape"><span>{esquerda}</span><span>{self.txt(mes, "mês")}</span></div>'

    # --- páginas
    def capa(self) -> str:
        d, c = self.d, self.c
        datas = d.get("datas") or {}
        desc = [rico(x) for x in d.get("descricao") or [] if x]
        if not desc:
            local = " · ".join(e(x) for x in (d.get("segmento"), d.get("cidade")) if x)
            desc = [local or self.ph("segmento · cidade"), self.ph("nº de pessoas · unidades · equipe")]
        devolutiva = datas.get("devolutiva")
        cel = [("Coleta", self.txt(datas.get("coleta"), "datas")), ("Análise", self.txt(datas.get("analise"), "datas")),
               ("Devolutiva", f"{e(devolutiva)} · 90 min" if devolutiva else self.ph("data"))]
        fatos = [plural(c["pessoas"], "pessoa ouvida", "pessoas ouvidas"),
                 plural(len(c["final"]), "ponto verificado", "pontos verificados")]
        if not c["so_dono"]:
            fatos.append(plural(len(c["divergencias"]), "divergência", "divergências") + " entre o dono e o time")
        return f"""<section class="pagina capa">
  <div class="marca">{MARCA_MIOLO}</div>
  <div class="capa-centro">
    <div class="capa-kicker">Diagnóstico de estrutura e decisão</div>
    <h1 class="capa-titulo">O MAPA</h1>
    <div class="capa-traco"></div>
    <div class="capa-empresa">{e(self.empresa) or self.ph("empresa")}</div>
    <div class="capa-desc">{"<br>".join(desc)}</div>
  </div>
  <div class="capa-datas">{"".join(f'<div><span class="miudo">{k}</span><b>{v}</b></div>' for k, v in cel)}</div>
  <div class="capa-indice quente">
    <div><h2>Índice do Prumo</h2><p class="apoio">Quanto mais alto, menos a empresa depende de você para funcionar.</p></div>
    <div class="num">{indice(c["indice"])}<small>/18</small></div>
  </div>
  <div class="capa-rodape"><span>{" · ".join(fatos)}</span><span>Documento confidencial · Rômulo Sutil Corrêa</span></div>
</section>"""

    def resumo(self) -> str:
        d, c = self.d, self.c
        blocos = "".join(f"""<div class="bloco"><div class="cab"><span>{e(b["nome"])}</span><b>{nota(b["nota"])}</b></div>
      <div class="barra">{barra(b["nota"], 3)}</div></div>""" for b in c["blocos"])
        achados = list(d.get("achados") or [])[:3]
        achados += [None] * (3 - len(achados))
        linhas = "".join(f"""<div class="achado"><div class="n">{i:02d}</div><div>
      <h3>{self.txt((a or {}).get("titulo"), f"achado {i}")}</h3><p>{self.txt((a or {}).get("texto"), "o fato, com o número")}</p></div></div>"""
                         for i, a in enumerate(achados, 1))
        total = c["total_mes"]
        rod = f"Travas mapeadas custam {brl(total) if total is not None else self.q()} por mês"
        return f"""<section class="pagina">
  {self.topo(1)}
  <h1 class="titulo">Resumo executivo</h1>
  <div class="indice-linha">
    <div class="num">{indice(c["indice"])}<small>/18</small></div>
    <div class="lado"><span>Índice do Prumo</span><div class="barra">{barra(c["indice"], 18)}</div>
      <div class="leitura">{self.txt(d.get("leitura_indice"), "leitura do Índice; as bandas ainda não foram definidas (pendências P3)")}</div></div>
  </div>
  <div class="blocos">{blocos}</div>
  <div class="kicker" style="margin-top:34px">Os três achados que mais pesam</div>
  <div class="achados">{linhas}</div>
  <div class="espaco"></div>
  <div class="escura recomenda"><div class="rotulo">Recomendação</div>
    <p>{self.txt(d.get("recomendacao_resumo"), "a recomendação em uma frase; detalhe na página 06")}</p></div>
  {self.rodape(rod)}
</section>"""

    def scorecard(self) -> str:
        d, c = self.d, self.c
        textos = d.get("scorecard") or {}
        linhas = []
        for b in c["blocos"]:
            hoje = []
            for i in b["ids"]:
                votos = c["votos"].get(i) or []
                if votos:
                    v = min(votos, key=lambda x: x["nota"])
                    if v["resposta"]:
                        hoje.append(f"“{v['resposta']}” ({i})")
            dica = "o que falta neste bloco" + (" — hoje: " + " · ".join(hoje) if hoje else "")
            linhas.append(f"""<div class="linha-score"><div class="esq"><div class="cab"><span>{e(b["nome"])}</span><b>{nota(b["nota"])}</b></div>
      <div class="barra">{barra(b["nota"], 3)}</div></div><p>{self.txt(textos.get(b["chave"]), dica)}</p></div>""")
        sob = d.get("divergencias_texto") or {}
        if c["divergencias"]:
            itens = []
            for dv in c["divergencias"]:
                papeis = sorted({v["papel"] for v in dv["time"]})
                auto = (f"Você respondeu {fala(dv['dono'])}. {juntar(papeis)} "
                        f"{'responderam' if len(papeis) > 1 else 'respondeu'} {fala(dv['time'][0])}.")
                itens.append(f"""<div class="divergencia"><span class="traco"></span><span><strong>{e(dv["tema"])}.</strong>
        <span>{rico(sob.get(dv["id"])) if sob.get(dv["id"]) else e(auto)}</span></span></div>""")
            miolo = ("".join(itens) + '<div class="nota">Quando as versões diferem, a nota fica com a menor. A divergência '
                     "costuma valer mais que a nota: prova que a regra existe, mas não chegou a quem executa.</div>")
        elif c["so_dono"]:
            miolo = ('<div class="divergencia"><span class="traco"></span><span><span>Só o dono respondeu até aqui: '
                     "nenhum ponto teve uma segunda fonte para cruzar.</span></span></div>")
        else:
            miolo = ('<div class="divergencia"><span class="traco"></span><span><span>Nos pontos que você e o time '
                     "responderam, as notas bateram.</span></span></div>")
        entrevistas = plural(c["pessoas"], "entrevista", "entrevistas")
        rod = f"{plural(len(c['final']), 'ponto verificado', 'pontos verificados')} em {entrevistas}"
        if c["coletas"]:
            rod += f" e {plural(c['coletas'], 'conferência direta', 'conferências diretas')} nos dados"
        return f"""<section class="pagina">
  {self.topo(2)}
  <h1 class="titulo">Scorecard</h1>
  <div class="lede" style="max-width:600px">Cada bloco vale de 0 a 3. <strong>0</strong> não existe · <strong>1</strong> existe só na cabeça de alguém · <strong>2</strong> está escrito, mas não é seguido · <strong>3</strong> está escrito, é seguido, tem dono e data de revisão.</div>
  <div class="scores">{"".join(linhas)}</div>
  <div class="espaco"></div>
  <div class="escura" style="gap:12px"><div class="rotulo">Onde você e o time não contam a mesma história</div>{miolo}</div>
  {self.rodape(rod)}
</section>"""

    def dependencia(self) -> str:
        d, c = self.d, self.c
        dep = d.get("dependencia") or {}
        linhas = c["dependencia"]
        corpo = []
        for l in linhas:
            deleg = l.get("delegavel")
            if l["por_semana"] is None or l["minutos"] is None or deleg not in (True, False):
                self.preencher += 1
            dcel = ('<div class="sim">Sim</div>' if deleg is True else '<div class="nao">Ainda não</div>' if deleg is False
                    else f"<div>{self.q()}</div>")
            corpo.append(f"""<div class="l"><div>{self.txt(l.get("decisao"), "decisão")}</div>
      <div style="font-variation-settings:'wght' 700">{inteiro(l["por_semana"]) if l["por_semana"] is not None else self.q()}</div>
      <div style="color:var(--ferro-600)">{inteiro(l["minutos"]) if l["minutos"] is not None else self.q()}</div>{dcel}</div>""")
        if not corpo:
            corpo.append(f'<div class="l"><div>{self.ph("decisões que chegam ao dono, por semana")}</div><div></div><div></div><div></div></div>')
        t = c["dependencia_total"]
        if t:
            total = (f'<div class="l total"><div>Total</div><div>{inteiro(t["n"])}</div><div>{decimal(t["horas"])} h</div>'
                     f'<div style="color:var(--oxido)">{inteiro(t["delegaveis"])}</div></div>')
            stats = (f'<div><div class="num">{decimal(t["horas"])} h</div><p>por semana suas, decidindo operação</p></div>'
                     f'<div><div class="num" style="color:var(--oxido)">{round(t["pct"])}%</div>'
                     "<p>poderiam sair da sua mesa hoje, se o critério estivesse escrito</p></div>"
                     f'<div class="quente"><div class="num">{decimal(t["sobra"])} h</div>'
                     f'<p>é o que sobraria na sua semana, no lugar de {decimal(t["horas"])}</p></div>')
            cada = f"Cada uma das {inteiro(t['delegaveis'])}"
        else:
            total = f'<div class="l total"><div>Total</div><div>{self.q()}</div><div>{self.q()}</div><div>{self.q()}</div></div>'
            stats = "".join(f'<div><div class="num">{self.q()}</div><p>{p}</p></div>' for p in (
                "horas por semana suas, decidindo operação", "poderiam sair da sua mesa, com critério escrito",
                "é o que sobraria na sua semana"))
            cada = "Cada uma delas"
        tempo = [str(i) for i, tv in enumerate(c["travas"], 1) if tv.get("formula") == "tempo_dono" and tv["valor"] is not None]
        ligacao = ""
        if tempo:
            quais = f"na trava {tempo[0]}" if len(tempo) == 1 else f"nas travas {juntar(tempo)}"
            ligacao = f"<small>O custo em reais dessas horas já está contado {quais} da página 05 — não some as duas coisas.</small>"
        vh, pl = c["valor_hora_dono"], d.get("pro_labore_dono")
        if vh is not None and pl not in (None, ""):
            rod = f"Valor-hora considerado: {brl(vh)} (pró-labore de {brl(pl)} ÷ 160 h)"
        elif vh is not None:
            rod = f"Valor-hora considerado: {brl(vh)}"
        else:
            rod = self.ph("valor-hora do dono: pro_labore_dono ou valor_hora_dono")
        return f"""<section class="pagina">
  {self.topo(3)}
  <h1 class="titulo">O que passa por você</h1>
  <div class="lede">{self.txt(dep.get("nota"), "como a contagem foi feita (dias de coleta, WhatsApp, ligações, entrevistas)")}</div>
  <div class="tabela dep">
    <div class="l cabeca"><div>Decisão que chega até você</div><div>Por semana</div><div>Min cada</div><div>Delegável</div></div>
    {"".join(corpo)}{total}
  </div>
  <div class="stats">{stats}</div>
  <div class="espaco"></div>
  <div class="lembrete"><p><strong>Delegável não é questão de confiança.</strong> {cada} sai da sua mesa no dia em que o critério estiver escrito, publicado e com um teto claro. Sem isso, contratar mais gente só aumenta a fila na sua porta.</p>{ligacao}</div>
  {self.rodape(rod)}
</section>"""

    def inventario(self) -> str:
        inv = self.d.get("inventario") or {}
        corpo = []
        for l in inv.get("linhas") or []:
            celulas, falta = [], False
            for k in ("sistema", "planilha", "cabeca"):
                v = l.get(k)
                if v is None:
                    falta = True
                    celulas.append('<div><mark class="preencher">?</mark></div>')
                else:
                    celulas.append(f'<div><span class="m {MARCAS_INVENTARIO.get(str(v).strip().lower(), "nada")}"></span></div>')
            if falta:
                self.preencher += 1
            corpo.append(f'<div class="l"><div>{self.txt(l.get("informacao"), "informação")}</div>{"".join(celulas)}</div>')
        if not corpo:
            corpo.append(f'<div class="l"><div>{self.ph("informações do dia a dia")}</div><div></div><div></div><div></div></div>')
        de = inv.get("destaque") or {}
        destaque = f"""<div class="destaque">
    <div class="esq"><div class="num">{e(de["numero"]) if de.get("numero") not in (None, "") else self.q()}</div><p>{self.txt(de.get("legenda"), "ex.: planilhas circulando")}</p></div>
    <div class="dir"><h3>{self.txt(de.get("titulo"), "o que isso quer dizer")}</h3><p>{self.txt(de.get("texto"), "o efeito na operação")}</p></div>
  </div>"""
        return f"""<section class="pagina">
  {self.topo(4)}
  <h1 class="titulo">Onde a informação mora</h1>
  <div class="lede">Para cada informação que a operação precisa todo dia, onde ela realmente está — e não onde deveria estar.</div>
  <div class="legenda"><div><span class="m vive"></span>É aqui que ela vive</div><div><span class="m duvida"></span>Existe, mas não dá para confiar</div><div><span class="m nada"></span>Não existe</div></div>
  <div class="tabela inv">
    <div class="l cabeca"><div>Informação</div><div>Sistema</div><div>Planilha</div><div>Sua cabeça</div></div>
    {"".join(corpo)}
  </div>
  <div class="espaco"></div>
  {destaque}
  {self.rodape(self.txt(inv.get("fonte"), "de onde saiu o levantamento (exports, planilhas, semana)"))}
</section>"""

    def travas(self) -> str:
        d, c = self.d, self.c
        travas = c["travas"] or [{"formula": None, "valor": None}] * 5
        linhas = []
        for i, t in enumerate(travas, 1):
            dica_t = "título da trava" + (f" ({t['id']} · {IDS_TEMA.get(t['id'], '')})" if t.get("id") else "")
            conta = t.get("conta") or conta_auto(t, d, c)
            dica_c = "a conta" + (f"; formulário: {t['resposta_do_formulario']}" if t.get("resposta_do_formulario") else "")
            valor = (f"{brl(t['valor'])}<small>por mês</small>" if t.get("valor") is not None else self.q())
            linhas.append(f"""<div class="trava"><div class="n">{i}</div><div><h3>{self.txt(t.get("titulo"), dica_t)}</h3>
      <div class="conta">{rico(conta) if conta else self.ph(dica_c)}</div></div><div class="valor">{valor}</div></div>""")
        total = c["total_mes"]
        preco = d.get("preco_mapa")
        if total is not None:
            soma = (f'<div><h2>{SOMANDO.get(len(travas), "Somando as travas")}</h2>'

                    f'<p class="apoio">{brl(total * 12)} por ano. Este diagnóstico custou '
                    f'{brl(preco) if preco not in (None, "") else self.ph("preço do Mapa")}.</p></div>'
                    f'<div class="num">{brl(total)}<span>/mês</span></div>')
        else:
            soma = ('<div><h2>Somando as travas</h2><p class="apoio">Sai da conta quando as travas tiverem valor '
                    f'(o anual é o mensal arredondado × 12).</p></div><div class="num">{self.q()}</div>')
        riscos = [r for r in d.get("riscos") or [] if r is not None]
        bloco_riscos = ""
        if riscos:
            itens = "".join(f'<div><b>{brl(r["valor"]) if r.get("valor") not in (None, "") else self.ph("R$")}</b>'
                            f'<p>{self.txt(r.get("texto"), "o risco" + (" (" + r["id"] + ")" if r.get("id") else ""))}</p></div>'
                            for r in riscos[:4])
            titulo = RISCOS_TITULO.get(len(riscos), "Riscos que não entram na conta mensal")
            bloco_riscos = f'<div class="escura" style="padding:22px 26px;gap:14px"><div class="rotulo">{titulo}</div><div class="riscos">{itens}</div></div>'
        return f"""<section class="pagina">
  {self.topo(5)}
  <h1 class="titulo">{POR_EXTENSO.get(len(travas), "As travas")}, em reais</h1>
  <div class="lede">Estimativas conservadoras, com a conta aberta embaixo de cada uma. Se algum número da conta estiver errado, corrija na devolutiva e o valor se ajusta.</div>
  <div class="travas">{"".join(linhas)}</div>
  <div class="soma quente">{soma}</div>
  <div class="espaco"></div>
  {bloco_riscos}
  {self.rodape("Nenhuma estimativa usa ganho de venda futura — só perda que já está acontecendo")}
</section>"""

    def recomendacao(self) -> str:
        d = self.d
        r = d.get("recomendacao") or {}
        datas = d.get("datas") or {}
        acoes = r.get("primeiro") or [{}]
        linhas = "".join(f"""<div class="acao"><p>{self.txt(a.get("acao"), "o que o dono resolve sozinho, antes de contratar qualquer coisa")}</p>
      <div>{self.txt(a.get("quem"), "quem")}<br><b>{self.txt(a.get("efeito"), "que trava resolve")}</b></div></div>""" for a in acoes)
        dep = r.get("depois") or {}
        formato = str(dep.get("formato") or "").strip().lower()
        if formato in ("ia", "simplificada"):
            kicker = "Depois · a Fonte, no formato com IA" if formato == "ia" else "Depois · a Fonte Simplificada"
            terceiro = (("Custo de uso da IA", "pago por você, direto ao provedor") if formato == "ia"
                        else ("Formato", "Notion (ou equivalente)"))
            fatos = "".join(f'<div><span class="miudo">{k}</span>{e(v)}</div>' for k, v in (
                ("Prazo", dep.get("prazo") or FONTE_PRAZO), ("Investimento", dep.get("investimento") or FONTE_PRECO), terceiro))
            titulo_padrao = "O conhecimento da empresa fora da sua cabeça, num lugar que responde perguntas."
            fonte = f"""<div class="fonte"><h3>{rico(dep.get("titulo") or titulo_padrao)}</h3>
    <p>{self.txt(dep.get("texto"), "por que este formato, com o número que justifica")}</p><div class="fatos">{fatos}</div></div>"""
        elif formato:
            kicker = "Depois · ainda não é hora da Fonte"
            fonte = f"""<div class="fonte"><h3>{self.txt(dep.get("titulo"), "por que não seguir agora")}</h3>
    <p>{self.txt(dep.get("texto"), "o que precisa mudar antes")}</p></div>"""
        else:
            kicker = "Depois · " + self.ph("Fonte com IA, Fonte Simplificada ou ainda não")
            fonte = f'<div class="fonte"><p>{self.ph("formato em dados.json: recomendacao.depois.formato = ia | simplificada | ainda_nao")}</p></div>'
        nao = r.get("nao_recomendado")
        bloco_nao = ""
        if nao is not False:
            nao = nao or {}
            bloco_nao = f"""<div class="escura nao-agora" style="padding:18px 22px;gap:6px"><div class="rotulo">O que eu não recomendo agora</div>
    <h3>{self.txt(nao.get("titulo"), "o que não fazer")}</h3><p>{self.txt(nao.get("texto"), "por quê")}</p></div>"""
        agenda = r.get("agenda") or [
            {"quando": datas.get("devolutiva"), "o_que": "Devolutiva de 90 min"},
            {"quando": datas.get("decisao"), "o_que": "Você decide se segue"},
            {"quando": datas.get("inicio"), "o_que": "Começo da Fonte"},
        ]
        cel = "".join(f'<div class="{"quente" if i == len(agenda) - 1 else ""}"><span class="miudo">{self.txt(a.get("quando"), "data")}</span>'
                      f'{self.txt(a.get("o_que"), "o quê")}</div>' for i, a in enumerate(agenda[:3]))
        return f"""<section class="pagina">
  {self.topo(6)}
  <h1 class="titulo" style="margin-top:22px">O que fazer com isso</h1>
  <div class="kicker" style="margin-top:22px">{e(r.get("primeiro_titulo") or "Primeiro · duas semanas · sem mim")}</div>
  <div class="acoes">{linhas}</div>
  <div class="resumo-acoes">{self.txt(r.get("resumo"), "quanto isso devolve por mês e quanto risco tira — sem somar os dois")}</div>
  <div class="kicker" style="margin-top:22px">{kicker}</div>
  {fonte}
  <div class="espaco"></div>
  {bloco_nao}
  <div class="agenda">{cel}</div>
  {self.rodape(MARCA_RODAPE)}
</section>"""


IDS_TEMA = {}  # preenchido por documento() com os temas do método


def documento(dados: dict, calc: dict, fonte_b64: str | None, ids_tema: dict | None = None) -> tuple[str, int]:
    """HTML completo e quantos [PREENCHER] ficaram."""
    if ids_tema:
        IDS_TEMA.update(ids_tema)
    doc = Documento(dados, calc)
    paginas = [doc.capa(), doc.resumo(), doc.scorecard(), doc.dependencia(), doc.inventario(), doc.travas(),
               doc.recomendacao()]
    if fonte_b64:
        fonte = ("@font-face{font-family:'Archivo';font-style:normal;font-weight:400 900;font-stretch:62% 125%;"
                 f"src:url(data:font/woff2;base64,{fonte_b64}) format('woff2')}}")
        link = ""
    else:
        fonte = ""
        link = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900'
                '&display=swap">')
    titulo = f"O Mapa — {doc.empresa}" if doc.empresa else "O Mapa"
    return (f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(titulo)}</title>
{link}<style>{fonte}{CSS}</style>
</head>
<body>
{chr(10).join(paginas)}
{VERIFICAR_ESTOURO}
</body>
</html>
""", doc.preencher)


# ------------------------------------------------------------------ formatação

MARCA = '<div class="marca"><span class="fio"></span><span>PRU<span class="brasa">MO</span></span></div>'
MARCA_MIOLO = '<span class="fio"></span><span>PRU<span class="brasa">MO</span></span>'


def e(x) -> str:
    return html.escape(str(x), quote=False) if x is not None else ""


def rico(x) -> str:
    """Texto do dados.json: escapa e aceita **negrito**."""
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", e(x))


def num(x):
    """Número de um campo que o Rômulo preenche: aceita 12, 12.5, "12,5"; vazio = None."""
    if x is None or x == "":
        return None
    if isinstance(x, bool):
        raise ValueError(f"número esperado, veio {x!r}")
    if isinstance(x, (int, float)):
        return x
    t = str(x).strip().replace("R$", "").replace("%", "").strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", t):
        t = t.replace(".", "")
    return float(t.replace(",", "."))


def milhar(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def brl(v) -> str:
    v = num(v)
    if v is None:
        return "R$ ?"
    if abs(v - round(v)) < 0.005:
        return f"R$ {milhar(int(round(v)))}"
    inteiro_, frac = f"{v:.2f}".split(".")
    return f"R$ {milhar(int(inteiro_))},{frac}"


def decimal(v, casas: int = 1) -> str:
    return f"{v:.{casas}f}".replace(".", ",")


def inteiro(v) -> str:
    return milhar(int(v)) if float(v).is_integer() else decimal(v)


def nota(v) -> str:
    return "?" if v is None else decimal(v)


def indice(v) -> str:
    return "?" if v is None else decimal(v)


def barra(v, maximo) -> str:
    pct = 0 if v is None else max(0.0, min(100.0, v / maximo * 100))
    return f'<i style="width:{pct:.1f}%"></i>'


def plural(n: int, um: str, varios: str) -> str:
    return f"{n} {um if n == 1 else varios}"


def fala(voto: dict) -> str:
    return f"“{voto['resposta']}”" if voto.get("resposta") else f"nota {voto['nota']}"


def juntar(itens: list[str]) -> str:
    itens = list(itens)
    return itens[0] if len(itens) == 1 else ", ".join(itens[:-1]) + " e " + itens[-1]


def conta_auto(t: dict, d: dict, c: dict) -> str | None:
    """A conta aberta de uma trava, a partir dos campos da fórmula."""
    f = t.get("formula")
    if t.get("valor") is None:
        return None
    if f == "tempo_dono":
        vh = num(t.get("valor_hora")) or c["valor_hora_dono"]
        return f"{inteiro(num(t['por_semana']))} por semana · {inteiro(num(t['minutos']))} minutos cada · {brl(vh)} a sua hora"
    if f == "margem":
        return (f"{brl(t['base_mes'])} por mês · {decimal(num(t['fracao_pct'])).replace(',0', '')}% · "
                f"{decimal(num(t['taxa_pct'])).replace(',0', '')}%")
    if f == "retrabalho":
        vh = num(t.get("valor_hora")) or num(d.get("valor_hora_time"))
        if num(t.get("por_trimestre")) is not None and num(t.get("por_mes")) is None:
            n = f"{inteiro(num(t['por_trimestre']))} no último trimestre"
        else:
            n = f"{inteiro(num(t['por_mes']))} por mês"
        return f"{n} · {inteiro(num(t['minutos']))} minutos cada · {inteiro(num(t['pessoas']))} pessoas · {brl(vh)} a hora média"
    return None
