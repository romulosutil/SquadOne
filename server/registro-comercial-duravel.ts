import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export interface ChaveComercial { oportunidade: string; id: string; hash: string }
export interface TentativaComercial extends ChaveComercial {
  tentativaEm: string
  estado: 'pendente' | 'ambiguo' | 'aguardando_projecao' | 'projetado'
  ackEm?: string
  fonteEm?: string
  projetadoEm?: string
}
export interface FatoComercialNaFonte extends ChaveComercial { em: string }
export interface FonteComercialReal { origem: 'aba-crm'; registros: readonly FatoComercialNaFonte[] }
export interface ReservaComercial { criada: boolean; registro: TentativaComercial }
type Estado = { versao: 1; registros: TentativaComercial[] }
const filas = new Map<string, Promise<unknown>>()
const estados = new Set(['pendente', 'ambiguo', 'aguardando_projecao', 'projetado'])
const instante = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const identidade = (v: ChaveComercial) => `${v.oportunidade}\u0000${v.id}`

export class RegistroComercialConflitante extends Error {
  constructor() { super('Identificador comercial já usado com outro conteúdo. Confira a fonte antes de corrigir.'); this.name = 'RegistroComercialConflitante' }
}
export class RegistroComercialBloqueado extends Error {
  constructor() { super('Há uma gravação comercial aguardando projeção nesta oportunidade. Confira a fonte antes de registrar outro fato.'); this.name = 'RegistroComercialBloqueado' }
}

/** Hash do fato validado, independente da ordem das chaves. Não normaliza referências nem altera o conteúdo. */
export function hashCanonicoComercial(valor: unknown): string {
  const vistos = new Set<object>()
  function json(v: unknown): string {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v)
    if (!v || typeof v !== 'object' || vistos.has(v)) throw new Error('Fato comercial deve ser JSON válido, sem ciclos ou valores indefinidos.')
    const proto: unknown = Object.getPrototypeOf(v)
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw new Error('Fato comercial deve usar somente objetos JSON.')
    vistos.add(v)
    try {
      if (Array.isArray(v)) return '[' + Array.from(v, item => json(item)).join(',') + ']'
      const objeto = v as Record<string, unknown>
      return '{' + Object.keys(objeto).sort().map(k => JSON.stringify(k) + ':' + json(objeto[k])).join(',') + '}'
    } finally { vistos.delete(v) }
  }
  return createHash('sha256').update(json(valor)).digest('hex')
}

function validarChave(v: ChaveComercial): void {
  if (!v || typeof v.oportunidade !== 'string' || !v.oportunidade.trim() || v.oportunidade.length > 300 || /[\u0000-\u001f\u007f]/.test(v.oportunidade)
    || typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(v.id) || typeof v.hash !== 'string' || !/^[a-f0-9]{64}$/.test(v.hash)) throw new Error('Identidade ou hash comercial inválido.')
}

/** Journal operacional privado: ACK não é projeção. Não contém overlay nem executa POST ou repetição. */
export class RegistroComercialDuravel {
  readonly arquivo: string
  constructor(arquivo: string, private readonly lock = { tentativas: 40, esperaMs: 25 }) { this.arquivo = path.resolve(arquivo) }

  private async ler(): Promise<Estado> {
    try {
      const valor: unknown = JSON.parse(await fs.readFile(this.arquivo, 'utf8'))
      const estado = valor as Estado
      if (!estado || estado.versao !== 1 || !Array.isArray(estado.registros)) throw new Error('Formato inválido.')
      const vistos = new Set<string>()
      for (const r of estado.registros) {
        validarChave(r)
        const chave = identidade(r)
        if (vistos.has(chave) || !instante(r.tentativaEm) || !estados.has(r.estado)
          || r.ackEm !== undefined && !instante(r.ackEm) || r.fonteEm !== undefined && !instante(r.fonteEm)
          || r.projetadoEm !== undefined && !instante(r.projetadoEm)
          || r.estado === 'aguardando_projecao' && !instante(r.ackEm)
          || r.estado === 'projetado' && (!instante(r.fonteEm) || !instante(r.projetadoEm))) throw new Error('Registro inválido.')
        vistos.add(chave)
      }
      return estado
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { versao: 1, registros: [] }
      throw new Error('Journal comercial ilegível. Bloqueie novas gravações e confira o arquivo privado.', { cause: e })
    }
  }

  private async salvar(estado: Estado): Promise<void> {
    const temp = this.arquivo + '.' + randomUUID() + '.tmp'
    const h = await fs.open(temp, 'wx', 0o600)
    try { await h.writeFile(JSON.stringify(estado)); await h.sync() } finally { await h.close() }
    try {
      await fs.rename(temp, this.arquivo)
      await fs.chmod(this.arquivo, 0o600)
      if (process.platform !== 'win32') {
        const diretorio = await fs.open(path.dirname(this.arquivo), 'r')
        try { await diretorio.sync() } finally { await diretorio.close() }
      }
    } catch (e) { await fs.unlink(temp).catch(() => undefined); throw e }
  }

  private async exclusivo<T>(acao: (estado: Estado) => Promise<T>): Promise<T> {
    const anterior = filas.get(this.arquivo) ?? Promise.resolve()
    const operacao = anterior.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.arquivo), { recursive: true, mode: 0o700 })
      const lock = this.arquivo + '.lock', token = randomUUID()
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined
      for (let i = 0; i < this.lock.tentativas && !handle; i++) {
        try { handle = await fs.open(lock, 'wx', 0o600); await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync() }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
          try {
            const bruto = await fs.readFile(lock, 'utf8')
            const dono = JSON.parse(bruto) as { pid?: number; token?: string }
            if (Number.isInteger(dono.pid) && dono.pid! > 0 && typeof dono.token === 'string') {
              let morto = false
              try { process.kill(dono.pid!, 0) } catch (erro) { morto = (erro as NodeJS.ErrnoException).code === 'ESRCH' }
              if (morto && await fs.readFile(lock, 'utf8') === bruto) { await fs.unlink(lock); continue }
            }
          } catch { /* Trava ilegível ou sem dono comprovadamente morto permanece fechada. */ }
          await new Promise(resolve => setTimeout(resolve, this.lock.esperaMs))
        }
      }
      if (!handle) throw new Error('Outra gravação comercial mantém a trava. Confira antes de continuar.')
      try { return await acao(await this.ler()) }
      finally {
        await handle.close()
        const dono = await fs.readFile(lock, 'utf8').then(v => JSON.parse(v) as { token?: string }).catch(() => null)
        if (dono?.token === token) await fs.unlink(lock).catch(() => undefined)
      }
    })
    filas.set(this.arquivo, operacao)
    try { return await operacao } finally { if (filas.get(this.arquivo) === operacao) filas.delete(this.arquivo) }
  }

  /** Só criada=true concede ao chamador a primeira tentativa de POST. As demais nunca autorizam reenvio. */
  async reservar(entrada: ChaveComercial & { tentativaEm: string }): Promise<ReservaComercial> {
    validarChave(entrada)
    if (!instante(entrada.tentativaEm)) throw new Error('Data da tentativa comercial inválida.')
    return this.exclusivo(async estado => {
      const existente = estado.registros.find(r => identidade(r) === identidade(entrada))
      if (existente) {
        if (existente.hash !== entrada.hash) throw new RegistroComercialConflitante()
        return { criada: false, registro: { ...existente } }
      }
      if (estado.registros.some(r => r.oportunidade === entrada.oportunidade && r.estado !== 'projetado')) throw new RegistroComercialBloqueado()
      const registro: TentativaComercial = { oportunidade: entrada.oportunidade, id: entrada.id, hash: entrada.hash, tentativaEm: entrada.tentativaEm, estado: 'pendente' }
      estado.registros.push(registro)
      await this.salvar(estado)
      return { criada: true, registro: { ...registro } }
    })
  }

  /** Confirma somente o ACK do append; mantém a oportunidade bloqueada até a fonte real. */
  async confirmar(entrada: ChaveComercial & { em: string }): Promise<TentativaComercial> {
    validarChave(entrada)
    if (!instante(entrada.em)) throw new Error('ACK comercial sem data válida; resultado permanece ambíguo.')
    return this.exclusivo(async estado => {
      const registro = estado.registros.find(r => identidade(r) === identidade(entrada))
      if (!registro) throw new Error('Reserva comercial não encontrada.')
      if (registro.hash !== entrada.hash) throw new RegistroComercialConflitante()
      if (registro.estado !== 'projetado') {
        registro.estado = 'aguardando_projecao'; registro.ackEm = entrada.em
        await this.salvar(estado)
      }
      return { ...registro }
    })
  }

  async marcarAmbiguo(entrada: ChaveComercial): Promise<TentativaComercial> {
    validarChave(entrada)
    return this.exclusivo(async estado => {
      const registro = estado.registros.find(r => identidade(r) === identidade(entrada))
      if (!registro) throw new Error('Reserva comercial não encontrada.')
      if (registro.hash !== entrada.hash) throw new RegistroComercialConflitante()
      if (registro.estado === 'pendente') { registro.estado = 'ambiguo'; await this.salvar(estado) }
      return { ...registro }
    })
  }

  /** Somente registros extraídos da aba CRM real. Não passar ACK, overlay ou estado otimista da UI. */
  async reconciliar(fonte: FonteComercialReal, agora = new Date()): Promise<TentativaComercial[]> {
    if (!fonte || fonte.origem !== 'aba-crm' || !Array.isArray(fonte.registros) || !Number.isFinite(agora.getTime())) throw new Error('Reconciliação exige a fonte comercial real e data válida.')
    const observados = new Map<string, FatoComercialNaFonte>()
    for (const fato of fonte.registros) {
      validarChave(fato)
      if (!instante(fato.em) || Date.parse(fato.em) > agora.getTime()) throw new Error('Fato da fonte sem data válida até a leitura.')
      const anterior = observados.get(identidade(fato))
      if (anterior && anterior.hash !== fato.hash) throw new RegistroComercialConflitante()
      if (!anterior) observados.set(identidade(fato), fato)
    }
    return this.exclusivo(async estado => {
      let mudou = false
      for (const fato of observados.values()) {
        let registro = estado.registros.find(r => identidade(r) === identidade(fato))
        if (registro && registro.hash !== fato.hash) throw new RegistroComercialConflitante()
        if (!registro) {
          registro = { oportunidade: fato.oportunidade, id: fato.id, hash: fato.hash, tentativaEm: fato.em, estado: 'projetado', fonteEm: fato.em, projetadoEm: agora.toISOString() }
          estado.registros.push(registro); mudou = true
        } else if (registro.estado !== 'projetado') {
          registro.estado = 'projetado'; registro.fonteEm = fato.em; registro.projetadoEm = agora.toISOString(); mudou = true
        }
      }
      if (mudou) await this.salvar(estado)
      return estado.registros.map(r => ({ ...r }))
    })
  }

  async listar(): Promise<TentativaComercial[]> { return this.exclusivo(async estado => estado.registros.map(r => ({ ...r }))) }
}
