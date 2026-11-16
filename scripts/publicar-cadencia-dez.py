"""Publica a cadência pedida em 12/11, preservando a produção atual e os recibos."""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess

H = Path.home()
R = H/'SquadOne'
A = H/'.cache/mel-work/cadencia-10-20261112'


def main():
    backup = A/('backup-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(parents=True, mode=0o700)
    restaurar = []
    def escrever(p, texto):
        bak = backup/p.relative_to(H)
        if p.exists(): bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(p, bak)
        else: bak = None
        restaurar.append((p, bak))
        tmp = p.with_name(p.name+'.cadencia.tmp'); tmp.write_text(texto); tmp.chmod(0o644); os.replace(tmp, p)
    def trocar(p, antes, depois):
        s = p.read_text(); assert s.count(antes) == 1, str(p)+' mudou'; escrever(p, s.replace(antes, depois, 1))
    def run(args, log):
        p = subprocess.run(args, cwd=R, capture_output=True, text=True)
        (backup/log).write_text(p.stdout+p.stderr)
        assert p.returncode == 0, log+'\n'+(p.stdout+p.stderr)[-2200:]
        return p.stdout
    subprocess.run(['systemctl', '--user', 'stop', 'frente-comercial.timer'], check=True)
    try:
        with (H/'.local/share/frente-comercial/rodada.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            trocar(R/'src/operations/trava-de-ritmo.ts',
                   '  intervaloMs: 30 * 60_000,\n  porHora: 2,',
                   '  intervaloMs: 10 * 60_000,\n  porHora: 6,')
            escrever(R/'src/operations-cadencia-dez-minutos.test.ts', (A/'operations-cadencia-dez-minutos.test.ts').read_text())
            p = R/'server/frente-comercial.test.ts'; s = p.read_text()
            s = s.replace('intervalo de 30 min da Central', 'intervalo de 10 min da Central')
            s = s.replace("ate: new Date(AGORA + 30 * 60_000).toISOString()", "ate: new Date(AGORA + 10 * 60_000).toISOString()")
            s = s.replace('v.intervaloMinutos, 30', 'v.intervaloMinutos, 10').replace('v.porHora, 2', 'v.porHora, 6')
            escrever(p, s)
            p = R/'src/operations-primeiro-contato.test.ts'; s = p.read_text()
            s = s.replace('intervalo de 30 min', 'intervalo de 10 min').replace('ate: AGORA + 28 * MIN', 'ate: AGORA + 8 * MIN')
            s = s.replace('4 envios na última hora', '6 envios na última hora').replace('length: 4 }, (_, i) => lead(`e${i}`', 'length: 6 }, (_, i) => lead(`e${i}`').replace('(59 - i * 15)', '(59 - i * 9)')
            s = s.replace('// 15 no dia, todos antes', '// 20 no dia, todos antes').replace('length: 15 }, (_, i)', 'length: 20 }, (_, i)')
            escrever(p, s)
            p = R/'src/operations-trava-de-ritmo.test.ts'; s = p.read_text()
            inicio = s.index("  it('o teto de 2 na hora e os 30 minutos")
            fim = s.index("  it(", inicio + 5)
            teste = s[inicio:fim].replace('o teto de 2 na hora e os 30 minutos', 'o teto de 6 na hora e os 10 minutos')
            teste = teste.replace('30 * MIN', '10 * MIN').replace('length: 2', 'length: 6').replace('enviadosHoje: 2, teto', 'enviadosHoje: 6, teto')
            escrever(p, s[:inicio]+teste+s[fim:])
            output = run(['node', '--import', 'tsx', '--test', 'src/operations-cadencia-dez-minutos.test.ts',
                          'src/operations-trava-de-ritmo.test.ts', 'src/operations-primeiro-contato.test.ts',
                          'server/frente-comercial.test.ts', 'server/venda-do-dia.test.ts', 'server/rodada-comercial.test.ts'], 'testes.log')
            print(output[-500:], flush=True)
            stage = A/'dist'
            run(['node', 'node_modules/vite/bin/vite.js', 'build', '--outDir', str(stage), '--emptyOutDir'], 'frontend-build.log')
            run(['node_modules/esbuild/bin/esbuild', 'server.ts', '--bundle', '--platform=node', '--format=cjs',
                 '--packages=external', '--sourcemap', '--outfile='+str(stage/'server.cjs')], 'server-build.log')
            # Assets primeiro, entradas por último; manter os assets antigos para sessões abertas.
            for source in sorted(stage.rglob('*'), key=lambda p: p.name in ('index.html', 'server.cjs')):
                if not source.is_file(): continue
                dest = R/'dist'/source.relative_to(stage); dest.parent.mkdir(parents=True, exist_ok=True)
                bak = backup/dest.relative_to(H)
                if dest.exists(): bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(dest, bak)
                else: bak = None
                restaurar.append((dest, bak)); temp = dest.with_suffix(dest.suffix+'.cadencia.tmp')
                shutil.copy2(source, temp); os.replace(temp, dest)
            manifest = H/'.local/share/squadone-operations/campanha-site-ativa.json'
            m = json.loads(manifest.read_text()); m['limites']['intervaloMinutos'] = 10; m['limites']['porHora'] = 6
            m['cadenciaAutorizadaEm'] = dt.datetime.now(dt.timezone.utc).isoformat()
            m['cadenciaAutorizadaPor'] = 'Rômulo em 12/11/2026: disparar com espaço de dez minutos e acompanhar o próximo envio.'
            escrever(manifest, json.dumps(m, ensure_ascii=False, indent=2)); manifest.chmod(0o600)
            subprocess.run(['systemctl', '--user', 'restart', 'squadone-operations.service'], check=True)
            (A/'publicacao.json').write_text(json.dumps({'backup': str(backup), 'intervaloMinutos': 10,
                 'porHora': 6, 'tetoDia': 20, 'publicado': True}, ensure_ascii=False, indent=2))
            print('PUBLICADO', str(backup), flush=True)
    except BaseException:
        for dest, bak in reversed(restaurar):
            if bak: shutil.copy2(bak, dest)
            else: dest.unlink(missing_ok=True)
        subprocess.run(['systemctl', '--user', 'restart', 'squadone-operations.service'])
        raise
    finally:
        subprocess.run(['systemctl', '--user', 'start', 'frente-comercial.timer'], check=True)


if __name__ == '__main__': main()
