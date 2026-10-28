#!/usr/bin/env python3
"""Fixtures isoladas: não consulta rede, clientes, systemd ou geradores reais."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('materiais', Path(__file__).with_name('encontrado-materiais.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Materiais(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.raiz = Path(self.tmp.name)
        self.auto = self.raiz / 'auto'
        self.fila = self.raiz / 'fila'
        self.pasta = self.auto / '_em-conversa/empresa-ficticia'
        self.pasta.mkdir(parents=True)
        self.fila.mkdir()
        self.patch = patch.multiple(m, AUTO=self.auto, FILA=self.fila, HOME=self.raiz)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.p = dict(v=1, id='a' * 64, tipo='demo', slug=self.pasta.name, placeId='ChIJficticio', em='2026-10-25T21:00:00.000Z')
        self.pub = types.SimpleNamespace(
            referencia=lambda s: 'lead:' + hashlib.sha256(s.encode()).hexdigest()[:24],
            versao=lambda a: 'sha256:' + hashlib.sha256(b''.join(n.encode() + b'\x00' + b for n, b in sorted(a.items()))).hexdigest(),
            MARCA='data-prumo-homologacao="1"',
            decidir=lambda *a, **kw: dict(profissional=True))
        q = types.SimpleNamespace(digest=lambda p: 'organizacao-conferida', ler=lambda p: json.loads(p.read_text()))
        self.lib = types.SimpleNamespace(motor=lambda: (self.raiz, q, self.pub))
        self.libs = patch.dict(sys.modules, qualidade_prumo=self.lib)
        self.libs.start()
        self.addCleanup(self.libs.stop)
        (self.pasta / 'content.md').write_text('- **place_id:** ChIJficticio', encoding='utf-8')
        (self.fila / (self.p['id'] + '.json')).write_text(json.dumps(self.p))

    def gravar(self, p, valor):
        p.write_text(json.dumps(valor))

    def publicado(self, raio=False):
        corpo = b'<body data-prumo-homologacao="1">Previa ficticia</body>'
        if raio:
            self.p['tipo'] = 'raio-x'
            nome, tipo = 'empresa-ficticia.html', 'raio-x'
            (self.pasta / 'raio-x.html').write_bytes(corpo)
            url = 'https://raio-x-prumo.vercel.app/empresa-ficticia'
        else:
            nome, tipo = 'index.html', 'site'
            (self.pasta / nome).write_bytes(corpo)
            url = 'https://demo-empresa-ficticia.vercel.app'
        recibo = dict(produto_id=tipo, referencia=self.pub.referencia(self.p['placeId']), versao=self.pub.versao({nome: corpo}), profissional=False, estado='homologacao', organizacao_sha256='organizacao-conferida')
        self.gravar(self.pasta / f'.prumo-qualidade-{tipo}.json', recibo)
        r = dict(place_id=self.p['placeId'], vercel_project='demo-empresa-ficticia')
        r.update({'raio_x_url': url, 'qualidade_raio_x': recibo} if raio else {'site_url': url, 'qualidade': recibo})
        self.gravar(self.pasta / 'publicado.json', r)
        return corpo, recibo, r

    def test_previa_pronta_exige_pacote_referencia_e_publicacao(self):
        corpo, _, _ = self.publicado()
        r = m.conferir(self.p, fetch=lambda u: corpo)
        self.assertEqual((r['estado'], r['qualidade']), ('pronto', 'homologacao'))

    def test_raio_x_avulso_tem_manifesto_com_o_nome_publicado(self):
        corpo, _, _ = self.publicado(raio=True)
        self.assertEqual(m.conferir(self.p, fetch=lambda u: corpo)['estado'], 'pronto')

    def test_mudanca_de_bytes_bloqueia_mesmo_com_recibo_antigo(self):
        self.publicado()
        (self.pasta / 'index.html').write_bytes(b'outro arquivo')
        with self.assertRaises(ValueError):
            m.conferir(self.p, fetch=lambda u: b'outro arquivo')

    def test_versao_no_ar_diferente_bloqueia(self):
        self.publicado()
        with self.assertRaises(ValueError):
            m.conferir(self.p, fetch=lambda u: b'diferente')

    def test_outro_lead_ou_url_nao_eh_usado(self):
        corpo, recibo, r = self.publicado()
        for url in ('https://outro.vercel.app', 'http://127.0.0.1', 'https://demo-empresa-ficticia.vercel.app@localhost', 'https://demo-empresa-ficticia.vercel.app/?url=outro'):
            r['site_url'] = url
            self.gravar(self.pasta / 'publicado.json', r)
            with self.assertRaises(ValueError):
                m.conferir(self.p, fetch=lambda u: self.fail('Não consultar URL fora da publicação'))
        r['site_url'] = 'https://demo-empresa-ficticia.vercel.app'
        recibo['referencia'] = self.pub.referencia('outro-lead')
        self.gravar(self.pasta / '.prumo-qualidade-site.json', recibo)
        self.gravar(self.pasta / 'publicado.json', r)
        with self.assertRaises(ValueError):
            m.conferir(self.p, fetch=lambda u: corpo)

    def test_profissional_nao_confia_apenas_na_flag_do_gerador(self):
        corpo, recibo, r = self.publicado()
        recibo.update(profissional=True, estado='profissional')
        self.gravar(self.pasta / '.prumo-qualidade-site.json', recibo)
        self.gravar(self.pasta / 'publicado.json', r)
        with self.assertRaises((ValueError, FileNotFoundError)):
            m.conferir(self.p, fetch=lambda u: corpo)

    def test_pasta_ambigua_e_encerramento_impedem_geracao(self):
        copia = self.auto / self.pasta.name
        copia.mkdir()
        (copia / 'content.md').write_text('- **place_id:** ChIJficticio')
        with self.assertRaises(ValueError):
            m.localizar(self.p)
        (copia / 'content.md').unlink()
        copia.rmdir()
        destino = self.auto / '_recusados' / self.pasta.name
        destino.parent.mkdir()
        self.pasta.rename(destino)
        with self.assertRaises(ValueError):
            m.localizar(self.p)

    def test_sem_autorizacao_atual_nao_gera_nem_consulta_material(self):
        with patch.object(m, 'autorizar', return_value=False), patch.object(m, 'preparar', side_effect=AssertionError), patch.object(m, 'conferir', side_effect=AssertionError):
            m.rodada()
        self.assertFalse((self.fila / (self.p['id'] + '.tentativa.json')).exists())

    def test_demo_tem_pedido_duravel_e_origem_cliente_sem_falso_gesto_humano(self):
        with patch.object(m.subprocess, 'run') as run:
            m.preparar(self.p, self.pasta)
            pedido = m.ler(self.pasta / 'PEDIDO-DEMO.json')
            self.assertIn('cliente', pedido['origem'])
            self.assertNotIn('Rômulo', pedido['origem'])
            m.preparar(self.p, self.pasta)
            self.assertEqual(run.call_count, 2)  # Consulta + única partida; não repete depois da reserva.
            self.assertEqual(pedido, m.ler(self.pasta / 'PEDIDO-DEMO.json'))

    def test_demo_aguarda_servico_ocupado_antes_de_reservar_a_partida(self):
        with patch.object(m.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)) as run:
            m.preparar(self.p, self.pasta)
            self.assertEqual(run.call_count, 1)
            self.assertFalse((self.fila / (self.p['id'] + '.tentativa.json')).exists())
        with patch.object(m.subprocess, 'run', return_value=types.SimpleNamespace(returncode=3)) as run:
            m.preparar(self.p, self.pasta)
            m.preparar(self.p, self.pasta)
            self.assertEqual(run.call_count, 2)
            self.assertTrue((self.fila / (self.p['id'] + '.tentativa.json')).exists())

    def test_raio_x_crash_nao_publica_novamente(self):
        self.p['tipo'] = 'raio-x'
        with patch.object(m.subprocess, 'run', side_effect=TimeoutError) as run:
            with self.assertRaises(TimeoutError):
                m.preparar(self.p, self.pasta)
            m.preparar(self.p, self.pasta)
            self.assertEqual(run.call_count, 1)

    def test_comando_injetado_e_symlink_sao_recusados(self):
        self.p['slug'] = '../outro;comando'
        self.gravar(self.fila / (self.p['id'] + '.json'), self.p)
        with self.assertRaises(ValueError):
            m.pedido(self.p['id'])
        self.p['slug'] = self.pasta.name
        alvo = self.raiz / 'outro.md'
        alvo.write_text('- **place_id:** ChIJficticio')
        (self.pasta / 'content.md').unlink()
        (self.pasta / 'content.md').symlink_to(alvo)
        with self.assertRaises(ValueError):
            m.localizar(self.p)


if __name__ == '__main__':
    unittest.main()
