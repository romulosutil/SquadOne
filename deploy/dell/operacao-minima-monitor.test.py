import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('monitor_minimo',Path(__file__).with_name('dell-status.py'))
ds=importlib.util.module_from_spec(spec);spec.loader.exec_module(ds)

class Monitor(unittest.TestCase):
    def test_pausa_explicita_nao_recomenda_religar_mapa_ou_funil_legado(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(ds,'OPERACAO_MINIMA',Path(temp)/'.config/claude-ops/workflow-minimo.json'), patch.object(ds,'MAPA_ENTREGAS',Path(temp)/'entregas'):
            p=Path(temp)/'.config/claude-ops/workflow-minimo.json';p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'versao':1,'estado':'preparado-pausado'}))
            self.assertTrue(ds.operacao_minima())
            self.assertEqual(ds.funil_aprendizado()[0]['estado'],'ok')
            with patch.object(ds,'_unit_resultado',return_value=('success',None)),patch.object(ds,'unit_ativa',return_value=False):
                self.assertEqual(ds.prumo_mapa()[0]['nome'],'Mapa sob pedido')
            p.write_text('{')
            self.assertFalse(ds.operacao_minima())

if __name__=='__main__':unittest.main()
