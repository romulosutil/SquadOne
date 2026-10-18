#!/usr/bin/env python3
"""Painel somente leitura, no loopback e publicado só pelo Tailscale Serve."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ARQUIVO = Path.home() / '.local/share/n8n-estado/prumo-metricas.json'
PAGINA = '''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Medição · PRUMO</title><style>body{font:17px system-ui;background:#f5f0e8;color:#241d19;margin:0;padding:2rem;max-width:1100px;margin:auto}h1{border-left:5px solid #e0490f;padding-left:1rem}p{line-height:1.5}.numeros{display:flex;gap:2rem;flex-wrap:wrap;padding:1rem 0}strong{font-size:2rem}table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{text-align:left;padding:.7rem;border-bottom:1px solid #d5c8b8;overflow-wrap:anywhere}input,select,button{font:inherit;padding:.6rem;margin:.3rem}label{display:inline-block}small{color:#655b53}.rolagem{overflow:auto}</style>
<h1>Medição do PRUMO</h1><p>Contagens de aberturas, cliques e perguntas. Cada evento é contado; uma pessoa pode gerar vários. Sem cookies ou identificação de visitantes.</p>
<p id="estado" role="status">Carregando…</p><div class="numeros"><div><strong id="total">—</strong><br>eventos no período</div><div><strong id="respostas">—</strong><br>respostas da Fonte nas últimas 24 h</div><div><strong id="fila">—</strong><br>perguntas em preparo</div></div>
<label>Desde <input type="date" id="desde"></label><label>Página <select id="pagina"><option value="">Todas</option><option>/</option><option>/equipe</option><option>/mapa</option><option>/fonte</option><option>/raio-x</option></select></label><button id="atualizar">Atualizar</button><button id="exportar">Baixar CSV</button>
<div class="rolagem"><table><thead><tr><th>Dia</th><th>Site</th><th>Página</th><th>Evento</th><th>Seção</th><th>Quantidade</th></tr></thead><tbody id="linhas"></tbody></table></div>
<script>let dados=null,visiveis=[];const $=id=>document.getElementById(id);
$('desde').value=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
function pintar(){if(!dados)return;visiveis=dados.eventos.filter(x=>x.dia>=$('desde').value&&(!$('pagina').value||x.pagina===$('pagina').value));$('linhas').textContent='';for(const r of visiveis){const tr=document.createElement('tr');for(const k of ['dia','origem','pagina','evento','secao','quantidade']){const td=document.createElement('td');td.textContent=String(r[k]);tr.appendChild(td)}$('linhas').appendChild(tr)}$('total').textContent=visiveis.reduce((n,r)=>n+r.quantidade,0);const f=dados.fonte_ultimas_24h||{};$('respostas').textContent=f.concluida||0;$('fila').textContent=(f.aguardando||0)+(f.processando||0);$('estado').textContent='Atualizado em '+new Date(dados.gerado_em).toLocaleString('pt-BR')+(Date.now()-Date.parse(dados.gerado_em)>180000?' · Atenção: atualização atrasada.':'')}
async function carregar(){try{const r=await fetch(location.pathname.replace(/\\/$/,'')+'/dados',{cache:'no-store'});if(!r.ok)throw Error();dados=await r.json();pintar()}catch(_){$('estado').textContent='A medição ainda não está disponível. Confira o workflow PRUMO · Medição de eventos.'}}
$('pagina').onchange=pintar;$('desde').onchange=pintar;$('atualizar').onclick=carregar;
$('exportar').onclick=()=>{const campos=['dia','origem','pagina','evento','secao','quantidade'];const csv=[campos,...visiveis.map(r=>campos.map(k=>r[k]))].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(';')).join('\\r\\n');const url=URL.createObjectURL(new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='prumo-medicao.csv';a.click();URL.revokeObjectURL(url)};carregar();setInterval(carregar,60000);</script></html>'''


class HTTP(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        codigo, tipo = 200, 'text/html; charset=utf-8'
        if self.path.split('?')[0].endswith('/dados'):
            tipo = 'application/json; charset=utf-8'
            try:
                dados = json.loads(ARQUIVO.read_text())
                if not isinstance(dados.get('eventos'), list):
                    raise ValueError()
                corpo = json.dumps(dados, ensure_ascii=False).encode()
            except (OSError, ValueError):
                codigo, corpo = 503, b'{"erro":"Medicao ainda nao disponivel"}'
        elif self.path.split('?')[0].rstrip('/') in ['', '/prumo/metricas']:
            corpo = PAGINA.encode()
        else:
            codigo, corpo = 404, b''
        self.send_response(codigo)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(corpo)


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 8767), HTTP).serve_forever()
