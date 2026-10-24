import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { hashCanonicoComercial } from './registro-comercial-duravel.ts'
import { chaveDaConversaBrasil } from '../src/operations/responsavel-conversa.ts'

/** Origem lógica, não coletor (bridge/Evolution): a mesma mensagem não vira dois eventos. */
export interface EventoAtendimentoComercial {
  idOriginal: string
  origem: 'whatsapp' | 'telegram'
  conta: 'prumo'
  canal: 'whatsapp'
  conversa: string
  tipo: 'mensagem' | 'resposta' | 'entrega' | 'leitura' | 'handoff'
  direcao: 'entrada' | 'saida' | 'interna'
  ocorridoEm: string
  recebidoEm: string
  /** Hash exato do conteúdo mínimo e ID opaco na fonte privada existente. Nenhum texto pessoal. */
  conteudoHash: string
  fonteId: string
}
export interface ResultadoAtendimentoComercial {
  tipo: 'rascunho' | 'handoff'
  id: string
  contextoHash: string
  /** Referência opaca ao derivado; nunca texto pessoal ou fato comercial humano. */
  fonteId: string
}
export interface RegistroEntradaAtendimento {
  chave: string; hash: string; evento: EventoAtendimentoComercial
  estado: 'pendente' | 'processando' | 'concluido' | 'ambiguo'
  tentativa?: { token: string; pid: number }
  resultado?: ResultadoAtendimentoComercial
}
export interface RecebimentoAtendimento { novo: boolean; registro: RegistroEntradaAtendimento }
export interface ReservaAtendimento { token: string; registro: RegistroEntradaAtendimento }
type Estado = { v: 1; registros: RegistroEntradaAtendimento[] }
const filas = new Map<string,Promise<unknown>>()
const clonar = <T>(v: T): T => structuredClone(v)
const objeto = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exato = (v: Record<string,unknown>, campos: string[]) => Object.keys(v).length === campos.length && campos.every(k => Object.hasOwn(v,k))
const texto = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)
const fonteId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{3,200}$/.test(v)
const instante = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,19) === v.slice(0,19)
export function validarEventoAtendimento(v: unknown, agora = Date.now()): EventoAtendimentoComercial {
  if (!objeto(v) || !exato(v,['idOriginal','origem','conta','canal','conversa','tipo','direcao','ocorridoEm','recebidoEm','conteudoHash','fonteId'])
    || !texto(v.idOriginal,200) || !v.idOriginal.trim() || /\s/.test(v.idOriginal)
    || !['whatsapp','telegram'].includes(String(v.origem)) || v.conta !== 'prumo' || v.canal !== 'whatsapp'
    || typeof v.conversa !== 'string' || !/^\d{10}$/.test(v.conversa) || chaveDaConversaBrasil(v.conversa) !== v.conversa
    || !['mensagem','resposta','entrega','leitura','handoff'].includes(String(v.tipo)) || !['entrada','saida','interna'].includes(String(v.direcao))
    || !instante(v.ocorridoEm) || !instante(v.recebidoEm) || Date.parse(v.ocorridoEm) > Date.parse(v.recebidoEm) || Date.parse(v.recebidoEm) > agora
    || typeof v.conteudoHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.conteudoHash) || !fonteId(v.fonteId)) throw new Error('Evento de atendimento inválido; confira identidade original, contexto mínimo e horários reais.')
  if ((v.tipo === 'entrega' || v.tipo === 'leitura') && v.direcao !== 'saida'
    || v.tipo === 'resposta' && v.direcao !== 'entrada' || v.tipo === 'handoff' && v.direcao !== 'interna'
    || v.origem === 'telegram' && v.tipo !== 'handoff'
    || v.tipo !== 'handoff' && v.direcao === 'interna') throw new Error('Tipo, direção e origem do evento são incompatíveis.')
  return { ...v } as unknown as EventoAtendimentoComercial
}
export function chaveEventoAtendimento(e: EventoAtendimentoComercial): string {
  return hashCanonicoComercial([e.origem,e.conta,e.canal,e.conversa,e.tipo,e.direcao,e.idOriginal])
}
function hashEvento(e: EventoAtendimentoComercial): string {
  const { recebidoEm: _recebido, ...original } = e
  return hashCanonicoComercial(original)
}
function validarResultado(v: unknown): ResultadoAtendimentoComercial {
  if (!objeto(v) || !exato(v,['tipo','id','contextoHash','fonteId']) || !['rascunho','handoff'].includes(String(v.tipo))
    || typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{3,100}$/.test(v.id)
    || typeof v.contextoHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.contextoHash) || !fonteId(v.fonteId)) throw new Error('Resultado deve ser rascunho ou passagem com contexto, nunca fato comercial humano.')
  return { ...v } as unknown as ResultadoAtendimentoComercial
}
function processoMorto(pid: number): boolean {
  try { process.kill(pid,0); return false } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH' }
}
/** Inbox derivada privada; não altera JSONL do observador nem a fonte comercial na aba CRM.
 * Receber só confirma persistência. Processamento/modelo/envio ficam fora deste módulo.
 * Nenhum estado é apagado por TTL; ambíguo exige reconciliação explícita, não reenvio.
 */
export class EntradaAtendimentoComercialDuravel {
  readonly arquivo: string
  constructor(arquivo: string, private readonly lock = { tentativas: 40, esperaMs: 25 }) { this.arquivo = path.resolve(arquivo) }
  private async ler(): Promise<Estado> {
    try {
      const v: unknown = JSON.parse(await fs.readFile(this.arquivo,'utf8'))
      if (!objeto(v) || !exato(v,['v','registros']) || v.v !== 1 || !Array.isArray(v.registros)) throw new Error('Formato inválido.')
      const vistos = new Set<string>()
      for (const item of v.registros) {
        if (!objeto(item)) throw new Error('Registro inválido.')
        const e = validarEventoAtendimento(item.evento)
        if (item.chave !== chaveEventoAtendimento(e) || item.hash !== hashEvento(e) || vistos.has(String(item.chave))
          || !['pendente','processando','concluido','ambiguo'].includes(String(item.estado))) throw new Error('Integridade inválida.')
        vistos.add(String(item.chave))
        if (item.estado !== 'pendente' && (!objeto(item.tentativa) || !exato(item.tentativa,['token','pid'])
          || typeof item.tentativa.token !== 'string' || !/^[a-f0-9-]{36}$/.test(item.tentativa.token)
          || !Number.isInteger(item.tentativa.pid) || Number(item.tentativa.pid) <= 0)) throw new Error('Tentativa inválida.')
        if (item.estado === 'pendente' && item.tentativa !== undefined || item.estado !== 'concluido' && item.resultado !== undefined) throw new Error('Estado contraditório.')
        if (item.estado === 'concluido') validarResultado(item.resultado)
      }
      return v as unknown as Estado
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { v: 1, registros: [] }
      throw new Error('Inbox de atendimento ilegível; bloqueie o processamento e confira a cópia privada.', { cause: e })
    }
  }
  private async salvar(estado: Estado): Promise<void> {
    const temp = this.arquivo + '.' + randomUUID() + '.tmp'
    const h = await fs.open(temp,'wx',0o600)
    try { await h.writeFile(JSON.stringify(estado)); await h.sync() } finally { await h.close() }
    try {
      await fs.rename(temp,this.arquivo); await fs.chmod(this.arquivo,0o600)
      if (process.platform !== 'win32') { const d = await fs.open(path.dirname(this.arquivo),'r'); try { await d.sync() } finally { await d.close() } }
    } catch (e) { await fs.unlink(temp).catch(() => undefined); throw e }
  }
  private async exclusivo<T>(acao: (estado: Estado) => Promise<T>): Promise<T> {
    const anterior = filas.get(this.arquivo) ?? Promise.resolve()
    const operacao = anterior.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.arquivo),{recursive:true,mode:0o700})
      const arquivoLock = this.arquivo + '.lock', token = randomUUID()
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined
      for (let i=0;i<this.lock.tentativas && !handle;i++) {
        try { handle=await fs.open(arquivoLock,'wx',0o600); await handle.writeFile(JSON.stringify({pid:process.pid,token})); await handle.sync() }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
          try {
            const bruto=await fs.readFile(arquivoLock,'utf8'), dono: unknown=JSON.parse(bruto)
            if (objeto(dono) && Number.isInteger(dono.pid) && Number(dono.pid)>0 && typeof dono.token === 'string'
              && processoMorto(Number(dono.pid)) && await fs.readFile(arquivoLock,'utf8') === bruto) { await fs.unlink(arquivoLock); continue }
          } catch { /* Trava viva, ilegível ou sem dono comprovadamente morto não é removida. */ }
          await new Promise(resolve => setTimeout(resolve,this.lock.esperaMs))
        }
      }
      if (!handle) throw new Error('Inbox de atendimento ocupada; nenhuma ação foi autorizada.')
      try { return await acao(await this.ler()) } finally {
        await handle.close()
        const dono = await fs.readFile(arquivoLock,'utf8').then(s => JSON.parse(s) as {token?:string}).catch(() => null)
        if (dono?.token === token) await fs.unlink(arquivoLock).catch(() => undefined)
      }
    })
    filas.set(this.arquivo,operacao)
    try { return await operacao } finally { if (filas.get(this.arquivo) === operacao) filas.delete(this.arquivo) }
  }
  /** Retornar ACK somente após esta Promise resolver. Mesmo ID e conteúdo divergente são conflito. */
  async receber(valor: unknown, agora = Date.now()): Promise<RecebimentoAtendimento> {
    const evento=validarEventoAtendimento(valor,agora), chave=chaveEventoAtendimento(evento), hash=hashEvento(evento)
    return this.exclusivo(async estado => {
      const anterior=estado.registros.find(r => r.chave === chave)
      if (anterior) {
        if (anterior.hash !== hash) throw new Error('Identidade de evento reutilizada com conteúdo diferente; confira a fonte original.')
        return {novo:false,registro:clonar(anterior)}
      }
      const registro: RegistroEntradaAtendimento={chave,hash,evento,estado:'pendente'}
      estado.registros.push(registro); await this.salvar(estado)
      return {novo:true,registro:clonar(registro)}
    })
  }
  /** Só uma reserva concede trabalho; a nova reserva deve revalidar contexto/pause/autoridade fora daqui. */
  async reservar(chave: string): Promise<ReservaAtendimento | null> {
    return this.exclusivo(async estado => {
      const r=estado.registros.find(r => r.chave === chave)
      if (!r) throw new Error('Evento ainda não persistido.')
      if (r.estado === 'processando' && r.tentativa && processoMorto(r.tentativa.pid)) { r.estado='ambiguo'; await this.salvar(estado) }
      if (r.estado !== 'pendente') return null
      // Uma conversa não tem dois agentes trabalhando simultaneamente, inclusive ofertas diferentes.
      if (estado.registros.some(outro => outro !== r && outro.evento.conta === r.evento.conta && outro.evento.canal === r.evento.canal
        && outro.evento.conversa === r.evento.conversa && ['processando','ambiguo'].includes(outro.estado))) return null
      r.estado='processando'; r.tentativa={token:randomUUID(),pid:process.pid}; await this.salvar(estado)
      return {token:r.tentativa.token,registro:clonar(r)}
    })
  }
  async concluir(chave: string, token: string, valor: unknown): Promise<RegistroEntradaAtendimento> {
    const resultado=validarResultado(valor)
    return this.exclusivo(async estado => {
      const r=estado.registros.find(r => r.chave === chave)
      if (!r || r.tentativa?.token !== token) throw new Error('Reserva de atendimento não corresponde à tentativa.')
      if (r.estado === 'concluido') {
        if (hashCanonicoComercial(r.resultado) !== hashCanonicoComercial(resultado)) throw new Error('Resultado já concluído com conteúdo diferente.')
        return clonar(r)
      }
      if (r.estado !== 'processando') throw new Error('Tentativa ambígua exige reconciliação antes de concluir.')
      r.resultado=resultado; r.estado='concluido'; await this.salvar(estado); return clonar(r)
    })
  }
  async marcarAmbiguo(chave: string, token: string): Promise<void> {
    return this.exclusivo(async estado => {
      const r=estado.registros.find(r => r.chave === chave)
      if (!r || r.tentativa?.token !== token) throw new Error('Reserva de atendimento não corresponde à tentativa.')
      if (r.estado === 'processando') { r.estado='ambiguo'; await this.salvar(estado) }
    })
  }
  /** Processos mortos nunca liberam repetição; o resultado pode ter ocorrido antes da interrupção. */
  async recuperarInterrompidos(): Promise<RegistroEntradaAtendimento[]> {
    return this.exclusivo(async estado => {
      let mudou=false
      for (const r of estado.registros) if (r.estado === 'processando' && r.tentativa && processoMorto(r.tentativa.pid)) { r.estado='ambiguo'; mudou=true }
      if (mudou) await this.salvar(estado)
      return clonar(estado.registros)
    })
  }
  async listar(): Promise<RegistroEntradaAtendimento[]> { return this.exclusivo(async estado => clonar(estado.registros)) }
}