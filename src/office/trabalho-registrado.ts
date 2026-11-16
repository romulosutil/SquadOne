import type { CrmLead } from '../operations/types'
import { lerEventoCiclo } from '../operations/ciclo-comercial'

/** Leitura das anotações de trabalho que já existem no CRM; não cria eventos nem autoridade de envio. */
export interface TrabalhoRegistrado {
  v: 1; id: string; tipo: 'trabalho'; data: string; humano: true; referencia: string
  fila: 'voce' | 'time' | 'cliente'; responsavel: string; tarefa: string; resultado: string; condicao: string
  vencimento?: string; registradoEm?: string
}
const PREFIXO = '[ciclo-comercial-v1] '
const campos = new Set(['v','id','tipo','data','humano','referencia','vinculo','oferta','versao','escopo','prazo','condicoes','valor','mensalidade','vencimento','forma','evidencia','documento','responsavel','tarefa','resultado','fila','condicao'])
const diaValido = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T12:00:00Z')) && new Date(v+'T12:00:00Z').toISOString().slice(0,10) === v
export function lerTrabalhoRegistrado(texto: unknown, agora = Date.now()): TrabalhoRegistrado | null {
  if (typeof texto !== 'string' || !texto.startsWith(PREFIXO) || texto.length > 1000) return null
  try {
    const e = JSON.parse(texto.slice(PREFIXO.length))
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k=>!campos.has(k)) || e.v !== 1 || e.tipo !== 'trabalho' || e.humano !== true || !/^[A-Za-z0-9_-]{3,80}$/.test(e.id ?? '')) return null
    if (!diaValido(e.data) || e.data > new Date(agora-10800_000).toISOString().slice(0,10) || !['voce','time','cliente'].includes(e.fila)) return null
    for (const k of ['referencia','responsavel','tarefa','resultado','condicao']) if (typeof e[k] !== 'string' || !e[k].trim() || e[k].length > 180) return null
    if (e.vencimento !== undefined && !diaValido(e.vencimento)) return null
    return {v:1,id:e.id,tipo:'trabalho',data:e.data,humano:true,referencia:e.referencia,fila:e.fila,responsavel:e.responsavel,tarefa:e.tarefa,resultado:e.resultado,condicao:e.condicao,...(e.vencimento ? {vencimento:e.vencimento} : {})}
  } catch { return null }
}
export function trabalhosRegistrados(lead: Pick<CrmLead,'eventos'>, agora = Date.now()): TrabalhoRegistrado[] {
  const vistos = new Map<string,TrabalhoRegistrado>(), invalidos = new Set<string>(), corrigidos = new Set<string>()
  const registros = [...(Array.isArray(lead.eventos) ? lead.eventos : [])].filter(e=>e.tipo==='nota' && e.origem==='manual' && Number.isFinite(Date.parse(e.em)) && Date.parse(e.em)<=agora).sort((a,b)=>Date.parse(a.em)-Date.parse(b.em))
  for (const registro of registros) {
    const texto = registro.registroTexto ?? registro.texto
    const trabalho = lerTrabalhoRegistrado(texto, Date.parse(registro.em))
    if (trabalho) {
      const anterior = vistos.get(trabalho.id)
      if (anterior && JSON.stringify({...anterior,registradoEm:undefined}) !== JSON.stringify(trabalho)) invalidos.add(trabalho.id)
      else if (!anterior) vistos.set(trabalho.id,{...trabalho,registradoEm:registro.em})
    } else {
      const correcao = lerEventoCiclo(texto, Date.parse(registro.em))
      if (correcao?.tipo === 'correcao' && correcao.vinculo) corrigidos.add(correcao.vinculo)
    }
  }
  return [...vistos.values()].filter(e=>!invalidos.has(e.id) && !corrigidos.has(e.id))
}
