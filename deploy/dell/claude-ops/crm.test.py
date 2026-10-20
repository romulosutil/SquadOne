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


def validar(s, produto='site', texto=None, tipo='spiced'):
    body = {'produto': produto, 'id': 'TESTE', 'tipo': tipo, 'texto': texto if texto is not None else json.dumps(s, ensure_ascii=False), 'data': ''}
    code = "const b=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const $=()=>({first:()=>({json:{body:b}})});console.log(JSON.stringify(new Function('$'," + json.dumps(VALIDAR) + ")($)[0].json));"
    r = subprocess.run(['node', '-e', code], input=json.dumps(body), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


class SpicedDoRegistro(unittest.TestCase):
    def test_aarr_catalogo_iris_e_oferta_proibem_valor_livre(self):
        base = {'versao': 1, 'oferta': 'encontrado', 'componente': 'implantacao', 'referencia': 'recibo', 'data': '2026-10-19'}
        r = validar(base, tipo='pagamento_confirmado')
        self.assertTrue(r['ok'])
        self.assertEqual(json.loads(r['linha']['texto'])['valor_centavos'], 69000)
        for extra in [{'valor_centavos': 9000}, {'data': '2026-02-30'}, {'data': '2099-01-01'}, {'referencia': ''}, {'quantidade': 2}]:
            with self.subTest(extra=extra): self.assertFalse(validar({**base, **extra}, tipo='pagamento_confirmado')['ok'])
        for produto in ['iris','estampa']:
            self.assertFalse(validar(base, produto, tipo='valor_proposta')['ok'])
        for q, valor in [(1,3900),(15,58500),(16,61700),(20,74500),(40,138500),(41,141000)]:
            s = {**base, 'oferta': 'iris', 'componente': 'mensalidade', 'quantidade': q}
            r = validar(s, 'iris', tipo='pagamento_confirmado')
            self.assertTrue(r['ok'])
            self.assertEqual(json.loads(r['linha']['texto'])['valor_centavos'], valor)
        for q in [0,-1,1.5]: self.assertFalse(validar({**base,'oferta':'iris','componente':'mensalidade','quantidade':q}, 'iris', tipo='pagamento_confirmado')['ok'])

    def test_aarr_categorias_calendario_indicacoes_e_reversao_longa(self):
        for tipo, valores in [('origem',['cacador','plus','indicacao','CDL','anuncio']),('motivo_perda',['preco','timing','sem-dor','decisor','concorrente','sumiu'])]:
            for valor in valores: self.assertTrue(validar({'versao':1,'valor':valor}, tipo=tipo)['ok'])
            self.assertFalse(validar({'versao':1,'valor':'inventado'}, tipo=tipo)['ok'])
        retencao = {'versao':1,'referencia':'encontrado','inicio':'2026-01-31','data':'2026-03-31','ativa':True}
        self.assertTrue(validar(retencao,tipo='retencao_3m')['ok'])
        self.assertFalse(validar({**retencao,'data':'2026-03-30'},tipo='retencao_3m')['ok'])
        undo = {'versao':1,'tipo':'pagamento_confirmado','referencia':'x'*200+'|2026-10-19|encontrado|implantacao','data':'2026-10-19'}
        self.assertTrue(validar(undo,tipo='receita_desfeita')['ok'])
        for tipo in ['indicacao_pedida','indicacao_recebida']:
            self.assertTrue(validar({'versao':1,'referencia':'recibo','data':'2026-10-19'},tipo=tipo)['ok'])
        self.assertFalse(validar({**undo,'valor_centavos':1},tipo='receita_desfeita')['ok'])

    def test_cadencia_duravel_valida_degraus_e_origem(self):
        origem = '2026-10-19T15:00:00.000Z'
        for produto in ['site', 'prumo', 'iris', 'estampa', 'plus']:
            for degrau in ['dia-1', 'dia-3']:
                s = {'versao': 1, 'tipo': 'proposta', 'origem': origem, 'degrau': degrau}
                self.assertTrue(validar(s, produto, tipo='cadencia_enviada')['ok'])
        conversa = {'versao': 1, 'tipo': 'conversa', 'origem': origem, 'degrau': 'dia-2', 'base': origem}
        self.assertTrue(validar(conversa, tipo='cadencia_enviada')['ok'])
        for extra in [{'base': None}, {'origem': 123}, {'origem': 'invalida'}, {'degrau': 'dia-3'}, {'extra': True}]:
            with self.subTest(extra=extra): self.assertFalse(validar({**conversa, **extra}, tipo='cadencia_enviada')['ok'])

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
