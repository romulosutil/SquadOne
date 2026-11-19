"""Ensaios locais com dados fictícios e API simulada."""

from copy import deepcopy
import importlib
import json
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from pathlib import Path

from aviso_operacional import codigo
from prumo_contexto import preparar
from workflow_minimo import renomear


revisao = importlib.import_module('operacao-minima-publicar')


def executar(codigo_js, dados):
    programa = r"""
const vm = require('node:vm');
let args = '';
process.stdin.on('data', parte => args += parte);
process.stdin.on('end', () => {
  const {codigo, dados} = JSON.parse(args);
  const valores = {$input:{all: () => dados.items, first: () => dados.items[0]},
    $workflow:{id: dados.id, name:'Aviso de falha'}, $execution:{id:'7234'}, Buffer};
  const itens = vm.runInNewContext('(function(){' + codigo + '})()', valores);
  console.log(JSON.stringify(itens.map(item => JSON.parse(Buffer.from(item.binary.data.data, 'base64')))));
});
"""
    r = subprocess.run(['node', '-e', programa],
                       input=json.dumps({'codigo': codigo_js, 'dados': dados}),
                       capture_output=True, encoding='utf-8', check=True)
    return json.loads(r.stdout)


def corpo(grafo):
    return {k: grafo[k] for k in ('name', 'nodes', 'connections', 'settings')}


class Operacao(unittest.TestCase):
    def test_agendas_mantem_envelopes_e_gravam_so_depois_da_entrega(self):
        criado = '2026-11-18T22:00:00.000Z'
        for modulo, wid, preparar_pedido, fila, pasta in [
            ('whatsapp-n8n', revisao.WHATSAPP, 'Preparar rodada', 'Entregar ao Dell', 'whatsapp-prospeccao'),
            ('linkedin-n8n', revisao.LINKEDIN, 'Preparar pedido sem dados de contatos',
             'Entregar ao agente do Dell', 'linkedin'),
        ]:
            with self.subTest(modulo=modulo):
                w = importlib.import_module(modulo).workflow()
                nos = {n['name']: n for n in w['nodes']}
                prox = lambda nome: w['connections'][nome]['main'][0][0]['node']
                self.assertEqual(prox(preparar_pedido), fila)
                self.assertEqual(prox(fila), 'Preparar comprovante de entrega')
                self.assertEqual(nos[prox(prox(fila))]['parameters']['fileName'],
                                 f'/home/node/.n8n-files/estado/{pasta}/ultima-entrega.json')
                dados = {'id': wid, 'items': []}
                pedido, = executar(nos[preparar_pedido]['parameters']['jsCode'], dados)
                self.assertEqual(set(pedido), {'workflowId', 'criadoEm'} if modulo == 'whatsapp-n8n'
                                 else {'versao', 'origem', 'workflowId', 'execucaoId', 'criadoEm', 'expiraEm'})
                dados['items'] = [{'json': {**pedido, 'criadoEm': criado, 'privado': 'descartar'}}]
                recibo, = executar(nos[prox(fila)]['parameters']['jsCode'], dados)
                self.assertEqual(recibo, {'versao': 1, 'workflowId': wid, 'execucaoId': '7234', 'criadoEm': criado})

    def test_falha_expoe_so_etapa_aprovada_e_metadados(self):
        itens = [{'json': {'workflow': {'id': revisao.MEDICAO, 'name': 'conteúdo privado'},
                           'execution': {'id': '55', 'lastNodeExecuted': 'Ler contagens duráveis',
                                         'error': {'message': 'conteúdo privado'}, 'url': 'conteúdo privado'}}},
                 {'json': {'workflow': {'id': revisao.MEDICAO},
                           'execution': {'id': 'conteúdo privado', 'lastNodeExecuted': 'conteúdo privado'}}}]
        resultados = executar(codigo({}), {'id': 'falhas', 'items': itens})
        self.assertIn('Etapa: Ler contagens duráveis', resultados[0]['texto'])
        self.assertIn('Execução: 55', resultados[0]['texto'])
        self.assertIn('Responsável: Operação n8n', resultados[0]['texto'])
        self.assertRegex(resultados[0]['texto'], r'Detectado em: \d{4}-\d{2}-\d{2}T')
        self.assertNotIn('conteúdo privado', json.dumps(resultados, ensure_ascii=False))

    def test_sincronizador_reutiliza_contexto_do_gatilho_transplantado(self):
        entrada = {'id': 'webhook', 'name': 'Entrada', 'type': 'n8n-nodes-base.webhook'}
        destino = {'id': 'saida', 'name': 'Saída', 'type': 'n8n-nodes-base.code'}
        w = {'name': 'Prumo', 'nodes': [entrada, destino],
             'connections': {'Entrada': {'main': [[{'node': 'Saída', 'type': 'main', 'index': 0}]]}}}
        contexto = {'versao': 1, 'origem': 'fixture', 'organizacao_sha256': 'fixture'}
        composto = preparar(renomear(preparar(w, contexto), 'Site · '), contexto)
        self.assertEqual(len(composto['nodes']), 3)
        ctx = composto['connections']['Site · Entrada']['main'][0][0]['node']
        self.assertEqual(composto['connections'][ctx]['main'][0][0]['node'], 'Site · Saída')

    def test_rascunho_divergente_nao_e_ativado(self):
        w = {'id': 'fixture', 'name': 'Prumo', 'active': True, 'versionId': 'publicado',
             'activeVersionId': 'publicado', 'nodes': [], 'connections': {}, 'settings': {}}
        w['activeVersion'] = {'versionId': 'publicado', 'nodes': [], 'connections': {}}
        candidato = {**corpo(w), 'nodes': [{'id': 'novo'}]}
        rascunho = {**deepcopy(w), 'versionId': 'novo', 'nodes': [{'id': 'divergente'}]}
        ativar = Mock()
        with TemporaryDirectory() as pasta, patch.object(Path, 'home', return_value=Path(pasta)):
            ler = Mock(side_effect=[w, rascunho])
            with self.assertRaisesRegex(RuntimeError, 'Rascunho divergiu'):
                revisao.publicar(ler, Mock(return_value=rascunho), ativar, corpo,
                                 candidato, w, revisao.assinatura(candidato))
        ativar.assert_not_called()


if __name__ == '__main__':
    unittest.main()
