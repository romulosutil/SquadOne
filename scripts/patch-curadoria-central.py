"""Delta pequeno sobre as fontes atuais da Central, sem substituir trabalho anterior."""
from pathlib import Path
import sys


def trocar(path, antes, depois):
    texto = path.read_text(encoding='utf-8')
    if texto.count(antes) != 1:
        raise ValueError('Âncora mudou: '+str(path)+' '+antes[:60])
    path.write_text(texto.replace(antes, depois, 1), encoding='utf-8')


def aplicar(root):
    trocar(root/'server.ts', 'import { aplicarContratacao, criarSquad, substituirPo } from "./server/hire.ts";',
           'import { aplicarContratacao, criarSquad, substituirPo } from "./server/hire.ts";\nimport { lerFiltroLeads } from \'./server/filtro-leads.ts\';')
    trocar(root/'server.ts', '        roster: readRoster,', '        roster: readRoster,\n        filtroLeads: () => lerFiltroLeads(operationsDataDir),')
    p = root/'server/assistente-ferramentas.ts'
    trocar(p, '"ler_hoje", "ler_funil", "ler_proxima_venda",', '"ler_hoje", "ler_funil", "ler_filtro_leads", "ler_proxima_venda",')
    trocar(p, 'const DECLARACOES_DE_LEITURA: FunctionDeclaration[] = [', '''const DECLARACOES_DE_LEITURA: FunctionDeclaration[] = [
  { name: "ler_filtro_leads", description: "Curadoria diária da Marina: cobertura dos contatos de hoje, recusas, acesso, robôs, silêncio, avanços confirmados e padrões maduros que orientam a seleção. Sem envio ou escrita." },''')
    trocar(p, 'export interface FontesDoAssistente {', 'export interface FontesDoAssistente {\n  filtroLeads?: () => Promise<Record<string, unknown>>;')
    trocar(p, '      case "ler_funil": {', '''      case "ler_filtro_leads": {
        const r = await this.fontes.filtroLeads?.();
        if (!r || r.semSinal) return r ?? { semSinal: true, motivo: 'Curadoria diária indisponível nesta Central.' };
        this.anotar({ tipo: 'crm', geradoEm: typeof r.geradoEm === 'string' ? r.geradoEm : undefined });
        return r;
      }
      case "ler_funil": {''')
    trocar(root/'src/operations/assistente.ts', 'ler_agenda_do_dia, ler_estado_do_dell). Leia antes de afirmar;',
           'ler_filtro_leads, ler_agenda_do_dia, ler_estado_do_dell). Leia antes de afirmar;')


if __name__ == '__main__': aplicar(Path(sys.argv[1]))
