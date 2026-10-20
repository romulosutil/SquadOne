"""Alertas reais do dell-status com transportes dublês e HOME temporário.

No Windows só o import de fcntl é omitido; exercitamos _drenar, não simulamos
a garantia de flock. A suíte dell-status.test.py mantém essa prova no Linux.
"""
import ast
import hashlib
import json
import os
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

AQUI = Path(__file__).resolve().parent
HOME_TEMP = tempfile.TemporaryDirectory(prefix='alertas-home-')
os.environ['HOME'] = os.environ['USERPROFILE'] = HOME_TEMP.name
for chave in ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'SQUADONE_LEMBRETES_PELO_TELEGRAM']:
    os.environ.pop(chave, None)
fonte = ast.parse((AQUI / 'dell-status.py').read_text(encoding='utf-8'))
if os.name != 'posix':
    fonte.body = [n for n in fonte.body if not isinstance(n, ast.Import) or all(a.name != 'fcntl' for a in n.names)]
    for n in fonte.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'FUSO_BR' for t in n.targets):
            n.value = ast.parse('timezone(timedelta(hours=-3))', mode='eval').body
    ast.fix_missing_locations(fonte)
ds = types.ModuleType('dell_status_alertas_teste')
sys.modules[ds.__name__] = ds
exec(compile(fonte, str(AQUI / 'dell-status.py'), 'exec'), ds.__dict__)
TOKEN = '123456:' + 'X' * 35
T = datetime(2026, 10, 19, 15, tzinfo=timezone.utc)

class Resposta:
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def read(self, *_): return b'{"ok":true}'

class AlertasTelegram(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory(prefix='alertas-caso-')
        self.addCleanup(self.pasta.cleanup)
        raiz = Path(self.pasta.name)
        ds.FILA = raiz / 'fila'; ds.FILA.mkdir()
        ds.FILA_ESTADO = raiz / 'estado' / 'fila.json'
        ds.FILA_RECUSADOS = raiz / 'recusados'
        ds.OPERATIONS_ENV = raiz / 'operations.env'
        ds.OPERATIONS_ENV.write_text(f'TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_IDS=111\nSQUADONE_LEMBRETES_PELO_TELEGRAM=false\n')
        ds.FRESCOR_S = 0
        self.telegram, self.whatsapp, self.logs = [], [], []
        self.bot_ativo = True
        def enviar(req, timeout):
            self.telegram.append(json.loads(req.data))
            if not self.bot_ativo: raise ds.urllib.error.URLError('fora')
            return Resposta()
        for objeto, nome, valor in [(ds.urllib.request, 'urlopen', enviar), (ds, 'enviar', lambda texto: self.whatsapp.append(texto) or True), (ds, 'log', self.logs.append)]:
            p = mock.patch.object(objeto, nome, side_effect=valor); p.start(); self.addCleanup(p.stop)

    def aviso(self, nome='critico.json', prioridade=0, origem='teste', chave='fixture', expira=True):
        p = ds.FILA / nome
        dados = dict(titulo='Alerta fictício', texto='Serviço fictício indisponível', origem=origem, prioridade=prioridade, chave=chave)
        if expira: dados['expira_em'] = ds.iso(T - timedelta(days=1))
        p.write_text(json.dumps(dados), encoding='utf-8'); return p

    def test_p0_legado_expirado_aguarda_bot_e_retomada_so_telegram(self):
        p = self.aviso(); self.bot_ativo = False
        self.assertEqual(ds._drenar(T)['esperando'], 1)
        self.assertTrue(p.exists()); self.assertEqual(self.whatsapp, [])
        leitura = ds.fila_de_avisos()[0]
        self.assertEqual(leitura['estado'], 'atencao'); self.assertIn('aguardando Telegram', leitura['detalhe'])
        self.bot_ativo = True
        self.assertEqual(ds._drenar(T + timedelta(days=3))['pelo_telegram'], 1)
        self.assertFalse(p.exists()); self.assertEqual(self.whatsapp, [])
        self.assertEqual(self.telegram[-1]['chat_id'], 111, 'flag pessoal false não desativa alerta crítico')
        self.assertNotIn('disable_notification', self.telegram[-1])

    def test_receipt_persistente_deduplica_mesma_chave_apos_reinicio(self):
        self.aviso(); self.assertEqual(ds._drenar(T)['pelo_telegram'], 1)
        self.assertTrue(ds.FILA_ESTADO.exists())
        self.aviso('duplicado.json')
        self.assertEqual(ds._drenar(T + timedelta(minutes=1))['descartados'], 1)
        self.assertEqual(len(self.telegram), 1); self.assertEqual(self.whatsapp, [])
        self.assertEqual(list(ds.FILA_ESTADO.parent.glob('.*.tmp')), [])
        if os.name == 'posix': self.assertEqual(ds.FILA_ESTADO.stat().st_mode & 0o777, 0o600)

    def test_socorro_sem_bot_nao_bloqueia_aviso_normal_nem_cai_no_whatsapp(self):
        self.aviso(origem='socorro', prioridade=1)
        self.aviso('normal.json', prioridade=2, origem='normal', chave='normal', expira=False)
        self.bot_ativo = False
        r = ds._drenar(T)
        self.assertEqual((r['esperando'], r['enviados']), (1, 1)); self.assertEqual(len(self.whatsapp), 1)
        self.assertTrue((ds.FILA / 'critico.json').exists())

    def test_recibo_antigo_do_whatsapp_nao_finge_entrega_critica_no_telegram(self):
        self.aviso(prioridade=2, origem='normal', expira=False)
        self.assertEqual(ds._drenar(T)['enviados'], 1)
        self.aviso('p0.json')  # mesma chave, agora urgente; só um recibo Telegram pode confirmar a entrega
        self.assertEqual(ds._drenar(T + timedelta(minutes=1))['pelo_telegram'], 1)
        self.assertEqual(len(self.whatsapp), 1); self.assertEqual(len(self.telegram), 1)

    def test_transicao_e_recuperacao_persistem_mesmo_com_bot_fora(self):
        self.bot_ativo = False
        checks = [ds.check('fixture', 'servicos', 'Serviço fictício', 'falha', 'Sem resposta')]
        cursor = ds.avisar_transicoes(checks, {}, T)
        self.assertEqual(len(self.telegram), 0, 'publicar não cria segundo emissor')
        ds._drenar(T)
        ds.gravar_privado(Path(self.pasta.name) / 'cursor.json', cursor)
        cursor = json.loads((Path(self.pasta.name) / 'cursor.json').read_text())
        ds.avisar_transicoes([ds.check('fixture', 'servicos', 'Serviço fictício', 'ok', 'ok')], cursor, T + timedelta(minutes=1))
        self.assertEqual(len(list(ds.FILA.glob('*.json'))), 2)
        self.bot_ativo = True; self.assertEqual(ds._drenar(T + timedelta(minutes=2))['pelo_telegram'], 2)
        self.assertEqual(self.whatsapp, [])

    def test_falha_de_persistencia_nao_avanca_cursor_e_nao_cria_fila(self):
        ds.FILA.rmdir()
        c = [ds.check('fixture', 'servicos', 'Serviço fictício', 'falha', 'Sem resposta')]
        cursor = ds.avisar_transicoes(c, {}, T)
        self.assertTrue(cursor['fixture']['pendente']); self.assertNotIn('avisado', cursor['fixture'])
        self.assertFalse(ds.FILA.exists()); self.assertEqual(self.telegram, []); self.assertEqual(self.whatsapp, [])
        ds.FILA.mkdir(); ds.avisar_transicoes(c, cursor, T + timedelta(minutes=1))
        self.assertEqual(len(list(ds.FILA.glob('*.json'))), 1)

    def test_api_confirmou_ledger_falhou_mantem_pendente_sem_fallback(self):
        p = self.aviso()
        with mock.patch.object(ds, 'gravar_privado', side_effect=OSError('disco cheio')):
            with self.assertRaises(OSError): ds._drenar(T)
        self.assertTrue(p.exists()); self.assertEqual(self.whatsapp, [])

    def test_log_nao_carrega_token_nem_texto_do_alerta(self):
        self.bot_ativo = False; self.aviso(); ds._drenar(T)
        for linha in self.logs:
            self.assertNotIn(TOKEN, linha); self.assertNotIn('Serviço fictício indisponível', linha)

if __name__ == '__main__': unittest.main(verbosity=2)
