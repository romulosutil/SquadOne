"""Deltas pequenos, aplicáveis à versão produtiva sem sobrescrever outras correções."""
from pathlib import Path
import sys


def patch_luna(s):
    if "self.path == '/pesquisa-leads'" in s:return s
    if "if self.path != '/inferir':" in s:
        s=s.replace("if self.path != '/inferir':", "if self.path not in ['/inferir', '/pesquisa-leads']:")
        s=s.replace("            dado = validar_pedido(json.loads(self.rfile.read(tamanho)))", "            dado = json.loads(self.rfile.read(tamanho))\n            if self.path == '/inferir': validar_pedido(dado)")
        anchor="            resposta = inferir(dado)\n"
        assert s.count(anchor)==1
        return s.replace(anchor,"""            if self.path == '/pesquisa-leads':
                if not isinstance(dado, dict) or set(dado) != {'limite'} or type(dado['limite']) is not int or not 0 <= dado['limite'] <= 10:
                    return self.responder(400, {'erro': 'Pedido inválido'})
                from pesquisa_leads import executar
                resposta = executar(dado['limite'])
            else:
                resposta = inferir(dado)
""")
    s=s.replace("if self.path not in ['/inferir', '/fonte']:","if self.path not in ['/inferir', '/fonte', '/pesquisa-leads']:")
    anchor="            if self.path == '/fonte':\n"
    assert s.count(anchor)==1
    s=s.replace(anchor,"""            if self.path == '/pesquisa-leads':
                # Contrato fechado: sem URL, comando, modelo ou dados de leads do cliente.
                if not isinstance(dado, dict) or set(dado) != {'limite'} or type(dado['limite']) is not int or not 0 <= dado['limite'] <= 10:
                    return self.responder(400, {'erro': 'Pedido inválido'})
                from pesquisa_leads import executar
                resposta = executar(dado['limite'])
            elif self.path == '/fonte':
""")
    return s


def patch_executor(s):
    start=s.index('def proximo_expediente(now):');end=s.index('\ndef numero(',start)
    if 'from calendario_comercial import proximo_expediente as calcular' not in s[start:end]:
        s=s[:start]+'''def proximo_expediente(now):
    from calendario_comercial import proximo_expediente as calcular
    return calcular(now)

'''+s[end:]
    return s


def patch_filtro(s):
    anchor="    motivos = []\n"
    if 'gate_pesquisa_leads(l)' in s:return s
    assert s.count(anchor)==1
    s=s.replace(anchor,"    motivos = gate_pesquisa_leads(l)\n",1)
    idx=s.index('\ndef avaliar(')
    s=s[:idx]+'''
_PESQUISA_CACHE = None


def gate_pesquisa_leads(l):
    """Sem rede e sem escrita; revalida identidade, assinatura e validade por lead."""
    global _PESQUISA_CACHE
    arquivo = Path.home()/'.local/share/pesquisa-leads/gate.json'
    if not arquivo.exists(): return []
    try:
        from pesquisa_leads import assinatura, bloqueios_pesquisa, VERSAO as VP
        stat = arquivo.stat()
        chave = (str(arquivo), stat.st_mtime_ns, stat.st_size)
        if _PESQUISA_CACHE is None or _PESQUISA_CACHE[0] != chave:
            _PESQUISA_CACHE = (chave, json.loads(arquivo.read_text()))
        gate = _PESQUISA_CACHE[1]
        if gate.get('versao') != VP: return ['pesquisa-versao-divergente']
        row = gate.get('leads', {}).get(l['id'])
        if not row: return []
        if row.get('assinatura') != assinatura(l): return ['pesquisa-contexto-alterado']
        em = instante(gate.get('geradoEm'))
        if em is None or not -60 <= dt.datetime.now(dt.timezone.utc).timestamp()-em <= 30*3600:
            return ['higiene-desatualizada']
        motivos = [m for m in row.get('motivos', []) if m in ('destino-com-historico-em-outra-ficha', 'destino-duplicado')]
        motivos += bloqueios_pesquisa(l, row.get('pesquisa'))
        return motivos
    except Exception:
        return ['pesquisa-indisponivel']

'''+s[idx:]
    return s


if __name__=='__main__':
    mode,src,dest=sys.argv[1:];f={'luna':patch_luna,'executor':patch_executor,'filtro':patch_filtro}[mode]
    Path(dest).write_text(f(Path(src).read_text(encoding='utf-8-sig')),encoding='utf-8')
