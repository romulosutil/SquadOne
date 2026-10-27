"""Publicação restrita de aberturas: worktree, hashes, backup e estado dos fluxos.

Recebe pacote.json gerado das fontes revisadas. Executar na Mel, em três fases:
  python3 publicar-aberturas.py preparar /caminho/pacote.json
  python3 publicar-aberturas.py validar /caminho/pacote.json
  python3 publicar-aberturas.py publicar /caminho/pacote.json
Não envia mensagens. A atualização da fila pendente usa uma execução separada.
"""
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request


H = Path.home()
REPO = H / 'SquadOne'
BASE = H / '.cache/mel-work/aberturas-adversarial-20261027'
STAGE = BASE / 'stage'
BRANCH = 'codex/aberturas-adversarial-20261027'
FILES = ['server/convite-mensagem.ts', 'server/site-mensagem.ts', 'server/prumo-mensagem.ts',
         'server/plus-mensagem.ts', 'src/operations/colinha.ts', 'src/operations/classificacao-resposta.ts',
         'deploy/dell/claude-ops/site-mensagem.js', 'deploy/dell/claude-ops/prumo-simples.py',
         'deploy/dell/claude-ops/prumo-ofertas.json', 'src/operations/mensagem-automatica.ts']
FLOW_IDS = ['wjuoIknp2qlWo0QI', 'GkgYmWZJ65a2e9XF', 'mfyO1YAhBrXxe5Mb', 'rNp1Upq53IFIuRwT']


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True, stderr=subprocess.STDOUT).strip()


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def save(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    p.chmod(0o600)


def swap(s, pattern, replacement):
    matches = list(re.finditer(pattern, s, re.M | re.S))
    if len(matches) != 1:
        raise ValueError(f'Esperado um trecho: {pattern!r}; encontrados {len(matches)}')
    return re.sub(pattern, lambda _: replacement, s, count=1, flags=re.M | re.S)


def decl(s, prefix, replacement):
    return swap(s, '^' + re.escape(prefix) + r'[^\n]*$', replacement)


def site(s, p):
    s = swap(s, r'^const VARIACOES = \[.*?\];', p['variacoes'])
    if 'const PRIMEIRA_SEM_DEMO =' in s:
        s = decl(s, 'const PRIMEIRA_SEM_DEMO =', p['sem_demo'])
    else:
        s = s.replace(p['variacoes'], p['variacoes'] + '\n' + p['sem_demo'], 1)
    for key, prefix in [('en', 'const VARIACAO_EN ='), ('evento', 'const PRIMEIRA_EVENTO_CRITICO ='),
                        ('molde', '  let molde ='), ('pontos', '  return { url, pontos:')]:
        s = decl(s, prefix, p[key])
    return swap(s, r'^function eventoCriticoDe\(lead\) \{.*?^\}', p['fatos'])


def prumo_code(s):
    s = s.replace("!distribuidora ? 'do dia a dia'", "!distribuidora ? 'de preço, prazo e atendimento'")
    prefix = '! Sou o Rômulo, do Prumo. Ajudo empresas a organizar regras '
    suffix = ' para a equipe consultar no dia a dia.\n\nPosso te mostrar um exemplo ilustrativo de como essas regras ficam organizadas?'
    expression = '  ? ola + ' + json.dumps(prefix, ensure_ascii=False) + ' + areas + ' + json.dumps(suffix, ensure_ascii=False) + '\n'
    return swap(s, r'^  \? ola \+ .*?\n(?=  :)', expression)


def patch_file(name, s, p):
    if name.endswith('/site-mensagem.js'):
        return site(s, p['site'])
    if name == 'server/site-mensagem.ts':
        s = decl(s, 'export const PRIMEIRA_EVENTO_CRITICO =', p['site_ts_evento'])
        return swap(s, r'^export function eventoCriticoDe\(.*?^\}', p['site_ts_fatos'])
    if name == 'server/prumo-mensagem.ts':
        return decl(s, '  return primeiraComEventoCritico(', p['prumo_alias'])
    if name == 'server/convite-mensagem.ts':
        for prefix, replacement in p['convite'].items():
            # Antes da revisão, o return final usava o mesmo marcador `${ola}`.
            s = decl(s, prefix, replacement)
        return s
    if name == 'server/plus-mensagem.ts':
        s = decl(s, 'export const SAUDACAO_MACONICA =', p['plus_saudacao'])
        return swap(s, r'^export const PRIMEIRA_PLUS:.*?^\};', p['plus_modelos'])
    if name == 'src/operations/colinha.ts':
        for ident, literal in p['colinha'].items():
            pattern = r"(id: '" + re.escape(ident) + r"',.*?texto:\n\s*)'[^\n]*'"
            m = list(re.finditer(pattern, s, re.S)); assert len(m) == 1, ident
            s = re.sub(pattern, lambda x: x[1] + literal, s, count=1, flags=re.S)
        return s
    if name == 'src/operations/classificacao-resposta.ts':
        c = p['classificacao']
        for prefix in ['export const VERSAO_CLASSIFICACAO_RESPOSTA =', '  versao: typeof VERSAO_CLASSIFICACAO_RESPOSTA',
                       'const perguntaDeAcesso =', 'const perguntaDePermissao =', '  const recusou =']:
            s = decl(s, prefix, c[prefix])
        if c['recusa_extra'] not in s:
            m = re.search(r'^const recusa = [^\n]*$', s, re.M); assert m
            old = m[0]; assert old.endswith('/')
            s = s.replace(old, old[:-1] + '|' + c['recusa_extra'] + '/', 1)
        if 'const exclusaoExplicita =' not in s:
            s = re.sub(r'(^const recusa = [^\n]*$)', lambda m: m[0] + '\n' + c['const exclusaoExplicita ='], s, count=1, flags=re.M)
        if c['exclusao_humana'] not in s:
            s = re.sub(r"(^  if \(!houveRespostaHumana\) return [^\n]*$)", lambda m: m[0] + '\n' + c['exclusao_humana'], s, count=1, flags=re.M)
        if c['propagar'] not in s:
            s = s.replace('export function respostaParaAcompanhamento(fonte: CrmResposta | undefined, leitura: ClassificacaoDaResposta): CrmResposta | undefined {',
                          'export function respostaParaAcompanhamento(fonte: CrmResposta | undefined, leitura: ClassificacaoDaResposta): CrmResposta | undefined {\n' + c['propagar'], 1)
        return s
    if name.endswith('/prumo-simples.py'):
        return swap(s.replace("!distribuidora ? 'do dia a dia'", "!distribuidora ? 'de preço, prazo e atendimento'"), r'^  \? ola \+ .*?\n(?=  :)', p['prumo_script_corpo'])
    if name.endswith('/prumo-ofertas.json'):
        cfg = json.loads(s)
        for key in ('iris', 'estampa'):
            old = json.dumps(cfg['ofertas'][key]['mensagem'], ensure_ascii=False)
            s = s.replace(old, json.dumps(p['ofertas'][key]['mensagem'], ensure_ascii=False), 1)
        return s
    return s


def runtime_files():
    found = []
    for directory in ('server', 'src', 'public'):
        found.extend(x for x in (REPO / directory).rglob('*') if x.is_file())
    found.extend(REPO / x for x in ['server.ts', 'package.json', 'tsconfig.json', 'vite.config.ts', 'index.html'] if (REPO / x).is_file())
    return found


def n8n_module():
    sys.path.insert(0, str(H / '.local/share/claude-ops'))
    import n8n
    return n8n


def workflow_code(w, p):
    node = next(n for n in w['nodes'] if n['name'] == ('Cruzar recibos e montar abordagem' if w['id'] == FLOW_IDS[0] else 'Decidir'))
    code = node['parameters']['jsCode']
    if w['id'] == FLOW_IDS[0]:
        return node, site(code, p['site'])
    if w['id'] == FLOW_IDS[1]:
        return node, prumo_code(code)
    oferta = 'iris' if w['id'] == FLOW_IDS[2] else 'estampa'
    cfg = p['ofertas'][oferta]
    replacement = 'const mensagem = ' + json.dumps(cfg['mensagem'], ensure_ascii=False) + ".replace('{OLA}', ola).replace('{NOME}', nome || " + json.dumps(cfg['empresa'], ensure_ascii=False) + ');'
    return node, decl(code, 'const mensagem =', replacement)


def prepare(p):
    assert not STAGE.exists(), 'Worktree já existe; conferir a fase antes de repetir.'
    BASE.mkdir(parents=True, exist_ok=True); BASE.chmod(0o700)
    assert run('git', '-C', str(REPO), 'branch', '--show-current') == 'main'
    baseline = {str(x.relative_to(REPO)): sha(x) for x in runtime_files()}
    baseline.update({f: sha(REPO / f) for f in FILES})
    baseline.update({f: sha(REPO / f) for f in p['extras'] if (REPO / f).exists()})
    save(BASE / 'baseline.json', baseline)
    run('git', '-C', str(REPO), 'worktree', 'add', '-b', BRANCH, str(STAGE), 'HEAD')
    for f in FILES:
        src = REPO / f; dest = STAGE / f
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(patch_file(f, src.read_text(), p))
    for f, content in p['extras'].items():
        dest = STAGE / f; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(content)
    run('git', '-C', str(STAGE), 'add', '--', *FILES, *p['extras'])
    run('git', '-C', str(STAGE), 'commit', '-m', 'fix(sales): publish researched first-contact messages and refusal handling')
    (STAGE / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    if (REPO / '.env').exists():
        shutil.copy2(REPO / '.env', STAGE / '.env'); (STAGE / '.env').chmod(0o600)
    flows = {}
    n8n = n8n_module()
    for ident in FLOW_IDS:
        w = n8n.api('GET', '/workflows/' + ident)
        _, code = workflow_code(w, p)
        flows[ident] = {'active': bool(w.get('active')), 'name': w['name'], 'codeSha': hashlib.sha256(code.encode()).hexdigest()}
    save(BASE / 'flows-planejados.json', flows)
    print(json.dumps({'stage': str(STAGE), 'commit': run('git', '-C', str(STAGE), 'rev-parse', 'HEAD'), 'flows': flows}, ensure_ascii=False))


def validate(p):
    tests = ['src/operations-aberturas-adversariais.test.ts', 'server/site-mensagem.test.ts',
             'server/site-evento-critico.test.ts', 'server/plus.test.ts', 'server/prumo-ofertas.test.ts']
    def check(args, log):
        with (BASE / log).open('w') as out:
            result = subprocess.run(args, cwd=STAGE, stdout=out, stderr=subprocess.STDOUT)
        if result.returncode:
            print((BASE / log).read_text()[-11000:]); raise RuntimeError(log)
    check(['node', '--import', 'tsx', '--test', '--test-reporter=spec', *tests], 'tests.log')
    check(['npm', 'run', 'build'], 'build-limpo.log')
    # O runtime preserva todas as outras alterações já presentes na operação.
    for src in runtime_files():
        f = str(src.relative_to(REPO))
        if f not in FILES and f not in p['extras']:
            dest = STAGE / f; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dest)
    check(['node', '--import', 'tsx', '--test', '--test-reporter=spec', *tests], 'tests-runtime.log')
    check(['npm', 'run', 'lint'], 'lint-runtime.log')
    check(['npm', 'run', 'build'], 'build-runtime.log')
    save(BASE / 'validacao.json', {'commit': run('git', '-C', str(STAGE), 'rev-parse', 'HEAD'),
                                 'source': {f: sha(STAGE / f) for f in FILES},
                                 'dist': {str(x.relative_to(STAGE)): sha(x) for x in (STAGE / 'dist').rglob('*') if x.is_file()}})
    print((BASE / 'tests-runtime.log').read_text()[-250:])
    print('Build limpo, runtime, typecheck e testes aprovados.')


def publish(p):
    validation = json.loads((BASE / 'validacao.json').read_text())
    baseline = json.loads((BASE / 'baseline.json').read_text())
    assert validation['commit'] == run('git', '-C', str(STAGE), 'rev-parse', 'HEAD')
    for f, digest in baseline.items(): assert sha(REPO / f) == digest, 'Alteração concorrente: ' + f
    for f, digest in validation['source'].items(): assert sha(STAGE / f) == digest, 'Fonte homologada mudou: ' + f
    for f, digest in validation['dist'].items(): assert sha(STAGE / f) == digest, 'Build homologado mudou: ' + f
    n8n = n8n_module()
    backup = BASE / ('backup-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    def active(unit): return subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit]).returncode == 0
    timers = {u: active(u) for u in ['frente-comercial.timer', 'atualizar-central.timer']}
    save(backup / 'timers.json', timers)
    for u, was in timers.items():
        if was: run('systemctl', '--user', 'stop', u)
    lock = (H / '.local/share/frente-comercial/rodada.lock').open('a')
    updated = []
    merged = False
    try:
        for _ in range(55):
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); break
            except BlockingIOError: time.sleep(1)
        else: raise RuntimeError('Rodada comercial ainda em execução')
        assert not active('frente-comercial.service')
        with urllib.request.urlopen('http://127.0.0.1:9120/api/runtime', timeout=5) as response:
            assert not json.load(response)['ocupado'], 'Central ocupada; repetir publicação quando o turno terminar.'
        for f, digest in baseline.items(): assert sha(REPO / f) == digest, 'Alteração concorrente: ' + f
        for f in FILES:
            dest = backup / 'source' / f; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(REPO / f, dest)
        shutil.copytree(REPO / 'dist', backup / 'dist')
        for ident in FLOW_IDS:
            w = n8n.api('GET', '/workflows/' + ident)
            save(backup / (ident + '.json'), w)
            node, code = workflow_code(w, p)
            node['parameters']['jsCode'] = code
            body = {k: w[k] for k in ('name', 'nodes', 'connections')}
            body['settings'] = {k: v for k, v in w.get('settings', {}).items() if k in n8n.SETTINGS_OK}
            n8n.api('PUT', '/workflows/' + ident, body)
            updated.append(ident)
            if w.get('active'): n8n.api('POST', '/workflows/' + ident + '/activate')
            after = n8n.api('GET', '/workflows/' + ident)
            assert bool(after.get('active')) == bool(w.get('active')), 'Estado do fluxo mudou'
            after_node, after_code = workflow_code(after, p)
            assert after_node['parameters']['jsCode'] == code == after_code
        # Guarda as versões anteriores; o commit contém os mesmos pré-requisitos ativos,
        # com apenas os deltas de mensagens e leitura operacional aplicados acima.
        changed = run('git', '-C', str(REPO), 'status', '--porcelain', '--', *FILES, *p['extras'])
        if changed:
            run('git', '-C', str(REPO), 'stash', 'push', '--include-untracked', '-m', 'backup-before-aberturas-20261027', '--', *FILES, *p['extras'])
            (backup / 'stash.txt').write_text(run('git', '-C', str(REPO), 'rev-parse', 'stash@{0}'))
        run('git', '-C', str(REPO), 'merge', '--ff-only', BRANCH)
        merged = True
        for f in FILES: assert sha(REPO / f) == validation['source'][f], 'Merge divergiu: ' + f
        for f in ['deploy/dell/claude-ops/site-mensagem.js', 'deploy/dell/claude-ops/prumo-simples.py', 'deploy/dell/claude-ops/prumo-ofertas.json']:
            dest = H / '.local/share/claude-ops' / Path(f).name
            shutil.copy2(dest, backup / ('instalado-' + dest.name)); shutil.copy2(REPO / f, dest)
        shutil.copytree(STAGE / 'dist', REPO / 'dist', dirs_exist_ok=True)
        run('systemctl', '--user', 'restart', 'squadone-operations.service')
        for _ in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:9120/api/runtime', timeout=2) as response:
                    assert json.load(response)['mode'] == 'operations'
                break
            except Exception: time.sleep(1)
        else: raise RuntimeError('Central não confirmou saúde')
        result = {'commit': validation['commit'], 'backup': str(backup), 'flows': json.loads((BASE / 'flows-planejados.json').read_text()), 'healthy': True}
        save(BASE / 'publicacao.json', result)
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Antes do merge, os fluxos podem ser revertidos sem tocar no checkout.
        # Depois dele, mantemos o snapshot e não fazemos reset que apagaria outros trabalhos.
        if not merged:
            for ident in reversed(updated):
                old = json.loads((backup / (ident + '.json')).read_text())
                body = {k: old[k] for k in ('name', 'nodes', 'connections')}
                body['settings'] = {k: v for k, v in old.get('settings', {}).items() if k in n8n.SETTINGS_OK}
                n8n.api('PUT', '/workflows/' + ident, body)
                if old.get('active'): n8n.api('POST', '/workflows/' + ident + '/activate')
        raise
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN); lock.close()
        for u, was in timers.items():
            if was: run('systemctl', '--user', 'start', u)


if __name__ == '__main__':
    payload = json.loads(Path(sys.argv[2]).read_text())
    {'preparar': prepare, 'validar': validate, 'publicar': publish}[sys.argv[1]](payload)
