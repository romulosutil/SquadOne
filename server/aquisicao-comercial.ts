import fs from 'node:fs/promises';
import path from 'node:path';

const arquivoPadrao = path.resolve('config/aquisicao-comercial.json');

/** O agente abre a conversa; toda resposta e negociação ficam com Rômulo. */
export async function bloqueioAquisicao(arquivo = arquivoPadrao): Promise<{ bloqueado: boolean; motivo: string }> {
  try {
    const p: unknown = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const c = p as Record<string, unknown>;
      if (c.versao === 2 && c.estado === 'preparado-pausado' && c.respostasAutomaticas === false) {
        return { bloqueado: true, motivo: 'operacao-preparada-aguardando-retomada' };
      }
      if (c.versao === 2 && c.estado === 'primeiro-contato' && c.respostasAutomaticas === false) {
        return { bloqueado: false, motivo: 'primeiro-contato-depois-romulo' };
      }
      if (c.versao === 1 && c.estado === 'bloqueado' && c.motivo === 'restricao-apos-envios-em-massa-2026-11-13') {
        return { bloqueado: true, motivo: c.motivo };
      }
    }
  } catch { /* Ausência ou leitura inválida permanece bloqueada. */ }
  return { bloqueado: true, motivo: 'politica-de-aquisicao-indisponivel-ou-invalida' };
}
