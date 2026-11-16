"""Relatório local revisável; sem publicar dados ou buscar conteúdo na rede."""
import datetime as dt
import html
import json
from pathlib import Path
import sys


def gerar(base, plano):
    base=Path(base);p=json.loads(Path(plano).read_text(encoding='utf-8-sig'))
    v=json.loads((base/'verificacao-final.json').read_text(encoding='utf-8-sig'));s=v['resumo']
    h=json.loads((base/'higiene.json').read_text(encoding='utf-8-sig'))
    names={r['id']:r['empresa'] for r in h['leads']+h['descoberta']};e=lambda x:html.escape(str(x or ''))
    def link(url,label):return '<a rel="noreferrer" href="'+e(url)+'">'+e(label)+'</a>' if str(url).startswith(('https://','http://')) else e(label)
    rows=[]
    for ident,r in sorted(h['evidencias'].items(),key=lambda kv:(kv[1]['produto'],names.get(kv[0],''))):
        page=r.get('pagina',{});cnpj=r.get('cnpj',{})
        cadastro=('Confirmado e associado' if cnpj.get('vinculoConfirmado') else 'Cadastro obtido; vínculo a conferir') if cnpj else 'A localizar / conferir'
        refs=' · '.join(link(x.get('url'),x.get('tipo')) for x in r.get('fontes',[]))
        rows.append('<tr><td>'+e(r['produto'])+'</td><td>'+e(names.get(ident,ident))+'</td><td>'+e(page.get('estado','Site a localizar'))+'</td><td>'+e(cadastro)+'</td><td>'+e('; '.join(r.get('pendencias',[])) or 'Sem pendência técnica registrada; necessidade comercial não confirmada')+'</td><td>'+refs+'</td></tr>')
    daily=''.join('<tr><td>'+e(d['data'][8:]+'/11')+'</td><td>'+e(', '.join(d['responsaveis']))+'</td><td>'+e(d['acao'])+'</td><td>'+e(d['entrega'])+'</td></tr>' for d in p['dias'])
    market=''.join('<li>'+link(m['consulta'],m['produto'].upper()+' — '+', '.join(m['termos']))+'</li>' for m in p['mercado'])
    metas=p.get('metas',{})
    ciclo=''
    if metas:
        ciclo='<div class="notice"><b>Meta: '+e(metas.get('contatosUnicosComEnvioConfirmado'))+' contatos únicos confirmados e '+e(metas.get('fechamentosNaCoorte'))+' fechamentos dessa coorte.</b><p>'+e(p.get('limites'))+'</p><p>'+e(p.get('foco'))+'</p><p>Terça a sexta: disparar, conferir destinatário/texto/recibo, identificar refinamentos, leads de qualidade, perdas confirmadas e pendências. Silêncio e robô não são perda.</p><p>'+e(metas.get('janelaConversao'))+'</p><p>'+e(p.get('politicaCusto'))+'</p></div>'
    date=dt.datetime.fromisoformat(s['geradoEm']).astimezone(dt.timezone(dt.timedelta(hours=-3))).strftime('%d/%m/%Y às %Hh%M')
    content=f'''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prumo · Semana de 2 a 6/11</title>
<style>body{{font:16px/1.55 system-ui,sans-serif;background:#f7f5f0;color:#243333;margin:0}}main{{max-width:1240px;margin:auto;padding:40px 24px}}h1{{font-size:36px;line-height:1.15}}h2{{margin-top:40px}}.muted{{color:#596868}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}}.card{{background:white;padding:20px;border:1px solid #d8dfd8;border-radius:12px}}.card b{{display:block;font-size:30px}}table{{border-collapse:collapse;width:100%;font-size:14px;background:white}}th,td{{padding:12px;vertical-align:top;border-bottom:1px solid #dce1da;text-align:left}}th{{background:#e8ede4}}.scroll{{overflow:auto}}a{{color:#21654e}}.notice{{background:#ece7d8;padding:18px;border-radius:10px}}input{{font:inherit;padding:10px;width:min(480px,90%);margin:14px 0}}</style>
<main><p class="muted">PRUMO · Operação preparada em {e(date)}</p><h1>Uma fila explicável.<br>Uma semana pronta para executar.</h1>
<p>Pesquisa e higiene publicadas no n8n e na Mel. O trabalho começa em 2/11; primeiros contatos automáticos respeitam Finados e iniciam no próximo expediente, 3/11 às 8h. Conversas, recusas e compromissos foram preservados.</p>
<div class="cards"><div class="card"><b>{s['total']:,}</b>fichas revisadas</div><div class="card"><b>{s['pesquisados']}</b>empresas pesquisadas</div><div class="card"><b>{s['sitesComIdentidadeConfirmada']}</b>sites com identidade confirmada</div><div class="card"><b>{s['cnpjsComVinculoConfirmado']}</b>CNPJs associados, de {s['cnpjsConsultadosComSucesso']} consultados</div></div>
<h2>O destino da base</h2><div class="scroll"><table><thead><tr><th>Grupo</th><th>Fichas</th><th>O que significa</th></tr></thead><tbody>
<tr><td>Histórico protegido</td><td>1.786</td><td>Conversas, desfechos, compromissos ou responsabilidade existente; não reconstruir como lead novo.</td></tr>
<tr><td>Revisar</td><td>875</td><td>40 sem evidência específica de site; 112 sem confirmação de público infantil/TEA; 723 estamparias sem necessidade, impacto e decisor confirmados.</td></tr>
<tr><td>Candidato à avaliação</td><td>558</td><td>A triagem inicial permite continuar a avaliação. Não significa qualificação, aprovação do time ou autorização de envio.</td></tr>
<tr><td>Canal humano</td><td>308</td><td>Plus permanece no caminho conduzido pelo Rômulo.</td></tr></tbody></table></div>
<p>Não foi necessário apagar fichas para produzir essa separação. As cinco fontes tabulares foram comparadas ao backup e permaneceram idênticas. Os {v['contatosPreservados']} registros do executor foram preservados.</p>
<h2>De 2 a 6 de novembro</h2><p>{e(p['objetivo'])}</p>{ciclo}<div class="scroll"><table><thead><tr><th>Dia</th><th>Responsáveis</th><th>Ação</th><th>Entrega</th></tr></thead><tbody>{daily}</tbody></table></div>
<h2>O que está funcionando</h2><ul><li>Workflow de pesquisa ativo às 7h10, 12h10 e 18h10 de segunda a sexta, em São Paulo.</li><li>Pesquisa ampliada até 6/11, limitada a 60 empresas por dia. Depois, a higiene básica continua, sem iniciar novas pesquisas de empresas.</li><li>Sites institucionais, CNPJ por Minha Receita/BrasilAPI e IBGE. Sem chave, cartão ou chamadas comerciais. Falha de consulta fica pendente.</li><li>Três caçadores continuam pausados; seus nós Google Places estão bloqueados, inclusive nas regenerações.</li><li>A curadoria e o executor consultam o gate de identidade, contradições e duplicidade. Não muda preço, SPICED ou limites de envio.</li><li>Leitura interna disponível na Central. Nenhuma mensagem foi enviada por esta implantação.</li></ul>
<div class="notice"><b>Política vigente e limites:</b> Custo zero para novas consultas. Google Places e Apify estão bloqueados por código, mesmo com credencial. São usadas apenas fontes gratuitas declaradas em fontes-pesquisa-gratuitas.json. As 42 consultas Places anteriores à instrução permanecem no histórico e seu custo anterior não foi apurado. Google Trends tem comparações manuais preparadas, sem indicadores coletados; LinkedIn usa somente links públicos, sem API paga.</div>
<h2>Pesquisa de mercado preparada</h2><p>{e(p['trends'])}</p><ul>{market}</ul>
<h2>Fichas pesquisadas e fontes</h2><p>CNPJ, porte e cargo não confirmam necessidade, quantidade de funcionários, decisor ou intenção de compra. Os quatro CNPJs cujo vínculo ainda está pendente não foram unidos às empresas automaticamente.</p><input id="filtro" aria-label="Filtrar empresas pesquisadas" placeholder="Filtrar por empresa, produto ou pendência"><div class="scroll"><table id="empresas"><thead><tr><th>Oferta</th><th>Empresa</th><th>Identidade do site</th><th>CNPJ</th><th>Pendências</th><th>Fontes</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
<h2>Verificação</h2><p>{v['testesPython']} testes Python e {v['testesTypeScript']} testes TypeScript aprovados; build completo publicado; fluxo n8n executado de ponta a ponta; leitura da Central conferida. Custo real das consultas Google Places anteriores à restrição ainda não apurado. Após a instrução, 29 testes e uma execução real confirmaram custo permitido zero e nenhum provedor pago habilitado.</p><p class="muted">Relatório local. Nenhum dado foi publicado em um site externo. Fonte: verificacao-final.json e higiene.json, na mesma pasta.</p></main>
<script>document.querySelector('#filtro').addEventListener('input',e=>{{const q=e.target.value.toLocaleLowerCase('pt-BR');for(const row of document.querySelectorAll('#empresas tbody tr'))row.hidden=!row.textContent.toLocaleLowerCase('pt-BR').includes(q)}})</script></html>'''
    target=base/'relatorio.html';target.write_text(content,encoding='utf-8');return target


if __name__=='__main__':print(gerar(sys.argv[1],sys.argv[2]))
