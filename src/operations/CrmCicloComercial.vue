<script lang="ts">
type Fase = import('./ciclo-comercial').TipoCiclo
interface FormaCiclo { id: string; data: string; referencia: string; vinculo: string; ofertaId: string; ofertas: string[]; versao: string; escopo: string; prazo: string; condicoes: string; responsavel: string; valor: string; mensalidade: string; evidencia: string; documento: string; componente: string; competencia: string; vencimento: string; forma: string; gatilho: string; condicao: string; vigenciaInicio: string; vigenciaFim: string; liberadaEm: string }
interface OperacaoCiclo { estado: 'pronto' | 'enviando' | 'aguardando' | 'ambiguo' | 'confirmado'; esperado?: string; previa?: import('./ciclo-comercial').EventoCiclo; humano: boolean; aviso: string }
interface SessaoCiclo { fase?: Fase; formas: Partial<Record<Fase, FormaCiclo>>; operacoes: Record<string, OperacaoCiclo>; ultimoConfirmado?: string }
// Só memória da sessão. Fechar/reabrir ou trocar de lead não elimina uma operação incerta.
const sessoesCiclo = new Map<string, SessaoCiclo>()
let sequenciaCiclo = 0
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { qualificadoParaProposta } from './spiced'
import { qualificacaoComercialAtual, temQualificacaoComercial } from './qualificacao-comercial'
import { cicloDoLead, diaCiclo, lerEventoCiclo, OFERTAS_CICLO, PREFIXO_CICLO, propostaExigeSiteVisto, textoEventoCiclo, validarTransicaoCiclo, type EventoCiclo, type OfertaCiclo, type TipoCiclo } from './ciclo-comercial'

const props = defineProps<{ lead: CrmLead; disponivel: boolean }>()
const emit = defineEmits<{ registrado: [] }>()
const identidade = computed(() => `${props.lead.produto}:${props.lead.id}`)
function restaurar(chave: string): SessaoCiclo {
  let s = sessoesCiclo.get(chave)
  if (!s) { s = reactive({ formas: {}, operacoes: {} } as SessaoCiclo); sessoesCiclo.set(chave, s) }
  return s
}
const sessao = ref(restaurar(identidade.value))
const ciclo = computed(() => cicloDoLead(props.lead))
const ofertaNomes: Record<OfertaCiclo, string> = { encontrado: 'Site · Encontrado', respondido: 'Respondido e Acompanhado', anuncios: 'Anúncios · uma plataforma', 'anuncios-duas': 'Anúncios · duas plataformas', redes: 'Redes sociais', fonte: 'Fonte', 'fonte-em-dia': 'Fonte em dia', iris: 'Iris', estampa: 'CRM de estamparia', pacote: 'Pacote de ofertas' }
const titulos: Record<TipoCiclo, string> = { proposta: 'Preparar proposta', proposta_enviada: 'Confirmar envio da proposta', aceite: 'Registrar aceite e documento', entrega_vista: 'Confirmar site visto no ar', condicao_cobranca: 'Definir condição de cobrança', cobranca: 'Registrar cobrança', pagamento: 'Confirmar recebimento', correcao: 'Corrigir um registro' }
const propostaAtual = computed(() => ciclo.value.propostas.at(-1))
const aceiteAtual = computed(() => ciclo.value.aceites.find(a => a.vinculo === propostaAtual.value?.id))
const condicoesAtuais = computed(() => ciclo.value.condicoes.filter(c => c.vinculo === aceiteAtual.value?.id))
const abertas = computed(() => ciclo.value.cobrancas.filter(c => c.saldo > 0))
const concluido = computed(() => !sessao.value.fase && ciclo.value.cobrancas.length > 0 && !abertas.value.length && condicoesAtuais.value.length > 0 && condicoesAtuais.value.every(c => c.componente === 'inicial' && ciclo.value.cobrancas.filter(b => b.vinculo === c.id).reduce((n, b) => n + b.valor, 0) === c.valor))
const faseSugerida = computed<TipoCiclo>(() => {
  const p = propostaAtual.value
  if (!p || p.pendencias.length) return 'proposta'
  if (!ciclo.value.envios.some(e => e.vinculo === p.id)) return 'proposta_enviada'
  if (!aceiteAtual.value) return 'aceite'
  if (!condicoesAtuais.value.length) return 'condicao_cobranca'
  if (condicoesAtuais.value.some(c => c.gatilho === 'site_visto_no_ar') && !ciclo.value.eventos.some(e => e.tipo === 'entrega_vista' && e.vinculo === p.id)) return 'entrega_vista'
  if (abertas.value.length) return 'pagamento'
  return 'cobranca'
})
const fase = computed(() => sessao.value.fase ?? faseSugerida.value)
const moeda = (n: number) => (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const novoId = () => `ciclo-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++sequenciaCiclo}`}`
function novaForma(): FormaCiclo {
  return { id: novoId(), data: diaCiclo(), referencia: '', vinculo: '', ofertaId: '', ofertas: [], versao: String(Math.max(0, ...ciclo.value.propostas.map(p => p.versao ?? 0)) + 1), escopo: '', prazo: '', condicoes: '', responsavel: '', valor: '', mensalidade: '', evidencia: '', documento: '', componente: '', competencia: '', vencimento: '', forma: '', gatilho: '', condicao: '', vigenciaInicio: '', vigenciaFim: '', liberadaEm: '' }
}
function formaDaFase(tipo: Fase): FormaCiclo {
  if (!sessao.value.formas[tipo]) sessao.value.formas[tipo] = novaForma()
  return sessao.value.formas[tipo]!
}
const rascunho = computed(() => formaDaFase(fase.value))
function operacaoDa(s: SessaoCiclo, id: string): OperacaoCiclo {
  return s.operacoes[id] ?? (s.operacoes[id] = { estado: 'pronto', humano: false, aviso: '' })
}
const operacao = computed(() => operacaoDa(sessao.value, rascunho.value.id))
const pendente = computed(() => Object.values(sessao.value.operacoes).find(o => ['enviando', 'aguardando', 'ambiguo'].includes(o.estado)))
const travado = computed(() => !props.disponivel || !!pendente.value || ciclo.value.problemas.length > 0)
const editavel = computed(() => !travado.value && operacao.value.estado !== 'confirmado')
const vinculos = computed(() => {
  if (['proposta_enviada', 'aceite', 'entrega_vista'].includes(fase.value)) return ciclo.value.propostas
  if (fase.value === 'condicao_cobranca') return ciclo.value.aceites
  if (fase.value === 'cobranca') return ciclo.value.condicoes
  if (fase.value === 'pagamento') return abertas.value
  if (fase.value === 'correcao') return ciclo.value.eventos
  return []
})
const vinculado = computed(() => ciclo.value.eventos.find(e => e.id === rascunho.value.vinculo))
const componente = computed(() => ['cobranca', 'pagamento'].includes(fase.value) ? vinculado.value?.componente : rascunho.value.componente)
const exigeSite = computed(() => {
  const a = ciclo.value.aceites.find(e => e.id === rascunho.value.vinculo)
  const p = ciclo.value.propostas.find(e => e.id === a?.vinculo)
  return !!p && propostaExigeSiteVisto(p)
})
watch(identidade, chave => { sessao.value = restaurar(chave); conferirFonte() })
watch(() => props.lead.eventos, conferirFonte, { deep: true, immediate: true })
watch(rascunho, () => { const op = operacao.value; if (op.estado === 'pronto') { op.previa = undefined; op.humano = false } }, { deep: true })
function conferirFonte() {
  for (const op of Object.values(sessao.value.operacoes)) {
    if (!op.esperado || op.estado === 'confirmado') continue
    const confirmado = props.lead.eventos.some(r => r.tipo === 'nota' && r.origem === 'manual' && Number.isFinite(Date.parse(r.em)) && Date.parse(r.em) <= Date.now() && (r.registroTexto ?? r.texto) === op.esperado && !!lerEventoCiclo(r.registroTexto ?? r.texto, Date.parse(r.em)))
    if (confirmado) { op.estado = 'confirmado'; op.humano = false; op.aviso = 'Registro confirmado na fonte comercial.'; sessao.value.ultimoConfirmado = op.aviso; sessao.value.fase = undefined }
  }
}
function abrir(tipo: TipoCiclo, vinculo = '', nova = false) {
  if (travado.value) return
  sessao.value.fase = tipo
  if (nova || operacaoDa(sessao.value, formaDaFase(tipo).id).estado === 'confirmado') sessao.value.formas[tipo] = novaForma()
  if (vinculo) rascunho.value.vinculo = vinculo
}
function centavos(texto: string): number | undefined {
  const s = texto.trim()
  if (!s) return undefined
  const m = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(s)
  if (!m) throw new Error('Informe valores sem separador de milhar, com até duas casas decimais.')
  const n = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(n)) throw new Error('Valor fora do limite permitido.')
  return n
}
function montar(): EventoCiclo {
  const r = rascunho.value
  const e: EventoCiclo = { v: 1, id: r.id, tipo: fase.value, data: r.data, referencia: r.referencia, humano: true }
  const texto = (k: keyof FormaCiclo) => { const v = r[k]; if (typeof v === 'string' && v.trim()) (e as unknown as Record<string, unknown>)[k] = v.trim() }
  if (fase.value === 'proposta') {
    e.ofertaId = r.ofertaId as OfertaCiclo; e.versao = Number(r.versao)
    if (e.ofertaId === 'pacote') e.ofertas = r.ofertas as Exclude<OfertaCiclo, 'pacote'>[]
    for (const k of ['escopo', 'prazo', 'condicoes', 'responsavel'] as const) texto(k)
    const valor = centavos(r.valor), mensalidade = centavos(r.mensalidade)
    if (valor !== undefined) e.valor = valor
    if (mensalidade !== undefined) e.mensalidade = mensalidade
  } else {
    texto('vinculo'); texto('evidencia')
    if (fase.value === 'aceite') texto('documento')
    if (['condicao_cobranca', 'cobranca', 'pagamento'].includes(fase.value)) {
      e.componente = componente.value as EventoCiclo['componente']
      const valor = centavos(r.valor); if (valor !== undefined) e.valor = valor
    }
    if (fase.value === 'condicao_cobranca') {
      e.gatilho = exigeSite.value ? 'site_visto_no_ar' : r.gatilho as EventoCiclo['gatilho']
      for (const k of ['condicao', 'vigenciaInicio', 'vigenciaFim'] as const) texto(k)
      if (e.gatilho === 'data_combinada') texto('liberadaEm')
    }
    if (['cobranca', 'pagamento'].includes(fase.value) && componente.value === 'mensal') {
      e.competencia = fase.value === 'pagamento' ? vinculado.value?.competencia : r.competencia
    }
    if (fase.value === 'cobranca') { texto('vencimento'); texto('forma') }
  }
  return e
}
function conferirQualificacao(e: EventoCiclo) {
  if (!['proposta_enviada', 'aceite'].includes(e.tipo)) return
  if (!qualificadoParaProposta(props.lead)) throw new Error('Complete e confirme o painel de qualificação antes de confirmar envio ou aceite.')
  const p = ciclo.value.propostas.find(p => p.id === e.vinculo)
  if (temQualificacaoComercial(props.lead) && qualificacaoComercialAtual(props.lead)?.adequacao.oferta !== p?.ofertaId) throw new Error('A oferta desta proposta deve corresponder à qualificação aprovada. Confira o painel de qualificação e a versão selecionada.')
}
function revisar() {
  if (!editavel.value) return
  const op = operacao.value
  try {
    const e = montar(); textoEventoCiclo(e); validarTransicaoCiclo(props.lead, e); conferirQualificacao(e)
    op.previa = e; op.humano = false; op.aviso = ''
  } catch (erro) { op.previa = undefined; op.aviso = erro instanceof Error ? erro.message : 'Confira o registro.' }
}
async function confirmar() {
  const op = operacao.value
  // A leitura reativa pode confirmar a fonte enquanto o POST ainda aguarda resposta.
  const confirmadoNaFonte = () => op.estado === 'confirmado'
  if (!editavel.value || !op.previa || !op.humano) return
  const e = op.previa
  try { validarTransicaoCiclo(props.lead, e); conferirQualificacao(e) } catch (erro) { op.aviso = erro instanceof Error ? erro.message : 'O contexto mudou.'; op.previa = undefined; op.humano = false; return }
  const texto = textoEventoCiclo(e), origem = sessao.value
  const { produto, chave: id } = props.lead
  op.esperado = texto; op.estado = 'enviando'; op.aviso = 'Registrando; aguarde a fonte comercial.'
  try {
    const r = await fetch('/api/operations/crm/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produto, id, tipo: 'nota', texto, data: '' }), signal: AbortSignal.timeout(20_000) })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok && corpo.naoEnviado === true) {
      if (!confirmadoNaFonte()) { op.estado = 'pronto'; op.esperado = undefined; op.previa = undefined; op.humano = false; op.aviso = `Registro não enviado: ${corpo.error ?? `HTTP ${r.status}`}. Corrija os campos e revise novamente; o identificador foi preservado.` }
      return
    }
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    if (!confirmadoNaFonte()) { op.estado = 'aguardando'; op.aviso = 'Pedido recebido. Aguardando a nota exata aparecer na fonte comercial.' }
    if (sessao.value === origem) conferirFonte()
    emit('registrado')
  } catch (erro) {
    if (!confirmadoNaFonte()) { op.estado = 'ambiguo'; op.humano = false; op.aviso = `Gravação não confirmada: ${erro instanceof Error ? erro.message : String(erro)}. Confira a fonte; não repita o registro nem crie outro identificador.` }
  }
}
function resumo(e: EventoCiclo): string {
  return [titulos[e.tipo], e.referencia, e.versao ? `versão ${e.versao}` : '', e.data, e.valor !== undefined ? moeda(e.valor) : '', e.mensalidade !== undefined ? `mensalidade ${moeda(e.mensalidade)}` : '', e.competencia ? `competência ${e.competencia}` : ''].filter(Boolean).join(' · ')
}
const previaLinhas = computed(() => {
  const e = operacao.value.previa
  if (!e) return []
  return [resumo(e), e.ofertaId ? `Oferta: ${ofertaNomes[e.ofertaId]}${e.ofertas ? ` (${e.ofertas.map(o => ofertaNomes[o]).join(', ')})` : ''}` : '', e.vinculo ? `Relacionado a: ${vinculado.value ? resumo(vinculado.value) : 'registro ausente na leitura atual; confira o contexto'}` : '', e.escopo ? `Escopo: ${e.escopo}` : '', e.prazo ? `Prazo: ${e.prazo}` : '', e.condicoes ? `Condições: ${e.condicoes}` : '', e.documento ? `Documento: ${e.documento}` : '', e.condicao ? `Condição: ${e.condicao}` : '', e.vigenciaInicio ? `Vigência: ${e.vigenciaInicio}${e.vigenciaFim ? ` até ${e.vigenciaFim}` : ''}` : '', e.vencimento ? `Vencimento: ${e.vencimento}` : '', e.forma ? `Forma: ${e.forma}` : '', e.evidencia ? `Evidência: ${e.evidencia}` : '', e.tipo === 'proposta' && (e.valor === undefined || e.mensalidade === undefined) ? 'Rascunho incompleto: valores ausentes continuam a combinar; envio e contratação bloqueados.' : ''].filter(Boolean)
})
async function copiar(condicoes = false) {
  const p = operacao.value.previa?.tipo === 'proposta' ? operacao.value.previa : propostaAtual.value
  if (!p) return
  const linhas = condicoes ? [`Condições comerciais · ${p.referencia} · versão ${p.versao}`, p.condicoes ?? 'Condições a combinar', `Prazo: ${p.prazo ?? 'a combinar'}`] : [`Proposta para revisão · ${p.referencia} · versão ${p.versao}`, `Oferta: ${ofertaNomes[p.ofertaId!]}`, `Escopo: ${p.escopo ?? 'a combinar'}`, `Valor inicial: ${p.valor === undefined ? 'a combinar' : moeda(p.valor)}`, `Mensalidade: ${p.mensalidade === undefined ? 'a combinar' : moeda(p.mensalidade)}`, `Prazo: ${p.prazo ?? 'a combinar'}`, `Condições: ${p.condicoes ?? 'a combinar'}`]
  if (propostaExigeSiteVisto(p)) linhas.push('Cobrança somente após o cliente ver o site funcionando no ar.')
  try { await navigator.clipboard.writeText(linhas.join('\n')); operacao.value.aviso = 'Texto copiado para revisão. Nenhuma mensagem foi enviada.' } catch { operacao.value.aviso = 'Não consegui copiar neste aparelho. O texto continua na prévia para revisão.' }
}
</script>

<template>
  <section class="crm-ciclo" aria-label="Da proposta ao recebimento">
    <h3 class="crm-ficha__rotulo">Da proposta ao recebimento</h3>
    <ol class="crm-ciclo__etapas" aria-label="Etapas comerciais"><li>Preparar proposta</li><li>Confirmar envio</li><li>Registrar aceite e documento</li><li>Definir cobrança</li><li>Confirmar recebimento</li></ol>
    <p class="crm-nota-pequena">Preparar, enviar, contratar e receber são fatos separados. Aceite e documento são registros manuais; não criam assinatura nem contrato jurídico.</p>
    <p v-if="ciclo.problemas.length" class="recado recado--erro" role="alert">O histórico precisa de conferência antes de outro registro: {{ ciclo.problemas[0] }}</p>
    <p v-if="pendente" class="recado" role="status">{{ pendente.aviso }}</p>
    <p v-if="sessao.ultimoConfirmado" role="status">{{ sessao.ultimoConfirmado }}</p>
    <p><strong>Recebimentos confirmados: {{ moeda(ciclo.recebido) }}</strong></p>
    <ul v-if="ciclo.cobrancas.length" class="crm-lista"><li v-for="c in ciclo.cobrancas" :key="c.id">{{ c.referencia }}{{ c.competencia ? ` · competência ${c.competencia}` : '' }} · {{ c.situacao === 'parcial' ? 'Recebimento parcial' : c.situacao === 'integral' ? 'Recebimento integral' : 'Aguardando recebimento' }} · recebido {{ moeda(c.recebido) }} · saldo {{ moeda(c.saldo) }}</li></ul>
    <h4>{{ concluido ? 'Recebimento concluído para as obrigações registradas' : titulos[fase] }}</h4>
    <p v-if="fase === 'proposta'" class="crm-nota-pequena">Preço e recorrência começam em branco. Deixe o que ainda não foi combinado em branco; zero significa ausência de cobrança aprovada por você. O rascunho incompleto não libera envio nem contratação.</p>
    <p v-if="fase === 'entrega_vista'">Confirme a evidência de que o cliente viu funcionando. Publicar ou abrir o site pela nossa conta não comprova isso.</p>
    <p v-if="operacao.estado === 'confirmado'" role="status">{{ operacao.aviso }} <button type="button" class="botao botao--leve" :disabled="travado" @click="abrir(fase, '', true)">Iniciar outro registro desta etapa</button></p>
    <form v-else-if="!concluido" class="crm-form" @submit.prevent="revisar">
      <label v-if="fase !== 'proposta'"><span>{{ fase === 'pagamento' ? 'Cobrança a receber' : fase === 'cobranca' ? 'Condição contratada' : fase === 'condicao_cobranca' ? 'Aceite e documento confirmado' : fase === 'correcao' ? 'Registro a corrigir' : 'Versão exata da proposta' }}</span><select v-model="rascunho.vinculo" :disabled="!editavel" required><option value="">Selecione o registro confirmado</option><option v-for="e in vinculos" :key="e.id" :value="e.id">{{ resumo(e) }}</option></select></label>
      <template v-if="fase === 'proposta'">
        <label><span>Oferta aprovada</span><select v-model="rascunho.ofertaId" :disabled="!editavel" required><option value="">Selecione a oferta desta proposta</option><option v-for="o in OFERTAS_CICLO" :key="o" :value="o">{{ ofertaNomes[o] }}</option></select></label>
        <fieldset v-if="rascunho.ofertaId === 'pacote'" :disabled="!editavel"><legend>Ofertas incluídas no pacote</legend><label v-for="o in OFERTAS_CICLO.filter(o => o !== 'pacote')" :key="o" class="crm-ciclo__check"><input v-model="rascunho.ofertas" type="checkbox" :value="o"> {{ ofertaNomes[o] }}</label></fieldset>
        <label><span>Versão da proposta</span><input v-model="rascunho.versao" type="number" min="1" step="1" :disabled="!editavel" required></label>
        <label><span>Escopo e entregáveis</span><textarea v-model="rascunho.escopo" rows="2" maxlength="180" :disabled="!editavel" /></label>
        <label><span>Valor inicial combinado (R$)</span><input v-model="rascunho.valor" inputmode="decimal" :disabled="!editavel"><small>Sem valor combinado: deixe em branco. Sem cobrança inicial aprovada: informe 0.</small></label>
        <label><span>Mensalidade combinada (R$)</span><input v-model="rascunho.mensalidade" inputmode="decimal" :disabled="!editavel"><small>Não combinada: deixe em branco. Sem recorrência aprovada: informe 0.</small></label>
        <label><span>Prazo e dependências</span><input v-model="rascunho.prazo" maxlength="180" :disabled="!editavel"></label>
        <label><span>Condições comerciais</span><textarea v-model="rascunho.condicoes" rows="2" maxlength="180" :disabled="!editavel" /><small>Registre inclusões e exclusões, suporte e valores pagos diretamente a terceiros; não suponha verba de anúncios ou hospedagem.</small></label>
        <label><span>Responsável pela entrega</span><input v-model="rascunho.responsavel" maxlength="180" :disabled="!editavel"></label>
      </template>
      <label><span>{{ fase === 'pagamento' ? 'Referência do recebimento verificado' : fase === 'correcao' ? 'Referência da correção' : 'Referência do documento ou fato' }}</span><input v-model="rascunho.referencia" maxlength="180" :disabled="!editavel" required><small>Use uma referência interna; não informe dados bancários ou pessoais.</small></label>
      <label><span>Data real do fato</span><input v-model="rascunho.data" type="date" :max="diaCiclo()" :disabled="!editavel" required></label>
      <label v-if="fase !== 'proposta'"><span>{{ fase === 'correcao' ? 'Motivo e evidência da correção' : 'Evidência conferida por você' }}</span><input v-model="rascunho.evidencia" maxlength="180" :disabled="!editavel" required></label>
      <label v-if="fase === 'aceite'"><span>Documento de contratação e versão aceita</span><input v-model="rascunho.documento" maxlength="180" :disabled="!editavel" required></label>
      <template v-if="fase === 'condicao_cobranca'">
        <label><span>Componente combinado</span><select v-model="rascunho.componente" :disabled="!editavel" required><option value="">Selecione</option><option value="inicial">Valor inicial ou parcela acordada</option><option value="mensal">Mensalidade por competência</option></select></label>
        <label><span>Valor desta obrigação (R$)</span><input v-model="rascunho.valor" inputmode="decimal" :disabled="!editavel" required></label>
        <p v-if="exigeSite" class="recado">Site: cobrança somente depois de o cliente ver funcionando no ar. Esse gate pertence à oferta desta proposta.</p>
        <label v-else><span>Quando a cobrança é permitida</span><select v-model="rascunho.gatilho" :disabled="!editavel" required><option value="">Selecione a condição combinada</option><option value="aceite">Após aceite confirmado</option><option value="site_visto_no_ar">Após cliente ver o site no ar</option><option value="data_combinada">A partir de data combinada</option><option value="marco_confirmado">Marco já confirmado com evidência</option></select></label>
        <label><span>Condição descrita no documento</span><input v-model="rascunho.condicao" maxlength="180" :disabled="!editavel" required></label>
        <label><span>Início da vigência</span><input v-model="rascunho.vigenciaInicio" type="date" :disabled="!editavel" required></label>
        <label><span>Fim da vigência, se combinado</span><input v-model="rascunho.vigenciaFim" type="date" :disabled="!editavel"></label>
        <label v-if="!exigeSite && rascunho.gatilho === 'data_combinada'"><span>Data de liberação da cobrança</span><input v-model="rascunho.liberadaEm" type="date" :disabled="!editavel" required></label>
      </template>
      <template v-if="fase === 'cobranca' || fase === 'pagamento'">
        <p v-if="vinculado">{{ componente === 'mensal' ? 'Mensalidade' : 'Valor inicial' }} · {{ resumo(vinculado) }}{{ fase === 'pagamento' && vinculado.competencia ? ` · competência ${vinculado.competencia}` : '' }}</p>
        <label><span>{{ fase === 'pagamento' ? 'Valor recebido e verificado (R$)' : 'Valor desta cobrança (R$)' }}</span><input v-model="rascunho.valor" inputmode="decimal" :disabled="!editavel" required></label>
        <label v-if="fase === 'cobranca' && componente === 'mensal'"><span>Competência da mensalidade</span><input v-model="rascunho.competencia" type="month" :disabled="!editavel" required></label>
        <template v-if="fase === 'cobranca'"><label><span>Vencimento combinado</span><input v-model="rascunho.vencimento" type="date" :disabled="!editavel" required></label><label><span>Forma de cobrança combinada</span><input v-model="rascunho.forma" maxlength="180" :disabled="!editavel" required></label></template>
      </template>
      <button type="submit" class="botao" :disabled="!editavel">Revisar este registro</button>
    </form>
    <section v-if="operacao.previa && !concluido" class="crm-ciclo__previa" aria-label="Prévia do registro">
      <h4>Confira antes de registrar</h4><p v-for="(linha, i) in previaLinhas" :key="i">{{ linha }}</p>
      <label class="crm-ciclo__check"><input v-model="operacao.humano" type="checkbox" :disabled="!editavel"> Conferi este fato, valores e condições. Para recebimento, verifiquei o dinheiro recebido.</label>
      <button type="button" class="botao" :disabled="!editavel || !operacao.humano" @click="confirmar">Confirmar este registro na aba CRM</button>
    </section>
    <p v-if="operacao.aviso && operacao !== pendente" class="recado" role="status">{{ operacao.aviso }}</p>
    <div v-if="propostaAtual || operacao.previa?.tipo === 'proposta'" class="crm-form__botoes"><button type="button" class="botao botao--leve" @click="copiar(false)">Copiar proposta para revisão</button><button type="button" class="botao botao--leve" @click="copiar(true)">Copiar condições comerciais</button></div>
    <details class="dobra"><summary>Histórico comercial e correções</summary>
      <p class="crm-nota-pequena">Corrigir acrescenta um registro e preserva o original. Corrija fatos dependentes primeiro; não edite o recebimento anterior.</p>
      <ul class="crm-lista"><li v-for="e in ciclo.historico" :key="e.id">{{ resumo(e) }}{{ !ciclo.eventos.some(a => a.id === e.id) && e.tipo !== 'correcao' ? ' · corrigido' : '' }} <button v-if="e.tipo !== 'correcao' && ciclo.eventos.some(a => a.id === e.id)" type="button" class="botao botao--leve" :disabled="travado" @click="abrir('correcao', e.id)">Corrigir este registro</button></li></ul>
      <div class="crm-form__botoes"><button type="button" class="botao botao--leve" :disabled="travado" @click="abrir('proposta', '', true)">Preparar nova versão ou proposta</button><button v-if="ciclo.aceites.length" type="button" class="botao botao--leve" :disabled="travado" @click="abrir('condicao_cobranca', '', true)">Definir outra condição de cobrança</button><button v-if="ciclo.condicoes.length" type="button" class="botao botao--leve" :disabled="travado" @click="abrir('cobranca', '', true)">Registrar outra cobrança ou competência</button><button type="button" class="botao botao--leve" :disabled="travado" @click="sessao.fase = undefined">Voltar à próxima etapa</button></div>
    </details>
  </section>
</template>

<style scoped>
.crm-ciclo { display: grid; gap: var(--esp-2); }
.crm-ciclo__etapas { display: flex; flex-wrap: wrap; gap: var(--esp-2); padding-left: var(--esp-4); }
.crm-ciclo__etapas li { margin-right: var(--esp-3); }
.crm-ciclo__previa { display: grid; gap: var(--esp-2); padding: var(--esp-3); border: 1px solid var(--borda); border-radius: var(--raio); }
.crm-ciclo .crm-ciclo__check { display: flex; align-items: start; gap: var(--esp-2); }
.crm-ciclo__check input { width: auto; }
.crm-ciclo small { display: block; }
.crm-ciclo select, .crm-ciclo input, .crm-ciclo textarea { max-width: 100%; }
</style>
