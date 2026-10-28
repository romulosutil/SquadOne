import fs from 'node:fs/promises';
import path from 'node:path';

/** Projeção agregada, sem memória privada, números de telefone ou texto de conversas. */
export async function lerFiltroLeads(dataDir: string, agora = Date.now()): Promise<Record<string, unknown>> {
  let v: Record<string, any>;
  try { v = JSON.parse(await fs.readFile(path.join(dataDir, 'filtro-leads.json'), 'utf8')); }
  catch { return { semSinal: true, motivo: 'A curadoria da Marina ainda não foi lida.' }; }
  const em = Date.parse(v.geradoEm);
  if (v.versao !== 'marina-curadoria-v1-20261026' || !Number.isFinite(em) || agora - em > 30 * 3600_000 || em > agora + 300_000) {
    return { semSinal: true, motivo: 'A curadoria está vencida ou incompatível; novos contatos aguardam conferência.' };
  }
  const numero = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : 0;
  const contagens = (x: unknown, chaves: string[]) => Object.fromEntries(chaves.map(k => [k, numero(x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : 0)]));
  return {
    agente: 'Marina', geradoEm: v.geradoEm, dia: v.dia,
    ...Object.fromEntries(['leadsNaFonte', 'contatadosHoje', 'tentativasSemWhatsappHoje', 'casosMaduros', 'casosRotulados', 'ambiguosExcluidos'].map(k => [k, numero(v[k])])),
    ofertasHoje: contagens(v.ofertasHoje, ['site', 'prumo', 'iris', 'estampa', 'plus']),
    resultadosHoje: contagens(v.resultadosHoje, ['recusa', 'acesso', 'permissao', 'robo', 'silencio', 'qualificado', 'proposta', 'pagamento', 'revisar', 'neutra', 'interesse', 'conversa', 'curiosidade']),
    motivosDeRevisaoNaBase: contagens(v.motivosDeRevisaoNaBase, ['recusa-ou-exclusao', 'destino-sem-whatsapp-confirmado', 'falta-achado-de-site', 'texto-afirma-demo-pronta-sem-evidencia', 'falta-publico-infantil-ou-tea', 'falta-necessidade-impacto-decisor']),
    padroesAtivos: (Array.isArray(v.padroesAtivos) ? v.padroesAtivos : []).slice(0, 60).filter((p: any) =>
      p && ['site', 'prumo', 'iris', 'estampa', 'plus'].includes(p.oferta) && ['setor', 'lacuna'].includes(p.dimensao)
      && typeof p.valor === 'string' && /^[a-z -]{1,60}$/.test(p.valor) && [-5, 5].includes(p.ajuste)
      && numero(p.casosRotulados) >= 10 && numero(p.comparacaoRotulada) >= 10).map((p: any) => ({
        oferta: p.oferta, dimensao: p.dimensao, valor: p.valor, ajuste: p.ajuste,
        casosRotulados: numero(p.casosRotulados), avancosConfirmados: numero(p.avancosConfirmados), recusas: numero(p.recusas), comparacaoRotulada: numero(p.comparacaoRotulada),
      })),
    criterio: 'Aprendizado com avanço confirmado ou recusa. Silêncio, robô e acesso são inconclusivos. Maturação de 48h; mínimo de 10 rótulos por grupo e comparação. Ajuste até 5 só na ordem dos aprovados; nunca veto por setor.',
    limiteDaConclusao: 'Os contatos de hoje não elegem um nicho vencedor. Resposta, permissão e interesse não comprovam proposta ou pagamento.',
  };
}
