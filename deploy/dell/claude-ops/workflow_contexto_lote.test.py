"""Fixtures inteiramente sintéticas; nenhum contato, API ou modelo."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import workflow_contexto_lote as m

spec = importlib.util.spec_from_file_location('contexto_fixture', Path(__file__).with_name('workflow_contexto_whatsapp.test.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


def workflow(id_=next(iter(m.v1.ESPECIFICACOES))):
    w = fixtures.wf(id_)
    for i, nome in enumerate(m.v1.LEITURAS):
        n = m.v1._no(w, nome)
        n['executeOnce'] = True
        n['parameters']['documentId'] = {'__rl': True, 'mode': 'id', 'value': 'PRUMO_fixture' if i != 1 else 'SITE_fixture'}
        n['parameters']['sheetName'] = {'__rl': True, 'mode': 'id' if i < 2 else 'name', 'value': str(i) if i < 2 else nome[4:]}
    return w


def filho(w):
    fim = m.v1._especificacao(w)[2]
    return json.loads(m.v1._no(w, fim)['parameters']['workflowJson'])


def modificar(w, mutate):
    fim = m.v1._especificacao(w)[2]
    c = filho(w)
    mutate(c)
    m.v1._no(w, fim)['parameters']['workflowJson'] = json.dumps(c, ensure_ascii=False)


def respostas(c):
    ns = {}
    for nome in (m.PRUMO, m.SITE):
        p = m.v1._no(c, nome)['parameters']
        body = json.loads(p['jsonBody'])
        doc = p['url'].split('/spreadsheets/')[1].split('/')[0]
        ranges = [{'dataFilters': [f], 'valueRange': {'range': 'Fixture!A1:Z1000', 'majorDimension': 'ROWS', 'values': [['Nome', 'Valor', 'Ativo'], ['Sintético', 0, False]]}} for f in body['dataFilters']]
        ns[nome] = [{'json': {'statusCode': 200, 'body': {'spreadsheetId': doc, 'valueRanges': ranges}}}]
    return ns


class Lote(unittest.TestCase):
    def test_api_put_lote_duas_vezes_com_sincronizador_prumo_e_hook_final(self):
        import prumo_contexto
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp); cfg = home/'.config/claude-ops'; cfg.mkdir(parents=True)
            (cfg/'n8n-api-key').write_text('fixture-sem-acesso')
            (cfg/'workflow-contexto-whatsapp.json').write_text(json.dumps({'v':2,'contextoFresco':True,'contextoLote':True,'pausarJev':False}))
            contexto = {'versao':1,'organizacao_sha256':'a'*64,'origem':'fixture','organizacao':'fixture'}
            reqs = []
            class Resposta:
                def __init__(self, data): self.data=data
                def __enter__(self): return self
                def __exit__(self,*args): pass
                def read(self): return json.dumps(self.data).encode()
            def urlopen(req,**kwargs):
                data = json.loads(req.data); reqs.append(data)
                return Resposta({**data,'id':id_})
            with patch.object(Path,'home',return_value=home):
                spec = importlib.util.spec_from_file_location('n8n_api_fixture',Path(__file__).with_name('n8n.py'))
                cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)
                with patch.object(prumo_contexto,'carregar',return_value=contexto), patch.object(cli.urllib.request,'urlopen',side_effect=urlopen):
                    for id_ in m.v1.ESPECIFICACOES:
                        publicado = m.preparar(prumo_contexto.preparar(m.v1.preparar(workflow(id_)),contexto))
                        primeira = cli.put(publicado); segunda = cli.put(primeira)
                        self.assertEqual(reqs[-2],reqs[-1])
                        self.assertEqual(primeira,segunda)
                        self.assertEqual(m.preparar(segunda),segunda)
            self.assertEqual(len(reqs),6)

    def test_tres_pais_intactos_aliases_consumidor_guardas_sem_cache_e_idempotencia(self):
        for id_ in m.v1.ESPECIFICACOES:
            w = workflow(id_); antes = copy.deepcopy(w); base = m.v1.preparar(w); out = m.preparar(base)
            self.assertEqual(w, antes)
            for k in ('id', 'name', 'active', 'settings', 'staticData', 'connections'):
                self.assertEqual(out[k], base[k])
            fim = m.v1.ESPECIFICACOES[id_][2]
            c = filho(out); b = filho(base)
            self.assertEqual(m.v1._no(c, fim), m.v1._no(b, fim))
            self.assertEqual(m.v1._no(c, m.v1.GUARDA), m.v1._no(b, m.v1.GUARDA))
            for nome in m.v1.LEITURAS:
                n = m.v1._no(c, nome)
                self.assertEqual(n['id'], m.v1._no(b, nome)['id'])
                self.assertEqual(n['type'], 'n8n-nodes-base.code')
                self.assertTrue(n['alwaysOutputData']); self.assertTrue(n['executeOnce'])
            self.assertEqual(sum(n['type'] == 'n8n-nodes-base.httpRequest' for n in c['nodes']), 2)
            self.assertFalse(any(n['type'] == 'n8n-nodes-base.googleSheets' for n in c['nodes']))
            self.assertEqual(m.preparar(out), out)
            self.assertEqual(m.preparar_contexto_compativel(out), out)
            for n in base['nodes']:
                if n['name'] != fim: self.assertEqual(m.v1._no(out, n['name']), n)

    def test_requests_sao_somente_batch_read_frescos_e_formatacao_explicita(self):
        c = filho(m.preparar(workflow()))
        for nome, quantidade in [(m.PRUMO, 3), (m.SITE, 1)]:
            n = m.v1._no(c, nome); p = n['parameters']; body = json.loads(p['jsonBody'])
            self.assertEqual(p['method'], 'POST')
            self.assertTrue(p['url'].startswith('https://sheets.googleapis.com/v4/spreadsheets/'))
            self.assertTrue(p['url'].endswith('/values:batchGetByDataFilter'))
            self.assertEqual(body['majorDimension'], 'ROWS')
            self.assertEqual(body['valueRenderOption'], 'UNFORMATTED_VALUE')
            self.assertEqual(body['dateTimeRenderOption'], 'FORMATTED_STRING')
            self.assertEqual(len(body['dataFilters']), quantidade)
            self.assertEqual(p['authentication'], 'predefinedCredentialType')
            self.assertEqual(n['credentials'], {'googleSheetsOAuth2Api': {'id': 'credencial-fixture'}})
            self.assertTrue(n['retryOnFail']); self.assertEqual(n['maxTries'], 3)
            self.assertNotIn('pagination', p['options']); self.assertFalse(p['options']['response']['response']['neverError'])

    def test_opcoes_novas_filtros_credenciais_documentos_expressoes_falham_antes_mutacao(self):
        changes = [lambda n:n['parameters']['options'].update(outputFormatting={'values': {'general': 'FORMATTED_VALUE'}}),
                   lambda n:n['parameters'].update(filtersUI={'values': [{'lookupColumn': 'Nome'}]}),
                   lambda n:n.update(typeVersion=4.8), lambda n:n.update(executeOnce=False),
                   lambda n:n.update(alwaysOutputData=False), lambda n:n.update(maxTries=4),
                   lambda n:n['parameters']['documentId'].update(value='={{ $json.documento }}'),
                   lambda n:n['parameters']['sheetName'].update(mode='name'),
                   lambda n:n['credentials'].update(outra={'id': 'fixture'})]
        for change in changes:
            w = workflow(); change(m.v1._no(w, m.v1.LEITURAS[0])); antes = copy.deepcopy(w)
            with self.assertRaises(ValueError): m.preparar(w)
            self.assertEqual(w, antes)
        w = workflow(); m.v1._no(w, m.v1.LEITURAS[3])['parameters']['documentId']['value'] = 'OUTRO_fixture'
        with self.assertRaises(ValueError): m.preparar(w)

    def test_integridade_rejeita_modelo_escrita_bypass_retry_tolerante_e_marcador_sem_prova(self):
        changes = [lambda c:c['connections'][m.PRUMO]['main'][0].append(m.v1._destino(m.v1.GUARDA)),
                   lambda c:c['nodes'].append({'id':'extra','name':'extra','type':'modelo'}),
                   lambda c:m.v1._no(c,m.SITE)['parameters'].update(url='http://fixture/write'),
                   lambda c:m.v1._no(c,m.SITE).update(onError='continueRegularOutput'),
                   lambda c:m.v1._no(c,m.NORMALIZAR).update(disabled=True),
                   lambda c:m.v1._no(c,m.v1.GUARDA).update(continueOnFail=True),
                   lambda c:m.v1._no(c,m.v1.LEITURAS[0])['parameters'].update(jsCode='return [];'),
                   lambda c:m.v1._no(c,m.v1.LEITURAS[0]).update(notes='{}'),
                   lambda c:m.v1._no(c,m.v1.ESPECIFICACOES[next(iter(m.v1.ESPECIFICACOES))][1])['parameters'].update(inputSource='jsonExample')]
        for change in changes:
            w = m.preparar(workflow()); modificar(w, change)
            with self.assertRaises(ValueError): m.preparar(w)
            with self.assertRaises(ValueError): m.preparar_contexto_compativel(w)

    def test_prumo_contexto_antes_depois_e_troca_da_organizacao_nao_perde_idempotencia(self):
        import prumo_contexto as prumo
        contexto = {'versao':1,'organizacao_sha256':'a'*64,'origem':'fixture','organizacao':'fixture'}
        for id_ in m.v1.ESPECIFICACOES:
            primeiro_lote = m.preparar(workflow(id_))
            decorado_depois = prumo.preparar(primeiro_lote, contexto)
            self.assertEqual(m.preparar(decorado_depois),decorado_depois)
            self.assertEqual(m.preparar_contexto_compativel(decorado_depois),decorado_depois)
            base = m.v1.preparar(prumo.preparar(workflow(id_), contexto))
            out = m.preparar(prumo.preparar(base, contexto))
            out = prumo.preparar(out, contexto)
            self.assertEqual(m.preparar(out), out)
            novo = {**contexto, 'organizacao_sha256': 'b'*64, 'organizacao':'fixture atualizada'}
            out = prumo.preparar(out, novo)
            self.assertEqual(m.preparar(out), out)

    def test_outros_fluxos_pausados_clones_nao_mudam(self):
        for w in [{'name':'05 · Acompanhamento','active':False,'nodes':[]}, {**workflow(), 'id':'clone'}]:
            self.assertEqual(m.preparar(w), w)

    def test_normalizacao_ordem_api_independente_aliases_e_shape_real(self):
        c = filho(m.preparar(workflow())); ns = respostas(c)
        ns[m.PRUMO][0]['json']['body']['valueRanges'].reverse()
        output = fixtures.executar(m.v1._no(c,m.NORMALIZAR)['parameters']['jsCode'], ns)
        ns[m.NORMALIZAR] = output
        for nome in m.v1.LEITURAS:
            rows = fixtures.executar(m.v1._no(c,nome)['parameters']['jsCode'], ns)
            self.assertEqual(rows, [{'json':{'row_number':2,'Nome':'Sintético','Valor':0,'Ativo':False},'pairedItem':{'item':0}}])

    def test_fonte_parcial_duplicada_status_errado_documento_errado_matriz_invalida_falha_fechado(self):
        c = filho(m.preparar(workflow())); codigo = m.v1._no(c,m.NORMALIZAR)['parameters']['jsCode']
        changes = [lambda ns:ns.pop(m.SITE), lambda ns:ns[m.PRUMO].append(copy.deepcopy(ns[m.PRUMO][0])),
                   lambda ns:ns[m.PRUMO][0]['json'].update(statusCode=500),
                   lambda ns:ns[m.PRUMO][0]['json']['body'].update(spreadsheetId='outro'),
                   lambda ns:ns[m.PRUMO][0]['json']['body']['valueRanges'].pop(),
                   lambda ns:ns[m.PRUMO][0]['json']['body']['valueRanges'].__setitem__(1,copy.deepcopy(ns[m.PRUMO][0]['json']['body']['valueRanges'][0])),
                   lambda ns:ns[m.PRUMO][0]['json']['body']['valueRanges'][0]['valueRange'].update(values=[['Nome'],[{}]]),
                   lambda ns:ns[m.PRUMO][0]['json']['body']['valueRanges'][0]['valueRange'].pop('majorDimension')]
        for change in changes:
            ns = respostas(c); change(ns)
            with self.assertRaises(ValueError): fixtures.executar(codigo,ns)

    def test_aba_vazia_e_cabecalhos_tipos_linhas_vazias_sem_limite(self):
        c = filho(m.preparar(workflow())); ns = respostas(c)
        ns[m.SITE][0]['json']['body']['valueRanges'][0]['valueRange'].pop('values')
        out = fixtures.executar(m.v1._no(c,m.NORMALIZAR)['parameters']['jsCode'], ns)
        self.assertEqual(out[0]['json']['fontes'][m.v1.LEITURAS[1]], [])
        cases = [([['Nome','Nome',0,False],['primeiro','último',0,False]], [{'json':{'row_number':2,'Nome':'último','col_3':0,'col_4':False},'pairedItem':{'item':0}}]),
                 ([[],['Nome'],[],['teste']], [{'json':{'row_number':4,'Nome':'teste'},'pairedItem':{'item':0}}])]
        for matrix, expected in cases:
            source = m.CONVERTER_JS + '\nreturn linhas47(' + json.dumps(matrix) + ');'
            actual = fixtures.executar(source,{})
            self.assertEqual(actual, expected)
        self.assertEqual(len(fixtures.executar(m.CONVERTER_JS + "return linhas47([['Nome'], ...Array.from({length:3001},(_,i)=>[String(i)])]);",{})),3001)

    def test_optin_v1_v2_estritos_publicacao_independente(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); cfg = base/'.config/claude-ops'; cfg.mkdir(parents=True)
            (cfg/'n8n-api-key').write_text('fixture-sem-acesso')
            with patch.object(Path,'home',return_value=base):
                spec = importlib.util.spec_from_file_location('n8n_fixture_lote', Path(__file__).with_name('n8n.py'))
                cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)
                p = cfg/'workflow-contexto-whatsapp.json'
                self.assertIsNone(cli.configuracao_contexto())
                v1 = {'v':1,'contextoFresco':True,'pausarJev':False}
                p.write_text(json.dumps(v1)); self.assertEqual(cli.configuracao_contexto(),v1)
                w = workflow(); self.assertEqual(cli.preparar_simplificacao_se_configurado(w),m.v1.preparar(w))
                v2 = {**v1,'v':2,'contextoLote':True}
                p.write_text(json.dumps(v2)); out = cli.preparar_lote_se_configurado(cli.preparar_simplificacao_se_configurado(w))
                self.assertEqual(out,m.preparar(w)); self.assertEqual(cli.preparar_simplificacao_se_configurado(out),out)
                for config in [{**v2,'contextoLote':1},{**v2,'contextoFresco':False},{**v1,'contextoLote':True},{**v2,'v':True},{**v2,'extra':False},{k:v for k,v in v2.items() if k!='contextoLote'}]:
                    p.write_text(json.dumps(config))
                    with self.assertRaises(ValueError): cli.configuracao_contexto()
                atomic = cfg/'workflow-publicacao-crm.json'
                self.assertEqual(cli.preparar_publicacao_crm_se_configurado(w),w)
                atomic.write_text(json.dumps({'v':1,'publicacaoAtomica':False}))
                self.assertEqual(cli.preparar_publicacao_crm_se_configurado(w),w)
                for config in [{'v':1,'publicacaoAtomica':'sim'},{'v':True,'publicacaoAtomica':True},{'v':1,'publicacaoAtomica':True,'extra':0}]:
                    atomic.write_text(json.dumps(config))
                    with self.assertRaises(ValueError): cli.preparar_publicacao_crm_se_configurado(w)


if __name__ == '__main__': unittest.main()
