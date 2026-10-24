import type { CrmPublicacao, CrmUltimaFalha } from '../src/operations/types.ts';
export type { CrmPublicacao, CrmUltimaFalha } from '../src/operations/types.ts';

/** Não reduz IDs a Number: a sequência persistida admite até 30 dígitos. */
export function validarPublicacaoCrm(valor: unknown): CrmPublicacao {
  const invalido = () => { throw new Error('Metadados da publicação CRM inválidos.'); };
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return invalido();
  const d = valor as Record<string, unknown>;
  if (Object.keys(d).sort().join(',') !== 'conteudoHash,execucaoId,publicadoEm,v'
      || d.v !== 1 || typeof d.execucaoId !== 'string' || !/^[1-9][0-9]{0,29}$/.test(d.execucaoId)
      || typeof d.conteudoHash !== 'string' || !/^[a-f0-9]{64}$/.test(d.conteudoHash)
      || typeof d.publicadoEm !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(d.publicadoEm)) return invalido();
  const data = Date.parse(d.publicadoEm);
  if (!Number.isFinite(data) || d.publicadoEm.startsWith('0000-')
      || new Date(data).toISOString().slice(0, 19) !== d.publicadoEm.slice(0, 19)) return invalido();
  return { v: 1, execucaoId: d.execucaoId, conteudoHash: d.conteudoHash, publicadoEm: d.publicadoEm };
}

/** Uma falha selecionada continua indisponível mesmo com o mesmo milissegundo ou relógio recuado. */
export function falhaMaisRecenteQueRetrato(falha: CrmUltimaFalha, retrato: { geradoEm: string; publicacao?: CrmPublicacao }): boolean {
  if (falha.publicacaoInvalida) return true;
  if (falha.publicacao && retrato.publicacao) {
    // Mesma execução nos dois arquivos é inconsistente com o publicador: não presumir sucesso.
    return BigInt(falha.publicacao.execucaoId) >= BigInt(retrato.publicacao.execucaoId);
  }
  // Ausência de metadado é o contrato legado; não inventa uma ordem de execução.
  return Date.parse(falha.em) > Date.parse(retrato.geradoEm);
}
