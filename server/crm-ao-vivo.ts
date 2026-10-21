import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { ConfigDoCrm } from './crm.ts';

/** Um observador compartilhado por todas as telas; só sinaliza mudança, sem expor conteúdo. */
export function criarSinalDoCrm(config: Partial<Pick<ConfigDoCrm, 'retrato' | 'conversas'>>) {
  const ouvintes = new Set<() => void>();
  const observadores = new Map<string, FSWatcher>();
  let retentar: ReturnType<typeof setInterval> | undefined;
  let agrupar: ReturnType<typeof setTimeout> | undefined;
  const fontes = [
    ...(config.retrato ? [{ pasta: path.dirname(config.retrato), aceita: (nome: string) => nome === path.basename(config.retrato) || nome === 'crm-falha.json' }] : []),
    ...(config.conversas ? [{ pasta: config.conversas, aceita: (nome: string) => nome.endsWith('.jsonl') }] : []),
  ];
  function avisar() {
    if (agrupar) return;
    agrupar = setTimeout(() => { agrupar = undefined; for (const ouvir of ouvintes) ouvir(); }, 200);
  }
  function observar() {
    for (const fonte of fontes) {
      if (observadores.has(fonte.pasta)) continue;
      try {
        const observador = watch(fonte.pasta, (_tipo, nome) => { if (!nome || fontes.some(f => f.pasta === fonte.pasta && f.aceita(String(nome)))) avisar(); });
        observador.on('error', () => { observador.close(); observadores.delete(fonte.pasta); });
        observadores.set(fonte.pasta, observador);
        // Inclui o arquivo que chegou enquanto a pasta ainda não existia.
        avisar();
      } catch { /* A pasta pode ser criada depois da conexão; o próximo ciclo tenta novamente. */ }
    }
  }
  return (ouvir: () => void) => {
    ouvintes.add(ouvir);
    if (ouvintes.size === 1) { observar(); retentar = setInterval(observar, 5_000); retentar.unref(); }
    return () => {
      ouvintes.delete(ouvir);
      if (ouvintes.size) return;
      clearInterval(retentar); clearTimeout(agrupar); agrupar = undefined;
      for (const observador of observadores.values()) observador.close();
      observadores.clear();
    };
  };
}
