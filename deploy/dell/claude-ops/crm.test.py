"""Executa só o JavaScript puro do validador; não importa/publica crm.py nem acessa n8n."""
import ast
import json
import subprocess
import unittest
from pathlib import Path

tree = ast.parse(Path(__file__).with_name('crm.py').read_text(encoding='utf-8'))
VALIDAR = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
               and any(isinstance(t, ast.Name) and t.id == 'VALIDAR_JS' for t in n.targets))


def spiced():
    return {'situacao': '', 'dor': 'perde pedidos', 'impacto': 'retrabalho',
            'evento_critico': {'fato': '', 'data': ''},
            'decisao': {'decisor_confirmado': 'sim', 'quem': 'a dona', 'como_paga': ''}}


def validar(s, produto='site', texto=None):
    body = {'produto': produto, 'id': 'TESTE', 'tipo': 'spiced', 'texto': texto if texto is not None else json.dumps(s, ensure_ascii=False), 'data': ''}
    code = "const b=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const $=()=>({first:()=>({json:{body:b}})});console.log(JSON.stringify(new Function('$'," + json.dumps(VALIDAR) + ")($)[0].json));"
    r = subprocess.run(['node', '-e', code], input=json.dumps(body), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


class SpicedDoRegistro(unittest.TestCase):
    def test_cinco_linhas_preservam_confirmacao(self):
        for p in ['site', 'prumo', 'iris', 'estampa', 'plus']:
            r = validar(spiced(), p)
            self.assertTrue(r['ok'], p)
            self.assertEqual(json.loads(r['linha']['texto']), spiced())

    def test_esquema_enum_limites_e_datas_impossiveis(self):
        casos = [None, {}, {'dor': 'sem outros campos'}]
        for data in ['2026-02-30', '2025-02-29', '2026-13-01', '19/10/2026']:
            s = spiced(); s['evento_critico']['data'] = data; casos.append(s)
        s = spiced(); s['decisao']['decisor_confirmado'] = 'talvez'; casos.append(s)
        s = spiced(); s['dor'] = 'x' * 201; casos.append(s)
        for s in casos:
            with self.subTest(s=s): self.assertFalse(validar(s)['ok'])
        self.assertFalse(validar(None, texto='{')['ok'])
        self.assertFalse(validar(None, texto=json.dumps(spiced()) + ' ' * 1000)['ok'])

    def test_data_real_e_objeto_vazio_confirmado(self):
        s = spiced(); s['evento_critico']['data'] = '2024-02-29'
        self.assertTrue(validar(s)['ok'])
        s['dor'] = ''; s['impacto'] = ''; s['decisao']['decisor_confirmado'] = 'nao-sei'
        self.assertTrue(validar(s)['ok'])


if __name__ == '__main__': unittest.main()
