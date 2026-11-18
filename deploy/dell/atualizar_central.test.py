import importlib.util
import hashlib
import json
import io
import tarfile
import types
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('updater',pathlib.Path(__file__).with_name('atualizar_central.py'))
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)

class Updater(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=pathlib.Path(self.tmp.name); self.data=self.home/'data';self.data.mkdir()
        self.root=self.home/'repo';self.root.mkdir();(self.root/'.git').mkdir();(self.root/'node_modules').mkdir()
        self.state=self.home/'state';self.state.mkdir()
        for f in ('frente-comercial-config.json','campanha-site-ativa.json'):
            (self.data/f).write_text('{"ativo":false}',encoding='utf8')
        self.pagina_linkedin = self.home/'pagina-instalada.html'
        self.patches=[patch.object(u,'DATA',self.data),patch.object(u,'ROOT',self.root),patch.object(u,'STATE',self.state),
                      patch.object(u,'PAGINA_LINKEDIN',self.pagina_linkedin)]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def fake_cmd(self,*args,**kwargs):
        if 'UnitFileState' in args:return 'disabled'
        if 'show' in args:return 'inactive'
        return ''
    def test_retira_coletor_pausado_com_backup_e_repeticao_segura(self):
        exec_path = self.home / '.local/bin/hermes-uso-skills'
        exec_path.parent.mkdir(parents=True)
        exec_path.write_bytes(b'legado')
        arquivos = {'.local/bin/hermes-uso-skills': hashlib.sha256(b'legado').hexdigest()}
        backup = self.state / 'retiradas/hermes-uso-skills'

        def systemctl(*args):
            if 'UnitFileState' in args:
                return 'disabled' if 'hermes-uso-skills.timer' in args else 'static'
            if 'ActiveState' in args:
                return 'inactive'
            return ''

        with patch.object(u, 'COLETOR_APOSENTADO', arquivos), patch.object(u, 'cmd', side_effect=systemctl) as command:
            u.retirar_coletor_skills(self.home, backup)
            self.assertFalse(exec_path.exists())
            self.assertEqual((backup / exec_path.name).read_bytes(), b'legado')
            self.assertTrue((backup / 'concluido').is_file())
            command.reset_mock()
            u.retirar_coletor_skills(self.home, backup)
            command.assert_not_called()

    def test_preserva_coletor_com_copia_divergente(self):
        exec_path = self.home / '.local/bin/hermes-uso-skills'
        exec_path.parent.mkdir(parents=True)
        exec_path.write_bytes(b'alterado')
        backup = self.state / 'retiradas/hermes-uso-skills'

        def systemctl(*args):
            if 'UnitFileState' in args:
                return 'disabled' if 'hermes-uso-skills.timer' in args else 'static'
            return 'inactive'

        with patch.object(u, 'cmd', side_effect=systemctl):
            with self.assertRaisesRegex(u.Bloqueado, 'Cópia divergente'):
                u.retirar_coletor_skills(self.home, backup)
        self.assertEqual(exec_path.read_bytes(), b'alterado')
        self.assertFalse(backup.exists())

    def test_guardas_exigem_trava_timers_servicos_e_config(self):
        good={'aquisicao':{'estado':'bloqueada','primeirosContatosAutomaticos':False},'proximoEnvioEm':None}
        with patch.object(u,'cmd',side_effect=self.fake_cmd),patch.object(u,'ler_api',return_value=good):
            u.guardas()
            (self.data/'campanha-site-ativa.json').write_text('{"ativo":true}',encoding='utf8')
            with self.assertRaises(u.Bloqueado):u.guardas()
            (self.data/'campanha-site-ativa.json').write_text('{}',encoding='utf8')
            with self.assertRaises(u.Bloqueado):u.guardas()
        (self.data/'campanha-site-ativa.json').write_text('{"ativo":false}',encoding='utf8')
        with patch.object(u,'cmd',side_effect=self.fake_cmd),patch.object(u,'ler_api',return_value={'aquisicao':{'estado':'bloqueada'}}):
            with self.assertRaises(u.Bloqueado):u.guardas()
        with patch.object(u,'cmd',return_value='active'),patch.object(u,'ler_api',return_value=good):
            with self.assertRaises(u.Bloqueado):u.guardas()
        for previsao in ('ausente','2027-01-01'):
            f={'aquisicao':good['aquisicao']}
            if previsao != 'ausente': f['proximoEnvioEm']=previsao
            with patch.object(u,'cmd',side_effect=self.fake_cmd),patch.object(u,'ler_api',return_value=f):
                with self.assertRaises(u.Bloqueado):u.guardas()
    def test_primeiro_contato_nao_exige_bloqueio_total_mas_proibe_resposta_automatica(self):
        good={'aquisicao':{'estado':'primeiro-contato','primeirosContatosAutomaticos':True,'respostasAutomaticas':False}}
        with patch.object(u,'cmd',side_effect=self.fake_cmd),patch.object(u,'ler_api',return_value=good):
            u.guardas()
        for valor in (True,None,'false'):
            bad={'aquisicao':{**good['aquisicao'],'respostasAutomaticas':valor}}
            with patch.object(u,'cmd',side_effect=self.fake_cmd),patch.object(u,'ler_api',return_value=bad):
                with self.assertRaises(u.Bloqueado):u.guardas()
    def test_so_false_literal_autoriza_reinicio(self):
        for x in ({},{'ocupado':True},{'ocupado':None},{'ocupado':0},{'ocupado':'false'}):
            with self.subTest(x=x),patch.object(u,'ler_api',return_value=x):
                with self.assertRaises(u.Bloqueado):u.ocioso()
        with patch.object(u,'ler_api',return_value={'ocupado':False}):u.ocioso()
        with patch.object(u,'ler_api',side_effect=u.Bloqueado('API')):
            with self.assertRaises(u.Bloqueado):u.ocioso()
    def test_dirty_interrompe_antes_fetch(self):
        calls=[]
        def git(*a):calls.append(a);return ' M arquivo' if a[0]=='status' else ''
        with patch.object(u,'guardas'),patch.object(u,'git',side_effect=git),patch('sys.argv',['updater']):
            with self.assertRaises(u.Bloqueado):u.main()
        self.assertEqual([x[0] for x in calls],['status'])
    def test_ocupacao_transitoria_aguarda_false_sem_forcar_ou_aceitar_ambiguidade(self):
        with patch.object(u,'ler_api',side_effect=[{'ocupado':True},{'ocupado':False}]) as api,patch.object(u.time,'sleep') as dormir:
            u.ocioso(45)
        self.assertEqual(api.call_count,2);dormir.assert_called_once_with(1)
        with patch.object(u,'ler_api',return_value={}),patch.object(u.time,'sleep') as dormir:
            with self.assertRaises(u.Bloqueado):u.ocioso(45)
            dormir.assert_not_called()
    def test_noop_com_commit_instalado_nao_builda_nem_reinicia(self):
        (self.state/'construido').write_text('abc\n',encoding='ascii')
        def git(*a):return 'abc' if a[0]=='rev-parse' else ''
        with patch.object(u,'guardas') as g,patch.object(u,'git',side_effect=git),patch.object(u,'construir') as build,patch.object(u,'cmd') as command,patch('sys.argv',['updater','--se-mudou']):
            u.main();g.assert_called_once();build.assert_not_called();command.assert_not_called()
    def test_sucesso_revalida_antes_e_depois_e_guarda_bundle(self):
        (self.root/'dist').mkdir();(self.root/'dist/server.cjs').write_text('antigo')
        self.pagina_linkedin.write_bytes(b'pagina auxiliar instalada')
        def git(*a):return 'abc' if a[0]=='rev-parse' else ''
        def build(stage,target,*flags):
            (stage/'dist').mkdir();(stage/'dist/server.cjs').write_text('novo')
            if flags[0]: (stage/'node_modules').mkdir()
        with patch.object(u,'guardas') as g,patch.object(u,'ocioso') as idle,patch.object(u,'git',side_effect=git),patch.object(u,'construir',side_effect=build),patch.object(u,'cmd') as command,patch('sys.argv',['updater']):
            u.main()
        self.assertGreaterEqual(g.call_count,4);self.assertEqual(idle.call_count,3)
        self.assertEqual([x.args[2] for x in command.call_args_list],['stop','start'])
        self.assertEqual((self.root/'dist/server.cjs').read_text(),'novo')
        self.assertEqual((self.root/'dist/linkedin.html').read_bytes(), b'pagina auxiliar instalada')
        self.assertEqual(next(self.state.glob('dist-backup-*')).joinpath('server.cjs').read_text(),'antigo')
        self.assertEqual((self.state/'construido').read_text().strip(),'abc')

    def test_pagina_linkedin_do_proprio_build_tem_precedencia(self):
        self.pagina_linkedin.write_bytes(b'instalada')
        (self.root/'dist').mkdir()
        (self.root/'dist/server.cjs').write_bytes(b'antigo')
        def git(*a):return 'abc' if a[0]=='rev-parse' else ''
        def build(stage, target, *flags):
            (stage/'dist').mkdir()
            (stage/'dist/server.cjs').write_bytes(b'bundle')
            (stage/'dist/linkedin.html').write_bytes(b'versionada')
            if flags[0]: (stage/'node_modules').mkdir()
        with patch.object(u,'guardas'),patch.object(u,'ocioso'),patch.object(u,'git',side_effect=git), \
             patch.object(u,'construir',side_effect=build),patch.object(u,'cmd'),patch('sys.argv',['updater']):
            u.main()
        self.assertEqual((self.root/'dist/linkedin.html').read_bytes(), b'versionada')
    def test_ocupado_apos_build_nao_mescla_troca_ou_reinicia(self):
        calls=[]
        def git(*a):
            calls.append(a)
            return ('velho' if a[1]=='HEAD' else 'novo') if a[0]=='rev-parse' else ''
        with patch.object(u,'guardas'),patch.object(u,'ocioso',side_effect=u.Bloqueado('ocupado')),patch.object(u,'git',side_effect=git),patch.object(u,'construir'),patch.object(u,'cmd') as command,patch('sys.argv',['updater']):
            with self.assertRaises(u.Bloqueado):u.main()
        self.assertFalse(any(c[0]=='merge' for c in calls));command.assert_not_called()
    def test_falha_de_validacao_nao_mescla_troca_nem_reinicia(self):
        calls=[]
        def git(*a):
            calls.append(a)
            return ('velho' if a[1]=='HEAD' else 'novo') if a[0]=='rev-parse' else ''
        with patch.object(u,'guardas'),patch.object(u,'git',side_effect=git),patch.object(u,'construir',side_effect=u.Bloqueado('teste falhou')),patch.object(u,'cmd') as command,patch('sys.argv',['updater']):
            with self.assertRaises(u.Bloqueado):u.main()
        self.assertFalse(any(c[0]=='merge' for c in calls));command.assert_not_called()
    def test_falha_de_restart_para_central_e_restaura_bundle(self):
        (self.root/'dist').mkdir();(self.root/'dist/server.cjs').write_text('antigo')
        def git(*a):return 'abc' if a[0]=='rev-parse' else ''
        def build(stage,target,*flags):
            (stage/'dist').mkdir();(stage/'dist/server.cjs').write_text('novo')
            if flags[0]: (stage/'node_modules').mkdir()
        tentativas=[]
        def command(*a,**kw):
            if 'show' in a:return 'failed'
            if 'start' in a:
                tentativas.append(1)
                if len(tentativas)==1: raise u.Bloqueado('falhou')
        with patch.object(u,'guardas'),patch.object(u,'ocioso'),patch.object(u,'git',side_effect=git),patch.object(u,'construir',side_effect=build),patch.object(u,'cmd',side_effect=command) as c,patch('sys.argv',['updater']):
            with self.assertRaises(u.Bloqueado):u.main()
        self.assertEqual((self.root/'dist/server.cjs').read_text(),'antigo')
        self.assertFalse((self.state/'construido').exists())
        self.assertEqual(c.call_args_list[-1].args,('systemctl','--user','start','squadone-operations.service'))
    def test_somente_documentacao_valida_sem_build_ou_restart(self):
        (self.state/'construido').write_text('velho\n',encoding='ascii')
        def git(*a):
            if a[0]=='rev-parse':return 'velho' if a[1]=='HEAD' else 'novo'
            if a[0]=='diff':return 'docs/guia.md'
            return ''
        with patch.object(u,'guardas'),patch.object(u,'ocioso'),patch.object(u,'git',side_effect=git) as g,patch.object(u,'construir') as build,patch.object(u,'cmd') as c,patch('sys.argv',['updater']):
            u.main()
        self.assertTrue(build.call_args.args[3])
        c.assert_not_called()
        self.assertIn(('merge','--ff-only','novo'),[x.args for x in g.call_args_list])
        self.assertEqual((self.state/'construido').read_text().strip(),'novo')
    def test_codigo_deploy_exige_build_do_candidato(self):
        (self.state/'construido').write_text('velho\n',encoding='ascii')
        def git(*a):
            if a[0]=='rev-parse':return 'velho' if a[1]=='HEAD' else 'novo'
            if a[0]=='diff':return 'deploy/dell/novo_executor.py'
            return ''
        def build(stage,target,deps,docs):
            self.assertEqual(target,'novo'); self.assertFalse(docs)
            raise u.Bloqueado('candidato inválido')
        with patch.object(u,'guardas'),patch.object(u,'git',side_effect=git),patch.object(u,'construir',side_effect=build),patch('sys.argv',['updater']):
            with self.assertRaises(u.Bloqueado):u.main()
        def git_ops(*a):
            if a[0]=='rev-parse':return 'velho' if a[1]=='HEAD' else 'novo'
            if a[0]=='diff':return 'ops/workflow.json'
            return ''
        with patch.object(u,'guardas'),patch.object(u,'git',side_effect=git_ops),patch.object(u,'construir',side_effect=build),patch('sys.argv',['updater']):
            with self.assertRaises(u.Bloqueado):u.main()
    def test_dependencias_novas_sao_trocadas_e_revertidas_com_bundle(self):
        (self.root/'dist').mkdir();(self.root/'dist/server.cjs').write_text('antigo')
        (self.root/'node_modules/versao').write_text('antiga')
        (self.root/'runtime.json').write_text('antigo')
        (self.state/'construido').write_text('velho',encoding='ascii')
        head=['velho']
        def git(*a):
            if a[0]=='rev-parse':return head[0] if a[1]=='HEAD' else 'novo'
            if a[0]=='diff':return 'package.json'
            if a[0]=='show':return '{"dependencies":{"pacote":"1"}}' if a[1].startswith('velho:') else '{"dependencies":{"pacote":"2"}}'
            if a[0]=='merge':head[0]='novo';(self.root/'runtime.json').write_text('novo')
            if a[0]=='reset':
                self.assertEqual(a,('reset','--keep','velho'))
                head[0]='velho';(self.root/'runtime.json').write_text('antigo')
            return ''
        def build(stage,target,deps,docs):
            self.assertTrue(deps);self.assertFalse(docs)
            (stage/'dist').mkdir();(stage/'dist/server.cjs').write_text('novo')
            (stage/'node_modules').mkdir();(stage/'node_modules/versao').write_text('nova')
        tentativas=[]
        def command(*a,**kw):
            if 'show' in a:return 'failed'
            if 'start' in a:
                tentativas.append(1)
                if len(tentativas)==1:raise u.Bloqueado('falha no candidato')
        with patch.object(u,'guardas'),patch.object(u,'ocioso'),patch.object(u,'git',side_effect=git),patch.object(u,'construir',side_effect=build),patch.object(u,'cmd',side_effect=command),patch('sys.argv',['updater']):
            with self.assertRaises(u.Bloqueado):u.main()
        self.assertEqual((self.root/'dist/server.cjs').read_text(),'antigo')
        self.assertEqual((self.root/'node_modules/versao').read_text(),'antiga')
        self.assertEqual((self.state/'construido').read_text(),'velho')
        self.assertEqual(head[0],'velho');self.assertEqual((self.root/'runtime.json').read_text(),'antigo')
        self.assertEqual(len(tentativas),2)
    def test_package_somente_scripts_reusa_dependencias_e_mudanca_real_instala(self):
        base={'dependencies':{'vue':'1'},'scripts':{'test':'antes'}}
        so_scripts={'dependencies':{'vue':'1'},'scripts':{'test':'depois'}}
        nova_dep={'dependencies':{'vue':'2'},'scripts':{'test':'depois'}}
        def git_pacotes(candidato):
            return lambda *a: json.dumps(base if a[1].startswith('antigo:') else candidato)
        with patch.object(u,'git',side_effect=git_pacotes(so_scripts)):
            self.assertFalse(u.dependencias_mudaram(['package.json'],'antigo','novo'))
            self.assertTrue(u.dependencias_mudaram(['package.json','bun.lock'],'antigo','novo'))
        with patch.object(u,'git',side_effect=git_pacotes(nova_dep)):
            self.assertTrue(u.dependencias_mudaram(['package.json'],'antigo','novo'))
        self.assertTrue(u.dependencias_mudaram(['sem-base'],'','novo'))
    def test_edicao_concorrente_impede_reset_e_reinicio_ao_recuperar(self):
        (self.root/'dist').mkdir();(self.root/'dist/server.cjs').write_text('antigo')
        head=['velho']; concorrente=[False]; calls=[]
        def git(*a):
            calls.append(a)
            if a[0]=='status':return ' M arquivo' if concorrente[0] else ''
            if a[0]=='rev-parse':return head[0] if a[1]=='HEAD' else 'novo'
            if a[0]=='merge':head[0]='novo'
            return ''
        def build(stage,target,deps,docs):
            (stage/'dist').mkdir();(stage/'dist/server.cjs').write_text('novo')
            if deps: (stage/'node_modules').mkdir()
        def command(*a,**kw):
            if 'show' in a:return 'failed'
            if 'start' in a:
                concorrente[0]=True
                raise u.Bloqueado('falha no candidato')
        with patch.object(u,'guardas'),patch.object(u,'ocioso'),patch.object(u,'git',side_effect=git),patch.object(u,'construir',side_effect=build),patch.object(u,'cmd',side_effect=command) as c,patch('sys.argv',['updater']):
            with self.assertRaisesRegex(u.Bloqueado,'checkout mudou'):u.main()
        self.assertFalse(any(a[0]=='reset' for a in calls))
        self.assertEqual(sum('start' in x.args for x in c.call_args_list),1)
        self.assertEqual(c.call_args_list[-1].args,('systemctl','--user','show','squadone-operations.service','-p','ActiveState','--value'))
        self.assertEqual(head[0],'novo')
    def test_reset_keep_real_restaura_arquivo_de_runtime_e_preserva_nao_rastreado(self):
        import shutil
        shutil.rmtree(self.root/'.git')
        def executar(*args):
            return subprocess.run(['git',*args],cwd=self.root,capture_output=True,text=True,check=True).stdout.strip()
        executar('init');executar('config','user.email','teste@example.invalid');executar('config','user.name','Teste')
        (self.root/'runtime.json').write_text('antigo');executar('add','runtime.json');executar('commit','-m','antes')
        anterior=executar('rev-parse','HEAD')
        (self.root/'runtime.json').write_text('novo');executar('commit','-am','depois')
        (self.root/'trabalho-nao-rastreado').write_text('preservar')
        executar('reset','--keep',anterior)
        self.assertEqual((self.root/'runtime.json').read_text(),'antigo')
        self.assertEqual((self.root/'trabalho-nao-rastreado').read_text(),'preservar')
    def test_pos_verificacao_ambigua_com_turno_ativo_nao_para_nem_reverte(self):
        (self.root/'dist').mkdir();(self.root/'dist/server.cjs').write_text('antigo')
        def git(*a):return 'abc' if a[0]=='rev-parse' else ''
        def build(stage,target,deps,docs):
            (stage/'dist').mkdir();(stage/'dist/server.cjs').write_text('novo')
            if deps:(stage/'node_modules').mkdir()
        guardas=iter([None,None,None,None] + [u.Bloqueado('resposta lenta')]*30)
        def guarda():
            r=next(guardas)
            if r:raise r
        ocupado=iter([None,None,None,u.Bloqueado('ocupado')])
        def idle(*_args):
            r=next(ocupado)
            if r:raise r
        def command(*a,**kw):return 'active' if 'show' in a else ''
        with patch.object(u,'guardas',side_effect=guarda),patch.object(u,'ocioso',side_effect=idle),patch.object(u,'git',side_effect=git) as g,patch.object(u,'construir',side_effect=build),patch.object(u,'cmd',side_effect=command) as c,patch.object(u.time,'sleep'),patch('sys.argv',['updater']):
            with self.assertRaisesRegex(u.Bloqueado,'ocupada ou estado incerto'):u.main()
        self.assertEqual(sum('stop' in x.args for x in c.call_args_list),1)
        self.assertFalse(any(x.args[0]=='reset' for x in g.call_args_list))
        self.assertEqual((self.root/'dist/server.cjs').read_text(),'novo')
        self.assertTrue(list(self.state.glob('dist-backup-*')))
    def test_estagio_instala_dependencias_e_testa_candidato(self):
        (self.root/'.env').write_text('VITE_GOOGLE_CLIENT_ID=falso\n',encoding='utf8')
        for com_lock in (False, True):
            with self.subTest(lock=com_lock),tempfile.TemporaryDirectory() as t:
                stage=pathlib.Path(t);stream=io.BytesIO()
                with tarfile.open(fileobj=stream,mode='w') as ar:
                    for name in (['package.json','package-lock.json'] if com_lock else ['package.json']):
                        b=b'{}';entry=tarfile.TarInfo(name);entry.size=len(b);ar.addfile(entry,io.BytesIO(b))
                calls=[]
                def command(*args,**kw):
                    calls.append((args,kw.get('cwd')))
                    if args[:3]==('npm','run','build'):
                        (stage/'dist').mkdir();(stage/'dist/server.cjs').write_text('fake')
                    return ''
                with patch.object(u.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=stream.getvalue())),patch.object(u,'cmd',side_effect=command):
                    u.construir(stage,'commit-candidato',True,False)
                self.assertEqual(calls[0][0][:2],('npm','ci' if com_lock else 'install'))
                self.assertTrue(any(args[:3]==('npm','run','test:aquisicao') and cwd==stage for args,cwd in calls))

if __name__=='__main__':unittest.main()
