import importlib.util
from pathlib import Path
import unittest

from webhook_envios import incluir_envios


class WebhookEnvios(unittest.TestCase):
    def test_configuracao_anterior_perdia_evento_de_envio(self):
        atual = {'enabled': True, 'url': 'http://127.0.0.1:9131/evolution',
                 'headers': {'X-Adaptador': 'segredo-ficticio'}, 'webhookBase64': False,
                 'webhookByEvents': False,
                 'events': ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']}
        nova = incluir_envios(atual)['webhook']
        self.assertEqual(nova['events'], atual['events']+['SEND_MESSAGE'])
        self.assertEqual(nova['headers'], atual['headers'])
        self.assertEqual(nova['url'], atual['url'])
        self.assertFalse(nova['base64']); self.assertFalse(nova['byEvents'])
        self.assertNotIn('SEND_MESSAGE', atual['events'])
        atual['events'].append('SEND_MESSAGE')
        self.assertEqual(incluir_envios(atual)['webhook']['events'].count('SEND_MESSAGE'), 1)

    def test_webhook_desligado_nao_e_reativado(self):
        with self.assertRaises(ValueError):
            incluir_envios({'enabled': False, 'url': 'http://127.0.0.1', 'events': []})

    def test_evento_nativo_registra_saida_e_deduplica_upsert(self):
        arquivo = Path(__file__).parent.parent/'whatsapp-observador/evolution-adaptador.py'
        spec = importlib.util.spec_from_file_location('adaptador_envios_teste', arquivo)
        ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)
        numero = '5511999991111'; chave = ev.chave_do_numero(numero); vistos = ev.Recentes()
        evento = {'event': 'SEND_MESSAGE', 'instance': 'prumo', 'data': {
            'key': {'id': 'RECIBO-FICTICIO', 'remoteJid': numero+'@s.whatsapp.net', 'fromMe': True},
            'message': {'conversation': 'Mensagem de teste'}, 'messageTimestamp': 1794510000}}
        t = ev.traduzir(evento, {chave}, 1794510005, vistos, 'prumo')
        self.assertEqual(len(t.enviadas), 1); self.assertEqual(t.respostas, [])
        evento['event'] = 'MESSAGES_UPSERT'
        self.assertEqual(ev.traduzir(evento, {chave}, 1794510005, vistos, 'prumo').enviadas, ())
        evento['event'] = 'SEND_MESSAGE'
        self.assertEqual(ev.traduzir(evento, set(), 1794510005, ev.Recentes(), 'prumo').enviadas, ())


if __name__ == '__main__': unittest.main()
