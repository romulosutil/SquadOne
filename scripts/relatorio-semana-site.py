"""Renderiza o resumo agregado da campanha, sem ler conversas ou credenciais."""
import html
import json
from pathlib import Path
import sys


def gerar(pasta, plano):
    pasta = Path(pasta)
    resumo = json.loads((pasta / 'resumo.json').read_text(encoding='utf-8-sig'))
    semana = json.loads(Path(plano).read_text(encoding='utf-8-sig'))
    e = lambda v: html.escape(str(v))
    linhas = ''.join(
        f'<tr><td>{e(d["data"][8:])}/11</td><td>{e(d["acao"])}</td>'
        f'<td>{e(d.get("metaContatos", "Preparação"))}</td>'
        f'<td>{e(d.get("metaAcumulada", "—"))}</td></tr>'
        for d in semana['dias']
    )
    avisos = ''.join(f'<li>{e(v)}</li>' for v in resumo.get('observacoes', []))
    reservas = ''.join(
        f'<tr><td>{e(r["empresa"])}</td><td>{e(r["menorNota"])}/100</td>'
        f'<td>{e(", ".join(p["agente"] + ": " + str(p["nota"]) for p in r["pareceres"]))}</td></tr>'
        for r in resumo.get('reservas', [])
    )
    bloco_reservas = (f'<h2>Cinco reservas preparadas no domingo</h2>'
        f'<p>Mesmos critérios dos principais: fontes gratuitas, destino único, histórico limpo e três notas de pelo menos 65. Entram após os principais disponíveis; a meta continua sendo 60 contatos.</p>'
        f'<table><thead><tr><th>Empresa</th><th>Menor nota</th><th>Pareceres reais</th></tr></thead><tbody>{reservas}</tbody></table>') if reservas else ''
    documento = f'''<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Site/Encontrado · 2 a 6 de novembro</title>
<style>
body{{font:16px/1.55 system-ui,sans-serif;margin:0;background:#f4f6f8;color:#18252e}}
main{{max-width:1080px;margin:36px auto;padding:28px;background:white;border-radius:16px}}
h1{{line-height:1.15}}small{{color:#52636e}}.numeros{{display:flex;gap:16px;flex-wrap:wrap}}
.numero{{flex:1;min-width:180px;background:#eef5f2;border-radius:10px;padding:16px}}
.numero b{{display:block;font-size:32px;color:#17664d}}
table{{border-collapse:collapse;width:100%;margin:24px 0}}th,td{{text-align:left;vertical-align:top;padding:14px 10px;border-bottom:1px solid #dce3e7}}
th{{background:#eef2f5}}ul{{padding-left:22px}}.status{{padding:16px;background:#fff7dc;border-radius:10px}}
@media(max-width:650px){{main{{margin:0;padding:20px;border-radius:0}}table{{font-size:14px}}td,th{{padding:10px 5px}}}}
</style><main>
<small>Preparado em 1/11/2026 · São Paulo · Evidências em {e(resumo['verificadoEm'])}</small>
<h1>Site/Encontrado<br>Semana de 2 a 6 de novembro</h1>
<p>{e(resumo['status'])}</p>
<div class="numeros">
<div class="numero"><b>{e(resumo['aprovados'])}</b>candidatos com três aprovações comerciais</div>
<div class="numero"><b>60</b>meta de primeiros contatos confirmados</div>
<div class="numero"><b>3</b>meta de fechamentos da nova coorte</div>
</div>
<p>Nove pendências revisadas: cinco sem resposta e quatro respostas automáticas ou padronizadas. Histórico preservado, sem recontato.</p>
<p>Os 23 candidatos faltantes foram pesquisados gratuitamente. Cada envio depende de evidência válida, contato único, histórico limpo e três notas de pelo menos 65.</p>
{bloco_reservas}
<table><thead><tr><th>Dia</th><th>Execução</th><th>Contatos</th><th>Acumulado</th></tr></thead><tbody>{linhas}</tbody></table>
<p>Revisões às <strong>07h40, 12h40 e 18h40</strong>: conferir o que saiu, identificar qualidade e perdas confirmadas e refinar o próximo dia. Silêncio e robô permanecem pendentes.</p>
<p class="status">Pesquisa e enriquecimento: custo zero. Consultas pagas bloqueadas, inclusive no Raio-X local. Silmer mantém IA e transcrição.</p>
<h2>O que está automatizado</h2>
<p>Pesquisa e higiene no n8n às 07h10, 12h10 e 18h10, de segunda a sexta; executor de primeiro contato na Mel; prioridade dos principais e substituição por reservas aprovadas; revisões pelo agente agendadas às 07h40, 12h40 e 18h40. As rotinas dependem dos serviços e conexões disponíveis e interrompem o envio quando uma proteção falha.</p>
<p><strong>Atendimento humano:</strong> respostas de clientes, propostas e negociação continuam com Rômulo. Fechamento exige aceite e pagamento/sinal reais. A operação não é um vendedor autônomo de ponta a ponta.</p>
<ul>{avisos}</ul>
<p><small>Limites: 15 primeiros contatos/dia, 2/hora, intervalo de 30 minutos e dez pendências por rodada. Novas rodadas exigem revisão concreta. Os envios começam em 3/11; 2/11 é preparação interna no feriado. Metas futuras não são resultados já alcançados.</small></p>
</main></html>'''
    (pasta / 'relatorio.html').write_text(documento, encoding='utf-8')


if __name__ == '__main__':
    gerar(sys.argv[1], sys.argv[2])
