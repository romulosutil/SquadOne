"""Executa só o JavaScript puro do validador e do retrato; não publica crm.py nem acessa n8n."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def _crm():
    """crm.py lê a chave do n8n ao importar: HOME temporário com uma chave falsa; nada é chamado."""
    with tempfile.TemporaryDirectory() as tmp:
        chave = Path(tmp) / '.config/claude-ops/n8n-api-key'
        chave.parent.mkdir(parents=True); chave.write_text('fixture-sem-acesso')
        with patch.object(Path, 'home', return_value=Path(tmp)):
            spec = importlib.util.spec_from_file_location('crm_fixture', Path(__file__).with_name('crm.py'))
            m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


CRM = _crm()
VALIDAR = CRM.VALIDAR_JS
OFERTAS = json.loads(Path(__file__).with_name('prumo-ofertas.json').read_text(encoding='utf-8'))['ofertas']


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
    def test_proposta_exige_conteudo_real_sem_template(self):
        for conteudo in ['', 'Proposta enviada', 'Enviei a proposta',
                         'A proposta fica em [preencher o valor].', 'Entrego no [dia combinado] para você.']:
            self.assertFalse(validar({},tipo='proposta',texto=conteudo)['ok'],conteudo)
        real = 'Site funcionando: implantação R$ 690, mensalidade R$ 39; pagamento após ver no ar.'
        self.assertTrue(validar({},tipo='proposta',texto=real)['ok'])

    def test_aarr_catalogo_iris_e_oferta_proibem_valor_livre(self):
        base = {'versao': 1, 'oferta': 'encontrado', 'componente': 'implantacao', 'referencia': 'recibo', 'data': '2026-10-19'}
        r = validar(base, tipo='pagamento_confirmado')
        self.assertTrue(r['ok'])
        self.assertEqual(json.loads(r['linha']['texto'])['valor_centavos'], 69000)
        for extra in [{'valor_centavos': 9000}, {'data': '2026-02-30'}, {'data': '2099-01-01'}, {'referencia': ''}, {'quantidade': 2}]:
            with self.subTest(extra=extra): self.assertFalse(validar({**base, **extra}, tipo='pagamento_confirmado')['ok'])
        for produto in OFERTAS:
            self.assertFalse(validar(base, produto, tipo='valor_proposta')['ok'])
        for q, valor in [(1,3900),(15,58500),(16,61700),(20,74500),(40,138500),(41,141000)]:
            s = {**base, 'oferta': 'iris', 'componente': 'mensalidade', 'quantidade': q}
            r = validar(s, 'iris', tipo='pagamento_confirmado')
            self.assertTrue(r['ok'])
            self.assertEqual(json.loads(r['linha']['texto'])['valor_centavos'], valor)
        for q in [0,-1,1.5]: self.assertFalse(validar({**base,'oferta':'iris','componente':'mensalidade','quantidade':q}, 'iris', tipo='pagamento_confirmado')['ok'])

    def test_aarr_categorias_calendario_indicacoes_e_reversao_longa(self):
        for tipo, valores in [('origem',['cacador','plus','indicacao','CDL','anuncio']),('motivo_perda',['preco','timing','decisor','ja_tem','sem_dor','sumiu','contato_errado'])]:
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
        for produto in ['site', 'prumo', *OFERTAS, 'plus']:
            # Cadência da proposta de 28/10/2026: D+1 útil, D+4 úteis, D+8 corridos; o "dia-3" antigo não se grava mais.
            for degrau in ['dia-1', 'dia-4', 'dia-8']:
                s = {'versao': 1, 'tipo': 'proposta', 'origem': origem, 'degrau': degrau}
                self.assertTrue(validar(s, produto, tipo='cadencia_enviada')['ok'])
            self.assertFalse(validar({'versao': 1, 'tipo': 'proposta', 'origem': origem, 'degrau': 'dia-3'}, produto, tipo='cadencia_enviada')['ok'])
        conversa = {'versao': 1, 'tipo': 'conversa', 'origem': origem, 'degrau': 'dia-2', 'base': origem}
        self.assertTrue(validar(conversa, tipo='cadencia_enviada')['ok'])
        for extra in [{'base': None}, {'origem': 123}, {'origem': 'invalida'}, {'degrau': 'dia-3'}, {'extra': True}]:
            with self.subTest(extra=extra): self.assertFalse(validar({**conversa, **extra}, tipo='cadencia_enviada')['ok'])

    def test_cinco_linhas_preservam_confirmacao(self):
        for p in ['site', 'prumo', *OFERTAS, 'plus']:
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


def com_oferta_nova():
    """O JSON real mais uma oferta sintética (nunca gravada em disco)."""
    cfg = json.loads(Path(__file__).with_name('prumo-ofertas.json').read_text(encoding='utf-8'))
    nova = json.loads(json.dumps(cfg['ofertas']['iris']))
    nova.update(aba='Lojas', link_retrato='planilhaPdv', rotulo='Prisma PDV')
    cfg['ofertas']['pdv'] = nova
    return cfg


def rodar_montar(js, nos):
    """Roda o "Montar retrato" com $(nó).all() de mentira e devolve o crm.json que ele gravaria."""
    prog = ("const nos=" + json.dumps(nos, ensure_ascii=False) + ";const $=(n)=>({all:()=>{if(!(n in nos))throw Error('não rodou');return nos[n].map(j=>({json:j}));}});"
            "const $execution={mode:'teste'};const r=(function(){" + js + "})();"
            "console.log(JSON.stringify({resumo:r[0].json,dados:JSON.parse(Buffer.from(r[0].binary.data.data,'base64').toString('utf8'))}));")
    r = subprocess.run(['node', '-e', prog], capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(r.stdout)


class OfertasDoRegistro(unittest.TestCase):
    """28/10/2026: a lista de ofertas sai de prumo-ofertas.json, não de crm.py."""

    def test_registro_de_toda_oferta_e_aceito_e_sem_tabela_nao_recebe_preco(self):
        base = {'versao': 1, 'oferta': 'encontrado', 'componente': 'implantacao', 'referencia': 'recibo', 'data': '2026-10-19'}
        js = CRM.validar_js(com_oferta_nova())
        corpo = lambda produto, tipo, texto: {'produto': produto, 'id': 'TESTE', 'tipo': tipo, 'texto': texto, 'data': ''}
        rodar = lambda b: json.loads(subprocess.run(['node', '-e', "const b=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const $=()=>({first:()=>({json:{body:b}})});console.log(JSON.stringify(new Function('$'," + json.dumps(js) + ")($)[0].json));"],
                                                    input=json.dumps(b), capture_output=True, text=True, check=True).stdout)
        self.assertTrue(rodar(corpo('pdv', 'nota', 'ok'))['ok'])
        self.assertEqual(rodar(corpo('inventada', 'nota', 'ok'))['erro'], 'Produto inválido.')
        # Oferta sem tabela própria: nem o preço de outra oferta passa (como a estampa).
        r = rodar(corpo('pdv', 'valor_proposta', json.dumps(base)))
        self.assertFalse(r['ok']); self.assertEqual(r['erro'], 'A condição não pertence à oferta.')

    def test_validar_das_ofertas_atuais_e_o_escrito_ate_28_10(self):
        # A lista e a regra de preço que estavam escritas no VALIDAR_JS saem iguais para Iris e estampa.
        if list(OFERTAS) == ['iris', 'estampa']:
            self.assertIn("if (!['site', 'prumo', 'iris', 'estampa', 'plus'].includes(b.produto))", VALIDAR)
            self.assertIn("if (b.produto === 'estampa' || b.produto === 'iris' && v.oferta !== 'iris'", VALIDAR)

    def test_retrato_le_conta_e_liga_a_oferta_nova(self):
        cfg = com_oferta_nova()
        with patch.object(CRM, 'REGISTRO', cfg):
            js = CRM.montar_js({'pdv': '77'})
            wf = CRM.fluxo('erro', {'httpHeaderAuth': {'id': 'x', 'name': 'CRM Central'}}, {'pdv': '77'})
        subprocess.run(['node', '--check', '-'], input='(function(){' + js + '\n});', text=True, encoding='utf-8', check=True)
        linha = {'ID': 'x1', 'Empresa': 'E'}
        nos = {'Ler Leads': [{'place_id': 'p'}], 'Ler Prospects': [linha], 'Ler aba CRM': [],
               **{'Ler ' + o['aba']: [linha] for o in cfg['ofertas'].values()}}
        out = rodar_montar(js, nos)
        self.assertEqual(out['resumo']['pdv'], 1)
        self.assertEqual(out['dados']['fontes']['pdv']['aba'], 'Lojas')
        self.assertTrue(out['dados']['links']['planilhaPdv'].endswith('#gid=77'))
        # Aba que falha vira fonte com erro, sem segurar o retrato.
        del nos['Ler Lojas']
        out = rodar_montar(js, nos)
        self.assertEqual(out['resumo']['arquivo'], 'crm.json'); self.assertIn('não rodou', out['dados']['fontes']['pdv']['erro'])
        por = {n['name']: n for n in wf['nodes']}
        self.assertEqual(por['Ler Lojas']['parameters']['sheetName']['value'], 'Lojas')
        self.assertEqual(por['Ler Lojas']['id'], 'ler-lojas')
        cadeia, no = [], 'Ler Leads'
        while no in wf['connections']:
            cadeia.append(no); no = wf['connections'][no]['main'][0][0]['node']
        self.assertEqual(cadeia + [no], ['Ler Leads', 'Ler Prospects', *('Ler ' + o['aba'] for o in cfg['ofertas'].values()),
                                         'Ler aba CRM', 'Montar retrato', 'Gravar retrato'])


if __name__ == '__main__': unittest.main()
