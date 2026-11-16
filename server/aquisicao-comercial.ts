import fs from 'node:fs/promises';
import path from 'node:path';

const arquivoPadrao = path.resolve('config/aquisicao-comercial.json');

/** Não há modo de liberação nesta versão: reconexão e edição da configuração não autorizam envios. */
export async function bloqueioAquisicao(arquivo = arquivoPadrao): Promise<{ bloqueado: true; motivo: string }> {
  try {
    const p: unknown = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const c = p as Record<string, unknown>;
      if (c.versao === 1 && c.estado === 'bloqueado' && c.motivo === 'restricao-apos-envios-em-massa-2026-11-13') {
        return { bloqueado: true, motivo: c.motivo };
      }
    }
  } catch { /* Ausência ou leitura inválida permanece bloqueada. */ }
  return { bloqueado: true, motivo: 'politica-de-aquisicao-indisponivel-ou-invalida' };
}
