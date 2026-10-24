"""Somente fixtures e filesystem temporário; nenhuma rede, modelo ou CRM humano."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('publicador_crm',Path(__file__).with_name('publicador-crm.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
AGORA=1792854000
EM=m.iso(AGORA-10)
def retrato():
    return {'versao':1,'geradoEm':EM,'origem':'fixture','links':{},'fontes':{k:{'colunas':[],'linhas':[]} for k in m.FONTES}}
def envelope(n=1,d=None,arquivo='crm.json'):
    d=retrato() if d is None else d
    return {'v':1,'execucaoId':str(n),'arquivo':arquivo,'geradoEm':d.get('geradoEm',d.get('falhouEm')),'dados':d}
class PublicadorTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='publicador-crm-');self.addCleanup(self.tmp.cleanup)
        self.raiz=Path(self.tmp.name)/'estado';self.raiz.mkdir()
        self.spool=self.raiz/'crm-publicacao'
        for k in ('candidatos','prontos'):(self.spool/k).mkdir(parents=True,exist_ok=True)
    def candidato(self,n=1,d=None,arquivo='crm.json',ready=True):
        b=json.dumps(envelope(n,d,arquivo),ensure_ascii=False,separators=(',',':')).encode()
        nome='crm-'+str(n)+'.json';(self.spool/'candidatos'/nome).write_bytes(b)
        if ready:(self.spool/'prontos'/nome).write_text(json.dumps({'v':1,'execucaoId':str(n),'conteudoHash':hashlib.sha256(b).hexdigest()}))
        return b
    def publicar(self):return m.publicar(self.raiz,agora=AGORA)
    def atual(self,nome='crm.json'):return json.loads((self.raiz/nome).read_text(encoding='utf-8'))
    def test_publica_snapshot_inteiro_com_metadata_no_mesmo_json(self):
        b=self.candidato();r=self.publicar();d=self.atual()
        self.assertEqual(r['publicados'],1);self.assertEqual(d['publicacao']['execucaoId'],'1')
        self.assertEqual(d['publicacao']['conteudoHash'],hashlib.sha256(b).hexdigest())
        self.assertEqual({k:v for k,v in d.items() if k!='publicacao'},retrato())
    def test_relogio_avanca_depois_da_espera_pelo_lock(self):
        from contextlib import contextmanager
        tempo=[AGORA]
        @contextmanager
        def espera(_):
            tempo[0]+=20
            d=retrato();d['geradoEm']=m.iso(AGORA+10)
            self.candidato(1,d)
            yield
        with patch('time.time',side_effect=lambda:tempo[0]),patch.object(m,'exclusivo',espera):
            r=m.publicar(self.raiz)
        self.assertEqual(r['publicados'],1)
        self.assertEqual(r['falhasFonte'],0)
        self.assertEqual(self.atual()['publicacao']['publicadoEm'],m.iso(AGORA+20))
    def test_baseline_legado_preservado_ate_candidato_pronto(self):
        (self.raiz/'crm.json').write_text(json.dumps(retrato()));antes=(self.raiz/'crm.json').read_bytes()
        self.candidato(2,ready=False);r=self.publicar()
        self.assertEqual(r['orfaos'],1);self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
    def test_marcador_parcial_nao_quarentena_nem_apaga(self):
        self.candidato();p=self.spool/'prontos/crm-1.json';b=p.read_bytes();p.write_bytes(b[:12])
        self.assertEqual(self.publicar()['aguardando'],1);self.assertTrue(p.exists());self.assertFalse((self.raiz/'crm.json').exists())
        p.write_bytes(b);self.assertEqual(self.publicar()['publicados'],1)
    def test_candidato_parcial_e_hash_divergente_aguardam_conclusao(self):
        b=self.candidato();p=self.spool/'candidatos/crm-1.json';p.write_bytes(b[:20])
        self.assertEqual(self.publicar()['aguardando'],1);self.assertFalse((self.raiz/'crm.json').exists())
        p.write_bytes(b);self.assertEqual(self.publicar()['publicados'],1)
    def test_receipt_antes_do_arquivo_preserva_pendente(self):
        self.candidato();p=self.spool/'candidatos/crm-1.json';b=p.read_bytes();p.unlink()
        self.assertEqual(self.publicar()['aguardando'],1);p.write_bytes(b);self.assertEqual(self.publicar()['publicados'],1)
    def test_reinicio_nao_regride_execucao_antiga_mesmo_com_data_maior(self):
        self.candidato(20);self.publicar();antes=(self.raiz/'crm.json').read_bytes()
        d=retrato();d['geradoEm']=m.iso(AGORA-1);self.candidato(3,d)
        self.assertEqual(self.publicar()['antigos'],1);self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
    def test_replay_identico_nao_republica(self):
        self.candidato(3);self.publicar();antes=(self.raiz/'crm.json').read_bytes()
        self.candidato(3);self.assertEqual(self.publicar()['repetidos'],1);self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
    def test_mesmo_id_outro_hash_fica_conflito_nao_sobrescreve(self):
        self.candidato(3);self.publicar();antes=(self.raiz/'crm.json').read_bytes()
        d=retrato();d['origem']='outro';self.candidato(3,d);r=self.publicar()
        self.assertEqual(r['conflitos'],1);self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
        self.assertTrue((self.spool/'prontos/crm-3.json').exists())
    def test_fontes_opcionais_falhas_preservam_bom_e_sinalizam_sem_echo(self):
        self.candidato(1);self.publicar();antes=(self.raiz/'crm.json').read_bytes()
        d=retrato();d['fontes']['iris']['erro']='segredo e contato privado';self.candidato(2,d);r=self.publicar()
        self.assertEqual(r['falhasFonte'],1);self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
        f=self.atual('crm-falha.json');self.assertGreaterEqual(m.instante(f['falhouEm']),m.instante(self.atual()['geradoEm']))
        self.assertNotIn('segredo',json.dumps(f));self.assertEqual(f['publicacao']['execucaoId'],'2')
    def test_falha_legada_tambem_usa_protocolo_atomico(self):
        self.candidato(2,{'falhouEm':EM,'erro':'erro sensível'},'crm-falha.json');r=self.publicar()
        self.assertEqual(r['falhasFonte'],1);self.assertFalse((self.raiz/'crm.json').exists())
        self.assertNotIn('sensível',json.dumps(self.atual('crm-falha.json')))
    def test_falha_recente_bloqueia_snapshot_de_execucao_mais_antiga(self):
        self.candidato(1);self.publicar();self.candidato(4,{'falhouEm':EM,'erro':'fixture'},'crm-falha.json');self.publicar()
        self.candidato(3);self.assertEqual(self.publicar()['antigos'],1);self.assertEqual(self.atual()['publicacao']['execucaoId'],'1')
        self.candidato(5);self.assertEqual(self.publicar()['publicados'],1);self.assertEqual(self.atual()['publicacao']['execucaoId'],'5')
    def test_schema_incompleto_ou_futuro_nao_substitui_retrato(self):
        self.candidato(1);self.publicar();antes=(self.raiz/'crm.json').read_bytes()
        for n,delta in [(2,{'fontes':{}}),(3,{'geradoEm':m.iso(AGORA+30)}),(4,{'versao':2})]:
            d={**retrato(),**delta};self.candidato(n,d);self.assertEqual(self.publicar()['falhasFonte'],1)
            self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
    def test_colunas_rows_e_ids_validados_sem_reescrever_dados(self):
        for mutate in [lambda d:d['fontes']['registros'].update(linhas=[{'id':'x','texto':False}]),lambda d:d['fontes']['site'].update(linhas=[{'nome':'sem-id'}]),lambda d:d['fontes']['prumo'].update(colunas=[None])]:
            d=retrato();mutate(d)
            with self.assertRaises(ValueError):m.validar_envelope(envelope(1,d),'1',AGORA)
    def test_conteudo_unicode_preservado(self):
        d=retrato();d['fontes']['registros']={'colunas':['id','texto'],'linhas':[{'id':'fixture','texto':'Ação 😀 çã'}]}
        self.candidato(1,d);self.publicar();self.assertEqual(self.atual()['fontes'],d['fontes'])
    def test_falha_rename_nao_corta_ultimo_retrato(self):
        self.candidato(1);self.publicar();antes=(self.raiz/'crm.json').read_bytes();self.candidato(2)
        with patch.object(m.os,'replace',side_effect=OSError('fixture')):
            with self.assertRaises(OSError):self.publicar()
        self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
        self.assertTrue((self.spool/'prontos/crm-2.json').exists());self.assertEqual(self.publicar()['publicados'],1)
    def test_crash_depois_rename_reinicio_reconhece_metadata(self):
        self.candidato(4);real=m.sync_dir
        def crash(p):
            if p==self.raiz:raise OSError('crash pós rename')
            return real(p)
        with patch.object(m,'sync_dir',side_effect=crash):
            with self.assertRaises(OSError):self.publicar()
        self.assertEqual(self.atual()['publicacao']['execucaoId'],'4')
        self.assertEqual(self.publicar()['repetidos'],1)
    def test_corrupt_current_watermark_nao_reinicia_sequencia(self):
        self.candidato(1);self.publicar();d=self.atual();d['publicacao']['execucaoId']='inválido'
        (self.raiz/'crm.json').write_text(json.dumps(d));antes=(self.raiz/'crm.json').read_bytes();self.candidato(2)
        with self.assertRaises(ValueError):self.publicar()
        self.assertEqual((self.raiz/'crm.json').read_bytes(),antes)
    def test_fsync_precede_rename_e_status_sem_payload(self):
        self.candidato();ops=[];sync=m.os.fsync;replace=m.os.replace
        with patch.object(m.os,'fsync',side_effect=lambda f:(ops.append('fsync'),sync(f))[1]),patch.object(m.os,'replace',side_effect=lambda a,b:(ops.append('rename'),replace(a,b))[1]):self.publicar()
        self.assertEqual(ops[0],'fsync');self.assertIn('rename',ops)
        s=(self.spool/'status.json').read_text(encoding='utf-8');self.assertNotIn('fontes',s)
        if os.name!='nt':
            self.assertEqual((self.raiz/'crm.json').stat().st_mode&0o777,0o600);self.assertEqual(self.spool.stat().st_mode&0o777,0o700)
    def test_nomes_arbitrarios_e_symlink_nao_entram(self):
        (self.spool/'prontos/nao-executar.json').write_text('{}')
        self.assertEqual(self.publicar()['publicados'],0)
        if os.name!='nt':
            externo=Path(self.tmp.name)/'externo';externo.write_text('fixture')
            (self.spool/'prontos/crm-1.json').symlink_to(externo)
            with self.assertRaises(OSError):self.publicar()
    @unittest.skipIf(os.name=='nt','rename concorrente é validado no alvo Linux')
    def test_leitor_concorrente_so_observa_json_inteiro(self):
        self.candidato(1);self.publicar();parar=threading.Event();erros=[]
        def ler():
            while not parar.is_set():
                try:self.assertEqual(json.loads((self.raiz/'crm.json').read_text(encoding='utf-8'))['versao'],1)
                except Exception as e:erros.append(type(e).__name__)
        thread=threading.Thread(target=ler);thread.start()
        try:
            for n in range(2,12):self.candidato(n);self.publicar()
        finally:parar.set();thread.join()
        self.assertFalse(erros)
    @unittest.skipIf(m.fcntl is None,'flock é validado no alvo Linux')
    def test_dois_processos_publicam_uma_vez_sob_lock(self):
        self.candidato(11)
        cmd=[sys.executable,str(Path(__file__).with_name('publicador-crm.py')),'--estado',str(self.raiz)]
        ps=[subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(2)]
        for p in ps:
            _,err=p.communicate(timeout=10);self.assertEqual(p.returncode,0,err)
        self.assertEqual(self.atual()['publicacao']['execucaoId'],'11')

    def test_bom_posterior_remove_status_falha_obsoleto_sem_fingir_novo_horario(self):
        self.candidato(1,{'falhouEm':EM,'erro':'fixture'},'crm-falha.json')
        self.candidato(2)
        self.assertEqual(self.publicar()['publicados'],1)
        self.assertFalse((self.raiz/'crm-falha.json').exists())
        self.assertEqual(self.atual()['geradoEm'],EM)
    def test_crash_bom_antes_de_limpar_falha_reconcilia_no_reinicio(self):
        self.candidato(1,{'falhouEm':EM,'erro':'fixture'},'crm-falha.json');self.publicar()
        self.candidato(2);real=m.limpar_falha_superada
        def interromper(p):
            if (p/'crm.json').exists() and json.loads((p/'crm.json').read_text(encoding='utf-8')).get('publicacao',{}).get('execucaoId')=='2':raise OSError('fixture')
            return real(p)
        with patch.object(m,'limpar_falha_superada',side_effect=interromper):
            with self.assertRaises(OSError):self.publicar()
        self.assertTrue((self.raiz/'crm-falha.json').exists())
        self.assertEqual(self.publicar()['repetidos'],1)
        self.assertFalse((self.raiz/'crm-falha.json').exists())
if __name__=='__main__':unittest.main()
